# Handover AI Agent Guide (Git Mirror)

This file mirrors `/home/zephryj/handover/README.md` so it is tracked on GitHub.

## Read This First (Current Scope: TuringOS)

1. Current blocker summary (external workspace handover dir): `../../../handover/turingos_arch_review_handover_20260301_035950.md`
2. Total design: `../README.md`
3. Topology diagram/spec: `../topology.md`
4. Latest architect core design: `./artitecture_response/core_architect_opinion_anti_oreo_v2_20260228.md`
5. Latest architect action plan: `./artitecture_response/dual_llm_joint_action_plan_from_core_opinion_20260228.md`
6. TuringOS handover index: `./README.md`

## Current Main Problems (Snapshot)

- Timeout/interruption can lead to stale baseline report consumption.
- Post-consensus planner loop can continue and trigger route-thrashing traps.
- Worker strategy needs adaptive scaling and diversity, not fixed high fan-out.
- Continuous debug-replay loop is not yet proven stable for unattended long runs.

## Archive Rule

- Non-current or old files must be moved to `archive/`.
- Active decision files should stay at this directory root for fast intake.
