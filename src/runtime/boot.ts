import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { FileChronos } from '../chronos/file-chronos.js';
import { TuringEngine } from '../kernel/engine.js';
import { SYSCALL_OPCODE_PIPE } from '../kernel/syscall-schema.js';
import { IOracle } from '../kernel/types.js';
import { LocalManifold } from '../manifold/local-manifold.js';
import { DispatcherOracle } from '../oracle/dispatcher-oracle.js';
import { MockOracle } from '../oracle/mock-oracle.js';
import { UniversalOracle } from '../oracle/universal-oracle.js';
import { FileExecutionContract } from './file-execution-contract.js';
import { FileRegisters } from './registers.js';

type OracleMode = 'kimi' | 'openai' | 'mock';

interface CliConfig {
  workspace: string;
  oracle: OracleMode;
  model: string;
  maxTicks: number;
  tickDelayMs: number;
  promptFile: string;
}

interface BuiltOracle {
  oracle: IOracle;
  label: string;
  mode: OracleMode;
  model: string;
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
    if (key === '--oracle' && (value === 'kimi' || value === 'openai' || value === 'mock')) {
      parsed.oracle = value;
    }
    if (key === '--model') parsed.model = value;
    if (key === '--max-ticks') parsed.maxTicks = Number.parseInt(value, 10);
    if (key === '--tick-delay-ms') parsed.tickDelayMs = Number.parseInt(value, 10);
    if (key === '--prompt-file') parsed.promptFile = value;
  }

  return parsed;
}

function parseOracleMode(value: string | undefined): OracleMode | null {
  if (value === 'kimi' || value === 'openai' || value === 'mock') {
    return value;
  }
  return null;
}

function parseBoolFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function isLocalBaseURL(baseURL: string | undefined): boolean {
  if (!baseURL || baseURL.trim().length === 0) {
    return false;
  }
  try {
    const parsed = new URL(baseURL);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function defaultApiKey(mode: OracleMode): string | undefined {
  if (mode === 'mock') {
    return undefined;
  }
  if (mode === 'kimi') {
    return process.env.KIMI_API_KEY ?? process.env.OPENAI_API_KEY;
  }
  return process.env.OPENAI_API_KEY;
}

function buildSingleOracle(options: {
  mode: OracleMode;
  model: string;
  baseURL?: string;
  apiKey?: string;
  maxOutputTokens: number;
}): BuiltOracle {
  const mode = options.mode;
  const model = options.model;
  const baseURL = options.baseURL;

  if (mode === 'mock') {
    return { oracle: new MockOracle(), label: 'mock', mode, model: 'mock' };
  }

  let apiKey = options.apiKey ?? defaultApiKey(mode);
  if (!apiKey && isLocalBaseURL(baseURL)) {
    apiKey = 'local';
  }
  if (!apiKey) {
    console.warn(
      mode === 'kimi'
        ? '[turingos] KIMI_API_KEY missing. Falling back to mock oracle.'
        : '[turingos] OPENAI_API_KEY missing. Falling back to mock oracle.'
    );
    return { oracle: new MockOracle(), label: 'mock(fallback)', mode: 'mock', model: 'mock' };
  }

  return {
    oracle: new UniversalOracle(mode, {
      apiKey,
      model,
      baseURL,
      maxOutputTokens: options.maxOutputTokens,
    }),
    label: `${mode}:${model}`,
    mode,
    model,
  };
}

function buildDispatcherLane(
  lane: 'P' | 'E',
  defaults: { mode: OracleMode; model: string; baseURL?: string; maxOutputTokens: number }
): BuiltOracle {
  const prefix = `TURINGOS_DISPATCHER_${lane}_`;
  const mode = parseOracleMode(process.env[`${prefix}ORACLE`]) ?? defaults.mode;
  const model = process.env[`${prefix}MODEL`] ?? defaults.model;
  const baseURL = process.env[`${prefix}BASE_URL`] ?? defaults.baseURL;
  const apiKey = process.env[`${prefix}API_KEY`];
  const built = buildSingleOracle({
    mode,
    model,
    baseURL,
    apiKey,
    maxOutputTokens: defaults.maxOutputTokens,
  });
  return {
    ...built,
    label: `${lane}:${built.label}`,
  };
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  const workspace = path.resolve(
    cli.workspace ?? process.env.TURINGOS_WORKSPACE ?? path.join(process.cwd(), 'workspace')
  );
  const envOracle = parseOracleMode(process.env.TURINGOS_ORACLE);
  const oracleMode = cli.oracle ?? envOracle ?? 'kimi';
  const model =
    cli.model ?? process.env.TURINGOS_MODEL ?? (oracleMode === 'kimi' ? 'kimi-for-coding' : 'gpt-4.1');
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
    : `Output strict JSON with q_next plus VLIW fields (mind_ops and optional world_op), using SYS opcode set ${SYSCALL_OPCODE_PIPE}.`;

  const timeoutMs = Number.parseInt(process.env.TURINGOS_TIMEOUT_MS ?? '120000', 10);
  const maxOutputTokens = Number.parseInt(process.env.TURINGOS_MAX_OUTPUT_TOKENS ?? '1024', 10);
  const baseURL = process.env.TURINGOS_API_BASE_URL;
  const dispatcherEnabled = parseBoolFlag(process.env.TURINGOS_DISPATCHER_ENABLED);
  const manifold = new LocalManifold(workspace, { timeoutMs });
  const chronos = new FileChronos(path.join(workspace, '.journal.log'));
  const executionContract = await FileExecutionContract.fromWorkspace(workspace);

  let oracleDescriptor = `${oracleMode}:${model}`;
  const oracle = (() => {
    if (!dispatcherEnabled) {
      const built = buildSingleOracle({
        mode: oracleMode,
        model,
        baseURL,
        maxOutputTokens,
      });
      oracleDescriptor = built.label;
      return built.oracle;
    }

    const defaults = { mode: oracleMode, model, baseURL, maxOutputTokens };
    const pLane = buildDispatcherLane('P', defaults);
    const eLane = buildDispatcherLane('E', defaults);
    oracleDescriptor = `dispatcher(${pLane.label}|${eLane.label})`;
    return new DispatcherOracle({
      pOracle: pLane.oracle,
      eOracle: eLane.oracle,
      pLaneLabel: pLane.label,
      eLaneLabel: eLane.label,
      minHealthyScore: Number.parseFloat(process.env.TURINGOS_DISPATCHER_MIN_HEALTH ?? '0.45'),
      switchMargin: Number.parseFloat(process.env.TURINGOS_DISPATCHER_SWITCH_MARGIN ?? '0.15'),
    });
  })();

  const engine = new TuringEngine(manifold, oracle, chronos, disciplinePrompt, executionContract ?? undefined);

  const startQ = registers.readQ();
  const startD = registers.readD();

  console.log(`[turingos] boot workspace=${workspace}`);
  console.log(`[turingos] oracle=${oracleDescriptor} maxTicks=${maxTicks}`);
  if (dispatcherEnabled) {
    console.log(
      `[turingos] dispatcher min_health=${process.env.TURINGOS_DISPATCHER_MIN_HEALTH ?? '0.45'} switch_margin=${
        process.env.TURINGOS_DISPATCHER_SWITCH_MARGIN ?? '0.15'
      }`
    );
  }
  if (executionContract) {
    console.log(`[turingos] execution-contract=${FileExecutionContract.FILE_NAME}`);
  }
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
