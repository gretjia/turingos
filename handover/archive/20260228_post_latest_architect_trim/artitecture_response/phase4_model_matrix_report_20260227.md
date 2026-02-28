# Phase4 Model Matrix Report (2026-02-27)

## Scope

统一口径汇总 `guard_mcu_eval` 指标，比较 API / 本地基座 / 本地微调 在以下维度表现：

- Latency (`avgPerEvalMs`)
- Schema Violation Rate (`schemaViolationRate`)
- JSON 合规 (`validJsonRate`)
- 关键门控 (`reflexExactMatchRate`, `deadlockEscapeRate`)

## Source Artifacts

- `../../benchmarks/audits/sft/model_matrix_20260227.json`
- `../../benchmarks/audits/sft/model_matrix_latest.md`
- `../../benchmarks/audits/sft/guard_mcu_eval_20260227_112725.json` (API/Groq)
- `../../benchmarks/audits/sft/guard_mcu_eval_20260227_112733.json` (API/Kimi)
- `../audits/localmodel/guard_mcu_eval_mac_qwen3_coder30b_20260227.json` (Local Base)
- `../audits/localmodel/guard_mcu_eval_mac_qwen3_finetuned_latest.json` (Local Fine-tuned, MLX+LoRA)

## Current Matrix Snapshot

1. `api_groq_base` (`llama-3.1-8b-instant`)
- `avgPerEvalMs=219.50`
- `schemaViolationRate=0`
- `pass=true`

2. `api_kimi` (`kimi-for-coding`)
- `avgPerEvalMs=1320.50`
- `schemaViolationRate=0`
- `reflexExactMatchRate=0`
- `deadlockEscapeRate=0`
- `pass=false`

3. `local_qwen3_coder30b_mac` (`qwen3-coder:30b`)
- `avgPerEvalMs=433.08`
- `schemaViolationRate=0`
- `pass=true`

4. `local_qwen3_coder30b_finetuned_mlx_mac` (`Qwen3-Coder-30B-A3B + LoRA`)
- `avgPerEvalMs=954.62`
- `schemaViolationRate=0`
- `validJsonRate=1`
- `pass=true`

## Phase4 Verdict

- 状态：`PASS`（矩阵硬约束已满足，三路对比闭环完成）
- 说明：上一轮 `NO-GO` 的主因（缺少 Fine-tuned Local 行）已关闭。

## Remaining Cross-Phase Risk

1. 微调模型质量门控通过，但延迟高于本地基座（`954.62ms` vs `433.08ms`），后续需做 latency profiling。
2. 全局交付仍受 Phase5 的 `120+ ticks` 缺口约束（当前上下文衰退画像基于 100 ticks）。
