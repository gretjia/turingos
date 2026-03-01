# Wild OSS Top3 Preflight

- generated_at: 2026-02-27T17:06:53.385Z
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/wild_oss_preflight_20260227_170653.json
- source_pool: handover/wild_oss_candidate_pool.json
- max_repos: 3
- max_scan: 12
- selected: 12
- pass: 4
- fail: 8
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
| PrefectHQ/fastmcp | Python | 0.9189 | FAIL | PASS 1545ms | FAIL 98ms | PASS 0ms |
| huggingface/lerobot | Python | 0.9092 | FAIL | PASS 800ms | FAIL 101ms | PASS 0ms |
| ag-ui-protocol/ag-ui | Python | 0.9092 | FAIL | PASS 1841ms | PASS 0ms | FAIL 0ms |
| langfuse/langfuse | TypeScript | 0.9023 | PASS | PASS 1690ms | PASS 1773ms | PASS 0ms |
| scalar/scalar | TypeScript | 0.895 | PASS | PASS 2408ms | PASS 2038ms | PASS 0ms |
| PrefectHQ/prefect | Python | 0.89 | FAIL | PASS 3128ms | FAIL 87ms | PASS 0ms |
| monkeytypegame/monkeytype | TypeScript | 0.8872 | FAIL | PASS 11046ms | FAIL 1772ms | PASS 0ms |
| AstrBotDevs/AstrBot | Python | 0.8832 | FAIL | PASS 928ms | FAIL 43ms | PASS 0ms |
| apify/crawlee | TypeScript | 0.8789 | PASS | PASS 5875ms | PASS 25437ms | PASS 0ms |
| pydantic/pydantic-ai | Python | 0.8745 | FAIL | PASS 6125ms | FAIL 93ms | PASS 0ms |
| Chia-Network/chia-blockchain | Python | 0.8737 | FAIL | PASS 1504ms | FAIL 106ms | PASS 0ms |
| vercel/ai | TypeScript | 0.8707 | PASS | PASS 2916ms | PASS 4275ms | PASS 0ms |

## Notes
- This preflight is a deterministic feasibility gate before 150+ tick wild longrun.
- FAIL/SKIP entries remain valuable for fallback routing and task scheduling.

