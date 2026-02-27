# Guard SFT Dataset Report

- stamp: 20260227_033631
- roots: /home/zephryj/projects/turingos/benchmarks/audits/evidence/golden_traces, /home/zephryj/projects/turingos/benchmarks/audits/evidence/guard_analytics, /home/zephryj/projects/turingos/benchmarks/os-longrun/workspaces
- scanned_traces: 61
- policy_rows: 543
- reflex_rows: 27
- min_policy_rows: 100
- min_reflex_rows: 20
- pass: true
- policy_output: /home/zephryj/projects/turingos/benchmarks/data/sft/guard_policy_20260227_033631.jsonl
- reflex_output: /home/zephryj/projects/turingos/benchmarks/data/sft/guard_reflex_20260227_033631.jsonl

## Opcode Distribution

- SYS_EXEC: 209
- SYS_GOTO: 184
- SYS_WRITE: 80
- SYS_HALT: 65
- SYS_EDIT: 4
- SYS_PUSH: 1

## Trap Distribution

- sys://trap/illegal_halt: 26
- sys://trap/cpu_fault: 10
- sys://trap/panic_reset: 3
- sys://trap/thrashing: 1

