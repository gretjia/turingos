# Cycle 03 Scope

## Objective
Recover page-fault stability while preserving Cycle 02 plan-adherence gains.

## Baseline (from Cycle 02)
- passed=0/3
- completion_avg=0.0333
- plan_avg=0.619
- watchdog_avg=0
- page_fault_avg=7.6667
- Source: `benchmarks/audits/cycles/20260225_1039_cycle_02/05_test_results.md`

## In-Scope
1. Simplify prompt JSON contract (remove hard requirement of stack fields).
2. Add execution-contract gate: disallow DONE progression when required artifact for that step is missing.
3. Keep existing NEXT_REQUIRED_DONE guidance and append ordering guard.
4. Re-run identical os-longrun benchmark and compare against Cycle 02.

## Acceptance Gate
- page_fault_avg <= 3.6667 (at least back to Cycle 01 post level) OR significant drop vs Cycle 02.
- plan_avg >= 0.60.
- watchdog_avg remains 0.
