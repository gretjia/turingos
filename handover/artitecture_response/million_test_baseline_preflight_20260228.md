# 1M Test Baseline Preflight Report

- Date: 2026-02-28
- Requirement from user:
  1. `Qwen 3.0 coder` without TuringOS
  2. `Kimi 2.5` without TuringOS
  3. compare with `TuringOS dual-brain`
  - score by passed tests; who is closer to 1,000,000 is better baseline

## Added Benchmark Harness
- Script: `src/bench/million-baseline-compare.ts`
- Command: `npm run -s bench:million-baseline-compare -- --modes qwen_direct,kimi_direct,turingos_dualbrain --max-tests <N> --target-tests 1000000`
- Output:
  - `benchmarks/audits/baseline/million_baseline_compare_<stamp>.json`
  - `benchmarks/audits/baseline/million_baseline_compare_latest.json`

## Current Run (Preflight, max-tests=1)
- Report: `benchmarks/audits/baseline/million_baseline_compare_20260228_061902.json`
- Results:
  - `qwen_direct`: `SKIP` (local endpoint unavailable on current host)
  - `kimi_direct`: `PASS` at this sample (`consecutive=1`, delta=`999,999`)
  - `turingos_dualbrain`: `PASS` at this sample (`consecutive=1`, delta=`999,999`)

## Extended Run (Preflight, max-tests=3, Kimi vs TuringOS)
- Report: `benchmarks/audits/baseline/million_baseline_compare_20260228_062104.json`
- Results:
  - `kimi_direct`: `PASS` (`consecutive=3`, delta=`999,997`)
  - `turingos_dualbrain`: `FAIL` (`consecutive=1`, delta=`999,999`)
  - current ranking in this run: `kimi_direct` > `turingos_dualbrain`

## Interpretation
- Baseline harness is ready and producing ranked comparable outputs.
- Current machine is still not suitable for meaningful Qwen-local baseline (no local model endpoint).
- To execute the requested real baseline comparison, run this harness on Mac host with:
  - working local Qwen endpoint
  - stable Kimi credentials
  - same prompt/test generator for all three modes
  - larger `--max-tests` (e.g., `100`, `1000`) for ranking stability
  - recommended env for speed control: `TURINGOS_BASELINE_ORACLE_MAX_RETRIES=0`, `TURINGOS_BASELINE_DUAL_MAX_TICKS=8`

## Post-Phase 1M Gate Run
- Command:
  - `npm run -s bench:maker-1m-steps-gate -- --trace benchmarks/audits/longrun/voyager_realworld_trace_20260227_173218.jsonl --answer benchmarks/audits/longrun/voyager_realworld_eval_20260227_173218.json`
- Result:
  - `required_steps=1000000`
  - `observed_steps=69`
  - `answer_correct=false`
  - `FAIL`
  - report: `benchmarks/audits/final_gate/maker_1m_steps_gate_20260228_061518.json`

## Decision
- All planned phases: completed and audited PASS.
- 1M final criterion: not met yet.
- Next iteration focus: baseline execution on proper host + optimization loop until 1M gate turns PASS.
