import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  SYSCALL_EXACT_FIELD_PROMPT_LINES,
  SYSCALL_OPCODE_PIPE,
  validateCanonicalSyscallEnvelope,
} from '../kernel/syscall-schema.js';
import { UniversalOracle } from '../oracle/universal-oracle.js';

type EvalMode = 'gold' | 'model';
type SplitName = 'train' | 'val' | 'test';
type ThresholdProfile = 'prod' | 'dev';

interface PolicyRow {
  task: 'syscall_policy';
  input: {
    q_t: string;
    s_t: string;
    d_t: string;
  };
  output: {
    q_next: string;
    a_t: Record<string, unknown>;
  };
}

interface ReflexRow {
  task: 'guard_reflex';
  input: {
    trap_frame: {
      trap_base: string;
      trap_pointer: string;
      details: string;
      panic_reset_count: number | null;
    };
    instruction: string;
  };
  output: {
    q_next: string;
    a_t: Record<string, unknown>;
  };
}

interface CliArgs {
  splitManifest: string;
  mode: EvalMode;
  thresholdProfile: ThresholdProfile;
  oracleMode: 'auto' | 'openai' | 'kimi';
  baseURL: string;
  model: string;
  apiKey: string;
  policyLimit: number;
  reflexLimit: number;
  maxModelAttempts: number;
  minValidJsonRate: number;
  minReflexExactRate: number;
  minDeadlockEscapeRate: number;
}

interface EvalReport {
  stamp: string;
  mode: EvalMode;
  splitManifest: string;
  provider: {
    oracleMode: 'openai' | 'kimi';
    baseURL: string;
    model: string;
  };
  selectedSplits: {
    policy: SplitName;
    reflex: SplitName;
  };
  selectedFiles: {
    policy: string;
    reflex: string;
  };
  counts: {
    policyTotal: number;
    policyEvaluated: number;
    reflexTotal: number;
    reflexEvaluated: number;
    modelRepairAttempts: number;
    modelFailures: number;
  };
  metrics: {
    validJsonRate: number;
    mutexViolationRate: number;
    reflexExactMatchRate: number;
    deadlockEscapeRate: number;
  };
  thresholds: {
    profile: ThresholdProfile;
    maxModelAttempts: number;
    minValidJsonRate: number;
    minReflexExactRate: number;
    minDeadlockEscapeRate: number;
  };
  pass: boolean;
}

const ROOT = path.resolve(process.cwd());
const SFT_AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'sft');
const LATEST_SPLIT_MANIFEST = path.join(ROOT, 'benchmarks', 'data', 'sft', 'splits', 'latest_manifest.json');
const LATEST_EVAL = path.join(SFT_AUDIT_DIR, 'guard_mcu_eval_latest.json');

function parseThresholdProfile(raw: string): ThresholdProfile {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'prod') return 'prod';
  if (normalized === 'dev') return 'dev';
  throw new Error(`Invalid --threshold-profile: ${raw}. Expected one of: prod, dev`);
}

function profileThresholds(profile: ThresholdProfile): {
  minValidJsonRate: number;
  minReflexExactRate: number;
  minDeadlockEscapeRate: number;
} {
  if (profile === 'dev') {
    return {
      minValidJsonRate: 0.1,
      minReflexExactRate: 0,
      minDeadlockEscapeRate: 0.8,
    };
  }
  return {
    minValidJsonRate: 0.999,
    minReflexExactRate: 0.75,
    minDeadlockEscapeRate: 0.95,
  };
}

function normalizeOracleMode(raw: string | undefined): 'auto' | 'openai' | 'kimi' {
  const normalized = (raw ?? '').trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'kimi' || normalized === 'auto') {
    return normalized;
  }
  return 'auto';
}

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

