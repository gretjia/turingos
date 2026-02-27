# TuringOS v4 Joint Execution Plan (Codex + Gemini)

Last updated: 2026-02-27
Owner: Codex (implementation) + Gemini (independent audit)
Goal: stabilize v4 topology execution loop, then evolve to Dispatcher + Guard MCU.

## North Star
- Keep ISA fail-closed and mutually exclusive.
- Keep q_t as O(1) runqueue with clear ACTIVE/SUSPENDED/BLOCKED semantics.
- Make long-run failures diagnosable and recoverable, not silent.

## Phase Order
1. Protocol First (Schema Governance)
2. Guard Next (Modelized Trap Handling)
3. Bus Last (P-Core / E-Core Dispatcher)

## 4-Week Plan

### Week 1 - Protocol Standardization
- Externalize syscall schema into versioned source-of-truth.
- Unify parser/validator against that schema (engine + oracle + bench).
- Build adversarial syscall fixtures and gate in CI.

Acceptance gates:
- 50+ malformed syscall samples intercepted 100%.
- 0 silent fallback of unknown keys.
- One canonical opcode list used across runtime/bench prompts.

### Week 2 - Turing Guard MVP
- Add Guard lane to convert trap text into structured recovery context.
- Stop repeated CPU_FAULT/panic loops through bounded corrective guidance.
- Emit machine-readable trap frames for replay analysis.

Acceptance gates:
- 10 forced ABI-violation scenarios: repeated panic loops drop below 20%.
- Trap context format stable and replayable.

### Week 3 - Bus Dispatcher MVP
- Introduce static P/E routing by instruction class + health score.
- E-core handles routine ticks; P-core handles escalated recovery.
- Add deterministic route logs per tick.

Acceptance gates:
- Route decision coverage 100%.
- Escalation triggers fire exactly on configured conditions.

### Week 4 - Long-run Integration
- Re-run os-longrun with integrated schema + guard + dispatcher pipeline.
- Track tick throughput, fatal trap rate, and recovery success rate.

Acceptance gates:
- 1000+ ticks without permanent unrecoverable CPU fault.
- Fatal ABI loop count = 0 in controlled benchmark set.

## Operating Mode (Dual-LLM)
- Codex: code changes, test execution, rollback safety.
- Gemini: independent audit of failure signatures, weekly go/no-go.
- Merge rule: implementation proceeds only after dual pass (impl + audit).

## Immediate Next Actions
1. Land Week-1 schema source-of-truth and replace duplicated validators.
2. Add adversarial syscall fixture set and gate script.
3. Re-run topology-v4 gate + staged acceptance + ci-gates.

## Execution Log
### 2026-02-27 Week-1 Completed
- Added single syscall source-of-truth: `src/kernel/syscall-schema.ts`.
- Refactored parser/validator consumers:
  - `src/oracle/universal-oracle.ts` now uses shared normalization.
  - `src/kernel/engine.ts` now uses shared canonical envelope validation.
  - Prompt builders now reuse shared opcode docs (`ac41b-local-alu-eval.ts`, `ac42-deadlock-reflex.ts`, `runtime/boot.ts` fallback).
- Added adversarial fixture gate:
  - Fixtures: `src/bench/fixtures/syscall-adversarial.ts`
  - Gate runner: `src/bench/syscall-schema-gate.ts`
  - NPM script: `bench:syscall-schema-gate`
  - `bench:ci-gates` now runs schema gate first.
- Fixed fail-closed gap for `SYS_WRITE.semantic_cap` type validation (parser + canonical validator).
- Latest gate evidence:
  - `benchmarks/audits/protocol/syscall_schema_gate_latest.json` (`invalid=59/59`, `mutex=21/21`, `PASS`)
  - `benchmarks/audits/recursive/staged_acceptance_recursive_20260227_025214.json` (AC2.1~AC3.2 all PASS)
- Dual-pass audit:
  - Gemini pass-1 found `semantic_cap` type gap (NO-GO), fixed.
  - Gemini pass-2 reported no high/medium findings (GO).

### 2026-02-27 Week-2 Guard MVP Started
- Guard lane minimum implementation landed in runtime engine:
  - machine-readable trap frame emission to journal: `[TRAP_FRAME] {json}`
  - trap state now carries parser-friendly frame block: `[OS_TRAP_FRAME_JSON]`
  - bounded panic-reset budget (`maxPanicResets=2`) with fail-closed stop route (`HALT`) via `sys://trap/unrecoverable_loop`
  - panic budget auto-resets when pointer exits `sys://trap/*`
- Refactored trap return paths to use centralized helper in engine for structured trap logging.
- Gate hardening:
  - `topology-v4-gate` now asserts thrashing scenario emits both trap-state JSON block and journal trap frame.
- Validation:
  - `npm run typecheck` PASS
  - `npm run bench:topology-v4-gate` PASS (8/8)
  - `npm run bench:syscall-schema-gate` PASS (59/59 malformed reject)
  - `npm run bench:staged-acceptance-recursive` PASS
  - `npm run bench:ci-gates` PASS
