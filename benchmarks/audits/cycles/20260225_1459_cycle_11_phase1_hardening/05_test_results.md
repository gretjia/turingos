# Test Results

## Round Metrics

| Label | runStamp | passed | completion_avg | plan_avg | IO_FAULT avg | PAGE_FAULT avg | CPU_FAULT avg | WATCHDOG avg |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| baseline_cycle10 | 20260225-135210 | 0 | 0.0833 | 0.3770 | 3.6667 | 3.6667 | 0.3333 | 0.0000 |
| round1_engine_oracle_hardening | 20260225-144127 | 0 | 0.0000 | 0.4048 | 4.6667 | 4.0000 | 0.0000 | 0.0000 |
| round2_add_done_content_gate | 20260225-145052 | 0 | 0.0833 | 0.2183 | 4.6667 | 5.6667 | 0.0000 | 0.0000 |
| round3_add_mismatch_diagnostics | 20260225-145907 | 0 | 0.0000 | 0.1706 | 4.3333 | 3.0000 | 0.3333 | 0.6667 |

## Evidence Extracts

1. DONE content gate successfully blocks false completion:

```text
[OS_TRAP: IO_FAULT] Failed to write to sys://append/plan/progress.log: required file content mismatch for DONE:WRITE_INPUT -> artifacts/input.csv.
Action: append exact line DONE:WRITE_INPUT once.
```

Source: `benchmarks/os-longrun/workspaces/pipeline_ordered_execution-20260225-145052-r1/.reg_q`

2. Strict progress gate catches semantic drift on checklist content:

```text
[OS_TRAP: IO_FAULT] Failed to write to sys://append/plan/progress.log: Progress strictly requires DONE:M01, got "Milestone 01: Initialization complete. System bootstrap successful.".
Action: append exact line DONE:M01 once.
```

Source: `benchmarks/os-longrun/workspaces/long_checklist_stability-20260225-145907-r1/.reg_q`

3. Deep loop still occurs (watchdog evidence):

```text
[Tick] d:sys://trap/watchdog -> d':sys://append/plan/progress.log | RECOVER_SOURCE → COUNT → RESULT → HALT
```

Source: `benchmarks/os-longrun/workspaces/fault_recovery_resume-20260225-145907-r1/.journal.log`

## Assessment

- Safety invariants improved (false DONE accepted less often).
- End-to-end mission completion did not improve (pass rate remains 0/3).
- Main unresolved bottleneck remains: repeated append/repair loops around progress gate and exact-text artifact generation.
