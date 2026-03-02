import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { fileURLToPath } from 'node:url';
import { FileChronos } from '../chronos/file-chronos.js';
import { HaltVerifier } from '../kernel/halt-verifier.js';
import { TuringHyperCore } from '../kernel/scheduler.js';
import { LocalManifold } from '../manifold/local-manifold.js';
import { DualBrainOracle } from '../oracle/dual-brain-oracle.js';
import { RoundRobinOracle } from '../oracle/round-robin-oracle.js';
import { UniversalOracle } from '../oracle/universal-oracle.js';

type BaselineMode = 'qwen_direct' | 'kimi_direct' | 'turingos_dualbrain';

interface CliArgs {
  modes: BaselineMode[];
  startTest: number;
  maxTests: number;
  targetTests: number;
  stopOnFirstFail: boolean;
}

interface TestCase {
  index: number;
  question: string;
  expected: string;
}

interface ModeResult {
  mode: BaselineMode;
  attempted: number;
  passed: number;
  failed: number;
  firstFailAt: number | null;
  consecutivePassBeforeFirstFail: number;
  closestToMillionDelta: number;
  status: 'PASS' | 'FAIL' | 'SKIP';
  reason?: string;
  firstFailArtifact?: string;
}

interface DualBrainSolveOptions {
  adaptiveWorkersEnabled: boolean;
  workerFanout: number;
  aheadByK: number;
}

interface DualBrainCaseMetrics {
  rootState: string;
  ticks: number;
  redFlags: number;
  mapReduceUsed: boolean;
  earlyReduceStop: boolean;
}

interface DualBrainSolveResult {
  answer: string | null;
  metrics: DualBrainCaseMetrics;
}

interface AdaptiveWorkerState {
  enabled: boolean;
  workerFanout: number;
  minWorkers: number;
  maxWorkers: number;
  temporaryWorkerCap: number | null;
  aheadByK: number;
  upshiftRiskThreshold: number;
  downshiftStableCases: number;
  stableCases: number;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = path.resolve(ROOT, 'benchmarks', 'audits', 'baseline');
const FAIL_ARTIFACT_DIR = path.resolve(OUT_DIR, 'failure_artifacts');
const BASELINE_TMP_DIR = path.resolve(ROOT, 'benchmarks', 'tmp', 'baseline_dualbrain');
const TARGET_DEFAULT = 1_000_000;

function parseArgs(argv: string[]): CliArgs {
  let modes: BaselineMode[] = ['qwen_direct', 'kimi_direct', 'turingos_dualbrain'];
  let startTest = Number.parseInt(process.env.TURINGOS_BASELINE_START_TEST ?? '1', 10);
  let maxTests = Number.parseInt(process.env.TURINGOS_BASELINE_MAX_TESTS ?? '20', 10);
  let targetTests = Number.parseInt(process.env.TURINGOS_BASELINE_TARGET_TESTS ?? String(TARGET_DEFAULT), 10);
  let stopOnFirstFail = true;

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith('--')) {
      continue;
    }
    if (key === '--modes' && value) {
      modes = value
        .split(',')
        .map((item) => item.trim())
        .filter((item): item is BaselineMode => item === 'qwen_direct' || item === 'kimi_direct' || item === 'turingos_dualbrain');
    }
    if (key === '--max-tests' && value) {
      maxTests = Number.parseInt(value, 10);
    }
    if (key === '--start-test' && value) {
      startTest = Number.parseInt(value, 10);
    }
    if (key === '--target-tests' && value) {
      targetTests = Number.parseInt(value, 10);
    }
    if (key === '--continue-after-fail') {
      stopOnFirstFail = false;
    }
  }

  return {
    modes,
    startTest: Number.isFinite(startTest) && startTest > 0 ? startTest : 1,
    maxTests: Number.isFinite(maxTests) && maxTests > 0 ? maxTests : 20,
    targetTests: Number.isFinite(targetTests) && targetTests > 0 ? targetTests : TARGET_DEFAULT,
    stopOnFirstFail,
  };
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveTemporaryWorkerCap(): number | null {
  // 2026-03-01: cap is opt-in. Default is unlocked to allow staged scale tests.
  const capEnabled = parseBoolEnv('TURINGOS_BASELINE_TEMP_WORKER_CAP_ENABLED', false);
  if (!capEnabled) {
    return null;
  }
  const raw = process.env.TURINGOS_BASELINE_TEMP_WORKER_CAP_MAX;
  if (!raw || raw.trim().length === 0) {
    return 2;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 2;
  }
  return parsed;
}

function estimateAheadByK(targetTests: number, singleWorkerPassRate: number, targetReliability: number): number {
  const s = Math.max(1, targetTests);
  const p = clamp(singleWorkerPassRate, 0.51, 0.999);
  const t = clamp(targetReliability, 0.5, 0.999999);
  const numerator = Math.log(Math.max(Number.EPSILON, Math.pow(t, -1 / s) - 1));
  const denominator = Math.log((1 - p) / p);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(numerator / denominator));
}

