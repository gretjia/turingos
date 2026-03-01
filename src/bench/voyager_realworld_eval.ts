import 'dotenv/config';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { FileChronos } from '../chronos/file-chronos.js';
import { TuringEngine } from '../kernel/engine.js';
import { LocalManifold } from '../manifold/local-manifold.js';
import { UniversalOracle } from '../oracle/universal-oracle.js';

type VoyagerOracleMode = 'openai' | 'kimi';

interface ReplayTuple {
  tick_seq?: number;
  q_t?: string;
  d_t?: string;
  s_t?: string;
  a_t?: { op?: string };
  mind_ops?: Array<{ op?: string }>;
  world_op?: { op?: string } | null;
}

interface Check {
  id: string;
  pass: boolean;
  details: string;
}

interface EvalReport {
  stamp: string;
  workspace: string;
  scenario: {
    type: 'real_repo';
    repoUrl: string;
    repoRef: string;
    repoIssueUrl: string;
    repoDir: string;
    repoCommit: string;
    entryPointer: string;
  };
  oracle: {
    mode: VoyagerOracleMode;
    model: string;
    baseURL: string;
    maxOutputTokens: number;
    maxRetries: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
    requestTimeoutMs: number;
  };
  chaos: {
    execTimeoutRate: number;
    writeDenyRate: number;
    logFloodRate: number;
    logFloodChars: number;
  };
  traceJsonlPath: string;
  traceJsonlLatestPath: string;
  dirtyTraceJsonlPath: string;
  dirtyTraceJsonlLatestPath: string;
  ticksRequested: number;
  ticksObserved: number;
  replayTuples: number;
  contextStats: {
    min: number;
    max: number;
    avg: number;
    p95: number;
  };
  vliwEvidence: {
    found: boolean;
    tickSeq: number | null;
    details: string;
  };
  chaosEvidence: {
    pagedFloodDetected: boolean;
    tickSeq: number | null;
    followupAction: string;
  };
  checks: Check[];
  pass: boolean;
}

interface RuntimeConfig {
  oracleMode: VoyagerOracleMode;
  model: string;
  baseURL: string;
  apiKey: string;
  realRepoUrl: string;
  realRepoRef: string;
  realRepoIssueUrl: string;
  realRepoDirName: string;
  maxOutputTokens: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  requestTimeoutMs: number;
  ticksRequested: number;
  chaosExecTimeoutRate: number;
  chaosWriteDenyRate: number;
  chaosLogFloodRate: number;
  chaosLogFloodChars: number;
}

interface RealRepoWorkspace {
  entryPointer: string;
  repoDir: string;
  repoCommit: string;
}

const ROOT = path.resolve(process.cwd());
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'longrun');
const execFileAsync = promisify(execFile);

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

function parseReplayTuples(journalRaw: string): ReplayTuple[] {
  const tuples: ReplayTuple[] = [];
  const lines = journalRaw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    const match = line.match(/\[REPLAY_TUPLE\]\s*(\{.*\})$/);
    if (!match?.[1]) {
      continue;
    }
    try {
      tuples.push(JSON.parse(match[1]) as ReplayTuple);
    } catch {
      continue;
    }
  }
  return tuples;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}

function sanitizeRepoDirName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return 'target_repo';
  }
  return trimmed
    .replace(/\.git$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'target_repo';
}

