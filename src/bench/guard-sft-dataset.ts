import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

interface CliArgs {
  roots: string[];
  policyOutput: string;
  reflexOutput: string;
  minPolicyRows: number;
  minReflexRows: number;
}

interface ReplayTuple {
  lineIndex: number;
  q_t: string;
  s_t: string;
  d_t: string;
  q_next: string;
  a_t: Record<string, unknown>;
  tick_seq: number | null;
  source_trace: string;
}

interface TrapFrame {
  lineIndex: number;
  seq: number | null;
  trap_base: string;
  trap_pointer: string;
  details: string;
  panic_reset_count: number | null;
  source_trace: string;
}

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
  meta: {
    source_trace: string;
    tick_seq: number | null;
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
  meta: {
    source_trace: string;
    trap_seq: number | null;
    follow_tick_seq: number | null;
  };
}

interface DatasetSummary {
  stamp: string;
  roots: string[];
  scannedTraces: number;
  policyRows: number;
  reflexRows: number;
  minPolicyRows: number;
  minReflexRows: number;
  pass: boolean;
  policyOutput: string;
  reflexOutput: string;
  opcodeCounts: Record<string, number>;
  trapBaseCounts: Record<string, number>;
  reportJsonPath: string;
  reportMdPath: string;
}

const ROOT = path.resolve(process.cwd());
const DEFAULT_ROOTS = [
  path.join(ROOT, 'benchmarks', 'audits', 'evidence', 'golden_traces'),
  path.join(ROOT, 'benchmarks', 'audits', 'evidence', 'guard_analytics'),
  path.join(ROOT, 'benchmarks', 'os-longrun', 'workspaces'),
];
const DATA_DIR = path.join(ROOT, 'benchmarks', 'data', 'sft');
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'sft');
const LATEST_SUMMARY = path.join(AUDIT_DIR, 'guard_sft_dataset_latest.json');

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
  const roots: string[] = [];
  let policyOutput = '';
  let reflexOutput = '';
  let minPolicyRows = 100;
  let minReflexRows = 1;

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      continue;
    }
    if (key === '--root') {
      roots.push(path.resolve(value));
    }
    if (key === '--policy-output') {
      policyOutput = path.resolve(value);
    }
    if (key === '--reflex-output') {
      reflexOutput = path.resolve(value);
    }
    if (key === '--min-policy-rows') {
      minPolicyRows = Number.parseInt(value, 10);
    }
    if (key === '--min-reflex-rows') {
      minReflexRows = Number.parseInt(value, 10);
    }
  }

  const stamp = timestamp();
  if (!policyOutput) {
    policyOutput = path.join(DATA_DIR, `guard_policy_${stamp}.jsonl`);
  }
  if (!reflexOutput) {
    reflexOutput = path.join(DATA_DIR, `guard_reflex_${stamp}.jsonl`);
  }
  if (!Number.isFinite(minPolicyRows) || minPolicyRows <= 0) {
    throw new Error(`Invalid --min-policy-rows: ${minPolicyRows}`);
  }
  if (!Number.isFinite(minReflexRows) || minReflexRows <= 0) {
    throw new Error(`Invalid --min-reflex-rows: ${minReflexRows}`);
  }

  return {
    roots: roots.length > 0 ? roots : DEFAULT_ROOTS,
    policyOutput,
    reflexOutput,
    minPolicyRows,
    minReflexRows,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        files.push(full);
      }
    }
  }

  if (!fs.existsSync(root)) {
    return files;
  }
  await walk(root);
  return files;
}

