import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

interface CliArgs {
  policyInput: string;
  reflexInput: string;
  outDir: string;
  trainPct: number;
  valPct: number;
}

interface DatasetRow {
  task?: string;
  input?: unknown;
  output?: unknown;
  meta?: Record<string, unknown>;
}

interface KeyedRow {
  row: DatasetRow;
  key: string;
  hash: string;
}

interface SplitPaths {
  train: string;
  val: string;
  test: string;
}

interface SplitCounts {
  train: number;
  val: number;
  test: number;
}

interface SplitReport {
  stamp: string;
  policyInput: string;
  reflexInput: string;
  outDir: string;
  ratios: {
    train: number;
    val: number;
    test: number;
  };
  policy: {
    rows: number;
    counts: SplitCounts;
    files: SplitPaths;
  };
  reflex: {
    rows: number;
    counts: SplitCounts;
    files: SplitPaths;
  };
  pass: boolean;
}

const ROOT = path.resolve(process.cwd());
const SFT_DATA_DIR = path.join(ROOT, 'benchmarks', 'data', 'sft');
const SFT_AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'sft');
const LATEST_DATASET_SUMMARY = path.join(SFT_AUDIT_DIR, 'guard_sft_dataset_latest.json');
const LATEST_SPLIT_SUMMARY = path.join(SFT_AUDIT_DIR, 'guard_sft_split_latest.json');
const LATEST_SPLIT_MANIFEST = path.join(SFT_DATA_DIR, 'splits', 'latest_manifest.json');

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

function parsePositiveInt(raw: string, flag: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flag}: ${raw}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliArgs {
  let policyInput = '';
  let reflexInput = '';
  let outDir = '';
  let trainPct = 80;
  let valPct = 10;

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      continue;
    }
    if (key === '--policy-input') {
      policyInput = path.resolve(value);
    }
    if (key === '--reflex-input') {
      reflexInput = path.resolve(value);
    }
    if (key === '--out-dir') {
      outDir = path.resolve(value);
    }
    if (key === '--train-pct') {
      trainPct = parsePositiveInt(value, '--train-pct');
    }
    if (key === '--val-pct') {
      valPct = parsePositiveInt(value, '--val-pct');
    }
  }

  if (trainPct >= 100) {
    throw new Error(`Invalid --train-pct: ${trainPct} (must be < 100)`);
  }
  if (valPct >= 100) {
    throw new Error(`Invalid --val-pct: ${valPct} (must be < 100)`);
  }
  if (trainPct + valPct >= 100) {
    throw new Error(
      `Invalid split ratio: train=${trainPct}, val=${valPct}. train+val must be < 100 (test must remain > 0).`
    );
  }

  return {
    policyInput,
    reflexInput,
    outDir,
    trainPct,
    valPct,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

async function resolveInputs(args: CliArgs): Promise<{ policyInput: string; reflexInput: string; outDir: string }> {
  const summaryRaw = await fsp.readFile(LATEST_DATASET_SUMMARY, 'utf-8');
  const summary = JSON.parse(summaryRaw) as Record<string, unknown>;
  const latestPolicy = typeof summary.policyOutput === 'string' ? summary.policyOutput : '';
  const latestReflex = typeof summary.reflexOutput === 'string' ? summary.reflexOutput : '';
  const stamp = timestamp();
  const defaultOutDir = path.join(SFT_DATA_DIR, 'splits', stamp);

  const policyInput = args.policyInput || latestPolicy;
  const reflexInput = args.reflexInput || latestReflex;
  const outDir = args.outDir || defaultOutDir;

  if (!policyInput || !fs.existsSync(policyInput)) {
    throw new Error(`Policy input not found: ${policyInput || '(empty)'}`);
  }
  if (!reflexInput || !fs.existsSync(reflexInput)) {
    throw new Error(`Reflex input not found: ${reflexInput || '(empty)'}`);
  }

  return { policyInput, reflexInput, outDir };
}

function normalizeRows(raw: string): DatasetRow[] {
  const rows: DatasetRow[] = [];
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      const row = asRecord(parsed);
      if (!row) {
        continue;
      }
      rows.push(row as DatasetRow);
    } catch {
      continue;
    }
  }
  return rows;
}

function stableKey(row: DatasetRow): string {
  const meta = asRecord(row.meta);
  const source = typeof meta?.source_trace === 'string' ? meta.source_trace : '(unknown_source)';
  const tick =
    typeof meta?.tick_seq === 'number'
      ? String(meta.tick_seq)
      : typeof meta?.trap_seq === 'number'
        ? String(meta.trap_seq)
        : '(unknown_tick)';
  const task = typeof row.task === 'string' ? row.task : 'unknown_task';
  const payload = JSON.stringify({
    task,
    source,
    tick,
    input: row.input ?? null,
    output: row.output ?? null,
  });
  return payload;
}

function planSplitCounts(total: number, trainPct: number, valPct: number): SplitCounts {
  if (total <= 0) {
    return { train: 0, val: 0, test: 0 };
  }
  let train = Math.floor((total * trainPct) / 100);
  let val = Math.floor((total * valPct) / 100);
  let test = total - train - val;

  // For usable validation gates, keep each split non-empty when dataset is large enough.
  if (total >= 3) {
    if (train === 0) train = 1;
    if (val === 0) val = 1;
    test = total - train - val;
    if (test === 0) {
      if (train > val && train > 1) {
        train -= 1;
      } else if (val > 1) {
        val -= 1;
      }
      test = total - train - val;
    }
  }

  return { train, val, test };
}

