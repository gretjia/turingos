# Phase F Report: Post-Training Wild OSS Longrun (2026-02-27)

## Run Profile
- Host: `ZephrydeMac-Studio.local`
- Runtime: `mlx_lm.server` with LoRA adapter
- Base URL: `http://127.0.0.1:8080/v1`
- Model: `/Users/zephryj/work/turingos/models/qwen3-coder-30b-a3b-instruct-4bit`
- Task: `keploy/keploy` issue `#3843`
- Requested ticks: `120`

## Artifacts (synced)
- `handover/audits/longrun/posttrain_mac_20260228/voyager_realworld_eval_20260228_015907.json`
- `handover/audits/longrun/posttrain_mac_20260228/voyager_realworld_eval_20260228_015907.md`
- `handover/audits/longrun/posttrain_mac_20260228/voyager_realworld_trace_20260228_015907.jsonl`
- `handover/audits/longrun/posttrain_mac_20260228/dirty_trace_20260228_015907.jsonl`

## Gate Result
- Overall: **FAIL**
- `ticksObserved=67` (<100)
- `vliwEvidence.found=false`
- `chaosEvidence.pagedFloodDetected=false`
- `context_o1_bound_under_4k_mmu=PASS` (`max=1838`, `avg=1009.39`)

## Failure Characteristics (from dirty trace)
- Replay tuples: `67`
- Trap-frame-rich behavior with heavy fault pressure:
  - `cpu_fault` mentions: `447`
  - `panic_reset` mentions: `94`
- Pattern: repeated trap/panic-reset loops compressing effective progress.

## Interpretation
- Training/post-training runtime is wired correctly and runnable in production-like local serving mode.
- Core O(1) context bound is preserved.
- Main blockers remain in robust syscall emission and chaos-followup behavior under pressure (missing required VLIW combo and paged flood follow-up evidence for this run).

## Cleanup
- Finetuned MLX server on port 8080 has been stopped after run.
