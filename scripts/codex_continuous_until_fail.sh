#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MODE="${MODE:-turingos_dualbrain}"
WINDOW="${WINDOW:-20}"
CODEX_STEP_TIMEOUT_SEC="${CODEX_STEP_TIMEOUT_SEC:-1800}"
INITIAL_FRONTIER="${INITIAL_FRONTIER:-}"
STOP_FILE_SUFFIX="${STOP_FILE_SUFFIX:-}"

LOG_DIR="$ROOT_DIR/benchmarks/audits/baseline/continuous"
STAMP="$(date +%Y%m%d_%H%M%S)"
RUN_LOG="$LOG_DIR/continuous_until_fail_${STAMP}.log"
SUMMARY_JSONL="$LOG_DIR/continuous_until_fail_${STAMP}.jsonl"
SUMMARY_LATEST="$LOG_DIR/continuous_until_fail_latest.jsonl"
STATE_LATEST="$LOG_DIR/continuous_until_fail_state_latest.json"
STOP_FILE="$LOG_DIR/continuous_until_fail${STOP_FILE_SUFFIX}.stop"

mkdir -p "$LOG_DIR"
touch "$RUN_LOG" "$SUMMARY_JSONL"

log() {
  local msg="$1"
  printf '[continuous-until-fail][%s] %s\n' "$(date '+%F %T')" "$msg" | tee -a "$RUN_LOG" >&2
}

resolve_frontier_from_latest() {
  local latest="$ROOT_DIR/benchmarks/audits/baseline/million_baseline_compare_latest.json"
  if [[ ! -f "$latest" ]]; then
    echo 0
    return
  fi
  node - "$latest" "$MODE" <<'NODE'
const fs = require('fs');
const latest = process.argv[2];
const mode = process.argv[3];
try {
  const raw = JSON.parse(fs.readFileSync(latest, 'utf8'));
  const row = (raw.results || []).find((item) => item.mode === mode) ?? (raw.results || [])[0];
  if (!row) {
    console.log(0);
    process.exit(0);
  }
  const start = Number(raw.startTest || 1);
  const max = Number(raw.maxTests || 0);
  const span = Math.max(0, max - start + 1);
  const passed = Number(row.passed || 0);
  const failed = Number(row.failed || 0);
  const firstFailAt = row.firstFailAt == null ? null : Number(row.firstFailAt);
  if (failed === 0 && passed === span) {
    console.log(max);
    process.exit(0);
  }
  if (Number.isFinite(firstFailAt) && firstFailAt > 0) {
    console.log(Math.max(0, firstFailAt - 1));
    process.exit(0);
  }
  console.log(Math.max(0, start + passed - 1));
} catch {
  console.log(0);
}
NODE
}

persist_state() {
  local cycle="$1"
  local frontier="$2"
  local summary="$3"
  node - "$STATE_LATEST" "$cycle" "$frontier" "$WINDOW" "$MODE" "$summary" <<'NODE'
const fs = require('fs');
const outPath = process.argv[2];
const cycle = Number(process.argv[3]);
const frontier = Number(process.argv[4]);
const window = Number(process.argv[5]);
const mode = process.argv[6];
const summary = JSON.parse(process.argv[7]);
const payload = {
  updatedAt: new Date().toISOString(),
  cycle,
  frontier,
  window,
  mode,
  summary,
};
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
NODE
}

FRONTIER="$(resolve_frontier_from_latest)"
if [[ "$INITIAL_FRONTIER" =~ ^[0-9]+$ ]] && (( INITIAL_FRONTIER > FRONTIER )); then
  FRONTIER="$INITIAL_FRONTIER"
fi

if ! [[ "$WINDOW" =~ ^[0-9]+$ ]] || (( WINDOW <= 0 )); then
  WINDOW=20
fi

CYCLE=1
log "start mode=$MODE window=$WINDOW frontier=$FRONTIER timeout_sec=$CODEX_STEP_TIMEOUT_SEC stop_file=$STOP_FILE"

