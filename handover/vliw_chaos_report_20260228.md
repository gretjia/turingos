# VLIW + Chaos Upgrade Report (2026-02-28)

## Scope
- Task 1: VLIW ISA upgrade (`nQ + 1A`) with kernel causality assertion.
- Task 2: Chaos Monkey middleware injection in local manifold.
- Task 3: Kobayashi-Maru style realworld eval with 20-file circular synthetic project.

## Primary Code Changes
- `schemas/syscall-frame.v5.json` (new VLIW frame schema)
- `src/kernel/engine.ts` (mind_ops-first execution, single world-op enforcement trap)
- `src/oracle/turing-bus-adapter.ts` (legacy `a_t` + VLIW `mind_ops/world_op` parser)
- `src/kernel/types.ts` (Transition extended with `mind_ops/world_op/world_ops`)
- `src/kernel/syscall-schema.ts` (world/mind/system opcode classifiers)
- `turing_prompt.sh` (VLIW output contract)
- `schemas/turing-bus.frame.v2.json` (new VLIW bus frame contract)
- `schemas/turing-bus.frame.v1.json` kept immutable for backward compatibility
- `src/bench/syscall-schema-consistency.ts` (v5 schema checks)
- `src/bench/turing-bus-conformance.ts` (VLIW conformance cases)
- `src/manifold/local-manifold.ts` (chaos injection gates + env-configurable rates)
- `src/bench/chaos-monkey-gate.ts` (new deterministic chaos gate)
- `src/bench/voyager_realworld_eval.ts` (new longrun realworld eval)
- `package.json` (new bench scripts)

## Execution Results (Raw)
- `npm run -s typecheck` -> PASS
- `npm run -s bench:syscall-schema-consistency` -> PASS
- `npm run -s bench:turing-bus-conformance` -> PASS
- `npm run -s bench:chaos-monkey-gate` -> PASS
- `npm run -s bench:voyager-realworld-eval` -> PASS

Artifacts:
- Protocol latest:
  - `benchmarks/audits/protocol/syscall_schema_consistency_latest.json`
  - `benchmarks/audits/protocol/turing_bus_conformance_latest.json`
- Chaos latest:
  - `benchmarks/audits/longrun/chaos_monkey_gate_latest.json`
- Voyager latest:
  - `benchmarks/audits/longrun/voyager_realworld_eval_latest.json`

## Required Evidence (Architect Constraints)

### 1) VLIW Throughput Proof
Source: `benchmarks/audits/longrun/voyager_realworld_eval_latest.json` + replay tuples in `/tmp/turingos-voyager-realworld-TPfHOu/.journal.log`

Observed tuple:
- `tick_seq=1`
- `mind_ops=["SYS_EDIT","SYS_PUSH"]`
- `world_op="SYS_EXEC"`
- `a_t="SYS_EXEC"`
- `d_next="$ echo vliw_proof_2; grep -R \"import\" -n src | head -n 20"`

This confirms same-tick VLIW bundle: multiple Q-class ops then one A-class op.

### 2) Chaos Survival Proof (50k Flood + Paging + Follow-up)
Observed tuple:
- flood tuple `tick_seq=2`
- `s_t` contains `[PAGE_TABLE_SUMMARY]`
- `s_t` source line: `Source=command:echo vliw_proof_2; grep -R "import" -n src | head -n 20`
- same tick action returned `SYS_GOTO` to page channel
- next tuple (`tick_seq=3`) continues on `d_t=sys://page/44a7c82420d9f7ca?p=2` with `SYS_GOTO`

This confirms flood -> MMU pagination -> explicit page-follow action, no Node crash.

### 3) Token Dissipation / O(1) Context ECG (120 ticks)
From voyager report:
- `ticks_observed=120`
- `context_min=848`
- `context_max=4096`
- `context_avg=3977.33`
- `context_p95=4096`

Bound remains hard-clamped by MMU wall (4K), no linear context explosion over >100 ticks.

## Gemini Recursive Audits (Per Phase)
- Phase 1:
  - `benchmarks/audits/recursive/phase1_vliw_recursive_audit_20260227_060130.md`
- Phase 2:
  - `benchmarks/audits/recursive/phase2_chaos_recursive_audit_20260227_060810.md`
- Phase 3:
  - `benchmarks/audits/recursive/phase3_voyager_recursive_audit_20260227_060850.md`
- Final integrated:
  - `benchmarks/audits/recursive/final_vliw_chaos_recursive_audit_20260227_061057.md`

## Review Notes
- Phase 2 audit warning about env leakage is addressed by scoped env-restore wrappers in gate script.
- Phase 3 recommendation to include timeout/write-deny in voyager scenario is valid as an enhancement; currently those are covered deterministically by `chaos-monkey-gate` and flood path by voyager run.
