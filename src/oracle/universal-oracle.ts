import OpenAI from 'openai';
import { IOracle, Slice, StackOp, State, Transition } from '../kernel/types.js';

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
    const prompt = [
      discipline,
      '',
      '================',
      '[CPU REGISTER q]:',
      q,
      '',
      '================',
      '[DATA BUS s]:',
      s,
    ].join('\n');

    const rawOutput = await this.request(prompt);
    return this.parseTransition(rawOutput);
  }

  private async request(prompt: string): Promise<string> {
    if (this.mode === 'openai' && this.openai) {
      return this.withRetry('openai', async () => {
        const response = await this.openai!.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          response_format: { type: 'json_object' },
        });
        return response.choices[0]?.message?.content ?? '{}';
      });
    }

    if (this.mode === 'kimi' && this.kimimart) {
      return this.withRetry('kimi', async () => {
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
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        const raw = await response.text();
        if (!response.ok) {
          const error = new Error(`Kimi API ${response.status}: ${raw.slice(0, 500)}`) as ErrorWithMetadata;
          error.status = response.status;
          throw error;
        }

        let parsed: KimiMessageResponse;
        try {
          parsed = JSON.parse(raw) as KimiMessageResponse;
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

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (this.isTransition(parsed)) {
          const normalized = this.normalizeTransition(parsed);
          if (normalized.stack_op === 'PUSH' && (!normalized.stack_payload || normalized.stack_payload.length === 0)) {
            throw new Error('PUSH requires stack_payload');
          }
          if (!normalized.thought && extractedThought) {
            normalized.thought = extractedThought;
          }
          return normalized;
        }
      } catch {
        // Try next candidate shape.
      }
    }

    throw new Error(`Invalid ALU output shape. Raw: ${rawOutput}`);
  }

  private isTransition(value: unknown): value is Transition {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const asRecord = value as Record<string, unknown>;
    return (
      typeof asRecord.q_next === 'string' &&
      typeof asRecord.s_prime === 'string' &&
      typeof asRecord.d_next === 'string'
    );
  }

  private extractThought(rawOutput: string): string | undefined {
    const thoughtMatch = rawOutput.match(/<thought>([\s\S]*?)<\/thought>/i);
    if (!thoughtMatch?.[1]) {
      return undefined;
    }

    const thought = thoughtMatch[1].trim();
    return thought.length > 0 ? thought : undefined;
  }

  private normalizeTransition(value: Transition): Transition {
    const stackOp = this.normalizeStackOp(value.stack_op);
    if (!stackOp) {
      throw new Error('Missing or invalid stack_op');
    }

    const normalized: Transition = {
      q_next: value.q_next,
      s_prime: value.s_prime,
      d_next: value.d_next,
      stack_op: stackOp,
    };

    if (typeof value.thought === 'string' && value.thought.trim().length > 0) {
      normalized.thought = value.thought.trim();
    }

    if (typeof value.stack_payload === 'string' && value.stack_payload.trim().length > 0) {
      normalized.stack_payload = value.stack_payload.trim();
    }

    return normalized;
  }

  private normalizeStackOp(value: unknown): StackOp | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const upper = value.trim().toUpperCase();
    if (upper === 'PUSH' || upper === 'POP' || upper === 'NOP') {
      return upper;
    }

    return undefined;
  }
}
