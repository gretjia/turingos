import 'dotenv/config';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
  oracle: {
    mode: VoyagerOracleMode;
    model: string;
    baseURL: string;
    maxOutputTokens: number;
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
  maxOutputTokens: number;
  ticksRequested: number;
  chaosExecTimeoutRate: number;
  chaosWriteDenyRate: number;
  chaosLogFloodRate: number;
  chaosLogFloodChars: number;
}

const ROOT = path.resolve(process.cwd());
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'longrun');

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

async function createSyntheticProject(workspace: string): Promise<void> {
  const srcDir = path.join(workspace, 'src');
  await fs.mkdir(srcDir, { recursive: true });
  const totalFiles = 20;
  for (let i = 0; i < totalFiles; i += 1) {
    const next = (i + 1) % totalFiles;
    const prev = (i + totalFiles - 1) % totalFiles;
    const fileName = `mod_${String(i).padStart(2, '0')}.ts`;
    const content = [
      `import { f_${next} } from './mod_${String(next).padStart(2, '0')}';`,
      `import { f_${prev} } from './mod_${String(prev).padStart(2, '0')}';`,
      '',
      `export function f_${i}(v_${i}: number): number {`,
      `  const __z_${i} = (v_${i} + ${i}) ^ 0x${(4096 + i).toString(16)};`,
      `  if ((__z_${i} & 1) === 0) {`,
      `    return f_${next}((__z_${i} >>> 1) + 1);`,
      '  }',
      `  return (f_${prev}(1) + __z_${i}) & 0xffff;`,
      '}',
      '',
    ].join('\n');
    await fs.writeFile(path.join(srcDir, fileName), content, 'utf-8');
  }

  await fs.writeFile(
    path.join(workspace, 'MAIN_TAPE.md'),
    [
      '# Kobayashi Maru Synthetic Workspace',
      '',
      '- Objective: survive chaos and preserve O(1) context.',
      '- Agent must run under true oracle (no synthetic transition generator).',
      '- Verify VLIW mind_ops + world_op execution under noisy physical manifold.',
      '- Navigate paged log floods via SYS_GOTO on sys://page tokens.',
      '',
    ].join('\n'),
    'utf-8'
  );
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

  const maxOutputTokens = parseInteger(
    process.env.VOYAGER_MAX_OUTPUT_TOKENS ?? process.env.TURINGOS_MAX_OUTPUT_TOKENS,
    1024
  );
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
    maxOutputTokens,
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
    `- oracle_mode: ${report.oracle.mode}`,
    `- model: ${report.oracle.model}`,
    `- base_url: ${report.oracle.baseURL || '(default)'}`,
    `- max_output_tokens: ${report.oracle.maxOutputTokens}`,
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
  await createSyntheticProject(workspace);

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
  });
  const engine = new TuringEngine(manifold, oracle, chronos, disciplinePrompt);

  await engine.ignite('q_voyager_boot', 'MAIN_TAPE.md', { maxTicks: config.ticksRequested });

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
      tuple.s_t.includes('[PAGE_TABLE_SUMMARY]') &&
      tuple.s_t.includes('Source=command:')
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
    oracle: {
      mode: config.oracleMode,
      model: config.model,
      baseURL: config.baseURL,
      maxOutputTokens: config.maxOutputTokens,
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
