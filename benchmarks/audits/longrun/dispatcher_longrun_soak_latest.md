# Dispatcher Longrun Soak Report

- stamp: 20260227_033313
- workspace: /tmp/turingos-longrun-dispatcher-PCMOSW
- pass: true
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/dispatcher_longrun_soak_20260227_033313.json

## Metrics

- ticks_requested: 1200
- ticks_observed: 1200
- route_samples: 1200
- route_coverage: 1
- route_p_samples: 560
- route_e_samples: 640
- route_failovers: 0
- cpu_fault_count: 0
- unrecoverable_loop_count: 0

## Checks

| Check | Result | Details |
|---|---|---|
| ticks_observed_>=_1000 | PASS | ticks_observed=1200 |
| route_coverage_>=_0.99 | PASS | coverage=1 |
| dual_lane_usage | PASS | p_samples=560, e_samples=640 |
| no_cpu_fault_or_unrecoverable_loop | PASS | cpu_fault=0, unrecoverable=0 |

