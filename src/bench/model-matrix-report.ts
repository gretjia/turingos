import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

interface EvalReportLike {
  stamp?: string;
  provider?: {
    oracleMode?: string;
    baseURL?: string;
    model?: string;
  };
  metrics?: {
    validJsonRate?: number;
    schemaViolationRate?: number;
    mutexViolationRate?: number;
    reflexExactMatchRate?: number;
    deadlockEscapeRate?: number;
  };
  latency?: {
    totalDurationMs?: number;
    avgPerEvalMs?: number;
  };
  pass?: boolean;
  source?: string;
}

interface MatrixRow {
  name: string;
  stamp: string;
  provider: string;
  model: string;
  validJsonRate: number;
  schemaViolationRate: number;
  mutexViolationRate: number;
  reflexExactMatchRate: number;
  deadlockEscapeRate: number;
  avgPerEvalMs: number;
  pass: boolean;
  sourcePath: string;
}

interface MatrixReport {
  generatedAt: string;
  rows: MatrixRow[];
  notes: string[];
}

const ROOT = path.resolve(process.cwd());
const SFT_AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'sft');

function parseArgs(argv: string[]): { output?: string; mdOutput?: string } {
  const out: { output?: string; mdOutput?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const value = argv[i + 1];
    if (!token?.startsWith('--') || value === undefined) {
      continue;
    }
    if (token === '--output') {
      out.output = value;
      i += 1;
      continue;
    }
    if (token === '--md-output') {
      out.mdOutput = value;
      i += 1;
      continue;
    }
  }
  return out;
}

function valNumber(input: unknown, fallback = 0): number {
  return typeof input === 'number' && Number.isFinite(input) ? input : fallback;
}

async function readJsonIfExists(p: string): Promise<EvalReportLike | null> {
  try {
    const raw = await fs.readFile(p, 'utf-8');
    return JSON.parse(raw) as EvalReportLike;
  } catch {
    return null;
  }
}

function toRow(name: string, srcPath: string, report: EvalReportLike): MatrixRow {
  const provider = report.provider?.oracleMode ?? 'unknown';
  const model = report.provider?.model ?? 'unknown';
  const stamp = report.stamp ?? 'unknown';
  return {
    name,
    stamp,
    provider,
    model,
    validJsonRate: valNumber(report.metrics?.validJsonRate, 0),
    schemaViolationRate: valNumber(
      report.metrics?.schemaViolationRate,
      Math.max(0, 1 - valNumber(report.metrics?.validJsonRate, 0))
    ),
    mutexViolationRate: valNumber(report.metrics?.mutexViolationRate, 0),
    reflexExactMatchRate: valNumber(report.metrics?.reflexExactMatchRate, 0),
    deadlockEscapeRate: valNumber(report.metrics?.deadlockEscapeRate, 0),
    avgPerEvalMs: valNumber(report.latency?.avgPerEvalMs, -1),
    pass: Boolean(report.pass),
    sourcePath: srcPath,
  };
}

function toMarkdown(report: MatrixReport, jsonPath: string): string {
  return [
    '# SFT/API Model Matrix',
    '',
    `- generated_at: ${report.generatedAt}`,
    `- report_json: ${jsonPath}`,
    '',
    '| Name | Provider | Model | valid_json | schema_violation | mutex_violation | reflex_exact | deadlock_escape | avg_eval_ms | pass |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---|',
    ...report.rows.map((row) => {
      const avgMs = row.avgPerEvalMs >= 0 ? row.avgPerEvalMs.toFixed(2) : 'n/a';
      return `| ${row.name} | ${row.provider} | ${row.model} | ${row.validJsonRate} | ${row.schemaViolationRate} | ${row.mutexViolationRate} | ${row.reflexExactMatchRate} | ${row.deadlockEscapeRate} | ${avgMs} | ${row.pass ? 'PASS' : 'FAIL'} |`;
    }),
    '',
    '## Notes',
    ...report.notes.map((note) => `- ${note}`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(SFT_AUDIT_DIR, { recursive: true });

  const outputPath = args.output
    ? path.isAbsolute(args.output)
      ? args.output
      : path.join(ROOT, args.output)
    : path.join(SFT_AUDIT_DIR, `model_matrix_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`);
  const mdOutputPath = args.mdOutput
    ? path.isAbsolute(args.mdOutput)
      ? args.mdOutput
      : path.join(ROOT, args.mdOutput)
    : path.join(SFT_AUDIT_DIR, 'model_matrix_latest.md');

  const sources: Array<{ name: string; path: string }> = [
    {
      name: 'api_groq_base',
      path: path.join(SFT_AUDIT_DIR, 'guard_mcu_eval_20260227_112725.json'),
    },
    {
      name: 'api_kimi',
      path: path.join(SFT_AUDIT_DIR, 'guard_mcu_eval_20260227_112733.json'),
    },
    {
      name: 'local_qwen3_coder30b_mac',
      path: path.join(ROOT, 'handover', 'audits', 'localmodel', 'guard_mcu_eval_mac_qwen3_coder30b_20260227.json'),
    },
  ];
  const fineTunedPath =
    (process.env.TURINGOS_FINETUNED_GUARD_EVAL_PATH ?? '').trim() ||
    path.join(ROOT, 'handover', 'audits', 'localmodel', 'guard_mcu_eval_mac_qwen3_finetuned_latest.json');
  const fineTunedName = (process.env.TURINGOS_FINETUNED_MODEL_LABEL ?? 'local_qwen3_finetuned_mac').trim();
  if (fineTunedPath.length > 0) {
    sources.push({
      name: fineTunedName.length > 0 ? fineTunedName : 'local_qwen3_finetuned_mac',
      path: path.isAbsolute(fineTunedPath) ? fineTunedPath : path.join(ROOT, fineTunedPath),
    });
  }

  const rows: MatrixRow[] = [];
  const notes: string[] = [];

  const resolvedFineTunedPath =
    fineTunedPath.length > 0 ? (path.isAbsolute(fineTunedPath) ? fineTunedPath : path.join(ROOT, fineTunedPath)) : '';
  let fineTunedRowLoaded = false;

  for (const source of sources) {
    const report = await readJsonIfExists(source.path);
    if (!report) {
      notes.push(`Missing source: ${source.path}`);
      continue;
    }
    rows.push(toRow(source.name, source.path, report));
    if (resolvedFineTunedPath.length > 0 && source.path === resolvedFineTunedPath) {
      fineTunedRowLoaded = true;
    }
  }

  if (!fineTunedRowLoaded) {
    notes.push(
      `Fine-tuned local model row is pending. Set TURINGOS_FINETUNED_GUARD_EVAL_PATH to include it.`
    );
  }
  notes.push('Schema violation uses explicit report field when available; falls back to (1 - valid_json_rate).');

  const matrix: MatrixReport = {
    generatedAt: new Date().toISOString(),
    rows,
    notes,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(matrix, null, 2)}\n`, 'utf-8');
  await fs.writeFile(mdOutputPath, `${toMarkdown(matrix, outputPath)}\n`, 'utf-8');
  await fs.writeFile(path.join(SFT_AUDIT_DIR, 'model_matrix_latest.json'), `${JSON.stringify(matrix, null, 2)}\n`, 'utf-8');
  console.log(`[model-matrix-report] rows=${rows.length}`);
  console.log(`[model-matrix-report] output=${outputPath}`);
  console.log(`[model-matrix-report] md_output=${mdOutputPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[model-matrix-report] fatal: ${message}`);
  process.exitCode = 1;
});
