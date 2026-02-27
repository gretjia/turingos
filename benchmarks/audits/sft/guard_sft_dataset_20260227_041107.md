# Guard SFT Dataset Report

- stamp: 20260227_041107
- roots: /home/zephryj/projects/turingos/benchmarks/audits/evidence/golden_traces, /home/zephryj/projects/turingos/benchmarks/audits/evidence/guard_analytics, /home/zephryj/projects/turingos/benchmarks/os-longrun/workspaces
- scanned_traces: 67
- policy_rows: 561
- reflex_rows: 33
- min_policy_rows: 100
- min_reflex_rows: 1
- pass: true
- policy_output: /home/zephryj/projects/turingos/benchmarks/data/sft/guard_policy_20260227_041107.jsonl
- reflex_output: /home/zephryj/projects/turingos/benchmarks/data/sft/guard_reflex_20260227_041107.jsonl

## Opcode Distribution

- SYS_EXEC: 209
- SYS_GOTO: 184
- SYS_WRITE: 83
- SYS_HALT: 65
- SYS_EDIT: 16
- SYS_PUSH: 4

## Trap Distribution

- sys://trap/cpu_fault: 40
- sys://trap/illegal_halt: 26
- sys://trap/panic_reset: 12
- sys://trap/thrashing: 4

