#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

HOURS="${HOURS:-0}"
RUN_FOREVER="${RUN_FOREVER:-1}"
MAX_CYCLES="${MAX_CYCLES:-0}"
MIN_WINDOW="${MIN_WINDOW:-20}"
MAX_WINDOW="${MAX_WINDOW:-320}"
WINDOW="${WINDOW:-40}"
INITIAL_FRONTIER="${INITIAL_FRONTIER:-40}"
ACTIVE_PROFILE="${ACTIVE_PROFILE:-balanced}"
MODE="${MODE:-turingos_dualbrain}"
CODEX_STEP_TIMEOUT_SEC="${CODEX_STEP_TIMEOUT_SEC:-1200}"
SLEEP_BETWEEN_CYCLES_SEC="${SLEEP_BETWEEN_CYCLES_SEC:-2}"

PROFILES=("balanced" "strict_halt" "wide_ticks")
NOW_STAMP="$(date +%Y%m%d_%H%M%S)"
LOG_DIR="$ROOT_DIR/benchmarks/audits/baseline/overnight"
RUN_LOG="$LOG_DIR/codex_supervisor_${NOW_STAMP}.log"
SUMMARY_JSONL="$LOG_DIR/codex_supervisor_summary_${NOW_STAMP}.jsonl"
SUMMARY_LATEST="$LOG_DIR/codex_supervisor_summary_latest.jsonl"
STATE_LATEST="$LOG_DIR/codex_supervisor_state_latest.json"
STOP_FILE="$LOG_DIR/codex_supervisor.stop"

mkdir -p "$LOG_DIR"
touch "$RUN_LOG" "$SUMMARY_JSONL"

log() {
  local msg="$1"
  printf '[codex-supervisor][%s] %s\n' "$(date '+%F %T')" "$msg" | tee -a "$RUN_LOG" >&2
}

apply_profile() {
  local profile="$1"
  case "$profile" in
    balanced)
      export TURINGOS_HYPERCORE_PLANNER_TEMPERATURE=0.10
      export TURINGOS_HYPERCORE_WORKER_TEMPERATURE=0.00
      export TURINGOS_HYPERCORE_MAX_REPEAT_WRITE_STREAK=3
      export TURINGOS_BASELINE_DUAL_MAX_TICKS=12
      ;;
    strict_halt)
      export TURINGOS_HYPERCORE_PLANNER_TEMPERATURE=0.05
      export TURINGOS_HYPERCORE_WORKER_TEMPERATURE=0.00
      export TURINGOS_HYPERCORE_MAX_REPEAT_WRITE_STREAK=2
      export TURINGOS_BASELINE_DUAL_MAX_TICKS=12
      ;;
    wide_ticks)
      export TURINGOS_HYPERCORE_PLANNER_TEMPERATURE=0.10
      export TURINGOS_HYPERCORE_WORKER_TEMPERATURE=0.00
      export TURINGOS_HYPERCORE_MAX_REPEAT_WRITE_STREAK=3
      export TURINGOS_BASELINE_DUAL_MAX_TICKS=16
      ;;
    *)
      apply_profile balanced
      return
      ;;
  esac

  export TURINGOS_ORACLE_REPAIR_ALL=1
  export TURINGOS_OLLAMA_REPAIR_ENABLED=1
  export TURINGOS_OLLAMA_REPAIR_MAX_ATTEMPTS=2
  export TURINGOS_FORCE_WRITE_FALLBACK=1
  export TURINGOS_BASELINE_ORACLE_MAX_RETRIES="${TURINGOS_BASELINE_ORACLE_MAX_RETRIES:-1}"
  export TURINGOS_BASELINE_ORACLE_TIMEOUT_MS="${TURINGOS_BASELINE_ORACLE_TIMEOUT_MS:-15000}"
}

next_profile() {
  local profile="$1"
  case "$profile" in
    balanced) echo "strict_halt" ;;
    strict_halt) echo "wide_ticks" ;;
    wide_ticks) echo "balanced" ;;
    *) echo "balanced" ;;
  esac
}

