import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { UniversalOracle } from '../oracle/universal-oracle.js';

interface CliArgs {
  dataset: string;
  limit: number;
  baseURL: string;
  model: string;
  apiKey: string;
  sourceOverride: string | null;
}

interface DatasetRow {
  q_t: string;
  s_t: string;
  d_t?: string;
  q_next?: string;
  a_t?: Record<string, unknown>;
  source_trace?: string;
  tick_seq?: number | null;
}

interface EvalSummary {
  stamp: string;
  dataset: string;
  source: string;
  baseURL: string;
  model: string;
  requested: number;
  attempted: number;
  succeeded: number;
  failed: number;
  successRate: number;
  setupReady: boolean;
  setupError: string | null;
  outputJsonl: string;
  reportJsonPath: string;
  reportMdPath: string;
  generatedAt: string;
}

const ROOT = path.resolve(process.cwd());
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'local_alu');
const LATEST_EVAL_FILE = path.join(AUDIT_DIR, 'ac41b_eval_latest.json');

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

function parseArgs(argv: string[]): CliArgs {
  let dataset = '';
  let limit = 200;
  let baseURL = process.env.TURINGOS_LOCAL_ALU_BASE_URL ?? process.env.TURINGOS_API_BASE_URL ?? '';
  let model = process.env.TURINGOS_LOCAL_ALU_MODEL ?? process.env.TURINGOS_MODEL ?? '';
  let apiKey = process.env.TURINGOS_LOCAL_ALU_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.KIMI_API_KEY ?? '';
  let sourceOverride: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      continue;
    }
    if (key === '--dataset') dataset = path.resolve(value);
    if (key === '--limit') limit = Number.parseInt(value, 10);
    if (key === '--base-url') baseURL = value;
    if (key === '--model') model = value;
    if (key === '--api-key') apiKey = value;
    if (key === '--source') sourceOverride = value;
  }

  if (!dataset) {
    throw new Error('Missing --dataset <dataset.jsonl>');
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`Invalid --limit: ${limit}`);
  }
  return {
    dataset,
    limit,
    baseURL,
    model,
    apiKey,
    sourceOverride,
  };
}

function inferSource(baseURL: string): string {
  try {
    const url = new URL(baseURL);
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return 'local_alu';
    }
    return 'remote_proxy';
  } catch {
    return 'remote_proxy';
  }
}

function normalizeDatasetLine(raw: string): DatasetRow | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const q_t = typeof parsed.q_t === 'string' ? parsed.q_t : '';
    const s_t = typeof parsed.s_t === 'string' ? parsed.s_t : '';
    if (!q_t || !s_t) {
      return null;
    }
    return {
      q_t,
      s_t,
      d_t: typeof parsed.d_t === 'string' ? parsed.d_t : undefined,
      q_next: typeof parsed.q_next === 'string' ? parsed.q_next : undefined,
      a_t:
        parsed.a_t && typeof parsed.a_t === 'object' && !Array.isArray(parsed.a_t)
          ? (parsed.a_t as Record<string, unknown>)
          : undefined,
      source_trace: typeof parsed.source_trace === 'string' ? parsed.source_trace : undefined,
      tick_seq: typeof parsed.tick_seq === 'number' && Number.isFinite(parsed.tick_seq) ? parsed.tick_seq : null,
    };
  } catch {
    return null;
  }
}

function buildDisciplinePrompt(): string {
  return [
    'You are TuringOS ALU.',
    'Output STRICT JSON only: {"q_next":"...","a_t":{"op":"SYS_*", ...}}.',
    'Allowed opcodes and exact fields:',
    '- SYS_WRITE: {"op":"SYS_WRITE","payload":"...","semantic_cap":"optional"}',
    '- SYS_GOTO: {"op":"SYS_GOTO","pointer":"..."}',
    '- SYS_EXEC: {"op":"SYS_EXEC","cmd":"..."}',
    '- SYS_GIT_LOG: {"op":"SYS_GIT_LOG","query_params":"optional","path":"optional","limit":20,"ref":"optional","grep":"optional","since":"optional"}',
    '- SYS_PUSH: {"op":"SYS_PUSH","task":"..."} (task MUST be plain string)',
    '- SYS_EDIT: {"op":"SYS_EDIT","task":"..."} (edit current stack frame in-place)',
    '- SYS_POP: {"op":"SYS_POP"}',
    '- SYS_HALT: {"op":"SYS_HALT"}',
    'Never include unsupported keys. Examples of forbidden keys: pointer in SYS_WRITE, payload in SYS_PUSH.',
    'Do not output markdown fences or prose.',
  ].join(' ');
}

