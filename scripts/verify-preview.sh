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
OVERALL_PASS=true

add_result() {
  RESULTS+=("$1|$2|$3")
}

fail_check() {
  echo "FAIL: $1"
  OVERALL_PASS=false
}

echo "=== Phase 2 preview verification against https://$HOST ==="

# ---- DNS / network pre-check ----
echo "--- DNS / network pre-check ---"
if ! curl -s -o /dev/null --max-time 10 "$BASE/" >/dev/null 2>&1; then
  echo "DNS/network problem on this device: cannot reach https://$HOST/"
  exit 1
fi
echo "host reachable"

# ---- a) /api/health three cold calls ----
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
CT=$(curl -s -I --max-time 15 -H "x-vercel-protection-bypass: ${VERCEL_BYPASS_TOKEN:-}" "$BASE/api/health" 2>&1 | grep -i "^content-type:" | sed 's/^[^:]*: *//' | tr -d '\r' || true)
if echo "$CT" | grep -qi "text/html"; then
  echo "FAIL: /api/health returned Content-Type: $CT (not our function; likely Vercel protection or error page)"
  OVERALL_PASS=false
elif echo "$BODY" | grep -qiE 'key|token|secret|password'; then
  echo "BODY REDACTED: response contains a secret-like word"
else
  echo "${BODY:0:200}"
fi

# ---- warm calls after 60s sleep ----
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

# ---- b) nonexistent route MUST be 404 ----
echo "--- /api/does-not-exist ---"
OUT=$(eval "$CURL -H \"x-vercel-protection-bypass: ${VERCEL_BYPASS_TOKEN:-}\" \"$BASE/api/does-not-exist\" 2>&1") || OUT="000 0.000"
STATUS=$(echo "$OUT" | awk '{print $1}')
TIME=$(echo "$OUT" | awk '{print $2}')
CT2=$(curl -s -I --max-time 15 -H "x-vercel-protection-bypass: ${VERCEL_BYPASS_TOKEN:-}" "$BASE/api/does-not-exist" 2>&1 | grep -i "^content-type:" | sed 's/^[^:]*: *//' | tr -d '\r' || true)
echo "does-not-exist: $STATUS $TIME"
add_result "api/does-not-exist" "$STATUS" "$TIME"

if [ "$STATUS" != "404" ]; then
  fail_check "/api/does-not-exist returned $STATUS, expected 404"
fi
if echo "$CT2" | grep -qi "text/html"; then
  echo "FAIL: /api/does-not-exist returned Content-Type: $CT2 (not our function; likely Vercel protection or error page)"
  OVERALL_PASS=false
fi

# ---- c) static routes ----
echo "--- static routes ---"
for p in / /dashboard/ /dashboard/app.js /public-auth.js; do
  OUT=$(eval "$CURL -H \"x-vercel-protection-bypass: ${VERCEL_BYPASS_TOKEN:-}\" \"$BASE$p\" 2>&1") || OUT="000 0.000"
  STATUS=$(echo "$OUT" | awk '{print $1}')
  TIME=$(echo "$OUT" | awk '{print $2}')
  echo "$p: $STATUS $TIME"
  add_result "GET $p" "$STATUS" "$TIME"
done

# ---- d) HEAD checks for security headers ----
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

# ---- e) results table ----
echo ""
echo "=== RESULTS TABLE ==="
echo "check | status | time"
for r in "${RESULTS[@]}"; do
  CHECK=$(echo "$r" | cut -d'|' -f1)
  STATUS=$(echo "$r" | cut -d'|' -f2)
  TIME=$(echo "$r" | cut -d'|' -f3)
  echo "$CHECK | $STATUS | $TIME"
done

# ---- f) verdict ----
echo ""
echo "=== VERDICT ==="
if ! $OVERALL_PASS; then
  echo "FAIL: one or more checks failed"
  exit 1
fi

API_HEALTH_STATUSES=""
STATIC_200=true

for r in "${RESULTS[@]}"; do
  STATUS=$(echo "$r" | cut -d'|' -f2)
  if echo "$r" | grep -q "api/health"; then
    API_HEALTH_STATUSES="$API_HEALTH_STATUSES $STATUS"
  fi
  if echo "$r" | grep -q "^GET "; then
    if [ "$STATUS" != "200" ]; then STATIC_200=false; fi
  fi
done

if echo "$API_HEALTH_STATUSES" | grep -q "504\|000"; then
  echo "timeout; this is the Phase 2 root-cause problem"
  exit 1
elif echo "$API_HEALTH_STATUSES" | grep -q "500"; then
  echo "read the function log"
  exit 1
elif echo "$API_HEALTH_STATUSES" | grep -q "404"; then
  echo "function not built; check the build log function list"
  exit 1
elif $STATIC_200; then
  echo "build fix verified on preview"
else
  echo "mixed results; review the table above"
  exit 1
fi
