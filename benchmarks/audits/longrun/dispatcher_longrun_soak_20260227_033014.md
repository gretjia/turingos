# Dispatcher Longrun Soak Report

- stamp: 20260227_033014
- workspace: /tmp/turingos-longrun-dispatcher-gS9NQF
- pass: false
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/dispatcher_longrun_soak_20260227_033014.json

## Metrics

- ticks_requested: 1200
- ticks_observed: 640
- route_samples: 1200
- route_coverage: 1.875
- route_p_samples: 560
- route_e_samples: 640
- route_failovers: 0
- cpu_fault_count: 0
- unrecoverable_loop_count: 0

## Checks

| Check | Result | Details |
|---|---|---|
| ticks_observed_>=_1000 | FAIL | ticks_observed=640 |
| route_coverage_>=_0.99 | PASS | coverage=1.875 |
| dual_lane_usage | PASS | p_samples=560, e_samples=640 |
| no_cpu_fault_or_unrecoverable_loop | PASS | cpu_fault=0, unrecoverable=0 |

