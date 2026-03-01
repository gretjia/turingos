# Guard SFT Dataset Report

- stamp: 20260227_174934
- roots: /home/zephryj/projects/turingos/benchmarks/audits/evidence/golden_traces, /home/zephryj/projects/turingos/benchmarks/audits/evidence/guard_analytics, /home/zephryj/projects/turingos/benchmarks/os-longrun/workspaces
- scanned_traces: 85
- policy_rows: 615
- reflex_rows: 51
- min_policy_rows: 100
- min_reflex_rows: 1
- pass: true
- policy_output: /home/zephryj/projects/turingos/benchmarks/data/sft/guard_policy_20260227_174933.jsonl
- reflex_output: /home/zephryj/projects/turingos/benchmarks/data/sft/guard_reflex_20260227_174933.jsonl

## Opcode Distribution

- SYS_EXEC: 209
- SYS_GOTO: 184
- SYS_WRITE: 92
- SYS_HALT: 65
- SYS_EDIT: 52
- SYS_PUSH: 13

## Trap Distribution

- sys://trap/cpu_fault: 226
- sys://trap/panic_reset: 70
- sys://trap/illegal_halt: 26
- sys://trap/thrashing: 13
- sys://trap/unrecoverable_loop: 1

