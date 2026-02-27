# Guard Tiny Split Gate

- stamp: 20260227_042900
- pass: false
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/guard/guard_tiny_split_gate_20260227_042900.json

| Check | Result | Details |
|---|---|---|
| Tiny split command | FAIL | split command failed (exit=127) |
| Tiny eval command | FAIL | eval command failed (exit=127) |

| Step | Exit | Result | Command |
|---|---:|---|---|
| split_tiny_dataset | 127 | FAIL | `tsx src/bench/guard-sft-split.ts --policy-input '/home/zephryj/projects/turingos/benchmarks/data/sft/tiny_gate_20260227_042900/policy_tiny.jsonl' --reflex-input '/home/zephryj/projects/turingos/benchmarks/data/sft/tiny_gate_20260227_042900/reflex_tiny.jsonl' --out-dir '/home/zephryj/projects/turingos/benchmarks/data/sft/tiny_gate_20260227_042900/splits' --train-pct 80 --val-pct 10` |
| eval_tiny_dataset | 127 | FAIL | `tsx src/bench/guard-mcu-eval.ts --mode gold --split-manifest '/home/zephryj/projects/turingos/benchmarks/data/sft/splits/latest_manifest.json' --policy-limit 50 --reflex-limit 50` |

