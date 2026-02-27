# Syscall Schema Gate

- stamp: 20260227_024728
- opcodes: SYS_WRITE, SYS_GOTO, SYS_EXEC, SYS_GIT_LOG, SYS_PUSH, SYS_EDIT, SYS_MOVE, SYS_POP, SYS_HALT
- opcodePipe: SYS_WRITE|SYS_GOTO|SYS_EXEC|SYS_GIT_LOG|SYS_PUSH|SYS_EDIT|SYS_MOVE|SYS_POP|SYS_HALT
- validFixtures: 17
- invalidFixtures: 57
- validAccepted: 17
- invalidRejected: 49
- mutexExpected: 21
- mutexRejected: 21
- pass: false

## Failures
- invalid_move_target_pos_type: expected REJECT but accepted: {"op":"SYS_MOVE"}
- invalid_move_status_type: expected REJECT but accepted: {"op":"SYS_MOVE"}
- invalid_move_task_id_type: expected REJECT but accepted: {"op":"SYS_MOVE"}
- invalid_gitlog_query_bad_type: expected REJECT but accepted: {"op":"SYS_GIT_LOG"}
- invalid_gitlog_path_bad_type: expected REJECT but accepted: {"op":"SYS_GIT_LOG"}
- invalid_gitlog_ref_bad_type: expected REJECT but accepted: {"op":"SYS_GIT_LOG"}
- invalid_gitlog_grep_bad_type: expected REJECT but accepted: {"op":"SYS_GIT_LOG"}
- invalid_gitlog_since_bad_type: expected REJECT but accepted: {"op":"SYS_GIT_LOG"}
