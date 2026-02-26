import OpenAI from 'openai';
import fsp from 'node:fs/promises';
import { IOracle, Slice, State, Syscall, Transition } from '../kernel/types.js';

type OracleMode = 'openai' | 'kimi';

interface KimiMessageBlock {
  type?: string;
  text?: string;
}

interface KimiMessageResponse {
  content?: KimiMessageBlock[];
}

interface UniversalOracleConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
  maxOutputTokens?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
}

interface ErrorWithMetadata extends Error {
  status?: number;
  code?: string | number;
}

export class UniversalOracle implements IOracle {
  private openai?: OpenAI;
  private model: string;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly telemetryPath: string | null;
  private telemetrySeq = 0;
  private kimimart?: {
    endpoint: string;
    apiKey: string;
    model: string;
    maxOutputTokens: number;
  };

  constructor(private mode: OracleMode, config: UniversalOracleConfig) {
    this.model = config.model;
    this.maxRetries = config.maxRetries ?? 6;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 2000;
    this.retryMaxDelayMs = config.retryMaxDelayMs ?? 60000;
    const telemetryPath = (process.env.TURINGOS_TOKEN_TELEMETRY_PATH ?? '').trim();
    this.telemetryPath = telemetryPath.length > 0 ? telemetryPath : null;
    if (mode === 'openai') {
      const clientConfig: { apiKey: string; baseURL?: string } = { apiKey: config.apiKey };
      if (config.baseURL) {
        clientConfig.baseURL = config.baseURL;
      }
      this.openai = new OpenAI(clientConfig);
    } else if (mode === 'kimi') {
      const baseURL = config.baseURL ?? 'https://api.kimi.com/coding';
      const normalized = baseURL.replace(/\/+$/, '');
      const endpoint = normalized.endsWith('/v1') ? `${normalized}/messages` : `${normalized}/v1/messages`;

      this.kimimart = {
        endpoint,
        apiKey: config.apiKey,
        model: config.model,
        maxOutputTokens: config.maxOutputTokens ?? 1024,
      };
    }
  }

  public async collapse(discipline: string, q: State, s: Slice): Promise<Transition> {
    const userFrame = [
      '================',
      '[CPU REGISTER q]:',
      q,
      '',
      '================',
      '[DATA BUS s]:',
      s,
    ].join('\n');

    const rawOutput = await this.request(discipline, userFrame);
    return this.parseTransition(rawOutput);
  }

