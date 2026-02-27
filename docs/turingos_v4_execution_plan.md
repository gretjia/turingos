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

### 2026-02-27 Week-3 Dispatcher MVP Completed
- Added dispatcher runtime lane:
  - `src/oracle/dispatcher-oracle.ts`
  - static P/E routing with context-based escalation and health-score fallback
  - deterministic failover from E->P on routine lane failure
- Kernel route journaling added:
  - `src/kernel/engine.ts` now emits `[BUS_ROUTE] {json}` when oracle supports route telemetry
- Boot/runtime lane configuration added:
  - `src/runtime/boot.ts`
  - `TURINGOS_DISPATCHER_ENABLED`
  - `TURINGOS_DISPATCHER_{P,E}_{ORACLE,MODEL,BASE_URL,API_KEY}`
- Dispatcher gate added:
  - `src/bench/dispatcher-gate.ts`
  - `npm run bench:dispatcher-gate`
- Validation:
  - `npm run typecheck` PASS
  - `npm run bench:dispatcher-gate` PASS
  - `npm run bench:topology-v4-gate` PASS
- Dual-pass audit:
  - Gemini audit: GO (routing logic, failover, deterministic route logs).

### 2026-02-27 Week-4 Long-run Integration Completed
- Long-run harness upgraded for integrated routing telemetry:
  - `src/bench/os-longrun.ts`
  - new CLI runtime overrides: `--oracle`, `--dispatcher`
  - added route metrics: coverage, P/E lane rate, failover count
- Added 1000+ tick deterministic soak benchmark:
  - `src/bench/longrun-dispatcher-soak.ts`
  - `npm run bench:longrun-dispatcher-soak`
- Added Mac execution command pack:
  - `handover/mac_longrun_command_pack_20260227.md`
- Validation:
  - `npm run bench:longrun-dispatcher-soak` PASS (1200 ticks, route coverage=1.0, cpu_fault=0, unrecoverable=0)
  - `npm run bench:ci-gates` PASS
- Dual-pass audit:
  - Gemini audit: GO (runtime overrides + route metrics + 1000+ tick evidence).

### 2026-02-27 Step-5 Guard SFT Pipeline Completed
- Added guard SFT dataset builder:
  - `src/bench/guard-sft-dataset.ts`
  - outputs policy and trap-reflex datasets from `REPLAY_TUPLE` + `TRAP_FRAME`
- Added script:
  - `npm run bench:guard-sft-dataset`
- Latest generated artifacts:
  - `benchmarks/data/sft/guard_policy_20260227_033312.jsonl`
  - `benchmarks/data/sft/guard_reflex_20260227_033312.jsonl`
  - `benchmarks/audits/sft/guard_sft_dataset_latest.json`
- Validation:
  - `npm run typecheck` PASS
  - `npm run bench:guard-sft-dataset` PASS (`policy_rows=537`, `reflex_rows=25`, `scanned_traces=59`)
- Dual-pass audit:
  - Gemini audit: GO (policy extraction + trap-to-recovery mapping + reproducible latest pointer).

### 2026-02-27 Phase-6 Bus Protocol Formalization Completed
- Added versioned Turing Bus contract schema:
  - `schemas/turing-bus.frame.v1.json`
- Added provider adapter layer for bus-frame normalization:
  - `src/oracle/turing-bus-adapter.ts`
  - OpenAI/Kimi/Ollama response extraction to canonical `QxS -> AxQ` transition.
- Refactored universal oracle to use bus adapter:
  - `src/oracle/universal-oracle.ts`
  - provider inference for OpenAI-compatible local Ollama endpoints.
- Added bus conformance gate:
  - `src/bench/turing-bus-conformance.ts`
  - `npm run bench:turing-bus-conformance`
  - wired into `bench:ci-gates`
- Validation:
  - `npm run typecheck` PASS
  - `npm run bench:turing-bus-conformance` PASS
  - `npm run bench:ci-gates` PASS
- Dual-pass audit:
  - Gemini audit: GO (schema versioning + multi-provider adapter + CI conformance coverage).