while true; do
  if [[ -f "$STOP_FILE" ]]; then
    log "stop file detected: $STOP_FILE"
    break
  fi

  START_TEST="$(( FRONTIER + 1 ))"
  END_TEST="$(( START_TEST + WINDOW - 1 ))"
  TRACE_FILE="$LOG_DIR/continuous_cycle_${STAMP}_c${CYCLE}.trace.log"
  PROMPT=$(cat <<PROMPT
You are executing one baseline benchmark cycle. Do not edit any files.
Run exactly this command:
npm run -s bench:million-baseline-compare -- --modes ${MODE} --start-test ${START_TEST} --max-tests ${END_TEST} --continue-after-fail
After command completion, stop.
PROMPT
)

  log "cycle=$CYCLE range=${START_TEST}-${END_TEST} frontier=$FRONTIER"
  if ! timeout "$CODEX_STEP_TIMEOUT_SEC" codex exec \
    --dangerously-bypass-approvals-and-sandbox \
    --skip-git-repo-check \
    -C "$ROOT_DIR" \
    "$PROMPT" >"$TRACE_FILE" 2>&1; then
    log "cycle=$CYCLE codex exec timeout/non-zero; trace=$TRACE_FILE"
  fi

  SUMMARY="$(node - "$ROOT_DIR/benchmarks/audits/baseline/million_baseline_compare_latest.json" "$MODE" "$START_TEST" "$END_TEST" <<'NODE'
const fs = require('fs');
const reportPath = process.argv[2];
const mode = process.argv[3];
const expectedStart = Number(process.argv[4]);
const expectedEnd = Number(process.argv[5]);
const out = {
  ts: new Date().toISOString(),
  status: 'ERROR',
  attempted: 0,
  passed: 0,
  failed: 1,
  firstFailAt: null,
  reason: 'report_parse_failed',
  reportPath,
};
try {
  const raw = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const row = (raw.results || []).find((item) => item.mode === mode) ?? (raw.results || [])[0];
  if (!row) {
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  }
  const rangeMismatch = Number(raw.startTest || 0) !== expectedStart || Number(raw.maxTests || 0) !== expectedEnd;
  const stampedPath = raw.stamp
    ? reportPath.replace('million_baseline_compare_latest.json', `million_baseline_compare_${raw.stamp}.json`)
    : reportPath;
  out.status = String(row.status || 'UNKNOWN');
  out.attempted = Number(row.attempted || 0);
  out.passed = Number(row.passed || 0);
  out.failed = Number(row.failed || 0);
  out.firstFailAt = row.firstFailAt == null ? null : Number(row.firstFailAt);
  out.reason = rangeMismatch
    ? `unexpected_report_range:${raw.startTest}-${raw.maxTests}`
    : (typeof row.reason === 'string' ? row.reason : '');
  out.reportPath = stampedPath;
  if (rangeMismatch) {
    out.status = 'ERROR';
    out.failed = Math.max(1, out.failed);
  }
  process.stdout.write(JSON.stringify(out));
} catch {
  process.stdout.write(JSON.stringify(out));
}
NODE
)"

  echo "$SUMMARY" >>"$SUMMARY_JSONL"
  cp "$SUMMARY_JSONL" "$SUMMARY_LATEST" || true

  METRICS="$(node - "$SUMMARY" <<'NODE'
const s = JSON.parse(process.argv[2]);
const firstFail = s.firstFailAt == null ? 0 : Number(s.firstFailAt);
console.log(`${String(s.status)}\t${Number(s.passed || 0)}\t${Number(s.failed || 0)}\t${firstFail}\t${String(s.reason || '')}\t${String(s.reportPath || '')}`);
NODE
  )"
  IFS=$'\t' read -r STATUS PASSED FAILED FIRST_FAIL REASON REPORT_PATH <<<"$METRICS"
  [[ "$PASSED" =~ ^[0-9]+$ ]] || PASSED=0
  [[ "$FAILED" =~ ^[0-9]+$ ]] || FAILED=1
  [[ "$FIRST_FAIL" =~ ^[0-9]+$ ]] || FIRST_FAIL=0
  SPAN="$(( END_TEST - START_TEST + 1 ))"

  log "cycle=$CYCLE status=$STATUS passed=$PASSED failed=$FAILED first_fail=$FIRST_FAIL report=${REPORT_PATH:-none}"
  persist_state "$CYCLE" "$FRONTIER" "$SUMMARY" || true

  if [[ "$STATUS" != "PASS" ]] || (( FAILED > 0 )) || (( PASSED < SPAN )); then
    log "stop_on_first_error cycle=$CYCLE status=$STATUS passed=$PASSED failed=$FAILED first_fail=$FIRST_FAIL reason=${REASON:-none}"
    break
  fi

  FRONTIER="$END_TEST"
  CYCLE="$(( CYCLE + 1 ))"
done

log "finished frontier=$FRONTIER summary=$SUMMARY_JSONL"
