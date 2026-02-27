import { normalizeModelSyscall, SYSCALL_OPCODE_PIPE } from '../kernel/syscall-schema.js';
import { Transition } from '../kernel/types.js';

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

function isTransitionShape(value: unknown): value is { q_next: string; a_t: unknown; thought?: unknown } {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.q_next === 'string' && !!record.a_t && typeof record.a_t === 'object';
}

function normalizeTransitionShape(value: { q_next: string; a_t: unknown; thought?: unknown }): Transition {
  const parsedSyscall = normalizeModelSyscall(value.a_t);
  if (!parsedSyscall.ok) {
    throw new Error(`[CPU_FAULT: INVALID_OPCODE] ${parsedSyscall.reason}`);
  }

  const normalized: Transition = {
    q_next: value.q_next,
    a_t: parsedSyscall.syscall,
  };
  if (typeof value.thought === 'string' && value.thought.trim().length > 0) {
    normalized.thought = value.thought.trim();
  }
  return normalized;
}

export function parseBusTransitionFromText(rawOutput: string): Transition {
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

  let parseError: Error | null = null;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!isTransitionShape(parsed)) {
        continue;
      }
      const normalized = normalizeTransitionShape(parsed);
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
    `[CPU_FAULT: INVALID_OPCODE] Invalid ALU output. Expected JSON with a_t.op in ${SYSCALL_OPCODE_PIPE}.${detail} Raw: ${rawOutput}`
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
    transition: parseBusTransitionFromText(extracted.text),
    text: extracted.text,
    usage: extracted.usage,
  };
}
