import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { FileChronos } from '../chronos/file-chronos.js';
import { TuringEngine } from '../kernel/engine.js';
import { LocalManifold } from '../manifold/local-manifold.js';
import { MockOracle } from '../oracle/mock-oracle.js';
import { UniversalOracle } from '../oracle/universal-oracle.js';
import { FileRegisters } from './registers.js';

interface CliConfig {
  workspace: string;
  oracle: 'openai' | 'mock';
  model: string;
  maxTicks: number;
  tickDelayMs: number;
  promptFile: string;
}

function parseArgs(argv: string[]): Partial<CliConfig> {
  const parsed: Partial<CliConfig> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];

    if (!key.startsWith('--') || value === undefined) {
      continue;
    }

    if (key === '--workspace') parsed.workspace = value;
    if (key === '--oracle' && (value === 'openai' || value === 'mock')) parsed.oracle = value;
    if (key === '--model') parsed.model = value;
    if (key === '--max-ticks') parsed.maxTicks = Number.parseInt(value, 10);
    if (key === '--tick-delay-ms') parsed.tickDelayMs = Number.parseInt(value, 10);
    if (key === '--prompt-file') parsed.promptFile = value;
  }

  return parsed;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  const workspace = path.resolve(
    cli.workspace ?? process.env.TURINGOS_WORKSPACE ?? path.join(process.cwd(), 'workspace')
  );
  const oracleMode = cli.oracle ?? ((process.env.TURINGOS_ORACLE as 'openai' | 'mock') || 'openai');
  const model = cli.model ?? process.env.TURINGOS_MODEL ?? 'gpt-4.1';
  const maxTicks = cli.maxTicks ?? Number.parseInt(process.env.TURINGOS_MAX_TICKS ?? '200', 10);
  const tickDelayMs = cli.tickDelayMs ?? Number.parseInt(process.env.TURINGOS_TICK_DELAY_MS ?? '0', 10);
  const promptFile = path.resolve(cli.promptFile ?? process.env.TURINGOS_PROMPT ?? 'turing_prompt.sh');

  const initialQ = process.env.TURINGOS_INITIAL_Q ?? 'q_0: SYSTEM_BOOT';
  const initialD = process.env.TURINGOS_INITIAL_D ?? 'MAIN_TAPE.md';

  fs.mkdirSync(workspace, { recursive: true });

  const mainTapePath = path.join(workspace, 'MAIN_TAPE.md');
  if (!fs.existsSync(mainTapePath)) {
    fs.writeFileSync(
      mainTapePath,
      [
        '# TuringOS Main Tape',
        '',
        '- Define your mission and physical validation rules here.',
        '- Keep objective and halt condition explicit.',
      ].join('\n'),
      'utf-8'
    );
  }

  const registers = new FileRegisters(workspace);
  registers.bootstrap(initialQ, initialD);

  const disciplinePrompt = fs.existsSync(promptFile)
    ? fs.readFileSync(promptFile, 'utf-8')
    : 'Output strict JSON with q_next, s_prime, d_next.';

  const timeoutMs = Number.parseInt(process.env.TURINGOS_TIMEOUT_MS ?? '120000', 10);
  const manifold = new LocalManifold(workspace, { timeoutMs });
  const chronos = new FileChronos(path.join(workspace, '.journal.log'));

  const oracle = (() => {
    if (oracleMode === 'mock') {
      return new MockOracle();
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn('[turingos] OPENAI_API_KEY missing. Falling back to mock oracle.');
      return new MockOracle();
    }

    return new UniversalOracle(new OpenAI({ apiKey }), model);
  })();

  const engine = new TuringEngine(manifold, oracle, chronos, disciplinePrompt);

  const startQ = registers.readQ();
  const startD = registers.readD();

  console.log(`[turingos] boot workspace=${workspace}`);
  console.log(`[turingos] oracle=${oracleMode} model=${model} maxTicks=${maxTicks}`);
  console.log(`[turingos] registers q="${startQ}" d="${startD}"`);

  const result = await engine.ignite(startQ, startD, {
    maxTicks,
    onTick: async (tick, q, d) => {
      registers.write(q, d);
      if (tickDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, tickDelayMs));
      }
      console.log(`[turingos] tick=${tick} q="${q.split('\n')[0]}" d="${d}"`);
    },
  });

  console.log(`[turingos] stopped after ${result.ticks} ticks. q="${result.q}" d="${result.d}"`);

  if (result.q.trim() !== 'HALT' && result.d.trim() !== 'HALT') {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[turingos] fatal: ${message}`);
  process.exitCode = 1;
});