function initAdaptiveWorkerState(targetTests: number): AdaptiveWorkerState {
  const enabled = parseBoolEnv('TURINGOS_BASELINE_ADAPTIVE_WORKERS', true);
  const empiricalP = Number.parseFloat(process.env.TURINGOS_BASELINE_EMPIRICAL_WORKER_P ?? '0.85');
  const targetReliability = Number.parseFloat(process.env.TURINGOS_BASELINE_TARGET_RELIABILITY ?? '0.99');
  const autoAhead = estimateAheadByK(targetTests, Number.isFinite(empiricalP) ? empiricalP : 0.85, Number.isFinite(targetReliability) ? targetReliability : 0.99);
  const temporaryWorkerCap = resolveTemporaryWorkerCap();
  const aheadByK = Math.max(1, parsePositiveIntEnv('TURINGOS_BASELINE_AHEAD_BY_K', autoAhead));
  const minWorkersDefault = temporaryWorkerCap === null ? Math.max(2, aheadByK + 2) : 1;
  const requestedMinWorkers = parsePositiveIntEnv('TURINGOS_BASELINE_WORKERS_MIN', minWorkersDefault);
  const minWorkers =
    temporaryWorkerCap === null
      ? requestedMinWorkers
      : Math.max(1, Math.min(requestedMinWorkers, temporaryWorkerCap));
  const maxWorkersDefault = Math.max(requestedMinWorkers, aheadByK * 2 + 5);
  const requestedMaxWorkers = Math.max(
    minWorkers,
    parsePositiveIntEnv('TURINGOS_BASELINE_WORKERS_MAX', maxWorkersDefault)
  );
  const maxWorkers =
    temporaryWorkerCap === null
      ? requestedMaxWorkers
      : Math.max(minWorkers, Math.min(requestedMaxWorkers, temporaryWorkerCap));
  const initialWorkers = clamp(parsePositiveIntEnv('TURINGOS_BASELINE_WORKERS_INITIAL', minWorkers), minWorkers, maxWorkers);
  const defaultUpshiftRiskThreshold =
    temporaryWorkerCap !== null && temporaryWorkerCap <= 2 ? 99 : 1;
  return {
    enabled,
    workerFanout: initialWorkers,
    minWorkers,
    maxWorkers,
    temporaryWorkerCap,
    aheadByK,
    upshiftRiskThreshold: parsePositiveIntEnv(
      'TURINGOS_BASELINE_ADAPTIVE_UPSHIFT_RISK',
      defaultUpshiftRiskThreshold
    ),
    downshiftStableCases: parsePositiveIntEnv('TURINGOS_BASELINE_ADAPTIVE_DOWNSHIFT_STABLE', 10000),
    stableCases: 0,
  };
}

function makeTestCase(index: number): TestCase {
  const a = (index * 37 + 11) % 10_000;
  const b = (index * 91 + 29) % 10_000;
  const expected = String(a + b);
  const question = `Compute this exactly and return JSON only: {"answer":"<integer>"} . Expression: ${a} + ${b}`;
  return { index, question, expected };
}

function withTimeout(input: string, max = 300): string {
  return input.length > max ? `${input.slice(0, max)}...` : input;
}

function normalizeBaseURL(baseURL: string): string {
  return baseURL.replace(/\/+$/, '');
}

function extractModelIds(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null) {
    return [];
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return [];
  }
  return data
    .map((item) => (typeof item === 'object' && item !== null ? (item as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

async function preflightOpenAIEndpoint(input: {
  label: string;
  model: string;
  baseURL: string;
  apiKey: string;
  timeoutMs: number;
}): Promise<void> {
  const base = normalizeBaseURL(input.baseURL);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (input.apiKey) {
    headers.authorization = `Bearer ${input.apiKey}`;
  }
  const timeout = Math.max(5_000, input.timeoutMs);

  const modelsResp = await fetch(`${base}/models`, {
    method: 'GET',
    signal: AbortSignal.timeout(timeout),
    headers,
  });
  const modelsRaw = await modelsResp.text();
  if (!modelsResp.ok) {
    throw new Error(
      `[preflight:${input.label}] GET /models failed status=${modelsResp.status} body=${withTimeout(modelsRaw)}`
    );
  }
  let modelIds: string[] = [];
  try {
    modelIds = extractModelIds(JSON.parse(modelsRaw));
  } catch {
    // no-op: leave empty and let chat preflight provide final signal.
  }
  if (modelIds.length > 0 && !modelIds.includes(input.model)) {
    throw new Error(
      `[preflight:${input.label}] model_not_listed target=${input.model} available=${modelIds.slice(0, 16).join(',')}`
    );
  }

  const chatResp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeout),
    headers,
    body: JSON.stringify({
      model: input.model,
      temperature: 0,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Reply exactly: OK' }],
    }),
  });
  const chatRaw = await chatResp.text();
  if (!chatResp.ok) {
    throw new Error(
      `[preflight:${input.label}] POST /chat/completions failed status=${chatResp.status} body=${withTimeout(chatRaw)}`
    );
  }
}

