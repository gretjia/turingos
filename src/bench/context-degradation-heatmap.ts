import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

interface ReplayTuple {
  tick_seq?: number;
  s_t?: string;
  d_t?: string;
  d_next?: string;
  q_t?: string;
  q_next?: string;
  mind_ops?: Array<{ op?: string }>;
  world_op?: { op?: string } | null;
}

interface TickPoint {
  tick: number;
  contextLength: number;
  clipped: boolean;
  trapLike: boolean;
  pageLike: boolean;
  mindOps: number;
  hasWorldOp: boolean;
}

interface HeatmapReport {
  generatedAt: string;
  inputPath: string;
  ticks: number;
  context: {
    min: number;
    max: number;
    avg: number;
    p95: number;
    slopePerTick: number;
  };
  clipping: {
    clippedTicks: number;
    clippedRate: number;
  };
  traps: {
    trapLikeTicks: number;
    trapLikeRate: number;
  };
  pagination: {
    pageLikeTicks: number;
    pageLikeRate: number;
  };
  runqueue: {
    avgMindOpsPerTick: number;
    worldOpRate: number;
  };
  heatmap: {
    bins: Array<{ fromTick: number; toTick: number; avgLength: number; intensity: string }>;
    sparkline: string;
  };
  points: TickPoint[];
}

const ROOT = path.resolve(process.cwd());
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'longrun');

