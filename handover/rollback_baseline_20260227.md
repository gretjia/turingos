# Rollback Baseline (2026-02-27)

- baseline_branch: main
- baseline_commit_short: 90aeac7
- baseline_commit_full: 90aeac7979f92abf5d6b8c3fba8869d257b9a4fb
- policy: if post-change staged metrics show no improvement vs baseline (precheck pass + realworld ticks/evidence), drop experiment branch and reset working context back to baseline commit on main.

## Baseline Metrics Snapshot (Mac / qwen2.5:7b)
- precheck: PASS (validRate=0.7917)
- realworld 40 ticks request: observed=33, pass=false
- realworld 120 ticks request: observed=19, pass=false
- missing evidence: vliw_combo=false, chaos_paged_flood=false
