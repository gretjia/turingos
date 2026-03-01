# Dual-LLM Joint Action Plan (From Core Architect Opinion)

- Date: 2026-02-28
- Working Group: Codex + Gemini (independent recursive audit)
- Canonical input: `handover/artitecture_response/core_architect_opinion_anti_oreo_v2_20260228.md`
- Gemini independent plan: `handover/artitecture_response/gemini_independent_action_plan_from_core_opinion_20260228.md`

## 1) Objective
Upgrade TuringOS kernel from the current single-loop execution model to a Hyper-Core scheduler aligned to ⚪⚫⚪ (Top White-Box / Middle Black-Box / Bottom White-Box), including:
- PCB-based scheduling and process isolation
- Heterogeneous dual-brain oracle routing (`PLANNER` vs `WORKER`)
- `SYS_MAP_REDUCE` for fork/join execution
- deterministic `SYS_HALT` pricing gate (no LLM valuation)

## 2) Non-Negotiables (Locked)
1. Top white-box is authoritative for state, scheduling, traps, and HALT pricing.
2. Middle black-box only proposes actions; it never self-certifies completion.
3. Bottom white-box executes deterministic syscalls only.
4. `SYS_HALT` policy:
   - Human + AI co-define test standard once at initialization.
   - After lock-in, no human participation in HALT decisions.
   - HALT pass/fail is decided only by deterministic verifier command.
5. Red-flag kill policy remains hard (`>=3` malformed/invalid frames => `KILLED`).

## 3) Current-State Gap (Repo-Specific)
- Existing runtime has mature kernel/oracle paths (`src/kernel/engine.ts`, `src/oracle/universal-oracle.ts`) and VLIW ABI checks.
- Missing architectural primitives for this upgrade:
  - explicit PCB table + scheduler states (`READY/RUNNING/BLOCKED/PENDING_HALT/...`)
  - dedicated dual-brain routing abstraction
  - first-class fork/join map-reduce syscall path
  - one-time HALT policy lock and fully automated post-lock pricing loop

## 4) Implementation Phases

### Phase 0 - Baseline Freeze and Safety Rails
- Actions:
  - freeze current green/known baseline reports
  - add feature flag `TURINGOS_HYPERCORE_V2=1`
  - keep legacy path as rollback target
- Files:
  - `src/runtime/boot.ts`
  - `package.json` (new bench/boot scripts)
- Exit gate:
  - legacy behavior unchanged with feature flag off

### Phase 1 - Kernel Types and State Model
- Actions:
  - add/extend process state and role enums
  - add PCB interface and runqueue metadata (`waitPids`, `mailbox`, `price`, `redFlags`)
- Files:
  - `src/kernel/types.ts`
- Exit gate:
  - typecheck clean, no legacy import breakage

### Phase 2 - Syscall Contract Upgrade (`SYS_MAP_REDUCE`)
- Actions:
  - extend syscall schema with `SYS_MAP_REDUCE`
  - add parser validation for task array payload
  - reject malformed map-reduce envelopes fail-closed
- Files:
  - `schemas/syscall-frame.v5.json`
  - `src/kernel/syscall-schema.ts`
  - `src/oracle/turing-bus-adapter.ts`
- Exit gate:
  - contract conformance tests include positive and negative map-reduce cases

### Phase 3 - Dual-Brain Oracle
- Actions:
  - add `DualBrainOracle` dispatcher abstraction
  - route planner to cloud profile and worker to local profile
  - enforce role-specific temperature and endpoint policy
  - hardcode temperatures: `PLANNER=0.7`, `WORKER=0.0`
- Files:
  - `src/oracle/dual-brain-oracle.ts` (new)
  - `src/runtime/boot.ts` (wiring)
- Exit gate:
  - trace logs show role-aware routing with expected model lane per role

### Phase 4 - Hyper-Core Scheduler and Fork/Join
- Actions:
  - add scheduler class with runqueue and context switching
  - implement `spawn`, `schedule`, `resolveJoin`, blocked wake-up
  - route `SYS_MAP_REDUCE` => worker forks + planner blocked
