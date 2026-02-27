import { Syscall } from './types.js';

export const SYSCALL_OPCODES = [
  'SYS_WRITE',
  'SYS_GOTO',
  'SYS_EXEC',
  'SYS_GIT_LOG',
  'SYS_PUSH',
  'SYS_EDIT',
  'SYS_MOVE',
  'SYS_POP',
  'SYS_HALT',
] as const;

export type SyscallOpcode = (typeof SYSCALL_OPCODES)[number];

export const SYSCALL_OPCODE_PIPE = SYSCALL_OPCODES.join('|');
export const SYSCALL_OPCODE_SLASH = SYSCALL_OPCODES.join('/');

export const SYSCALL_WORLD_OPCODES = ['SYS_WRITE', 'SYS_EXEC', 'SYS_GOTO', 'SYS_GIT_LOG'] as const;
export const SYSCALL_MIND_OPCODES = ['SYS_PUSH', 'SYS_POP', 'SYS_EDIT', 'SYS_MOVE'] as const;
export const SYSCALL_SYSTEM_CONTROL_OPCODES = ['SYS_HALT'] as const;
export type SyscallWorldOpcode = (typeof SYSCALL_WORLD_OPCODES)[number];
export type SyscallMindOpcode = (typeof SYSCALL_MIND_OPCODES)[number];
export type SyscallSystemControlOpcode = (typeof SYSCALL_SYSTEM_CONTROL_OPCODES)[number];

export const SYSCALL_EXACT_FIELD_PROMPT_LINES: readonly string[] = [
  '- SYS_WRITE: {"op":"SYS_WRITE","payload":"...","semantic_cap":"optional"}',
  '- SYS_GOTO: {"op":"SYS_GOTO","pointer":"..."}',
  '- SYS_EXEC: {"op":"SYS_EXEC","cmd":"..."}',
  '- SYS_GIT_LOG: {"op":"SYS_GIT_LOG","query_params":"optional","path":"optional","limit":20,"ref":"optional","grep":"optional","since":"optional"}',
  '- SYS_PUSH: {"op":"SYS_PUSH","task":"..."}',
  '- SYS_EDIT: {"op":"SYS_EDIT","task":"..."}',
  '- SYS_MOVE: {"op":"SYS_MOVE","task_id":"optional","target_pos":"TOP|BOTTOM","status":"ACTIVE|SUSPENDED|BLOCKED"}',
  '- SYS_POP: {"op":"SYS_POP"}',
  '- SYS_HALT: {"op":"SYS_HALT"}',
];