async function preflightDualBrainOracles(): Promise<void> {
  const enabled = parseBoolEnv('TURINGOS_BASELINE_PREFLIGHT_ENABLED', true);
  if (!enabled) {
    return;
  }
  const preflightTimeoutMsRaw = Number.parseInt(process.env.TURINGOS_BASELINE_PREFLIGHT_TIMEOUT_MS ?? '60000', 10);
  const timeoutMs = Number.isFinite(preflightTimeoutMsRaw) ? Math.max(5_000, preflightTimeoutMsRaw) : 60_000;

  const plannerMode = (process.env.TURINGOS_BASELINE_PLANNER_ORACLE ?? 'kimi') as 'kimi' | 'openai';
  const plannerModel = process.env.TURINGOS_BASELINE_PLANNER_MODEL
    ?? (plannerMode === 'openai' ? 'qwen3.5:27b' : 'kimi-k2-turbo-preview');
  const plannerBaseURL = plannerMode === 'openai'
    ? (process.env.TURINGOS_BASELINE_PLANNER_BASE_URL ?? 'http://127.0.0.1:11434/v1')
    : (process.env.TURINGOS_BASELINE_KIMI_BASE_URL ?? 'https://api.kimi.com/coding/v1/messages');
  const plannerKey = plannerMode === 'kimi'
    ? (process.env.KIMI_API_KEY ?? process.env.OPENAI_API_KEY ?? '')
    : (process.env.OPENAI_API_KEY ?? 'local');

  const workerMode = (process.env.TURINGOS_BASELINE_WORKER_ORACLE ?? 'openai') as 'openai' | 'kimi';
  const workerModel = process.env.TURINGOS_BASELINE_WORKER_MODEL ?? 'qwen2.5:7b';
  const workerBaseURL = process.env.TURINGOS_BASELINE_WORKER_BASE_URL ?? 'http://127.0.0.1:11434/v1';
  const workerBaseURLsRaw = process.env.TURINGOS_BASELINE_WORKER_BASE_URLS ?? '';
  const workerBaseURLs = workerBaseURLsRaw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const workerEndpoints = workerBaseURLs.length > 0 ? workerBaseURLs : [workerBaseURL];
  const workerKey = workerMode === 'kimi'
    ? (process.env.KIMI_API_KEY ?? process.env.OPENAI_API_KEY ?? '')
    : (process.env.OPENAI_API_KEY ?? 'local');

  if (plannerMode === 'openai') {
    await preflightOpenAIEndpoint({
      label: 'planner',
      model: plannerModel,
      baseURL: plannerBaseURL,
      apiKey: plannerKey,
      timeoutMs,
    });
  }
  if (workerMode === 'openai') {
    for (let i = 0; i < workerEndpoints.length; i += 1) {
      await preflightOpenAIEndpoint({
        label: `worker#${i + 1}`,
        model: workerModel,
        baseURL: workerEndpoints[i]!,
        apiKey: workerKey,
        timeoutMs,
      });
    }
  }
}

function dualWorkspace(caseIndex: number): string {
  return path.resolve(ROOT, 'benchmarks', 'tmp', 'baseline_dualbrain', `case_${String(caseIndex).padStart(6, '0')}`);
}

function parseCaseIndexFromDirName(name: string): number | null {
  const match = name.match(/^case_(\d{6})$/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function maybeCleanupDualBrainWorkspaces(currentCaseIndex: number): void {
  const enabled = parseBoolEnv('TURINGOS_BASELINE_WORKSPACE_CLEANUP_ENABLED', true);
  if (!enabled) {
    return;
  }
  const everyN = parsePositiveIntEnv('TURINGOS_BASELINE_WORKSPACE_CLEANUP_EVERY_N', 25);
  if (currentCaseIndex % everyN !== 0) {
    return;
  }
  const keepLast = parsePositiveIntEnv('TURINGOS_BASELINE_WORKSPACE_KEEP_LAST', 300);
  const maxAgeMinutes = parsePositiveIntEnv('TURINGOS_BASELINE_WORKSPACE_MAX_AGE_MINUTES', 0);
  if (!fs.existsSync(BASELINE_TMP_DIR)) {
    return;
  }
  const entries = fs.readdirSync(BASELINE_TMP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const caseIndex = parseCaseIndexFromDirName(entry.name);
      if (caseIndex === null) {
        return null;
      }
      return {
        name: entry.name,
        caseIndex,
        fullPath: path.join(BASELINE_TMP_DIR, entry.name),
      };
    })
    .filter((item): item is { name: string; caseIndex: number; fullPath: string } => item !== null)
    .sort((a, b) => a.caseIndex - b.caseIndex);
  if (entries.length <= keepLast) {
    return;
  }

  const protectedCaseIndices = new Set<number>();
  for (const entry of entries.slice(-keepLast)) {
    protectedCaseIndices.add(entry.caseIndex);
  }
  protectedCaseIndices.add(currentCaseIndex);
  protectedCaseIndices.add(Math.max(1, currentCaseIndex - 1));

  const nowMs = Date.now();
  const maxAgeMs = maxAgeMinutes > 0 ? maxAgeMinutes * 60_000 : 0;
  let removed = 0;
  for (const entry of entries) {
    if (protectedCaseIndices.has(entry.caseIndex)) {
      continue;
    }
    if (maxAgeMs > 0) {
      const stat = fs.statSync(entry.fullPath);
      const ageMs = nowMs - stat.mtimeMs;
      if (ageMs < maxAgeMs) {
        continue;
      }
    }
    fs.rmSync(entry.fullPath, { recursive: true, force: true });
    removed += 1;
  }
  if (removed > 0) {
    console.log(
      `[million-baseline] workspace_cleanup removed=${removed} keep_last=${keepLast} max_age_min=${maxAgeMinutes}`
    );
  }
}

function readTail(filePath: string, maxChars = 12_000): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  if (raw.length <= maxChars) {
    return raw;
  }
  return raw.slice(raw.length - maxChars);
}

function parseAnswer(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const answer = parsed.answer;
    if (typeof answer === 'number' && Number.isFinite(answer)) {
      return String(Math.trunc(answer));
    }
    if (typeof answer === 'string' && answer.trim().length > 0) {
      return answer.trim();
    }
  } catch {
    // fallback below
  }
  const nums = trimmed.match(/-?\d+/g);
  if (!nums || nums.length === 0) {
    return null;
  }
  return nums[nums.length - 1];
}

