# Turing Bus Conformance

- stamp: 20260227_042916
- pass: true
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/protocol/turing_bus_conformance_20260227_042916.json

## Schema Checks

| Check | Result | Details |
|---|---|---|
| bus_schema.version_present | PASS | version=1.0.0 |
| bus_schema.providers_include_openai_kimi_ollama | PASS | providers=openai,kimi,ollama |
| bus_instruction_classes_match_syscall_schema | PASS | bus_ops=SYS_EDIT|SYS_EXEC|SYS_GIT_LOG|SYS_GOTO|SYS_HALT|SYS_MOVE|SYS_POP|SYS_PUSH|SYS_WRITE syscall_ops=SYS_EDIT|SYS_EXEC|SYS_GIT_LOG|SYS_GOTO|SYS_HALT|SYS_MOVE|SYS_POP|SYS_PUSH|SYS_WRITE |

## Provider Cases

| Case | Provider | Expect | Result | Details |
|---|---|---|---|---|
| openai_valid | openai | accept | PASS | op=SYS_GOTO |
| kimi_valid | kimi | accept | PASS | op=SYS_MOVE |
| ollama_valid | ollama | accept | PASS | op=SYS_WRITE |
| openai_reject_mutex_violation | openai | reject | PASS | [CPU_FAULT: INVALID_OPCODE] Invalid ALU output. Expected JSON with a_t.op in SYS_WRITE|SYS_GOTO|SYS_EXEC|SYS_GIT_LOG|SYS_PUSH|SYS_EDIT|SYS_MOVE|SYS_POP|SYS_HALT. Details: [CPU_FAUL |
| kimi_reject_missing_op | kimi | reject | PASS | [CPU_FAULT: INVALID_OPCODE] Invalid ALU output. Expected JSON with a_t.op in SYS_WRITE|SYS_GOTO|SYS_EXEC|SYS_GIT_LOG|SYS_PUSH|SYS_EDIT|SYS_MOVE|SYS_POP|SYS_HALT. Details: [CPU_FAUL |
| ollama_reject_unknown_opcode | ollama | reject | PASS | [CPU_FAULT: INVALID_OPCODE] Invalid ALU output. Expected JSON with a_t.op in SYS_WRITE|SYS_GOTO|SYS_EXEC|SYS_GIT_LOG|SYS_PUSH|SYS_EDIT|SYS_MOVE|SYS_POP|SYS_HALT. Details: [CPU_FAUL |

- accept_pass: 3/3
- reject_pass: 3/3

