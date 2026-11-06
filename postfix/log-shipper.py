#!/usr/bin/env python3
"""
MailGuard Log Shipper — tails Postfix mail log and ships events to backend API.

Flow:
  1. Postfix smtpd accepts inbound message        → queue entry created (ORIG_QID)
  2. Postfix smtp hands off to Amavis on 10024:
       ORIG_QID: relay=amavis:10024 status=sent (... queued as REINJECT_QID)
     → extract REINJECT_QID, map orig→reinject
  3. Postfix cleanup logs headers on REINJECT_QID → buffered immediately even
     before ACCEPT/handoff lines arrive (they all hit in the same second)
  4. postfix/relay/smtp delivers REINJECT_QID     → ship() flushes buffer + ships
"""
import os, re, time, json, urllib.request, urllib.error
import email.header, email.utils

API_URL   = os.environ.get("MAILGUARD_API_URL",        "http://backend:3001")
API_TOKEN = os.environ.get("MAILGUARD_INTERNAL_TOKEN", "")
LOG_FILE  = "/var/log/mail/mail.log"

INTERNAL_REINJECT_NETS = [
    '127.',
    '172.16.', '172.17.', '172.18.', '172.19.', '172.20.',
    '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
    '172.26.', '172.27.', '172.28.', '172.29.', '172.30.',
    '172.31.',
    '10.',
    '192.168.',
]

def is_internal(ip):
    if not ip:
        return False
    return any(ip.startswith(p) for p in INTERNAL_REINJECT_NETS)

# ── Regexes ───────────────────────────────────────────────────────────────────

RE_REJECT_HELO = re.compile(
    r'postfix/smtpd\[\d+\]: NOQUEUE: reject: (?:EHLO|HELO) from (\S+)\[([^\]]+)\]: '
    r'(\d{3}[^;]+);.*?helo=<([^>]*)>'
)
RE_REJECT = re.compile(
    r'postfix/smtpd\[\d+\]: NOQUEUE: reject: \S+ from (\S+)\[([^\]]+)\]: '
    r'(\d{3}[^;]+); from=<([^>]*)> to=<([^>]*)>'
)
RE_ACCEPT = re.compile(
    r'postfix/smtpd\[\d+\]: ([A-Z0-9]+): client=(\S+)\[([^\]]+)\]'
)
RE_QMGR = re.compile(
    r'postfix/qmgr\[\d+\]: ([A-Z0-9]+): from=<([^>]*)>, size=(\d+)'
)
# Match both plain headers and "warning: header X-Foo:" style logged by header_checks
RE_HEADER = re.compile(
    r'postfix/(?:cleanup|smtpd)\[\d+\]: ([A-Z0-9]+): (?:warning: header )?([\w-]+): (.+)'
)
RE_SUBJECT_WARN = re.compile(
    r'postfix/cleanup\[\d+\]: ([A-Z0-9]+): warning: header Subject: (.+?) from '
)
RE_AMAVIS_HANDOFF = re.compile(
    r'postfix/smtp\[\d+\]: ([A-Z0-9]+): .*?relay=amavis.*?status=sent.*?queued as ([A-Z0-9]+)',
    re.IGNORECASE
)
RE_SENT = re.compile(
    r'postfix/(?:relay/)?smtp\[\d+\]: ([A-Z0-9]+): '
    r'to=<([^>]*)>.*?relay=(?!amavis)(\S+).*?status=(\w+)'
)

# DATA-stage rejects/holds/warns from header_checks and body_checks.
# Format examples:
#   postfix/cleanup[123]: ABCDE: reject: header Subject: foo from host[ip]; from=<x> to=<y> proto=ESMTP helo=<z>: 5.7.1 [mailguard:rule_id=42] Subject blocked
#   postfix/cleanup[123]: ABCDE: hold:   body ... ; [mailguard:rule_id=43] Body suspicious
#   postfix/cleanup[123]: ABCDE: warning: header Subject: ... ; [mailguard:rule_id=44] Body suspicious
RE_CLEANUP_ACTION = re.compile(
    r'postfix/cleanup\[\d+\]: ([A-Z0-9]+): (reject|hold|warning):\s+(header|body)\b'
    r'.*?\[mailguard:rule_id=(\d+)\]\s*(.*)$',
    re.IGNORECASE
)

