# Dual-Brain Stability Fix Iteration (2026-02-28)

## Scope
This iteration implemented kernel/parser hardening based on observed failures in `turingos_dualbrain` baseline runs.

## Implemented Fixes
1. `src/kernel/scheduler.ts`
- Added capability-handle auto recovery for `SYS_WRITE`:
  - Detect unknown `vfd://...` handles.
  - Issue replacement handle via `sys://cap/issue/...`.
  - Retry write and cache alias mapping.
- Added anti-thrashing controls:
  - `noPhysicalStreak` trap for excessive non-physical ticks.
  - route fingerprint stall trap (`TRAP_ROUTE_THRASHING`).
- Added managed trap recovery paths (no immediate red-flag kill) for:
  - thrashing traps,
  - capability traps,
  - empty runqueue MOVE/POP/EDIT traps.
- Added planner/worker temperature env controls:
  - `TURINGOS_HYPERCORE_PLANNER_TEMPERATURE`
  - `TURINGOS_HYPERCORE_WORKER_TEMPERATURE`

2. `src/oracle/turing-bus-adapter.ts`
- VLIW lane coercion:
  - misplaced world/system ops in `mind_ops` are re-routed to world lane.
  - misplaced mind ops in world lane are re-routed to mind lane.
- Added compatibility parsing for incomplete transition envelopes:
  - accept frames with syscall payload but missing `q_next` by defaulting `q_next=''`.
  - accept bare syscall-like frames via fallback path.

3. `src/bench/million-baseline-compare.ts`
- Failure artifact enrichment retained.
- Dual-brain answer parsing aligned to direct baselines:
  - parse `ANSWER.txt` with `parseAnswer(...)` (numeric extraction tolerant), not strict first-line literal.
- Added baseline-specific discipline prompt to reduce repo-archaeology behavior in arithmetic micro-bench mode.
- Kept initial pointer default as `MAIN_TAPE.md` (reverted failed attempt to default `ANSWER.txt`).

## Key Evidence During Fix Run
- Capability recovery proof observed in journals:
  - `[HYPERCORE_CAP_RECOVERY] ... unknown=vfd://rw/ANSWER.txt ... issued=vfd://rw/.../ANSWER.txt`
- Thrashing breaker observed:
  - `[HYPERCORE_TRAP_RECOVERY] ... kind=thrashing ...`

## Baseline Snapshots (same day)
- Pre-fix hard failure example:
  - `benchmarks/audits/baseline/million_baseline_compare_20260228_074721.json`
  - `consecutive=0`
- After parser compatibility + recovery hardening:
  - `benchmarks/audits/baseline/million_baseline_compare_20260228_075003.json`
  - `consecutive=1`

## Current Assessment
- Fixes are active and observable in runtime traces.
- System remains far from target baseline quality for dual-brain path.
- Dominant remaining failure class:
  - Planner emits non-canonical multi-block output and/or over-plans without reaching guaranteed physical write within tick budget.

## Next Fix Targets
1. Add strict ALU output contract mode for baseline micro-bench:
- enforce single JSON frame only; reject prose payload before route.
2. Add deterministic write-first fallback when objective includes `Write <N> to ANSWER.txt` and no physical op has occurred within N ticks.
3. Increase dual-brain tick budget for measurement runs (separate from chaos runs), while keeping trap telemetry enabled.
