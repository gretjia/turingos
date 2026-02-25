# Codex Plan

1. Apply Phase-1 hardening in `src/kernel/engine.ts` and `src/oracle/universal-oracle.ts`.
2. Run `typecheck` + `smoke:mock` + `bench:os-longrun` and save Round1 outputs.
3. Analyze drift/deadlock evidence from workspaces and identify remaining root cause.
4. Patch `src/runtime/file-execution-contract.ts` to enforce DONE-content contract.
5. Re-run long-run benchmark (Round2), compare to Round1.
6. Add mismatch diagnostics (`expected` vs `actual`) in contract reasons.
7. Re-run long-run benchmark (Round3), aggregate comparisons.
8. Run dual-LLM independent audit on Round3 evidence and record recommendations.