# End-of-DATA reject from the MailGuard compound-rule milter. Tagged with
# crule_id (rules table) rather than rule_id (blocklists table). Postfix logs
# it via cleanup (with a queue id) or smtpd (NOQUEUE). Example:
#   postfix/cleanup[12]: ABCDE: milter-reject: END-OF-MESSAGE from h[ip]: 5.7.1 [mailguard:crule_id=6] Gmail sub spam; from=<x> to=<y> proto=ESMTP helo=<z>
RE_MILTER_REJECT = re.compile(
    r'postfix/(?:cleanup|smtpd)\[\d+\]: (?:([A-Z0-9]+)|NOQUEUE): milter-reject: '
    r'\S+ from (\S+)\[([^\]]+)\]:.*?\[mailguard:crule_id=(\d+)\]\s*([^;]*)',
    re.IGNORECASE
)
# Envelope from/to are appended after the reject text (followed by proto=/helo=).
RE_FROMTO = re.compile(r'from=<([^>]*)>\s+to=<([^>]*)>')

# Policy-service (blocklists table) reject/hold tag appended to the SMTP reply.
RE_BL_TAG = re.compile(r'\s*\[mailguard:bl_id=(\d+)\]')

def split_bl_tag(text):
    """Return (text without the bl_id tag, blocklist id or None)."""
    m = RE_BL_TAG.search(text)
    if not m:
        return text, None
    return RE_BL_TAG.sub('', text), int(m.group(1))

# Strips the trailing "from host[ip]; from=<> to=<> proto=ESMTP helo=<>" that
# Postfix appends to warning: header log lines.
HEADER_SUFFIX_RE = re.compile(
    r'\s+from\s+\S+\[[\d\.]+\].*$', re.IGNORECASE
)

# Auth from Authentication-Results header (fallback)
RE_SPF   = re.compile(r'(?:SPF|spf)[= ](pass|fail|softfail|neutral|none)', re.I)
RE_DKIM  = re.compile(r'dkim=(\w+)', re.I)
RE_DMARC = re.compile(r'dmarc=(\w+)', re.I)

# ── Helpers ───────────────────────────────────────────────────────────────────

def strip_header_suffix(val):
    """Remove the Postfix routing trailer from warning: header log lines."""
    return HEADER_SUFFIX_RE.sub('', val).strip()

def decode_subject(raw):
    """
    Decode RFC 2047 encoded-word subject headers.
    e.g. "=?UTF-8?B?U2tpcA==?= =?UTF-8?B?dGVzdA==?=" -> "Skip test"
    Falls back to the raw string if decoding fails.
    """
    if not raw or '=?' not in raw:
        return raw
    try:
        parts = email.header.decode_header(raw)
        decoded = []
        for chunk, charset in parts:
            if isinstance(chunk, bytes):
                decoded.append(chunk.decode(charset or 'utf-8', errors='replace'))
            else:
                decoded.append(chunk)
        return ''.join(decoded)
    except Exception:
        return raw

# ── State ─────────────────────────────────────────────────────────────────────

queue              = {}   # orig_qid  -> event dict
reinject_to_orig   = {}   # reinject_qid -> orig_qid
reinject_header_buffer = {}  # reinject_qid -> partial fields (buffered before mapping)

QUEUE_TTL      = 3600
HELO_DEDUP_TTL = 10
helo_reject_seen = {}

def evict_stale():
    now = time.time()
    stale = [k for k, v in queue.items() if now - v.get('_ts', now) > QUEUE_TTL]
    for k in stale:
        del queue[k]
    stale_r = [k for k in list(reinject_to_orig) if reinject_to_orig[k] not in queue]
    for k in stale_r:
        del reinject_to_orig[k]
    stale_h = [k for k, v in helo_reject_seen.items() if now - v > HELO_DEDUP_TTL * 10]
    for k in stale_h:
        del helo_reject_seen[k]
    stale_b = [k for k, v in reinject_header_buffer.items() if now - v.get('_ts', now) > 60]
    for k in stale_b:
        del reinject_header_buffer[k]

# ── Auth parsing from SpamAssassin test names ─────────────────────────────────

