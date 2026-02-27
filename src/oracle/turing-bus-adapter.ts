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

function extractThought(rawOutput: string): string | undefined {
  const thoughtMatch = rawOutput.match(/<thought>([\s\S]*?)<\/thought>/i);
  if (!thoughtMatch?.[1]) {
    return undefined;
  }
  const thought = thoughtMatch[1].trim();
  return thought.length > 0 ? thought : undefined;
}

interface TransitionShape {
  q_next: string;
  thought?: unknown;
  a_t?: unknown;
  mind_ops?: unknown;
  world_op?: unknown;
  world_ops?: unknown;
}

interface ParseTransitionOptions {
  coerceMixedVliwDomains?: boolean;
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
  if (qNext && (a_t || hasVliwShape)) {
    return {
      q_next: qNext.trim(),
      a_t,
      mind_ops,
      world_op,
      world_ops,
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

function normalizeSyscallList(raw: unknown, label: string): Syscall[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  const source = Array.isArray(raw) ? raw : [raw];
  const out: Syscall[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const syscall = normalizeSyscallOrThrow(source[i], `${label}[${i}]`);
    out.push(syscall);
  }
  return out;
}

function normalizeTransitionShape(value: TransitionShape, options: ParseTransitionOptions = {}): Transition {
  const hasVliwShape = value.mind_ops !== undefined || value.world_op !== undefined || value.world_ops !== undefined;
  if (hasVliwShape) {
    const { mindOps, worldOps } = (() => {
      const mindRaw = normalizeSyscallList(value.mind_ops, 'mind_ops');
      const worldCandidate = value.world_ops !== undefined ? value.world_ops : value.world_op;
      const worldRaw = normalizeSyscallList(worldCandidate, 'world_op');

      const mindOps: Syscall[] = [];
      const worldOps: Syscall[] = [];
      const coerceMixedDomains = options.coerceMixedVliwDomains === true;
      const route = (syscall: Syscall, origin: 'mind_ops' | 'world_op'): void => {
        if (isMindOpcode(syscall.op)) {
          if (origin === 'world_op' && !coerceMixedDomains) {
            throw new Error(
              `[CPU_FAULT: INVALID_OPCODE] world_op must be world/system opcode (SYS_WRITE|SYS_EXEC|SYS_GOTO|SYS_GIT_LOG|SYS_HALT), got ${syscall.op}`
            );
          }
          mindOps.push(syscall);
          return;
        }
        if (origin === 'mind_ops' && !coerceMixedDomains) {
          throw new Error(
            `[CPU_FAULT: INVALID_OPCODE] mind_ops must be mind scheduling opcode (SYS_PUSH|SYS_POP|SYS_EDIT|SYS_MOVE), got ${syscall.op}`
          );
        }
        if (!isWorldOpcode(syscall.op) && !isSystemControlOpcode(syscall.op)) {
          throw new Error(
            `[CPU_FAULT: INVALID_OPCODE] world_op must be world/system opcode (SYS_WRITE|SYS_EXEC|SYS_GOTO|SYS_GIT_LOG|SYS_HALT), got ${syscall.op}`
          );
        }
        worldOps.push(syscall);
      };

      for (const syscall of mindRaw) {
        route(syscall, 'mind_ops');
      }
      for (const syscall of worldRaw) {
        route(syscall, 'world_op');
      }
      return { mindOps, worldOps };
    })();
    const primary = worldOps[0] ?? mindOps[mindOps.length - 1];
    if (!primary) {
      throw new Error('[CPU_FAULT: INVALID_OPCODE] VLIW frame requires at least one syscall in mind_ops/world_op.');
    }
    const normalized: Transition = {
      q_next: value.q_next,
      a_t: primary,
      mind_ops: mindOps,
      world_op: worldOps[0] ?? null,
    };
    if (worldOps.length > 1) {
      normalized.world_ops = worldOps;
    }
    if (typeof value.thought === 'string' && value.thought.trim().length > 0) {
      normalized.thought = value.thought.trim();
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

function collectBalancedObjectCandidates(rawOutput: string): string[] {
  const out: string[] = [];
  const stack: number[] = [];
  let inString = false;
  let escaping = false;
  for (let i = 0; i < rawOutput.length; i += 1) {
    const ch = rawOutput[i];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === '\\') {
        escaping = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      stack.push(i);
      continue;
    }
    if (ch !== '}') {
      continue;
    }
    const start = stack.pop();
    if (start === undefined) {
      continue;
    }
    if (stack.length === 0) {
      const candidate = rawOutput.slice(start, i + 1).trim();
      if (candidate.length > 0) {
        out.push(candidate);
      }
    }
  }
  return out;
}

export function parseBusTransitionFromText(rawOutput: string): Transition {
  return parseBusTransitionFromTextWithOptions(rawOutput, {});
}

function parseBusTransitionFromTextWithOptions(rawOutput: string, options: ParseTransitionOptions): Transition {
  const extractedThought = extractThought(rawOutput);
  const candidates: string[] = [rawOutput];

  const fencedMatch = rawOutput.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    candidates.push(fencedMatch[1].trim());
  }

  const firstBrace = rawOutput.indexOf('{');
  const lastBrace = rawOutput.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(rawOutput.slice(firstBrace, lastBrace + 1));
  }
  candidates.push(...collectBalancedObjectCandidates(rawOutput));

  const deduped = [...new Set(candidates.map((item) => item.trim()).filter((item) => item.length > 0))];

  let parseError: Error | null = null;
  for (const candidate of deduped) {
    try {
      const parsed = JSON.parse(candidate);
      const transitionShape = asTransitionShape(parsed);
      if (!transitionShape) {
        continue;
      }
      const normalized = normalizeTransitionShape(transitionShape, options);
      if (!normalized.thought && extractedThought) {
        normalized.thought = extractedThought;
      }
      return normalized;
    } catch (error: unknown) {
      parseError = error instanceof Error ? error : new Error(String(error));
    }
  }

  const detail = parseError ? ` Details: ${parseError.message}` : '';
  throw new Error(
    `[CPU_FAULT: INVALID_OPCODE] Invalid ALU output. Expected JSON with either a_t.op or VLIW mind_ops/world_op using ${SYSCALL_OPCODE_PIPE}.${detail} Raw: ${rawOutput}`
  );
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
    transition: parseBusTransitionFromTextWithOptions(extracted.text, {
      // Domain sanitizer is intentionally limited to local Ollama path.
      coerceMixedVliwDomains: provider === 'ollama',
    }),
    text: extracted.text,
    usage: extracted.usage,
  };
}
