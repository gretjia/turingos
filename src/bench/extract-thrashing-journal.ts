import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

interface ReplayTuple {
  tick_seq?: number;
  q_t?: string;
  q_next?: string;
  d_t?: string;
  d_next?: string;
  observed_slice?: string;
  s_t?: string;
  mind_ops?: Array<{ op?: string }>;
  world_op?: { op?: string } | null;
  world_ops?: Array<{ op?: string }>;
  a_t?: { op?: string };
}

interface TrapEvent {
  tick: number;
  marker: string;
  d_t: string;
  d_next: string;
  a_t: string;
  mind_ops: string[];
  world_op: string | null;
  snippet: string;
}

interface ContextPoint {
  tick: number;
  length: number;
  mindOps: number;
  hasWorldOp: boolean;
}

const ROOT = path.resolve(process.cwd());
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'longrun');

function parseArgs(argv: string[]): { input?: string; output?: string; contextOutput?: string } {
  const out: { input?: string; output?: string; contextOutput?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--input' && i + 1 < argv.length) {
      out.input = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--output' && i + 1 < argv.length) {
      out.output = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--context-output' && i + 1 < argv.length) {
      out.contextOutput = argv[i + 1];
      i += 1;
      continue;
    }
  }
  return out;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}

function slope(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }
  return Number(((values[values.length - 1] - values[0]) / (values.length - 1)).toFixed(4));
}

async function resolveInputPath(inputArg?: string): Promise<string> {
  if (inputArg && inputArg.trim().length > 0) {
    const candidate = path.isAbsolute(inputArg) ? inputArg : path.join(ROOT, inputArg);
    await fs.access(candidate);
    return candidate;
  }

  const files = await fs.readdir(AUDIT_DIR);
  const traces = files
    .filter((name) => /^voyager_realworld_trace_\d{8}_\d{6}\.jsonl$/.test(name))
    .sort()
    .reverse();

  if (traces.length > 0) {
    return path.join(AUDIT_DIR, traces[0]);
  }

  const fallback = path.join(AUDIT_DIR, 'trace.jsonl');
  await fs.access(fallback);
  return fallback;
}

function detectMarkers(blob: string): string[] {
  const markers: Array<{ key: string; pattern: RegExp }> = [
    { key: 'OS_TRAP: THRASHING', pattern: /OS_TRAP:\s*THRASHING/i },
    { key: 'OS_TRAP: WATCHDOG_NMI', pattern: /OS_TRAP:\s*WATCHDOG_NMI/i },
    { key: 'OS_TRAP: L1_CACHE_HIT', pattern: /OS_TRAP:\s*L1_CACHE_HIT/i },
    { key: 'OS_PANIC', pattern: /OS_PANIC/i },
    { key: 'sys://trap/panic_reset', pattern: /sys:\/\/trap\/panic_reset/i },
    { key: 'sys://trap/unrecoverable_loop', pattern: /sys:\/\/trap\/unrecoverable_loop/i },
  ];

  const hit: string[] = [];
  for (const marker of markers) {
    if (marker.pattern.test(blob)) {
      hit.push(marker.key);
    }
  }
  return hit;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(AUDIT_DIR, { recursive: true });

  const inputPath = await resolveInputPath(args.input);
  const outputPath = args.output
    ? path.isAbsolute(args.output)
      ? args.output
      : path.join(ROOT, args.output)
    : path.join(AUDIT_DIR, 'thrashing.journal');
  const contextOutputPath = args.contextOutput
    ? path.isAbsolute(args.contextOutput)
      ? args.contextOutput
      : path.join(ROOT, args.contextOutput)
    : path.join(AUDIT_DIR, 'context_decay_profile.json');

  const raw = await fs.readFile(inputPath, 'utf-8');
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const tuples: ReplayTuple[] = [];
  for (const line of lines) {
    try {
      tuples.push(JSON.parse(line) as ReplayTuple);
    } catch {
      // Skip malformed row.
    }
  }

  const events: TrapEvent[] = [];
  const contextPoints: ContextPoint[] = [];

  for (let idx = 0; idx < tuples.length; idx += 1) {
    const tuple = tuples[idx];
    const tick = typeof tuple.tick_seq === 'number' ? tuple.tick_seq : idx;
    const s_t = typeof tuple.s_t === 'string' ? tuple.s_t : '';
    const observed = typeof tuple.observed_slice === 'string' ? tuple.observed_slice : '';
    const blob = [observed, s_t, tuple.q_t ?? '', tuple.q_next ?? '', tuple.d_t ?? '', tuple.d_next ?? ''].join('\n');

    const mindOps = Array.isArray(tuple.mind_ops)
      ? tuple.mind_ops
          .map((op) => (typeof op?.op === 'string' ? op.op : ''))
          .filter((op) => op.length > 0)
      : [];
    const worldOp = typeof tuple.world_op?.op === 'string' ? tuple.world_op.op : null;
    const actionOp = typeof tuple.a_t?.op === 'string' ? tuple.a_t.op : '(none)';

    contextPoints.push({
      tick,
      length: s_t.length,
      mindOps: mindOps.length,
      hasWorldOp: worldOp !== null,
    });

    const markers = detectMarkers(blob);
    if (markers.length === 0) {
      continue;
    }

    const compact = blob.replace(/\s+/g, ' ').slice(0, 320);
    for (const marker of markers) {
      events.push({
        tick,
        marker,
        d_t: tuple.d_t ?? '',
        d_next: tuple.d_next ?? '',
        a_t: actionOp,
        mind_ops: mindOps,
        world_op: worldOp,
        snippet: compact,
      });
    }
  }

  const lengths = contextPoints.map((point) => point.length);
  const minLen = lengths.length > 0 ? Math.min(...lengths) : 0;
  const maxLen = lengths.length > 0 ? Math.max(...lengths) : 0;
  const avgLen =
    lengths.length > 0 ? Number((lengths.reduce((sum, value) => sum + value, 0) / lengths.length).toFixed(2)) : 0;
  const p95Len = percentile(lengths, 0.95);

  const profile = {
    inputPath,
    generatedAt: new Date().toISOString(),
    ticks: contextPoints.length,
    context: {
      min: minLen,
      max: maxLen,
      avg: avgLen,
      p95: p95Len,
      slopePerTick: slope(lengths),
    },
    traps: {
      totalEvents: events.length,
      byMarker: events.reduce<Record<string, number>>((acc, event) => {
        acc[event.marker] = (acc[event.marker] ?? 0) + 1;
        return acc;
      }, {}),
    },
    points: contextPoints,
  };

  const journalLines = [
    `# thrashing journal generated_at=${profile.generatedAt} input=${path.relative(ROOT, inputPath)}`,
    ...events.map((event) => JSON.stringify(event)),
  ];

  await fs.writeFile(outputPath, `${journalLines.join('\n')}\n`, 'utf-8');
  await fs.writeFile(contextOutputPath, `${JSON.stringify(profile, null, 2)}\n`, 'utf-8');

  console.log(`[extract-thrashing-journal] input=${inputPath}`);
  console.log(`[extract-thrashing-journal] events=${events.length} output=${outputPath}`);
  console.log(`[extract-thrashing-journal] context_output=${contextOutputPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[extract-thrashing-journal] fatal: ${message}`);
  process.exitCode = 1;
});
