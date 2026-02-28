# Phase F Pretrain vs Finetuned Comparison (2026-02-27)

## Scope
- Pretrain baseline (this round): `benchmarks/audits/sft/guard_mcu_eval_20260227_175117.json`
- Finetuned reference (Mac local): `handover/audits/localmodel/guard_mcu_eval_mac_qwen3_finetuned_latest.json`

## Metrics
| Metric | Pretrain (Kimi API) | Finetuned (Qwen3 local, Mac) |
|---|---:|---:|
| validJsonRate | 1.00 | 1.00 |
| schemaViolationRate | 0.00 | 0.00 |
| mutexViolationRate | 0.00 | 0.00 |
| reflexExactMatchRate | 0.40 | 1.00 |
| deadlockEscapeRate | 1.00 | 1.00 |
| avgPerEvalMs | 1236.33 | 954.62 |
| pass | true | true |

## Readout
- Reflex quality is materially better on finetuned local model (`0.40 -> 1.00`).
- Schema/Mutex discipline is equally strict on both.
- Finetuned local latency in this reference is lower than the current API baseline.

## Caveat
- This is a cross-environment comparison (Omega VM API vs Mac local). 
- For strict same-environment fairness, rerun post-training guard eval on the same host/config and regenerate this table.
