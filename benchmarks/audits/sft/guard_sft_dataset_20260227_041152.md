# Guard SFT Dataset Report

- stamp: 20260227_041152
- roots: /home/zephryj/projects/turingos/benchmarks/audits/evidence/golden_traces, /home/zephryj/projects/turingos/benchmarks/audits/evidence/guard_analytics, /home/zephryj/projects/turingos/benchmarks/os-longrun/workspaces
- scanned_traces: 69
- policy_rows: 567
- reflex_rows: 35
- min_policy_rows: 100
- min_reflex_rows: 1
- pass: true
- policy_output: /home/zephryj/projects/turingos/benchmarks/data/sft/guard_policy_20260227_041152.jsonl
- reflex_output: /home/zephryj/projects/turingos/benchmarks/data/sft/guard_reflex_20260227_041152.jsonl

## Opcode Distribution

- SYS_EXEC: 209
- SYS_GOTO: 184
- SYS_WRITE: 84
- SYS_HALT: 65
- SYS_EDIT: 20
- SYS_PUSH: 5

## Trap Distribution

- sys://trap/cpu_fault: 50
- sys://trap/illegal_halt: 26
- sys://trap/panic_reset: 15
- sys://trap/thrashing: 5

