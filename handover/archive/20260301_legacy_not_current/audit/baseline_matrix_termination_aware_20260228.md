# Baseline Matrix (Termination-Aware) - 2026-02-28

## Scoring Rule (Critical)
A case is PASS only if:
1) answer matches expected, and
2) root process state is `TERMINATED` (for TuringOS mode).

This rule is enforced in `src/bench/million-baseline-compare.ts`.

## Results

### 1) Qwen direct (without TuringOS)
- Mode: `qwen_direct`
- Model: `qwen3-coder:30b`
- Run config: `max-tests=100`, stop-on-first-fail
- Result report: `benchmarks/audits/baseline/million_baseline_compare_20260228_152021.json`
- Outcome:
  - attempted=20
  - passed=19
  - first_fail_at=20
  - consecutive_pass_before_first_fail=19
  - failure reason: expected `2600`, got `2590`

### 2) Kimi direct (without TuringOS)
- Mode: `kimi_direct`
- Model: `kimi-k2-turbo-preview`
- Run config: `max-tests=100`, stop-on-first-fail
- Result report: `benchmarks/audits/baseline/million_baseline_compare_20260228_155145.json`
- Outcome:
  - attempted=100
  - passed=100
  - first_fail_at=null
  - consecutive_pass_before_first_fail=100
  - status=PASS (within 100-case cap)

### 3) TuringOS dualbrain (with TuringOS)

#### 3a) Planner=QWQ32B (mac), Worker=Qwen2.5-7B (linux)
- Mode: `turingos_dualbrain`
- Config: `TURINGOS_BASELINE_DUAL_MAX_TICKS=30`
- Result report: `benchmarks/audits/baseline/million_baseline_compare_20260228_151924.json`
- Outcome:
  - attempted=1
  - passed=0
  - first_fail_at=1
  - observed=null (termination-aware)
  - note: `ANSWER.txt` contains correct answer (`168`) but root state not terminated (`READY`) at tick cap.
  - `.run_state.json` shows rootState=`READY`, ticks=30.

#### 3b) Planner=Kimi, Worker=Qwen3-Coder-30B
- Mode: `turingos_dualbrain`
- Config: `TURINGOS_BASELINE_DUAL_MAX_TICKS=30`
- Result reports:
  - Pre-adjustment fail: `benchmarks/audits/baseline/million_baseline_compare_20260228_155919.json`
  - Post-adjustment pass (quick window): `benchmarks/audits/baseline/million_baseline_compare_20260228_161155.json`
- Outcome (latest):
  - attempted=5
  - passed=5
  - first_fail_at=null
  - consecutive_pass_before_first_fail=5
  - status=PASS (within 5-case cap)
  - note: kept strict HALT contract; no scheduler-forced termination.

#### 3c) Why 3b improved
- Added deterministic frame guardrail at parser layer (white-box):
  - collapses illegal multiple world actions to a single deterministic world op,
  - strips only leading `<think>/<thought>` preamble,
  - preserves strict JSON frame and fail-closed syscall field validation.
- Added write-thrashing trap to nudge model toward dedicated HALT tick when verifier already passes, then downgraded this trap to non-red-flag guidance (avoid premature KILL).

## Interpretation
- Direct baselines:
  - Kimi direct is strongest in this sample window (100/100).
  - Qwen3 direct fails at case 20.
- TuringOS dualbrain is now mixed:
  - `qwq + qwen2.5` still fails on termination discipline in current setup.
  - `kimi + qwen3` reaches 5/5 under termination-aware scoring in quick window.
- Current bottleneck remains termination discipline robustness at larger window sizes.

## Next Objective
- Preserve strict HALT contract (no scheduler-forced termination).
- Improve model-side termination discipline only:
  - strengthen planner prompt so post-write phase is explicitly: verify -> dedicated HALT tick,
  - reduce route thrashing (repeated `SYS_GOTO`/non-progress loops) via stricter task framing,
  - keep white-box role limited to HALT verification gate, not HALT issuance.
- Then rerun matrix: `qwen_direct`, `kimi_direct`, `turingos_dualbrain` with identical termination-aware scoring.
