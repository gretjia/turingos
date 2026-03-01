# Gemini Recursive Audit - Main Steps Baseline (2026-02-28)

## Verdict
FAIL, as TuringOS Dual-Brain architecture suffered a fatal capability-handle trap and route-thrashing at step 6, demonstrating it cannot sustain long-run autonomous operation toward the 1,000,000-step target.

## Evidence Check
- [x] Real-world failure artifacts collected (`turingos_dualbrain_case_000006`, `qwen_direct_case_000020`).
- [x] Main-step baselines captured (Kimi >= 200, Qwen = 19, TuringOS = 5).
- [x] Route-thrashing and capability-handle trap traces explicitly extracted from journals.
- [x] Target metric (consecutive passes before first fail) explicitly evaluated.

## Findings (ordered by severity)

1. **Critical Route-Thrashing & Task Suspension**  
   *File:* `benchmarks/audits/baseline/failure_artifacts/turingos_dualbrain_case_000006_20260228_070033.json`  
   *Observation:* The planner enters a sterile loop, emitting `HYPERCORE_ROUTE` every 5-10 seconds. The callstack reveals that write and verify tasks ("Write 808 to ANSWER.txt with newline") are permanently stuck in `SUSPENDED` and `ACTIVE` states with no actual terminal write completion (`observed=null`).

2. **Capability-Handle Fragility & Fatal OS Traps**  
   *File:* `handover/audits/modelcompare/main_steps_baseline_20260228.md`  
   *Observation:* The system encounters catastrophic `Error: [OS_TRAP: EACCES] Unknown capability handle: vfd://rw/sys/append/ANSWER.txt` errors. Rather than triggering a graceful recovery or retry loop, these capability misalignments cause fatal halts.

3. **Deterministic Arithmetic Drift under Constraints**  
   *File:* `benchmarks/audits/baseline/failure_artifacts/qwen_direct_case_000020_20260228_064532.json`  
   *Observation:* Qwen3-coder locally fails basic arithmetic (751 + 1849: expected `2600`, got `2590`) when operating under strict JSON output constraints without planner oversight.

## Required Fixes Before Next 1M Attempt

1. **Implement OS Trap Recovery Loop**: Modify the capability verification layer so that `[OS_TRAP: EACCES]` errors do not immediately halt the run. Instead, the OS must reflect the trap with proper pathing instructions back into the worker's context window for self-correction. *(Acceptance check: A test case with a deliberately malformed `vfd://` handle successfully recovers and completes the write).*
2. **Deploy Anti-Thrashing Circuit Breaker**: Introduce a watchdog in the `hypercore` dispatcher that monitors `HYPERCORE_ROUTE` emissions. If >3 consecutive routing events occur without a corresponding state transition or I/O completion, the watchdog must forcefully reset the task state and inject a course-correction prompt. *(Acceptance check: A simulated thrashing loop is forcibly broken and reset within 30 seconds).*
3. **SFT/DPO Failure-Recovery Pipeline Execution**: Halt "golden path" fine-tuning. Immediately pipeline the identified failure traces (e.g., capability handle errors, route loops) into an SFT dataset to teach the local models (Qwen) native error recovery. *(Acceptance check: At least 100 validated failure-to-recovery instruction pairs are generated and staged for local model fine-tuning).*

## Risk if Ignored
Attempting to scale to 1,000,000 steps without resolving capability-handle fragility and route-thrashing guarantees catastrophic pipeline failure within the first few dozen iterations. The Dual-Brain system will indefinitely exhaust compute resources spinning on sterile `HYPERCORE_ROUTE` loops, completely invalidating any long-run operational benchmarks and proving the OS incapable of true autonomous recovery.
