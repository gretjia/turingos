# Cycle 04 Scope (Recursive Fix)

## Objective
Apply recursive-audit fix:
1) Remove hard blockingRequiredFile interception and implicit step->file mapping.
2) Restore strict syscall contract (`stack_op` mandatory).

## Baseline
- Compare against Cycle 03 results.
- Source: `benchmarks/audits/cycles/20260225_1053_cycle_03/05_test_results.md`

## Acceptance (this quick validation)
- No watchdog regression.
- completion should not collapse due to IO fault gate.
- observe page_fault and plan changes after strict stack syscall restoration.