function countToken(text: string, needle: string): number {
  const match = text.match(new RegExp(needle, 'g'));
  return match ? match.length : 0;
}

function readDualBrainCaseMetrics(workspace: string, rootState: string, ticks: number): DualBrainCaseMetrics {
  const journalPath = path.join(workspace, '.journal.log');
  const journal = readTail(journalPath, 100_000) ?? '';
  return {
    rootState,
    ticks,
    redFlags: countToken(journal, '\\[HYPERCORE_RED_FLAG\\]'),
    mapReduceUsed: journal.includes('[HYPERCORE_MAP]'),
    earlyReduceStop: journal.includes('[HYPERCORE_REDUCE]') && journal.includes('early_stop=1'),
  };
}

function updateAdaptiveWorkerState(
  state: AdaptiveWorkerState,
  ok: boolean,
  metrics: DualBrainCaseMetrics,
  options: DualBrainSolveOptions
): void {
  if (!state.enabled || !options.adaptiveWorkersEnabled) {
    return;
  }
  const tickBudgetSoft = parsePositiveIntEnv('TURINGOS_BASELINE_ADAPTIVE_TICK_SOFT', 6);
  let risk = 0;
  if (!ok || metrics.rootState !== 'TERMINATED') {
    risk += 2;
  }
  if (metrics.redFlags > 0) {
    risk += 1;
  }
  if (metrics.ticks >= tickBudgetSoft) {
    risk += 1;
  }
  if (state.workerFanout > 1 && !metrics.mapReduceUsed) {
    risk += 1;
  }

  if (risk >= state.upshiftRiskThreshold) {
    state.workerFanout = Math.min(state.maxWorkers, state.workerFanout + 1);
    state.stableCases = 0;
    return;
  }
  if (risk === 0) {
    state.stableCases += 1;
    if (state.stableCases >= state.downshiftStableCases) {
      state.workerFanout = Math.max(state.minWorkers, state.workerFanout - 1);
      state.stableCases = 0;
    }
    return;
  }
  state.stableCases = 0;
}

async function solveQwenDirect(testCase: TestCase): Promise<string | null> {
  const baseURL = process.env.TURINGOS_BASELINE_QWEN_BASE_URL ?? 'http://127.0.0.1:11434/v1';
  const apiKey = process.env.TURINGOS_BASELINE_QWEN_API_KEY ?? 'local';
  const model = process.env.TURINGOS_BASELINE_QWEN_MODEL ?? 'qwen3.5:27b';
  const client = new OpenAI({ apiKey, baseURL, timeout: 30_000 });
  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: 'Return strict JSON only: {"answer":"..."}' },
      { role: 'user', content: testCase.question },
    ],
  });
  const text = response.choices[0]?.message?.content ?? '';
  return parseAnswer(text);
}

