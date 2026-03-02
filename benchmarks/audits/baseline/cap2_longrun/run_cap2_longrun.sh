#!/usr/bin/env bash
set -euo pipefail

cd /home/zephryj/projects/turingos
RUN_DIR="benchmarks/audits/baseline/cap2_longrun"
STAMP="$(date +%Y%m%d_%H%M%S)"
LOG="$RUN_DIR/runner_${STAMP}.log"
STATE="$RUN_DIR/state_latest.json"
WINDOW="${WINDOW:-20}"
TARGET="${TARGET:-1000000}"
START=1

if [ -f "$STATE" ]; then
  SAVED=$(jq -r '.nextTest // 1' "$STATE" 2>/dev/null || echo 1)
  if [[ "$SAVED" =~ ^[0-9]+$ ]] && [ "$SAVED" -gt 0 ]; then
    START="$SAVED"
  fi
fi

export TURINGOS_BASELINE_TEMP_WORKER_CAP_ENABLED=true
export TURINGOS_BASELINE_TEMP_WORKER_CAP_MAX=2

echo "[cap2-longrun][$(date -Is)] launcher window=$WINDOW target=$TARGET start=$START" >> "$LOG"

while [ "$START" -le "$TARGET" ]; do
  END=$((START + WINDOW - 1))
  if [ "$END" -gt "$TARGET" ]; then
    END="$TARGET"
  fi

  echo "[cap2-longrun][$(date -Is)] run start=$START end=$END" >> "$LOG"
  npm run -s bench:million-baseline-compare -- --modes turingos_dualbrain --start-test "$START" --max-tests "$END" --continue-after-fail >> "$LOG" 2>&1 || true

  REPORT=$(ls -t benchmarks/audits/baseline/million_baseline_compare_*.json 2>/dev/null | head -n1 || true)
  if [ -n "$REPORT" ] && [ -f "$REPORT" ]; then
    ATTEMPTED=$(jq -r '([.results[] | select(.mode=="turingos_dualbrain") | .attempted] | first) // 0' "$REPORT" 2>/dev/null || echo 0)
    PASSED=$(jq -r '([.results[] | select(.mode=="turingos_dualbrain") | .passed] | first) // 0' "$REPORT" 2>/dev/null || echo 0)
    FAILED=$(jq -r '([.results[] | select(.mode=="turingos_dualbrain") | .failed] | first) // 0' "$REPORT" 2>/dev/null || echo 0)
    FIRST_FAIL=$(jq -r '([.results[] | select(.mode=="turingos_dualbrain") | .firstFailAt] | first) // "null"' "$REPORT" 2>/dev/null || echo null)
    STATUS=$(jq -r '([.results[] | select(.mode=="turingos_dualbrain") | .status] | first) // "UNKNOWN"' "$REPORT" 2>/dev/null || echo UNKNOWN)
  else
    ATTEMPTED=0
    PASSED=0
    FAILED=0
    FIRST_FAIL=null
    STATUS=ERROR
  fi

  NEXT=$((END + 1))
  jq -n \
    --arg ts "$(date -Is)" \
    --arg run_dir "$RUN_DIR" \
    --arg log "$LOG" \
    --arg state "$STATE" \
    --arg report "${REPORT:-}" \
    --arg status "$STATUS" \
    --argjson start_idx "$START" \
    --argjson end_idx "$END" \
    --argjson next_idx "$NEXT" \
    --argjson attempted "$ATTEMPTED" \
    --argjson passed "$PASSED" \
    --argjson failed "$FAILED" \
    --arg first_fail "$FIRST_FAIL" \
    '{ts:$ts,runDir:$run_dir,log:$log,state:$state,lastReport:$report,lastStatus:$status,lastStart:$start_idx,lastEnd:$end_idx,nextTest:$next_idx,lastAttempted:$attempted,lastPassed:$passed,lastFailed:$failed,lastFirstFail:$first_fail,workerCap:2}' > "$STATE"

  echo "[cap2-longrun][$(date -Is)] done start=$START end=$END attempted=$ATTEMPTED passed=$PASSED failed=$FAILED first_fail=$FIRST_FAIL status=$STATUS report=${REPORT:-none}" >> "$LOG"

  START="$NEXT"
done
