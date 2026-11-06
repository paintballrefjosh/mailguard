#!/usr/bin/env bash
# Test regex_subject blocklist matching via the ingest endpoint.
# Usage: bash test-regex-subject.sh

API_URL="${MAILGUARD_API_URL:-http://backend:3001}"
CONTAINER="${MAILGUARD_TEST_CONTAINER:-mailguard-postfix}"
TOKEN="${MAILGUARD_INTERNAL_TOKEN:-}"
TEST_RECIPIENT="${TEST_RECIPIENT:-user@example.com}"

if [[ -z "$TOKEN" ]]; then
  TOKEN=$(docker exec mailguard-api printenv MAILGUARD_INTERNAL_TOKEN 2>/dev/null)
fi

if [[ -z "$TOKEN" ]]; then
  echo "ERROR: MAILGUARD_INTERNAL_TOKEN not set and could not be read from container."
  exit 1
fi

# Run curl inside the container so it can reach the internal Docker network
dcurl() {
  docker exec "$CONTAINER" curl "$@"
}

run_test() {
  local desc="$1"
  local subject="$2"
  local expect="$3"   # 'block', 'quarantine', or 'allow'

  response=$(dcurl -s -X POST "$API_URL/api/events/ingest" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Token: $TOKEN" \
    -d "{
      \"sender\":        \"test@example.com\",
      \"recipient\":     \"${TEST_RECIPIENT}\",
      \"sender_ip\":     \"1.2.3.4\",
      \"sender_domain\": \"example.com\",
      \"subject\":       \"$subject\",
      \"action\":        \"allow\",
      \"size_bytes\":    1234
    }")

  # Pull inserted event ID so we can check what actually got stored
  event_id=$(echo "$response" | grep -o '"id":[0-9]*' | grep -o '[0-9]*')

  if [[ -z "$event_id" ]]; then
    echo "FAIL  [$desc] — no event_id returned. Response: $response"
    return
  fi

  # Fetch the stored event directly from DB
  db_row=$(docker exec mailguard-db mariadb -u"${DB_USER:-mailguard}" -p"${DB_PASSWORD:-mailguard}" \
    "${DB_NAME:-mailguard}" -sNe \
    "SELECT action, COALESCE(reason,'') FROM mail_events WHERE id=${event_id} LIMIT 1;" 2>/dev/null)
  stored_action=$(echo "$db_row" | awk '{print $1}')
  stored_reason=$(echo "$db_row" | cut -f2-)

  if [[ "$stored_action" == "$expect" ]]; then
    echo "PASS  [$desc]"
    echo "      subject: \"$subject\""
    echo "      action:  $stored_action"
    echo "      reason:  $stored_reason"
  else
    echo "FAIL  [$desc]"
    echo "      subject:  \"$subject\""
    echo "      expected: $expect"
    echo "      got:      $stored_action"
    echo "      reason:   $stored_reason"
  fi
  echo
}

echo "=== regex_subject blocklist test ==="
echo "API: $API_URL"
echo

# ── Should MATCH (exact case) ─────────────────────────────────────────────────
run_test "exact match"        "Verify your Trust Wallet"       "block"

# ── Should MATCH (case insensitive) ──────────────────────────────────────────
run_test "lowercase"          "verify your trust wallet"       "block"
run_test "uppercase"          "VERIFY YOUR TRUST WALLET"       "block"
run_test "mixed case"         "Verify Your TRUST wallet"       "block"

# ── Should MATCH (substring within longer subject) ───────────────────────────
run_test "substring"          "URGENT: Verify your Trust Wallet now!" "block"

# ── Should NOT match ─────────────────────────────────────────────────────────
run_test "no match"           "Your invoice is ready"          "allow"
run_test "partial word"       "Verify your bank account"       "allow"

echo "=== done ==="