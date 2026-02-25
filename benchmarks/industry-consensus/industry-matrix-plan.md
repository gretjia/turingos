# Industry Consensus AI OS Matrix Plan

- version: 2026-02-25.v1
- owner: turingos
- updatedAt: 2026-02-25
- weightedGoScore: 0.7

## Benchmarks

| id | tier | metric | threshold | weight |
|---|---|---|---:|---:|
| osworld_verified | P0 | success_rate | 0.15 | 0.3 |
| browsergym_webarena | P0 | success_rate | 0.2 | 0.2 |
| swebench_verified_bash_only | P0 | resolved_rate | 0.15 | 0.2 |
| tau2_bench | P0 | pass_k | 0.25 | 0.1 |
| agent_safety_bench | P1 | safety_pass_rate | 0.6 | 0.08 |
| the_agent_company | P1 | success_rate | 0.15 | 0.07 |
| android_world | P1 | success_rate | 0.1 | 0.05 |

## Runbook (template commands)

### osworld_verified (OSWorld-Verified)
- command: `python -m osworld.eval --config <config>`
- metric: success_rate
- threshold: 0.15
- sources: https://os-world.github.io/ ; https://arxiv.org/abs/2404.07972 ; https://xlang.ai/blog/osworld-verified

### browsergym_webarena (BrowserGym (WebArena/VisualWebArena))
- command: `python -m browsergym.experiments.run --taskset webarena --agent <agent>`
- metric: success_rate
- threshold: 0.2
- sources: https://github.com/ServiceNow/BrowserGym ; https://arxiv.org/abs/2307.13854

### swebench_verified_bash_only (SWE-bench Verified/Bash Only)
- command: `python -m swebench.harness.run_eval --dataset verified --mode bash_only --model <model>`
- metric: resolved_rate
- threshold: 0.15
- sources: https://www.swebench.com/ ; https://openreview.net/forum?id=VTF8yNQM66

### tau2_bench (tau2-bench)
- command: `python -m taubench.eval --benchmark tau2 --agent <agent>`
- metric: pass_k
- threshold: 0.25
- sources: https://arxiv.org/abs/2506.07982 ; https://github.com/sierra-research/tau-bench

### agent_safety_bench (Agent-SafetyBench)
- command: `python -m agentsafetybench.eval --agent <agent>`
- metric: safety_pass_rate
- threshold: 0.6
- sources: https://arxiv.org/abs/2412.14470 ; https://github.com/thu-coai/Agent-SafetyBench

### the_agent_company (TheAgentCompany)
- command: `python -m theagentcompany.eval --agent <agent>`
- metric: success_rate
- threshold: 0.15
- sources: https://arxiv.org/abs/2412.14161 ; https://github.com/TheAgentCompany/TheAgentCompany

### android_world (AndroidWorld)
- command: `python -m android_world.eval --agent <agent>`
- metric: success_rate
- threshold: 0.1
- sources: https://arxiv.org/abs/2405.14573 ; https://github.com/google-research/android_world

