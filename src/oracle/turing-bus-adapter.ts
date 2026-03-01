import {
  isMindOpcode,
  isSystemControlOpcode,
  isWorldOpcode,
  normalizeModelSyscall,
  SYSCALL_OPCODE_PIPE,
} from '../kernel/syscall-schema.js';
import { Syscall, Transition } from '../kernel/types.js';

export type BusProvider = 'openai' | 'kimi' | 'ollama';

export interface ProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

type ProviderTextResult =
  | { ok: true; text: string; usage: ProviderUsage }
  | { ok: false; reason: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readTokenValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return undefined;
}

function extractOpenAIText(record: Record<string, unknown>): string | null {
  const choicesRaw = record.choices;
  if (!Array.isArray(choicesRaw) || choicesRaw.length === 0) {
    return null;
  }
  const firstChoice = asRecord(choicesRaw[0]);
  if (!firstChoice) {
    return null;
  }
  const message = asRecord(firstChoice.message);
  if (!message) {
    return null;
  }
  const contentRaw = message.content;
  if (typeof contentRaw === 'string') {
    return contentRaw;
  }
  if (Array.isArray(contentRaw)) {
    const chunks = contentRaw
      .map((part) => asRecord(part))
      .filter((part): part is Record<string, unknown> => part !== null)
      .map((part) => asString(part.text))
      .filter((text): text is string => typeof text === 'string')
      .map((text) => text.trim())
      .filter((text) => text.length > 0);
    if (chunks.length > 0) {
      return chunks.join('\n');
    }
  }
  return null;
}

function extractKimiText(record: Record<string, unknown>): string | null {
  const contentRaw = record.content;
  if (!Array.isArray(contentRaw)) {
    return null;
  }
  const lines = contentRaw
    .map((block) => asRecord(block))
    .filter((block): block is Record<string, unknown> => block !== null)
    .filter((block) => asString(block.type) === 'text' && typeof block.text === 'string')
    .map((block) => (block.text as string).trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }
  return lines.join('\n');
}

function extractOllamaText(record: Record<string, unknown>): string | null {
  const message = asRecord(record.message);
  if (message && typeof message.content === 'string') {
    return message.content;
  }
  if (typeof record.response === 'string') {
    return record.response;
  }
  return extractOpenAIText(record);
}

function extractUsage(provider: BusProvider, record: Record<string, unknown>): ProviderUsage {
  const usageRaw = asRecord(record.usage) ?? record;
  if (provider === 'openai') {
    return {
      promptTokens: readTokenValue(usageRaw.prompt_tokens),
      completionTokens: readTokenValue(usageRaw.completion_tokens),
      totalTokens: readTokenValue(usageRaw.total_tokens),
    };
  }
  if (provider === 'kimi') {
    return {
      promptTokens: readTokenValue(usageRaw.input_tokens ?? usageRaw.prompt_tokens),
      completionTokens: readTokenValue(usageRaw.output_tokens ?? usageRaw.completion_tokens),
      totalTokens: readTokenValue(usageRaw.total_tokens),
    };
  }
  return {
    promptTokens: readTokenValue(usageRaw.prompt_eval_count ?? usageRaw.prompt_tokens),
    completionTokens: readTokenValue(usageRaw.eval_count ?? usageRaw.completion_tokens),
    totalTokens: readTokenValue(usageRaw.total_tokens),
  };
}

export function extractProviderText(provider: BusProvider, payload: unknown): ProviderTextResult {
  if (typeof payload === 'string') {
    const text = payload.trim();
    return text.length > 0
      ? { ok: true, text, usage: {} }
      : { ok: false, reason: `${provider} payload is empty string.` };
  }

  const record = asRecord(payload);
  if (!record) {
    return { ok: false, reason: `${provider} payload must be string or object.` };
  }

  const text = (() => {
    if (provider === 'openai') {
      return extractOpenAIText(record);
    }
    if (provider === 'kimi') {
      return extractKimiText(record);
    }
    return extractOllamaText(record);
  })();

  if (!text || text.trim().length === 0) {
    return { ok: false, reason: `${provider} response has no text content.` };
  }

  return {
    ok: true,
    text: text.trim(),
    usage: extractUsage(provider, record),
  };
}

