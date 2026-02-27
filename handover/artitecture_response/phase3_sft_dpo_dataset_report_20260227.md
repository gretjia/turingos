# Phase3 SFT/DPO Dataset Report (2026-02-27)

## Scope

基于最新 `guard_sft_dataset` 产物，构建“失败恢复主导”的训练数据统计，覆盖：

- Policy rows（syscall policy）
- Reflex rows（trap -> recovery）
- 40/40/20 采样可行性（Golden / Failure-Recovery / Rejected）

## Executions

1. `npm run -s bench:guard-sft-dataset`
- 输出：`policy_rows=615`, `reflex_rows=51`, `scanned_traces=85`, `pass=true`
- 报告：`../../benchmarks/audits/sft/guard_sft_dataset_20260227_121203.json`

2. `npm run -s bench:guard-sft-split`
- 输出：
  - policy: `615` -> `train=492 val=61 test=62`
  - reflex: `51` -> `train=40 val=5 test=6`
- 报告：`../../benchmarks/audits/sft/guard_sft_split_20260227_121206.json`

3. `npm run -s bench:failure-recovery-dataset-stats`
- 目标输出：`../../benchmarks/audits/sft/failure_recovery_dataset_stats_20260227.json`
- 关键统计：
  - `golden=509`
  - `failure_recovery=292`
  - `rejected=24`
  - 40/40/20 最大可采样总量 `120`（`48/48/24`）

## Artifacts

- `../../benchmarks/audits/sft/guard_sft_dataset_latest.json`
- `../../benchmarks/audits/sft/guard_sft_split_latest.json`
- `../../benchmarks/audits/sft/failure_recovery_dataset_stats_20260227.json`
- `../../benchmarks/audits/sft/failure_recovery_dataset_stats_latest.json`

## Status

- Phase3 数据统计链路：`complete`
- DPO 对（chosen/rejected）样本构建：`next`
- Fine-tuned 模型训练与评测：`pending`
