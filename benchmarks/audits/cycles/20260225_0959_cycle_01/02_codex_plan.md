# Codex Implementation Plan (Cycle 01)

## Source
- Gemini design: `01_gemini_design.md`
- Baseline evidence: `05_test_results.md`

## Selected changes for this cycle

### P0 - thought -> json protocol
- Files:
  - `src/kernel/types.ts`
  - `src/oracle/universal-oracle.ts`
  - `turing_prompt.sh`
  - `benchmarks/os-longrun/discipline_prompt.txt`
- Plan:
  1. Extend transition contract with optional `thought`, `stack_op`, `stack_payload`.
  2. Parse `<thought>...</thought>` wrapper and attach it to transition when present.
  3. Update prompts to require a single JSON syscall and allow explicit thought channel.
- Validation:
  - `npm run typecheck`
  - run `bench:os-longrun` and inspect `.journal.log`/transitions for `thought` field handling.

### P1 - MMU guard + L1 trace cache
- Files:
  - `src/manifold/local-manifold.ts`
  - `src/kernel/engine.ts`
- Plan:
  1. Add slice truncation guard with explicit trap marker when output too long.
  2. Enrich page fault details with parent directory listing hints.
  3. Replace single last-action heuristic with small L1 trace ring buffer and pre-watchdog soft trap.
- Validation:
  - `npm run typecheck`
  - `bench:os-longrun` trap metrics comparison (`WATCHDOG_NMI`, `PAGE_FAULT`).

### P2 - OS-managed call stack syscall
- Files:
  - `src/manifold/local-manifold.ts`
  - `src/kernel/engine.ts`
- Plan:
  1. Add `sys://callstack` channel backed by `.callstack.json` in workspace.
  2. Support `PUSH:<task>`, `POP`, `NOP` from transition syscall fields.
  3. Inject call stack snapshot into observed slice each tick.
- Validation:
  - `npm run typecheck`
  - check runtime workspaces for `.callstack.json` and stack transitions.

## Rollback strategy
- Keep edits isolated to 4 files + prompts.
- If regression appears, rollback in reverse order: P2 -> P1 -> P0.
