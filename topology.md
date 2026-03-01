# 🌌 TuringOS System Topology Blueprint (v2.0 Anti-Oreo)

> Meta rule for AI agents: obey the ⚪-⚫-⚪ layered boundaries. Never use one LLM as a judge for another LLM. All final acceptance must come from deterministic white-box verification.

## 1) Topology (⚪ Top White-Box / ⚫ Middle Black-Box / ⚪ Bottom White-Box)

```text
=========================================================================================================================
[ ⚪ TOP WHITE-BOX ] HyperCore Scheduler + Trap + Pricing (deterministic only)
=========================================================================================================================
- Trap & Pricing Verifier:
  - Intercept SYS_HALT, verify with objective tools (test/compile/formal checks)
  - PASS  => price +1, process TERMINATED
  - FAIL  => price -1, feed stderr back, force READY retry
  - Red-Flagging: malformed output / privilege violation reaches threshold => KILLED
- Time-Slicing + PCB Isolation:
  - Isolated PCB per micro-agent (chronos/registers/waitPids/mailbox)
  - Planner/Worker contexts are physically separated
- Map-Reduce Controller:
  - Only Planner can emit SYS_MAP_REDUCE
  - Planner BLOCKED after dispatch, workers are forked and reduced by join

=========================================================================================================================
[ ⚫ MIDDLE BLACK-BOX ] Heterogeneous Dual-Brain (mutation + trial-and-error)
=========================================================================================================================
- Dual-Brain Router (role-based hard routing):
  - Planner (P-Core): high-reasoning model, Temperature=0.7, does decomposition and orchestration
  - Workers (E-Core cluster): fast small/local models, Temperature=0.0, atomic execution only
- Planner sleeps in BLOCKED after map dispatch to avoid worker noise contamination

=========================================================================================================================
[ ⚪ BOTTOM WHITE-BOX ] Turing Bus ABI + Infinite Tape (deterministic reality)
=========================================================================================================================
- Turing Syscall ABI:
  - Strict parser + fail-closed normalization
  - Compile model output to deterministic syscalls only
- Infinite Tape / Physical Manifold:
  - Filesystem, TTY, tests, git logs, and system channels
  - Returns objective stdout/stderr facts only
```

## 2) Machine-Readable Constraints

```yaml
topology_profile: turingos.anti_oreo.v2

layers:
  top_white_box:
    deterministic_only: true
    llm_as_judge_forbidden: true
    scheduler:
      mode: "time_slicing"
      pcb_isolation: true
    traps:
      red_flag_threshold: 3
      halt_trap: true
      thrashing_trap: true
    pricing:
      verifier: "objective_tools_only"
      pass_effect: ["price+1", "TERMINATED"]
      fail_effect: ["price-1", "READY_retry_with_stderr"]

  middle_black_box:
    router: "role_based"
    roles:
      planner:
        temperature: 0.7
        allowed_extra_opcode: ["SYS_MAP_REDUCE"]
      worker:
        temperature: 0.0
    map_reduce:
      planner_state_after_dispatch: "BLOCKED"
      join_required: true

  bottom_white_box:
    syscall_bus:
      parser: "fail_closed"
      deterministic_execution: true
    manifold:
      truth_source: ["stdout", "stderr", "filesystem_state"]

isa:
  world_ops: ["SYS_WRITE", "SYS_EXEC", "SYS_GOTO", "SYS_GIT_LOG", "SYS_HALT"]
  mind_ops: ["SYS_PUSH", "SYS_POP", "SYS_EDIT", "SYS_MOVE", "SYS_MAP_REDUCE"]
  per_tick_constraint: "nQ + 1A"
  map_reduce_role_constraint: "planner_only"
```

## 3) Architecture Manifesto (Short)

- Top white-box does not think; it schedules, filters, and prices.
- Middle black-box mutates proposals under strict isolation and role constraints.
- Bottom white-box is the physical law boundary; it returns only objective facts.
- Long-run reliability comes from repeated white-box filtering, not from trusting any single black-box output.
