# Dual-LLM Smoke & Runtime Readiness (2026-02-28)

## Scope
- Validate model readiness after host allocation decision:
  - Planner lane: Mac (`qwq:32b`)
  - Worker lane: Linux (`qwen2.5:7b`)
- Validate transport path and minimal runtime behavior.

## Evidence

### 1) Model availability
- Mac (`100.72.87.94`) `ollama list` shows:
  - `qwq:32b`
  - `qwen3-coder:30b`
  - `qwen2.5:7b`
- Linux (`100.64.97.113`) `ollama list` shows:
  - `qwen2.5:7b`

### 2) Endpoint availability
- Planner endpoint via local tunnel: `http://127.0.0.1:11434`
  - `/api/version` => `0.17.0`
- Worker endpoint direct tailscale: `http://100.64.97.113:11434`
  - `/api/version` => `0.17.4`

### 3) OpenAI-compatible quick call sanity
- Worker (`qwen2.5:7b`) returns strict JSON quickly.
- Planner (`qwq:32b`) returns `<think>...</think>` plus final JSON, which increases parse-repair pressure under strict frame mode.

### 4) Million baseline compare smoke (1 case)
- Command class: `bench:million-baseline-compare --modes turingos_dualbrain --max-tests 1`
- With Planner=`qwen3-coder:30b`, Worker=`qwen2.5:7b`:
  - PASS (1/1)
  - report: `benchmarks/audits/baseline/million_baseline_compare_20260228_133245.json`
- With Planner=`qwq:32b`, Worker=`qwen2.5:7b`:
  - Did not converge within timeout window (`timeout 240`), repeated parse-repair logs.

## Runtime Fix Applied
To remove dependency on broken local alias (`mac-back -> localhost:2222`), tunnel helper now defaults to direct tailscale target.

Updated files:
- `scripts/open_dual_llm_tunnels.sh`
  - Added env-driven target:
    - `TURINGOS_MAC_SSH_TARGET` (default `zephryj@100.72.87.94`)
    - `TURINGOS_MAC_SSH_IDENTITY`
    - `TURINGOS_MAC_SSH_PORT` (optional)
- `configs/dual_llm_profiles/mac_planner_linux_workers.env`
  - Added default tunnel variables above.

## PASS/FAIL Gate (current)
- Infrastructure readiness: PASS
- Worker lane readiness (`qwen2.5:7b`): PASS
- Planner lane readiness using `qwq:32b` under strict single-frame parser: FAIL (timeout/repair churn)
- Dualbrain benchmark path (with planner fallback `qwen3-coder:30b`): PASS (smoke only)

## Immediate Next Step
- Keep `qwq:32b` installed as candidate planner.
- For active runs, use planner fallback `qwen3-coder:30b` until parser policy is upgraded to robustly handle reasoning preamble (`<think>` blocks) without deadlock/timeout.
