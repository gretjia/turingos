You are performing an independent architecture audit for TuringOS long-run stability.

Context files:
- baseline (cycle10): benchmarks/audits/cycles/20260225_1352_cycle_10_rerun/post_os_longrun.json
- round1: benchmarks/audits/cycles/20260225_1459_cycle_11_phase1_hardening/round1_os_longrun.json
- round2: benchmarks/audits/cycles/20260225_1459_cycle_11_phase1_hardening/round2_os_longrun.json
- round3: benchmarks/audits/cycles/20260225_1459_cycle_11_phase1_hardening/post_os_longrun.json
- metric rollup: benchmarks/audits/cycles/20260225_1459_cycle_11_phase1_hardening/metrics_compare_rounds.json
- current hardening code:
  - src/kernel/engine.ts
  - src/oracle/universal-oracle.ts
  - src/runtime/file-execution-contract.ts

Observed metric trajectory:
- cycle10: pass 0/3, completion_avg 0.0833, plan_avg 0.377
- round1: pass 0/3, completion_avg 0.0000, plan_avg 0.4048
- round2: pass 0/3, completion_avg 0.0833, plan_avg 0.2183
- round3: pass 0/3, completion_avg 0.0000, plan_avg 0.1706, watchdog_avg 0.6667

Evidence excerpts:
1) "required file content mismatch for DONE:WRITE_INPUT -> artifacts/input.csv"
2) "Progress strictly requires DONE:M01, got \"Milestone 01: Initialization complete. System bootstrap successful.\""
3) WATCHDOG_NMI reappeared in round3

Task:
Give an independent answer with 4 sections:
1. Root cause diagnosis (top 3, ranked)
2. Should we keep iterating on this code path? (yes/no + criteria)
3. Next-cycle design (max 5 actionable changes, no generic advice)
4. Kill-switch conditions (when to stop this direction)

Requirements:
- Be direct and technical.
- Tie each point to the evidence above.
- Avoid motivational language.
