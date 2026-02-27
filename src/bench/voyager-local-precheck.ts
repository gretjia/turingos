import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Syscall } from '../kernel/types.js';
import { UniversalOracle } from '../oracle/universal-oracle.js';

type VoyagerOracleMode = 'openai' | 'kimi';

interface PrecheckCaseResult {
  id: string;
  pass: boolean;
  details: string;
  qNext?: string;
  mindOps?: string[];
  worldOp?: string;
}

interface PrecheckReport {
  stamp: string;
  oracle: {
    mode: VoyagerOracleMode;
    model: string;
    baseURL: string;
    maxOutputTokens: number;
  };
  samples: number;
  minValidRate: number;
  validCount: number;
  failCount: number;
  validRate: number;
  mindOpCount: number;
  worldOpCount: number;
  comboEditPushExecCount: number;
  checks: Array<{ id: string; pass: boolean; details: string }>;
  cases: PrecheckCaseResult[];
  pass: boolean;
}

interface RuntimeConfig {
  oracleMode: VoyagerOracleMode;
  model: string;
  baseURL: string;
  apiKey: string;
  maxOutputTokens: number;
  samples: number;
  minValidRate: number;
}

const ROOT = path.resolve(process.cwd());
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'protocol');

function timestamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function parseOracleMode(raw: string | undefined): VoyagerOracleMode | null {
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'kimi') {
    return normalized;
  }
  return null;
}

function parseInteger(raw: string | undefined, fallback: number): number {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseRate(raw: string | undefined, fallback: number): number {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed <= 0) {
    return 0;
  }
  if (parsed >= 1) {
    return 1;
  }
  return parsed;
}

