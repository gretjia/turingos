# TuringOS OS Long-Run Report

- Runs: 3
- Passed: 0/3
- Avg completion_score: 0
- Avg plan_adherence: 1
- Avg pointer_drift_rate: 0

## Scenario Distribution

| Scenario | Runs | pass_rate | completion_avg | completion_p50 | completion_p90 | plan_avg | drift_avg | halted_rate | max_tick_rate | watchdog_avg |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| fault_recovery_resume | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| long_checklist_stability | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| pipeline_ordered_execution | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |

## Per Run Detail

| Repeat | Scenario | Pass | completion | plan | drift | halted | max_tick | PAGE_FAULT | CPU_FAULT | WATCHDOG_NMI |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | pipeline_ordered_execution | N | 0 | 1 | 0 | N | Y | 0 | 0 | 0 |
| 1 | fault_recovery_resume | N | 0 | 1 | 0 | N | Y | 13 | 7 | 0 |
| 1 | long_checklist_stability | N | 0 | 1 | 0 | N | Y | 2 | 1 | 0 |

## Artifacts

- JSON: `/home/zephryj/projects/turingos/benchmarks/results/os-longrun-20260225-131400.json`
- Markdown: `/home/zephryj/projects/turingos/benchmarks/results/os-longrun-20260225-131400.md`
