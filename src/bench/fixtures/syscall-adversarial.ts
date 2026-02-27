import { SyscallOpcode } from '../../kernel/syscall-schema.js';

export interface SyscallFixtureCase {
  id: string;
  input: unknown;
  expect: 'accept' | 'reject';
  expectMutex?: boolean;
}

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const canonicalByOp: Record<SyscallOpcode, Record<string, unknown>> = {
  SYS_WRITE: { op: 'SYS_WRITE', payload: 'hello world' },
  SYS_GOTO: { op: 'SYS_GOTO', pointer: 'MAIN_TAPE.md' },
  SYS_EXEC: { op: 'SYS_EXEC', cmd: 'ls -la' },
  SYS_GIT_LOG: { op: 'SYS_GIT_LOG', limit: 20, path: 'src/kernel/engine.ts' },
  SYS_PUSH: { op: 'SYS_PUSH', task: 'diagnose trap' },
  SYS_EDIT: { op: 'SYS_EDIT', task: 'diagnose trap with new evidence' },
  SYS_MOVE: { op: 'SYS_MOVE', task_id: 'task_abcd', target_pos: 'BOTTOM', status: 'SUSPENDED' },
  SYS_POP: { op: 'SYS_POP' },
  SYS_HALT: { op: 'SYS_HALT' },
};

