import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

interface CliArgs {
  roots: string[];
  output: string;
  minRows: number;
}

interface DatasetRow {
  q_t: string;
  s_t: string;
  d_t: string;
  q_next: string;
  a_t: Record<string, unknown>;
  source_trace: string;
  tick_seq: number | null;
}

interface DatasetSummary {
  stamp: string;
  roots: string[];
  output: string;
  rows: number;
  traces: number;
  opCounts: Record<string, number>;
  minRows: number;
  pass: boolean;
  reportJsonPath: string;
  reportMdPath: string;
}

const ROOT = path.resolve(process.cwd());
const DEFAULT_ROOT = path.join(ROOT, 'benchmarks', 'audits', 'evidence', 'golden_traces');
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'local_alu');
const DATA_DIR = path.join(ROOT, 'benchmarks', 'data', 'local_alu');
const LATEST_DATASET_META = path.join(AUDIT_DIR, 'ac41b_dataset_latest.json');

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
  let output = '';
  let minRows = 1000;
  const roots: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      continue;
    }

    if (key === '--root') {
      roots.push(path.resolve(value));
    }
    if (key === '--output') {
      output = path.resolve(value);
    }
    if (key === '--min-rows') {
      minRows = Number.parseInt(value, 10);
    }
  }

  if (!output) {
    const stamp = timestamp();
    output = path.join(DATA_DIR, `ac41b_seed_${stamp}.jsonl`);
  }

  if (!Number.isFinite(minRows) || minRows <= 0) {
    throw new Error(`Invalid --min-rows: ${minRows}`);
  }

  return {
    roots: roots.length > 0 ? roots : [DEFAULT_ROOT],
    output,
    minRows,
  };
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        out.push(full);
      }
    }
  }

  if (!fs.existsSync(root)) {
    return out;
  }
  await walk(root);
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseReplayTuples(raw: string, sourceTrace: string): DatasetRow[] {
  const rows: DatasetRow[] = [];
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const match = line.match(/\[REPLAY_TUPLE\]\s*(\{.*\})$/);
    if (!match?.[1]) {
      continue;
    }

    try {
      const parsed = JSON.parse(match[1]) as Record<string, unknown>;
      const q_t = typeof parsed.q_t === 'string' ? parsed.q_t : '';
      const s_t = typeof parsed.s_t === 'string' ? parsed.s_t : '';
      const d_t = typeof parsed.d_t === 'string' ? parsed.d_t : '';
      const qNext = typeof parsed.q_next === 'string' ? parsed.q_next : '';
      const a_t = asRecord(parsed.a_t);
      const op = a_t && typeof a_t.op === 'string' ? a_t.op : '';
      if (!q_t || !s_t || !d_t || !qNext || !a_t || !op) {
        continue;
      }
      const tickSeqRaw = parsed.tick_seq;
      const tickSeq = typeof tickSeqRaw === 'number' && Number.isFinite(tickSeqRaw) ? tickSeqRaw : null;

      rows.push({
        q_t,
        s_t,
        d_t,
        q_next: qNext,
        a_t,
        source_trace: sourceTrace,
        tick_seq: tickSeq,
      });
    } catch {
      continue;
    }
  }

  return rows;
}

function toMarkdown(summary: DatasetSummary): string {
  const opLines = Object.entries(summary.opCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([op, count]) => `- ${op}: ${count}`)
    .join('\n');

  return [
    '# AC4.1b Trace Dataset Build Report',
    '',
    `- stamp: ${summary.stamp}`,
    `- roots: ${summary.roots.join(', ')}`,
    `- output: ${summary.output}`,
    `- rows: ${summary.rows}`,
    `- traces: ${summary.traces}`,
    `- minRows: ${summary.minRows}`,
    `- pass: ${summary.pass}`,
    '',
    '## Opcode Distribution',
    '',
    opLines.length > 0 ? opLines : '- (empty)',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(AUDIT_DIR, { recursive: true });

  const allRows: DatasetRow[] = [];
  const traceSet = new Set<string>();

  for (const root of args.roots) {
    const files = await listFilesRecursive(root);
    const traceFiles = files.filter((file) =>
      /(ac32\.synthetic\.journal\.log|ac31\.journal\.log|\.journal\.log)$/.test(path.basename(file))
    );

    for (const filePath of traceFiles) {
      const raw = await fsp.readFile(filePath, 'utf-8');
      const rows = parseReplayTuples(raw, filePath);
      if (rows.length === 0) {
        continue;
      }
      rows.forEach((row) => allRows.push(row));
      traceSet.add(filePath);
    }
  }

  const outputLines = allRows.map((row) => JSON.stringify(row));
  await fsp.mkdir(path.dirname(args.output), { recursive: true });
  await fsp.writeFile(args.output, `${outputLines.join('\n')}\n`, 'utf-8');

  const opCounts: Record<string, number> = {};
  for (const row of allRows) {
    const op = typeof row.a_t.op === 'string' ? row.a_t.op : 'UNKNOWN';
    opCounts[op] = (opCounts[op] ?? 0) + 1;
  }

  const stamp = timestamp();
  const reportJsonPath = path.join(AUDIT_DIR, `ac41b_dataset_${stamp}.json`);
  const reportMdPath = path.join(AUDIT_DIR, `ac41b_dataset_${stamp}.md`);
  const summary: DatasetSummary = {
    stamp,
    roots: args.roots,
    output: args.output,
    rows: allRows.length,
    traces: traceSet.size,
    opCounts,
    minRows: args.minRows,
    pass: allRows.length >= args.minRows,
    reportJsonPath,
    reportMdPath,
  };

  await fsp.writeFile(reportJsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
  await fsp.writeFile(reportMdPath, `${toMarkdown(summary)}`, 'utf-8');
  await fsp.writeFile(LATEST_DATASET_META, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');

  console.log(
    `[ac41b-build-trace-dataset] rows=${summary.rows} traces=${summary.traces} pass=${summary.pass} output=${summary.output}`
  );
  console.log(`[ac41b-build-trace-dataset] reportJson=${reportJsonPath}`);
  console.log(`[ac41b-build-trace-dataset] reportMd=${reportMdPath}`);
  process.exit(summary.pass ? 0 : 2);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ac41b-build-trace-dataset] fatal: ${message}`);
  process.exit(1);
});
