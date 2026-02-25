# A/B Audit: TuringClaw vs TuringOS (`bench:os-longrun` command)

- Date: 2026-02-25
- Objective: Compare current observed behavior when running `npm run bench:os-longrun` in both repos.
- Note: command name is aligned, but underlying benchmark definitions differ by repo.

## Command Outcome

| Repo | Command | Exit | Pass Summary |
|---|---|---:|---|
| turingclaw | `npm run bench:os-longrun` | 0 | `3/3` |
| turingos | `npm run bench:os-longrun` | 0 | `0/3` |

## System-Level Metrics

| Metric | turingclaw | turingos |
|---|---:|---:|
| scenarios passed | 3/3 | 0/3 |
| halt rate | 1.00 | 0.00 |
| artifact accuracy | 1.00 | 0.00 |
| anomaly count | 0 | n/a (not reported in same schema) |
| trap hits | 0 | n/a (per-trap counts only) |
| max-tick hit rate | 0.00 | 1.00 |

## Scenario-Level Side-by-Side (closest semantic pairing)

| Functional theme | turingclaw scenario | pass | halted | ticks | artifact acc | turingos scenario | pass | halted | ticksObserved | completion | plan adherence | maxTickHit |
|---|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| pipeline processing | `pipeline_control` | Y | Y | 12 | 1.00 | `pipeline_ordered_execution` | N | N | 17 | 0.00 | 0.1429 | Y |
| fault recovery | `fault_recovery_control` | Y | Y | 10 | 1.00 | `fault_recovery_resume` | N | N | 14 | 0.00 | 0.2857 | Y |
| long-horizon completion | `swe_control` | Y | Y | 13 | 1.00 | `long_checklist_stability` | N | N | 26 | 0.00 | 0.0833 | Y |

## TuringOS Trap/Failure Signals (per scenario)

| Scenario | PAGE_FAULT | IO_FAULT | CPU_FAULT | WATCHDOG_NMI | finalQ | finalD |
|---|---:|---:|---:|---:|---|---|
| `pipeline_ordered_execution` | 2 | 4 | 0 | 0 | `CREATE_INPUT_FILE:WRITE_INPUT->APPEND_DONE` | `sys://append/plan/progress.log` |
| `fault_recovery_resume` | 6 | 2 | 0 | 0 | `OS_TRAP L1_CACHE_HIT ... RECOVER_SOURCE:APPEND_DONE` | `sys://trap/l1_cache_hit` |
| `long_checklist_stability` | 1 | 6 | 0 | 0 | `CREATE_M01_FILE` | `milestones/m01.txt` |

## Evidence (raw artifacts)

- turingclaw markdown: `/home/zephryj/projects/turingclaw/workspace/benchmarks/control_real_llm/control-real-20260225-164614.md`
- turingclaw json: `/home/zephryj/projects/turingclaw/workspace/benchmarks/control_real_llm/control-real-20260225-164614.json`
- turingos markdown: `/home/zephryj/projects/turingos/benchmarks/results/os-longrun-20260225-164728.md`
- turingos json: `/home/zephryj/projects/turingos/benchmarks/results/os-longrun-20260225-164728.json`