async function solveKimiDirect(testCase: TestCase): Promise<string | null> {
  const apiKey = process.env.KIMI_API_KEY ?? process.env.TURINGOS_BASELINE_KIMI_API_KEY;
  if (!apiKey) {
    throw new Error('KIMI_API_KEY missing');
  }
  const model = process.env.TURINGOS_BASELINE_KIMI_MODEL ?? 'kimi-k2-turbo-preview';
  const baseURL = process.env.TURINGOS_BASELINE_KIMI_BASE_URL ?? 'https://api.kimi.com/coding/v1/messages';
  const response = await fetch(baseURL, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      temperature: 0,
      system: 'Return strict JSON only: {"answer":"..."}',
      messages: [{ role: 'user', content: testCase.question }],
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Kimi ${response.status}: ${raw.slice(0, 400)}`);
  }
  const parsed = JSON.parse(raw) as { content?: Array<{ type?: string; text?: string }> };
  const text = (parsed.content ?? [])
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text!.trim())
    .join('\n');
  return parseAnswer(text);
}

async function solveTuringOSDualBrain(
  testCase: TestCase,
  options: DualBrainSolveOptions
): Promise<DualBrainSolveResult> {
  const oracleRetries = Number.parseInt(process.env.TURINGOS_BASELINE_ORACLE_MAX_RETRIES ?? '1', 10);
  const oracleTimeoutMs = Number.parseInt(process.env.TURINGOS_BASELINE_ORACLE_TIMEOUT_MS ?? '15000', 10);
  const dualMaxTicks = Number.parseInt(process.env.TURINGOS_BASELINE_DUAL_MAX_TICKS ?? '12', 10);
  const plannerMode = (process.env.TURINGOS_BASELINE_PLANNER_ORACLE ?? 'kimi') as 'kimi' | 'openai';
  const plannerModel = process.env.TURINGOS_BASELINE_PLANNER_MODEL
    ?? (plannerMode === 'openai' ? 'qwen3.5:27b' : 'kimi-k2-turbo-preview');
  const workerMode = (process.env.TURINGOS_BASELINE_WORKER_ORACLE ?? 'openai') as 'openai' | 'kimi';
  const workerModel = process.env.TURINGOS_BASELINE_WORKER_MODEL ?? 'qwen2.5:7b';
  const workerBaseURL = process.env.TURINGOS_BASELINE_WORKER_BASE_URL ?? 'http://127.0.0.1:11434/v1';
  const workerBaseURLsRaw = process.env.TURINGOS_BASELINE_WORKER_BASE_URLS ?? '';
  const workerBaseURLs = workerBaseURLsRaw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const workerEndpoints = workerMode === 'openai'
    ? (workerBaseURLs.length > 0 ? workerBaseURLs : [workerBaseURL])
    : [process.env.TURINGOS_BASELINE_KIMI_BASE_URL ?? 'https://api.kimi.com/coding/v1/messages'];
  const workerFanout = Math.max(1, options.workerFanout);
  const workerParallelism = parsePositiveIntEnv('TURINGOS_BASELINE_WORKER_PARALLELISM', workerFanout);
  const workspace = dualWorkspace(testCase.index);
  const initialPointer = process.env.TURINGOS_BASELINE_DUAL_INITIAL_POINTER ?? 'MAIN_TAPE.md';
  process.env.TURINGOS_STRICT_SINGLE_JSON_FRAME ??= '1';
  process.env.TURINGOS_ORACLE_REPAIR_ALL ??= '1';
  process.env.TURINGOS_OLLAMA_REPAIR_ENABLED ??= '1';
  process.env.TURINGOS_OLLAMA_REPAIR_MAX_ATTEMPTS ??= '2';
  process.env.TURINGOS_FORCE_WRITE_FALLBACK ??= '1';
  process.env.TURINGOS_HYPERCORE_PLANNER_TEMPERATURE ??= '0.2';
  process.env.TURINGOS_HYPERCORE_WORKER_TEMPERATURE ??= '0.0';
  process.env.TURINGOS_HYPERCORE_AHEAD_BY_K = String(Math.max(1, options.aheadByK));
  process.env.TURINGOS_HYPERCORE_REDUCE_MIN_VOTES = String(
    Math.max(2, Math.min(workerFanout, Math.max(1, options.aheadByK) + 1))
  );
  process.env.TURINGOS_HYPERCORE_FILTER_FAILED_WORKERS = '1';
  process.env.TURINGOS_HYPERCORE_PLANNER_MAP_REDUCE_DROP_WORLD_OP = '1';
  process.env.TURINGOS_HYPERCORE_SINGLE_MAP_PER_PROCESS = '1';
  process.env.TURINGOS_HYPERCORE_AUTO_WRITE_CONSENSUS_ON_MAP_DROP ??= '1';
  process.env.TURINGOS_HYPERCORE_WORKER_MAP_REDUCE_POLICY = 'drop';
  process.env.TURINGOS_HYPERCORE_WORKER_PARALLELISM = String(Math.max(1, workerParallelism));
  process.env.TURINGOS_HYPERCORE_STRICT_INTEGER_WRITE_FILES ??= 'ANSWER.txt';
  process.env.TURINGOS_HYPERCORE_STRICT_INTEGER_WRITE_COERCE ??= '0';
  process.env.TURINGOS_HYPERCORE_STRICT_INTEGER_WRITE_EXTRACT_LAST_INT ??= '1';
  if (workerFanout > 1) {
    process.env.TURINGOS_HYPERCORE_FORCE_MAP_TASK_COUNT = String(workerFanout);
  } else {
    delete process.env.TURINGOS_HYPERCORE_FORCE_MAP_TASK_COUNT;
  }

  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(
    path.join(workspace, 'MAIN_TAPE.md'),
    [
      '# Baseline Test',
      `Question: ${testCase.question}`,
      'Write only the final integer answer into ANSWER.txt, then HALT.',
      'ANSWER.txt must contain digits only (no prose, no labels, no JSON).',
    ].join('\n'),
    'utf8'
  );

  const verifyScriptName = '.turingos_verify_answer.sh';
  const verifyScriptPath = path.join(workspace, verifyScriptName);
  fs.writeFileSync(
    verifyScriptPath,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      "if [ ! -f ANSWER.txt ]; then echo MISSING_ANSWER_FILE; exit 1; fi",
      "val=$(tr -d '\\r\\n\\t ' < ANSWER.txt)",
      "if [[ ! \"$val\" =~ ^-?[0-9]+$ ]]; then echo INVALID_ANSWER_FORMAT:$val; exit 1; fi",
      `if [ "$val" != '${testCase.expected}' ]; then echo MISMATCH_EXPECTED_${testCase.expected}_GOT_$val; exit 1; fi`,
    ].join('\n') + '\n',
    'utf8'
  );
  fs.chmodSync(verifyScriptPath, 0o755);

  process.env.TURINGOS_HALT_STANDARD_LOCK_FILE = path.join(workspace, '.halt-standard.lock.json');
  process.env.TURINGOS_HALT_VERIFY_CMD = `bash ${verifyScriptName}`;
  const locked = HaltVerifier.resolveLockedCommand(workspace);
  const verifier = new HaltVerifier({
    workspaceDir: workspace,
    command: locked,
    timeoutMs: 30_000,
  });

  const plannerKey = plannerMode === 'kimi'
    ? (process.env.KIMI_API_KEY ?? process.env.OPENAI_API_KEY ?? '')
    : (process.env.OPENAI_API_KEY ?? '');
  const workerKey = workerMode === 'kimi'
    ? (process.env.KIMI_API_KEY ?? process.env.OPENAI_API_KEY ?? '')
    : (process.env.OPENAI_API_KEY ?? 'local');

  if (!plannerKey) {
    throw new Error('Planner API key missing');
  }

  const plannerOracle = new UniversalOracle(plannerMode, {
    apiKey: plannerKey,
    model: plannerModel,
    baseURL: plannerMode === 'openai' ? process.env.TURINGOS_BASELINE_PLANNER_BASE_URL : process.env.TURINGOS_BASELINE_KIMI_BASE_URL,
    maxOutputTokens: 512,
    maxRetries: Number.isFinite(oracleRetries) ? Math.max(0, oracleRetries) : 1,
    requestTimeoutMs: Number.isFinite(oracleTimeoutMs) ? Math.max(1000, oracleTimeoutMs) : 15000,
  });
  const workerOracles = workerEndpoints.map((endpoint) =>
    new UniversalOracle(workerMode, {
      apiKey: workerKey || 'local',
      model: workerModel,
      baseURL: endpoint,
      maxOutputTokens: 512,
      maxRetries: Number.isFinite(oracleRetries) ? Math.max(0, oracleRetries) : 1,
      requestTimeoutMs: Number.isFinite(oracleTimeoutMs) ? Math.max(1000, oracleTimeoutMs) : 15000,
    })
  );
  const workerOracle = workerOracles.length === 1
    ? workerOracles[0]
    : new RoundRobinOracle(workerOracles);

  const dualOracle = new DualBrainOracle({
    plannerOracle,
    workerOracle,
    plannerLabel: `P:${plannerMode}:${plannerModel}`,
    workerLabel: `E:${workerMode}:${workerModel}:pool=${workerOracles.length}`,
  });
  const manifold = new LocalManifold(workspace, { timeoutMs: 30_000 });
  const chronos = new FileChronos(path.join(workspace, '.journal.log'));
  const ensembleHint = workerFanout > 1
    ? [
        `[ADAPTIVE_WORKERS] enabled fanout=${workerFanout} ahead_by_k=${Math.max(1, options.aheadByK)}`,
        'Use SYS_MAP_REDUCE to spawn independent workers for the same arithmetic expression.',
        'Only PLANNER may emit SYS_MAP_REDUCE. WORKER must never emit SYS_MAP_REDUCE.',
        'Each worker must finish with q_next containing a single line: RESULT:<integer> and then SYS_HALT.',
        'After [MAP_REDUCE_JOIN], trust consensus=<integer> from scheduler, then write consensus into ANSWER.txt.',
        'If consensus is [NO_VALID_VOTE], fallback immediately to direct deterministic solve and continue.',
      ]
    : ['[ADAPTIVE_WORKERS] disabled_or_single_worker fanout=1'];
  const baselineDisciplinePrompt = [
    '[BASELINE_MODE]',
    'You are running an arithmetic micro-benchmark.',
    ...(workerFanout > 1
      ? ['Avoid repository archaeology and long planning loops; use map-reduce fanout for redundancy.']
      : ['Do NOT perform repository archaeology, map-reduce fanout, or long planning loops.']),
    'Target policy:',
    '1) Read expression from MAIN_TAPE.md exactly once.',
    ...(workerFanout > 1
      ? [
          `2) Emit SYS_MAP_REDUCE with ${workerFanout} tasks for independent solves.`,
          '3) Wait for [MAP_REDUCE_JOIN] consensus result.',
          '4) SYS_WRITE consensus result to ANSWER.txt (prefer semantic_cap=ANSWER.txt).',
          '5) Verify in a later tick.',
          '6) Emit SYS_HALT only in a dedicated tick.',
        ]
      : [
          '2) Compute integer result deterministically.',
          '3) SYS_WRITE result to ANSWER.txt (prefer semantic_cap=ANSWER.txt).',
          '4) Verify in a later tick.',
          '5) Emit SYS_HALT only in a dedicated tick.',
        ]),
    '6) ANSWER.txt content must be a bare integer string only; never include words.',
    'Hard constraint: avoid repeated SYS_GOTO/SYS_GIT_LOG without physical progress.',
    'Hard constraint: NEVER emit SYS_WRITE and SYS_HALT in the same frame.',
    ...ensembleHint,
  ].join('\n');
  const scheduler = new TuringHyperCore({
    manifold,
    chronos,
    oracle: dualOracle,
    verifier,
    disciplinePrompt: baselineDisciplinePrompt,
  });
  const rootPid = scheduler.spawnRoot(
    [
      `q_0: Solve baseline test ${testCase.index}.`,
      ...(workerFanout > 1
        ? [
            '1) Read MAIN_TAPE.md.',
            `2) Mandatory: first actionable plan must emit SYS_MAP_REDUCE with exactly ${workerFanout} tasks.`,
            '3) Each worker task solves same expression independently; worker must never emit SYS_MAP_REDUCE.',
            '4) Worker final q line must be RESULT:<integer> before HALT.',
            '5) Wait for [MAP_REDUCE_JOIN] and extract consensus=<integer>.',
            '6) If consensus=[NO_VALID_VOTE], fallback to direct deterministic solve, then continue.',
            '7) Write consensus/fallback result with newline to ANSWER.txt (use SYS_WRITE semantic_cap=ANSWER.txt).',
            '8) Next tick verify ANSWER.txt.',
            '9) Final tick emit SYS_HALT alone.',
          ]
        : [
            '1) Read MAIN_TAPE.md.',
            '2) Compute exact integer answer.',
            '3) Write answer with newline to ANSWER.txt (use SYS_WRITE semantic_cap=ANSWER.txt).',
            '4) Next tick: verify ANSWER.txt and continue.',
            '5) Final tick: emit SYS_HALT alone.',
          ]),
      'ANSWER.txt must contain only integer digits and optional newline.',
      'Never combine SYS_WRITE and SYS_HALT in one frame.',
    ].join('\n'),
    initialPointer
  );
  const baseTicks = Number.isFinite(dualMaxTicks) && dualMaxTicks > 0 ? dualMaxTicks : 12;
  const fanoutTickOverhead = parsePositiveIntEnv('TURINGOS_BASELINE_FANOUT_TICK_OVERHEAD', 24);
  const fanoutTickPerWorker = parsePositiveIntEnv('TURINGOS_BASELINE_FANOUT_TICKS_PER_WORKER', 4);
  const effectiveMaxTicks = workerFanout > 1
    ? Math.max(baseTicks, fanoutTickOverhead + workerFanout * fanoutTickPerWorker)
    : baseTicks;
  const runResult = await scheduler.run(rootPid, {
    maxTicks: effectiveMaxTicks,
  });
  const runStatePath = path.join(workspace, '.run_state.json');
  fs.writeFileSync(
    runStatePath,
    `${JSON.stringify(
      {
        rootPid: runResult.rootPid,
        rootState: runResult.rootState,
        ticks: runResult.ticks,
        q: runResult.q,
        d: runResult.d,
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  const metrics = readDualBrainCaseMetrics(workspace, runResult.rootState, runResult.ticks);
  if (runResult.rootState !== 'TERMINATED') {
    return { answer: null, metrics };
  }

  const answerPath = path.join(workspace, 'ANSWER.txt');
  if (!fs.existsSync(answerPath)) {
    return { answer: null, metrics };
  }
  const raw = fs.readFileSync(answerPath, 'utf8');
  return { answer: parseAnswer(raw), metrics };
}

function writeFailureArtifact(input: {
  mode: BaselineMode;
  testCase: TestCase;
  observed: string | null;
  reason: string;
  errorStack?: string;
  attempted: number;
  passed: number;
  failed: number;
}): string {
  const stamp = stampNow();
  const artifactPath = path.join(
    FAIL_ARTIFACT_DIR,
    `${input.mode}_case_${String(input.testCase.index).padStart(6, '0')}_${stamp}.json`
  );
  const base: Record<string, unknown> = {
    stamp,
    mode: input.mode,
    testCase: input.testCase,
    observed: input.observed,
    reason: input.reason,
    attempted: input.attempted,
    passed: input.passed,
    failed: input.failed,
    firstFailAt: input.testCase.index,
  };
  if (input.errorStack) {
    base.errorStack = input.errorStack;
  }

  if (input.mode === 'turingos_dualbrain') {
    const workspace = dualWorkspace(input.testCase.index);
    const journalPath = path.join(workspace, '.journal.log');
    const callstackPath = path.join(workspace, '.callstack.json');
    const answerPath = path.join(workspace, 'ANSWER.txt');
    base.workspace = workspace;
    base.workspaceExists = fs.existsSync(workspace);
    base.answerFile = fs.existsSync(answerPath) ? fs.readFileSync(answerPath, 'utf8') : null;
    base.journalTail = readTail(journalPath, 20_000);
    base.callstack = fs.existsSync(callstackPath)
      ? JSON.parse(fs.readFileSync(callstackPath, 'utf8'))
      : null;
  }

  writeJson(artifactPath, base);
  return artifactPath;
}

async function runMode(mode: BaselineMode, args: CliArgs): Promise<ModeResult> {
  if (mode === 'qwen_direct' && !process.env.TURINGOS_BASELINE_QWEN_BASE_URL && !process.env.OPENAI_API_KEY) {
    // local ollama default path still works without key; keep running
  }

  let attempted = 0;
  let passed = 0;
  let failed = 0;
  let firstFailAt: number | null = null;
  let reason = '';
  let firstFailArtifact: string | undefined;
  const adaptiveState = mode === 'turingos_dualbrain' ? initAdaptiveWorkerState(args.targetTests) : null;
  const fixedWorkerFanout =
    mode === 'turingos_dualbrain'
      ? parsePositiveIntEnv('TURINGOS_BASELINE_WORKER_FANOUT_FIXED', 0)
      : 0;
  if (mode === 'turingos_dualbrain' && adaptiveState) {
    const workerParallelism = parsePositiveIntEnv(
      'TURINGOS_BASELINE_WORKER_PARALLELISM',
      adaptiveState.workerFanout
    );
    const workerBaseURL = process.env.TURINGOS_BASELINE_WORKER_BASE_URL ?? 'http://127.0.0.1:11434/v1';
    const workerBaseURLs = (process.env.TURINGOS_BASELINE_WORKER_BASE_URLS ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const workerEndpoints = workerBaseURLs.length > 0 ? workerBaseURLs : [workerBaseURL];
    console.log(
      `[million-baseline] adaptive_workers enabled=${adaptiveState.enabled} initial=${adaptiveState.workerFanout} min=${adaptiveState.minWorkers} max=${adaptiveState.maxWorkers} ahead_by_k=${adaptiveState.aheadByK} temporary_cap=${adaptiveState.temporaryWorkerCap ?? 'none'}`
    );
    const fanoutMode =
      fixedWorkerFanout > 0
        ? `fixed:${fixedWorkerFanout}`
        : adaptiveState.enabled
          ? `adaptive:${adaptiveState.workerFanout}`
          : 'single:1';
    console.log(`[million-baseline] worker_fanout mode=${fanoutMode}`);
    console.log(
      `[million-baseline] worker_parallelism=${workerParallelism} worker_endpoints=${workerEndpoints.length} endpoints=${workerEndpoints.join(',')}`
    );
    await preflightDualBrainOracles();
    console.log('[million-baseline] preflight=ok planner_worker_endpoints_ready');
  }

  if (args.startTest > args.maxTests) {
    return {
      mode,
      attempted: 0,
      passed: 0,
      failed: 0,
      firstFailAt: null,
      consecutivePassBeforeFirstFail: 0,
      closestToMillionDelta: args.targetTests,
      status: 'SKIP',
      reason: `invalid range: start_test=${args.startTest} > max_tests=${args.maxTests}`,
    };
  }

  for (let i = args.startTest; i <= args.maxTests; i += 1) {
    attempted += 1;
    const testCase = makeTestCase(i);
    if (mode === 'turingos_dualbrain') {
      maybeCleanupDualBrainWorkspaces(i);
    }
    try {
      let answer: string | null = null;
      let dualMetrics: DualBrainCaseMetrics | null = null;
      if (mode === 'qwen_direct') {
        answer = await solveQwenDirect(testCase);
      } else if (mode === 'kimi_direct') {
        answer = await solveKimiDirect(testCase);
      } else {
        const forceFixedFanout = fixedWorkerFanout > 0;
        const effectiveWorkerFanout = forceFixedFanout
          ? fixedWorkerFanout
          : adaptiveState?.enabled
            ? adaptiveState.workerFanout
            : 1;
        const solveOptions: DualBrainSolveOptions = {
          adaptiveWorkersEnabled: Boolean(adaptiveState?.enabled) && !forceFixedFanout,
          workerFanout: Math.max(1, effectiveWorkerFanout),
          aheadByK: adaptiveState?.aheadByK ?? 1,
        };
        const solved = await solveTuringOSDualBrain(testCase, solveOptions);
        answer = solved.answer;
        dualMetrics = solved.metrics;
      }
      const ok = answer === testCase.expected;
      if (mode === 'turingos_dualbrain' && adaptiveState && dualMetrics && fixedWorkerFanout <= 0) {
        updateAdaptiveWorkerState(adaptiveState, ok, dualMetrics, {
          adaptiveWorkersEnabled: adaptiveState.enabled,
          workerFanout: adaptiveState.workerFanout,
          aheadByK: adaptiveState.aheadByK,
        });
      }
      if (ok) {
        passed += 1;
      } else {
        failed += 1;
        if (firstFailAt === null) {
          firstFailAt = i;
          reason = `mismatch expected=${testCase.expected} got=${answer ?? '(null)'}`;
          firstFailArtifact = writeFailureArtifact({
            mode,
            testCase,
            observed: answer,
            reason,
            attempted,
            passed,
            failed,
          });
        }
        if (args.stopOnFirstFail) {
          break;
        }
      }
    } catch (error: unknown) {
      failed += 1;
      if (firstFailAt === null) {
        firstFailAt = i;
      }
      reason = error instanceof Error ? error.message : String(error);
      if (!firstFailArtifact) {
        firstFailArtifact = writeFailureArtifact({
          mode,
          testCase,
          observed: null,
          reason,
          errorStack: error instanceof Error ? error.stack : undefined,
          attempted,
          passed,
          failed,
        });
      }
      if (args.stopOnFirstFail) {
        break;
      }
    } finally {
      if (mode === 'turingos_dualbrain' && parseBoolEnv('TURINGOS_BASELINE_EPHEMERAL_WORKSPACE', true)) {
        const workspace = dualWorkspace(testCase.index);
        try {
          fs.rmSync(workspace, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors to ensure the next benchmark iteration proceeds
        }
      }
    }
  }

  const consecutive = firstFailAt === null ? passed : Math.max(0, firstFailAt - args.startTest);
  const normalizedReason = reason.toLowerCase();
  const isInfraSkip =
    normalizedReason.includes('missing') ||
    normalizedReason.includes('connection error') ||
    normalizedReason.includes('econnrefused');
  return {
    mode,
    attempted,
    passed,
    failed,
    firstFailAt,
    consecutivePassBeforeFirstFail: consecutive,
    closestToMillionDelta: Math.max(0, args.targetTests - consecutive),
    status: failed === 0 ? 'PASS' : isInfraSkip ? 'SKIP' : 'FAIL',
    ...(reason ? { reason } : {}),
    ...(firstFailArtifact ? { firstFailArtifact } : {}),
  };
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function stampNow(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const results: ModeResult[] = [];
  for (const mode of args.modes) {
    const result = await runMode(mode, args);
    results.push(result);
  }
  const ranking = [...results].sort(
    (a, b) => b.consecutivePassBeforeFirstFail - a.consecutivePassBeforeFirstFail
  );

  const stamp = stampNow();
  const report = {
    stamp,
    startTest: args.startTest,
    targetTests: args.targetTests,
    maxTests: args.maxTests,
    stopOnFirstFail: args.stopOnFirstFail,
    results,
    ranking,
    bestMode: ranking[0]?.mode ?? null,
  };

  const stamped = path.join(OUT_DIR, `million_baseline_compare_${stamp}.json`);
  const latest = path.join(OUT_DIR, 'million_baseline_compare_latest.json');
  writeJson(stamped, report);
  writeJson(latest, report);

  console.log(
    `[million-baseline] start_test=${args.startTest} target_tests=${args.targetTests} max_tests=${args.maxTests}`
  );
  for (const row of ranking) {
    console.log(
      `[million-baseline] mode=${row.mode} consecutive=${row.consecutivePassBeforeFirstFail} delta_to_1m=${row.closestToMillionDelta} status=${row.status}`
    );
  }
  console.log(`[million-baseline] report=${stamped}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[million-baseline] FAIL ${message}`);
  process.exitCode = 1;
});
