You are auditing a long-horizon LLM OS kernel project from first principles.

Goal:
- Evaluate why long-run benchmark pass rate is 0/30.
- Align your audit with the architecture principles in BIBLE.md (trap-first, stateless model core, persistent registers, watchdog, relentless recovery).
- Produce concrete, code-level recommendations that are implementable now.

Constraints:
- DO NOT modify files. Audit only.
- Focus on failure mechanisms, regressions, and evaluator/metric validity.
- Prioritize fixes that improve: completion_score, halted_rate under contract, and reduced watchdog loops.

Context files to inspect:
- BIBLE.md
- src/kernel/engine.ts
- src/kernel/types.ts
- src/runtime/file-execution-contract.ts
- src/runtime/boot.ts
- src/manifold/local-manifold.ts
- src/oracle/kimi-code-oracle.ts
- src/bench/os-longrun.ts
- benchmarks/results/os-longrun-20260225-064748.md

Output format (strict):
1) Root causes (ordered by severity)
2) Mismatch vs BIBLE principles
3) Minimal patch plan (top 5 changes with file names)
4) Risk of each change
5) Predicted benchmark impact (directional)
