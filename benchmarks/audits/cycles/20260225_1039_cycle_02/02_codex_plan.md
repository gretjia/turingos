# Codex Plan (Cycle 02)

## Selected minimal changes
1. Expose contract next-step API in execution contract.
2. Inject `[NEXT_REQUIRED_DONE]` guidance into every tick context.
3. Enforce and normalize progress append writes against expected next DONE step.

## Validation
- `npm run typecheck`
- `npm run smoke:mock`
- `npm run bench:os-longrun`
- Compare with Cycle 01 post baseline:
  - `benchmarks/audits/cycles/20260225_0959_cycle_01/post_summary.json`
