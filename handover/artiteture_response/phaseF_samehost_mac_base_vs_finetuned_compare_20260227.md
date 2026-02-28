# Phase F Same-Host Compare: Mac Base vs Finetuned (2026-02-27)

## Scope
- Host: `ZephrydeMac-Studio.local`
- Base model eval: `handover/audits/modelcompare/guard_mcu_eval_mac_qwen3_base_20260228_015534.json`
- Finetuned model eval: `handover/audits/localmodel/guard_mcu_eval_mac_qwen3_finetuned_latest.json`

## Fairness Check
- Same physical host: yes
- Same task volume: yes (`policyEvaluated=41`, `reflexEvaluated=1` for both)
- Same eval harness: `bench:guard-mcu-eval --mode model --threshold-profile dev`

## Metrics
| Metric | Base (qwen3-coder:30b @ 11434/v1) | Finetuned (Qwen3 30B 4bit @ 8080/v1) |
|---|---:|---:|
| validJsonRate | 1.00 | 1.00 |
| schemaViolationRate | 0.00 | 0.00 |
| mutexViolationRate | 0.00 | 0.00 |
| reflexExactMatchRate | 1.00 | 1.00 |
| deadlockEscapeRate | 1.00 | 1.00 |
| modelRepairAttempts | 0 | 6 |
| avgPerEvalMs | 995.93 | 954.62 |
| pass | true | true |

## Readout
- Contract discipline is equivalent (all strict schema/mutex/reflex/deadlock checks green).
- Finetuned path is slightly faster in this run (`995.93ms -> 954.62ms`).
- Finetuned required more model repair attempts (`0 -> 6`), suggesting output normalization pressure remains a tuning target.

## Remaining Gap to Full-Cycle Close
- Need one post-training **Wild OSS longrun** with the finetuned runtime profile and a final recursive audit GO/NO-GO on that longrun + compare package.
