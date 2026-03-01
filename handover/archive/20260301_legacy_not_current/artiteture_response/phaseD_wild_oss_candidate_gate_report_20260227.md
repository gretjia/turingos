# Phase D Report: Wild OSS Candidate Gate (2026-02-27)

## Scope
- Objective: Build an auditor-grade Wild OSS candidate pool for Stage-3 real-world zero-shot penetration.
- Baseline: `handover/artiteture_response/chief_architect_independent_audit_reply_20260227.md`.

## Code Changes
- Added/updated [`src/bench/wild-oss-candidate-scan.ts`](/home/zephryj/projects/turingos/src/bench/wild-oss-candidate-scan.ts):
  - GitHub scan now prefers `gh api` with retry + hard timeout (20s) to avoid hanging calls.
  - Added mid-size hard gates: `stars=1000..25000`, `size_kb<=350000`, `recency<=30d`.
  - Added language diversity control: `max_per_language=3`.
  - Added bounded run budget: `max_repo_checks=48` plus progress logs.
  - Added robust shortlist scoring dimensions and hard reject reasons.
- Updated [`package.json`](/home/zephryj/projects/turingos/package.json):
  - `bench:wild-oss-candidates` script entry (already active in this phase execution).

## Execution
```bash
npm run -s typecheck
npm run -s bench:wild-oss-candidates
```

## Results
- Scan summary: `fetchedRepos=239`, `scoredRepos=26`, `shortlisted=10`.
- Language distribution in shortlist: `Rust=3`, `TypeScript=3`, `Python=3`, `Go=1`.
- Top 3 by weighted score:
  1. `zeroclaw-labs/zeroclaw` (Rust) — 0.95
  2. `keploy/keploy` (Go) — 0.95
  3. `clockworklabs/SpacetimeDB` (Rust) — 0.9393

## Evidence
- Candidate pool (latest): [`benchmarks/audits/longrun/wild_oss_candidate_pool_latest.json`](/home/zephryj/projects/turingos/benchmarks/audits/longrun/wild_oss_candidate_pool_latest.json)
- Shortlist (latest): [`benchmarks/audits/longrun/wild_oss_shortlist_latest.md`](/home/zephryj/projects/turingos/benchmarks/audits/longrun/wild_oss_shortlist_latest.md)
- Handover pool: [`handover/wild_oss_candidate_pool.json`](/home/zephryj/projects/turingos/handover/wild_oss_candidate_pool.json)
- Handover shortlist: [`handover/wild_oss_shortlist.md`](/home/zephryj/projects/turingos/handover/wild_oss_shortlist.md)
- Rationale: [`handover/wild_oss_selection_rationale.md`](/home/zephryj/projects/turingos/handover/wild_oss_selection_rationale.md)

## Audit Status
- Gemini recursive audit completed:
  - [`handover/artiteture_response/gemini_recursive_audit_phaseD_20260227.md`](/home/zephryj/projects/turingos/handover/artiteture_response/gemini_recursive_audit_phaseD_20260227.md)
  - Verdict: `PASS` (confidence `95/100`)
  - Gate decision: `GO` for next phase (`Top3 preflight clone/install/test + wild longrun`).

## Next
1. Run deterministic preflight on top 3 candidates (clone/install/test with timeout + logs).
2. Select final 1-2 repos for 150+ tick wild longrun.
3. Trigger Gemini recursive audit on preflight report before entering longrun.
