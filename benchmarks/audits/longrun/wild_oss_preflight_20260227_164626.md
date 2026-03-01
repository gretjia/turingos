# Wild OSS Top3 Preflight

- generated_at: 2026-02-27T16:46:26.965Z
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/wild_oss_preflight_20260227_164626.json
- source_pool: handover/wild_oss_candidate_pool.json
- max_repos: 3
- max_scan: 12
- selected: 8
- pass: 0
- fail: 0
- skip: 8

## Toolchains
- node: true
- npm: true
- python: true
- pip: false

| Repo | Lang | Score | Verdict | Clone | Install | Test Probe |
|---|---|---:|---|---|---|---|
| langfuse/langfuse | TypeScript | 0.9023 | SKIP | PASS 2393ms | SKIP | SKIP |
| scalar/scalar | TypeScript | 0.895 | SKIP | PASS 4581ms | SKIP | SKIP |
| monkeytypegame/monkeytype | TypeScript | 0.8872 | SKIP | PASS 14637ms | SKIP | SKIP |
| apify/crawlee | TypeScript | 0.8789 | SKIP | PASS 8900ms | SKIP | SKIP |
| vercel/ai | TypeScript | 0.8707 | SKIP | PASS 6395ms | SKIP | SKIP |
| bluesky-social/social-app | TypeScript | 0.8537 | SKIP | PASS 4524ms | SKIP | SKIP |
| fuma-nama/fumadocs | TypeScript | 0.8321 | SKIP | PASS 4785ms | SKIP | SKIP |
| triggerdotdev/trigger.dev | TypeScript | 0.795 | SKIP | PASS 3949ms | SKIP | SKIP |

## Notes
- This preflight is a deterministic feasibility gate before 150+ tick wild longrun.
- FAIL/SKIP entries remain valuable for fallback routing and task scheduling.

