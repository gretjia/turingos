# Phase F Full-Cycle Supervision Plan (2026-02-27)

## Goal
Run a strict end-to-end loop, not baseline-only:
1. Wild OSS baseline run (API model) with failure evidence.
2. Recursive audit verdict.
3. SFT/DPO data refresh from real dirty traces (including thrashing/deadlock recovery).
4. Fine-tune handoff package generation for local Qwen3-Coder track.
5. Post-training re-eval on the same gate set.
6. Side-by-side comparison report (Latency + Schema Violation + MTTR-related signals).
7. Recursive audit GO/NO-GO.

## Locked Constraints (from architect)
- Do not accept green-only vanity results.
- Must include deep-water evidence: raw death traces, recovery chains, trap interactions.
- Keep O(1) context bound evidence.
- Keep dual-LLM recursive audit as release gate.

## Execution Stages

### Stage A: Baseline (API)
- Runner: `bench:voyager-realworld-eval` on wild OSS target.
- Current status: completed with FAIL (`ticksObserved < 100`), while core protocol checks passed.
- Artifact source:
  - `benchmarks/audits/longrun/voyager_realworld_eval_latest.json`
  - `benchmarks/audits/longrun/dirty_trace_latest.jsonl`

### Stage B: Recursive audit on baseline
- Auditor: `gemini -y` (headless).
- Inputs:
  - chief architect reply file
  - latest baseline report + dirty trace evidence
- Output target:
  - `handover/artiteture_response/gemini_recursive_audit_phaseF_baseline_20260227.md`

### Stage C: Data pipeline refresh (training feed)
- Commands:
  - `bench:extract-thrashing-journal`
  - `bench:guard-sft-dataset`
  - `bench:guard-sft-split`
  - `bench:failure-recovery-dataset-stats`
  - `bench:sft-dpo-grit-recipe`
  - `bench:prepare-mlx-sft-data`
- Required check:
  - Failure-recovery dominant ratio preserved (Golden/Failure/Reject style constraints).

### Stage D: Training handoff + post-training eval contract
- Training package produced for local Qwen3-Coder fine-tune path.
- Post-training eval must run with same gates as baseline:
  - `bench:guard-mcu-eval` (model mode)
  - `bench:model-matrix-report`
- Required outputs:
  - baseline vs finetuned comparison (latency + violation + reflex quality)

### Stage E: Final comparison + recursive GO/NO-GO
- Create one merged report with:
  - Baseline metrics
  - Post-training metrics
  - Delta table
  - Residual blockers
- Run Gemini recursive audit on merged report as final gate.

## Pass Criteria
- Not based on single PASS flag.
- Must satisfy:
  - Evidence completeness (death trace + recovery + context profile)
  - Comparative result availability (baseline vs post-training)
  - Recursive audit verdict = GO

