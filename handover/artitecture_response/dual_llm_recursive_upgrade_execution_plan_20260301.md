# Dual-LLM Recursive Upgrade Execution Plan (2026-03-01)

- Working mode: Codex (implementation) + Gemini (`-y`) independent architect auditor
- Canonical architect input: `handover/artitecture_response/chief_architect_system_audit_complexity_collapse_20260301.md`
- Gemini independent output: `handover/artitecture_response/gemini_recursive_upgrade_plan_from_chief_audit_20260301.md`
- Constraint: Linux host currently busy; this round prioritizes code upgrades and audit-gate wiring, not heavy runtime regression.

## Phase Policy (Hard)

- Phase order is fixed: `P0 -> P1 -> P2 -> P3`.
- Every phase requires `Codex PASS` and `Gemini PASS` before next phase.
- Any `FAIL` locks downstream phases until remediation + re-audit.

Gate command:

```bash
npm run bench:phase-recursive-audit-gate -- \
  --phase P0 \
  --codex-pass yes \
  --gemini-pass yes \
  --codex-evidence handover/artitecture_response/<codex_report>.md \
  --gemini-evidence handover/artitecture_response/<gemini_report>.md \
  --note "phase0 complete"
```

## Implemented in This Round (Code Upgrade)

### P0.1 Decode Hardening

- `src/oracle/universal-oracle.ts`
  - Added OpenAI structured-output `json_schema` response mode.
  - Added strict transition frame schema for syscall envelope generation.
  - Added compatibility fallback to `json_object` for non-OpenAI providers.
  - New env: `TURINGOS_OPENAI_JSON_SCHEMA_ENABLED` (default enabled in boot).

### P0.2 Context Sterilization Capability

- `src/kernel/engine.ts`
  - Added oracle frame mode switch: `full | stateless`.
  - Implemented `stateless` frame builder with minimal channels:
    - `[OS_GOAL]`
    - `[OS_CONTRACT]`
    - `[LAST_STEP_RESULT]`
    - `[OBSERVED_SLICE]`
  - Added `lastStepResultSummary` lifecycle update on both normal ticks and trap returns.
  - New env: `TURINGOS_ORACLE_FRAME_MODE`.

- `src/runtime/boot.ts`
  - Defaulted `TURINGOS_ORACLE_FRAME_MODE=stateless` unless explicitly set.
  - Defaulted `TURINGOS_OPENAI_JSON_SCHEMA_ENABLED=1` unless explicitly set.
  - Added startup logs for both knobs.

### P0.3 Recursive Gate Runtime

- `src/bench/phase-recursive-audit-gate.ts` (new)
  - Enforces phase ordering and dual-PASS gating.
  - Writes stamped and latest reports to `benchmarks/audits/phase_gate/`.
  - Blocks phase skipping and locks downstream phases on fail.

- `package.json`
  - Added `bench:phase-recursive-audit-gate`.

## Next Commit Queue (after this round)

1. `oracle: schema-lock fallback telemetry and provider-specific error metrics`
2. `kernel: anti-oscillation guard for stateless frame mode`
3. `oracle: dual-brain hard leader arbitration and timeout cutover`
4. `kernel: ABA/error-signature red-flag hard interrupt`
5. `runtime: per-case UUID workspace lifecycle and panic budget localization`
6. `kernel: syscall micro-snapshot and deterministic rollback`

## No-Go / Kill-Switch

If after completing `P0 + P2` the 48-hour basic single-step pass rate is still < 70%, stop current route and pivot to search-and-verify batch generation mode per chief architect directive.
