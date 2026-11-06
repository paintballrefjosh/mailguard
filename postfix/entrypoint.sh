#!/bin/bash
set -e

API_URL="${MAILGUARD_API_URL:-http://backend:3001}"
TOKEN="${MAILGUARD_INTERNAL_TOKEN:-}"

# ── Wait for backend API to be ready ─────────────────────────────────────────
echo "[mailguard] Waiting for backend API..."
for i in $(seq 1 30); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "X-Internal-Token: ${TOKEN}" \
    "${API_URL}/api/settings?category=greylist" 2>/dev/null)
  if [ "$STATUS" = "200" ]; then
    echo "[mailguard] Backend API ready."
    break
  fi
  echo "[mailguard] Backend not ready (HTTP ${STATUS}), retrying in 2s... (${i}/30)"
  sleep 2
done

# ── Fetch settings from backend API ──────────────────────────────────────────
echo "[mailguard] Fetching settings from backend..."

GREYLIST_JSON=$(curl -sf \
  -H "X-Internal-Token: ${TOKEN}" \
  "${API_URL}/api/settings?category=greylist" 2>/dev/null || echo "[]")

RATELIMIT_JSON=$(curl -sf \
  -H "X-Internal-Token: ${TOKEN}" \
  "${API_URL}/api/settings?category=ratelimit" 2>/dev/null || echo "[]")

# Write a temporary Python script to parse settings
cat > /tmp/parse_settings.py << 'EOF'
import json, os, sys

def get(data, key, default=''):
    for item in data:
        if item.get('key_name') == key:
            return item.get('value', default)
    return default

try:    gl = json.loads(os.environ.get('GREYLIST_JSON',  '[]'))
except: gl = []
try:    rl = json.loads(os.environ.get('RATELIMIT_JSON', '[]'))
except: rl = []

gl_enabled = get(gl, 'enabled', 'true') == 'true'
rl_enabled = get(rl, 'enabled', 'true') == 'true'

greylist_restriction = (
    "check_policy_service inet:127.0.0.1:10023,"
    if gl_enabled else ""
)

lines = [
    f"GL_ENABLED={'true' if gl_enabled else 'false'}",
    f"GL_DELAY={get(gl, 'delay_seconds', '300')}",
    f"GL_MAX_AGE={get(gl, 'max_age_days', '35')}",
    f"GL_RETRY={get(gl, 'retry_window', '2')}",
    f"GL_WHITELIST={'true' if get(gl, 'whitelist_clients', 'true') == 'true' else 'false'}",
    f"RL_ENABLED={'true' if rl_enabled else 'false'}",
    f"MAX_CONN_RATE={get(rl, 'max_connections_per_ip', '10') if rl_enabled else '0'}",
    f"MAX_MSG_RATE={get(rl, 'max_messages_per_ip', '100') if rl_enabled else '0'}",
    f"MAX_RCPT_RATE={get(rl, 'max_recipients_per_ip', '200') if rl_enabled else '0'}",
    f"MAX_CONN_COUNT={get(rl, 'max_connections_per_ip', '10') if rl_enabled else '0'}",
    f"RATE_TIME_UNIT={get(rl, 'time_window_seconds', '3600')}",
    f"GREYLIST_RESTRICTION={greylist_restriction}",
]
print('\n'.join(lines))
EOF

# Run the parser and source its output
PARSED=$(GREYLIST_JSON="$GREYLIST_JSON" RATELIMIT_JSON="$RATELIMIT_JSON" \
  python3 /tmp/parse_settings.py 2>/dev/null || true)

# Source each line as a variable
while IFS='=' read -r key value; do
  [ -n "$key" ] && export "$key"="$value"
done <<< "$PARSED"

# ── Generate main.cf from template ───────────────────────────────────────────
RELAY_HOST="${SMTP_RELAY_HOST:-}"
RELAY_PORT="${SMTP_RELAY_PORT:-25}"
RELAY_ENTRY=""
[ -n "$RELAY_HOST" ] && RELAY_ENTRY="[${RELAY_HOST}]:${RELAY_PORT}"

sed \
  -e "s|{{MAIL_HOSTNAME}}|${MAIL_HOSTNAME:-mail.example.com}|g" \
  -e "s|{{MAIL_DOMAIN}}|${MAIL_DOMAIN:-example.com}|g" \
  -e "s|{{SMTP_RELAY_ENTRY}}|${RELAY_ENTRY}|g" \
  -e "s|{{RELAY_DOMAINS}}|${RELAY_DOMAINS:-}|g" \
  -e "s|{{GREYLIST_RESTRICTION}}|${GREYLIST_RESTRICTION:-}|g" \
  -e "s|{{MAX_CONN_RATE}}|${MAX_CONN_RATE:-0}|g" \
  -e "s|{{MAX_MSG_RATE}}|${MAX_MSG_RATE:-0}|g" \
  -e "s|{{MAX_RCPT_RATE}}|${MAX_RCPT_RATE:-0}|g" \
  -e "s|{{MAX_CONN_COUNT}}|${MAX_CONN_COUNT:-0}|g" \
  -e "s|{{RATE_TIME_UNIT}}|${RATE_TIME_UNIT:-3600}|g" \
  /etc/postfix/main.cf.template > /etc/postfix/main.cf

