# Phase F Report: Baseline -> Training Prep (2026-02-27)

## Executive
- Wild OSS baseline (Kimi, keploy#3843) completed with **FAIL** on tick threshold (`69 < 100`).
- Core protocol evidence captured: VLIW combo, log flood follow-up, O(1) context bound.
- Gemini recursive audit for this stage: **PASS (GO)** for progression because deep-water failure evidence is valid and non-vanity.
- Training data pipeline has been refreshed from latest traces and MLX package generated.

## Baseline Outcome
- Source: `benchmarks/audits/longrun/voyager_realworld_eval_latest.json`
- Key points:
  - `ticksRequested=160`, `ticksObserved=69`
  - `vliwEvidence.found=true`
  - `chaosEvidence.pagedFloodDetected=true`
  - `contextStats.max=3996` (4K MMU bound held)

## Gemini Recursive Audit
- File: `handover/artiteture_response/gemini_recursive_audit_phaseF_baseline_20260227.md`
- Verdict:
  - Stage verdict: PASS/GO (baseline stage quality), with blockers recorded.
- Top blockers extracted by auditor:
  - Context poisoning / intent drift after IO fault.
  - Recovery chain recursion leading to poor MTTR under chaos.
  - Verification gate failures on test execution discipline.

## Stage C Data Pipeline (Completed)
- Commands executed:
  - `bench:extract-thrashing-journal`
  - `bench:guard-sft-dataset`
  - `bench:guard-sft-split`
  - `bench:failure-recovery-dataset-stats`
  - `bench:sft-dpo-grit-recipe`
  - `bench:prepare-mlx-sft-data`
- Outputs:
  - SFT dataset report: `benchmarks/audits/sft/guard_sft_dataset_20260227_174934.json`
  - Split report: `benchmarks/audits/sft/guard_sft_split_20260227_174934.json`
  - Failure-recovery stats: `benchmarks/audits/sft/failure_recovery_dataset_stats_20260227.json`
  - Grit recipe dataset: `handover/sft_dpo_grit_recipe_dataset.json`
  - MLX prep dir: `benchmarks/data/sft/mlx/mlx_sft_20260227T174936`

## Pretrain Baseline for Compare (Completed)
- Guard eval (model mode, Kimi): `benchmarks/audits/sft/guard_mcu_eval_20260227_175117.json`
- Snapshot copy: `handover/audits/modelcompare/guard_mcu_eval_kimi_pretrain_20260227.json`

## Compare Snapshot (Pretrain vs Finetuned Reference)
- File: `handover/artiteture_response/phaseF_pre_vs_finetuned_compare_20260227.md`
- Main signal:
  - `reflexExactMatchRate`: `0.40` (pretrain) vs `1.00` (finetuned reference)

## Infra Update
- Root disk resized from ~10G to 49G usable.
- Expansion actions completed in this session (`growpart + partprobe + resize2fs`).

## Next
1. Run fresh post-training eval on same environment profile as baseline for fair delta.
2. Regenerate model matrix with this round's baseline + post-training outputs.
3. Trigger Gemini recursive audit for GO/NO-GO on training-comparison package.