function isLocalBaseURL(baseURL: string): boolean {
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

function resolveRuntimeConfig(): RuntimeConfig {
  const rawMode = process.env.VOYAGER_ORACLE ?? process.env.TURINGOS_ORACLE ?? 'openai';
  const oracleMode = parseOracleMode(rawMode);
  if (!oracleMode) {
    if (rawMode.trim().toLowerCase() === 'mock') {
      throw new Error('VOYAGER_ORACLE=mock is forbidden for voyager local precheck.');
    }
    throw new Error(`Unsupported VOYAGER_ORACLE/TURINGOS_ORACLE: ${rawMode}`);
  }

  const defaultModel = oracleMode === 'kimi' ? 'kimi-for-coding' : 'gpt-4.1';
  const model = (process.env.VOYAGER_MODEL ?? process.env.TURINGOS_MODEL ?? defaultModel).trim();
  if (model.length === 0) {
    throw new Error('Model name is empty. Set VOYAGER_MODEL or TURINGOS_MODEL.');
  }

  const defaultBaseURL = oracleMode === 'kimi' ? 'https://api.kimi.com/coding' : '';
  const baseURL = (process.env.VOYAGER_API_BASE_URL ?? process.env.TURINGOS_API_BASE_URL ?? defaultBaseURL).trim();
  const providerApiKey =
    oracleMode === 'kimi'
      ? process.env.VOYAGER_KIMI_API_KEY ?? process.env.KIMI_API_KEY ?? process.env.OPENAI_API_KEY
      : process.env.VOYAGER_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  let apiKey = (process.env.VOYAGER_API_KEY ?? providerApiKey ?? '').trim();
  if (!apiKey && isLocalBaseURL(baseURL)) {
    apiKey = 'local';
  }
  if (!apiKey) {
    throw new Error(
      oracleMode === 'kimi'
        ? 'Missing API key. Set VOYAGER_API_KEY or VOYAGER_KIMI_API_KEY/KIMI_API_KEY.'
        : 'Missing API key. Set VOYAGER_API_KEY or VOYAGER_OPENAI_API_KEY/OPENAI_API_KEY.'
    );
  }

  return {
    oracleMode,
    model,
    baseURL,
    apiKey,
    maxOutputTokens: parseInteger(process.env.VOYAGER_MAX_OUTPUT_TOKENS ?? process.env.TURINGOS_MAX_OUTPUT_TOKENS, 768),
    samples: parseInteger(process.env.VOYAGER_PRECHECK_SAMPLES, 24),
    minValidRate: parseRate(process.env.VOYAGER_PRECHECK_MIN_VALID_RATE, 0.7),
  };
}

function buildCaseSlice(index: number): string {
  const mode = index % 3;
  if (mode === 0) {
    return [
      '[PRECHECK_CASE]',
      'Target: emit VLIW with dual mind scheduling and one world action.',
      'Prefer: mind_ops contains SYS_EDIT + SYS_PUSH; world_op contains SYS_EXEC.',
      'Constraint: no extra fields, strict syscall ABI.',
    ].join('\n');
  }
  if (mode === 1) {
    return [
      '[PRECHECK_CASE]',
      'Target: emit mind-only scheduling frame.',
      'Prefer: SYS_MOVE or SYS_EDIT with valid fields only; world_op can be null.',
      'Constraint: strict JSON object, no markdown.',
    ].join('\n');
  }
  return [
    '[PRECHECK_CASE]',
    'Target: emit world navigation/mutation frame.',
    'Prefer: world_op is SYS_GOTO or SYS_EXEC; mind_ops may be empty.',
    'Constraint: strict JSON object, no markdown.',
  ].join('\n');
}

async function loadDisciplinePrompt(): Promise<string> {
  const promptPath = path.join(ROOT, 'turing_prompt.sh');
  const raw = await fs.readFile(promptPath, 'utf-8');
  if (raw.trim().length === 0) {
    throw new Error('turing_prompt.sh is empty.');
  }
  return raw;
}

function hasEditPushExec(mindOps: Syscall[], worldOp: Syscall | null | undefined): boolean {
  const ops = mindOps.map((op) => op.op);
  return ops.includes('SYS_EDIT') && ops.includes('SYS_PUSH') && worldOp?.op === 'SYS_EXEC';
}

function toMarkdown(report: PrecheckReport, jsonPath: string): string {
  return [
    '# Voyager Local Precheck',
    '',
    `- stamp: ${report.stamp}`,
    `- pass: ${report.pass}`,
    `- report_json: ${jsonPath}`,
    `- oracle: ${report.oracle.mode}:${report.oracle.model}`,
    `- base_url: ${report.oracle.baseURL || '(default)'}`,
    `- samples: ${report.samples}`,
    `- valid_rate: ${report.validRate}`,
    `- min_valid_rate: ${report.minValidRate}`,
    '',
    '## Checks',
    '',
    '| Check | Result | Details |',
    '|---|---|---|',
    ...report.checks.map((check) => `| ${check.id} | ${check.pass ? 'PASS' : 'FAIL'} | ${check.details} |`),
    '',
    '## Cases (first 12)',
    '',
    '| Case | Result | mind_ops | world_op | Details |',
    '|---|---|---|---|---|',
    ...report.cases.slice(0, 12).map((item) => {
      const mind = item.mindOps?.join('|') ?? '(none)';
      const world = item.worldOp ?? '(none)';
      return `| ${item.id} | ${item.pass ? 'PASS' : 'FAIL'} | ${mind} | ${world} | ${item.details.replace(/\|/g, '/')} |`;
    }),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const config = resolveRuntimeConfig();
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  const stamp = timestamp();

  const discipline = await loadDisciplinePrompt();
  const oracle = new UniversalOracle(config.oracleMode, {
    apiKey: config.apiKey,
    model: config.model,
    baseURL: config.baseURL || undefined,
    maxOutputTokens: config.maxOutputTokens,
  });

  const caseResults: PrecheckCaseResult[] = [];
  let validCount = 0;
  let mindOpCount = 0;
  let worldOpCount = 0;
  let comboCount = 0;

  for (let i = 0; i < config.samples; i += 1) {
    const id = `precheck_${String(i + 1).padStart(2, '0')}`;
    const q = `q_precheck_${i + 1}`;
    const s = buildCaseSlice(i);

    try {
      const transition = await oracle.collapse(discipline, q, s);
      const mindOps = transition.mind_ops ?? [];
      const worldOp = transition.world_op ?? null;
      if (mindOps.length > 0) {
        mindOpCount += 1;
      }
      if (worldOp) {
        worldOpCount += 1;
      }
      if (hasEditPushExec(mindOps, worldOp)) {
        comboCount += 1;
      }
      validCount += 1;
      caseResults.push({
        id,
        pass: true,
        details: 'parse-ok',
        qNext: transition.q_next,
        mindOps: mindOps.map((op) => op.op),
        worldOp: worldOp?.op,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      caseResults.push({
        id,
        pass: false,
        details: message.slice(0, 300),
      });
    }
  }

  const failCount = config.samples - validCount;
  const validRate = Number((validCount / config.samples).toFixed(4));

  const checks = [
    {
      id: 'valid_rate_threshold',
      pass: validRate >= config.minValidRate,
      details: `valid=${validCount}/${config.samples} rate=${validRate}`,
    },
    {
      id: 'mind_ops_observed',
      pass: mindOpCount > 0,
      details: `mind_cases=${mindOpCount}`,
    },
    {
      id: 'world_op_observed',
      pass: worldOpCount > 0,
      details: `world_cases=${worldOpCount}`,
    },
    {
      id: 'edit_push_exec_combo_observed',
      pass: comboCount > 0,
      details: `combo_cases=${comboCount}`,
    },
  ];

  const report: PrecheckReport = {
    stamp,
    oracle: {
      mode: config.oracleMode,
      model: config.model,
      baseURL: config.baseURL,
      maxOutputTokens: config.maxOutputTokens,
    },
    samples: config.samples,
    minValidRate: config.minValidRate,
    validCount,
    failCount,
    validRate,
    mindOpCount,
    worldOpCount,
    comboEditPushExecCount: comboCount,
    checks,
    cases: caseResults,
    pass: checks.every((check) => check.pass),
  };

  const jsonPath = path.join(AUDIT_DIR, `voyager_local_precheck_${stamp}.json`);
  const mdPath = path.join(AUDIT_DIR, `voyager_local_precheck_${stamp}.md`);
  const latestJsonPath = path.join(AUDIT_DIR, 'voyager_local_precheck_latest.json');
  const latestMdPath = path.join(AUDIT_DIR, 'voyager_local_precheck_latest.md');

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(mdPath, `${toMarkdown(report, jsonPath)}\n`, 'utf-8');
  await fs.writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(latestMdPath, `${toMarkdown(report, jsonPath)}\n`, 'utf-8');

  for (const check of checks) {
    console.log(`[voyager-precheck] ${check.pass ? 'PASS' : 'FAIL'} ${check.id}: ${check.details}`);
  }
  console.log(`[voyager-precheck] report=${jsonPath}`);
  if (!report.pass) {
    console.error('[voyager-precheck] FAIL');
    process.exitCode = 1;
    return;
  }
  console.log('[voyager-precheck] PASS');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[voyager-precheck] fatal: ${message}`);
  process.exitCode = 1;
});
