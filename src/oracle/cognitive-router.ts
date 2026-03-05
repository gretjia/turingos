export interface CognitiveProfile {
  provider: 'openai' | 'kimi' | 'ollama' | string;
  temperature: number;
  topP: number;
  entropySalt: string;
}

export class CognitiveRouter {
  generateProfile(workerIndex: number, tick: number): CognitiveProfile {
    const temperatures = [0.1, 0.7, 1.2, 0.4, 0.9, 1.3];
    const topPs = [0.9, 0.95, 0.99, 0.92, 0.97, 0.99];
    const providers = ['openai', 'kimi', 'kimi', 'openai', 'ollama', 'kimi'];

    const index = workerIndex % temperatures.length;

    return {
      provider: providers[index],
      temperature: temperatures[index],
      topP: topPs[index],
      entropySalt: `w${workerIndex}_t${tick}`
    };
  }
}
