#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MODE="${MODE:-turingos_dualbrain}"
INITIAL_FRONTIER="${INITIAL_FRONTIER:-}"
WINDOW_MIN="${WINDOW_MIN:-20}"
WINDOW_MAX="${WINDOW_MAX:-320}"
WINDOW="${WINDOW:-20}"
BACKTRACK="${BACKTRACK:-3}"
MAX_DEBUG_ATTEMPTS_PER_FAIL="${MAX_DEBUG_ATTEMPTS_PER_FAIL:-3}"
MAX_BLOCKER_REPEATS="${MAX_BLOCKER_REPEATS:-3}"
CODEX_BENCH_TIMEOUT_SEC="${CODEX_BENCH_TIMEOUT_SEC:-1800}"
CODEX_DEBUG_TIMEOUT_SEC="${CODEX_DEBUG_TIMEOUT_SEC:-2400}"
SLEEP_BETWEEN_CYCLES_SEC="${SLEEP_BETWEEN_CYCLES_SEC:-2}"
STOP_FILE_SUFFIX="${STOP_FILE_SUFFIX:-}"

LOG_DIR="$ROOT_DIR/benchmarks/audits/baseline/relentless"
STAMP="$(date +%Y%m%d_%H%M%S)"
RUN_LOG="$LOG_DIR/relentless_push_${STAMP}.log"
SUMMARY_JSONL="$LOG_DIR/relentless_summary_${STAMP}.jsonl"
SUMMARY_LATEST="$LOG_DIR/relentless_summary_latest.jsonl"
STATE_LATEST="$LOG_DIR/relentless_state_latest.json"
BLOCKER_MD="$LOG_DIR/relentless_blocker_${STAMP}.md"
STOP_FILE="$LOG_DIR/relentless_push${STOP_FILE_SUFFIX}.stop"

mkdir -p "$LOG_DIR"
touch "$RUN_LOG" "$SUMMARY_JSONL"

log() {
  local msg="$1"
  printf '[relentless-push][%s] %s\n' "$(date '+%F %T')" "$msg" | tee -a "$RUN_LOG" >&2
}

cleanup_baseline_processes() {
  pkill -f "src/bench/million-baseline-compare.ts --modes ${MODE}" || true
  pkill -f "npm run bench:million-baseline-compare --modes ${MODE}" || true
  pkill -f "codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C ${ROOT_DIR} You are executing one baseline benchmark cycle" || true
}