function stripLeadingReasoningBlocks(rawOutput: string): { body: string; thought?: string } {
  const thoughts: string[] = [];
  let remainder = rawOutput.trim();
  const blockPattern = /^<\s*(think|thought)\b[^>]*>([\s\S]*?)<\/\s*\1\s*>/i;

  while (true) {
    const match = remainder.match(blockPattern);
    if (!match) {
      break;
    }
    const inner = (match[2] ?? '').trim();
    if (inner.length > 0) {
      thoughts.push(inner);
    }
    remainder = remainder.slice(match[0].length).trimStart();
  }

  if (thoughts.length === 0) {
    return { body: rawOutput.trim() };
  }
  return {
    body: remainder.trim(),
    thought: thoughts.join('\n\n'),
  };
}

interface TransitionShape {
  q_next: string;
  thought?: unknown;
  a_t?: unknown;
  mind_ops?: unknown;
  world_op?: unknown;
  world_ops?: unknown;
}

interface GuardrailAccumulator {
  notes: string[];
}

function isFrameGuardrailEnabled(): boolean {
  const raw = process.env.TURINGOS_FRAME_GUARDRAIL_ENABLED;
  if (!raw || raw.trim().length === 0) {
    return true;
  }
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function isDroppableMalformedEntry(reason: string): boolean {
  return (
    reason.includes('a_t must be an object') ||
    reason.includes('Missing syscall op field.')
  );
}

function mergeThoughts(base: string | undefined, notes: string[]): string | undefined {
  if (notes.length === 0) {
    return base;
  }
  const prefix = `[GUARDRAIL] ${notes.join(' ; ')}`;
  if (!base || base.trim().length === 0) {
    return prefix;
  }
  return `${base.trim()}\n${prefix}`;
}

function readThoughtField(record: Record<string, unknown>): string | undefined {
  const thought =
    asString(record.thought) ??
    asString(record.thought_process) ??
    asString(record.thoughtProcess);
  if (!thought) {
    return undefined;
  }
  const trimmed = thought.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asTransitionShape(
  value: unknown,
  depth = 0
): TransitionShape | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  if (depth > 3) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const qNext =
    asString(record.q_next) ??
    asString(record.qNext) ??
    asString(record.next_state) ??
    asString(record.state_next) ??
    asString(record.nextState);
  const a_t = asRecord(record.a_t) ?? asRecord(record.action) ?? asRecord(record.syscall) ?? undefined;
  const mind_ops = record.mind_ops;
  const world_op = record.world_op;
  const world_ops = record.world_ops;
  const thought = readThoughtField(record);
  const hasVliwShape = mind_ops !== undefined || world_op !== undefined || world_ops !== undefined;
  if (qNext !== undefined && (a_t || hasVliwShape)) {
    return {
      q_next: qNext.trim(),
      a_t,
      mind_ops,
      world_op,
      world_ops,
      thought,
    };
  }

  if (a_t || hasVliwShape) {
    return {
      q_next: '',
      a_t,
      mind_ops,
      world_op,
      world_ops,
      thought,
    };
  }

  // Compatibility path: some providers output a bare syscall object rather than a full transition frame.
  const directSyscall = normalizeModelSyscall(record);
  if (directSyscall.ok) {
    return {
      q_next: '',
      a_t: record,
      thought,
    };
  }

  const nestedKeys = ['result', 'output', 'data', 'frame', 'transition'];
  for (const key of nestedKeys) {
    const nested = asRecord(record[key]);
    if (!nested) {
      continue;
    }
    const resolved = asTransitionShape(nested, depth + 1);
    if (resolved) {
      if (!resolved.thought && thought) {
        resolved.thought = thought;
      }
      return resolved;
    }
  }
  return null;
}

function normalizeSyscallOrThrow(value: unknown, label: string): Syscall {
  const parsed = normalizeModelSyscall(value);
  if (!parsed.ok) {
    throw new Error(`[CPU_FAULT: INVALID_OPCODE] ${label}: ${parsed.reason}`);
  }
  return parsed.syscall;
}

function normalizeMindOps(
  raw: unknown,
  spillWorldOps?: Syscall[],
  guardrail?: GuardrailAccumulator
): Syscall[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  const source = Array.isArray(raw) ? raw : [raw];
  const out: Syscall[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const parsed = normalizeModelSyscall(source[i]);
    if (!parsed.ok) {
      if (guardrail && isDroppableMalformedEntry(parsed.reason)) {
        guardrail.notes.push(`drop mind_ops[${i}] (${parsed.reason})`);
        continue;
      }
      throw new Error(`[CPU_FAULT: INVALID_OPCODE] mind_ops[${i}]: ${parsed.reason}`);
    }
    const syscall = parsed.syscall;
    if (!isMindOpcode(syscall.op)) {
      if ((isWorldOpcode(syscall.op) || isSystemControlOpcode(syscall.op)) && spillWorldOps) {
        spillWorldOps.push(syscall);
        if (guardrail) {
          guardrail.notes.push(`reclassify mind_ops[${i}] -> world_op (${syscall.op})`);
        }
        continue;
      }
      throw new Error(
        `[CPU_FAULT: INVALID_OPCODE] mind_ops[${i}] must be mind scheduling opcode (SYS_PUSH|SYS_POP|SYS_EDIT|SYS_MOVE|SYS_MAP_REDUCE), got ${syscall.op}`
      );
    }
    out.push(syscall);
  }
  return out;
}

function normalizeWorldOps(
  rawWorldOp: unknown,
  rawWorldOps: unknown,
  spillMindOps?: Syscall[],
  guardrail?: GuardrailAccumulator
): Syscall[] {
  const candidate = rawWorldOps !== undefined ? rawWorldOps : rawWorldOp;
  if (candidate === undefined || candidate === null) {
    return [];
  }
  const source = Array.isArray(candidate) ? candidate : [candidate];
  const out: Syscall[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const parsed = normalizeModelSyscall(source[i]);
    if (!parsed.ok) {
      if (guardrail && isDroppableMalformedEntry(parsed.reason)) {
        guardrail.notes.push(`drop world_op[${i}] (${parsed.reason})`);
        continue;
      }
      throw new Error(`[CPU_FAULT: INVALID_OPCODE] world_op[${i}]: ${parsed.reason}`);
    }
    const syscall = parsed.syscall;
    if (!isWorldOpcode(syscall.op) && !isSystemControlOpcode(syscall.op)) {
      if (isMindOpcode(syscall.op) && spillMindOps) {
        spillMindOps.push(syscall);
        if (guardrail) {
          guardrail.notes.push(`reclassify world_op[${i}] -> mind_ops (${syscall.op})`);
        }
        continue;
      }
      throw new Error(
        `[CPU_FAULT: INVALID_OPCODE] world_op[${i}] must be world/system opcode (SYS_WRITE|SYS_EXEC|SYS_GOTO|SYS_GIT_LOG|SYS_HALT), got ${syscall.op}`
      );
    }
    out.push(syscall);
  }
  return out;
}

function normalizeTransitionShape(value: TransitionShape): Transition {
  const hasVliwShape = value.mind_ops !== undefined || value.world_op !== undefined || value.world_ops !== undefined;
  if (hasVliwShape) {
    const guardrailEnabled = isFrameGuardrailEnabled();
    const guardrail: GuardrailAccumulator | undefined = guardrailEnabled ? { notes: [] } : undefined;
    const worldSpill: Syscall[] = [];
    const mindSpill: Syscall[] = [];
    const mindOps = normalizeMindOps(value.mind_ops, worldSpill, guardrail);
    const worldOps = normalizeWorldOps(value.world_op, value.world_ops, mindSpill, guardrail);
    const finalMindOps = [...mindOps, ...mindSpill];
    const finalWorldOps = [...worldSpill, ...worldOps];
    let selectedWorldOp: Syscall | null = finalWorldOps[0] ?? null;
    if (finalWorldOps.length > 1) {
      if (!guardrailEnabled) {
        throw new Error(
          `[CPU_FAULT: INVALID_OPCODE] CAUSALITY_VIOLATION_MULTIPLE_WORLD_OPS:${finalWorldOps.map((op) => op.op).join(',')}`
        );
      }
      const preferredIdx = finalWorldOps.findIndex((op) => op.op !== 'SYS_HALT');
      const keepIdx = preferredIdx >= 0 ? preferredIdx : 0;
      selectedWorldOp = finalWorldOps[keepIdx] ?? finalWorldOps[0];
      const dropped = finalWorldOps.flatMap((op, idx) => (idx === keepIdx ? [] : [String(op.op)]));
      if (dropped.length > 0) {
        guardrail?.notes.push(`collapse world_ops keep=${selectedWorldOp?.op ?? 'none'} drop=${dropped.join('|')}`);
      }
    }
    const primary = selectedWorldOp ?? finalMindOps[finalMindOps.length - 1];
    if (!primary) {
      throw new Error('[CPU_FAULT: INVALID_OPCODE] VLIW frame requires at least one syscall in mind_ops/world_op.');
    }
    const existingThought =
      typeof value.thought === 'string' && value.thought.trim().length > 0 ? value.thought.trim() : undefined;
    const normalized: Transition = {
      q_next: value.q_next,
      a_t: primary,
      mind_ops: finalMindOps,
      world_op: selectedWorldOp,
    };
    const mergedThought = mergeThoughts(existingThought, guardrail?.notes ?? []);
    if (mergedThought) {
      normalized.thought = mergedThought;
    }
    return normalized;
  }

  const parsedSyscall = normalizeModelSyscall(value.a_t);
  if (!parsedSyscall.ok) {
    throw new Error(`[CPU_FAULT: INVALID_OPCODE] ${parsedSyscall.reason}`);
  }

  const normalized: Transition = {
    q_next: value.q_next,
    a_t: parsedSyscall.syscall,
    mind_ops: isMindOpcode(parsedSyscall.syscall.op) ? [parsedSyscall.syscall] : [],
    world_op: isMindOpcode(parsedSyscall.syscall.op) ? null : parsedSyscall.syscall,
  };
  if (typeof value.thought === 'string' && value.thought.trim().length > 0) {
    normalized.thought = value.thought.trim();
  }
  return normalized;
}

function isStrictSingleJsonEnabled(): boolean {
  // Anti-Oreo v2 parser is permanently strict in runtime.
  return true;
}

export function parseBusTransitionFromText(rawOutput: string): Transition {
  const stripped = stripLeadingReasoningBlocks(rawOutput);
  const extractedThought = stripped.thought;
  const trimmed = stripped.body;
  let strictCandidate = trimmed;
  const singleFence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (singleFence?.[1]) {
    strictCandidate = singleFence[1].trim();
  } else if (trimmed.includes('```')) {
    throw new Error(
      `[CPU_FAULT: INVALID_OPCODE] Strict single-frame mode: output must contain exactly one JSON frame and no extra markdown blocks. Raw: ${rawOutput}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(strictCandidate);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[CPU_FAULT: INVALID_OPCODE] Invalid ALU output. Expected JSON with VLIW mind_ops/world_op using ${SYSCALL_OPCODE_PIPE}. Details: ${detail} Raw: ${rawOutput}`
    );
  }

  const transitionShape = asTransitionShape(parsed);
  if (!transitionShape) {
    throw new Error(
      `[CPU_FAULT: INVALID_OPCODE] Strict single-frame mode: JSON does not match Transition schema. Raw: ${rawOutput}`
    );
  }
  const hasVliwShape =
    transitionShape.mind_ops !== undefined ||
    transitionShape.world_op !== undefined ||
    transitionShape.world_ops !== undefined;
  if (!hasVliwShape) {
    throw new Error(
      '[CPU_FAULT: INVALID_OPCODE] Strict single-frame mode requires VLIW fields mind_ops/world_op; legacy a_t-only frame is forbidden.'
    );
  }
  const normalized = normalizeTransitionShape(transitionShape);
  if (!normalized.thought && extractedThought) {
    normalized.thought = extractedThought;
  }
  return normalized;
}

export function parseProviderBusTransition(
  provider: BusProvider,
  payload: unknown
): { transition: Transition; text: string; usage: ProviderUsage } {
  const extracted = extractProviderText(provider, payload);
  if (!extracted.ok) {
    throw new Error(`Invalid ${provider} response: ${extracted.reason}`);
  }
  return {
    transition: parseBusTransitionFromText(extracted.text),
    text: extracted.text,
    usage: extracted.usage,
  };
}