  private async request(systemPrompt: string, userFrame: string): Promise<string> {
    const openAIMessages = [
      { role: 'system' as const, content: systemPrompt.trim() },
      { role: 'user' as const, content: userFrame.trim() },
    ];

    if (this.mode === 'openai' && this.openai) {
      return this.withRetry('openai', async () => {
        const response = await this.openai!.chat.completions.create({
          model: this.model,
          messages: openAIMessages,
          temperature: 0,
          response_format: { type: 'json_object' },
        });
        const output = response.choices[0]?.message?.content ?? '{}';
        await this.recordTelemetry('openai', systemPrompt, userFrame, output, {
          promptTokens: this.readTokenValue(response.usage?.prompt_tokens),
          completionTokens: this.readTokenValue(response.usage?.completion_tokens),
          totalTokens: this.readTokenValue(response.usage?.total_tokens),
        });
        return output;
      });
    }

    if (this.mode === 'kimi' && this.kimimart) {
      return this.withRetry('kimi', async () => {
        const kimiMessages = [{ role: 'user' as const, content: userFrame.trim() }];
        const response = await fetch(this.kimimart!.endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'anthropic-version': '2023-06-01',
            'x-api-key': this.kimimart!.apiKey,
          },
          body: JSON.stringify({
            model: this.kimimart!.model,
            max_tokens: this.kimimart!.maxOutputTokens,
            temperature: 0,
            system: systemPrompt.trim(),
            messages: kimiMessages,
          }),
        });

        const raw = await response.text();
        if (!response.ok) {
          const error = new Error(`Kimi API ${response.status}: ${raw.slice(0, 500)}`) as ErrorWithMetadata;
          error.status = response.status;
          throw error;
        }

        let parsed: KimiMessageResponse;
        let parsedRaw: Record<string, unknown>;
        try {
          parsedRaw = JSON.parse(raw) as Record<string, unknown>;
          parsed = parsedRaw as KimiMessageResponse;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Invalid Kimi response JSON: ${message}. Raw: ${raw.slice(0, 500)}`);
        }

        const text = (parsed.content ?? [])
          .filter((block) => block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text?.trim() ?? '')
          .filter((line) => line.length > 0)
          .join('\n');

        if (text.length === 0) {
          throw new Error(`Empty model output. Raw: ${raw.slice(0, 500)}`);
        }

        const usageRaw =
          parsedRaw.usage && typeof parsedRaw.usage === 'object'
            ? (parsedRaw.usage as Record<string, unknown>)
            : parsedRaw;
        const promptTokens = this.readTokenValue(usageRaw.input_tokens ?? usageRaw.prompt_tokens);
        const completionTokens = this.readTokenValue(usageRaw.output_tokens ?? usageRaw.completion_tokens);
        const totalTokens = this.readTokenValue(usageRaw.total_tokens);
        await this.recordTelemetry('kimi', systemPrompt, userFrame, text, {
          promptTokens,
          completionTokens,
          totalTokens,
        });

        return text;
      });
    }

    throw new Error('Oracle not configured');
  }

  private async withRetry(provider: 'openai' | 'kimi', operation: () => Promise<string>): Promise<string> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await operation();
      } catch (error: unknown) {
        const normalized = this.normalizeError(error);
        const retryable = this.isRetryable(normalized);
        const canRetry = attempt < this.maxRetries;
        if (!retryable || !canRetry) {
          throw normalized;
        }

        const delayMs = this.backoffDelay(attempt);
        const status = normalized.status ?? 'n/a';
        console.warn(
          `[oracle:${provider}] transient error; status=${status}; attempt=${attempt + 1}/${
            this.maxRetries + 1
          }; retry_in_ms=${delayMs}`
        );
        await this.sleep(delayMs);
      }
    }

    throw new Error(`[oracle:${provider}] retry loop exhausted unexpectedly`);
  }

  private normalizeError(error: unknown): ErrorWithMetadata {
    if (error instanceof Error) {
      return error as ErrorWithMetadata;
    }

    return new Error(String(error));
  }

  private isRetryable(error: ErrorWithMetadata): boolean {
    const status = typeof error.status === 'number' ? error.status : undefined;
    if (status && (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500)) {
      return true;
    }

    const code = String(error.code ?? '').toUpperCase();
    if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) {
      return true;
    }

    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('fetch failed') ||
      message.includes('network') ||
      message.includes('connection reset') ||
      message.includes('rate limit') ||
      message.includes('gateway')
    );
  }

  private backoffDelay(attempt: number): number {
    const exponential = this.retryBaseDelayMs * 2 ** attempt;
    const jitter = Math.floor(Math.random() * 300);
    return Math.min(exponential + jitter, this.retryMaxDelayMs);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private readTokenValue(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value;
    }
    return undefined;
  }

  private estimateTokens(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }
    return Math.ceil(text.length / 4);
  }

  private async recordTelemetry(
    provider: OracleMode,
    systemPrompt: string,
    userFrame: string,
    output: string,
    usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  ): Promise<void> {
    if (!this.telemetryPath) {
      return;
    }

    const promptTokensEst = this.estimateTokens(`${systemPrompt}\n${userFrame}`);
    const completionTokensEst = this.estimateTokens(output);
    const totalTokensEst = promptTokensEst + completionTokensEst;

    const row = {
      ts: new Date().toISOString(),
      seq: this.telemetrySeq,
      provider,
      model: this.model,
      prompt_chars: systemPrompt.length + userFrame.length,
      completion_chars: output.length,
      prompt_tokens_est: promptTokensEst,
      completion_tokens_est: completionTokensEst,
      total_tokens_est: totalTokensEst,
      prompt_tokens: usage.promptTokens ?? null,
      completion_tokens: usage.completionTokens ?? null,
      total_tokens: usage.totalTokens ?? null,
    };
    this.telemetrySeq += 1;

    try {
      await fsp.appendFile(this.telemetryPath, `${JSON.stringify(row)}\n`, 'utf-8');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[oracle:telemetry] append failed path=${this.telemetryPath}: ${message}`);
    }
  }

