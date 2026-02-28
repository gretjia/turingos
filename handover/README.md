# Handover Index (Current Cycle, AI-Agent Friendly)

## Cycle Snapshot (Read This First)
- **Cycle ID:** `Current Cycle` (all work since the latest Chief Architect reply)
- **Current status:** `NO-GO` for promotion to next stage
- **Why NO-GO:** deep-water regression in post-train longrun (`cpu_fault` + `panic_reset` pressure), even though local guard metrics improved
- **Scope of this handover:** all outputs produced since the latest architect reply (Phase A -> Phase F and post-train reruns), trimmed to decision-critical files

## Single Entry for Architect Questions
If you are the Chief Architect (or an audit agent acting as architect), open this file first:
- `artiteture_response/phaseF_questions_for_chief_architect_20260227.md`

This is the canonical question set for this round. It contains decision options and thresholds.

## Mandatory Evidence Mappings (Architect Requested)
- **Raw Death Traces:** `audits/longrun/raw_death_traces_20260227/manifest.json`
- **SFT Model Matrix:** `audits/sft/phaseC_sft_dpo_20260227/model_matrix_latest.md` (and `.json`)
- **Context Degradation Profile:** `audits/longrun/taskA_taskB_trace_bundle_20260227/taskA_context_degradation_heatmap_20260227_133652.md` (and `.json`)

## Recommended Reading Order
1. `artiteture_response/chief_architect_independent_audit_reply_20260227.md`
2. `artiteture_response/phaseF_full_cycle_supervision_plan_20260227.md`
3. `artiteture_response/phaseA_io_hardening_report_20260227.md`
4. `artiteture_response/phaseB_vps_blindbox_report_20260227.md`
5. `artiteture_response/phaseC_sft_dpo_rebalance_report_20260227.md`
6. `artiteture_response/phaseD_wild_oss_candidate_gate_report_20260227.md`
7. `artiteture_response/phaseE_wild_oss_preflight_gate_report_20260227.md`
8. `artiteture_response/phaseF_baseline_to_trainingprep_report_20260227.md`
9. `artiteture_response/phaseF_samehost_mac_base_vs_finetuned_compare_20260227.md`
10. `artiteture_response/phaseF_posttrain_wildoss_longrun_report_20260227.md`
11. `artiteture_response/gemini_recursive_audit_phaseF_final_20260227.md`
12. `artiteture_response/phaseF_final_no_go_report_20260227.md`
13. `artiteture_response/phaseF_questions_for_chief_architect_20260227.md`
14. `audits/README.md`

## Phase A-F Path Map
- `Phase A`: `artiteture_response/phaseA_io_hardening_report_20260227.md`
- `Phase B`: `artiteture_response/phaseB_vps_blindbox_report_20260227.md`
- `Phase C`: `artiteture_response/phaseC_sft_dpo_rebalance_report_20260227.md`
- `Phase D`: `artiteture_response/phaseD_wild_oss_candidate_gate_report_20260227.md`
- `Phase E`: `artiteture_response/phaseE_wild_oss_preflight_gate_report_20260227.md`
- `Phase F (plan)`: `artiteture_response/phaseF_full_cycle_supervision_plan_20260227.md`
- `Phase F (baseline->training prep)`: `artiteture_response/phaseF_baseline_to_trainingprep_report_20260227.md`
- `Phase F (same-host compare)`: `artiteture_response/phaseF_samehost_mac_base_vs_finetuned_compare_20260227.md`
- `Phase F (post-train longrun)`: `artiteture_response/phaseF_posttrain_wildoss_longrun_report_20260227.md`
- `Phase F (final gate)`: `artiteture_response/phaseF_final_no_go_report_20260227.md`
- `Phase F (architect questions)`: `artiteture_response/phaseF_questions_for_chief_architect_20260227.md`

## Directory Taxonomy
- **`artiteture_response/`**: active phase reports, recursive audits, and architect Q&A for this cycle.
- **`audits/`**: active evidence bundles for this cycle (longrun, model compare, SFT, local model eval).
- **`archive/`**: legacy cycle materials. Ignore for current decision unless explicitly requested.

## Do Not Get Distracted
- This repository contains historical handovers.
- For this round, prioritize only `artiteture_response/*`.
- For this round, prioritize only `audits/*`.
- Read `archive/*` only when a question explicitly asks for historical comparison.

## Tooling Compatibility
- For tools expecting singular path naming: `audit/README.md` is aliased to `audits/README.md`.
