import OpenAI from 'openai';
import fsp from 'node:fs/promises';
import { IOracle, Slice, State, Transition } from '../kernel/types.js';
import { BusProvider, extractProviderText, parseProviderBusTransition, ProviderUsage } from './turing-bus-adapter.js';

type OracleMode = 'openai' | 'kimi';

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

function inferOpenAIProvider(baseURL?: string): BusProvider {
  if (!baseURL) {
    return 'openai';
  }
  const normalized = baseURL.toLowerCase();
  if (normalized.includes('11434') || normalized.includes('ollama')) {
    return 'ollama';
  }
  return 'openai';
}

export class UniversalOracle implements IOracle {
  private openai?: OpenAI;
  private model: string;
  private readonly responseProvider: BusProvider;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly telemetryPath: string | null;
  private readonly localRepairEnabled: boolean;
  private readonly localRepairMaxAttempts: number;
  private telemetrySeq = 0;
  private kimimart?: {
    endpoint: string;
    apiKey: string;
    model: string;
    maxOutputTokens: number;
  };

  constructor(private mode: OracleMode, config: UniversalOracleConfig) {
    this.model = config.model;
    this.responseProvider = mode === 'openai' ? inferOpenAIProvider(config.baseURL) : 'kimi';
    this.maxRetries = config.maxRetries ?? 6;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 2000;
    this.retryMaxDelayMs = config.retryMaxDelayMs ?? 60000;
    const telemetryPath = (process.env.TURINGOS_TOKEN_TELEMETRY_PATH ?? '').trim();
    this.telemetryPath = telemetryPath.length > 0 ? telemetryPath : null;
    this.localRepairEnabled = this.parseBoolEnv(process.env.TURINGOS_OLLAMA_REPAIR_ENABLED, true);
    this.localRepairMaxAttempts = this.parseIntEnv(process.env.TURINGOS_OLLAMA_REPAIR_MAX_ATTEMPTS, 2, 0, 5);
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

    const rawPayload = await this.request(discipline, userFrame);
    const parsed = await this.parseWithLocalRepair(rawPayload, discipline, userFrame);
    await this.recordTelemetry(this.responseProvider, discipline, userFrame, parsed.text, parsed.usage);
    return parsed.transition;
  }

  private async parseWithLocalRepair(
    payload: unknown,
    discipline: string,
    userFrame: string
  ): Promise<{ transition: Transition; text: string; usage: ProviderUsage }> {
    try {
      return parseProviderBusTransition(this.responseProvider, payload);
    } catch (error: unknown) {
      if (!this.shouldAttemptLocalRepair()) {
        throw error;
      }

      let lastError = this.normalizeError(error);
      let candidatePayload: unknown = payload;
      let candidateText = this.toRepairCandidateText(candidatePayload);

      for (let attempt = 1; attempt <= this.localRepairMaxAttempts; attempt += 1) {
        const repairSystemPrompt = [
          'You returned an invalid TuringOS syscall frame.',
          'Return exactly one strict JSON object with no markdown or extra commentary.',
          'Schema: q_next(string), optional thought/thought_process(string), mind_ops(array), world_op(object|null).',
          'mind_ops op must be one of SYS_PUSH|SYS_POP|SYS_EDIT|SYS_MOVE.',
          'world_op op must be one of SYS_WRITE|SYS_EXEC|SYS_GOTO|SYS_GIT_LOG|SYS_HALT.',
          'mind_ops may contain 0..N entries; world_op may contain 0..1 entry.',
          'Do not emit world_ops. Do not emit legacy a_t.',
          'Field ABI is fail-closed: include only allowed fields per opcode.',
        ].join('\n');

        const repairUserFrame = [
          '[PARSER_ERROR]',
          lastError.message.slice(0, 1200),
          '',
          '[ORIGINAL_SYSTEM_PROMPT]',
          discipline,
          '',
          '[ORIGINAL_USER_FRAME]',
          userFrame,
          '',
          '[INVALID_MODEL_OUTPUT_TO_REPAIR]',
          candidateText,
        ].join('\n');

        candidatePayload = await this.request(repairSystemPrompt, repairUserFrame);
        try {
          return parseProviderBusTransition(this.responseProvider, candidatePayload);
        } catch (retryError: unknown) {
          lastError = this.normalizeError(retryError);
          candidateText = this.toRepairCandidateText(candidatePayload);
          const status = lastError.status ?? 'n/a';
          console.warn(
            `[oracle:${this.responseProvider}] repair parse failed; attempt=${attempt}/${this.localRepairMaxAttempts}; status=${status}`
          );
        }
      }

      throw lastError;
    }
  }

  private shouldAttemptLocalRepair(): boolean {
    return this.responseProvider === 'ollama' && this.localRepairEnabled && this.localRepairMaxAttempts > 0;
  }

  private toRepairCandidateText(payload: unknown): string {
    const extracted = extractProviderText(this.responseProvider, payload);
    if (extracted.ok) {
      return extracted.text.slice(0, 12_000);
    }
    if (typeof payload === 'string') {
      return payload.slice(0, 12_000);
    }
    try {
      return JSON.stringify(payload).slice(0, 12_000);
    } catch {
      return String(payload).slice(0, 12_000);
    }
  }

  private parseBoolEnv(raw: string | undefined, fallback: boolean): boolean {
    if (!raw || raw.trim().length === 0) {
      return fallback;
    }
    return /^(1|true|yes|on)$/i.test(raw.trim());
  }

  private parseIntEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
    if (!raw || raw.trim().length === 0) {
      return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
  }

  private async request(systemPrompt: string, userFrame: string): Promise<unknown> {
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
        return response as unknown;
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

        let parsedRaw: Record<string, unknown>;
        try {
          parsedRaw = JSON.parse(raw) as Record<string, unknown>;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Invalid Kimi response JSON: ${message}. Raw: ${raw.slice(0, 500)}`);
        }
        return parsedRaw;
      });
    }

    throw new Error('Oracle not configured');
  }

  private async withRetry<T>(provider: 'openai' | 'kimi', operation: () => Promise<T>): Promise<T> {
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

  private estimateTokens(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }
    return Math.ceil(text.length / 4);
  }

  private async recordTelemetry(
    provider: BusProvider,
    systemPrompt: string,
    userFrame: string,
    output: string,
    usage: ProviderUsage
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
}
