# Handover Audits Index

Active audit evidence for the current architect cycle lives here.
Only current-cycle evidence is listed below; legacy evidence is archived.

## Active Evidence

### Local Model Gates
- `localmodel/guard_mcu_eval_latest.md`
- `localmodel/guard_mcu_eval_latest.json`
- `localmodel/guard_mcu_eval_mac_qwen3_coder30b_20260227.json`
- `localmodel/guard_mcu_eval_mac_qwen3_finetuned_latest.json`

### Model Comparison Inputs
- `modelcompare/guard_mcu_eval_kimi_pretrain_20260227.json`
- `modelcompare/guard_mcu_eval_mac_qwen3_base_20260228_015534.json`
- `modelcompare/guard_mcu_eval_mac_qwen3_base_20260228_015534.md`

### Longrun - Raw Failure Evidence
- `longrun/raw_death_traces_20260227/manifest.json`
- `longrun/raw_death_traces_20260227/panic_budget_exhaustion_budget0.journal.log`
- `longrun/raw_death_traces_20260227/realworld_interrupt_run_cpufault_panicreset.journal.log`

### Longrun - Task A/B and Phase A/B Evidence
- `longrun/taskA_taskB_trace_bundle_20260227/manifest.json`
- `longrun/phaseA_io_hardening_20260227/manifest.json`
- `longrun/phaseB_vps_blindbox_20260227/manifest.json`

### Longrun - Post-Training Wild OSS (Mac)
- `longrun/posttrain_mac_20260228/voyager_realworld_eval_20260228_015907.json`
- `longrun/posttrain_mac_20260228/voyager_realworld_eval_20260228_015907.md`
- `longrun/posttrain_mac_20260228/voyager_realworld_trace_20260228_015907.jsonl`
- `longrun/posttrain_mac_20260228/dirty_trace_20260228_015907.jsonl`

### SFT - Phase C Bundle
- `sft/phaseC_sft_dpo_20260227/manifest.json`
- `sft/phaseC_sft_dpo_20260227/guard_sft_dataset_latest.json`
- `sft/phaseC_sft_dpo_20260227/guard_sft_split_latest.json`
- `sft/phaseC_sft_dpo_20260227/failure_recovery_dataset_stats_latest.json`
- `sft/phaseC_sft_dpo_20260227/sft_dpo_grit_recipe_dataset.json`
- `sft/phaseC_sft_dpo_20260227/model_matrix_latest.json`
- `sft/phaseC_sft_dpo_20260227/model_matrix_latest.md`

## Compatibility
- `protocol/` and `recursive/` directories are retained for tooling compatibility.
- Historical protocol/recursive snapshots remain under:
  - `../archive/20260227_audit_trim/audits/`