kill_repo_bench_processes() {
  pkill -f "src/bench/million-baseline-compare.ts --modes ${MODE}" || true
  pkill -f "npm run bench:million-baseline-compare --modes ${MODE}" || true
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
  const passed = Number(row.passed || 0);
  const failed = Number(row.failed || 0);
  const firstFailAt = row.firstFailAt == null ? null : Number(row.firstFailAt);
  const span = Math.max(0, max - start + 1);
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

max_int() {
  if (( $1 > $2 )); then
    echo "$1"
  else
    echo "$2"
  fi
}

min_int() {
  if (( $1 < $2 )); then
    echo "$1"
  else
    echo "$2"
  fi
}

run_codex_prompt() {
  local timeout_sec="$1"
  local trace_file="$2"
  local prompt="$3"
  if ! timeout "$timeout_sec" codex exec \
    --dangerously-bypass-approvals-and-sandbox \
    --skip-git-repo-check \
    -C "$ROOT_DIR" \
    "$prompt" >"$trace_file" 2>&1; then
    return 1
  fi
  return 0
}

parse_latest_report_for_range() {
  local expected_start="$1"
  local expected_end="$2"
  local kind="$3"
  local cycle="$4"
  local attempt="$5"
  node - "$ROOT_DIR/benchmarks/audits/baseline/million_baseline_compare_latest.json" "$MODE" "$expected_start" "$expected_end" "$kind" "$cycle" "$attempt" <<'NODE'
const fs = require('fs');
const reportPath = process.argv[2];
const mode = process.argv[3];
const expectedStart = Number(process.argv[4]);
const expectedEnd = Number(process.argv[5]);
const kind = process.argv[6];
const cycle = Number(process.argv[7]);
const attempt = Number(process.argv[8]);
  const out = {
  ts: new Date().toISOString(),
  kind,
  cycle,
  attempt,
  mode,
  startTest: expectedStart,
  endTest: expectedEnd,
  status: 'ERROR',
  attempted: 0,
  passed: 0,
  failed: 1,
  firstFailAt: null,
  reason: 'report_parse_failed',
  firstFailArtifact: null,
  reportPath,
};
try {
  const raw = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const row = (raw.results || []).find((item) => item.mode === mode) ?? (raw.results || [])[0];
  if (!row) {
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  }
  const gotStart = Number(raw.startTest || 0);
  const gotEnd = Number(raw.maxTests || 0);
  const rangeMismatch = gotStart !== expectedStart || gotEnd !== expectedEnd;
  const stampedPath = raw.stamp
    ? reportPath.replace('million_baseline_compare_latest.json', `million_baseline_compare_${raw.stamp}.json`)
    : reportPath;
  out.status = rangeMismatch ? 'ERROR' : String(row.status || 'UNKNOWN');
  out.attempted = rangeMismatch ? 0 : Number(row.attempted || 0);
  out.passed = rangeMismatch ? 0 : Number(row.passed || 0);
  out.failed = rangeMismatch ? 1 : Number(row.failed || 0);
  out.firstFailAt = rangeMismatch ? expectedStart : (row.firstFailAt == null ? null : Number(row.firstFailAt));
  out.reason = rangeMismatch
    ? `unexpected_report_range:${gotStart}-${gotEnd}`
    : (typeof row.reason === 'string' ? row.reason : '');
  out.firstFailArtifact = typeof row.firstFailArtifact === 'string' ? row.firstFailArtifact : null;
  out.reportPath = stampedPath;
  if (rangeMismatch && out.failed === 0) {
    out.failed = 1;
  }
  process.stdout.write(JSON.stringify(out));
} catch {
  process.stdout.write(JSON.stringify(out));
}
NODE
}

summary_metrics() {
  local summary="$1"
  node - "$summary" <<'NODE'
const s = JSON.parse(process.argv[2]);
const firstFail = s.firstFailAt == null ? 0 : Number(s.firstFailAt);
const artifact = typeof s.firstFailArtifact === 'string' ? s.firstFailArtifact : '';
const reason = typeof s.reason === 'string' ? s.reason : '';
console.log(`${String(s.status)}\t${Number(s.passed || 0)}\t${Number(s.failed || 0)}\t${firstFail}\t${artifact}\t${reason}\t${String(s.reportPath || '')}`);
NODE
}

persist_state() {
  local cycle="$1"
  local frontier="$2"
  local window="$3"
  local blocker_fail="$4"
  local blocker_repeats="$5"
  local last_summary="$6"
  node - "$STATE_LATEST" "$cycle" "$frontier" "$window" "$blocker_fail" "$blocker_repeats" "$last_summary" <<'NODE'
const fs = require('fs');
const outPath = process.argv[2];
const state = {
  updatedAt: new Date().toISOString(),
  cycle: Number(process.argv[3]),
  frontier: Number(process.argv[4]),
  window: Number(process.argv[5]),
  blockerFailAt: Number(process.argv[6] || 0),
  blockerRepeats: Number(process.argv[7] || 0),
  lastSummary: JSON.parse(process.argv[8]),
};
fs.writeFileSync(outPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
NODE
}

write_blocker_report() {
  local fail_at="$1"
  local repeats="$2"
  local reason="$3"
  node - "$SUMMARY_JSONL" "$BLOCKER_MD" "$fail_at" "$repeats" "$reason" "$RUN_LOG" "$STATE_LATEST" <<'NODE'
const fs = require('fs');
const summaryPath = process.argv[2];
const outPath = process.argv[3];
const failAt = Number(process.argv[4] || 0);
const repeats = Number(process.argv[5] || 0);
const reason = process.argv[6] || '';
const runLog = process.argv[7];
const statePath = process.argv[8];
const lines = fs.existsSync(summaryPath)
  ? fs.readFileSync(summaryPath, 'utf8').trim().split('\n').filter(Boolean)
  : [];
const tail = lines.slice(-12).map((line) => {
  try {
    const s = JSON.parse(line);
    return `- ${s.ts} kind=${s.kind} cycle=${s.cycle} attempt=${s.attempt} range=${s.startTest}-${s.endTest} status=${s.status} passed=${s.passed} failed=${s.failed} firstFailAt=${s.firstFailAt ?? 'null'} reason=${s.reason || ''} artifact=${s.firstFailArtifact || ''}`;
  } catch {
    return `- ${line}`;
  }
});
const body = [
  '# Relentless Push Blocker Report',
  '',
  `- generated_at: ${new Date().toISOString()}`,
  `- blocker_case: ${failAt}`,
  `- blocker_repeats: ${repeats}`,
  `- stop_reason: ${reason}`,
  `- summary_jsonl: ${summaryPath}`,
  `- run_log: ${runLog}`,
  `- state_json: ${statePath}`,
  '',
  '## Recent Cycles',
  ...tail,
  '',
].join('\n');
fs.writeFileSync(outPath, `${body}\n`, 'utf8');
NODE
}

if ! [[ "$WINDOW" =~ ^[0-9]+$ ]] || (( WINDOW <= 0 )); then
  WINDOW=20
fi
if ! [[ "$WINDOW_MIN" =~ ^[0-9]+$ ]] || (( WINDOW_MIN <= 0 )); then
  WINDOW_MIN=20
fi
if ! [[ "$WINDOW_MAX" =~ ^[0-9]+$ ]] || (( WINDOW_MAX < WINDOW_MIN )); then
  WINDOW_MAX=320
fi
if ! [[ "$BACKTRACK" =~ ^[0-9]+$ ]]; then
  BACKTRACK=3
fi
if ! [[ "$MAX_DEBUG_ATTEMPTS_PER_FAIL" =~ ^[0-9]+$ ]] || (( MAX_DEBUG_ATTEMPTS_PER_FAIL <= 0 )); then
  MAX_DEBUG_ATTEMPTS_PER_FAIL=3
fi
if ! [[ "$MAX_BLOCKER_REPEATS" =~ ^[0-9]+$ ]] || (( MAX_BLOCKER_REPEATS <= 0 )); then
  MAX_BLOCKER_REPEATS=3
fi

cleanup_baseline_processes
FRONTIER="$(resolve_frontier_from_latest)"
if [[ "$INITIAL_FRONTIER" =~ ^[0-9]+$ ]] && (( INITIAL_FRONTIER > FRONTIER )); then
  FRONTIER="$INITIAL_FRONTIER"
fi

WINDOW="$(max_int "$WINDOW_MIN" "$WINDOW")"
WINDOW="$(min_int "$WINDOW_MAX" "$WINDOW")"

CYCLE=1
BLOCKER_FAIL_AT=0
BLOCKER_REPEATS=0
GREEN_STREAK=0
log "start mode=$MODE frontier=$FRONTIER window=$WINDOW backtrack=$BACKTRACK max_debug_attempts=$MAX_DEBUG_ATTEMPTS_PER_FAIL max_blocker_repeats=$MAX_BLOCKER_REPEATS stop_file=$STOP_FILE"

while true; do
  if [[ -f "$STOP_FILE" ]]; then
    log "stop file detected: $STOP_FILE"
    break
  fi

  START_TEST="$(( FRONTIER + 1 ))"
  END_TEST="$(( START_TEST + WINDOW - 1 ))"
  BENCH_TRACE="$LOG_DIR/relentless_cycle_${STAMP}_c${CYCLE}_bench.trace.log"
  BENCH_PROMPT=$(cat <<PROMPT
You are executing one baseline benchmark cycle. Do not edit any files.
Run exactly this command:
npm run -s bench:million-baseline-compare -- --modes ${MODE} --start-test ${START_TEST} --max-tests ${END_TEST} --continue-after-fail
After command completion, stop.
PROMPT
)

  log "cycle=$CYCLE bench range=${START_TEST}-${END_TEST} frontier=$FRONTIER window=$WINDOW"
  if ! run_codex_prompt "$CODEX_BENCH_TIMEOUT_SEC" "$BENCH_TRACE" "$BENCH_PROMPT"; then
    log "cycle=$CYCLE bench codex exec timeout/non-zero trace=$BENCH_TRACE"
    kill_repo_bench_processes
    sleep 1
  fi

  BENCH_SUMMARY="$(parse_latest_report_for_range "$START_TEST" "$END_TEST" "bench" "$CYCLE" 0)"
  echo "$BENCH_SUMMARY" >>"$SUMMARY_JSONL"
  cp "$SUMMARY_JSONL" "$SUMMARY_LATEST" || true

  METRICS="$(summary_metrics "$BENCH_SUMMARY")"
  IFS=$'\t' read -r STATUS PASSED FAILED FIRST_FAIL ARTIFACT REASON REPORT_PATH <<<"$METRICS"
  [[ "$PASSED" =~ ^[0-9]+$ ]] || PASSED=0
  [[ "$FAILED" =~ ^[0-9]+$ ]] || FAILED=1
  [[ "$FIRST_FAIL" =~ ^[0-9]+$ ]] || FIRST_FAIL=0
  SPAN="$(( END_TEST - START_TEST + 1 ))"

  log "cycle=$CYCLE bench status=$STATUS passed=$PASSED failed=$FAILED first_fail=$FIRST_FAIL report=${REPORT_PATH:-none}"

  if [[ "$STATUS" == "PASS" ]] && (( FAILED == 0 && PASSED == SPAN )); then
    FRONTIER="$END_TEST"
    GREEN_STREAK="$(( GREEN_STREAK + 1 ))"
    BLOCKER_REPEATS=0
    BLOCKER_FAIL_AT=0
    if (( GREEN_STREAK >= 2 && WINDOW < WINDOW_MAX )); then
      WINDOW="$(( WINDOW * 2 ))"
      WINDOW="$(min_int "$WINDOW_MAX" "$WINDOW")"
      GREEN_STREAK=0
    fi
    persist_state "$CYCLE" "$FRONTIER" "$WINDOW" "$BLOCKER_FAIL_AT" "$BLOCKER_REPEATS" "$BENCH_SUMMARY" || true
    CYCLE="$(( CYCLE + 1 ))"
    sleep "$SLEEP_BETWEEN_CYCLES_SEC"
    continue
  fi

  GREEN_STREAK=0
  FAIL_AT="$FIRST_FAIL"
  if (( FAIL_AT <= 0 )); then
    FAIL_AT="$(( START_TEST + PASSED ))"
  fi
  if (( FAIL_AT <= 0 )); then
    FAIL_AT="$START_TEST"
  fi

  DEBUG_SUCCESS=0
  ATTEMPT=1
  while (( ATTEMPT <= MAX_DEBUG_ATTEMPTS_PER_FAIL )); do
    REPLAY_START="$(( FAIL_AT - BACKTRACK ))"
    if (( REPLAY_START < 1 )); then
      REPLAY_START=1
    fi
    REPLAY_END="$(( FAIL_AT + BACKTRACK ))"

    DEBUG_TRACE="$LOG_DIR/relentless_cycle_${STAMP}_c${CYCLE}_debug${ATTEMPT}.trace.log"
    DEBUG_PROMPT=$(cat <<PROMPT
You are in relentless recovery mode. Inspect and fix the failure, then validate.
Failure context:
- fail_case: ${FAIL_AT}
- failure_artifact: ${ARTIFACT}
- mode: ${MODE}

Required actions:
1) Inspect the latest failure artifact/journal and root-cause the regression.
2) Apply a minimal code fix in this repo.
3) Run validation:
   - npm run -s typecheck
   - npm run -s bench:hypercore-v2-gate
   - npm run -s bench:anti-oreo-v2-gate