- Files:
  - `src/kernel/scheduler.ts` (new)
  - `src/kernel/engine.ts` (bridge/deprecation shim)
- Exit gate:
  - controlled synthetic run proves fork->join->planner resume chain

### Phase 5 - HALT Pricing Loop (Deterministic, Locked Standard)
- Actions:
  - implement one-time `HALT_STANDARD_LOCK` initialization
  - replace interactive verifier with deterministic command runner
  - explicit pricing rule: on verification pass `price += 1`
  - explicit pricing rule: on verification fail `price -= 1`, reject HALT, append objective error, requeue process
  - on pass: terminate and propagate output via join path
- Files:
  - `src/kernel/scheduler.ts`
  - `src/kernel/halt-verifier.ts` (new)
  - `src/runtime/boot.ts` (initial lock-in handshake)
- Exit gate:
  - no interactive prompt in post-lock runtime
  - replay shows `PENDING_HALT -> TERMINATED|READY` by deterministic result only

### Phase 6 - Red-Flag, Thrashing, and Panic Controls
- Actions:
  - preserve red-flag kill behavior
  - explicit red-flag penalty: `KILLED => price -= 10`
  - add anti-thrashing counters in scheduler loop
  - add panic-loop breaker for repeated reset patterns
- Files:
  - `src/kernel/scheduler.ts`
  - `src/kernel/trap-controller.ts` (or equivalent existing module)
- Exit gate:
  - repeated malformed outputs trigger deterministic kill path

### Phase 7 - Bench and Audit Integration
- Actions:
  - add/upgrade benches for hypercore:
    - map-reduce fork/join evidence
    - HALT lock/no-human-intervention evidence
    - longrun context stability and chaos recovery
  - output evidence into handover paths
- Files:
  - `src/bench/*` (new targeted benches)
  - `handover/artitecture_response/*` (phase reports)
- Exit gate:
  - required evidence published and linked from handover README

## 5) Dual-LLM Execution Mode
- Codex responsibility:
  - implement phase code changes
  - run tests/benches
  - produce phase report and evidence bundle
- Gemini responsibility:
  - perform independent recursive audit at end of each phase
  - output strict PASS/FAIL + blocker list + required fixes
- Merge rule:
  - phase is complete only when Gemini audit is PASS
  - if FAIL, Codex applies mandatory remediation and re-runs audit

## 6) Acceptance Checks (Final)
1. Hypercore scheduler path is active with feature flag on.
2. `SYS_MAP_REDUCE` fork/join observable in traces.
3. Planner and worker contexts are isolated (no direct contamination of planner memory by worker retries).
4. HALT decisions are deterministic and non-interactive after standard lock.
5. No regression on existing schema fail-closed behavior.
6. Longrun stability under chaos remains bounded (context growth controlled).

## 7) Rollback Policy
- Immediate rollback triggers:
  - boot failure in hypercore mode
  - scheduler deadlock (`active_processes=true` + no progress timeout)
  - verifier lock corruption
- Rollback mechanism:
  - disable `TURINGOS_HYPERCORE_V2`
  - return to legacy engine path
  - keep forensic traces for next remediation cycle

## 8) First Execution Slice (Next 24h)
1. Phase 0 + Phase 1 implementation and compile gate.
2. Phase 2 schema + parser changes and conformance tests.
3. Gemini recursive audit pass for Phase 0-2.
4. If PASS, continue to Phase 3.

## 9) Final Success Criterion (Locked)
Reference: `https://arxiv.org/html/2511.09030v1`

Hard gate for TuringOS final success:
1. A single end-to-end run must reach **at least 1,000,000 steps**.
2. The run must compute the **final correct answer** (deterministic verifier evidence required).
3. If either condition fails, system status remains **NOT DONE** and the team must continue root-cause analysis, hardening, retraining, and reruns.

Machine gate implementation:
- `npm run bench:maker-1m-steps-gate`
- audit output: `benchmarks/audits/final_gate/maker_1m_steps_gate_latest.json`
