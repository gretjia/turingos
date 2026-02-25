# Benchmark Selection For Long-Horizon AGI Stress

This pilot suite focuses on failure modes that frequently crash long-running agents:

1. Long-context memory decay and distraction collapse.
2. Multi-hop reasoning drift under long documents.
3. Output-contract breakage (invalid JSON / format drift).

## Selected benchmarks

- `BABILong` (RMT-team):
  - Purpose: stress retrieval/reasoning as context grows from short to very long.
  - Why included: directly targets long-context degradation that causes plan drift and wrong writes.
  - Source: https://huggingface.co/datasets/RMT-team/babilong

- `LongBench` (zai-org, originally THUDM):
  - Purpose: broad long-context evaluation across QA/reasoning/retrieval.
  - Pilot subsets used here: `hotpotqa_e`, `2wikimqa_e`, `passage_count_e`.
  - Why included: stresses multi-hop + counting + long evidence tracking.
  - Source: https://huggingface.co/datasets/zai-org/LongBench
  - Paper: https://arxiv.org/abs/2308.14508

- `CrashSuite/json_contract` (project stress set):
  - Purpose: test strict machine-output contract under adversarial/noisy instructions.
  - Why included: JSON-format collapse is a top operational failure for autonomous loops.
  - Source: local synthetic suite in `src/bench/pilot.ts`.

## Additional recommended suites (next stage)

- `GAIA` (real-world tool-heavy tasks): https://huggingface.co/papers/2311.12983
- `AgentBench` (multi-environment agent eval): https://openreview.net/forum?id=zAdUB0aCTQ
- `tau-bench` (tool-agent reliability benchmark): https://arxiv.org/abs/2406.12045

## Industry-consensus AI OS matrix (standardized gate)

- Matrix spec: `benchmarks/industry-consensus/matrix.v1.json`
- Human-readable standard: `benchmarks/industry-consensus/consensus_standard_20260225.md`
- Execution/score script: `npm run bench:industry-matrix`