resolve_frontier_from_latest() {
  local latest_report
  latest_report="$(ls -t "$ROOT_DIR"/benchmarks/audits/baseline/million_baseline_compare_*.json 2>/dev/null | head -n 1 || true)"
  if [[ -z "$latest_report" ]]; then
    echo "$INITIAL_FRONTIER"
    return
  fi
  node - "$latest_report" "$INITIAL_FRONTIER" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const fallback = Number(process.argv[3] || '0');
const mode = process.env.MODE || 'turingos_dualbrain';
try {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  const row = (raw.results || []).find((item) => item.mode === mode) ?? (raw.results || [])[0];
  if (!row) {
    console.log(fallback);
    process.exit(0);
  }
  const start = Number(raw.startTest || 1);
  const max = Number(raw.maxTests || 0);
  const passed = Number(row.passed || 0);
  const failed = Number(row.failed || 0);
  if (failed === 0) {
    console.log(Math.max(fallback, max));
    process.exit(0);
  }
  const firstFailAt = row.firstFailAt == null ? null : Number(row.firstFailAt);
  if (Number.isFinite(firstFailAt) && firstFailAt > 0) {
    console.log(Math.max(fallback, firstFailAt - 1));
    process.exit(0);
  }
  console.log(Math.max(fallback, start + passed - 1));
} catch {
  console.log(fallback);
}
NODE
}

load_previous_state() {
  if [[ ! -f "$STATE_LATEST" ]]; then
    return
  fi
  local loaded
  loaded="$(node - "$STATE_LATEST" <<'NODE'
const fs = require('fs');
const p = process.argv[2];
try {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const frontier = Number(raw.frontier || 0);
  const window = Number(raw.window || 0);
  const profile = typeof raw.activeProfile === 'string' ? raw.activeProfile : '';
  console.log(`${frontier}\t${window}\t${profile}`);
} catch {
  process.exit(1);
}
NODE
)" || return
  IFS=$'\t' read -r loaded_frontier loaded_window loaded_profile <<<"$loaded"
  if [[ "${loaded_frontier:-}" =~ ^[0-9]+$ ]]; then
    INITIAL_FRONTIER="$loaded_frontier"
  fi
  if [[ "${loaded_window:-}" =~ ^[0-9]+$ ]] && (( loaded_window > 0 )); then
    WINDOW="$loaded_window"
  fi
  if [[ -n "${loaded_profile:-}" ]]; then
    ACTIVE_PROFILE="$loaded_profile"
  fi
}

latest_report_stamp() {
  local latest="$ROOT_DIR/benchmarks/audits/baseline/million_baseline_compare_latest.json"
  if [[ ! -f "$latest" ]]; then
    echo ""
    return
  fi
  node - "$latest" <<'NODE'
const fs = require('fs');
const latest = process.argv[2];
try {
  const raw = JSON.parse(fs.readFileSync(latest, 'utf8'));
  const stamp = typeof raw.stamp === 'string' ? raw.stamp.trim() : '';
  process.stdout.write(stamp);
} catch {
  process.stdout.write('');
}
NODE
}

run_codex_cycle() {
  local cycle="$1"
  local profile="$2"
  local start_test="$3"
  local end_test="$4"

  apply_profile "$profile"
  local trace_file="$LOG_DIR/codex_cycle_${NOW_STAMP}_${cycle}.trace.log"
  local stamp_before
  stamp_before="$(latest_report_stamp)"

  local prompt
  prompt=$(cat <<PROMPT
You are executing one baseline benchmark cycle. Do not edit any files.
Run exactly this command:
npm run -s bench:million-baseline-compare -- --modes ${MODE} --start-test ${start_test} --max-tests ${end_test} --continue-after-fail

After command completion, stop. Do not edit files.
PROMPT
)

  log "cycle=$cycle profile=$profile range=${start_test}-${end_test} (codex exec)"
  if ! timeout "${CODEX_STEP_TIMEOUT_SEC}" codex exec \
    --dangerously-bypass-approvals-and-sandbox \
    --skip-git-repo-check \
    -C "$ROOT_DIR" \
    "$prompt" >"$trace_file" 2>&1; then
    log "codex exec timeout/non-zero for cycle=$cycle profile=$profile; see $trace_file"
  fi

  local stamp_after
  stamp_after="$(latest_report_stamp)"
  if [[ -z "$stamp_after" ]]; then
    node - <<'NODE'
const out = { status: 'ERROR', passed: 0, failed: 1, firstFailAt: null, reportPath: '', reason: 'missing_report' };
process.stdout.write(JSON.stringify(out));
NODE
    return 0
  fi

  local stamped_path="$ROOT_DIR/benchmarks/audits/baseline/million_baseline_compare_${stamp_after}.json"
  local report_to_parse="$ROOT_DIR/benchmarks/audits/baseline/million_baseline_compare_latest.json"
  if [[ -f "$stamped_path" ]]; then
    report_to_parse="$stamped_path"
  fi

  if [[ -n "$stamp_before" && "$stamp_after" == "$stamp_before" ]]; then
    node - "$report_to_parse" <<'NODE'
const reportPath = process.argv[2];
process.stdout.write(
  JSON.stringify({
    status: 'ERROR',
    passed: 0,
    failed: 1,
    firstFailAt: null,
    reportPath,
    reason: 'stale_report_or_codex_failed',
  })
);
NODE
    return 0
  fi

  node - "$report_to_parse" "$MODE" "$start_test" "$end_test" <<'NODE'
const fs = require('fs');
const reportPath = process.argv[2];
const mode = process.argv[3];
const expectedStart = Number(process.argv[4]);
const expectedEnd = Number(process.argv[5]);
try {
  const raw = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const rangeMismatch = Number(raw.startTest || 0) !== expectedStart || Number(raw.maxTests || 0) !== expectedEnd;
  const row = (raw.results || []).find((item) => item.mode === mode) ?? (raw.results || [])[0];
  if (!row) {
    process.stdout.write(JSON.stringify({ status: 'ERROR', passed: 0, failed: 1, firstFailAt: null, reportPath, reason: 'report_row_missing' }));
    process.exit(0);
  }
  if (rangeMismatch) {
    process.stdout.write(JSON.stringify({
      status: 'ERROR',
      passed: 0,
      failed: 1,
      firstFailAt: null,
      reportPath,
      reason: `unexpected_report_range:${raw.startTest}-${raw.maxTests}`,
    }));
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    status: row.status ?? 'UNKNOWN',
    passed: Number(row.passed || 0),
    failed: Number(row.failed || 0),
    firstFailAt: row.firstFailAt == null ? null : Number(row.firstFailAt),
    reportPath,
    reason: typeof row.reason === 'string' ? row.reason : '',
  }));
} catch {
  process.stdout.write(JSON.stringify({ status: 'ERROR', passed: 0, failed: 1, firstFailAt: null, reportPath, reason: 'report_parse_failed' }));
}
NODE
}

