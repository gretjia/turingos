# Cycle 02 Scope

## Objective
Increase plan adherence and scenario completion without regressing stability gains from Cycle 01.

## Baseline for this cycle
- Use Cycle 01 post-change metrics as baseline:
  - passed=0/3
  - completion_avg=0.0333
  - plan_avg=0.2937
  - watchdog_avg=0
  - page_fault_avg=3.6667
- Source: `benchmarks/audits/cycles/20260225_0959_cycle_01/05_test_results_after.md`

## In-Scope
1. Inject explicit contract guidance (`NEXT_REQUIRED_DONE`) into each tick context.
2. Guard `sys://append/plan/progress.log` writes with order validation/normalization.
3. Keep Cycle 01 gains (`WATCHDOG_NMI=0`, low `PAGE_FAULT`).
4. Re-run same `bench:os-longrun` and compare metrics.

## Out-of-Scope
- Rewriting benchmark tasks.
- Large architecture rewrites outside engine/manifold/prompt/contract interfaces.

## Acceptance Gate
- No regression in watchdog/page-fault stability.
- Improvement in at least one of:
  - `plan_avg`
  - `completion_avg`
  - scenario pass count
