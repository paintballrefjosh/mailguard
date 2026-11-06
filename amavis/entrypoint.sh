#!/bin/bash
set -e

API_URL="${MAILGUARD_API_URL:-http://backend:3001}"
TOKEN="${MAILGUARD_INTERNAL_TOKEN:-}"

echo "[amavis] Starting MailGuard Amavis container..."

# ── Fix config file ownership — bind-mounted files may be owned by host user ──
chown root:root /etc/amavis/conf.d/99-mailguard 2>/dev/null || true
chown root:root /etc/spamassassin/local.cf 2>/dev/null || true

# ── Create required files ─────────────────────────────────────────────────────
echo "${MAIL_HOSTNAME:-mail.example.com}" > /etc/mailname

# ── Directories ───────────────────────────────────────────────────────────────
mkdir -p \
  /var/lib/amavis/{db,tmp,quarantine,.spamassassin} \
  /var/run/amavis \
  /var/log/amavis

chown -R amavis:amavis /var/lib/amavis /var/run/amavis /var/log/amavis

# ── Clear all stale PID/lock/socket files ─────────────────────────────────────
rm -f /var/run/amavis/amavisd.pid \
      /var/run/amavis/amavisd.lock \
      /var/lib/amavis/amavisd.pid \
      /var/lib/amavis/amavisd.lock \
      /var/lib/amavis/amavisd.sock

# ── Wait for ClamAV TCP port (separate container) ─────────────────────────────
echo "[amavis] Waiting for ClamAV on clamav:3310..."
CLAM_READY=0
for i in $(seq 1 60); do
  if nc -z clamav 3310 2>/dev/null; then
    CLAM_READY=1
    echo "[amavis] ClamAV ready after ${i}x2s."
    break
  fi
  sleep 2
done

if [ "$CLAM_READY" -eq 0 ]; then
  echo "[amavis] WARNING: ClamAV not reachable on clamav:3310 after 120s — virus scanning may fail."
fi

# ── Fetch settings from API and write dynamic config ─────────────────────────
echo "[amavis] Fetching settings from backend..."
SETTINGS=$(curl -sf \
  -H "X-Internal-Token: ${TOKEN}" \
  "${API_URL}/api/settings?category=spam" 2>/dev/null || echo "[]")
HEADER_RULES=$(curl -sf \
  -H "X-Internal-Token: ${TOKEN}" \
  "${API_URL}/api/settings?category=header_rules" 2>/dev/null || echo "[]")

python3 << PYEOF
import json, os

def get(items, key, default=''):
    for item in items:
        if item.get('key_name') == key:
            return item.get('value', default)
    return default

try:
    settings = json.loads('''${SETTINGS}''')
except Exception:
    settings = []

try:
    header_rules_list = json.loads('''${HEADER_RULES}''')
except Exception:
    header_rules_list = []

s = {item['key_name']: item['value'] for item in settings if 'key_name' in item}
h = {item['key_name']: item['value'] for item in header_rules_list if 'key_name' in item}

tag_score      = s.get('sa_tag_score',          '2.0')
tag2_score     = s.get('score_threshold_flag',  '6.0')
kill_score     = s.get('score_threshold_block', '10.0')
required_score = s.get('sa_required_score',     '5.0')

action_map = {
    'block':      'D_REJECT',
    'quarantine': 'D_DISCARD',
    'flag':       'D_PASS',
    'allow':      'D_PASS',
}

virus_action = action_map.get(s.get('virus_action', 'quarantine'), 'D_DISCARD')
spam_action  = action_map.get(s.get('spam_action',  'flag'),       'D_PASS')

# SpamAssassin required_score override
with open('/etc/spamassassin/mailguard-dynamic.cf', 'w') as f:
    f.write('required_score {}\n'.format(required_score))

# Amavis score + action overrides
with open('/etc/amavis/conf.d/60-scores', 'w') as f:
    f.write('use strict;\n')
    f.write('\$sa_tag_level_deflt  = {};\n'.format(tag_score))
    f.write('\$sa_tag2_level_deflt = {};\n'.format(tag2_score))
    f.write('\$sa_kill_level_deflt = {};\n'.format(kill_score))
    f.write('\$final_virus_destiny = {};\n'.format(virus_action))
    f.write('\$final_spam_destiny  = {};\n'.format(spam_action))
    if s.get('spam_action') == 'quarantine':
        f.write("\\\$spam_quarantine_to = 'spam-quarantine';\n")
    f.write('1;\n')

# Header analysis rules
with open('/etc/spamassassin/mailguard-headers.cf', 'w') as f:
    f.write('score MISMATCH_REPLY_TO {}\n'.format(
        '2.5' if h.get('check_reply_to_mismatch') == 'true' else '0'))
    f.write('score MISSING_MID {}\n'.format(
        '1.5' if h.get('check_missing_mid') == 'true' else '0'))
    f.write('score LOOKALIKE_DOMAIN {}\n'.format(
        '4.0' if h.get('check_lookalike_domains') == 'true' else '0'))

    if h.get('check_display_name_spoof') == 'true':
        domains = [d.strip() for d in os.environ.get('RELAY_DOMAINS', 'example.com').split(',')]
        pattern = '|'.join(domains)
        f.write('header   DISPLAY_NAME_SPOOF  From =~ /\\b(?:{})\\b/i\n'.format(pattern))
        f.write('describe DISPLAY_NAME_SPOOF  Display name contains your domain but sender is external\n')
        f.write('score    DISPLAY_NAME_SPOOF  4.0\n')

    if h.get('check_suspicious_mailer') == 'true':
        f.write('header   SUSP_MAILER  X-Mailer =~ /(?:The Bat!|Foxmail|GreenArrow|PHPMailer\\/[0-3]\\.|Swiftmailer)/i\n')
        f.write('describe SUSP_MAILER  Suspicious mail client\n')
        f.write('score    SUSP_MAILER  1.5\n')

