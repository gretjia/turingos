# Wild OSS Top3 Preflight

- generated_at: 2026-02-27T17:07:41.702Z
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/wild_oss_preflight_20260227_170741.json
- source_pool: handover/wild_oss_candidate_pool.json
- max_repos: 3
- max_scan: 12
- selected: 4
- pass: 4
- fail: 0
- skip: 0

## Toolchains
- node: true
- npm: true
- pnpm: true
- yarn: false
- python: true
- pip: false
- uv: true

| Repo | Lang | Score | Verdict | Clone | Install | Test Probe |
|---|---|---:|---|---|---|---|
| PrefectHQ/fastmcp | Python | 0.9189 | PASS | PASS 2177ms | PASS 3227ms | PASS 0ms |
| huggingface/lerobot | Python | 0.9092 | PASS | PASS 1168ms | PASS 1136ms | PASS 0ms |
| ag-ui-protocol/ag-ui | Python | 0.9092 | PASS | PASS 2508ms | PASS 0ms | PASS 0ms |
| langfuse/langfuse | TypeScript | 0.9023 | PASS | PASS 2193ms | PASS 3615ms | PASS 0ms |

## Notes
- This preflight is a deterministic feasibility gate before 150+ tick wild longrun.
- FAIL/SKIP entries remain valuable for fallback routing and task scheduling.