def parse_auth_from_sa_tests(tests_str, ev):
    """Extract SPF/DKIM/DMARC from SA rule names in X-Spam-Status tests= field."""
    tests = tests_str.upper()
    if 'DKIM_VALID' in tests and 'DKIM_INVALID' not in tests:
        ev['dkim_result'] = 'pass'
    elif 'DKIM_INVALID' in tests or 'DKIM_ADSP_NXDOMAIN' in tests:
        ev['dkim_result'] = 'fail'
    elif 'DKIM_SIGNED' in tests and 'dkim_result' not in ev:
        ev['dkim_result'] = 'none'
    if 'SPF_PASS' in tests:
        ev['spf_result'] = 'pass'
    elif 'SPF_FAIL' in tests:
        ev['spf_result'] = 'fail'
    elif 'SPF_SOFTFAIL' in tests:
        ev['spf_result'] = 'softfail'
    elif 'SPF_NEUTRAL' in tests:
        ev['spf_result'] = 'neutral'
    elif 'SPF_NONE' in tests or 'SPF_HELO_NONE' in tests:
        ev['spf_result'] = 'none'
    if 'DMARC_PASS' in tests:
        ev['dmarc_result'] = 'pass'
    elif 'DMARC_FAIL' in tests:
        ev['dmarc_result'] = 'fail'
    elif 'DMARC_NONE' in tests:
        ev['dmarc_result'] = 'none'

# ── HTTP ──────────────────────────────────────────────────────────────────────

def post_event(event):
    payload = json.dumps(event).encode()
    req = urllib.request.Request(
        f"{API_URL}/api/events/ingest",
        data=payload,
        headers={"Content-Type": "application/json", "X-Internal-Token": API_TOKEN},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=5):
            pass
    except Exception as e:
        print(f"[shipper] API error: {e}", flush=True)

def post_rule_hit(rule_id, source=None):
    """Increment hits on a rule that fired. source='rules' targets the rules
    table (compound milter rules); default targets the blocklists table."""
    body = {"rule_id": int(rule_id)}
    if source:
        body["source"] = source
    payload = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{API_URL}/api/events/rule-hit",
        data=payload,
        headers={"Content-Type": "application/json", "X-Internal-Token": API_TOKEN},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=5):
            pass
    except Exception as e:
        print(f"[shipper] rule-hit error: {e}", flush=True)

def ship(orig_qid, recipient, status):
    ev = queue.pop(orig_qid, None)
    if not ev:
        return
    action = 'allow' if status == 'sent' else 'flag'

    # Last-chance flush: find buffered headers for the reinject QID that maps
    # to this orig_qid and merge them in before shipping.
    for reinject_qid, buf in list(reinject_header_buffer.items()):
        if reinject_to_orig.get(reinject_qid) == orig_qid:
            for field in ('spf_result', 'dkim_result', 'dmarc_result',
                          'spam_score', 'virus_found', 'subject'):
                if field in buf and field not in ev:
                    ev[field] = buf[field]
            # Also flush buffered raw headers
            if 'headers' in buf:
                if 'headers' not in ev:
                    ev['headers'] = {}
                ev['headers'].update(buf['headers'])
            del reinject_header_buffer[reinject_qid]
            break

    post_event({
        "queue_id":      orig_qid,
        "action":        action,
        "reason":        f"delivery status: {status}",
        "rule_id":       ev.get("rule_id"),
        "rule_source":   ev.get("rule_source"),
        "sender":        ev.get("sender"),
        "recipient":     recipient,
        "sender_ip":     ev.get("sender_ip"),
        "sender_domain": ev.get("sender_domain"),
        "from_header":   ev.get("from_header"),
        "subject":       ev.get("subject"),
        "headers":       ev.get("headers") or None,
        "size_bytes":    ev.get("size_bytes", 0),
        "spam_score":    ev.get("spam_score"),
        "virus_found":   ev.get("virus_found"),
        "spf_result":    ev.get("spf_result"),
        "dkim_result":   ev.get("dkim_result"),
        "dmarc_result":  ev.get("dmarc_result"),
    })

# ── Parser ────────────────────────────────────────────────────────────────────

