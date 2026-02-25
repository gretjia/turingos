import OpenAI from 'openai';
import { IOracle, Slice, State, Transition } from '../kernel/types.js';

export class UniversalOracle implements IOracle {
  constructor(private client: OpenAI, private model: string) {}

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

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const rawOutput = response.choices[0]?.message?.content ?? '{}';

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawOutput);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid ALU output JSON: ${message}. Raw: ${rawOutput}`);
    }

    if (!this.isTransition(parsed)) {
      throw new Error(`Invalid ALU output shape. Raw: ${rawOutput}`);
    }

    return parsed;
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
