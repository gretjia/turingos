# Wild OSS Top3 Preflight

- generated_at: 2026-02-27T16:58:58.967Z
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/wild_oss_preflight_20260227_165858.json
- source_pool: handover/wild_oss_candidate_pool.json
- max_repos: 3
- max_scan: 12
- selected: 3
- pass: 2
- fail: 1
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
| langfuse/langfuse | TypeScript | 0.9023 | PASS | PASS 1594ms | PASS 2011ms | PASS 0ms |
| scalar/scalar | TypeScript | 0.895 | PASS | PASS 2536ms | PASS 2390ms | PASS 0ms |
| monkeytypegame/monkeytype | TypeScript | 0.8872 | FAIL | PASS 10980ms | FAIL 1243ms | PASS 0ms |

## Notes
- This preflight is a deterministic feasibility gate before 150+ tick wild longrun.
- FAIL/SKIP entries remain valuable for fallback routing and task scheduling.

