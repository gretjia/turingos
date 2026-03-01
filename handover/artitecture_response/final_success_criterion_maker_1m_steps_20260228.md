# Final Success Criterion Lock (MAKER 1M Steps)

- Date: 2026-02-28
- Source: user directive for this cycle
- Reference experiment: `https://arxiv.org/html/2511.09030v1`

## Locked Rule
TuringOS is considered finally successful only if one end-to-end run satisfies both:
1. step count reaches **1,000,000** or more;
2. final answer is verified correct by deterministic evidence.

If either condition is not met, the project remains in iterative hardening mode:
- continue debugging;
- continue architecture adjustment;
- continue model training and rerun.

## Machine Gate
- Command: `npm run bench:maker-1m-steps-gate -- --trace <trace.jsonl> --answer <verdict.json>`
- Audit output: `benchmarks/audits/final_gate/maker_1m_steps_gate_latest.json`