persist_state() {
  local cycle="$1"
  local last_summary="$2"
  node - "$STATE_LATEST" "$cycle" "$FRONTIER" "$WINDOW" "$ACTIVE_PROFILE" "$last_summary" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const cycle = Number(process.argv[3]);
const frontier = Number(process.argv[4]);
const window = Number(process.argv[5]);
const activeProfile = process.argv[6];
const lastSummary = JSON.parse(process.argv[7]);
const state = {
  updatedAt: new Date().toISOString(),
  cycle,
  frontier,
  window,
  activeProfile,
  lastSummary,
};
fs.writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
NODE
}

load_previous_state
FRONTIER="$(resolve_frontier_from_latest)"
if [[ "$INITIAL_FRONTIER" =~ ^[0-9]+$ ]] && (( INITIAL_FRONTIER > FRONTIER )); then
  FRONTIER="$INITIAL_FRONTIER"
fi
if (( WINDOW < MIN_WINDOW )); then
  WINDOW="$MIN_WINDOW"
fi
if (( WINDOW > MAX_WINDOW )); then
  WINDOW="$MAX_WINDOW"
fi

END_TS="$(( $(date +%s) + HOURS * 3600 ))"
CYCLE=1
CONSECUTIVE_GREEN=0
if [[ "$MAX_CYCLES" =~ ^[0-9]+$ ]] && (( MAX_CYCLES > 0 )); then
  MAX_CYCLES_MSG="$MAX_CYCLES"
else
  MAX_CYCLES_MSG="unlimited"
fi
log "start run_forever=$RUN_FOREVER hours=$HOURS max_cycles=$MAX_CYCLES_MSG frontier=$FRONTIER window=$WINDOW active_profile=$ACTIVE_PROFILE codex_timeout_sec=$CODEX_STEP_TIMEOUT_SEC stop_file=$STOP_FILE"

should_continue() {
  if [[ -f "$STOP_FILE" ]]; then
    return 1
  fi
  if [[ "$MAX_CYCLES" =~ ^[0-9]+$ ]] && (( MAX_CYCLES > 0 )) && (( CYCLE > MAX_CYCLES )); then
    return 1
  fi
  if [[ "$RUN_FOREVER" == "1" ]]; then
    return 0
  fi
  if (( HOURS <= 0 )); then
    return 0
  fi
  (( $(date +%s) < END_TS ))
}

while should_continue; do
  START_TEST="$(( FRONTIER + 1 ))"
  END_TEST="$(( START_TEST + WINDOW - 1 ))"

  SUMMARY_BASE="$(run_codex_cycle "$CYCLE" "$ACTIVE_PROFILE" "$START_TEST" "$END_TEST" || true)"
  if ! node -e 'JSON.parse(process.argv[1])' "$SUMMARY_BASE" >/dev/null 2>&1; then
    SUMMARY_BASE='{"status":"ERROR","passed":0,"failed":1,"firstFailAt":null,"reportPath":"","reason":"summary_base_invalid_json"}'
  fi
  SUMMARY="$(node - "$SUMMARY_BASE" "$CYCLE" "$ACTIVE_PROFILE" "$START_TEST" "$END_TEST" <<'NODE'
