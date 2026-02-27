# Guard Tiny Split Gate

- stamp: 20260227_042915
- pass: false
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/guard/guard_tiny_split_gate_20260227_042915.json

| Check | Result | Details |
|---|---|---|
| Tiny split command | PASS | split command passed (exit=0) |
| Tiny split counts | PASS | reflex counts train=1, val=1, test=0 |
| Tiny eval command | FAIL | eval command failed (exit=2) |

| Step | Exit | Result | Command |
|---|---:|---|---|
| split_tiny_dataset | 0 | PASS | `npm run bench:guard-sft-split -- --policy-input '/home/zephryj/projects/turingos/benchmarks/data/sft/tiny_gate_20260227_042915/policy_tiny.jsonl' --reflex-input '/home/zephryj/projects/turingos/benchmarks/data/sft/tiny_gate_20260227_042915/reflex_tiny.jsonl' --out-dir '/home/zephryj/projects/turingos/benchmarks/data/sft/tiny_gate_20260227_042915/splits' --train-pct 80 --val-pct 10` |
| eval_tiny_dataset | 2 | FAIL | `npm run bench:guard-mcu-eval -- --mode gold --split-manifest '/home/zephryj/projects/turingos/benchmarks/data/sft/splits/latest_manifest.json' --policy-limit 50 --reflex-limit 50` |

