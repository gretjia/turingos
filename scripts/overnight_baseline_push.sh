#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

HOURS="${HOURS:-8}"
MIN_WINDOW="${MIN_WINDOW:-20}"
MAX_WINDOW="${MAX_WINDOW:-320}"
WINDOW="${WINDOW:-50}"
INITIAL_FRONTIER="${INITIAL_FRONTIER:-0}"
ACTIVE_PROFILE="${ACTIVE_PROFILE:-balanced}"
MODE="${MODE:-turingos_dualbrain}"

PROFILES=("balanced" "strict_halt" "wide_ticks")
NOW_STAMP="$(date +%Y%m%d_%H%M%S)"
LOG_DIR="$ROOT_DIR/benchmarks/audits/baseline/overnight"
RUN_LOG="$LOG_DIR/overnight_push_${NOW_STAMP}.log"
SUMMARY_JSONL="$LOG_DIR/overnight_summary_${NOW_STAMP}.jsonl"
SUMMARY_LATEST="$LOG_DIR/overnight_summary_latest.jsonl"
STATE_LATEST="$LOG_DIR/overnight_state_latest.json"

mkdir -p "$LOG_DIR"
touch "$RUN_LOG" "$SUMMARY_JSONL"

log() {
  local msg="$1"
  printf '[overnight][%s] %s\n' "$(date '+%F %T')" "$msg" | tee -a "$RUN_LOG" >&2
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
      log "unknown profile=$profile; fallback to balanced"
      apply_profile balanced
      return
      ;;
  esac

  # Keep parser/repair behavior stable while sweeping halt parameters.
  export TURINGOS_ORACLE_REPAIR_ALL=1
  export TURINGOS_OLLAMA_REPAIR_ENABLED=1
  export TURINGOS_OLLAMA_REPAIR_MAX_ATTEMPTS=2
  export TURINGOS_FORCE_WRITE_FALLBACK=1
  export TURINGOS_BASELINE_ORACLE_MAX_RETRIES="${TURINGOS_BASELINE_ORACLE_MAX_RETRIES:-1}"
  export TURINGOS_BASELINE_ORACLE_TIMEOUT_MS="${TURINGOS_BASELINE_ORACLE_TIMEOUT_MS:-15000}"
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
const reportPath = process.argv[2];
const fallback = Number(process.argv[3] || '0');
try {
  const raw = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const row = (raw.results || []).find((item) => item.mode === 'turingos_dualbrain') ?? (raw.results || [])[0];
  if (!row) {
    console.log(fallback);
    process.exit(0);
  }
  const start = Number(raw.startTest || 1);
  const max = Number(raw.maxTests || 0);
  const attemptedSpan = Math.max(0, max - start + 1);
  const passed = Number(row.passed || 0);
  const failed = Number(row.failed || 0);
  const firstFailAt = row.firstFailAt == null ? null : Number(row.firstFailAt);
  if (failed === 0 && passed === attemptedSpan) {
    console.log(max);
    process.exit(0);
  }
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
const path = process.argv[2];
try {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
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

run_window_once() {
  local profile="$1"
  local start_test="$2"
  local end_test="$3"
  local tag="$4"

  apply_profile "$profile"
  local started_at
  started_at="$(date +%s)"
  log "run tag=$tag profile=$profile range=${start_test}-${end_test} window=$WINDOW frontier=$FRONTIER"

  if ! npm run -s bench:million-baseline-compare -- --modes "$MODE" --start-test "$start_test" --max-tests "$end_test" --continue-after-fail >>"$RUN_LOG" 2>&1; then
    log "command failed tag=$tag profile=$profile range=${start_test}-${end_test}; continue with latest report parse"
  fi

  local finished_at
  finished_at="$(date +%s)"
  local report_latest="$ROOT_DIR/benchmarks/audits/baseline/million_baseline_compare_latest.json"

  node - "$report_latest" "$profile" "$start_test" "$end_test" "$tag" "$started_at" "$finished_at" "$MODE" <<'NODE'
const fs = require('fs');
const reportPath = process.argv[2];
const profile = process.argv[3];
const startTest = Number(process.argv[4]);
const endTest = Number(process.argv[5]);
const tag = process.argv[6];
const startedAt = Number(process.argv[7]);
const finishedAt = Number(process.argv[8]);
const mode = process.argv[9];

const base = {
  ts: new Date().toISOString(),
  profile,
  tag,
  startTest,
  endTest,
  mode,
  reportPath,
  status: 'ERROR',
  attempted: 0,
  passed: 0,
  failed: 0,
  firstFailAt: null,
  reason: 'report_parse_failed',
  artifact: null,
  durationSec: Math.max(0, finishedAt - startedAt),
};

try {
  const raw = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const row = (raw.results || []).find((item) => item.mode === mode) ?? (raw.results || [])[0];
  if (!row) {
    process.stdout.write(JSON.stringify(base));
    process.exit(0);
  }
  const stampedPath = raw.stamp
    ? reportPath.replace('million_baseline_compare_latest.json', `million_baseline_compare_${raw.stamp}.json`)
    : reportPath;
  const out = {
    ...base,
    status: row.status ?? 'UNKNOWN',
    attempted: Number(row.attempted || 0),
    passed: Number(row.passed || 0),
    failed: Number(row.failed || 0),
    firstFailAt: row.firstFailAt == null ? null : Number(row.firstFailAt),
    reason: typeof row.reason === 'string' ? row.reason : '',
    artifact: typeof row.firstFailArtifact === 'string' ? row.firstFailArtifact : null,
    reportPath: stampedPath,
  };
  process.stdout.write(JSON.stringify(out));
} catch {
  process.stdout.write(JSON.stringify(base));
}
NODE
}

extract_metrics() {
  local summary_json="$1"
  node - "$summary_json" <<'NODE'
const raw = JSON.parse(process.argv[2]);
const firstFail = raw.firstFailAt == null ? 999999999 : Number(raw.firstFailAt);
console.log(`${Number(raw.passed || 0)}\t${Number(raw.failed || 0)}\t${firstFail}\t${raw.status || 'UNKNOWN'}`);
NODE
}

persist_state() {
  local cycle="$1"
  local last_summary="$2"
  node - "$STATE_LATEST" "$cycle" "$FRONTIER" "$WINDOW" "$ACTIVE_PROFILE" "$last_summary" <<'NODE'
const fs = require('fs');
const output = process.argv[2];
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
fs.writeFileSync(output, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
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

log "start hours=$HOURS frontier=$FRONTIER window=$WINDOW active_profile=$ACTIVE_PROFILE"

while (( $(date +%s) < END_TS )); do
  START_TEST="$(( FRONTIER + 1 ))"
  END_TEST="$(( START_TEST + WINDOW - 1 ))"
  if (( END_TEST < START_TEST )); then
    END_TEST="$START_TEST"
  fi

  CANDIDATES=("$ACTIVE_PROFILE")
  for p in "${PROFILES[@]}"; do
    if [[ "$p" != "$ACTIVE_PROFILE" ]]; then
      CANDIDATES+=("$p")
    fi
  done

  BEST_JSON=''
  BEST_PROFILE=''
  BEST_PASSED=-1
  BEST_FAILED=999999999
  BEST_FIRST_FAIL=-1

  WINDOW_SPAN="$(( END_TEST - START_TEST + 1 ))"
  ATTEMPT=1

  for PROFILE in "${CANDIDATES[@]}"; do
    SUMMARY="$(run_window_once "$PROFILE" "$START_TEST" "$END_TEST" "cycle${CYCLE}_try${ATTEMPT}")"
    echo "$SUMMARY" >>"$SUMMARY_JSONL"
    cp "$SUMMARY_JSONL" "$SUMMARY_LATEST"

    IFS=$'\t' read -r PASSED FAILED FIRST_FAIL STATUS <<<"$(extract_metrics "$SUMMARY")"
    if (( PASSED > BEST_PASSED )) || \
       (( PASSED == BEST_PASSED && FAILED < BEST_FAILED )) || \
       (( PASSED == BEST_PASSED && FAILED == BEST_FAILED && FIRST_FAIL > BEST_FIRST_FAIL )); then
      BEST_JSON="$SUMMARY"
      BEST_PROFILE="$PROFILE"
      BEST_PASSED="$PASSED"
      BEST_FAILED="$FAILED"
      BEST_FIRST_FAIL="$FIRST_FAIL"
    fi

    if (( FAILED == 0 && PASSED == WINDOW_SPAN )); then
      break
    fi
    ATTEMPT="$(( ATTEMPT + 1 ))"
  done

  ACTIVE_PROFILE="$BEST_PROFILE"
  if (( BEST_FAILED == 0 )); then
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
    if (( BEST_FIRST_FAIL > 0 )); then
      CANDIDATE_FRONTIER="$(( BEST_FIRST_FAIL - 1 ))"
      if (( CANDIDATE_FRONTIER > FRONTIER )); then
        FRONTIER="$CANDIDATE_FRONTIER"
      fi
    fi
    CONSECUTIVE_GREEN=0
    if (( WINDOW > MIN_WINDOW )); then
      WINDOW="$(( WINDOW / 2 ))"
      if (( WINDOW < MIN_WINDOW )); then
        WINDOW="$MIN_WINDOW"
      fi
    fi
  fi

  persist_state "$CYCLE" "$BEST_JSON"
  log "cycle=$CYCLE done best_profile=$BEST_PROFILE passed=$BEST_PASSED failed=$BEST_FAILED frontier=$FRONTIER next_window=$WINDOW"
  CYCLE="$(( CYCLE + 1 ))"
done

log "finished frontier=$FRONTIER window=$WINDOW active_profile=$ACTIVE_PROFILE summary=$SUMMARY_JSONL"
