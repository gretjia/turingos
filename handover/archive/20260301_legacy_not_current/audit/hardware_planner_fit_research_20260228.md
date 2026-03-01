# Hardware-Model Fit Research: Planner Selection for linux1-lx (2026-02-28)

## Scope
- Goal: choose the best **local Planner model** for TuringOS on `linux1-lx` (AMD Ryzen AI Max+ 395, 128GB unified memory), replacing unstable external Planner APIs.
- Constraint: Planner must fit TuringOS strict syscall ABI (`mind_ops/world_op`), long-run stability, and high recovery under traps.

## Current TuringOS Evidence (Local Bench)
Source: `benchmarks/audits/baseline/*.json` in this repo.
- `qwen_direct` best: `19` consecutive pass (`million_baseline_compare_20260228_064532.json`)
- `kimi_direct` best: `200` consecutive pass (`million_baseline_compare_20260228_070618.json`)
- `turingos_dualbrain` new best: `12` consecutive pass (`million_baseline_compare_20260228_093527.json`)
- Additional recent local dualbrain run: `8/8 PASS` (`million_baseline_compare_20260228_092829.json`)

Interpretation:
- Kernel/protocol adaptation is improving.
- Main bottleneck is Planner output stability (format drift -> parse repair retries -> throughput collapse).

## Hardware & Runtime Facts (External Official Sources)
1. AMD states Ryzen AI Max+ 395 enables large local LLM workloads; unified-memory-class capacity is the key advantage.
   - https://www.amd.com/en/blogs/2025/amd-ryzen-ai-max-upgraded-run-up-to-128-billion-parameter-llms-lm-studio.html
   - https://www.amd.com/pt/developer/resources/technical-articles/2025/amd-ryzen-ai-max-395--a-leap-forward-in-generative-ai-performanc.html

2. ROCm docs explicitly require checking support; mobile/Radeon paths have limitations, and ROCm on mobile SKUs is not officially supported in certain Radeon/Ryzen docs.
   - https://rocm.docs.amd.com/projects/install-on-linux/en/latest/reference/system-requirements.html
   - https://rocm.docs.amd.com/projects/radeon-ryzen/en/docs-6.0.2/docs/limitations.html

3. `llama.cpp` supports Vulkan/HIP and CPU+GPU hybrid inference, useful when model size > practical VRAM budget.
   - https://github.com/ggml-org/llama.cpp

4. Candidate model cards:
   - Qwen3-Coder-30B-A3B-Instruct: https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct
   - QwQ-32B: https://huggingface.co/Qwen/QwQ-32B
   - DeepSeek-R1-Distill-Qwen-32B: https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-32B

## TuringOS-Specific Planner Requirements
- R1: strict JSON/ABI compliance (low `MUTEX_VIOLATION`).
- R2: high reasoning depth for decomposition/scheduling (`MOVE/EDIT` heavy phases).
- R3: stable under long ticks (no runaway verbosity).
- R4: practical local latency (MTTR under chaos is primary KPI).

## Candidate Ranking (for Planner role)
1. **Primary Candidate: QwQ-32B**
- Why: reasoning-first 32B profile, strong for long-horizon scheduling decisions.
- Risk: may need stronger output-shaping prompts to keep ABI strict.

2. **Secondary Candidate: DeepSeek-R1-Distill-Qwen-32B**
- Why: strong reasoning/coding mix and robust math/code behavior.
- Risk: can emit longer reasoning traces; may increase parse/repair overhead.

3. **Fallback/Control: Qwen3-Coder-30B-A3B-Instruct**
- Why: already integrated in our flow, proved local dualbrain can reach 12-pass ceiling.
- Risk: planner-level reasoning can drift into format variants without adapter hardening.

## Recommended Runtime Stack on linux1-lx
- Preferred: `llama.cpp`/Ollama with Vulkan backend first (more practical on this hardware class).
- Secondary: ROCm/HIP path only after explicit device support validation.
- Always keep OpenAI-compatible serving endpoint for TuringOS router.

## Phase Plan (Planner Migration)
### Phase P0 (1 day): Environment readiness
- Validate backend health with a small model and JSON constrained output.
- Gate: stable API + no backend crashes for 1 hour soak.

### Phase P1 (1-2 days): Model A/B/C
- Run Planner A/B on same benchmark harness:
  - A: QwQ-32B
  - B: DeepSeek-R1-Distill-Qwen-32B
  - C: Qwen3-Coder-30B-A3B (control)
- Fixed worker: Qwen3-Coder-30B-A3B.
- Compare metrics:
  - `consecutivePassBeforeFirstFail`
  - parser repair rate
  - mean ticks per solved case
  - p95 latency per tick

### Phase P2: Promote winner and ladder test
- Promote best Planner to default.
- Ladder targets: `20 -> 50 -> 100 -> 1k` (must pass each gate before next).

## Decision
- **Near-term best practical Planner for linux1-lx research path: `QwQ-32B` (candidate #1), with `DeepSeek-R1-Distill-Qwen-32B` as close #2.**
- **Operational control remains `Qwen3-Coder-30B-A3B` until A/B proves a higher ceiling with acceptable latency.**

## Relation to 1M-Step Goal
The target is still `1,000,000`-step reliability (per arXiv 2511.09030 framing). We are not changing target; we are reducing bottlenecks systematically:
1. Planner stability,
2. ABI compliance,
3. throughput/latency.

Reference:
- https://arxiv.org/abs/2511.09030
