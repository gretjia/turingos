# Gemini Independent Decision: Planner QwQ-32B + Worker Qwen3-Coder-30B (2026-02-28)

Source: `gemini -y` headless review over:
- `handover/artitecture_response/core_architect_opinion_anti_oreo_v2_20260228.md`
- `handover/artitecture_response/final_success_criterion_maker_1m_steps_20260228.md`
- `handover/audit/hardware_planner_fit_research_20260228.md`
- Current baseline summaries under `benchmarks/audits/baseline/`

## Gemini Verdict
- **Decision:** CONDITIONAL GO (有条件推进)
- Approve moving to `Planner=QwQ-32B(local linux1-lx)` + `Worker=Qwen3-Coder-30B` for P1 A/B phase.

## Hard PASS/FAIL Gates from Gemini
- PASS conditions:
  - consecutive pass >= 20 (must exceed current turingos_dualbrain best 12)
  - avg parse repair per tick <= 0.5
  - p95 tick latency <= 5s
- FAIL rollback triggers:
  - redFlags>=3 KILLED ratio > 5%
  - backend instability (OOM / core dump) in 1h soak

## Ladder toward 1,000,000 target
- Preconditions:
  - 1h backend soak stability
  - enforce strict JSON/grammar constraints at serving layer
- Gates:
  - 20 -> 50 -> 200 -> 1k -> 10k -> 100k -> 1M
- Rollback:
  - unresolved waitPids blocking > 5 cycles
  - persistent severe price collapse / repeated hard kills

## Top Risks & Mitigations
1. Planner non-JSON drift -> enforce grammar lock, not prompt-only constraints.
2. Thrashing in repairs -> keep strict red-flag kill and force planner replanning.
3. AMD backend latency collapse -> quantization + Vulkan fallback.
4. Longrun cross-contamination -> strict PCB isolation and bounded mailbox.
5. HALT false positives -> white-box deterministic verifier only.

## Recommended immediate step
- Finish backend/model setup on linux1-lx, then start Gate-20 with full telemetry:
  - redFlags kill ratio
  - parse repair rate
  - p95 tick latency
  - halt reject retries