function parseJournal(
  journalRaw: string,
  sourceTrace: string
): {
  replay: ReplayTuple[];
  trapFrames: TrapFrame[];
} {
  const replay: ReplayTuple[] = [];
  const trapFrames: TrapFrame[] = [];
  const lines = journalRaw.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim();
    if (!line) {
      continue;
    }

    const replayMatch = line.match(/\[REPLAY_TUPLE\]\s*(\{.*\})$/);
    if (replayMatch?.[1]) {
      try {
        const parsed = JSON.parse(replayMatch[1]) as Record<string, unknown>;
        const a_t = asRecord(parsed.a_t);
        if (!a_t || typeof a_t.op !== 'string') {
          continue;
        }
        const q_t = typeof parsed.q_t === 'string' ? parsed.q_t : '';
        const s_t = typeof parsed.s_t === 'string' ? parsed.s_t : '';
        const d_t = typeof parsed.d_t === 'string' ? parsed.d_t : '';
        const q_next = typeof parsed.q_next === 'string' ? parsed.q_next : '';
        if (!q_t || !s_t || !d_t || !q_next) {
          continue;
        }
        const tickSeqRaw = parsed.tick_seq;
        const tick_seq = typeof tickSeqRaw === 'number' && Number.isFinite(tickSeqRaw) ? tickSeqRaw : null;
        replay.push({
          lineIndex: i,
          q_t,
          s_t,
          d_t,
          q_next,
          a_t,
          tick_seq,
          source_trace: sourceTrace,
        });
      } catch {
        // Ignore malformed replay tuple line.
      }
      continue;
    }

    const trapMatch = line.match(/\[TRAP_FRAME\]\s*(\{.*\})$/);
    if (trapMatch?.[1]) {
      try {
        const parsed = JSON.parse(trapMatch[1]) as Record<string, unknown>;
        const trap_base = typeof parsed.trap_base === 'string' ? parsed.trap_base : '';
        const trap_pointer = typeof parsed.trap_pointer === 'string' ? parsed.trap_pointer : '';
        const details = typeof parsed.details === 'string' ? parsed.details : '';
        if (!trap_base || !trap_pointer || !details) {
          continue;
        }
        const seqRaw = parsed.seq;
        const panicRaw = parsed.panic_reset_count;
        trapFrames.push({
          lineIndex: i,
          seq: typeof seqRaw === 'number' && Number.isFinite(seqRaw) ? seqRaw : null,
          trap_base,
          trap_pointer,
          details,
          panic_reset_count: typeof panicRaw === 'number' && Number.isFinite(panicRaw) ? panicRaw : null,
          source_trace: sourceTrace,
        });
      } catch {
        // Ignore malformed trap frame line.
      }
    }
  }

  return { replay, trapFrames };
}

function buildPolicyRows(replay: ReplayTuple[]): PolicyRow[] {
  return replay.map((tuple) => ({
    task: 'syscall_policy',
    input: {
      q_t: tuple.q_t,
      s_t: tuple.s_t,
      d_t: tuple.d_t,
    },
    output: {
      q_next: tuple.q_next,
      a_t: tuple.a_t,
    },
    meta: {
      source_trace: tuple.source_trace,
      tick_seq: tuple.tick_seq,
    },
  }));
}

function buildReflexRows(replay: ReplayTuple[], trapFrames: TrapFrame[]): ReflexRow[] {
  const rows: ReflexRow[] = [];
  const sortedReplay = [...replay].sort((a, b) => a.lineIndex - b.lineIndex);
  for (const trapFrame of trapFrames) {
    const follow = sortedReplay.find((tuple) => tuple.lineIndex > trapFrame.lineIndex);
    if (!follow) {
      continue;
    }
    rows.push({
      task: 'guard_reflex',
      input: {
        trap_frame: {
          trap_base: trapFrame.trap_base,
          trap_pointer: trapFrame.trap_pointer,
          details: trapFrame.details,
          panic_reset_count: trapFrame.panic_reset_count,
        },
        instruction:
          'Emit exactly one recovery syscall frame. Respect fail-closed ABI and avoid repeating the trap cause.',
      },
      output: {
        q_next: follow.q_next,
        a_t: follow.a_t,
      },
      meta: {
        source_trace: trapFrame.source_trace,
        trap_seq: trapFrame.seq,
        follow_tick_seq: follow.tick_seq,
      },
    });
  }
  return rows;
}