export function buildSyscallAdversarialFixtures(): {
  valid: SyscallFixtureCase[];
  invalid: SyscallFixtureCase[];
} {
  const valid: SyscallFixtureCase[] = [
    ...Object.entries(canonicalByOp).map(([op, input]) => ({
      id: `valid_canonical_${op.toLowerCase()}`,
      input: deepCopy(input),
      expect: 'accept' as const,
    })),
    {
      id: 'valid_alias_write_content',
      input: { op: 'SYS_WRITE', content: 'payload-from-content' },
      expect: 'accept',
    },
    {
      id: 'valid_alias_exec_command',
      input: { op: 'SYS_EXEC', command: 'npm test' },
      expect: 'accept',
    },
    {
      id: 'valid_alias_goto_dnext',
      input: { sys: 'SYS_GOTO', d_next: 'docs/turingos-architecture.md' },
      expect: 'accept',
    },
    {
      id: 'valid_alias_gitlog_query',
      input: { syscall: 'SYS_GITLOG', query: '--all', limit: '5' },
      expect: 'accept',
    },
    {
      id: 'valid_alias_push_stack_payload',
      input: { op: 'SYS_PUSH', stack_payload: 'recover missing artifact' },
      expect: 'accept',
    },
    {
      id: 'valid_alias_edit_stack_payload',
      input: { op: 'SYS_STACK_EDIT', stack_payload: 'rewrite current task' },
      expect: 'accept',
    },
    {
      id: 'valid_alias_move_target_state',
      input: { op: 'SYS_STACK_MOVE', id: 'task_xy', target: 'top', state: 'active' },
      expect: 'accept',
    },
    {
      id: 'valid_push_object_task_payload',
      input: { op: 'SYS_PUSH', task: { objective: 'json payload accepted then stringified' } },
      expect: 'accept',
    },
  ];

  const invalid: SyscallFixtureCase[] = [
    { id: 'invalid_root_null', input: null, expect: 'reject' },
    { id: 'invalid_root_array', input: [{ op: 'SYS_HALT' }], expect: 'reject' },
    { id: 'invalid_root_number', input: 42, expect: 'reject' },
    { id: 'invalid_root_string', input: '{"op":"SYS_HALT"}', expect: 'reject' },
    { id: 'invalid_missing_opcode', input: { payload: 'x' }, expect: 'reject' },
    { id: 'invalid_unknown_opcode', input: { op: 'SYS_REWIND' }, expect: 'reject' },
    { id: 'invalid_blank_opcode', input: { op: '   ' }, expect: 'reject' },
    { id: 'invalid_opcode_type', input: { op: 1 }, expect: 'reject' },
  ];

  for (const [op, base] of Object.entries(canonicalByOp) as Array<[SyscallOpcode, Record<string, unknown>]>) {
    invalid.push({
      id: `invalid_mutex_extra_${op.toLowerCase()}`,
      input: { ...deepCopy(base), unexpected: true },
      expect: 'reject',
      expectMutex: true,
    });
  }

  const crossFieldByOp: Record<SyscallOpcode, Record<string, unknown>> = {
    SYS_WRITE: { pointer: 'bad-cross-field' },
    SYS_GOTO: { cmd: 'echo leaked' },
    SYS_EXEC: { payload: 'bad-cross-field' },
    SYS_GIT_LOG: { task: 'not-allowed' },
    SYS_PUSH: { pointer: 'not-allowed' },
    SYS_EDIT: { semantic_cap: 'vfd://rw/bad' },
    SYS_MOVE: { payload: 'not-allowed' },
    SYS_POP: { task: 'not-allowed' },
    SYS_HALT: { pointer: 'not-allowed' },
  };

  for (const [op, base] of Object.entries(canonicalByOp) as Array<[SyscallOpcode, Record<string, unknown>]>) {
    invalid.push({
      id: `invalid_cross_field_${op.toLowerCase()}`,
      input: { ...deepCopy(base), ...crossFieldByOp[op] },
      expect: 'reject',
      expectMutex: true,
    });
  }

  const requiredFieldByOp: Partial<Record<SyscallOpcode, string>> = {
    SYS_WRITE: 'payload',
    SYS_GOTO: 'pointer',
    SYS_EXEC: 'cmd',
    SYS_PUSH: 'task',
    SYS_EDIT: 'task',
  };

  const wrongTypeByField: Record<string, unknown> = {
    payload: 123,
    pointer: { nested: true },
    cmd: false,
    task: 9,
  };

  for (const [op, field] of Object.entries(requiredFieldByOp) as Array<[SyscallOpcode, string]>) {
    const missing = deepCopy(canonicalByOp[op]);
    delete missing[field];
    invalid.push({
      id: `invalid_missing_required_${op.toLowerCase()}_${field}`,
      input: missing,
      expect: 'reject',
    });

    invalid.push({
      id: `invalid_required_wrong_type_${op.toLowerCase()}_${field}`,
      input: { ...deepCopy(canonicalByOp[op]), [field]: wrongTypeByField[field] },
      expect: 'reject',
    });

    if (field !== 'payload') {
      invalid.push({
        id: `invalid_required_empty_${op.toLowerCase()}_${field}`,
        input: { ...deepCopy(canonicalByOp[op]), [field]: '   ' },
        expect: 'reject',
      });
    }
  }

  invalid.push(
    { id: 'invalid_move_target_pos_bad_enum', input: { op: 'SYS_MOVE', target_pos: 'LEFT' }, expect: 'reject' },
    { id: 'invalid_move_target_pos_type', input: { op: 'SYS_MOVE', target_pos: 1 }, expect: 'reject' },
    { id: 'invalid_move_status_bad_enum', input: { op: 'SYS_MOVE', status: 'PAUSED' }, expect: 'reject' },
    { id: 'invalid_move_status_type', input: { op: 'SYS_MOVE', status: 0 }, expect: 'reject' },
    { id: 'invalid_move_task_id_type', input: { op: 'SYS_MOVE', task_id: 99 }, expect: 'reject' },
    {
      id: 'invalid_move_mutex_extra',
      input: { op: 'SYS_MOVE', target_pos: 'TOP', state_reason: 'extra' },
      expect: 'reject',
      expectMutex: true,
    }
  );

  invalid.push(
    { id: 'invalid_gitlog_limit_zero', input: { op: 'SYS_GIT_LOG', limit: 0 }, expect: 'reject' },
    { id: 'invalid_gitlog_limit_negative', input: { op: 'SYS_GIT_LOG', limit: -3 }, expect: 'reject' },
    { id: 'invalid_gitlog_limit_bad_string', input: { op: 'SYS_GIT_LOG', limit: 'abc' }, expect: 'reject' },
    { id: 'invalid_gitlog_limit_bad_type', input: { op: 'SYS_GIT_LOG', limit: [] }, expect: 'reject' },
    { id: 'invalid_gitlog_query_bad_type', input: { op: 'SYS_GIT_LOG', query_params: 2 }, expect: 'reject' },
    { id: 'invalid_gitlog_path_bad_type', input: { op: 'SYS_GIT_LOG', path: 2 }, expect: 'reject' },
    { id: 'invalid_gitlog_ref_bad_type', input: { op: 'SYS_GIT_LOG', ref: 2 }, expect: 'reject' },
    { id: 'invalid_gitlog_grep_bad_type', input: { op: 'SYS_GIT_LOG', grep: 2 }, expect: 'reject' },
    { id: 'invalid_gitlog_since_bad_type', input: { op: 'SYS_GIT_LOG', since: 2 }, expect: 'reject' }
  );

  invalid.push(
    {
      id: 'invalid_write_semantic_cap_bad_type',
      input: { op: 'SYS_WRITE', payload: 'x', semantic_cap: { bad: 'type' } },
      expect: 'reject',
    },
    {
      id: 'invalid_write_cap_alias_bad_type',
      input: { op: 'SYS_WRITE', payload: 'x', cap: 1 },
      expect: 'reject',
    },
    {
      id: 'invalid_write_with_alias_payload_and_extra',
      input: { op: 'SYS_WRITE', content: 'x', pointer: 'bad' },
      expect: 'reject',
      expectMutex: true,
    },
    {
      id: 'invalid_exec_with_alias_and_extra',
      input: { op: 'SYS_EXEC', command: 'ls', payload: 'bad' },
      expect: 'reject',
      expectMutex: true,
    }
  );

  return { valid, invalid };
}
