import fs from 'node:fs/promises';
import path from 'node:path';

interface SplitManifest {
  outDir: string;
  policy: {
    files: {
      train: string;
      val: string;
      test: string;
    };
  };
  reflex: {
    files: {
      train: string;
      val: string;
      test: string;
    };
  };
}

interface PolicyRow {
  input: {
    q_t: string;
    d_t: string;
    s_t: string;
  };
  output: {
    q_next: string;
    a_t: Record<string, unknown>;
  };
}

interface ReflexRow {
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
}

interface MlxSample {
  prompt: string;
  completion: string;
}

interface PrepareReport {
  generatedAt: string;
  outputDir: string;
  counts: {
    train: number;
    valid: number;
    test: number;
  };
  source: {
    manifest: string;
    policyTrain: string;
    policyVal: string;
    policyTest: string;
    reflexTrain: string;
    reflexVal: string;
    reflexTest: string;
  };
}

const ROOT = path.resolve(process.cwd());
const SFT_SPLIT_MANIFEST = path.join(ROOT, 'benchmarks', 'data', 'sft', 'splits', 'latest_manifest.json');
const OUTPUT_BASE = path.join(ROOT, 'benchmarks', 'data', 'sft', 'mlx');

function parseArgs(argv: string[]): { outDir?: string; seed: number; maxPerSplit: number } {
  let outDir: string | undefined;
  let seed = 20260227;
  let maxPerSplit = 0;
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      continue;
    }
    if (key === '--out-dir') {
      outDir = value;
      i += 1;
      continue;
    }
    if (key === '--seed') {
      seed = Number.parseInt(value, 10);
      i += 1;
      continue;
    }
    if (key === '--max-per-split') {
      maxPerSplit = Number.parseInt(value, 10);
      i += 1;
    }
  }
  if (!Number.isFinite(seed)) {
    seed = 20260227;
  }
  if (!Number.isFinite(maxPerSplit) || maxPerSplit < 0) {
    maxPerSplit = 0;
  }
  return { outDir, seed, maxPerSplit };
}

function mkPromptPolicy(row: PolicyRow): string {
  return [
    'You are TuringOS ALU. Return ONE strict JSON object with keys: q_next, mind_ops, world_op.',
    'Rules:',
    '- mind_ops op only SYS_PUSH|SYS_POP|SYS_EDIT|SYS_MOVE',
    '- world_op op only SYS_WRITE|SYS_EXEC|SYS_GOTO|SYS_GIT_LOG|SYS_HALT',
    '- fail-closed ABI; no extra keys',
    '',
    `[q_t] ${row.input.q_t}`,
    `[d_t] ${row.input.d_t}`,
    '[s_t]',
    row.input.s_t,
  ].join('\n');
}

function mkPromptReflex(row: ReflexRow): string {
  const trap = row.input.trap_frame;
  return [
    'You are Turing Guard MCU. Return ONE strict JSON object with keys: q_next, mind_ops, world_op.',
    'Given trap context, produce a recovery action without repeating the trap cause.',
    '',
    `[trap_base] ${trap.trap_base}`,
    `[trap_pointer] ${trap.trap_pointer}`,
    `[trap_details] ${trap.details}`,
    `[panic_reset_count] ${trap.panic_reset_count ?? 0}`,
    `[instruction] ${row.input.instruction}`,
  ].join('\n');
}

function toCompletion(qNext: string, a_t: Record<string, unknown>): string {
  const op = typeof a_t.op === 'string' ? a_t.op : '';
  const worldOps = new Set(['SYS_WRITE', 'SYS_EXEC', 'SYS_GOTO', 'SYS_GIT_LOG', 'SYS_HALT']);
  const payload = {
    q_next: qNext,
    mind_ops: worldOps.has(op) ? [] : [a_t],
    world_op: worldOps.has(op) ? a_t : null,
  };
  return JSON.stringify(payload);
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function shuffled<T>(items: T[], rnd: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function combineSplit(
  policyRows: PolicyRow[],
  reflexRows: ReflexRow[],
  rnd: () => number,
  maxPerSplit: number
): MlxSample[] {
  const policy = policyRows.map((row) => ({
    prompt: mkPromptPolicy(row),
    completion: toCompletion(row.output.q_next, row.output.a_t),
  }));
  const reflex = reflexRows.map((row) => ({
    prompt: mkPromptReflex(row),
    completion: toCompletion(row.output.q_next, row.output.a_t),
  }));

  const merged = shuffled([...policy, ...reflex], rnd);
  if (maxPerSplit > 0 && merged.length > maxPerSplit) {
    return merged.slice(0, maxPerSplit);
  }
  return merged;
}

async function writeJsonl(filePath: string, rows: MlxSample[]): Promise<void> {
  const payload = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
  await fs.writeFile(filePath, payload, 'utf-8');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifestRaw = await fs.readFile(SFT_SPLIT_MANIFEST, 'utf-8');
  const manifest = JSON.parse(manifestRaw) as SplitManifest;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const outDir = args.outDir
    ? path.isAbsolute(args.outDir)
      ? args.outDir
      : path.join(ROOT, args.outDir)
    : path.join(OUTPUT_BASE, `mlx_sft_${stamp}`);
  await fs.mkdir(outDir, { recursive: true });

  const trainPolicy = await readJsonl<PolicyRow>(manifest.policy.files.train);
  const valPolicy = await readJsonl<PolicyRow>(manifest.policy.files.val);
  const testPolicy = await readJsonl<PolicyRow>(manifest.policy.files.test);
  const trainReflex = await readJsonl<ReflexRow>(manifest.reflex.files.train);
  const valReflex = await readJsonl<ReflexRow>(manifest.reflex.files.val);
  const testReflex = await readJsonl<ReflexRow>(manifest.reflex.files.test);

  const rnd = lcg(args.seed);
  const train = combineSplit(trainPolicy, trainReflex, rnd, args.maxPerSplit);
  const valid = combineSplit(valPolicy, valReflex, rnd, args.maxPerSplit);
  const test = combineSplit(testPolicy, testReflex, rnd, args.maxPerSplit);

  await writeJsonl(path.join(outDir, 'train.jsonl'), train);
  await writeJsonl(path.join(outDir, 'valid.jsonl'), valid);
  await writeJsonl(path.join(outDir, 'test.jsonl'), test);

  const report: PrepareReport = {
    generatedAt: new Date().toISOString(),
    outputDir: outDir,
    counts: {
      train: train.length,
      valid: valid.length,
      test: test.length,
    },
    source: {
      manifest: SFT_SPLIT_MANIFEST,
      policyTrain: manifest.policy.files.train,
      policyVal: manifest.policy.files.val,
      policyTest: manifest.policy.files.test,
      reflexTrain: manifest.reflex.files.train,
      reflexVal: manifest.reflex.files.val,
      reflexTest: manifest.reflex.files.test,
    },
  };
  const reportPath = path.join(outDir, 'prepare_report.json');
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');

  console.log(`[prepare-mlx-sft-data] out=${outDir}`);
  console.log(
    `[prepare-mlx-sft-data] train=${train.length} valid=${valid.length} test=${test.length} max_per_split=${args.maxPerSplit}`
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[prepare-mlx-sft-data] fatal: ${message}`);
  process.exitCode = 1;
});
