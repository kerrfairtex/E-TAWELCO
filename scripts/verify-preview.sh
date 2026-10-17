#!/usr/bin/env bash
# verify-preview.sh — check a Vercel preview deployment for Phase 2 build fix
# Usage: PREVIEW_HOST=<host> [VERCEL_BYPASS_TOKEN=<token>] bash scripts/verify-preview.sh
set -u

HOST="${PREVIEW_HOST:?PREVIEW_HOST is required (hostname only, no scheme)}"
BASE="https://${HOST}"
BYPASS_HEADER=""

if [ -n "${VERCEL_BYPASS_TOKEN:-}" ]; then
  BYPASS_HEADER="-H x-vercel-protection-bypass:****"
fi

CURL="curl -s -o /dev/null -w '%{http_code} %{time_total}s' --max-time 15"

RESULTS=()

add_result() {
  RESULTS+=("$1|$2|$3")
}

echo "=== Phase 2 preview verification against https://$HOST ==="

# a) /api/health three cold calls
echo "--- /api/health (cold x3) ---"
for i in 1 2 3; do
  OUT=$(eval "$CURL -H \"x-vercel-protection-bypass: ${VERCEL_BYPASS_TOKEN:-}\" \"$BASE/api/health\" 2>&1") || OUT="000 0.000"
  STATUS=$(echo "$OUT" | awk '{print $1}')
  TIME=$(echo "$OUT" | awk '{print $2}')
  echo "cold $i: $STATUS $TIME"
  add_result "api/health cold $i" "$STATUS" "$TIME"
done

# /api/health body check (first 200 chars, secret-scanned)
echo "--- /api/health body (first 200 chars) ---"
BODY=$(curl -s --max-time 15 -H "x-vercel-protection-bypass: ${VERCEL_BYPASS_TOKEN:-}" "$BASE/api/health" 2>&1 || true)
if echo "$BODY" | grep -qiE 'key|token|secret|password'; then
  echo "BODY REDACTED: response contains a secret-like word"
else
  echo "${BODY:0:200}"
fi

# warm calls after 60s sleep
echo "--- sleeping 60s for warm calls ---"
sleep 60
echo "--- /api/health (warm x3) ---"
for i in 1 2 3; do
  OUT=$(eval "$CURL -H \"x-vercel-protection-bypass: ${VERCEL_BYPASS_TOKEN:-}\" \"$BASE/api/health\" 2>&1") || OUT="000 0.000"
  STATUS=$(echo "$OUT" | awk '{print $1}')
  TIME=$(echo "$OUT" | awk '{print $2}')
  echo "warm $i: $STATUS $TIME"
  add_result "api/health warm $i" "$STATUS" "$TIME"
done

# b) nonexistent route
echo "--- /api/does-not-exist ---"
OUT=$(eval "$CURL -H \"x-vercel-protection-bypass: ${VERCEL_BYPASS_TOKEN:-}\" \"$BASE/api/does-not-exist\" 2>&1") || OUT="000 0.000"
STATUS=$(echo "$OUT" | awk '{print $1}')
TIME=$(echo "$OUT" | awk '{print $2}')
echo "does-not-exist: $STATUS $TIME"
add_result "api/does-not-exist" "$STATUS" "$TIME"

# c) static routes
echo "--- static routes ---"
for p in / /dashboard/ /dashboard/app.js /public-auth.js; do
  OUT=$(eval "$CURL -H \"x-vercel-protection-bypass: ${VERCEL_BYPASS_TOKEN:-}\" \"$BASE$p\" 2>&1") || OUT="000 0.000"
  STATUS=$(echo "$OUT" | awk '{print $1}')
  TIME=$(echo "$OUT" | awk '{print $2}')
  echo "$p: $STATUS $TIME"
  add_result "GET $p" "$STATUS" "$TIME"
done

# d) HEAD checks for security headers
echo "--- HEAD security headers ---"
for p in / /api/health; do
  echo "HEAD $p"
  HEADERS=$(curl -s -I --max-time 15 -H "x-vercel-protection-bypass: ${VERCEL_BYPASS_TOKEN:-}" "$BASE$p" 2>&1 || true)
  for h in strict-transport-security x-frame-options x-content-type-options referrer-policy content-security-policy-report-only cache-control; do
    VAL=$(echo "$HEADERS" | grep -i "^${h}:" | sed 's/^[^:]*: *//' | tr -d '\r')
    if [ -n "$VAL" ]; then
      echo "  $h: $VAL"
    fi
  done
done

# e) results table
echo ""
echo "=== RESULTS TABLE ==="
echo "check | status | time"
for r in "${RESULTS[@]}"; do
  CHECK=$(echo "$r" | cut -d'|' -f1)
  STATUS=$(echo "$r" | cut -d'|' -f2)
  TIME=$(echo "$r" | cut -d'|' -f3)
  echo "$CHECK | $STATUS | $TIME"
done

# f) verdict
echo ""
echo "=== VERDICT ==="
API_HEALTH_STATUSES=""
STATIC_200=true
ALL_401=true

for r in "${RESULTS[@]}"; do
  STATUS=$(echo "$r" | cut -d'|' -f2)
  if [ "$STATUS" != "401" ]; then ALL_401=false; fi
done

for r in "${RESULTS[@]}"; do
  CHECK=$(echo "$r" | cut -d'|' -f1)
  STATUS=$(echo "$r" | cut -d'|' -f2)
  if echo "$CHECK" | grep -q "api/health"; then
    API_HEALTH_STATUSES="$API_HEALTH_STATUSES $STATUS"
  fi
  if echo "$CHECK" | grep -q "^GET "; then
    if [ "$STATUS" != "200" ]; then STATIC_200=false; fi
  fi
done

if $ALL_401; then
  echo "Deployment Protection is on; use a bypass token or disable protection for this test; not a code failure"
elif echo "$API_HEALTH_STATUSES" | grep -q "504\|000"; then
  echo "timeout; this is the Phase 2 root-cause problem"
elif echo "$API_HEALTH_STATUSES" | grep -q "500"; then
  echo "read the function log"
elif echo "$API_HEALTH_STATUSES" | grep -q "404"; then
  echo "function not built; check the build log function list"
elif $STATIC_200; then
  echo "build fix verified on preview"
else
  echo "mixed results; review the table above"
fi
