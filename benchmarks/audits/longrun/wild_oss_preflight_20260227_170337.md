# Wild OSS Top3 Preflight

- generated_at: 2026-02-27T17:03:37.277Z
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/wild_oss_preflight_20260227_170337.json
- source_pool: handover/wild_oss_candidate_pool.json
- max_repos: 3
- max_scan: 12
- selected: 9
- pass: 3
- fail: 6
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
| PrefectHQ/fastmcp | Python | 0.9189 | FAIL | PASS 1571ms | FAIL 187ms | PASS 0ms |
| huggingface/lerobot | Python | 0.9092 | FAIL | PASS 888ms | FAIL 103ms | PASS 0ms |
| ag-ui-protocol/ag-ui | Python | 0.9092 | FAIL | PASS 1794ms | PASS 0ms | FAIL 0ms |
| langfuse/langfuse | TypeScript | 0.9023 | PASS | PASS 1687ms | PASS 1889ms | PASS 0ms |
| scalar/scalar | TypeScript | 0.895 | PASS | PASS 2433ms | PASS 2186ms | PASS 0ms |
| PrefectHQ/prefect | Python | 0.89 | FAIL | PASS 3337ms | FAIL 95ms | PASS 0ms |
| monkeytypegame/monkeytype | TypeScript | 0.8872 | FAIL | PASS 10713ms | FAIL 1239ms | PASS 0ms |
| AstrBotDevs/AstrBot | Python | 0.8832 | FAIL | PASS 796ms | FAIL 40ms | PASS 0ms |
| apify/crawlee | TypeScript | 0.8789 | PASS | PASS 5914ms | PASS 63858ms | PASS 0ms |

## Notes
- This preflight is a deterministic feasibility gate before 150+ tick wild longrun.
- FAIL/SKIP entries remain valuable for fallback routing and task scheduling.

