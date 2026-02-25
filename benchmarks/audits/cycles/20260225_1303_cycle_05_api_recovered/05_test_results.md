# Cycle 05 Test Results (API Recovered)

- Source JSON: benchmarks/results/os-longrun-20260225-130356.json
- Source Markdown: benchmarks/results/os-longrun-20260225-130356.md
- Command log: benchmarks/audits/cycles/20260225_1303_cycle_05_api_recovered/04_test_commands.txt
- API health gate at start: NORMAL

## Summary
```json
{
  "runStamp": "20260225-130356",
  "model": "kimi-for-coding",
  "repeats": 1,
  "runs": 3,
  "passed": 0,
  "completion_avg": 0,
  "plan_avg": 0.877,
  "drift_avg": 0,
  "traps_avg": {
    "WATCHDOG_NMI": 0,
    "CPU_FAULT": 0,
    "IO_FAULT": 0,
    "PAGE_FAULT": 1.3333
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
      "planAvg": 0.8571,
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
      "completionAvg": 0,
      "completionP50": 0,
      "completionP90": 0,
      "planAvg": 0.9167,
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
      "planAvg": 0.8571,
      "driftAvg": 0,
      "haltedRate": 0,
      "maxTickRate": 1,
      "watchdogAvg": 0
    }
  ],
  "results": [
    {
      "repeat": 1,
      "id": "pipeline_ordered_execution",
      "name": "Pipeline Ordered Execution",
      "maxTicks": 28,
      "exitCode": 2,
      "elapsedMs": 89019,
      "halted": false,
      "maxTickHit": true,
      "ticksObserved": 21,
      "completionScore": 0,
      "planAdherence": 0.8571,
      "pointerDriftRate": 0,
      "invalidPointerCount": 0,
      "trapCounts": {
        "PAGE_FAULT": 0,
        "CPU_FAULT": 0,
        "IO_FAULT": 0,
        "WATCHDOG_NMI": 0
      },
      "mustContainTrapSatisfied": true,
      "suspiciousFiles": [],
      "finalQ": "7.create_final_artifact 8.append_done_7 9.halt",
      "finalD": "artifacts/final_artifact.txt",
      "fileChecks": [
        {
          "path": "artifacts/input.csv",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "artifacts/high.csv",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "artifacts/sum.txt",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "artifacts/manifest.txt",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "result/RESULT.json",
          "passed": false,
          "reason": "missing file"
        }
      ],
      "pass": false
    },
    {
      "repeat": 1,
      "id": "fault_recovery_resume",
      "name": "Fault Recovery Resume",
      "maxTicks": 28,
      "exitCode": 2,
      "elapsedMs": 83198,
      "halted": false,
      "maxTickHit": true,
      "ticksObserved": 23,
      "completionScore": 0,
      "planAdherence": 0.8571,
      "pointerDriftRate": 0,
      "invalidPointerCount": 0,
      "trapCounts": {
        "PAGE_FAULT": 4,
        "CPU_FAULT": 0,
        "IO_FAULT": 0,
        "WATCHDOG_NMI": 0
      },
      "mustContainTrapSatisfied": true,
      "suspiciousFiles": [],
      "finalQ": "STEP_7_INFER_CREATE: write b52ecd6b199f → STEP_7_INFER_DONE: append DONE:HALT",
      "finalD": "b52ecd6b199f",
      "fileChecks": [
        {
          "path": "inputs/source.txt",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "outputs/colors_upper.txt",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "outputs/count.txt",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "result/RESULT.json",
          "passed": false,
          "reason": "missing file"
        }
      ],
      "pass": false
    },
    {
      "repeat": 1,
      "id": "long_checklist_stability",
      "name": "Long Checklist Stability",
      "maxTicks": 36,
      "exitCode": 2,
      "elapsedMs": 111210,
      "halted": false,
      "maxTickHit": true,
      "ticksObserved": 26,
      "completionScore": 0,
      "planAdherence": 0.9167,
      "pointerDriftRate": 0,
      "invalidPointerCount": 0,
      "trapCounts": {
        "PAGE_FAULT": 0,
        "CPU_FAULT": 0,
        "IO_FAULT": 0,
        "WATCHDOG_NMI": 0
      },
      "mustContainTrapSatisfied": true,
      "suspiciousFiles": [],
      "finalQ": "IDENTIFY_GAP|COMPLETE_MISSING|APPEND_DONE|HALT",
      "finalD": "sys://trap/halt_guard?details=HALT%20rejected%3A%20acceptance%20contract%20not%20satisfied.%0ADetails%3A%20Plan%20incomplete%20for%20HALT.%20done%3D11%20required%3D12.%0AAction%3A%20Complete%20remaining%20plan%20steps%20and%20required%20files%2C%20then%20HALT.",
      "fileChecks": [
        {
          "path": "milestones/m01.txt",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "milestones/m02.txt",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "milestones/m03.txt",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "milestones/m04.txt",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "milestones/m05.txt",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "milestones/m06.txt",
          "passed": false,
          "reason": "missing file"
        },
        {
          "path": "milestones/m07.txt",
          "passed": false,
          "reason": "missing file"
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
  "plan_after": 0.877,
  "plan_delta": 0.1786,
  "drift_before": 0,
  "drift_after": 0,
  "drift_delta": 0,
  "watchdog_before": 0,
  "watchdog_after": 0,
  "watchdog_delta": 0,
  "cpu_fault_before": 0,
  "cpu_fault_after": 0,
  "cpu_fault_delta": 0,
  "io_fault_before": 3,
  "io_fault_after": 0,
  "io_fault_delta": -3,
  "page_fault_before": 6.3333,
  "page_fault_after": 1.3333,
  "page_fault_delta": -5
}
```
