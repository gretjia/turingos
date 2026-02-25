# Cycle 01 Decision

## Verdict
Go (with constraints)

## Decision basis

### 1) Unexpected code changes handling
- Decision: **keep** the pre-existing oracle refactor (`universal-oracle.ts`, `boot.ts`, removed `kimi-code-oracle.ts`).
- Reason: changes are coherent, compile successfully, and runtime smoke test passes.
- Evidence:
  - `04_test_commands.txt` (`npm run typecheck`, `npm run smoke:mock` passed)
  - `03_diff.patch` (no broken imports after refactor)

### 2) Benchmark outcome
- Baseline: `passed=0/3`, `completion_avg=0`, `plan_avg=0.3333`, `watchdog_avg=0.3333`, `page_fault_avg=17.3333`
- Post-change: `passed=0/3`, `completion_avg=0.0333`, `plan_avg=0.2937`, `watchdog_avg=0`, `page_fault_avg=3.6667`
- Net effect:
  - Positive: loop/crash-related stability improved significantly (`WATCHDOG_NMI` eliminated, `PAGE_FAULT` sharply reduced).
  - Negative: mission-level completion remains weak and pass rate did not improve.
- Evidence:
  - Baseline: `baseline_os_longrun.json`, `05_test_results.md`
  - Post: `post_os_longrun.json`, `05_test_results_after.md`
  - Delta: `metrics_compare.json`

### 3) Independent audit
- Gemini independent conclusion: **Go**.
- Rationale: acceptance gate satisfied (critical failure modes reduced), but planning quality needs next-cycle work.
- Evidence:
  - `06_gemini_audit.md`

## What is accepted in this cycle
- thought->json protocol support (transition schema + parser support)
- MMU truncation guard and page fault details enrichment
- L1 short-loop pre-watchdog trap (`L1_CACHE_HIT`)
- OS-managed `sys://callstack` channel + stack syscall handling

## What remains unresolved (carry to Cycle 02)
1. Increase plan adherence above baseline while keeping watchdog/pagefault gains.
2. Raise completion and scenario pass rate (target at least one scenario pass > 0).
3. Refine prompt/examples so stack operations do not distract from strict contract steps.

## Cycle 02 entry criteria
- Keep `WATCHDOG_NMI = 0` and `PAGE_FAULT < 5`.
- Push `plan_avg > 0.35` and `completion_avg > 0.2` OR `pass > 0/3`.
