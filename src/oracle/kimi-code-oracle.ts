import { IOracle, Slice, State, Transition } from '../kernel/types.js';

interface KimiMessageBlock {
  type?: string;
  text?: string;
}

interface KimiMessageResponse {
  content?: KimiMessageBlock[];
}

export class KimiCodeOracle implements IOracle {
  constructor(
    private apiKey: string,
    private model: string,
    private baseURL: string,
    private maxOutputTokens: number = 1024
  ) {}

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

    const response = await this.request(prompt);
    return this.parseTransition(response);
  }

  private endpoint(): string {
    const normalized = this.baseURL.replace(/\/+$/, '');
    return normalized.endsWith('/v1') ? `${normalized}/messages` : `${normalized}/v1/messages`;
  }

  private async request(prompt: string): Promise<string> {
    const response = await fetch(this.endpoint(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxOutputTokens,
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

  private parseTransition(rawOutput: string): Transition {
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
          return parsed;
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
}
