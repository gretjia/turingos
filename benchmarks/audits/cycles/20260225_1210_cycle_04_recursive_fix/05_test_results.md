# Cycle 04 Test Results (Recursive Fix Validation)

- Source JSON: benchmarks/results/os-longrun-20260225-121050.json
- Source Markdown: benchmarks/results/os-longrun-20260225-121050.md
- Command log: benchmarks/audits/cycles/20260225_1210_cycle_04_recursive_fix/04_test_commands.txt
- External instability marker: Kimi API 500 count in run log = 50

## Summary
```json
{
  "runStamp": "20260225-121050",
  "model": "kimi-for-coding",
  "repeats": 1,
  "runs": 3,
  "passed": 0,
  "completion_avg": 0,
  "plan_avg": 0.3968,
  "drift_avg": 0,
  "traps_avg": {
    "WATCHDOG_NMI": 1,
    "CPU_FAULT": 20,
    "IO_FAULT": 0,
    "PAGE_FAULT": 0
  },
  "per_scenario": [
    {
      "id": "fault_recovery_resume",
      "name": "Fault Recovery Resume",
      "runs": 1,
      "passRate": 0,
      "completionAvg": 0,
      "completionP50": 0,
      "completionP90": 0,
      "planAvg": 0,
      "driftAvg": 0,
      "haltedRate": 0,
      "maxTickRate": 1,
      "watchdogAvg": 2
    },
    {
      "id": "long_checklist_stability",
      "name": "Long Checklist Stability",
      "runs": 1,
      "passRate": 0,
      "completionAvg": 0,
      "completionP50": 0,
      "completionP90": 0,
      "planAvg": 0.3333,
      "driftAvg": 0,
      "haltedRate": 0,
      "maxTickRate": 1,
      "watchdogAvg": 1
    },
    {
      "id": "pipeline_ordered_execution",
      "name": "Pipeline Ordered Execution",
      "runs": 1,
      "passRate": 0,
      "completionAvg": 0,
      "completionP50": 0,
      "completionP90": 0,
      "planAvg": 0.8571,
      "driftAvg": 0,
      "haltedRate": 0,
      "maxTickRate": 1,
      "watchdogAvg": 0
    }
  ]
}
```

## Compare vs Cycle 03
```json
{
  "passed_before": 0,
  "passed_after": 0,
  "completion_before": 0,
  "completion_after": 0,
  "completion_delta": 0,
  "plan_before": 0.6984,
  "plan_after": 0.3968,
  "plan_delta": -0.3016,
  "watchdog_before": 0,
  "watchdog_after": 1,
  "watchdog_delta": 1,
  "cpu_fault_before": 0,
  "cpu_fault_after": 20,
  "cpu_fault_delta": 20,
  "page_fault_before": 6.3333,
  "page_fault_after": 0,
  "page_fault_delta": -6.3333,
  "io_fault_before": 3,
  "io_fault_after": 0,
  "io_fault_delta": -3
}
```
