# TuringClaw Research Notes

Reference analyzed: `https://github.com/gretjia/turingclaw`

## What works

1. Clear computational model: the runtime repeatedly computes `delta(q, s)` and persists state.
2. Physical persistence: `.reg_q` and `.reg_d` survive crashes and enable restart continuity.
3. Resilience controls:
   - hard stdout truncation
   - command timeout kill
   - cycle breaker for repeated identical outputs
4. Strong empirical mindset: benchmark harnesses emulate crash/restart and noisy environments.

## What should be improved for TuringOS

1. Split concerns: current engine combines model provider logic, execution physics, and UI hooks.
2. Tighten types and contracts: parse discipline and transition validation should live in dedicated modules.
3. Normalize trap channels: page/cpu/io/watchdog should be explicit OS-level signals.
4. Make manifold behavior explicit: command failures should be first-class data slices, not thrown flow-control exceptions.
5. Decouple from single product narrative: use provider-agnostic oracles and testable mock adapters.

## TuringOS extraction decisions

1. Keep the deterministic tick kernel.
2. Keep register persistence as default.
3. Move model invocation into `IOracle`.
4. Move file/command operations into `IPhysicalManifold`.
5. Use `IChronos` for append-only journaling.
6. Add watchdog hash loop detection directly in the kernel.