  private parseTransition(rawOutput: string): Transition {
    const extractedThought = this.extractThought(rawOutput);
    const candidates: string[] = [rawOutput];

    // Some models wrap JSON in markdown fences, so we try fenced body too.
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
        const normalized = this.tryNormalizeTransition(parsed);
        if (!normalized) {
          continue;
        }
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
      `[CPU_FAULT: INVALID_OPCODE] Invalid ALU output. Expected JSON with a_t.op in SYS_WRITE|SYS_GOTO|SYS_EXEC|SYS_GIT_LOG|SYS_PUSH|SYS_EDIT|SYS_MOVE|SYS_POP|SYS_HALT.${detail} Raw: ${rawOutput}`
    );
  }

  private isTransition(value: unknown): value is { q_next: string; a_t: unknown; thought?: unknown } {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const asRecord = value as Record<string, unknown>;
    if (typeof asRecord.q_next !== 'string') return false;
    return !!asRecord.a_t && typeof asRecord.a_t === 'object';
  }

  private extractThought(rawOutput: string): string | undefined {
    const thoughtMatch = rawOutput.match(/<thought>([\s\S]*?)<\/thought>/i);
    if (!thoughtMatch?.[1]) {
      return undefined;
    }

    const thought = thoughtMatch[1].trim();
    return thought.length > 0 ? thought : undefined;
  }

  private normalizeTransition(value: { q_next: string; a_t: unknown; thought?: unknown }): Transition {
    const syscall = this.normalizeSyscall(value.a_t);
    if (!syscall) {
      throw new Error(
        '[CPU_FAULT: INVALID_OPCODE] Missing or invalid a_t.op. Expected SYS_WRITE|SYS_GOTO|SYS_EXEC|SYS_GIT_LOG|SYS_PUSH|SYS_EDIT|SYS_MOVE|SYS_POP|SYS_HALT.'
      );
    }

    const normalized: Transition = {
      q_next: value.q_next,
      a_t: syscall,
    };

    if (typeof value.thought === 'string' && value.thought.trim().length > 0) {
      normalized.thought = value.thought.trim();
    }

    return normalized;
  }

  private tryNormalizeTransition(value: unknown): Transition | null {
    if (this.isTransition(value)) {
      return this.normalizeTransition(value);
    }
    return null;
  }

  private normalizeSyscall(value: unknown): Syscall | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const syscall = value as Record<string, unknown>;
    const opcodeRaw =
      (typeof syscall.op === 'string' && syscall.op) ||
      (typeof syscall.sys === 'string' && syscall.sys) ||
      (typeof syscall.syscall === 'string' && syscall.syscall) ||
      '';
    const opcodeNormalized = opcodeRaw.trim().toUpperCase();
    const opcode = opcodeNormalized === 'SYS_GITLOG'
      ? 'SYS_GIT_LOG'
      : opcodeNormalized === 'SYS_STACK_EDIT'
        ? 'SYS_EDIT'
        : opcodeNormalized === 'SYS_STACK_MOVE'
          ? 'SYS_MOVE'
        : opcodeNormalized;
    const keys = Object.keys(syscall);
    const rejectMutex = (message: string): never => {
      throw new Error(`[CPU_FAULT: INVALID_OPCODE] ${message}`);
    };
    const allowOnly = (allowed: string[], opname: string): void => {
      const disallowed = keys.filter((key) => !allowed.includes(key));
      if (disallowed.length > 0) {
        rejectMutex(`MUTEX_VIOLATION: ${opname} has unsupported fields: ${disallowed.join(', ')}`);
      }
    };

    if (opcode === 'SYS_WRITE') {
      allowOnly(['op', 'sys', 'syscall', 'payload', 'content', 's_prime', 'semantic_cap', 'semanticCap', 'cap', 'capability'], 'SYS_WRITE');
      const payload =
        typeof syscall.payload === 'string'
          ? syscall.payload
          : typeof syscall.content === 'string'
            ? syscall.content
            : typeof syscall.s_prime === 'string'
              ? syscall.s_prime
              : null;
      if (payload === null) {
        return null;
      }
      const semanticCap =
        typeof syscall.semantic_cap === 'string'
          ? syscall.semantic_cap.trim()
          : typeof syscall.semanticCap === 'string'
            ? syscall.semanticCap.trim()
            : typeof syscall.cap === 'string'
              ? syscall.cap.trim()
              : typeof syscall.capability === 'string'
                ? syscall.capability.trim()
                : '';
      if (semanticCap.length > 0) {
        return { op: 'SYS_WRITE', payload, semantic_cap: semanticCap };
      }
      return { op: 'SYS_WRITE', payload };
    }

    if (opcode === 'SYS_GOTO') {
      allowOnly(['op', 'sys', 'syscall', 'pointer', 'handle', 'd_next'], 'SYS_GOTO');
      const pointer =
        typeof syscall.pointer === 'string'
          ? syscall.pointer.trim()
          : typeof syscall.handle === 'string'
            ? syscall.handle.trim()
            : typeof syscall.d_next === 'string'
              ? syscall.d_next.trim()
              : '';
      if (pointer.length === 0) {
        return null;
      }
      return { op: 'SYS_GOTO', pointer };
    }

    if (opcode === 'SYS_EXEC') {
      allowOnly(['op', 'sys', 'syscall', 'cmd', 'command'], 'SYS_EXEC');
      const cmd =
        typeof syscall.cmd === 'string'
          ? syscall.cmd.trim()
          : typeof syscall.command === 'string'
            ? syscall.command.trim()
            : '';
      if (cmd.length === 0) {
        return null;
      }
      return { op: 'SYS_EXEC', cmd };
    }

    if (opcode === 'SYS_GIT_LOG') {
      allowOnly(
        ['op', 'sys', 'syscall', 'query_params', 'query', 'params', 'path', 'limit', 'ref', 'grep', 'since'],
        'SYS_GIT_LOG'
      );
      const normalized: Extract<Syscall, { op: 'SYS_GIT_LOG' }> = { op: 'SYS_GIT_LOG' };

      const queryParams =
        typeof syscall.query_params === 'string'
          ? syscall.query_params.trim()
          : typeof syscall.query === 'string'
            ? syscall.query.trim()
            : typeof syscall.params === 'string'
              ? syscall.params.trim()
              : '';
      if (queryParams.length > 0) {
        normalized.query_params = queryParams;
      }

      const path =
        typeof syscall.path === 'string'
          ? syscall.path.trim()
          : '';
      if (path.length > 0) {
        normalized.path = path;
      }

      const ref =
        typeof syscall.ref === 'string'
          ? syscall.ref.trim()
          : '';
      if (ref.length > 0) {
        normalized.ref = ref;
      }

      const grep =
        typeof syscall.grep === 'string'
          ? syscall.grep.trim()
          : '';
      if (grep.length > 0) {
        normalized.grep = grep;
      }

      const since =
        typeof syscall.since === 'string'
          ? syscall.since.trim()
          : '';
      if (since.length > 0) {
        normalized.since = since;
      }

      const rawLimit = syscall.limit;
      if (rawLimit !== undefined) {
        const parsed =
          typeof rawLimit === 'number'
            ? rawLimit
            : typeof rawLimit === 'string'
              ? Number.parseInt(rawLimit, 10)
              : Number.NaN;
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return null;
        }
        normalized.limit = Math.min(Math.floor(parsed), 200);
      }

      return normalized;
    }

    if (opcode === 'SYS_PUSH') {
      allowOnly(['op', 'sys', 'syscall', 'task', 'stack_payload', 'cmd', 'command'], 'SYS_PUSH');
      const normalizeTask = (candidate: unknown): string => {
        if (typeof candidate === 'string') {
          return candidate.trim();
        }
        if (candidate && typeof candidate === 'object') {
          try {
            return JSON.stringify(candidate);
          } catch {
            return '';
          }
        }
        return '';
      };
      const task =
        normalizeTask(syscall.task) ||
        normalizeTask(syscall.stack_payload) ||
        normalizeTask(syscall.cmd) ||
        normalizeTask(syscall.command);
      if (task.length === 0) {
        return null;
      }
      return { op: 'SYS_PUSH', task };
    }

    if (opcode === 'SYS_EDIT') {
      allowOnly(['op', 'sys', 'syscall', 'task', 'stack_payload', 'cmd', 'command'], 'SYS_EDIT');
      const normalizeTask = (candidate: unknown): string => {
        if (typeof candidate === 'string') {
          return candidate.trim();
        }
        if (candidate && typeof candidate === 'object') {
          try {
            return JSON.stringify(candidate);
          } catch {
            return '';
          }
        }
        return '';
      };
      const task =
        normalizeTask(syscall.task) ||
        normalizeTask(syscall.stack_payload) ||
        normalizeTask(syscall.cmd) ||
        normalizeTask(syscall.command);
      if (task.length === 0) {
        return null;
      }
      return { op: 'SYS_EDIT', task };
    }

    if (opcode === 'SYS_MOVE') {
      allowOnly(
        ['op', 'sys', 'syscall', 'task_id', 'task', 'id', 'target_pos', 'target', 'position', 'status', 'state'],
        'SYS_MOVE'
      );

      const normalizeMaybeString = (candidate: unknown): string | undefined => {
        if (typeof candidate !== 'string') {
          return undefined;
        }
        const trimmed = candidate.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      };

      const taskId =
        normalizeMaybeString(syscall.task_id) ||
        normalizeMaybeString(syscall.task) ||
        normalizeMaybeString(syscall.id);
      const targetPosRaw =
        normalizeMaybeString(syscall.target_pos) ||
        normalizeMaybeString(syscall.target) ||
        normalizeMaybeString(syscall.position);
      const statusRaw =
        normalizeMaybeString(syscall.status) ||
        normalizeMaybeString(syscall.state);

      const normalized: Extract<Syscall, { op: 'SYS_MOVE' }> = { op: 'SYS_MOVE' };
      if (taskId) {
        normalized.task_id = taskId;
      }
      if (targetPosRaw) {
        const targetPos = targetPosRaw.toUpperCase();
        if (targetPos !== 'TOP' && targetPos !== 'BOTTOM') {
          return null;
        }
        normalized.target_pos = targetPos;
      }
      if (statusRaw) {
        const status = statusRaw.toUpperCase();
        if (status !== 'ACTIVE' && status !== 'SUSPENDED' && status !== 'BLOCKED') {
          return null;
        }
        normalized.status = status;
      }
      return normalized;
    }

    if (opcode === 'SYS_POP') {
      allowOnly(['op', 'sys', 'syscall'], 'SYS_POP');
      return { op: 'SYS_POP' };
    }

    if (opcode === 'SYS_HALT') {
      allowOnly(['op', 'sys', 'syscall'], 'SYS_HALT');
      return { op: 'SYS_HALT' };
    }

    return null;
  }
}