async function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 32 * 1024 * 1024,
      encoding: 'utf-8',
    });
    return { stdout, stderr };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${message}`);
  }
}

async function prepareRealRepoWorkspace(workspace: string, config: RuntimeConfig): Promise<RealRepoWorkspace> {
  const repoDir = path.join(workspace, config.realRepoDirName);
  await runGit(['clone', '--depth', '1', config.realRepoUrl, config.realRepoDirName], workspace);

  const ref = config.realRepoRef.trim();
  if (ref.length > 0 && ref !== 'HEAD') {
    try {
      await runGit(['fetch', '--depth', '1', 'origin', ref], repoDir);
      await runGit(['checkout', '--detach', 'FETCH_HEAD'], repoDir);
    } catch {
      await runGit(['checkout', '--detach', ref], repoDir);
    }
  }

  const repoCommit = (await runGit(['rev-parse', 'HEAD'], repoDir)).stdout.trim();
  const issueUrl =
    config.realRepoIssueUrl.trim().length > 0 ? config.realRepoIssueUrl.trim() : `${config.realRepoUrl.replace(/\.git$/i, '')}/issues`;

  const entryPointer = 'VOYAGER_TASK.md';
  await fs.writeFile(
    path.join(workspace, entryPointer),
    [
      '# Voyager Real Repo Task',
      '',
      `- Repo URL: ${config.realRepoUrl}`,
      `- Repo Ref: ${config.realRepoRef}`,
      `- Repo Commit: ${repoCommit}`,
      `- Repo Path: ${config.realRepoDirName}`,
      `- Issue URL: ${issueUrl}`,
      '',
      'Execution Objectives:',
      '1. Read repository files and issue context from real source tree.',
      '2. Reproduce, diagnose, and patch candidate bug paths under chaos.',
      '3. Produce verifiable physical actions (SYS_EXEC/SYS_WRITE), not synthetic shortcuts.',
      '',
      'Constraints:',
      '- No synthetic project generation.',
      '- Use paged navigation for large outputs (SYS_GOTO to sys://page/*).',
      '- Keep VLIW nQ+1A discipline.',
      '',
    ].join('\n'),
    'utf-8'
  );

  return {
    entryPointer,
    repoDir: config.realRepoDirName,
    repoCommit,
  };
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
  const rawMode = process.env.VOYAGER_ORACLE ?? process.env.TURINGOS_ORACLE ?? 'kimi';
  const oracleMode = parseOracleMode(rawMode);
  if (!oracleMode) {
    if (rawMode.trim().toLowerCase() === 'mock') {
      throw new Error('VOYAGER_ORACLE=mock is forbidden for realworld eval. Use openai|kimi with a real model.');
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

  const realRepoUrl = (process.env.VOYAGER_REAL_REPO_URL ?? 'https://github.com/sindresorhus/ky.git').trim();
  if (realRepoUrl.length === 0) {
    throw new Error('VOYAGER_REAL_REPO_URL is empty. Realworld eval requires a real git repository.');
  }
  const realRepoRef = (process.env.VOYAGER_REAL_REPO_REF ?? 'main').trim() || 'main';
  const realRepoIssueUrl = (process.env.VOYAGER_REAL_ISSUE_URL ?? '').trim();
  const repoDirFromUrl = (() => {
    try {
      const parsed = new URL(realRepoUrl);
      const leaf = parsed.pathname.split('/').filter((part) => part.length > 0).at(-1) ?? '';
      return sanitizeRepoDirName(leaf);
    } catch {
      const leaf = realRepoUrl.split('/').filter((part) => part.length > 0).at(-1) ?? '';
      return sanitizeRepoDirName(leaf);
    }
  })();
  const realRepoDirName = sanitizeRepoDirName(process.env.VOYAGER_REAL_REPO_DIR ?? repoDirFromUrl);

  const maxOutputTokens = parseInteger(
    process.env.VOYAGER_MAX_OUTPUT_TOKENS ?? process.env.TURINGOS_MAX_OUTPUT_TOKENS,
    1024
  );
  const maxRetries = parseInteger(process.env.VOYAGER_ORACLE_MAX_RETRIES, 1);
  const retryBaseDelayMs = parseInteger(process.env.VOYAGER_ORACLE_RETRY_BASE_DELAY_MS, 500);
  const retryMaxDelayMs = parseInteger(process.env.VOYAGER_ORACLE_RETRY_MAX_DELAY_MS, 2_000);
  const requestTimeoutMs = parseInteger(process.env.VOYAGER_ORACLE_REQUEST_TIMEOUT_MS, 15_000);
  const ticksRequested = parseInteger(process.env.VOYAGER_TICKS, 120);

  const chaosExecTimeoutRate = parseRate(
    process.env.VOYAGER_CHAOS_EXEC_TIMEOUT_RATE ?? process.env.CHAOS_EXEC_TIMEOUT_RATE,
    0.1
  );
  const chaosWriteDenyRate = parseRate(
    process.env.VOYAGER_CHAOS_WRITE_DENY_RATE ?? process.env.CHAOS_WRITE_DENY_RATE,
    0.05
  );
  const chaosLogFloodRate = parseRate(
    process.env.VOYAGER_CHAOS_LOG_FLOOD_RATE ?? process.env.CHAOS_LOG_FLOOD_RATE,
    0.1
  );
  const chaosLogFloodChars = parseInteger(
    process.env.VOYAGER_CHAOS_LOG_FLOOD_CHARS ?? process.env.CHAOS_LOG_FLOOD_CHARS,
    50_000
  );

  return {
    oracleMode,
    model,
    baseURL,
    apiKey,
    realRepoUrl,
    realRepoRef,
    realRepoIssueUrl,
    realRepoDirName,
    maxOutputTokens,
    maxRetries,
    retryBaseDelayMs,
    retryMaxDelayMs,
    requestTimeoutMs,
    ticksRequested,
    chaosExecTimeoutRate,
    chaosWriteDenyRate,
    chaosLogFloodRate,
    chaosLogFloodChars,
  };
}

async function loadDisciplinePrompt(): Promise<string> {
  const promptPath = path.join(ROOT, 'turing_prompt.sh');
  try {
    const raw = await fs.readFile(promptPath, 'utf-8');
    return raw.trim().length > 0
      ? raw
      : 'Output strict JSON with q_next and VLIW fields mind_ops/world_op using SYS_* opcodes only.';
  } catch {
    return 'Output strict JSON with q_next and VLIW fields mind_ops/world_op using SYS_* opcodes only.';
  }
}

function toMarkdown(report: EvalReport, jsonPath: string): string {
  return [
    '# Voyager Realworld Eval',
    '',
    `- stamp: ${report.stamp}`,
    `- workspace: ${report.workspace}`,
    `- pass: ${report.pass}`,
    `- report_json: ${jsonPath}`,
    `- trace_jsonl: ${report.traceJsonlPath}`,
    `- trace_jsonl_latest: ${report.traceJsonlLatestPath}`,
    `- dirty_trace_jsonl: ${report.dirtyTraceJsonlPath}`,
    `- dirty_trace_jsonl_latest: ${report.dirtyTraceJsonlLatestPath}`,
    '',
    '## Runtime',
    '',
    `- scenario_type: ${report.scenario.type}`,
    `- repo_url: ${report.scenario.repoUrl}`,
    `- repo_ref: ${report.scenario.repoRef}`,
    `- repo_commit: ${report.scenario.repoCommit}`,
    `- repo_dir: ${report.scenario.repoDir}`,
    `- repo_issue_url: ${report.scenario.repoIssueUrl || '(not set)'}`,
    `- entry_pointer: ${report.scenario.entryPointer}`,
    `- oracle_mode: ${report.oracle.mode}`,
    `- model: ${report.oracle.model}`,
    `- base_url: ${report.oracle.baseURL || '(default)'}`,
    `- max_output_tokens: ${report.oracle.maxOutputTokens}`,
    `- max_retries: ${report.oracle.maxRetries}`,
    `- retry_base_delay_ms: ${report.oracle.retryBaseDelayMs}`,
    `- retry_max_delay_ms: ${report.oracle.retryMaxDelayMs}`,
    `- request_timeout_ms: ${report.oracle.requestTimeoutMs}`,
    '',
    '## Chaos Config',
    '',
    `- exec_timeout_rate: ${report.chaos.execTimeoutRate}`,
    `- write_deny_rate: ${report.chaos.writeDenyRate}`,
    `- log_flood_rate: ${report.chaos.logFloodRate}`,
    `- log_flood_chars: ${report.chaos.logFloodChars}`,
    '',
    '## Metrics',
    '',
    `- ticks_requested: ${report.ticksRequested}`,
    `- ticks_observed: ${report.ticksObserved}`,
    `- replay_tuples: ${report.replayTuples}`,
    `- context_min: ${report.contextStats.min}`,
    `- context_max: ${report.contextStats.max}`,
    `- context_avg: ${report.contextStats.avg}`,
    `- context_p95: ${report.contextStats.p95}`,
    `- vliw_evidence: ${report.vliwEvidence.found} (tick=${report.vliwEvidence.tickSeq ?? 'n/a'})`,
    `- chaos_paged_flood: ${report.chaosEvidence.pagedFloodDetected} (tick=${report.chaosEvidence.tickSeq ?? 'n/a'})`,
    `- chaos_followup: ${report.chaosEvidence.followupAction || '(none)'}`,
    '',
    '## Checks',
    '',
    '| Check | Result | Details |',
    '|---|---|---|',
    ...report.checks.map((check) => `| ${check.id} | ${check.pass ? 'PASS' : 'FAIL'} | ${check.details} |`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const config = resolveRuntimeConfig();
  await fs.mkdir(AUDIT_DIR, { recursive: true });

  const stamp = timestamp();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'turingos-voyager-realworld-'));
  const realRepoWorkspace = await prepareRealRepoWorkspace(workspace, config);

  const chronosPath = path.join(workspace, '.journal.log');
  const manifold = new LocalManifold(workspace, {
    timeoutMs: 60_000,
    maxSliceChars: 4096,
    enableChaos: true,
    chaosExecTimeoutRate: config.chaosExecTimeoutRate,
    chaosWriteDenyRate: config.chaosWriteDenyRate,
    chaosLogFloodRate: config.chaosLogFloodRate,
    chaosLogFloodChars: config.chaosLogFloodChars,
  });
  const chronos = new FileChronos(chronosPath);
  const disciplinePrompt = await loadDisciplinePrompt();
  const oracle = new UniversalOracle(config.oracleMode, {
    apiKey: config.apiKey,
    model: config.model,
    baseURL: config.baseURL || undefined,
    maxOutputTokens: config.maxOutputTokens,
    maxRetries: config.maxRetries,
    retryBaseDelayMs: config.retryBaseDelayMs,
    retryMaxDelayMs: config.retryMaxDelayMs,
    requestTimeoutMs: config.requestTimeoutMs,
  });
  const engine = new TuringEngine(manifold, oracle, chronos, disciplinePrompt);

  await engine.ignite('q_voyager_boot', realRepoWorkspace.entryPointer, { maxTicks: config.ticksRequested });

  const journalRaw = await fs.readFile(chronosPath, 'utf-8');
  const tuples = parseReplayTuples(journalRaw);
  const contextLengths = tuples.map((tuple) => (typeof tuple.s_t === 'string' ? tuple.s_t.length : 0));
  const minCtx = contextLengths.length > 0 ? Math.min(...contextLengths) : 0;
  const maxCtx = contextLengths.length > 0 ? Math.max(...contextLengths) : 0;
  const avgCtx =
    contextLengths.length > 0
      ? Number((contextLengths.reduce((acc, value) => acc + value, 0) / contextLengths.length).toFixed(2))
      : 0;
  const p95Ctx = percentile(contextLengths, 0.95);

  const vliwTuple = tuples.find((tuple) => {
    const mindOps = Array.isArray(tuple.mind_ops) ? tuple.mind_ops.map((op) => op.op) : [];
    const hasEdit = mindOps.includes('SYS_EDIT');
    const hasPush = mindOps.includes('SYS_PUSH');
    const worldOp = tuple.world_op?.op;
    return hasEdit && hasPush && worldOp === 'SYS_EXEC';
  });

  const pagedFloodTupleIndex = tuples.findIndex(
    (tuple) =>
      typeof tuple.s_t === 'string' &&
      ((tuple.s_t.includes('[PAGE_TABLE_SUMMARY]') && tuple.s_t.includes('Source=command:')) ||
        tuple.s_t.includes('[OS_TRAP: LOG_FLOOD]'))
  );
  const pagedFloodTuple = pagedFloodTupleIndex >= 0 ? tuples[pagedFloodTupleIndex] : undefined;
  const followupTuple =
    pagedFloodTupleIndex >= 0 && pagedFloodTupleIndex + 1 < tuples.length ? tuples[pagedFloodTupleIndex + 1] : undefined;
  const followupAction = followupTuple?.a_t?.op ?? '';
  const followupPass = followupAction === 'SYS_GOTO' || followupAction === 'SYS_EXEC';

  const checks: Check[] = [
    {
      id: 'oracle_mode_is_real',
      pass: config.oracleMode === 'openai' || config.oracleMode === 'kimi',
      details: `mode=${config.oracleMode} model=${config.model}`,
    },
    {
      id: 'ticks_observed_>=_100',
      pass: tuples.length >= 100,
      details: `ticks=${tuples.length}`,
    },
    {
      id: 'vliw_combo_edit_push_then_exec',
      pass: Boolean(vliwTuple),
      details: vliwTuple
        ? `tick_seq=${vliwTuple.tick_seq ?? 'n/a'} mind_ops=${(vliwTuple.mind_ops ?? []).map((op) => op.op).join('|')}`
        : 'missing tuple with [SYS_EDIT,SYS_PUSH] + SYS_EXEC',
    },
    {
      id: 'chaos_log_flood_detected_and_followed',
      pass: Boolean(pagedFloodTuple) && followupPass,
      details: pagedFloodTuple
        ? `flood_tick=${pagedFloodTuple.tick_seq ?? 'n/a'} followup=${followupAction || '(none)'}`
        : 'no paged command flood detected',
    },
    {
      id: 'context_o1_bound_under_4k_mmu',
      pass: maxCtx <= 5500 && p95Ctx <= 5500,
      details: `min=${minCtx} max=${maxCtx} avg=${avgCtx} p95=${p95Ctx}`,
    },
  ];

  const report: EvalReport = {
    stamp,
    workspace,
    scenario: {
      type: 'real_repo',
      repoUrl: config.realRepoUrl,
      repoRef: config.realRepoRef,
      repoIssueUrl: config.realRepoIssueUrl,
      repoDir: realRepoWorkspace.repoDir,
      repoCommit: realRepoWorkspace.repoCommit,
      entryPointer: realRepoWorkspace.entryPointer,
    },
    oracle: {
      mode: config.oracleMode,
      model: config.model,
      baseURL: config.baseURL,
      maxOutputTokens: config.maxOutputTokens,
      maxRetries: config.maxRetries,
      retryBaseDelayMs: config.retryBaseDelayMs,
      retryMaxDelayMs: config.retryMaxDelayMs,
      requestTimeoutMs: config.requestTimeoutMs,
    },
    chaos: {
      execTimeoutRate: config.chaosExecTimeoutRate,
      writeDenyRate: config.chaosWriteDenyRate,
      logFloodRate: config.chaosLogFloodRate,
      logFloodChars: config.chaosLogFloodChars,
    },
    traceJsonlPath: '',
    traceJsonlLatestPath: '',
    dirtyTraceJsonlPath: '',
    dirtyTraceJsonlLatestPath: '',
    ticksRequested: config.ticksRequested,
    ticksObserved: tuples.length,
    replayTuples: tuples.length,
    contextStats: {
      min: minCtx,
      max: maxCtx,
      avg: avgCtx,
      p95: p95Ctx,
    },
    vliwEvidence: {
      found: Boolean(vliwTuple),
      tickSeq: vliwTuple?.tick_seq ?? null,
      details: vliwTuple
        ? JSON.stringify(
            {
              mind_ops: (vliwTuple.mind_ops ?? []).map((op) => op.op),
              world_op: vliwTuple.world_op?.op ?? null,
            },
            null,
            0
          )
        : '(missing)',
    },
    chaosEvidence: {
      pagedFloodDetected: Boolean(pagedFloodTuple),
      tickSeq: pagedFloodTuple?.tick_seq ?? null,
      followupAction,
    },
    checks,
    pass: checks.every((check) => check.pass),
  };

  const reportJsonPath = path.join(AUDIT_DIR, `voyager_realworld_eval_${stamp}.json`);
  const reportMdPath = path.join(AUDIT_DIR, `voyager_realworld_eval_${stamp}.md`);
  const latestJsonPath = path.join(AUDIT_DIR, 'voyager_realworld_eval_latest.json');
  const latestMdPath = path.join(AUDIT_DIR, 'voyager_realworld_eval_latest.md');
  const traceJsonlPath = path.join(AUDIT_DIR, `voyager_realworld_trace_${stamp}.jsonl`);
  const traceJsonlLatestPath = path.join(AUDIT_DIR, 'trace.jsonl');
  const dirtyTraceJsonlPath = path.join(AUDIT_DIR, `dirty_trace_${stamp}.jsonl`);
  const dirtyTraceJsonlLatestPath = path.join(AUDIT_DIR, 'dirty_trace_latest.jsonl');

  await fs.writeFile(traceJsonlPath, `${tuples.map((tuple) => JSON.stringify(tuple)).join('\n')}\n`, 'utf-8');
  await fs.writeFile(traceJsonlLatestPath, `${tuples.map((tuple) => JSON.stringify(tuple)).join('\n')}\n`, 'utf-8');
  await fs.writeFile(dirtyTraceJsonlPath, `${tuples.map((tuple) => JSON.stringify(tuple)).join('\n')}\n`, 'utf-8');
  await fs.writeFile(dirtyTraceJsonlLatestPath, `${tuples.map((tuple) => JSON.stringify(tuple)).join('\n')}\n`, 'utf-8');

  report.traceJsonlPath = traceJsonlPath;
  report.traceJsonlLatestPath = traceJsonlLatestPath;
  report.dirtyTraceJsonlPath = dirtyTraceJsonlPath;
  report.dirtyTraceJsonlLatestPath = dirtyTraceJsonlLatestPath;

  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(reportMdPath, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');
  await fs.writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(latestMdPath, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');

  const keepWorkspace = (process.env.VOYAGER_KEEP_WORKSPACE ?? '0').trim() === '1';
  if (!keepWorkspace) {
    await fs.rm(workspace, { recursive: true, force: true });
  }

  for (const check of checks) {
    console.log(`[voyager-eval] ${check.pass ? 'PASS' : 'FAIL'} ${check.id}: ${check.details}`);
  }
  console.log(`[voyager-eval] report=${reportJsonPath}`);
  if (!report.pass) {
    console.error('[voyager-eval] FAIL');
    process.exitCode = 1;
    return;
  }
  console.log('[voyager-eval] PASS');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[voyager-eval] fatal: ${message}`);
  process.exitCode = 1;
});