async function writeSplitRows(
  baseDir: string,
  prefix: string,
  rows: DatasetRow[],
  trainPct: number,
  valPct: number
): Promise<{ counts: SplitCounts; files: SplitPaths }> {
  const keyedRows: KeyedRow[] = rows.map((row) => {
    const key = stableKey(row);
    const hash = createHash('sha256').update(key).digest('hex');
    return { row, key, hash };
  });
  keyedRows.sort((a, b) => a.hash.localeCompare(b.hash) || a.key.localeCompare(b.key));
  const counts = planSplitCounts(rows.length, trainPct, valPct);
  const trainRows = keyedRows.slice(0, counts.train).map((item) => item.row);
  const valRows = keyedRows.slice(counts.train, counts.train + counts.val).map((item) => item.row);
  const testRows = keyedRows.slice(counts.train + counts.val).map((item) => item.row);

  const splitDir = path.join(baseDir, prefix);
  await fsp.mkdir(splitDir, { recursive: true });
  const files: SplitPaths = {
    train: path.join(splitDir, `${prefix}_train.jsonl`),
    val: path.join(splitDir, `${prefix}_val.jsonl`),
    test: path.join(splitDir, `${prefix}_test.jsonl`),
  };

  const toLines = (items: DatasetRow[]): string => `${items.map((item) => JSON.stringify(item)).join('\n')}\n`;
  await fsp.writeFile(files.train, toLines(trainRows), 'utf-8');
  await fsp.writeFile(files.val, toLines(valRows), 'utf-8');
  await fsp.writeFile(files.test, toLines(testRows), 'utf-8');

  return {
    counts,
    files,
  };
}

function toMarkdown(report: SplitReport, jsonPath: string): string {
  return [
    '# Guard SFT Split Report',
    '',
    `- stamp: ${report.stamp}`,
    `- pass: ${report.pass}`,
    `- report_json: ${jsonPath}`,
    `- policy_input: ${report.policyInput}`,
    `- reflex_input: ${report.reflexInput}`,
    `- out_dir: ${report.outDir}`,
    `- ratio_train_val_test: ${report.ratios.train}/${report.ratios.val}/${report.ratios.test}`,
    '',
    '## Policy',
    '',
    `- rows: ${report.policy.rows}`,
    `- train: ${report.policy.counts.train}`,
    `- val: ${report.policy.counts.val}`,
    `- test: ${report.policy.counts.test}`,
    '',
    '## Reflex',
    '',
    `- rows: ${report.reflex.rows}`,
    `- train: ${report.reflex.counts.train}`,
    `- val: ${report.reflex.counts.val}`,
    `- test: ${report.reflex.counts.test}`,
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const resolved = await resolveInputs(args);
  await fsp.mkdir(resolved.outDir, { recursive: true });
  await fsp.mkdir(SFT_AUDIT_DIR, { recursive: true });
  await fsp.mkdir(path.dirname(LATEST_SPLIT_MANIFEST), { recursive: true });

  const policyRaw = await fsp.readFile(resolved.policyInput, 'utf-8');
  const reflexRaw = await fsp.readFile(resolved.reflexInput, 'utf-8');
  const policyRows = normalizeRows(policyRaw);
  const reflexRows = normalizeRows(reflexRaw);

  const policySplit = await writeSplitRows(resolved.outDir, 'policy', policyRows, args.trainPct, args.valPct);
  const reflexSplit = await writeSplitRows(resolved.outDir, 'reflex', reflexRows, args.trainPct, args.valPct);

  const testPct = 100 - args.trainPct - args.valPct;
  const stamp = path.basename(resolved.outDir);
  const report: SplitReport = {
    stamp,
    policyInput: resolved.policyInput,
    reflexInput: resolved.reflexInput,
    outDir: resolved.outDir,
    ratios: {
      train: args.trainPct,
      val: args.valPct,
      test: testPct,
    },
    policy: {
      rows: policyRows.length,
      counts: policySplit.counts,
      files: policySplit.files,
    },
    reflex: {
      rows: reflexRows.length,
      counts: reflexSplit.counts,
      files: reflexSplit.files,
    },
    pass:
      policyRows.length > 0 &&
      reflexRows.length > 0 &&
      policySplit.counts.train > 0 &&
      policySplit.counts.val > 0 &&
      policySplit.counts.test > 0 &&
      reflexSplit.counts.train > 0 &&
      reflexSplit.counts.val > 0 &&
      reflexSplit.counts.test > 0,
  };

  const reportJsonPath = path.join(SFT_AUDIT_DIR, `guard_sft_split_${stamp}.json`);
  const reportMdPath = path.join(SFT_AUDIT_DIR, `guard_sft_split_${stamp}.md`);
  await fsp.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fsp.writeFile(reportMdPath, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');
  await fsp.writeFile(LATEST_SPLIT_SUMMARY, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fsp.writeFile(LATEST_SPLIT_MANIFEST, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');

  console.log(
    `[guard-sft-split] policy=${policyRows.length} (train=${policySplit.counts.train}, val=${policySplit.counts.val}, test=${policySplit.counts.test})`
  );
  console.log(
    `[guard-sft-split] reflex=${reflexRows.length} (train=${reflexSplit.counts.train}, val=${reflexSplit.counts.val}, test=${reflexSplit.counts.test})`
  );
  console.log(`[guard-sft-split] report=${reportJsonPath}`);
  process.exit(report.pass ? 0 : 2);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[guard-sft-split] fatal: ${message}`);
  process.exit(1);
});
