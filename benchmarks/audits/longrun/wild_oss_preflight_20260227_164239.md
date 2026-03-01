# Wild OSS Top3 Preflight

- generated_at: 2026-02-27T16:42:39.507Z
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/wild_oss_preflight_20260227_164239.json
- source_pool: handover/wild_oss_candidate_pool.json
- selected: 3
- pass: 0
- fail: 0
- skip: 3

## Toolchains
- node: true
- npm: true
- python: true
- pip: false

| Repo | Lang | Score | Verdict | Clone | Install | Test Probe |
|---|---|---:|---|---|---|---|
| nocobase/nocobase | TypeScript | 0.9366 | SKIP | PASS 7022ms | SKIP | SKIP |
| langfuse/langfuse | TypeScript | 0.9023 | SKIP | PASS 1715ms | SKIP | SKIP |
| scalar/scalar | TypeScript | 0.895 | SKIP | PASS 2685ms | SKIP | SKIP |

## Notes
- This preflight is a deterministic feasibility gate before 150+ tick wild longrun.
- FAIL/SKIP entries remain valuable for fallback routing and task scheduling.

