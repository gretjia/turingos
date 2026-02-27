# TuringOS Full-Auto 1-5 Completion Snapshot (2026-02-27)

## Scope

- Completed roadmap items 1-5 in one pass with dual-audit workflow (Codex implement + Gemini independent audit).
- Branch: `main`
- GitHub head after rollout: `180ce26`

## Completed Items

1. Bus schema freeze + consistency gate
2. Dispatcher MVP (P/E route + deterministic route logs)
3. Guard analytics benchmark
4. Long-run integration + 1200 tick soak + Mac command pack
5. Guard SFT dataset pipeline (`REPLAY_TUPLE + TRAP_FRAME -> policy/reflex`)

## Key Code Artifacts

- `schemas/syscall-frame.v4.json`
- `src/bench/syscall-schema-consistency.ts`
- `src/oracle/dispatcher-oracle.ts`
- `src/kernel/engine.ts` (`[BUS_ROUTE]` journal emission)
- `src/runtime/boot.ts` (dispatcher lane wiring via env)
- `src/bench/dispatcher-gate.ts`
- `src/bench/guard-analytics.ts`
- `src/bench/os-longrun.ts` (oracle/dispatcher overrides + route metrics)
- `src/bench/longrun-dispatcher-soak.ts`
- `src/bench/guard-sft-dataset.ts`
- `handover/mac_longrun_command_pack_20260227.md`
- `docs/turingos_v4_execution_plan.md` (execution log updated)

## Verification Results

- `npm run typecheck` PASS
- `npm run bench:syscall-schema-consistency` PASS
- `npm run bench:syscall-schema-gate` PASS (valid 17/17, invalid 59/59, mutex 21/21)
- `npm run bench:dispatcher-gate` PASS
- `npm run bench:guard-analytics` PASS
- `npm run bench:longrun-dispatcher-soak` PASS (ticks=1200, coverage=1, cpu_fault=0, unrecoverable=0)
- `npm run bench:guard-sft-dataset` PASS (`policy_rows=537`, `reflex_rows=25`)
- `npm run bench:ci-gates` PASS

## Latest Output Paths

- Protocol:
  - `benchmarks/audits/protocol/syscall_schema_consistency_latest.json`
  - `benchmarks/audits/protocol/dispatcher_gate_latest.json`
- Guard:
  - `benchmarks/audits/guard/guard_analytics_latest.json`
- Longrun:
  - `benchmarks/audits/longrun/dispatcher_longrun_soak_latest.json`
- SFT:
  - `benchmarks/audits/sft/guard_sft_dataset_latest.json`
  - `benchmarks/data/sft/guard_policy_20260227_033312.jsonl`
  - `benchmarks/data/sft/guard_reflex_20260227_033312.jsonl`

## Gemini Audit Verdicts

- Step 1: GO
- Step 2: GO
- Step 3: GO
- Step 4: GO
- Step 5: GO

## Phase 6 Extension (Post 1-5)

- Added Turing Bus protocol schema and adapter:
  - `schemas/turing-bus.frame.v1.json`
  - `src/oracle/turing-bus-adapter.ts`
- Refactored runtime parser path:
  - `src/oracle/universal-oracle.ts`
- Added conformance gate and CI integration:
  - `src/bench/turing-bus-conformance.ts`
  - `bench:ci-gates` now includes `bench:turing-bus-conformance`
- Validation:
  - `npm run typecheck` PASS
  - `npm run bench:turing-bus-conformance` PASS
  - `npm run bench:ci-gates` PASS
- Gemini Phase-6 audit: GO

## Phase 7 Extension (Guard MCU Loop Baseline)

- Added deterministic split pipeline:
  - `src/bench/guard-sft-split.ts`
- Added MCU eval gate:
  - `src/bench/guard-mcu-eval.ts`
  - metrics: JSON/mutex/reflex/deadlock
- Added closed-loop runner:
  - `src/bench/guard-mcu-loop.ts`
- Added scripts:
  - `bench:guard-sft-split`
  - `bench:guard-mcu-eval`
  - `bench:guard-mcu-loop`
- Validation:
  - `npm run typecheck` PASS
  - `npm run bench:guard-sft-split` PASS
  - `npm run bench:guard-mcu-eval -- --mode gold` PASS
  - `npm run bench:guard-mcu-loop -- --mode gold --split-args "--train-pct 80 --val-pct 10"` PASS
- Gemini Phase-7 re-audit: GO

## Multi-host Sync

- VM (`/home/zephryj/projects/turingos`): pushed to `origin/main` at `180ce26`.
- Mac (`/Users/zephryj/work/turingos`): fast-forward synced to `180ce26`.
- Mac post-sync checks:
  - `npm run typecheck` PASS
  - `npm run bench:dispatcher-gate` PASS
  - `npm run bench:guard-analytics` PASS
  - `npm run bench:longrun-dispatcher-soak` PASS
  - `npm run bench:guard-sft-dataset` PASS

## Phase 7.1 Addendum (Cross-host tiny-split fix)

- Incident:
  - On Mac, `npm run bench:guard-mcu-loop -- --mode gold` failed because reflex validation split could be empty at very small sample sizes.
- Code changes:
  - `src/bench/guard-sft-split.ts`
  - deterministic tiny-set allocation (`n=1 -> train-only`, `n=2 -> train+val`)
  - split gate now requires usable holdout (`train>0 && (val>0 || test>0)`)
  - `src/bench/guard-mcu-eval.ts`
  - automatic non-empty split fallback priority: `val -> test -> train`
  - report now includes `selectedSplits` and `selectedFiles`
- VM validation:
  - `npm run typecheck` PASS
  - `npm run bench:guard-sft-split` PASS
  - `npm run bench:guard-mcu-eval -- --mode gold` PASS
  - `npm run bench:guard-mcu-loop -- --mode gold` PASS
  - `npm run bench:ci-gates` PASS

## Git State Snapshot (Post Phase 7.1)

- Commit:
  - `96d68c7 fix(guard): harden tiny-split eval fallback across hosts`
- GitHub:
  - `origin/main` at `96d68c7`
- VM (`/home/zephryj/projects/turingos`):
  - `main` synced to `96d68c7`
- Mac (`/Users/zephryj/work/turingos`):
  - fast-forward synced to `96d68c7`
  - verification:
    - `npm run typecheck` PASS
    - `npm run bench:guard-mcu-loop -- --mode gold` PASS (`policy_rows=413`, `reflex_rows=2`, split `reflex train=1 val=1 test=0`)