print("[amavis] Config files written successfully.")
PYEOF

# ── Body rules → SpamAssassin ─────────────────────────────────────────────────
# Postfix body_checks (generated by the backend from the blocklists table) only
# matches the RAW, undecoded body line-by-line — it never sees base64/QP/HTML
# content. So we mirror the body block/hold rules into SpamAssassin body rules,
# which run on the DECODED, HTML-stripped text. Each gets a high score so a hit
# clears the kill threshold and the message is blocked per $final_spam_destiny.
# Source of truth is the same generated file postfix reads (mounted read-only).
echo "[amavis] Generating SpamAssassin body rules from blocklist..."
BODY_CHECKS_SRC="/mailguard/maps-dynamic/body_checks"
python3 << PYEOF
import re
src = "${BODY_CHECKS_SRC}"
out = "/etc/spamassassin/mailguard-bodyrules.cf"
# action -> SA score. REJECT/HOLD become hard blocks (well above any UI kill
# level); WARN is a flag-only rule and contributes a small score.
SCORE = {"REJECT": 10.0, "HOLD": 10.0, "WARN": 0.1}
# Line format: /pattern/  ACTION [5.7.1] [mailguard:rule_id=N] reason
line_re = re.compile(r'^/(?P<pat>.+)/\s+(?P<action>REJECT|HOLD|WARN)\b')
id_re   = re.compile(r'rule_id=(\d+)')
lines = ["# Generated by MailGuard amavis entrypoint from postfix body_checks.",
         "# DO NOT EDIT - regenerated on every amavis (re)start.", ""]
count = 0
try:
    with open(src) as fh:
        rows = fh.readlines()
except Exception as e:
    rows = []
    print("[amavis] body_checks not readable (%s) - no SA body rules" % e)
for raw in rows:
    raw = raw.rstrip("\n")
    if not raw or raw.lstrip().startswith("#"):
        continue
    m = line_re.match(raw)
    if not m:
        continue
    pat = m.group("pat")
    action = m.group("action")
    score = SCORE.get(action)
    if not score:
        continue
    idm = id_re.search(raw)
    rid = idm.group(1) if idm else str(count)
    name = "MG_BODY_%s" % rid
    # Validate the pattern compiles as a Perl-ish/Python regex; skip if not.
    try:
        re.compile(pat.replace("\\/", "/"))
    except Exception:
        print("[amavis] skipping invalid body pattern for rule %s" % rid)
        continue
    lines.append("body %s /%s/i" % (name, pat))
    lines.append("describe %s MailGuard body rule %s" % (name, rid))
    lines.append("score %s %s" % (name, score))
    lines.append("")
    count += 1
with open(out, "w") as fh:
    fh.write("\n".join(lines) + "\n")
print("[amavis] Wrote %d SpamAssassin body rule(s) to %s" % (count, out))
PYEOF

# ── Update SpamAssassin rules ─────────────────────────────────────────────────
echo "[amavis] Updating SpamAssassin rules..."
sa-update --quiet 2>/dev/null || true

# ── Find the amavisd binary ───────────────────────────────────────────────────
AMAVISD=""
for candidate in \
  /usr/sbin/amavisd \
  /usr/sbin/amavisd-new \
  /usr/lib/amavis/amavisd; do
  if [ -f "$candidate" ] && [ -x "$candidate" ]; then
    AMAVISD="$candidate"
    break
  fi
done

if [ -z "$AMAVISD" ]; then
  echo "[amavis] ERROR: Cannot find amavisd binary"
  find /usr -name "amavis*" -type f 2>/dev/null | head -10
  exit 1
fi

echo "[amavis] Found amavisd at: $AMAVISD"

# ── Start Amavis daemon ───────────────────────────────────────────────────────
echo "[amavis] Starting amavis daemon..."
su -s /bin/bash amavis -c "$AMAVISD start 2>>/var/log/amavis/amavis.log"
START_RC=$?

if [ $START_RC -ne 0 ]; then
  echo "[amavis] ERROR: amavisd start returned $START_RC"
  tail -30 /var/log/amavis/amavis.log 2>/dev/null || true
  exit 1
fi

# ── Wait for PID file and port ────────────────────────────────────────────────
echo "[amavis] Waiting for Amavis to bind port 10024..."
AMAVIS_PID=""
for i in $(seq 1 30); do
  AMAVIS_PID=$(cat /var/run/amavis/amavisd.pid 2>/dev/null || true)
  if [ -n "$AMAVIS_PID" ] && nc -z 127.0.0.1 10024 2>/dev/null; then
    echo "[amavis] Amavis listening on port 10024 (master pid $AMAVIS_PID)."
    break
  fi
  sleep 2
done

if [ -z "$AMAVIS_PID" ] || ! nc -z 127.0.0.1 10024 2>/dev/null; then
  echo "[amavis] ERROR: Amavis did not start after 60s."
  tail -50 /var/log/amavis/amavis.log 2>/dev/null || true
  exit 1
fi

# ── Tail log ──────────────────────────────────────────────────────────────────
touch /var/log/amavis/amavis.log
tail -F /var/log/amavis/amavis.log &

# ── Monitor amavis master via /proc ──────────────────────────────────────────
echo "[amavis] Monitoring amavis master (pid $AMAVIS_PID)..."
while [ -e "/proc/$AMAVIS_PID" ]; do
  sleep 5
done
echo "[amavis] amavis master (pid $AMAVIS_PID) exited — container stopping."
exit 1