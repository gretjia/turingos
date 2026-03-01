# Main-Step Baseline Report (Qwen vs Kimi vs TuringOS Dual-Brain)

## Scope
This run measures **consecutive passed tests before first fail** toward the 1,000,000 target (main-step proxy), using the same harness and stop-on-first-fail discipline.

## Runtime Setup
- Harness: `src/bench/million-baseline-compare.ts`
- Target: `1,000,000`
- Stop rule: first failure stops the mode
- Qwen execution path: **Mac local Ollama** (`qwen3-coder:30b`) over SSH tunnel `127.0.0.1:11435 -> mac-back:11434`
- Kimi model: `kimi-k2-turbo-preview`
- Dual-brain: `planner=Kimi2.5`, `worker=Qwen3-coder:30b (Mac)`

## Primary Results
1. `qwen_direct`
- Report: `benchmarks/audits/baseline/million_baseline_compare_20260228_064532.json`
- Step count: **19** (failed at test 20)
- Failure artifact: `benchmarks/audits/baseline/failure_artifacts/qwen_direct_case_000020_20260228_064532.json`

2. `kimi_direct`
- Report: `benchmarks/audits/baseline/million_baseline_compare_20260228_070618.json`
- Step count: **>=200** (no failure within max-tests=200)
- Interpretation: this is a **lower bound** because run cap was 200.

3. `turingos_dualbrain`
- Report: `benchmarks/audits/baseline/million_baseline_compare_20260228_070033.json`
- Step count: **5** (failed at test 6)
- Failure artifact: `benchmarks/audits/baseline/failure_artifacts/turingos_dualbrain_case_000006_20260228_070033.json`

## Bloody Debug Signals (for training)
1. Qwen direct arithmetic drift
- Case 20: expected `2600`, observed `2590`.
- Indicates occasional deterministic arithmetic slip under strict JSON output.

2. Dual-brain route-thrashing + no write completion
- Failure case 6: `ANSWER.txt` absent (`observed=null`).
- `journalTail` shows repeated `HYPERCORE_ROUTE` cycles with no successful terminal write.
- `callstack` left tasks in `SUSPENDED/ACTIVE` verify-write sequence without closure.

3. Capability-handle fragility observed in earlier dual-brain cases
- Repeated trap pattern in workspace journals:
  - `Error: [OS_TRAP: EACCES] Unknown capability handle: vfd://rw/sys/append/ANSWER.txt`
  - `Error: [OS_TRAP: EACCES] Unknown capability handle: vfd://rw/ANSWER.txt`
- This is a high-value recovery sample for SFT/DPO (error -> fix capability -> retry).

## Training Data Candidates
- `benchmarks/audits/baseline/failure_artifacts/qwen_direct_case_000020_20260228_064532.json`
- `benchmarks/audits/baseline/failure_artifacts/turingos_dualbrain_case_000006_20260228_070033.json`
- `benchmarks/tmp/baseline_dualbrain/case_000002/.journal.log`
- `benchmarks/tmp/baseline_dualbrain/case_000003/.journal.log`
- `benchmarks/tmp/baseline_dualbrain/case_000006/.journal.log`
- `benchmarks/tmp/baseline_dualbrain/case_000006/.callstack.json`

## Current Conclusion
- By current measured main-step counts: `kimi_direct` > `qwen_direct` > `turingos_dualbrain`.
- Dual-brain currently loses mostly on protocol/capability recovery and route thrashing, not raw model IQ.
- These traces are suitable for failure-recovery oriented SFT/DPO curation.