function toMarkdown(summary: DatasetSummary): string {
  const opcodeLines = Object.entries(summary.opcodeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([op, count]) => `- ${op}: ${count}`)
    .join('\n');
  const trapLines = Object.entries(summary.trapBaseCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([trap, count]) => `- ${trap}: ${count}`)
    .join('\n');

  return [
    '# Guard SFT Dataset Report',
    '',
    `- stamp: ${summary.stamp}`,
    `- roots: ${summary.roots.join(', ')}`,
    `- scanned_traces: ${summary.scannedTraces}`,
    `- policy_rows: ${summary.policyRows}`,
    `- reflex_rows: ${summary.reflexRows}`,
    `- min_policy_rows: ${summary.minPolicyRows}`,
    `- min_reflex_rows: ${summary.minReflexRows}`,
    `- pass: ${summary.pass}`,
    `- policy_output: ${summary.policyOutput}`,
    `- reflex_output: ${summary.reflexOutput}`,
    '',
    '## Opcode Distribution',
    '',
    opcodeLines.length > 0 ? opcodeLines : '- (empty)',
    '',
    '## Trap Distribution',
    '',
    trapLines.length > 0 ? trapLines : '- (empty)',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(AUDIT_DIR, { recursive: true });

  const policyRows: PolicyRow[] = [];
  const reflexRows: ReflexRow[] = [];
  const opcodeCounts: Record<string, number> = {};
  const trapBaseCounts: Record<string, number> = {};
  const scannedTraces = new Set<string>();

  for (const root of args.roots) {
    const files = await listFilesRecursive(root);
    const traces = files.filter((filePath) => path.basename(filePath).endsWith('.journal.log'));
    for (const tracePath of traces) {
      const raw = await fsp.readFile(tracePath, 'utf-8');
      const parsed = parseJournal(raw, tracePath);
      if (parsed.replay.length === 0 && parsed.trapFrames.length === 0) {
        continue;
      }

      scannedTraces.add(tracePath);
      const policy = buildPolicyRows(parsed.replay);
      const reflex = buildReflexRows(parsed.replay, parsed.trapFrames);
      policyRows.push(...policy);
      reflexRows.push(...reflex);

      for (const row of policy) {
        const op = typeof row.output.a_t.op === 'string' ? row.output.a_t.op : 'UNKNOWN';
        opcodeCounts[op] = (opcodeCounts[op] ?? 0) + 1;
      }
      for (const frame of parsed.trapFrames) {
        trapBaseCounts[frame.trap_base] = (trapBaseCounts[frame.trap_base] ?? 0) + 1;
      }
    }
  }

  await fsp.mkdir(path.dirname(args.policyOutput), { recursive: true });
  await fsp.mkdir(path.dirname(args.reflexOutput), { recursive: true });
  await fsp.writeFile(args.policyOutput, `${policyRows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf-8');
  await fsp.writeFile(args.reflexOutput, `${reflexRows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf-8');

  const stamp = timestamp();
  const reportJsonPath = path.join(AUDIT_DIR, `guard_sft_dataset_${stamp}.json`);
  const reportMdPath = path.join(AUDIT_DIR, `guard_sft_dataset_${stamp}.md`);
  const summary: DatasetSummary = {
    stamp,
    roots: args.roots,
    scannedTraces: scannedTraces.size,
    policyRows: policyRows.length,
    reflexRows: reflexRows.length,
    minPolicyRows: args.minPolicyRows,
    minReflexRows: args.minReflexRows,
    pass: policyRows.length >= args.minPolicyRows && reflexRows.length >= args.minReflexRows,
    policyOutput: args.policyOutput,
    reflexOutput: args.reflexOutput,
    opcodeCounts,
    trapBaseCounts,
    reportJsonPath,
    reportMdPath,
  };

  await fsp.writeFile(reportJsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
  await fsp.writeFile(reportMdPath, `${toMarkdown(summary)}\n`, 'utf-8');
  await fsp.writeFile(LATEST_SUMMARY, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');

  console.log(
    `[guard-sft-dataset] policy_rows=${summary.policyRows} reflex_rows=${summary.reflexRows} scanned_traces=${summary.scannedTraces} pass=${summary.pass}`
  );
  console.log(`[guard-sft-dataset] policy_output=${summary.policyOutput}`);
  console.log(`[guard-sft-dataset] reflex_output=${summary.reflexOutput}`);
  console.log(`[guard-sft-dataset] report_json=${reportJsonPath}`);
  console.log(`[guard-sft-dataset] report_md=${reportMdPath}`);
  process.exit(summary.pass ? 0 : 2);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[guard-sft-dataset] fatal: ${message}`);
  process.exit(1);
});
