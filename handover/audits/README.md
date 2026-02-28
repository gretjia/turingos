# Audits Evidence Index

This directory contains active audit evidence for the current architecture cycle. Legacy evidence is archived under `../archive/`.

## Mandatory Architect Evidence
The core artifacts required for architectural review are directly mapped here:
- **Raw Death Traces:** `longrun/raw_death_traces_20260227/manifest.json` (includes `panic_budget_exhaustion_budget0.journal.log` and `realworld_interrupt_run_cpufault_panicreset.journal.log`)
- **SFT Model Matrix:** `sft/phaseC_sft_dpo_20260227/model_matrix_latest.md` (and `.json`)
- **Context Degradation Profile:** `longrun/taskA_taskB_trace_bundle_20260227/taskA_context_degradation_heatmap_20260227_133652.md` (and `.json`)

## Active Evidence Taxonomy

### 1. Longrun Evaluation & Traces
- **Task A/B context profiles:** `longrun/taskA_taskB_trace_bundle_20260227/manifest.json`
- **Phase A (I/O hardening):** `longrun/phaseA_io_hardening_20260227/manifest.json`
- **Phase B (VPS blindbox):** `longrun/phaseB_vps_blindbox_20260227/manifest.json`
- **Post-training Wild OSS (Mac):**
  - `longrun/posttrain_mac_20260228/voyager_realworld_eval_20260228_015907.md`
  - `longrun/posttrain_mac_20260228/voyager_realworld_trace_20260228_015907.jsonl`
  - `longrun/posttrain_mac_20260228/dirty_trace_20260228_015907.jsonl`

### 2. Model Baseline vs Finetuned Comparison
- **Same-host base vs finetuned inputs:**
  - Base: `modelcompare/guard_mcu_eval_mac_qwen3_base_20260228_015534.json` (and `.md`)
  - Pretrain (Kimi): `modelcompare/guard_mcu_eval_kimi_pretrain_20260227.json`

### 3. SFT / DPO Phase Data
- **Phase C bundle:** `sft/phaseC_sft_dpo_20260227/manifest.json`
- **Datasets and splits:**
  - `sft/phaseC_sft_dpo_20260227/guard_sft_dataset_latest.json`
  - `sft/phaseC_sft_dpo_20260227/guard_sft_split_latest.json`
  - `sft/phaseC_sft_dpo_20260227/failure_recovery_dataset_stats_latest.json`
  - `sft/phaseC_sft_dpo_20260227/sft_dpo_grit_recipe_dataset.json`

### 4. Local Model Gates
- `localmodel/guard_mcu_eval_latest.md` (and `.json`)
- `localmodel/guard_mcu_eval_mac_qwen3_coder30b_20260227.json`
- `localmodel/guard_mcu_eval_mac_qwen3_finetuned_latest.json`

## Compatibility Notes
- `protocol/` and `recursive/` directories are retained for script/tooling compatibility.
- Historical snapshots for these remain in `../archive/20260227_audit_trim/audits/`.
