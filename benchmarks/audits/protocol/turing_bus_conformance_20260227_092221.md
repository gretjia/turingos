# Turing Bus Conformance

- stamp: 20260227_092221
- pass: false
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/protocol/turing_bus_conformance_20260227_092221.json

## Schema Checks

| Check | Result | Details |
|---|---|---|
| bus_schema.version_present | PASS | version=2.0.0 |
| bus_schema.providers_include_openai_kimi_ollama | PASS | providers=openai,kimi,ollama |
| bus_instruction_classes_match_syscall_schema | PASS | bus_ops=SYS_EDIT|SYS_EXEC|SYS_GIT_LOG|SYS_GOTO|SYS_HALT|SYS_MOVE|SYS_POP|SYS_PUSH|SYS_WRITE syscall_ops=SYS_EDIT|SYS_EXEC|SYS_GIT_LOG|SYS_GOTO|SYS_HALT|SYS_MOVE|SYS_POP|SYS_PUSH|SYS_WRITE |

## Provider Cases

| Case | Provider | Expect | Result | Details |
|---|---|---|---|---|
| openai_valid_legacy | openai | accept | PASS | a_t=SYS_GOTO mind_ops=(none) world_op=SYS_GOTO |
| kimi_valid_vliw | kimi | accept | PASS | a_t=SYS_EXEC mind_ops=SYS_EDIT|SYS_PUSH world_op=SYS_EXEC |
| ollama_valid_mind_only | ollama | accept | PASS | a_t=SYS_MOVE mind_ops=SYS_MOVE world_op=(none) |
| openai_reject_mutex_violation | openai | reject | PASS | [CPU_FAULT: INVALID_OPCODE] Invalid ALU output. Expected JSON with either a_t.op or VLIW mind_ops/world_op using SYS_WRITE|SYS_GOTO|SYS_EXEC|SYS_GIT_LOG|SYS_PUSH|SYS_EDIT|SYS_MOVE| |
| kimi_reject_invalid_mind_opcode | kimi | reject | FAIL | unexpected accept |
| ollama_reject_unknown_world_opcode | ollama | reject | PASS | [CPU_FAULT: INVALID_OPCODE] Invalid ALU output. Expected JSON with either a_t.op or VLIW mind_ops/world_op using SYS_WRITE|SYS_GOTO|SYS_EXEC|SYS_GIT_LOG|SYS_PUSH|SYS_EDIT|SYS_MOVE| |

- accept_pass: 3/3
- reject_pass: 2/3

