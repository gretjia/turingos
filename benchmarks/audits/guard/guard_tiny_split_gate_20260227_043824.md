# Guard Tiny Split Gate

- stamp: 20260227_043824
- pass: true
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/guard/guard_tiny_split_gate_20260227_043824.json

| Check | Result | Details |
|---|---|---|
| Tiny split command | PASS | split command passed (exit=0) |
| Tiny split counts | PASS | reflex counts train=1, val=1, test=0 |
| Tiny eval command | PASS | eval command passed (exit=0) |
| Tiny eval report assertions | PASS | reflexTotal=1, selected_reflex_split=val, valid_json_rate=1 |

| Step | Exit | Result | Command |
|---|---:|---|---|
| split_tiny_dataset | 0 | PASS | `npm run bench:guard-sft-split -- --policy-input '/home/zephryj/projects/turingos/benchmarks/data/sft/tiny_gate_20260227_043824/policy_tiny.jsonl' --reflex-input '/home/zephryj/projects/turingos/benchmarks/data/sft/tiny_gate_20260227_043824/reflex_tiny.jsonl' --out-dir '/home/zephryj/projects/turingos/benchmarks/data/sft/tiny_gate_20260227_043824/splits' --train-pct 80 --val-pct 10` |
| eval_tiny_dataset | 0 | PASS | `npm run bench:guard-mcu-eval -- --mode gold --split-manifest '/home/zephryj/projects/turingos/benchmarks/data/sft/splits/latest_manifest.json' --policy-limit 50 --reflex-limit 50` |