export type SyscallNormalizationResult =
  | { ok: true; syscall: Syscall }
  | { ok: false; reason: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeOpcode(raw: string): SyscallOpcode | null {
  const normalized = raw.trim().toUpperCase();
  const mapped = normalized === 'SYS_GITLOG'
    ? 'SYS_GIT_LOG'
    : normalized === 'SYS_STACK_EDIT'
      ? 'SYS_EDIT'
      : normalized === 'SYS_STACK_MOVE'
        ? 'SYS_MOVE'
        : normalized;
  return isSyscallOpcode(mapped) ? mapped : null;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTask(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (!value || typeof value !== 'object') {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function listDisallowedKeys(keys: string[], allowed: readonly string[]): string[] {
  return keys.filter((key) => !allowed.includes(key));
}

export function isSyscallOpcode(value: string): value is SyscallOpcode {
  return (SYSCALL_OPCODES as readonly string[]).includes(value);
}

export function isWorldOpcode(value: string): value is SyscallWorldOpcode {
  return (SYSCALL_WORLD_OPCODES as readonly string[]).includes(value);
}

export function isMindOpcode(value: string): value is SyscallMindOpcode {
  return (SYSCALL_MIND_OPCODES as readonly string[]).includes(value);
}

export function isSystemControlOpcode(value: string): value is SyscallSystemControlOpcode {
  return (SYSCALL_SYSTEM_CONTROL_OPCODES as readonly string[]).includes(value);
}

export function normalizeModelSyscall(value: unknown): SyscallNormalizationResult {
  const raw = asRecord(value);
  if (!raw) {
    return { ok: false, reason: 'a_t must be an object.' };
  }

  const opcodeRaw =
    (typeof raw.op === 'string' && raw.op) ||
    (typeof raw.sys === 'string' && raw.sys) ||
    (typeof raw.syscall === 'string' && raw.syscall) ||
    '';
  if (opcodeRaw.trim().length === 0) {
    return { ok: false, reason: 'Missing syscall op field.' };
  }

  const opcode = normalizeOpcode(opcodeRaw);
  if (!opcode) {
    return { ok: false, reason: `Unknown syscall op: ${opcodeRaw.trim()}` };
  }

  const keys = Object.keys(raw);
  const rejectExtra = (allowed: readonly string[]): string | null => {
    const disallowed = listDisallowedKeys(keys, allowed);
    if (disallowed.length > 0) {
      return `MUTEX_VIOLATION: ${opcode} has unsupported fields: ${disallowed.join(', ')}`;
    }
    return null;
  };

  if (opcode === 'SYS_WRITE') {
    const envelope = rejectExtra([
      'op',
      'sys',
      'syscall',
      'payload',
      'content',
      's_prime',
      'semantic_cap',
      'semanticCap',
      'cap',
      'capability',
    ]);
    if (envelope) {
      return { ok: false, reason: envelope };
    }

    const payload =
      typeof raw.payload === 'string'
        ? raw.payload
        : typeof raw.content === 'string'
          ? raw.content
          : typeof raw.s_prime === 'string'
            ? raw.s_prime
            : null;
    if (payload === null) {
      return { ok: false, reason: 'SYS_WRITE.payload must be a string.' };
    }

    if (raw.semantic_cap !== undefined && typeof raw.semantic_cap !== 'string') {
      return { ok: false, reason: 'SYS_WRITE.semantic_cap must be a string when provided.' };
    }
    if (raw.semanticCap !== undefined && typeof raw.semanticCap !== 'string') {
      return { ok: false, reason: 'SYS_WRITE.semanticCap must be a string when provided.' };
    }
    if (raw.cap !== undefined && typeof raw.cap !== 'string') {
      return { ok: false, reason: 'SYS_WRITE.cap must be a string when provided.' };
    }
    if (raw.capability !== undefined && typeof raw.capability !== 'string') {
      return { ok: false, reason: 'SYS_WRITE.capability must be a string when provided.' };
    }

    const semanticCap =
      normalizeString(raw.semantic_cap) ||
      normalizeString(raw.semanticCap) ||
      normalizeString(raw.cap) ||
      normalizeString(raw.capability);

    if (semanticCap) {
      return { ok: true, syscall: { op: 'SYS_WRITE', payload, semantic_cap: semanticCap } };
    }
    return { ok: true, syscall: { op: 'SYS_WRITE', payload } };
  }

  if (opcode === 'SYS_GOTO') {
    const envelope = rejectExtra(['op', 'sys', 'syscall', 'pointer', 'handle', 'd_next']);
    if (envelope) {
      return { ok: false, reason: envelope };
    }

    const pointer = normalizeString(raw.pointer) || normalizeString(raw.handle) || normalizeString(raw.d_next);
    if (!pointer) {
      return { ok: false, reason: 'SYS_GOTO.pointer must be a non-empty string.' };
    }
    return { ok: true, syscall: { op: 'SYS_GOTO', pointer } };
  }

  if (opcode === 'SYS_EXEC') {
    const envelope = rejectExtra(['op', 'sys', 'syscall', 'cmd', 'command']);
    if (envelope) {
      return { ok: false, reason: envelope };
    }

    const cmd = normalizeString(raw.cmd) || normalizeString(raw.command);
    if (!cmd) {
      return { ok: false, reason: 'SYS_EXEC.cmd must be a non-empty string.' };
    }
    return { ok: true, syscall: { op: 'SYS_EXEC', cmd } };
  }

  if (opcode === 'SYS_GIT_LOG') {
    const envelope = rejectExtra([
      'op',
      'sys',
      'syscall',
      'query_params',
      'query',
      'params',
      'path',
      'limit',
      'ref',
      'grep',
      'since',
    ]);
    if (envelope) {
      return { ok: false, reason: envelope };
    }

    const normalized: Extract<Syscall, { op: 'SYS_GIT_LOG' }> = { op: 'SYS_GIT_LOG' };

    if (raw.query_params !== undefined && typeof raw.query_params !== 'string') {
      return { ok: false, reason: 'SYS_GIT_LOG.query_params must be a string when provided.' };
    }
    if (raw.query !== undefined && typeof raw.query !== 'string') {
      return { ok: false, reason: 'SYS_GIT_LOG.query must be a string when provided.' };
    }
    if (raw.params !== undefined && typeof raw.params !== 'string') {
      return { ok: false, reason: 'SYS_GIT_LOG.params must be a string when provided.' };
    }
    if (raw.path !== undefined && typeof raw.path !== 'string') {
      return { ok: false, reason: 'SYS_GIT_LOG.path must be a string when provided.' };
    }
    if (raw.ref !== undefined && typeof raw.ref !== 'string') {
      return { ok: false, reason: 'SYS_GIT_LOG.ref must be a string when provided.' };
    }
    if (raw.grep !== undefined && typeof raw.grep !== 'string') {
      return { ok: false, reason: 'SYS_GIT_LOG.grep must be a string when provided.' };
    }
    if (raw.since !== undefined && typeof raw.since !== 'string') {
      return { ok: false, reason: 'SYS_GIT_LOG.since must be a string when provided.' };
    }

    const queryParams = normalizeString(raw.query_params) || normalizeString(raw.query) || normalizeString(raw.params);
    if (queryParams) {
      normalized.query_params = queryParams;
    }

    const path = normalizeString(raw.path);
    if (path) {
      normalized.path = path;
    }

    const ref = normalizeString(raw.ref);
    if (ref) {
      normalized.ref = ref;
    }

    const grep = normalizeString(raw.grep);
    if (grep) {
      normalized.grep = grep;
    }

    const since = normalizeString(raw.since);
    if (since) {
      normalized.since = since;
    }

    if (raw.limit !== undefined) {
      const parsed =
        typeof raw.limit === 'number'
          ? raw.limit
          : typeof raw.limit === 'string'
            ? Number.parseInt(raw.limit, 10)
            : Number.NaN;
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { ok: false, reason: 'SYS_GIT_LOG.limit must be a positive integer.' };
      }
      normalized.limit = Math.min(Math.floor(parsed), 200);
    }

    return { ok: true, syscall: normalized };
  }

  if (opcode === 'SYS_PUSH' || opcode === 'SYS_EDIT') {
    const envelope = rejectExtra(['op', 'sys', 'syscall', 'task', 'stack_payload', 'cmd', 'command']);
    if (envelope) {
      return { ok: false, reason: envelope };
    }

    const task =
      normalizeTask(raw.task) ||
      normalizeTask(raw.stack_payload) ||
      normalizeTask(raw.cmd) ||
      normalizeTask(raw.command);
    if (task.length === 0) {
      return { ok: false, reason: `${opcode}.task must be non-empty.` };
    }

    if (opcode === 'SYS_PUSH') {
      return { ok: true, syscall: { op: 'SYS_PUSH', task } };
    }
    return { ok: true, syscall: { op: 'SYS_EDIT', task } };
  }

  if (opcode === 'SYS_MOVE') {
    const envelope = rejectExtra([
      'op',
      'sys',
      'syscall',
      'task_id',
      'task',
      'id',
      'target_pos',
      'target',
      'position',
      'status',
      'state',
    ]);
    if (envelope) {
      return { ok: false, reason: envelope };
    }

    if (raw.task_id !== undefined && typeof raw.task_id !== 'string') {
      return { ok: false, reason: 'SYS_MOVE.task_id must be a string when provided.' };
    }
    if (raw.task !== undefined && typeof raw.task !== 'string') {
      return { ok: false, reason: 'SYS_MOVE.task must be a string when provided.' };
    }
    if (raw.id !== undefined && typeof raw.id !== 'string') {
      return { ok: false, reason: 'SYS_MOVE.id must be a string when provided.' };
    }
    if (raw.target_pos !== undefined && typeof raw.target_pos !== 'string') {
      return { ok: false, reason: 'SYS_MOVE.target_pos must be TOP or BOTTOM.' };
    }
    if (raw.target !== undefined && typeof raw.target !== 'string') {
      return { ok: false, reason: 'SYS_MOVE.target must be TOP or BOTTOM.' };
    }
    if (raw.position !== undefined && typeof raw.position !== 'string') {
      return { ok: false, reason: 'SYS_MOVE.position must be TOP or BOTTOM.' };
    }
    if (raw.status !== undefined && typeof raw.status !== 'string') {
      return { ok: false, reason: 'SYS_MOVE.status must be ACTIVE, SUSPENDED, or BLOCKED.' };
    }
    if (raw.state !== undefined && typeof raw.state !== 'string') {
      return { ok: false, reason: 'SYS_MOVE.state must be ACTIVE, SUSPENDED, or BLOCKED.' };
    }

    const taskId = normalizeString(raw.task_id) || normalizeString(raw.task) || normalizeString(raw.id);
    const targetPosRaw = normalizeString(raw.target_pos) || normalizeString(raw.target) || normalizeString(raw.position);
    const statusRaw = normalizeString(raw.status) || normalizeString(raw.state);

    const normalized: Extract<Syscall, { op: 'SYS_MOVE' }> = { op: 'SYS_MOVE' };
    if (taskId) {
      normalized.task_id = taskId;
    }
    if (targetPosRaw) {
      const targetPos = targetPosRaw.toUpperCase();
      if (targetPos !== 'TOP' && targetPos !== 'BOTTOM') {
        return { ok: false, reason: `SYS_MOVE.target_pos invalid: ${targetPosRaw}` };
      }
      normalized.target_pos = targetPos;
    }
    if (statusRaw) {
      const status = statusRaw.toUpperCase();
      if (status !== 'ACTIVE' && status !== 'SUSPENDED' && status !== 'BLOCKED') {
        return { ok: false, reason: `SYS_MOVE.status invalid: ${statusRaw}` };
      }
      normalized.status = status;
    }
    return { ok: true, syscall: normalized };
  }

  if (opcode === 'SYS_POP' || opcode === 'SYS_HALT') {
    const envelope = rejectExtra(['op', 'sys', 'syscall']);
    if (envelope) {
      return { ok: false, reason: envelope };
    }
    if (opcode === 'SYS_POP') {
      return { ok: true, syscall: { op: 'SYS_POP' } };
    }
    return { ok: true, syscall: { op: 'SYS_HALT' } };
  }

  return { ok: false, reason: `Unknown syscall op: ${opcode}` };
}

export function validateCanonicalSyscallEnvelope(value: unknown): string | null {
  const raw = asRecord(value);
  if (!raw) {
    return 'Syscall payload must be an object.';
  }

  const op = typeof raw.op === 'string' ? raw.op.trim() : '';
  if (!isSyscallOpcode(op)) {
    return op.length > 0 ? `Unknown syscall op: ${op}` : 'Missing syscall op field.';
  }

  const keys = Object.keys(raw);
  const allowOnly = (allowed: readonly string[]): string | null => {
    const disallowed = listDisallowedKeys(keys, allowed);
    if (disallowed.length > 0) {
      return `MUTEX_VIOLATION: ${op} carries extra fields: ${disallowed.join(', ')}`;
    }
    return null;
  };

  if (op === 'SYS_WRITE') {
    const envelope = allowOnly(['op', 'payload', 'semantic_cap']);
    if (envelope) {
      return envelope;
    }
    if (typeof raw.payload !== 'string') {
      return 'SYS_WRITE.payload must be a string.';
    }
    if (raw.semantic_cap !== undefined && typeof raw.semantic_cap !== 'string') {
      return 'SYS_WRITE.semantic_cap must be a string when provided.';
    }
    return null;
  }

  if (op === 'SYS_GOTO') {
    const envelope = allowOnly(['op', 'pointer']);
    if (envelope) {
      return envelope;
    }
    return typeof raw.pointer === 'string' && raw.pointer.trim().length > 0
      ? null
      : 'SYS_GOTO.pointer must be a non-empty string.';
  }

  if (op === 'SYS_EXEC') {
    const envelope = allowOnly(['op', 'cmd']);
    if (envelope) {
      return envelope;
    }
    return typeof raw.cmd === 'string' && raw.cmd.trim().length > 0
      ? null
      : 'SYS_EXEC.cmd must be a non-empty string.';
  }

  if (op === 'SYS_GIT_LOG') {
    const envelope = allowOnly(['op', 'query_params', 'path', 'limit', 'ref', 'grep', 'since']);
    if (envelope) {
      return envelope;
    }
    if (raw.query_params !== undefined && typeof raw.query_params !== 'string') {
      return 'SYS_GIT_LOG.query_params must be a string when provided.';
    }
    if (raw.path !== undefined && typeof raw.path !== 'string') {
      return 'SYS_GIT_LOG.path must be a string when provided.';
    }
    if (raw.ref !== undefined && typeof raw.ref !== 'string') {
      return 'SYS_GIT_LOG.ref must be a string when provided.';
    }
    if (raw.grep !== undefined && typeof raw.grep !== 'string') {
      return 'SYS_GIT_LOG.grep must be a string when provided.';
    }
    if (raw.since !== undefined && typeof raw.since !== 'string') {
      return 'SYS_GIT_LOG.since must be a string when provided.';
    }
    if (raw.limit !== undefined) {
      if (typeof raw.limit !== 'number' || !Number.isFinite(raw.limit) || raw.limit <= 0) {
        return 'SYS_GIT_LOG.limit must be a positive number when provided.';
      }
    }
    return null;
  }

  if (op === 'SYS_PUSH' || op === 'SYS_EDIT') {
    const envelope = allowOnly(['op', 'task']);
    if (envelope) {
      return envelope;
    }
    return typeof raw.task === 'string' && raw.task.trim().length > 0
      ? null
      : `${op}.task must be a non-empty string.`;
  }

  if (op === 'SYS_MOVE') {
    const envelope = allowOnly(['op', 'task_id', 'target_pos', 'status']);
    if (envelope) {
      return envelope;
    }
    if (raw.task_id !== undefined && typeof raw.task_id !== 'string') {
      return 'SYS_MOVE.task_id must be a string when provided.';
    }
    if (raw.target_pos !== undefined) {
      if (typeof raw.target_pos !== 'string') {
        return 'SYS_MOVE.target_pos must be TOP or BOTTOM.';
      }
      const normalized = raw.target_pos.trim().toUpperCase();
      if (normalized !== 'TOP' && normalized !== 'BOTTOM') {
        return `SYS_MOVE.target_pos invalid: ${raw.target_pos}`;
      }
    }
    if (raw.status !== undefined) {
      if (typeof raw.status !== 'string') {
        return 'SYS_MOVE.status must be ACTIVE, SUSPENDED, or BLOCKED.';
      }
      const normalized = raw.status.trim().toUpperCase();
      if (normalized !== 'ACTIVE' && normalized !== 'SUSPENDED' && normalized !== 'BLOCKED') {
        return `SYS_MOVE.status invalid: ${raw.status}`;
      }
    }
    return null;
  }

  if (op === 'SYS_POP' || op === 'SYS_HALT') {
    return allowOnly(['op']);
  }

  return `Unknown syscall op: ${op}`;
}
