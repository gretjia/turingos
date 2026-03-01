# Wild OSS Top3 Preflight

- generated_at: 2026-02-27T16:41:28.797Z
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/longrun/wild_oss_preflight_20260227_164128.json
- source_pool: handover/wild_oss_candidate_pool.json
- selected: 3
- pass: 1
- fail: 2
- skip: 0

## Toolchains
- node: true
- npm: true
- python: true
- pip: false

| Repo | Lang | Score | Verdict | Clone | Install | Test Probe |
|---|---|---:|---|---|---|---|
| nocobase/nocobase | TypeScript | 0.9366 | FAIL | PASS 6657ms | FAIL 58469ms | FAIL 233ms |
| huggingface/lerobot | Python | 0.9092 | FAIL | PASS 775ms | FAIL 29ms | FAIL 27ms |
| langfuse/langfuse | TypeScript | 0.9023 | PASS | PASS 1545ms | PASS 11495ms | PASS 242ms |

## Notes
- This preflight is a deterministic feasibility gate before 150+ tick wild longrun.
- FAIL/SKIP entries remain valuable for fallback routing and task scheduling.

