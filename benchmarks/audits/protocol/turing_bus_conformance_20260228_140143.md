# Turing Bus Conformance

- stamp: 20260228_140143
- pass: false
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/protocol/turing_bus_conformance_20260228_140143.json

## Schema Checks

| Check | Result | Details |
|---|---|---|
| bus_schema.version_present | PASS | version=2.0.0 |
| bus_schema.providers_include_openai_kimi_ollama | PASS | providers=openai,kimi,ollama |
| bus_instruction_classes_match_syscall_schema | FAIL | bus_ops=SYS_EDIT|SYS_EXEC|SYS_GIT_LOG|SYS_GOTO|SYS_HALT|SYS_MOVE|SYS_POP|SYS_PUSH|SYS_WRITE syscall_ops=SYS_EDIT|SYS_EXEC|SYS_GIT_LOG|SYS_GOTO|SYS_HALT|SYS_MAP_REDUCE|SYS_MOVE|SYS_POP|SYS_PUSH|SYS_WRITE |

## Provider Cases

| Case | Provider | Expect | Result | Details |
|---|---|---|---|---|
| openai_valid_with_think_prefix | openai | accept | PASS | a_t=SYS_GOTO mind_ops=SYS_EDIT world_op=SYS_GOTO |
| openai_valid_legacy | openai | accept | FAIL | [CPU_FAULT: INVALID_OPCODE] Strict single-frame mode requires VLIW fields mind_ops/world_op; legacy a_t-only frame is forbidden. |
| kimi_valid_vliw | kimi | accept | PASS | a_t=SYS_EXEC mind_ops=SYS_EDIT|SYS_PUSH world_op=SYS_EXEC |
| ollama_valid_mind_only | ollama | accept | PASS | a_t=SYS_MOVE mind_ops=SYS_MOVE world_op=(none) |
| openai_reject_mutex_violation | openai | reject | PASS | [CPU_FAULT: INVALID_OPCODE] Strict single-frame mode requires VLIW fields mind_ops/world_op; legacy a_t-only frame is forbidden. |
| kimi_reject_invalid_mind_opcode | kimi | reject | FAIL | unexpected accept |
| ollama_reject_unknown_world_opcode | ollama | reject | PASS | [CPU_FAULT: INVALID_OPCODE] world_op[0]: Unknown syscall op: SYS_TELEPORT |

- accept_pass: 3/4
- reject_pass: 2/3

