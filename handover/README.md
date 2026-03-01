# TuringOS Handover Index (AI Agent)

This index is for agents joining the current TuringOS cycle.

## Git-Tracked Mirrors

- Workspace root guide mirror: `./AGENTS_WORKSPACE_ROOT_GUIDE.md`
- Home handover guide mirror: `./AGENTS_HOME_HANDOVER_GUIDE.md`

## Priority Reading Order

1. Current blocker and architecture-review summary:
   - `../../../handover/turingos_arch_review_handover_20260301_035950.md`
2. Total design overview:
   - `../README.md`
3. Topology blueprint:
   - `../topology.md`
4. Latest architect core design:
   - `./artitecture_response/core_architect_opinion_anti_oreo_v2_20260228.md`
5. Latest architect action plan:
   - `./artitecture_response/dual_llm_joint_action_plan_from_core_opinion_20260228.md`
6. Final success criterion toward 1M steps:
   - `./artitecture_response/final_success_criterion_maker_1m_steps_20260228.md`
7. Baseline comparison evidence:
   - `./audits/modelcompare/main_steps_baseline_20260228.md`

## Current Main Problems

- Baseline accounting can read stale `latest` report after timeout/interruption.
- Planner can enter post-consensus thrashing before deterministic halt completion.
- Worker fan-out is large but model diversity is low, limiting effective gain.
- Continuous recovery loops need stronger run-scoped resume guarantees.

## Directory Rule

- `artitecture_response/`: primary architect-v2 and current-cycle design/audit docs.
- `audits/`: evidence data and benchmark outputs.
- `archive/`: legacy or non-current materials (including old `artiteture_response/` and `audit/` bundles); do not use as default source.
