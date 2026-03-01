# Dual-LLM Hardware Allocation (Confirmed)

Date: 2026-02-28

## Decision (confirmed)
- Planner on Mac: `qwq:32b`
- Workers on Linux: `qwen2.5:7b` (multi-worker fanout)

## Why
- Mac memory is limited (36GB unified): suitable for one deep planner, not many heavy concurrent workers.
- Linux has 121GiB RAM and 32 vCPU: better for parallel worker throughput.
- Matches Anti-Oreo nQ+1A: Linux handles nQ (parallel trial), Mac handles 1A (global synthesis).

## Current host status
- Mac: ollama installed; models include `qwen3-coder:30b`, `qwen2.5:7b`.
- Linux: ollama installed and active; logs constrained to prevent rootfs blowup.

## Runtime profile artifact
- `configs/dual_llm_profiles/mac_planner_linux_workers.env`
- tunnel helper: `scripts/open_dual_llm_tunnels.sh`
  - planner via tunnel: `127.0.0.1:11434 -> mac-back:11434`
  - worker via tailnet direct: `http://100.64.97.113:11434` (Linux ollama)

## Next operational step
1. Pull planner model on Mac: `ollama pull qwq:32b`
2. Pull worker model on Linux: `ollama pull qwen2.5:7b`
3. Open tunnels and launch with profile.
