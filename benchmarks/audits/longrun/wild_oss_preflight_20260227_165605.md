# Wild OSS Top3 Preflight

- generated_at: 2026-02-27T16:56:05.756Z
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/wild_oss_preflight_20260227_165605.json
- source_pool: handover/wild_oss_candidate_pool.json
- max_repos: 3
- max_scan: 12
- selected: 3
- pass: 0
- fail: 3
- skip: 0

## Toolchains
- node: true
- npm: true
- pnpm: true
- yarn: false
- python: true
- pip: false

| Repo | Lang | Score | Verdict | Clone | Install | Test Probe |
|---|---|---:|---|---|---|---|
| langfuse/langfuse | TypeScript | 0.9023 | FAIL | PASS 1668ms | PASS 2094ms | FAIL 1558ms |
| scalar/scalar | TypeScript | 0.895 | FAIL | PASS 2534ms | PASS 2356ms | FAIL 1406ms |
| monkeytypegame/monkeytype | TypeScript | 0.8872 | FAIL | PASS 12590ms | FAIL 2801ms | FAIL 1315ms |

## Notes
- This preflight is a deterministic feasibility gate before 150+ tick wild longrun.
- FAIL/SKIP entries remain valuable for fallback routing and task scheduling.