function toMarkdown(summary: EvalSummary): string {
  return [
    '# AC4.1b Local ALU Eval Report',
    '',
    `- stamp: ${summary.stamp}`,
    `- source: ${summary.source}`,
    `- baseURL: ${summary.baseURL}`,
    `- model: ${summary.model}`,
    `- dataset: ${summary.dataset}`,
    `- requested: ${summary.requested}`,
    `- attempted: ${summary.attempted}`,
    `- succeeded: ${summary.succeeded}`,
    `- failed: ${summary.failed}`,
    `- successRate: ${summary.successRate}`,
    `- setupReady: ${summary.setupReady}`,
    `- setupError: ${summary.setupError ?? '(none)'}`,
    `- outputJsonl: ${summary.outputJsonl}`,
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.dataset)) {
    throw new Error(`Dataset not found: ${args.dataset}`);
  }

  const rawDataset = await fsp.readFile(args.dataset, 'utf-8');
  const rows = rawDataset
    .split('\n')
    .map(normalizeDatasetLine)
    .filter((row): row is DatasetRow => row !== null)
    .slice(0, args.limit);

  await fsp.mkdir(AUDIT_DIR, { recursive: true });
  const stamp = timestamp();
  const source = args.sourceOverride?.trim() || inferSource(args.baseURL || '');
  const outputJsonl = path.join(AUDIT_DIR, `ac41b_local_eval_outputs_${stamp}.jsonl`);
  const reportJsonPath = path.join(AUDIT_DIR, `ac41b_local_eval_${stamp}.json`);
  const reportMdPath = path.join(AUDIT_DIR, `ac41b_local_eval_${stamp}.md`);

  const discipline = buildDisciplinePrompt();
  const outputLines: string[] = [];
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  let setupReady = true;
  let setupError: string | null = null;
  if (!args.baseURL.trim()) {
    setupReady = false;
    setupError = 'Missing base URL. Set --base-url or TURINGOS_LOCAL_ALU_BASE_URL/TURINGOS_API_BASE_URL.';
  } else if (!args.model.trim()) {
    setupReady = false;
    setupError = 'Missing model. Set --model or TURINGOS_LOCAL_ALU_MODEL/TURINGOS_MODEL.';
  } else if (!args.apiKey.trim()) {
    setupReady = false;
    setupError = 'Missing API key. Set --api-key or TURINGOS_LOCAL_ALU_API_KEY/OPENAI_API_KEY/KIMI_API_KEY.';
  }

  if (!setupReady) {
    outputLines.push(
      JSON.stringify({
        setup_error: setupError,
      })
    );
  } else {
    const oracle = new UniversalOracle('openai', {
      apiKey: args.apiKey,
      model: args.model,
      baseURL: args.baseURL,
    });

    for (const row of rows) {
      attempted += 1;
      try {
        const transition = await oracle.collapse(discipline, row.q_t, row.s_t);
        outputLines.push(
          JSON.stringify({
            q_next: transition.q_next,
            a_t: transition.a_t,
            source_trace: row.source_trace ?? '(unknown)',
            tick_seq: row.tick_seq ?? null,
          })
        );
        succeeded += 1;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        outputLines.push(
          JSON.stringify({
            error: message,
            source_trace: row.source_trace ?? '(unknown)',
            tick_seq: row.tick_seq ?? null,
          })
        );
        failed += 1;
      }
    }
  }

  await fsp.writeFile(outputJsonl, `${outputLines.join('\n')}\n`, 'utf-8');

  const successRate = attempted > 0 ? succeeded / attempted : 0;
  const summary: EvalSummary = {
    stamp,
    dataset: args.dataset,
    source,
    baseURL: args.baseURL,
    model: args.model,
    requested: args.limit,
    attempted,
    succeeded,
    failed,
    successRate,
    setupReady,
    setupError,
    outputJsonl,
    reportJsonPath,
    reportMdPath,
    generatedAt: new Date().toISOString(),
  };

  await fsp.writeFile(reportJsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
  await fsp.writeFile(reportMdPath, `${toMarkdown(summary)}`, 'utf-8');
  await fsp.writeFile(LATEST_EVAL_FILE, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');

  console.log(
    `[ac41b-local-alu-eval] source=${source} setupReady=${setupReady} attempted=${attempted} succeeded=${succeeded} failed=${failed} successRate=${successRate}`
  );
  console.log(`[ac41b-local-alu-eval] outputJsonl=${outputJsonl}`);
  console.log(`[ac41b-local-alu-eval] reportJson=${reportJsonPath}`);
  console.log(`[ac41b-local-alu-eval] reportMd=${reportMdPath}`);

  process.exit(setupReady && succeeded > 0 ? 0 : 2);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ac41b-local-alu-eval] fatal: ${message}`);
  process.exit(1);
});
