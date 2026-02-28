# Wild OSS Top3 Preflight

- generated_at: 2026-02-27T17:11:08.340Z
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/wild_oss_preflight_20260227_171108.json
- source_pool: handover/wild_oss_candidate_pool.json
- max_repos: 3
- max_scan: 12
- selected: 3
- pass: 3
- fail: 0
- skip: 0

## Toolchains
- node: true
- go: true
- npm: true
- pnpm: true
- yarn: false
- python: true
- pip: false
- uv: true

| Repo | Lang | Score | Verdict | Clone | Install | Test Probe |
|---|---|---:|---|---|---|---|
| keploy/keploy | Go | 0.95 | PASS | PASS 1066ms | PASS 23732ms | PASS 0ms |
| PrefectHQ/fastmcp | Python | 0.9189 | PASS | PASS 2278ms | PASS 1565ms | PASS 0ms |
| huggingface/lerobot | Python | 0.9092 | PASS | PASS 1174ms | PASS 281ms | PASS 0ms |

## Notes
- This preflight is a deterministic feasibility gate before 150+ tick wild longrun.
- FAIL/SKIP entries remain valuable for fallback routing and task scheduling.

