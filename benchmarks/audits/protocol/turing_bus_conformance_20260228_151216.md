# Turing Bus Conformance

- stamp: 20260228_151216
- pass: true
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/protocol/turing_bus_conformance_20260228_151216.json

## Schema Checks

| Check | Result | Details |
|---|---|---|
| bus_schema.version_present | PASS | version=2.0.0 |
| bus_schema.providers_include_openai_kimi_ollama | PASS | providers=openai,kimi,ollama |
| bus_instruction_classes_match_syscall_schema | PASS | bus_ops=SYS_EDIT|SYS_EXEC|SYS_GIT_LOG|SYS_GOTO|SYS_HALT|SYS_MAP_REDUCE|SYS_MOVE|SYS_POP|SYS_PUSH|SYS_WRITE syscall_ops=SYS_EDIT|SYS_EXEC|SYS_GIT_LOG|SYS_GOTO|SYS_HALT|SYS_MAP_REDUCE|SYS_MOVE|SYS_POP|SYS_PUSH|SYS_WRITE |

## Provider Cases

| Case | Provider | Expect | Result | Details |
|---|---|---|---|---|
| openai_valid_with_think_prefix | openai | accept | PASS | a_t=SYS_GOTO mind_ops=SYS_EDIT world_op=SYS_GOTO |
| openai_valid_vliw_world_only | openai | accept | PASS | a_t=SYS_GOTO mind_ops=(none) world_op=SYS_GOTO |
| kimi_valid_vliw | kimi | accept | PASS | a_t=SYS_EXEC mind_ops=SYS_EDIT|SYS_PUSH world_op=SYS_EXEC |
| ollama_valid_mind_only | ollama | accept | PASS | a_t=SYS_MOVE mind_ops=SYS_MOVE world_op=(none) |
| openai_guardrail_multiple_world_ops | openai | accept | PASS | a_t=SYS_WRITE mind_ops=SYS_EDIT world_op=SYS_WRITE |
| openai_reject_mutex_violation | openai | reject | PASS | [CPU_FAULT: INVALID_OPCODE] Strict single-frame mode requires VLIW fields mind_ops/world_op; legacy a_t-only frame is forbidden. |
| kimi_reject_invalid_opcode | kimi | reject | PASS | [CPU_FAULT: INVALID_OPCODE] mind_ops[0]: Unknown syscall op: SYS_TELEPORT |
| ollama_reject_unknown_world_opcode | ollama | reject | PASS | [CPU_FAULT: INVALID_OPCODE] world_op[0]: Unknown syscall op: SYS_TELEPORT |

- accept_pass: 5/5
- reject_pass: 3/3

