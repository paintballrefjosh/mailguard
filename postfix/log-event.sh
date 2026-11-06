#!/bin/bash
# Called by Postfix to POST a mail event to the MailGuard backend API.
# All field values are serialized via Python to prevent JSON injection.

API_URL="${MAILGUARD_API_URL:-http://backend:3001}"
API_TOKEN="${MAILGUARD_INTERNAL_TOKEN:-}"   # was MAILGUARD_API_TOKEN — fixed

QUEUE_ID="$1"
ACTION="$2"
REASON="$3"
SENDER="$4"
RECIPIENT="$5"
SENDER_IP="$6"
SUBJECT="$7"
SIZE="$8"
SPAM_SCORE="$9"
VIRUS="${10}"
SPF="${11}"
DKIM="${12}"
DMARC="${13}"

# Build JSON safely via Python — never interpolate untrusted values into JSON strings
PAYLOAD=$(python3 - <<PYEOF
import json, sys

def nullable_str(v):
    return v if v else None

def nullable_float(v):
    try:    return float(v)
    except: return None

def nullable_int(v):
    try:    return int(v)
    except: return 0

sender  = "$SENDER"
domain  = sender.split('@')[1] if '@' in sender else ''

print(json.dumps({
    "queue_id":      nullable_str("$QUEUE_ID"),
    "action":        "$ACTION",
    "reason":        nullable_str("""$REASON"""),
    "sender":        nullable_str(sender),
    "recipient":     nullable_str("$RECIPIENT"),
    "sender_ip":     nullable_str("$SENDER_IP"),
    "sender_domain": domain or None,
    "subject":       nullable_str("""$SUBJECT"""),
    "size_bytes":    nullable_int("$SIZE"),
    "spam_score":    nullable_float("$SPAM_SCORE"),
    "virus_found":   nullable_str("$VIRUS"),
    "spf_result":    nullable_str("$SPF"),
    "dkim_result":   nullable_str("$DKIM"),
    "dmarc_result":  nullable_str("$DMARC"),
}))
PYEOF
)

if [ -z "$PAYLOAD" ]; then
  echo "[log-event] Failed to build JSON payload, skipping." >&2
  exit 0
fi

curl -sf -X POST "${API_URL}/api/events/ingest" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: ${API_TOKEN}" \
  --max-time 5 \
  -d "$PAYLOAD" || true  # never block mail delivery on logging failure