function parseRatio(raw: string, flag: string): number {
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Invalid ${flag}: ${raw}`);
  }
  return parsed;
}

function parsePositive(raw: string, flag: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flag}: ${raw}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliArgs {
  let splitManifest = LATEST_SPLIT_MANIFEST;
  let mode: EvalMode = 'gold';
  let thresholdProfile: ThresholdProfile = process.env.TURINGOS_GUARD_EVAL_PROFILE
    ? parseThresholdProfile(process.env.TURINGOS_GUARD_EVAL_PROFILE)
    : 'prod';
  let oracleMode: 'auto' | 'openai' | 'kimi' = normalizeOracleMode(process.env.TURINGOS_GUARD_MODEL_ORACLE);
  let baseURL = process.env.TURINGOS_GUARD_MODEL_BASE_URL ?? process.env.TURINGOS_API_BASE_URL ?? '';
  let model = process.env.TURINGOS_GUARD_MODEL_NAME ?? process.env.TURINGOS_MODEL ?? '';
  let apiKey =
    process.env.TURINGOS_GUARD_MODEL_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.KIMI_API_KEY ??
    '';
  let policyLimit = 300;
  let reflexLimit = 200;
  let maxModelAttempts = 2;
  let { minValidJsonRate, minReflexExactRate, minDeadlockEscapeRate } = profileThresholds(thresholdProfile);

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      continue;
    }
    if (key === '--threshold-profile') {
      thresholdProfile = parseThresholdProfile(value);
      const thresholds = profileThresholds(thresholdProfile);
      minValidJsonRate = thresholds.minValidJsonRate;
      minReflexExactRate = thresholds.minReflexExactRate;
      minDeadlockEscapeRate = thresholds.minDeadlockEscapeRate;
    }
  }

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      continue;
    }
    if (key === '--split-manifest') splitManifest = path.resolve(value);
    if (key === '--mode' && (value === 'gold' || value === 'model')) mode = value;
    if (key === '--oracle-mode' && (value === 'auto' || value === 'openai' || value === 'kimi')) oracleMode = value;
    if (key === '--base-url') baseURL = value;
    if (key === '--model') model = value;
    if (key === '--api-key') apiKey = value;
    if (key === '--policy-limit') policyLimit = parsePositive(value, '--policy-limit');
    if (key === '--reflex-limit') reflexLimit = parsePositive(value, '--reflex-limit');
    if (key === '--max-model-attempts') maxModelAttempts = parsePositive(value, '--max-model-attempts');
    if (key === '--min-valid-json-rate') minValidJsonRate = parseRatio(value, '--min-valid-json-rate');
    if (key === '--min-reflex-exact-rate') minReflexExactRate = parseRatio(value, '--min-reflex-exact-rate');
    if (key === '--min-deadlock-escape-rate') minDeadlockEscapeRate = parseRatio(value, '--min-deadlock-escape-rate');
  }

  return {
    splitManifest,
    mode,
    thresholdProfile,
    oracleMode,
    baseURL,
    model,
    apiKey,
    policyLimit,
    reflexLimit,
    maxModelAttempts,
    minValidJsonRate,
    minReflexExactRate,
    minDeadlockEscapeRate,
  };
}

function normalizeRows<T>(raw: string): T[] {
  const out: T[] = [];
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      continue;
    }
  }
  return out;
}

function pickSplitFile(files: Record<string, unknown>, split: SplitName): string {
  const raw = files[split];
  return typeof raw === 'string' ? raw : '';
}

async function loadFirstNonEmptySplit<T>(
  files: Record<string, unknown>,
  limit: number,
  label: string
): Promise<{ split: SplitName; file: string; rows: T[] }> {
  const order: SplitName[] = ['val', 'test', 'train'];
  for (const split of order) {
    const file = pickSplitFile(files, split);
    if (!file || !fs.existsSync(file)) {
      continue;
    }
    const rows = normalizeRows<T>(await fsp.readFile(file, 'utf-8')).slice(0, limit);
    if (rows.length > 0) {
      return { split, file, rows };
    }
  }
  throw new Error(`No non-empty split found for ${label}. Checked in order: val -> test -> train.`);
}

function normalizeOp(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return '';
  }
  const op = (value as Record<string, unknown>).op;
  return typeof op === 'string' ? op.trim().toUpperCase() : '';
}

function buildPolicyPrompt(): string {
  return [
    'You are TuringOS ALU in strict bus mode.',
    'Return EXACTLY one JSON object with ONLY top-level keys: q_next and a_t.',
    'q_next MUST be a short non-empty state label and MUST NOT be an opcode.',
    'a_t MUST be a valid syscall object with op in:',
    SYSCALL_OPCODE_PIPE,
    'Allowed opcodes and exact fields:',
    ...SYSCALL_EXACT_FIELD_PROMPT_LINES,
    'Never include unsupported keys. Never include markdown or prose.',
    'If uncertain, emit safe fallback: {"q_next":"tick_continue","a_t":{"op":"SYS_POP"}}.',
  ].join(' ');
}

function buildReflexPrompt(): string {
  return [
    'You are Guard MCU for trap recovery.',
    'Return EXACTLY one JSON object with ONLY top-level keys: q_next and a_t.',
    'q_next MUST be a short non-empty state label and MUST NOT be an opcode.',
    'a_t MUST be a valid recovery syscall object with op in:',
    SYSCALL_OPCODE_PIPE,
    'Allowed opcodes and exact fields:',
    ...SYSCALL_EXACT_FIELD_PROMPT_LINES,
    'Never include unsupported keys. Never include markdown or prose.',
    'Prefer deterministic escape actions for trap contexts: SYS_POP or SYS_GOTO.',
    'If uncertain, emit safe fallback: {"q_next":"guard_resume","a_t":{"op":"SYS_POP"}}.',
  ].join(' ');
}

function summarizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').slice(0, 320);
}

function buildRepairPrompt(base: string, error: unknown): string {
  const summary = summarizeError(error);
  return [
    base,
    'REPAIR MODE: your previous output violated canonical parser constraints.',
    `Last parser error: ${summary}`,
    'Output JSON only; do not include code fences or explanations.',
  ].join(' ');
}

async function collapseWithRepair(
  oracle: UniversalOracle,
  discipline: string,
  q: string,
  s: string,
  maxAttempts: number
): Promise<{ transition: { q_next: string; a_t: unknown; thought?: string }; repairAttempts: number }> {
  let currentDiscipline = discipline;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const transition = await oracle.collapse(currentDiscipline, q, s);
      return { transition, repairAttempts: Math.max(0, attempt - 1) };
    } catch (error: unknown) {
      lastError = error;
      if (attempt >= maxAttempts) {
        throw error;
      }
      currentDiscipline = buildRepairPrompt(discipline, error);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Unexpected model collapse retry exhaustion');
}

function resolveOracleMode(args: CliArgs): 'openai' | 'kimi' {
  if (args.oracleMode === 'openai' || args.oracleMode === 'kimi') {
    return args.oracleMode;
  }
  const base = args.baseURL.toLowerCase();
  const model = args.model.toLowerCase();
  if (base.includes('api.kimi.com') || model.includes('kimi') || model.includes('moonshot')) {
    return 'kimi';
  }
  return 'openai';
}

function isDeadlockTrap(row: ReflexRow): boolean {
  const base = row.input.trap_frame.trap_base.toLowerCase().trim();
  const details = row.input.trap_frame.details.toLowerCase();
  const baseMatch =
    base === 'sys://trap/deadlock' ||
    base === 'sys://trap/watchdog' ||
    base === 'sys://trap/thrashing' ||
    base === 'sys://trap/panic_reset' ||
    base === 'sys://trap/unrecoverable_loop';
  const detailMatch =
    /\bdeadlock\b/.test(details) ||
    /\binfinite loop\b/.test(details) ||
    /\banalysis paralysis\b/.test(details) ||
    /\bwatchdog\b/.test(details) ||
    /\bthrashing\b/.test(details);
  return (
    baseMatch || detailMatch
  );
}

function toMarkdown(report: EvalReport, jsonPath: string): string {
  return [
    '# Guard MCU Eval',
    '',
    `- stamp: ${report.stamp}`,
    `- mode: ${report.mode}`,
    `- pass: ${report.pass}`,
    `- report_json: ${jsonPath}`,
    `- split_manifest: ${report.splitManifest}`,
    `- policy_split: ${report.selectedSplits.policy}`,
    `- reflex_split: ${report.selectedSplits.reflex}`,
    `- policy_file: ${report.selectedFiles.policy}`,
    `- reflex_file: ${report.selectedFiles.reflex}`,
    `- threshold_profile: ${report.thresholds.profile}`,
    `- max_model_attempts: ${report.thresholds.maxModelAttempts}`,
    `- oracle_mode: ${report.provider.oracleMode}`,
    `- base_url: ${report.provider.baseURL || '(none)'}`,
    `- model: ${report.provider.model || '(none)'}`,
    '',
    '## Metrics',
    '',
    `- valid_json_rate: ${report.metrics.validJsonRate}`,
    `- mutex_violation_rate: ${report.metrics.mutexViolationRate}`,
    `- reflex_exact_match_rate: ${report.metrics.reflexExactMatchRate}`,
    `- deadlock_escape_rate: ${report.metrics.deadlockEscapeRate}`,
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await fsp.mkdir(SFT_AUDIT_DIR, { recursive: true });

  if (!fs.existsSync(args.splitManifest)) {
    throw new Error(`Split manifest not found: ${args.splitManifest}`);
  }
  const manifestRaw = await fsp.readFile(args.splitManifest, 'utf-8');
  const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
  const policyFiles = (manifest.policy as Record<string, unknown>)?.files as Record<string, unknown> | undefined;
  const reflexFiles = (manifest.reflex as Record<string, unknown>)?.files as Record<string, unknown> | undefined;
  if (!policyFiles || !reflexFiles) {
    throw new Error(`Invalid split manifest: missing policy/reflex files map in ${args.splitManifest}`);
  }

  const policySelection = await loadFirstNonEmptySplit<PolicyRow>(policyFiles, args.policyLimit, 'policy');
  const reflexSelection = await loadFirstNonEmptySplit<ReflexRow>(reflexFiles, args.reflexLimit, 'reflex');
  const policyRows = policySelection.rows;
  const reflexRows = reflexSelection.rows;

  const useModel = args.mode === 'model';
  let oracle: UniversalOracle | null = null;
  const resolvedOracleMode = resolveOracleMode(args);
  if (useModel) {
    if (!args.baseURL || !args.model || !args.apiKey) {
      throw new Error(
        'Model mode requires --base-url --model --api-key (or TURINGOS_GUARD_MODEL_* env vars).'
      );
    }
    oracle = new UniversalOracle(resolvedOracleMode, {
      apiKey: args.apiKey,
      model: args.model,
      baseURL: args.baseURL,
    });
  }

  let totalEval = 0;
  let validJson = 0;
  let mutexViolations = 0;
  let reflexExact = 0;
  let deadlockTotal = 0;
  let deadlockEscapes = 0;
  let modelRepairAttempts = 0;
  let modelFailures = 0;

  const policyPrompt = buildPolicyPrompt();
  const reflexPrompt = buildReflexPrompt();

  for (const row of policyRows) {
    totalEval += 1;
    let predictedOp = '';
    let predictedEnvelope: Record<string, unknown> | null = null;
    if (useModel) {
      try {
        const result = await collapseWithRepair(oracle!, policyPrompt, row.input.q_t, row.input.s_t, args.maxModelAttempts);
        modelRepairAttempts += result.repairAttempts;
        const transition = result.transition;
        predictedOp = normalizeOp(transition.a_t);
        predictedEnvelope = transition.a_t as Record<string, unknown>;
      } catch {
        modelRepairAttempts += Math.max(0, args.maxModelAttempts - 1);
        modelFailures += 1;
        continue;
      }
    } else {
      predictedOp = normalizeOp(row.output.a_t);
      predictedEnvelope = row.output.a_t;
    }

    if (predictedOp.length > 0) {
      validJson += 1;
    }
    const violation = validateCanonicalSyscallEnvelope(predictedEnvelope);
    if (!violation) {
      // valid envelope
    } else if (violation.includes('MUTEX_VIOLATION')) {
      mutexViolations += 1;
    }
  }

  for (const row of reflexRows) {
    totalEval += 1;
    let predictedOp = '';
    let predictedEnvelope: Record<string, unknown> | null = null;
    if (useModel) {
      const trapSlice = [
        `[TRAP_BASE] ${row.input.trap_frame.trap_base}`,
        `[TRAP_POINTER] ${row.input.trap_frame.trap_pointer}`,
        `[TRAP_DETAILS] ${row.input.trap_frame.details}`,
      ].join('\n');
      try {
        const result = await collapseWithRepair(
          oracle!,
          reflexPrompt,
          'q_guard_reflex',
          trapSlice,
          args.maxModelAttempts
        );
        modelRepairAttempts += result.repairAttempts;
        const transition = result.transition;
        predictedOp = normalizeOp(transition.a_t);
        predictedEnvelope = transition.a_t as Record<string, unknown>;
      } catch {
        modelRepairAttempts += Math.max(0, args.maxModelAttempts - 1);
        modelFailures += 1;
        continue;
      }
    } else {
      predictedOp = normalizeOp(row.output.a_t);
      predictedEnvelope = row.output.a_t;
    }

    if (predictedOp.length > 0) {
      validJson += 1;
    }
    const violation = validateCanonicalSyscallEnvelope(predictedEnvelope);
    if (violation && violation.includes('MUTEX_VIOLATION')) {
      mutexViolations += 1;
    }

    const expectedOp = normalizeOp(row.output.a_t);
    if (predictedOp === expectedOp && predictedOp.length > 0) {
      reflexExact += 1;
    }
    if (isDeadlockTrap(row)) {
      deadlockTotal += 1;
      if (['SYS_POP', 'SYS_GOTO', 'SYS_WRITE', 'SYS_EXEC', 'SYS_MOVE', 'SYS_EDIT'].includes(predictedOp)) {
        deadlockEscapes += 1;
      }
    }
  }

  const denom = totalEval === 0 ? 1 : totalEval;
  const reflexDenom = reflexRows.length === 0 ? 1 : reflexRows.length;
  const deadlockDenom = deadlockTotal === 0 ? 1 : deadlockTotal;
  const validJsonRate = Number((validJson / denom).toFixed(4));
  const mutexViolationRate = Number((mutexViolations / denom).toFixed(4));
  const reflexExactMatchRate = Number((reflexExact / reflexDenom).toFixed(4));
  const deadlockEscapeRate = Number(
    (deadlockTotal === 0 ? 1 : deadlockEscapes / deadlockDenom).toFixed(4)
  );

  const report: EvalReport = {
    stamp: timestamp(),
    mode: args.mode,
    splitManifest: args.splitManifest,
    provider: {
      oracleMode: resolvedOracleMode,
      baseURL: args.baseURL,
      model: args.model,
    },
    selectedSplits: {
      policy: policySelection.split,
      reflex: reflexSelection.split,
    },
    selectedFiles: {
      policy: policySelection.file,
      reflex: reflexSelection.file,
    },
    counts: {
      policyTotal: policyRows.length,
      policyEvaluated: Math.min(policyRows.length, args.policyLimit),
      reflexTotal: reflexRows.length,
      reflexEvaluated: Math.min(reflexRows.length, args.reflexLimit),
      modelRepairAttempts,
      modelFailures,
    },
    metrics: {
      validJsonRate,
      mutexViolationRate,
      reflexExactMatchRate,
      deadlockEscapeRate,
    },
    thresholds: {
      profile: args.thresholdProfile,
      maxModelAttempts: args.maxModelAttempts,
      minValidJsonRate: args.minValidJsonRate,
      minReflexExactRate: args.minReflexExactRate,
      minDeadlockEscapeRate: args.minDeadlockEscapeRate,
    },
    pass:
      validJsonRate >= args.minValidJsonRate &&
      mutexViolationRate === 0 &&
      reflexExactMatchRate >= args.minReflexExactRate &&
      deadlockEscapeRate >= args.minDeadlockEscapeRate,
  };

  const reportJsonPath = path.join(SFT_AUDIT_DIR, `guard_mcu_eval_${report.stamp}.json`);
  const reportMdPath = path.join(SFT_AUDIT_DIR, `guard_mcu_eval_${report.stamp}.md`);
  await fsp.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fsp.writeFile(reportMdPath, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');
  await fsp.writeFile(LATEST_EVAL, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');

  console.log(
    `[guard-mcu-eval] mode=${report.mode} profile=${report.thresholds.profile} oracle=${report.provider.oracleMode} valid_json_rate=${validJsonRate} mutex_rate=${mutexViolationRate} reflex_exact=${reflexExactMatchRate} deadlock_escape=${deadlockEscapeRate} repair_attempts=${modelRepairAttempts} model_failures=${modelFailures} pass=${report.pass}`
  );
  console.log(`[guard-mcu-eval] report=${reportJsonPath}`);
  process.exit(report.pass ? 0 : 2);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[guard-mcu-eval] fatal: ${message}`);
  process.exit(1);
});
