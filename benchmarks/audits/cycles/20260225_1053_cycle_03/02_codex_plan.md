# Codex Plan (Cycle 03)

## Changes
1. Prompt simplification: revert to minimal JSON contract.
2. Contract gate: DONE step requires mapped artifact file existence.
3. Keep NEXT_REQUIRED_DONE and append ordering guard from Cycle 02.

## Validation
- npm run typecheck
- npm run smoke:mock
- npm run bench:os-longrun
- Compare with Cycle 02 summary metrics.