const base = JSON.parse(process.argv[2]);
const cycle = Number(process.argv[3]);
const profile = process.argv[4];
const startTest = Number(process.argv[5]);
const endTest = Number(process.argv[6]);
const out = {
  ts: new Date().toISOString(),
  cycle,
  profile,
  startTest,
  endTest,
  ...base,
};
process.stdout.write(JSON.stringify(out));
NODE
)"
  if ! node -e 'JSON.parse(process.argv[1])' "$SUMMARY" >/dev/null 2>&1; then
    SUMMARY="{\"ts\":\"$(date -Iseconds)\",\"cycle\":${CYCLE},\"profile\":\"${ACTIVE_PROFILE}\",\"startTest\":${START_TEST},\"endTest\":${END_TEST},\"status\":\"ERROR\",\"passed\":0,\"failed\":1,\"firstFailAt\":null,\"reportPath\":\"\",\"reason\":\"summary_invalid_json\"}"
  fi

  echo "$SUMMARY" >>"$SUMMARY_JSONL"
  cp "$SUMMARY_JSONL" "$SUMMARY_LATEST" || true

  METRICS="$(node - "$SUMMARY" <<'NODE'
const s = JSON.parse(process.argv[2]);
const ff = s.firstFailAt == null ? 0 : Number(s.firstFailAt);
console.log(`${s.status}\t${Number(s.passed || 0)}\t${Number(s.failed || 0)}\t${ff}`);
NODE
  )" || METRICS=""
  if [[ -z "$METRICS" ]]; then
    STATUS="ERROR"
    PASSED=0
    FAILED=1
    FIRST_FAIL=0
  else
    IFS=$'\t' read -r STATUS PASSED FAILED FIRST_FAIL <<<"$METRICS"
  fi
  [[ "$PASSED" =~ ^[0-9]+$ ]] || PASSED=0
  [[ "$FAILED" =~ ^[0-9]+$ ]] || FAILED=1
  [[ "$FIRST_FAIL" =~ ^[0-9]+$ ]] || FIRST_FAIL=0

  WINDOW_SPAN="$(( END_TEST - START_TEST + 1 ))"
  if [[ "$STATUS" == "PASS" ]] && (( FAILED == 0 && PASSED == WINDOW_SPAN )); then
    FRONTIER="$END_TEST"
    CONSECUTIVE_GREEN="$(( CONSECUTIVE_GREEN + 1 ))"
    if (( CONSECUTIVE_GREEN >= 2 && WINDOW < MAX_WINDOW )); then
      WINDOW="$(( WINDOW * 2 ))"
      if (( WINDOW > MAX_WINDOW )); then
        WINDOW="$MAX_WINDOW"
      fi
      CONSECUTIVE_GREEN=0
    fi
  else
    CONSECUTIVE_GREEN=0
    if (( FIRST_FAIL > 0 )); then
      CANDIDATE_FRONTIER="$(( FIRST_FAIL - 1 ))"
      if (( CANDIDATE_FRONTIER > FRONTIER )); then
        FRONTIER="$CANDIDATE_FRONTIER"
      fi
    fi
    if (( WINDOW > MIN_WINDOW )); then
      WINDOW="$(( WINDOW / 2 ))"
      if (( WINDOW < MIN_WINDOW )); then
        WINDOW="$MIN_WINDOW"
      fi
    fi
    ACTIVE_PROFILE="$(next_profile "$ACTIVE_PROFILE")"
  fi

  persist_state "$CYCLE" "$SUMMARY" || true
  log "cycle=$CYCLE status=$STATUS passed=$PASSED failed=$FAILED first_fail=$FIRST_FAIL frontier=$FRONTIER next_window=$WINDOW next_profile=$ACTIVE_PROFILE"
  CYCLE="$(( CYCLE + 1 ))"
  if (( SLEEP_BETWEEN_CYCLES_SEC > 0 )); then
    sleep "$SLEEP_BETWEEN_CYCLES_SEC"
  fi
done

if [[ -f "$STOP_FILE" ]]; then
  log "stop file detected at $STOP_FILE; graceful shutdown"
fi
log "finished frontier=$FRONTIER window=$WINDOW active_profile=$ACTIVE_PROFILE summary=$SUMMARY_JSONL"
