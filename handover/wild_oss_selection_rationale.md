# Wild OSS Selection Rationale

## Scoring Policy
- reproducibility: 30%
- ci_verifiability: 25%
- system_entropy: 20%
- activity_health: 15%
- toolchain_friction: 10%

## Hard Gates
- pushed within 30 days
- archived=false
- fork=false
- stars in range 1000..25000
- size_kb <= 350000
- max 3 repos per language in shortlist
- max detail checks per run: 48
- at least one CI workflow
- at least one open bug issue with reproducibility score >= 0.45

## Output
- candidate_pool: handover/wild_oss_candidate_pool.json
- shortlist: handover/wild_oss_shortlist.md

## Next
- Run preflight clone/install/test on top 3 before dispatching 150+ tick longrun.