def parse_line(line):

    # ── DATA-stage reject / hold / warn from header_checks / body_checks ─────
    # Must run before RE_HEADER, which would otherwise eat the reject line.
    m = RE_CLEANUP_ACTION.search(line)
    if m:
        qid, verb, where, rule_id, reason = m.groups()
        verb = verb.lower()
        action = {'reject': 'block', 'hold': 'quarantine',
                  'warning': 'flag'}.get(verb)
        post_rule_hit(rule_id)
        if action == 'flag':
            # Mark in-flight; the regular ship() path on final delivery wins.
            ev = queue.get(qid)
            if ev is not None:
                ev['action'] = 'flag'
                ev['reason'] = (reason or where).strip()[:512]
                ev['rule_id'] = int(rule_id)
                ev['rule_source'] = 'blocklist'
            return
        # block / quarantine: message is discarded or parked. Final delivery
        # line won't fire, so ship the event from here.
        ev = queue.pop(qid, None) or {}
        post_event({
            "queue_id":      qid,
            "action":        action,
            "reason":        (reason or where).strip()[:512],
            "rule_id":       int(rule_id),
            "rule_source":   "blocklist",
            "sender":        ev.get("sender"),
            "recipient":     ev.get("recipient"),
            "sender_ip":     ev.get("sender_ip"),
            "sender_domain": ev.get("sender_domain"),
            "from_header":   ev.get("from_header"),
            "subject":       ev.get("subject"),
            "headers":       ev.get("headers") or None,
            "size_bytes":    ev.get("size_bytes", 0),
        })
        return

    # ── Compound-rule milter reject (end-of-DATA, from the rules table) ───────
    m = RE_MILTER_REJECT.search(line)
    if m:
        qid, hostname, sender_ip, crule_id, reason = m.groups()
        ft = RE_FROMTO.search(line)
        sender    = ft.group(1) if ft else None
        recipient = ft.group(2) if ft else None
        post_rule_hit(crule_id, source='rules')
        ev = queue.pop(qid, None) if qid else None
        ev = ev or {}
        sender = sender or ev.get("sender")
        sender_domain = ev.get("sender_domain")
        if not sender_domain and sender and '@' in sender:
            sender_domain = sender.split('@', 1)[1]
        post_event({
            "queue_id":      qid,
            "action":        "block",
            "reason":        (reason or "Compound rule").strip()[:512],
            "rule_id":       int(crule_id),
            "rule_source":   "rule",
            "sender":        sender,
            "recipient":     recipient or ev.get("recipient"),
            "sender_ip":     sender_ip or ev.get("sender_ip"),
            "sender_domain": sender_domain,
            "from_header":   ev.get("from_header"),
            "subject":       ev.get("subject"),
            "headers":       ev.get("headers") or None,
            "size_bytes":    ev.get("size_bytes", 0),
        })
        return

    # ── HELO/EHLO rejection ───────────────────────────────────────────────────
    m = RE_REJECT_HELO.search(line)
    if m:
        hostname, sender_ip, reason_raw, helo_name = m.groups()
        if is_internal(sender_ip):
            return
        now = time.time()
        if now - helo_reject_seen.get(sender_ip, 0) < HELO_DEDUP_TTL:
            return
        helo_reject_seen[sender_ip] = now
        reason_raw, bl_id = split_bl_tag(reason_raw)
        rm = re.match(r'\d{3}[\s\d.]*<[^>]*>: (.+)', reason_raw)
        reason = rm.group(1) if rm else reason_raw
        post_event({
            "action":        "block",
            "reason":        reason[:512],
            "rule_id":       bl_id,
            "rule_source":   "blocklist" if bl_id else None,
            "sender":        f"Blocked HELO: {helo_name}",
            "sender_ip":     sender_ip,
            "sender_domain": helo_name,
        })
        return

    # ── Subject warning ───────────────────────────────────────────────────────
    m = RE_SUBJECT_WARN.search(line)
    if m:
        qid, subject = m.groups()
        if qid in queue:
            queue[qid]['subject'] = decode_subject(subject.strip())
        return

    # ── RCPT rejection ────────────────────────────────────────────────────────
    m = RE_REJECT.search(line)
    if m:
        hostname, sender_ip, reason_raw, sender, recipient = m.groups()
        if is_internal(sender_ip):
            return
        reason_raw, bl_id = split_bl_tag(reason_raw)
        rm = re.match(r'\d{3}[\s\d.]*<[^>]*>: (.+)', reason_raw)
        reason = rm.group(1) if rm else reason_raw
        action = 'greylist' if 'greylist' in reason.lower() else 'block'
        post_event({
            "action":        action,
            "reason":        reason[:512],
            "rule_id":       bl_id,
            "rule_source":   "blocklist" if bl_id else None,
            "sender":        sender,
            "recipient":     recipient,
            "sender_ip":     sender_ip,
            "sender_domain": sender.split('@')[1] if '@' in sender else '',
        })
        return

    # ── Amavis handoff — extract reinject QID ────────────────────────────────
    m = RE_AMAVIS_HANDOFF.search(line)
    if m:
        orig_qid, reinject_qid = m.group(1), m.group(2)
        reinject_to_orig[reinject_qid] = orig_qid
        if orig_qid in queue:
            queue[orig_qid]['_amavis_pending'] = True
        print(f"[shipper] Mapped {orig_qid} -> {reinject_qid}", flush=True)

        # Flush headers buffered before this mapping arrived
        if reinject_qid in reinject_header_buffer:
            buf = reinject_header_buffer.pop(reinject_qid)
            orig = queue.get(orig_qid)
            if orig:
                for field in ('spf_result', 'dkim_result', 'dmarc_result',
                              'spam_score', 'virus_found', 'subject', 'from_header'):
                    if field in buf and field not in orig:
                        orig[field] = buf[field]
                # Flush buffered raw headers
                if 'headers' in buf:
                    if 'headers' not in orig:
                        orig['headers'] = {}
                    orig['headers'].update(buf['headers'])

        # Update _orig on reinject entry if already ACCEPT'd
        if reinject_qid in queue:
            queue[reinject_qid]['_orig'] = orig_qid
        return

    # ── New connection accepted ───────────────────────────────────────────────
    m = RE_ACCEPT.search(line)
    if m:
        qid, hostname, sender_ip = m.groups()
        if qid == 'NOQUEUE':
            return
        if is_internal(sender_ip):
            orig_qid = reinject_to_orig.get(qid)
            queue[qid] = {'_reinject': True, '_orig': orig_qid, '_ts': time.time()}
            # Flush headers buffered before this ACCEPT arrived
            if orig_qid and orig_qid in queue and qid in reinject_header_buffer:
                buf = reinject_header_buffer.pop(qid)
                orig = queue[orig_qid]
                for field in ('spf_result', 'dkim_result', 'dmarc_result',
                              'spam_score', 'virus_found', 'subject', 'from_header'):
                    if field in buf and field not in orig:
                        orig[field] = buf[field]
                if 'headers' in buf:
                    if 'headers' not in orig:
                        orig['headers'] = {}
                    orig['headers'].update(buf['headers'])
        else:
            queue[qid] = {
                'sender_ip': sender_ip,
                'hostname':  hostname,
                'headers':   {},
                '_ts':       time.time(),
            }
        return

    # ── Queue manager ─────────────────────────────────────────────────────────
    m = RE_QMGR.search(line)
    if m:
        qid, sender, size = m.groups()
        if qid not in queue:
            return
        ev = queue[qid]
        if ev.get('_reinject'):
            if not ev.get('_orig'):
                ev['_orig'] = reinject_to_orig.get(qid)
        else:
            ev.update({
                'sender':        sender,
                'size_bytes':    int(size),
                'sender_domain': sender.split('@')[1] if '@' in sender else '',
            })
        return

    # ── Headers ───────────────────────────────────────────────────────────────
    m = RE_HEADER.search(line)
    if m:
        qid, hname, hval = m.groups()
        hname_lo  = hname.lower()
        clean_val = strip_header_suffix(hval.strip())

        is_auth        = 'authentication-results' in hname_lo or \
                         'arc-authentication-results' in hname_lo
        is_spam_score  = 'x-spam-score'  in hname_lo
        is_spam_status = 'x-spam-status' in hname_lo
        is_virus       = 'x-virus-status' in hname_lo
        is_subject     = 'subject'        in hname_lo
        is_from        = hname_lo == 'from'

        def apply_fields(target):
            if is_from:
                _, addr = email.utils.parseaddr(clean_val)
                target['from_header'] = addr.lower() if addr else clean_val.lower()
            if is_auth:
                sm = RE_SPF.search(clean_val)
                if sm: target['spf_result']  = sm.group(1).lower()
                dm = RE_DKIM.search(clean_val)
                if dm: target['dkim_result'] = dm.group(1).lower()
                mm = RE_DMARC.search(clean_val)
                if mm: target['dmarc_result'] = mm.group(1).lower()
            if is_spam_score:
                try: target['spam_score'] = float(clean_val)
                except ValueError: pass
            if is_spam_status:
                score_m = re.search(r'score=([\d.+-]+)', clean_val, re.I)
                if score_m and 'spam_score' not in target:
                    try: target['spam_score'] = float(score_m.group(1))
                    except ValueError: pass
                tests_m = re.search(r'tests=\[?([^\]]+)', clean_val, re.I)
                if tests_m:
                    parse_auth_from_sa_tests(tests_m.group(1), target)
            if is_virus:
                if clean_val.lower() not in ('clean', 'ok', ''):
                    target['virus_found'] = clean_val
            if is_subject and not target.get('subject'):
                target['subject'] = decode_subject(clean_val)

        if qid not in queue:
            # QID not tracked yet — buffer in case reinject ACCEPT/handoff
            # lines haven't arrived yet
            if is_auth or is_spam_score or is_spam_status or is_virus or is_subject or is_from:
                if qid not in reinject_header_buffer:
                    reinject_header_buffer[qid] = {'_ts': time.time()}
                buf = reinject_header_buffer[qid]
                apply_fields(buf)
                # Also store raw header in buffer
                if 'headers' not in buf:
                    buf['headers'] = {}
                buf['headers'][hname_lo] = clean_val
            return

        ev = queue[qid]

        if ev.get('_reinject'):
            # Merge into the original event
            orig_qid = ev.get('_orig') or reinject_to_orig.get(qid)
            if orig_qid:
                ev['_orig'] = orig_qid
            target = queue.get(orig_qid)
            if target is None:
                # Original not tracked yet — buffer
                if qid not in reinject_header_buffer:
                    reinject_header_buffer[qid] = {'_ts': time.time()}
                buf = reinject_header_buffer[qid]
                apply_fields(buf)
                if 'headers' not in buf:
                    buf['headers'] = {}
                buf['headers'][hname_lo] = clean_val
            else:
                # Store raw header on original event
                if 'headers' not in target:
                    target['headers'] = {}
                target['headers'][hname_lo] = clean_val
                apply_fields(target)
        else:
            # Regular inbound — store all headers and apply auth fields
            if 'headers' not in ev:
                ev['headers'] = {}
            ev['headers'][hname_lo] = clean_val
            apply_fields(ev)
        return

    # ── Final delivery ────────────────────────────────────────────────────────
    m = RE_SENT.search(line)
    if m:
        qid, recipient, relay, status = m.groups()
        if qid not in queue:
            return
        ev = queue[qid]

        if ev.get('_reinject'):
            orig_qid = ev.get('_orig') or reinject_to_orig.get(qid)
            queue.pop(qid, None)
            reinject_to_orig.pop(qid, None)
            if orig_qid:
                ship(orig_qid, recipient, status)
        elif ev.get('_amavis_pending'):
            print(f"[shipper] Unexpected: {qid} delivered while amavis_pending", flush=True)
            queue.pop(qid, None)
        else:
            ship(qid, recipient, status)
        return

# ── Tailer ────────────────────────────────────────────────────────────────────

def tail(filepath):
    while not os.path.exists(filepath):
        print(f"[shipper] Waiting for {filepath}...", flush=True)
        time.sleep(2)
    with open(filepath, 'r') as f:
        f.seek(0, 2)
        print(f"[shipper] Tailing {filepath}", flush=True)
        last_evict = time.time()
        while True:
            line = f.readline()
            if line:
                try:
                    parse_line(line.strip())
                except Exception as e:
                    print(f"[shipper] Parse error: {e}", flush=True)
            else:
                if time.time() - last_evict > 300:
                    evict_stale()
                    last_evict = time.time()
                try:
                    if os.stat(filepath).st_ino != os.fstat(f.fileno()).st_ino:
                        print("[shipper] Log rotated, reopening...", flush=True)
                        return
                except OSError:
                    pass
                time.sleep(0.2)

def main():
    print(f"[shipper] Starting. API={API_URL}", flush=True)
    while True:
        try:
            tail(LOG_FILE)
        except Exception as e:
            print(f"[shipper] Error: {e}, retrying...", flush=True)
            time.sleep(5)

if __name__ == "__main__":
    main()