4) Run targeted replay:
   - npm run -s bench:million-baseline-compare -- --modes ${MODE} --start-test ${REPLAY_START} --max-tests ${REPLAY_END} --continue-after-fail
5) Stop after commands complete.
PROMPT
)

    log "cycle=$CYCLE debug_attempt=$ATTEMPT fail_case=$FAIL_AT replay=${REPLAY_START}-${REPLAY_END}"
    if ! run_codex_prompt "$CODEX_DEBUG_TIMEOUT_SEC" "$DEBUG_TRACE" "$DEBUG_PROMPT"; then
      log "cycle=$CYCLE debug_attempt=$ATTEMPT codex exec timeout/non-zero trace=$DEBUG_TRACE"
      kill_repo_bench_processes
      sleep 1
    fi

    DEBUG_SUMMARY="$(parse_latest_report_for_range "$REPLAY_START" "$REPLAY_END" "debug" "$CYCLE" "$ATTEMPT")"
    echo "$DEBUG_SUMMARY" >>"$SUMMARY_JSONL"
    cp "$SUMMARY_JSONL" "$SUMMARY_LATEST" || true

    D_METRICS="$(summary_metrics "$DEBUG_SUMMARY")"
    IFS=$'\t' read -r D_STATUS D_PASSED D_FAILED D_FIRST_FAIL D_ARTIFACT D_REASON D_REPORT_PATH <<<"$D_METRICS"
    [[ "$D_PASSED" =~ ^[0-9]+$ ]] || D_PASSED=0
    [[ "$D_FAILED" =~ ^[0-9]+$ ]] || D_FAILED=1
    [[ "$D_FIRST_FAIL" =~ ^[0-9]+$ ]] || D_FIRST_FAIL=0
    D_SPAN="$(( REPLAY_END - REPLAY_START + 1 ))"

    log "cycle=$CYCLE debug_attempt=$ATTEMPT status=$D_STATUS passed=$D_PASSED failed=$D_FAILED first_fail=$D_FIRST_FAIL report=${D_REPORT_PATH:-none}"

    if [[ "$D_STATUS" == "PASS" ]] && (( D_FAILED == 0 && D_PASSED == D_SPAN )); then
      FRONTIER="$REPLAY_END"
      WINDOW="$(( WINDOW / 2 ))"
      WINDOW="$(max_int "$WINDOW_MIN" "$WINDOW")"
      DEBUG_SUCCESS=1
      BLOCKER_FAIL_AT=0
      BLOCKER_REPEATS=0
      persist_state "$CYCLE" "$FRONTIER" "$WINDOW" "$BLOCKER_FAIL_AT" "$BLOCKER_REPEATS" "$DEBUG_SUMMARY" || true
      break
    fi

    if (( D_FIRST_FAIL > 0 )); then
      FAIL_AT="$D_FIRST_FAIL"
      ARTIFACT="$D_ARTIFACT"
    fi
    ATTEMPT="$(( ATTEMPT + 1 ))"
  done

  if (( DEBUG_SUCCESS == 1 )); then
    log "cycle=$CYCLE debug_success new_frontier=$FRONTIER next_window=$WINDOW"
    CYCLE="$(( CYCLE + 1 ))"
    sleep "$SLEEP_BETWEEN_CYCLES_SEC"
    continue
  fi

  if (( FAIL_AT == BLOCKER_FAIL_AT )); then
    BLOCKER_REPEATS="$(( BLOCKER_REPEATS + 1 ))"
  else
    BLOCKER_FAIL_AT="$FAIL_AT"
    BLOCKER_REPEATS=1
  fi
  WINDOW="$(( WINDOW / 2 ))"
  WINDOW="$(max_int "$WINDOW_MIN" "$WINDOW")"
  persist_state "$CYCLE" "$FRONTIER" "$WINDOW" "$BLOCKER_FAIL_AT" "$BLOCKER_REPEATS" "$BENCH_SUMMARY" || true
  log "cycle=$CYCLE unresolved_fail fail_case=$FAIL_AT blocker_repeats=$BLOCKER_REPEATS window=$WINDOW"

  if (( BLOCKER_REPEATS >= MAX_BLOCKER_REPEATS )); then
    STOP_REASON="repeated_blocker_case_${BLOCKER_FAIL_AT}_x${BLOCKER_REPEATS}"
    write_blocker_report "$BLOCKER_FAIL_AT" "$BLOCKER_REPEATS" "$STOP_REASON"
    log "stop $STOP_REASON blocker_report=$BLOCKER_MD"
    break
  fi

  CYCLE="$(( CYCLE + 1 ))"
  sleep "$SLEEP_BETWEEN_CYCLES_SEC"
done

log "finished frontier=$FRONTIER window=$WINDOW summary=$SUMMARY_JSONL state=$STATE_LATEST"
