# Handover Audits Index

Active audit evidence for the current handover lives in this folder.

Compatibility placeholders:
- `protocol/` and `recursive/` directories are intentionally retained for tooling compatibility.
- Their latest historical gate markdown files are archived under `../archive/20260227_audit_trim/audits/`.

## Active Evidence (Current Cycle)

### Local Model
- `localmodel/guard_mcu_eval_latest.md`
- `localmodel/guard_mcu_eval_latest.json`
- `localmodel/guard_mcu_eval_mac_qwen3_coder30b_20260227.json`
- `localmodel/guard_mcu_eval_mac_qwen3_finetuned_latest.json`

### Longrun - Raw Death Traces
- `longrun/raw_death_traces_20260227/manifest.json`
- `longrun/raw_death_traces_20260227/panic_budget_exhaustion_budget0.journal.log`
- `longrun/raw_death_traces_20260227/panic_budget_longrun_80ticks.journal.log`
- `longrun/raw_death_traces_20260227/realworld_interrupt_run_cpufault_panicreset.journal.log`

### Longrun - Task A/B Bundle
- `longrun/taskA_taskB_trace_bundle_20260227/manifest.json`
- `longrun/taskA_taskB_trace_bundle_20260227/taskA_realworld_eval_20260227_115404.md`
- `longrun/taskA_taskB_trace_bundle_20260227/taskA_realworld_eval_20260227_133652.md`
- `longrun/taskA_taskB_trace_bundle_20260227/devops_blindbox_local_20260227_113517.md`

### Longrun - Phase B (Approved Real VPS)
- `longrun/phaseB_vps_blindbox_20260227/manifest.json`
- `longrun/phaseB_vps_blindbox_20260227/devops_blindbox_vps_20260227_160556.json`
- `longrun/phaseB_vps_blindbox_20260227/devops_blindbox_vps_20260227_160556.md`

### SFT - Phase C (Rebalance + DPO)
- `sft/phaseC_sft_dpo_20260227/manifest.json`
- `sft/phaseC_sft_dpo_20260227/guard_sft_dataset_latest.json`
- `sft/phaseC_sft_dpo_20260227/failure_recovery_dataset_stats_latest.json`
- `sft/phaseC_sft_dpo_20260227/sft_dpo_grit_recipe_dataset.json`
- `sft/phaseC_sft_dpo_20260227/model_matrix_latest.json`

## Archived Legacy Gate Files
These files are preserved but intentionally moved out of active review scope:

### Recursive (Gemini)
- `../archive/20260227_audit_trim/audits/recursive/phase1_vliw_recursive_audit_20260227_060130.md`
- `../archive/20260227_audit_trim/audits/recursive/phase2_chaos_recursive_audit_20260227_060810.md`
- `../archive/20260227_audit_trim/audits/recursive/phase3_voyager_recursive_audit_20260227_060850.md`
- `../archive/20260227_audit_trim/audits/recursive/final_vliw_chaos_recursive_audit_20260227_061057.md`

### Protocol Gates (Latest Snapshot)
- `../archive/20260227_audit_trim/audits/protocol/syscall_schema_consistency_latest.md`
- `../archive/20260227_audit_trim/audits/protocol/turing_bus_conformance_latest.md`

### Longrun Gates (Latest Snapshot)
- `../archive/20260227_audit_trim/audits/longrun/chaos_monkey_gate_latest.md`
- `../archive/20260227_audit_trim/audits/longrun/voyager_realworld_eval_latest.md`
- `../archive/20260227_audit_trim/audits/longrun/trace_evidence_compact_latest.md`
