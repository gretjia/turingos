You are performing an independent recursive architecture audit for TuringOS.

Scope:
- Whitepaper source of truth: whitepaper.html
- Runtime code:
  - src/kernel/engine.ts
  - src/runtime/file-execution-contract.ts
  - src/oracle/universal-oracle.ts
  - src/manifold/local-manifold.ts
  - src/chronos/file-chronos.ts
  - src/runtime/boot.ts
- Benchmark harness and latest evidence:
  - benchmarks/os-longrun/discipline_prompt.txt
  - benchmarks/audits/cycle_11_phase1_hardening_summary_20260225.md
  - benchmarks/audits/cycles/20260225_1459_cycle_11_phase1_hardening/metrics_compare_rounds.json

Facts from latest evidence:
- Pass rate remains 0/3.
- Round3 metrics: completion_avg=0.0000, plan_avg=0.1706, watchdog_avg=0.6667.
- Representative failures:
  - "required file content mismatch for DONE:WRITE_INPUT -> artifacts/input.csv"
  - "Progress strictly requires DONE:M01, got \"Milestone 01: Initialization complete. System bootstrap successful.\""

Task:
1) Compare whitepaper claims vs implementation reality.
2) Identify top 5 architecture gaps (ranked by impact).
3) Identify top 3 anti-patterns causing long-run non-convergence.
4) Define ONE next work center (single strategic focus) for the next cycle.
5) Give a concrete 2-week execution plan (max 7 items) with measurable success metrics.
6) Give kill-switch criteria: when to stop current direction and pivot.

Constraints:
- Be direct and technical.
- Use file-level evidence, not generic advice.
- Keep recommendations implementable in current repo.
