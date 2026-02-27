# Guard SFT Split Report

- stamp: splits
- pass: true
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/sft/guard_sft_split_splits.json
- policy_input: /home/zephryj/projects/turingos/benchmarks/data/sft/tiny_gate_20260227_044348/policy_tiny.jsonl
- reflex_input: /home/zephryj/projects/turingos/benchmarks/data/sft/tiny_gate_20260227_044348/reflex_tiny.jsonl
- out_dir: /home/zephryj/projects/turingos/benchmarks/data/sft/tiny_gate_20260227_044348/splits
- ratio_train_val_test: 80/10/10

## Policy

- rows: 3
- train: 1
- val: 1
- test: 1

## Reflex

- rows: 2
- train: 1
- val: 1
- test: 0

