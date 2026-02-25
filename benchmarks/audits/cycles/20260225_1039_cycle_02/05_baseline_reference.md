# Test Results (Post-change)

- Source JSON: benchmarks/results/os-longrun-20260225-101154.json
- Source Markdown: benchmarks/results/os-longrun-20260225-101154.md
- Raw command log: benchmarks/audits/cycles/20260225_0959_cycle_01/04_test_commands_after.txt

## Key Metrics

```json
{
  "runStamp": "20260225-101154",
  "model": "kimi-for-coding",
  "repeats": 1,
  "runs": 3,
  "passed": 0,
  "completion_avg": 0.0333,
  "plan_avg": 0.2937,
  "drift_avg": 0,
  "traps_avg": {
    "WATCHDOG_NMI": 0,
    "CPU_FAULT": 0,
    "IO_FAULT": 0,
    "PAGE_FAULT": 3.6667
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
      "planAvg": 0.1429,
      "driftAvg": 0,
      "haltedRate": 0,
      "maxTickRate": 1,
      "watchdogAvg": 0
    },
    {
      "id": "long_checklist_stability",
      "name": "Long Checklist Stability",
      "runs": 1,
      "passRate": 0,
      "completionAvg": 0.1,
      "completionP50": 0.1,
      "completionP90": 0.1,
      "planAvg": 0.1667,
      "driftAvg": 0,
      "haltedRate": 0,
      "maxTickRate": 1,
      "watchdogAvg": 0
    },
    {
      "id": "pipeline_ordered_execution",
      "name": "Pipeline Ordered Execution",
      "runs": 1,
      "passRate": 0,
      "completionAvg": 0,
      "completionP50": 0,
      "completionP90": 0,
      "planAvg": 0.5714,
      "driftAvg": 0,
      "haltedRate": 0,
      "maxTickRate": 1,
      "watchdogAvg": 0
    }
  ]
}
```

## Baseline vs Post

```json
{
  "passed_before": 0,
  "passed_after": 0,
  "completion_before": 0,
  "completion_after": 0.0333,
  "completion_delta": 0.0333,
  "plan_before": 0.3333,
  "plan_after": 0.2937,
  "plan_delta": -0.0396,
  "drift_before": 0,
  "drift_after": 0,
  "drift_delta": 0,
  "watchdog_before": 0.3333,
  "watchdog_after": 0,
  "watchdog_delta": -0.3333,
  "page_fault_before": 17.3333,
  "page_fault_after": 3.6667,
  "page_fault_delta": -13.6666
}
```