chown root:root /etc/postfix/main.cf && chmod 644 /etc/postfix/main.cf

echo "[mailguard] main.cf generated:"
grep -E "^(compatibility_level|myhostname|mydomain|relayhost|relay_domains|smtpd_client)" \
  /etc/postfix/main.cf

# ── Start Postgrey if enabled ─────────────────────────────────────────────────
if [ "$GL_ENABLED" = "true" ]; then
  echo "[mailguard] Starting Postgrey (delay=${GL_DELAY}s retry=${GL_RETRY}h max_age=${GL_MAX_AGE}d)..."
  mkdir -p /var/lib/postgrey
  chown -R 102:102 /var/lib/postgrey 2>/dev/null || \
    chown -R nobody:nogroup /var/lib/postgrey 2>/dev/null || true
  chmod 750 /var/lib/postgrey

  POSTGREY_ARGS="--inet=127.0.0.1:10023 --delay=${GL_DELAY} --max-age=${GL_MAX_AGE} --retry-window=${GL_RETRY}h"
  [ "$GL_WHITELIST" = "true" ] && \
    [ -f /etc/postgrey/whitelist_clients ] && \
    POSTGREY_ARGS="$POSTGREY_ARGS --whitelist-clients=/etc/postgrey/whitelist_clients"

  postgrey $POSTGREY_ARGS &
  POSTGREY_PID=$!
  sleep 1
  if kill -0 $POSTGREY_PID 2>/dev/null; then
    echo "[mailguard] Postgrey started (pid $POSTGREY_PID)"
  else
    echo "[mailguard] WARNING: Postgrey failed to start — greylisting disabled"
  fi
else
  echo "[mailguard] Greylisting disabled."
fi

# ── Start MailGuard policy daemon on port 10030 ───────────────────────────────
echo "[mailguard] Starting policy daemon on 127.0.0.1:10030..."
MAILGUARD_API_URL="${MAILGUARD_API_URL}" \
MAILGUARD_INTERNAL_TOKEN="${MAILGUARD_INTERNAL_TOKEN}" \
  python3 /usr/local/bin/policy-check.py --server 127.0.0.1:10030 &
POLICY_PID=$!
sleep 1
if kill -0 $POLICY_PID 2>/dev/null; then
  echo "[mailguard] Policy daemon started (pid $POLICY_PID)"
else
  echo "[mailguard] WARNING: Policy daemon failed to start"
fi

# ── Restore master.cf and add custom services ─────────────────────────────────
cp /etc/postfix/master.cf.dist /etc/postfix/master.cf
chown root:root /etc/postfix/master.cf && chmod 644 /etc/postfix/master.cf

if ! grep -q "smtp-amavis" /etc/postfix/master.cf; then
  cat >> /etc/postfix/master.cf << 'MASTEREOF'

# MailGuard — Amavis content filter transport
smtp-amavis unix -  -  n  -  2  smtp
  -o smtp_data_done_timeout=1200
  -o smtp_send_xforward_command=yes
  -o disable_dns_lookups=yes
  -o max_use=20

# Amavis re-inject listener — with header_checks to log auth/spam results
0.0.0.0:10025 inet n - n - - smtpd
  -o content_filter=
  -o local_recipient_maps=
  -o relay_recipient_maps=
  -o smtpd_restriction_classes=
  -o smtpd_delay_reject=no
  -o smtpd_client_restrictions=permit_mynetworks,reject
  -o smtpd_helo_restrictions=
  -o smtpd_sender_restrictions=
  -o smtpd_recipient_restrictions=permit_mynetworks,reject
  -o mynetworks=127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
  -o strict_rfc821_envelopes=yes
  -o receive_override_options=no_unknown_recipient_checks,no_milters
  -o header_checks=pcre:/etc/postfix/maps-internal/reinject_header_checks
MASTEREOF
  echo "[mailguard] Added Amavis services to master.cf"
fi

# ── Fix spool root directory ownership ───────────────────────────────────────
chown root:root /var/spool/postfix
chmod 755       /var/spool/postfix