function parseArgs(argv: string[]): { input?: string; output?: string; mdOutput?: string; bins?: number } {
  const out: { input?: string; output?: string; mdOutput?: string; bins?: number } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const value = argv[i + 1];
    if (!token?.startsWith('--') || value === undefined) {
      continue;
    }
    if (token === '--input') {
      out.input = value;
      i += 1;
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
    if (token === '--bins') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        out.bins = parsed;
      }
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

function intensityChar(ratio: number): string {
  const palette = ' .:-=+*#%@';
  const idx = Math.max(0, Math.min(palette.length - 1, Math.floor(ratio * (palette.length - 1))));
  return palette[idx] ?? ' ';
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

function toMarkdown(report: HeatmapReport, jsonPath: string): string {
  return [
    '# Context Degradation Heatmap',
    '',
    `- generated_at: ${report.generatedAt}`,
    `- input: ${report.inputPath}`,
    `- report_json: ${jsonPath}`,
    `- ticks: ${report.ticks}`,
    '',
    '## Context',
    '',
    `- min: ${report.context.min}`,
    `- max: ${report.context.max}`,
    `- avg: ${report.context.avg}`,
    `- p95: ${report.context.p95}`,
    `- slope_per_tick: ${report.context.slopePerTick}`,
    '',
    '## Operational Signals',
    '',
    `- clipped_ticks: ${report.clipping.clippedTicks} (${report.clipping.clippedRate})`,
    `- trap_like_ticks: ${report.traps.trapLikeTicks} (${report.traps.trapLikeRate})`,
    `- page_like_ticks: ${report.pagination.pageLikeTicks} (${report.pagination.pageLikeRate})`,
    `- avg_mind_ops_per_tick: ${report.runqueue.avgMindOpsPerTick}`,
    `- world_op_rate: ${report.runqueue.worldOpRate}`,
    '',
    '## Heatmap',
    '',
    `- sparkline: \`${report.heatmap.sparkline}\``,
    '',
    '| Bin | Tick Range | Avg Length | Intensity |',
    '|---|---:|---:|:---:|',
    ...report.heatmap.bins.map((bin, idx) => `| ${idx + 1} | ${bin.fromTick}-${bin.toTick} | ${bin.avgLength} | ${bin.intensity} |`),
    '',
    '## Note',
    '',
    '- `clipped_ticks` 是 eviction/截断行为的代理指标（通过 `[OS_SECTION_CLIPPED]` 检测）。',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  const inputPath = await resolveInputPath(args.input);
  const outputPath = args.output
    ? path.isAbsolute(args.output)
      ? args.output
      : path.join(ROOT, args.output)
    : path.join(AUDIT_DIR, 'context_degradation_heatmap_latest.json');
  const mdOutputPath = args.mdOutput
    ? path.isAbsolute(args.mdOutput)
      ? args.mdOutput
      : path.join(ROOT, args.mdOutput)
    : path.join(AUDIT_DIR, 'context_degradation_heatmap_latest.md');
  const binCount = args.bins ?? 24;

  const raw = await fs.readFile(inputPath, 'utf-8');
  const rows = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const tuples: ReplayTuple[] = [];
  for (const line of rows) {
    try {
      tuples.push(JSON.parse(line) as ReplayTuple);
    } catch {
      // ignore malformed
    }
  }

  const points: TickPoint[] = tuples.map((tuple, idx) => {
    const tick = typeof tuple.tick_seq === 'number' ? tuple.tick_seq : idx;
    const s = typeof tuple.s_t === 'string' ? tuple.s_t : '';
    const mindOps = Array.isArray(tuple.mind_ops) ? tuple.mind_ops.length : 0;
    const worldOp = tuple.world_op?.op;
    return {
      tick,
      contextLength: s.length,
      clipped: s.includes('[OS_SECTION_CLIPPED]'),
      trapLike: s.includes('[OS_TRAP:') || s.includes('[OS_PANIC:') || s.includes('sys://trap/'),
      pageLike: s.includes('[PAGE_TABLE_SUMMARY]') || (typeof tuple.d_t === 'string' && tuple.d_t.startsWith('sys://page/')),
      mindOps,
      hasWorldOp: typeof worldOp === 'string' && worldOp.length > 0,
    };
  });

  const lengths = points.map((p) => p.contextLength);
  const min = lengths.length > 0 ? Math.min(...lengths) : 0;
  const max = lengths.length > 0 ? Math.max(...lengths) : 0;
  const avg = lengths.length > 0 ? Number((lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(2)) : 0;
  const p95 = percentile(lengths, 0.95);
  const clippedTicks = points.filter((p) => p.clipped).length;
  const trapLikeTicks = points.filter((p) => p.trapLike).length;
  const pageLikeTicks = points.filter((p) => p.pageLike).length;
  const avgMindOpsPerTick = points.length > 0 ? Number((points.reduce((a, p) => a + p.mindOps, 0) / points.length).toFixed(3)) : 0;
  const worldOpRate = points.length > 0 ? Number((points.filter((p) => p.hasWorldOp).length / points.length).toFixed(4)) : 0;

  const bins = Math.max(1, Math.min(binCount, points.length || 1));
  const chunkSize = Math.max(1, Math.ceil((points.length || 1) / bins));
  const heatBins: HeatmapReport['heatmap']['bins'] = [];
  for (let i = 0; i < points.length; i += chunkSize) {
    const chunk = points.slice(i, i + chunkSize);
    if (chunk.length === 0) {
      continue;
    }
    const chunkAvg = Math.round(chunk.reduce((a, p) => a + p.contextLength, 0) / chunk.length);
    const ratio = max > 0 ? chunkAvg / max : 0;
    heatBins.push({
      fromTick: chunk[0]?.tick ?? 0,
      toTick: chunk[chunk.length - 1]?.tick ?? chunk[0]?.tick ?? 0,
      avgLength: chunkAvg,
      intensity: intensityChar(ratio),
    });
  }

  const sparkline = heatBins.map((bin) => bin.intensity).join('');
  const report: HeatmapReport = {
    generatedAt: new Date().toISOString(),
    inputPath,
    ticks: points.length,
    context: {
      min,
      max,
      avg,
      p95,
      slopePerTick: slope(lengths),
    },
    clipping: {
      clippedTicks,
      clippedRate: points.length > 0 ? Number((clippedTicks / points.length).toFixed(4)) : 0,
    },
    traps: {
      trapLikeTicks,
      trapLikeRate: points.length > 0 ? Number((trapLikeTicks / points.length).toFixed(4)) : 0,
    },
    pagination: {
      pageLikeTicks,
      pageLikeRate: points.length > 0 ? Number((pageLikeTicks / points.length).toFixed(4)) : 0,
    },
    runqueue: {
      avgMindOpsPerTick,
      worldOpRate,
    },
    heatmap: {
      bins: heatBins,
      sparkline,
    },
    points,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(mdOutputPath, `${toMarkdown(report, outputPath)}\n`, 'utf-8');
  console.log(`[context-degradation-heatmap] input=${inputPath}`);
  console.log(`[context-degradation-heatmap] ticks=${report.ticks} bins=${report.heatmap.bins.length}`);
  console.log(`[context-degradation-heatmap] output=${outputPath}`);
  console.log(`[context-degradation-heatmap] md_output=${mdOutputPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[context-degradation-heatmap] fatal: ${message}`);
  process.exitCode = 1;
});
