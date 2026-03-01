# Baseline Harness Termination Fix & True Status (2026-02-28)

## Critical Finding
Previous `million-baseline-compare` PASS could be a false positive.

Root cause:
- `solveTuringOSDualBrain()` only checked `ANSWER.txt` content.
- It did **not** require root process state to be `TERMINATED`.
- A run could be `KILLED` (red flags exhausted) but still leave a correct `ANSWER.txt`, and be incorrectly marked PASS.

## Fix Applied
- File: `src/bench/million-baseline-compare.ts`
- Change:
  - Capture `scheduler.run(...)` result.
  - Persist `.run_state.json` in workspace.
  - Enforce pass condition: `runResult.rootState === 'TERMINATED'`.
  - Otherwise return `null` => benchmark FAIL.

## Additional Hardening Applied in Same Phase
- `src/oracle/turing-bus-adapter.ts`
  - Strip leading `<think>/<thought>` blocks (strictly limited pre-processing).
  - Reject `CAUSALITY_VIOLATION_MULTIPLE_WORLD_OPS` at parser level.
- `src/oracle/universal-oracle.ts`
  - Inject stricter output contract prompt with exact syscall envelopes and explicit `1A` constraints.
- `schemas/turing-bus.frame.v2.json`
  - Added `SYS_MAP_REDUCE` in `MIND_SCHEDULING` to align with runtime opcodes.

## True Baseline Status After Harness Fix

### A) Planner=`qwq:32b`, Worker=`qwen2.5:7b`
- Command: `bench:million-baseline-compare --modes turingos_dualbrain --max-tests 1`
- Report: `benchmarks/audits/baseline/million_baseline_compare_20260228_143905.json`
- Result: FAIL
- Failure artifact: `benchmarks/audits/baseline/failure_artifacts/turingos_dualbrain_case_000001_20260228_143905.json`
- Key signal:
  - `answerFile` is correct (`168`) but run is non-terminated due repeated red flags.

### B) Planner=`qwen3-coder:30b`, Worker=`qwen2.5:7b`
- Command: same, planner swapped
- Report: `benchmarks/audits/baseline/million_baseline_compare_20260228_144110.json` and `...144457.json`
- Result: FAIL
- Failure artifact (latest): `benchmarks/audits/baseline/failure_artifacts/turingos_dualbrain_case_000001_20260228_144457.json`
- Key signal:
  - Non-terminated root state with protocol faults despite correct `answerFile`.

## Interpretation
- With corrected acceptance criteria, current dualbrain topology does **not** reliably satisfy strict HALT/termination discipline even on 1-case arithmetic micro-benchmark.
- Bottleneck is planner frame conformance (1A discipline, valid syscall envelopes), not raw arithmetic correctness.

## Phase Verdict
- Verdict: FAIL (for true termination-aware baseline)

## Required Next Step
- Add planner-side runtime guardrail that rewrites/repairs candidate frame before scheduler consumption with deterministic rules:
  - collapse world actions to at most one (prefer non-HALT world op; defer HALT to next tick),
  - normalize malformed mind_ops entries,
  - then feed normalized frame to strict parser for final fail-closed validation.
- Re-run corrected baseline matrix (`qwen_direct`, `kimi_direct`, `turingos_dualbrain`) under termination-aware scoring.