# ── Copy maps into internal path ──────────────────────────────────────────────
echo "[mailguard] Installing maps..."
mkdir -p /etc/postfix/maps-internal
cp /mailguard/maps/* /etc/postfix/maps-internal/ 2>/dev/null || true

# ── Ensure dynamic maps dir exists with empty starter files ──────────────────
# These are regenerated by the backend from the blocklists table whenever a
# regex_subject / regex_body rule changes. Postfix refuses to start if the
# files referenced by header_checks/body_checks are missing, so we create
# empty stubs here.
mkdir -p /etc/postfix/maps-dynamic
[ -s /etc/postfix/maps-dynamic/header_checks ] || \
  echo '# Awaiting MailGuard backend regeneration' > /etc/postfix/maps-dynamic/header_checks
[ -s /etc/postfix/maps-dynamic/body_checks ] || \
  echo '# Awaiting MailGuard backend regeneration' > /etc/postfix/maps-dynamic/body_checks
[ -s /etc/postfix/maps-dynamic/sender_whitelist ] || \
  echo '# Awaiting MailGuard backend regeneration' > /etc/postfix/maps-dynamic/sender_whitelist
chmod 644 /etc/postfix/maps-dynamic/header_checks \
          /etc/postfix/maps-dynamic/body_checks \
          /etc/postfix/maps-dynamic/sender_whitelist

# Write reinject header_checks — logs Amavis-added headers for the log shipper
cat > /etc/postfix/maps-internal/reinject_header_checks << 'HCEOF'
/^X-Spam-Score:/               WARN
/^X-Spam-Status:/              WARN
/^X-Virus-Status:/             WARN
/^Authentication-Results:/     WARN
/^ARC-Authentication-Results:/ WARN
HCEOF

# Anti-spoof map — reject external MAIL FROM using any of our own domains
# (or their subdomains). Referenced by smtpd_sender_restrictions in main.cf.
echo '# Generated from RELAY_DOMAINS — rejects outside senders forging our domains' \
  > /etc/postfix/maps-internal/own_domain_senders
for d in $(echo "${RELAY_DOMAINS:-}" | tr ',' ' '); do
  re=$(echo "$d" | sed 's/\./\\./g')
  echo "/@([^@]+\\.)?${re}\$/ REJECT 5.7.1 Spoofed sender: external hosts may not send as @${d}" \
    >> /etc/postfix/maps-internal/own_domain_senders
done

chown -R root:root /etc/postfix/maps-internal
chmod 755          /etc/postfix/maps-internal
chmod 644          /etc/postfix/maps-internal/* 2>/dev/null || true

# ── Build lmdb maps ───────────────────────────────────────────────────────────
for f in /etc/postfix/maps-internal/sender_access \
          /etc/postfix/maps-internal/recipient_access \
          /etc/postfix/maps-internal/transport \
          /etc/postfix/maps-internal/whitelist; do
  [ -f "$f" ] && postmap lmdb:"$f" && echo "[mailguard] postmap lmdb: $f"
done

# ── Copy certs ────────────────────────────────────────────────────────────────
if [ -f /certs/server.crt ] && [ -f /certs/server.key ]; then
  mkdir -p /etc/postfix/certs
  cp /certs/server.crt /etc/postfix/certs/server.crt
  cp /certs/server.key /etc/postfix/certs/server.key
  chown root:root /etc/postfix/certs/server.crt /etc/postfix/certs/server.key
  chmod 644 /etc/postfix/certs/server.crt
  chmod 600 /etc/postfix/certs/server.key
  echo "[mailguard] Certs installed."
else
  echo "[mailguard] WARNING: No certs at /certs/ — TLS disabled."
  sed -i '/smtpd_tls_cert_file\|smtpd_tls_key_file\|smtpd_tls_security_level\|smtp_tls_security_level\|smtpd_tls_auth_only\|smtpd_tls_session_cache\|smtp_tls_session_cache/d' \
    /etc/postfix/main.cf
fi

# ── Start rsyslog ─────────────────────────────────────────────────────────────
echo "[mailguard] Starting rsyslog..."
rsyslogd 2>/dev/null || true
sleep 2

# ── Run postfix check ─────────────────────────────────────────────────────────
echo "[mailguard] Running postfix check..."
postfix check 2>&1 || true

# ── Fix public dir ownership ──────────────────────────────────────────────────
chown postfix:postdrop /var/spool/postfix/public 2>/dev/null || true
chmod 710              /var/spool/postfix/public 2>/dev/null || true

# ── Start Postfix ─────────────────────────────────────────────────────────────
echo "[mailguard] Starting Postfix..."
/usr/lib/postfix/sbin/master -c /etc/postfix 2>&1 &
MASTER_PID=$!
sleep 3

if kill -0 $MASTER_PID 2>/dev/null; then
  echo "[mailguard] Postfix master running (pid $MASTER_PID)"
else
  echo "[mailguard] Postfix master failed to start"
  exit 1
fi

# ── Tail logs and monitor ─────────────────────────────────────────────────────
touch /var/log/mail/mail.log 2>/dev/null || true
tail -F /var/log/mail/mail.log 2>/dev/null &

echo "[mailguard] Starting log shipper..."
MAILGUARD_API_URL="${MAILGUARD_API_URL}" \
MAILGUARD_INTERNAL_TOKEN="${MAILGUARD_INTERNAL_TOKEN}" \
  /usr/local/bin/log-shipper.py &

echo "[mailguard] Monitoring Postfix master (pid $MASTER_PID)..."
wait $MASTER_PID
echo "[mailguard] Postfix master exited, shutting down."
exit 1