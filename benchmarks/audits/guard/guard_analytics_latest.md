# Guard Analytics Report

- stamp: 20260304_041914
- pass: true
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/guard/guard_analytics_20260304_041914.json

## Checks

| Check | Result | Details |
|---|---|---|
| trap_frame_schema_valid | PASS | schema_valid_rate=1 |
| thrashing_trap_detected | PASS | thrashing_frames=1 |
| panic_reset_engages_under_cpu_fault_loop | PASS | cpu_fault_frames=8, panic_reset_frames=7 |
| panic_reset_rate_bounded | PASS | panic_reset_frames=7 (expected <= 7 within 12 ticks) |

## Metrics

- total_trap_frames: 17
- schema_valid_rate: 1
- cpu_fault_frames: 8
- thrashing_frames: 1
- panic_reset_frames: 7
- unrecoverable_frames: 0

## Scenario Workspaces

- thrashing: /tmp/turingos-guard-thrashing-SjhE7W
- panic_budget: /tmp/turingos-guard-panic_budget-Wg1a5q

