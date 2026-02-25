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
}

export class UniversalOracle implements IOracle {
  private openai?: OpenAI;
  private model: string;
  private kimimart?: {
    endpoint: string;
    apiKey: string;
    model: string;
    maxOutputTokens: number;
  };

  constructor(private mode: OracleMode, config: UniversalOracleConfig) {
    this.model = config.model;
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
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        response_format: { type: 'json_object' },
      });
      return response.choices[0]?.message?.content ?? '{}';
    }

    if (this.mode === 'kimi' && this.kimimart) {
      const response = await fetch(this.kimimart.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': this.kimimart.apiKey,
        },
        body: JSON.stringify({
          model: this.kimimart.model,
          max_tokens: this.kimimart.maxOutputTokens,
          temperature: 0,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`Kimi API ${response.status}: ${raw.slice(0, 500)}`);
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
    }

    throw new Error('Oracle not configured');
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
