# Workspace AI Agent Guide (Git Mirror)

This file mirrors the workspace root guide so it is tracked on GitHub.

## Reading Order (Current Cycle)

1. Total design: `../README.md`
2. Topology blueprint: `../topology.md`
3. Latest architect core design: `./artitecture_response/core_architect_opinion_anti_oreo_v2_20260228.md`
4. Latest architect action plan: `./artitecture_response/dual_llm_joint_action_plan_from_core_opinion_20260228.md`
5. Current blocker handover (external workspace handover dir): `../../../handover/turingos_arch_review_handover_20260301_035950.md`

## Network Port Mapping Rules (Mac Node 100.72.87.94)

- **Planner (llama-server)**: ALWAYS use port `8080` (e.g., `http://100.72.87.94:8080/v1`). DO NOT use port `2222` as it is an unstable reverse tunnel.
- **Worker (Ollama)**: ALWAYS use port `11434` (e.g., `http://100.72.87.94:11434/v1`).

## Current Main Problems

- Baseline report integrity after timeout/interruption is not reliable (stale range reuse).
- Planner can thrash after consensus and delay deterministic HALT.
- Worker pool is high-count but low-diversity, so cost rises faster than reliability.
- Long-run recovery orchestration still has fragile resume semantics.

## Handover Policy

- Keep current-cycle decision docs in `handover/`.
- Move old or non-current files to `handover/archive/`.