# Syscall Schema Consistency Gate

- stamp: 20260228_055239
- schema: /home/zephryj/projects/turingos/schemas/syscall-frame.v5.json
- prompt: /home/zephryj/projects/turingos/turing_prompt.sh
- pass: true
- report_json: /home/zephryj/projects/turingos/benchmarks/audits/protocol/syscall_schema_consistency_20260228_055239.json

| Check | Result | Details |
|---|---|---|
| schema.opcodes == canonical | PASS | schema=SYS_WRITE|SYS_GOTO|SYS_EXEC|SYS_GIT_LOG|SYS_PUSH|SYS_EDIT|SYS_MOVE|SYS_MAP_REDUCE|SYS_POP|SYS_HALT canonical=SYS_WRITE|SYS_GOTO|SYS_EXEC|SYS_GIT_LOG|SYS_PUSH|SYS_EDIT|SYS_MOVE|SYS_MAP_REDUCE|SYS_POP|SYS_HALT |
| schema.exact_field_prompt_lines == canonical | PASS | schema_lines=10 canonical_lines=10 |
| prompt opcode list == canonical | PASS | prompt=SYS_WRITE|SYS_GOTO|SYS_EXEC|SYS_GIT_LOG|SYS_PUSH|SYS_EDIT|SYS_MOVE|SYS_MAP_REDUCE|SYS_POP|SYS_HALT canonical=SYS_WRITE|SYS_GOTO|SYS_EXEC|SYS_GIT_LOG|SYS_PUSH|SYS_EDIT|SYS_MOVE|SYS_MAP_REDUCE|SYS_POP|SYS_HALT |
| prompt includes SYS_MOVE fail-closed rule | PASS | expected explicit SYS_MOVE allowlist line in turing_prompt.sh |
| prompt includes vliw nQ+1A rule | PASS | expected explicit VLIW asymmetry line in turing_prompt.sh |

