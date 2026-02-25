# Cycle Scope

## Objective
Execute the first Codex x Gemini closed-loop cycle to improve long-run stability and plan adherence for TuringOS.

## Why this cycle
- Repository has uncommitted oracle refactor changes (`universal-oracle.ts`, `boot.ts`, deletion of `kimi-code-oracle.ts`).
- Need evidence-driven decision on whether to keep and how to proceed.
- Need to apply workflow with reproducible artifacts.

## In-Scope
1. Establish baseline with current code (`typecheck`, `smoke:mock`, `bench:os-longrun`).
2. Ask Gemini 3.1 Pro Preview for first-principles design recommendations based on baseline evidence.
3. Implement minimal high-impact fixes aligned with:
   - call stack syscall
   - MMU guard
   - L1 trace cache
   - thought -> json protocol
4. Re-run same benchmark set and compare metrics.
5. Produce Go/No-Go decision with evidence paths.

## Out-of-Scope
- Full architecture rewrite of all kernel modules in one cycle.
- Changing benchmark definitions themselves.

## Acceptance Gate
- Evidence artifacts complete.
- At least one core metric improves or critical failure mode is reduced.
- No typecheck regression.
