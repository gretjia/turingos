import fs from 'node:fs/promises';
import path from 'node:path';

type Tier = 'P0' | 'P1';

interface MatrixBenchmark {
  id: string;
  tier: Tier;
  name: string;
  weight: number;
  metric: string;
  threshold: number;
  command: string;
  sources: string[];
}

interface MatrixPolicy {
  hardRequirements: string[];
  weightedGoScore: number;
}

interface MatrixConfig {
  version: string;
  owner: string;
  updatedAt: string;
  decisionPolicy: MatrixPolicy;
  benchmarks: MatrixBenchmark[];
}

interface ScoreInputItem {
  id: string;
  value: number;
  evidence?: string;
  note?: string;
}

interface ScoreInput {
  runStamp?: string;
  model?: string;
  results: ScoreInputItem[];
}

interface ScoreRow {
  id: string;
  tier: Tier;
  metric: string;
  threshold: number;
  weight: number;
  value: number | null;
  normalized: number;
  status: 'pass' | 'fail' | 'not_run';
  evidence?: string;
}

interface ParsedArgs {
  mode: 'plan' | 'template' | 'score';
  configPath: string;
  scoreFile?: string;
  out?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  let mode: ParsedArgs['mode'] = 'plan';
  let configPath = path.join(process.cwd(), 'benchmarks', 'industry-consensus', 'matrix.v1.json');
  let scoreFile: string | undefined;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith('--')) continue;

    if (key === '--mode' && value && (value === 'plan' || value === 'template' || value === 'score')) {
      mode = value;
    }

    if (key === '--config' && value) {
      configPath = path.resolve(value);
    }

    if (key === '--score-file' && value) {
      scoreFile = path.resolve(value);
    }

    if (key === '--out' && value) {
      out = path.resolve(value);
    }
  }

  return { mode, configPath, scoreFile, out };
}

function timestamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

async function readConfig(configPath: string): Promise<MatrixConfig> {
  const raw = await fs.readFile(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as MatrixConfig;
  if (!Array.isArray(parsed.benchmarks) || parsed.benchmarks.length === 0) {
    throw new Error(`Invalid matrix config: ${configPath}`);
  }
  return parsed;
}

function toPlanMarkdown(config: MatrixConfig): string {
  const lines = [
    '# Industry Consensus AI OS Matrix Plan',
    '',
    `- version: ${config.version}`,
    `- owner: ${config.owner}`,
    `- updatedAt: ${config.updatedAt}`,
    `- weightedGoScore: ${config.decisionPolicy.weightedGoScore}`,
    '',
    '## Benchmarks',
    '',
    '| id | tier | metric | threshold | weight |',
    '|---|---|---|---:|---:|',
    ...config.benchmarks.map((b) => `| ${b.id} | ${b.tier} | ${b.metric} | ${b.threshold} | ${b.weight} |`),
    '',
    '## Runbook (template commands)',
    '',
    ...config.benchmarks.flatMap((b) => [
      `### ${b.id} (${b.name})`,
      `- command: \`${b.command}\``,
      `- metric: ${b.metric}`,
      `- threshold: ${b.threshold}`,
      `- sources: ${b.sources.join(' ; ')}`,
      '',
    ]),
  ];

  return `${lines.join('\n')}\n`;
}

function defaultTemplate(config: MatrixConfig): ScoreInput {
  return {
    runStamp: timestamp(),
    model: 'fill-model-id',
    results: config.benchmarks.map((b) => ({
      id: b.id,
      value: 0,
      evidence: 'path/to/raw/result.json',
      note: `fill ${b.metric}`,
    })),
  };
}

function evaluate(config: MatrixConfig, input: ScoreInput): {
  rows: ScoreRow[];
  weightedAttainment: number;
  p0AllExecuted: boolean;
  p0AllPass: boolean;
  go: boolean;
} {
  const byId = new Map(input.results.map((item) => [item.id, item]));

  const rows: ScoreRow[] = config.benchmarks.map((b) => {
    const item = byId.get(b.id);
    const value = typeof item?.value === 'number' && Number.isFinite(item.value) ? item.value : null;

    if (value === null) {
      return {
        id: b.id,
        tier: b.tier,
        metric: b.metric,
        threshold: b.threshold,
        weight: b.weight,
        value: null,
        normalized: 0,
        status: 'not_run',
        evidence: item?.evidence,
      };
    }

    const normalized = Math.max(0, Math.min(1, value / Math.max(b.threshold, Number.EPSILON)));
    const status: ScoreRow['status'] = value >= b.threshold ? 'pass' : 'fail';

    return {
      id: b.id,
      tier: b.tier,
      metric: b.metric,
      threshold: b.threshold,
      weight: b.weight,
      value,
      normalized: Number(normalized.toFixed(4)),
      status,
      evidence: item?.evidence,
    };
  });

  const weightedAttainment = Number(
    rows.reduce((sum, row) => sum + row.weight * row.normalized, 0).toFixed(4)
  );

  const p0Rows = rows.filter((row) => row.tier === 'P0');
  const p0AllExecuted = p0Rows.every((row) => row.status !== 'not_run');
  const p0AllPass = p0Rows.every((row) => row.status === 'pass');
  const go = p0AllExecuted && p0AllPass && weightedAttainment >= config.decisionPolicy.weightedGoScore;

  return { rows, weightedAttainment, p0AllExecuted, p0AllPass, go };
}

function toScoreMarkdown(
  config: MatrixConfig,
  input: ScoreInput,
  evalResult: ReturnType<typeof evaluate>,
  jsonPath: string
): string {
  const lines = [
    '# Industry Consensus AI OS Matrix Score',
    '',
    `- runStamp: ${input.runStamp ?? 'unknown'}`,
    `- model: ${input.model ?? 'unknown'}`,
    `- matrixVersion: ${config.version}`,
    `- weightedAttainment: ${evalResult.weightedAttainment}`,
    `- p0AllExecuted: ${evalResult.p0AllExecuted}`,
    `- p0AllPass: ${evalResult.p0AllPass}`,
    `- decision: ${evalResult.go ? 'GO' : 'HOLD'}`,
    '',
    '## Per Benchmark',
    '',
    '| id | tier | metric | threshold | value | normalized | status |',
    '|---|---|---|---:|---:|---:|---|',
    ...evalResult.rows.map((row) => {
      const value = row.value === null ? 'n/a' : String(row.value);
      return `| ${row.id} | ${row.tier} | ${row.metric} | ${row.threshold} | ${value} | ${row.normalized} | ${row.status} |`;
    }),
    '',
    '## Evidence',
    '',
    `- score-json: \`${jsonPath}\``,
  ];

  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = await readConfig(args.configPath);

  if (args.mode === 'plan') {
    const md = toPlanMarkdown(config);
    if (args.out) {
      await fs.writeFile(args.out, md, 'utf-8');
      console.log(`[industry-matrix] wrote plan: ${args.out}`);
    } else {
      process.stdout.write(md);
    }
    return;
  }

  if (args.mode === 'template') {
    const template = defaultTemplate(config);
    const out = args.out ?? path.join(process.cwd(), 'benchmarks', 'industry-consensus', 'score-input.template.json');
    await fs.writeFile(out, `${JSON.stringify(template, null, 2)}\n`, 'utf-8');
    console.log(`[industry-matrix] wrote template: ${out}`);
    return;
  }

  if (!args.scoreFile) {
    throw new Error('score mode requires --score-file <path>');
  }

  const raw = await fs.readFile(args.scoreFile, 'utf-8');
  const input = JSON.parse(raw) as ScoreInput;
  if (!Array.isArray(input.results)) {
    throw new Error(`Invalid score input: ${args.scoreFile}`);
  }

  const runStamp = timestamp();
  const resultsDir = path.join(process.cwd(), 'benchmarks', 'results');
  await fs.mkdir(resultsDir, { recursive: true });

  const evalResult = evaluate(config, input);
  const outJson = args.out ?? path.join(resultsDir, `industry-matrix-score-${runStamp}.json`);
  const outMd = outJson.replace(/\.json$/i, '.md');

  const payload = {
    metadata: {
      scoredAt: new Date().toISOString(),
      matrixVersion: config.version,
      inputFile: args.scoreFile,
      model: input.model ?? null,
      runStamp: input.runStamp ?? null,
    },
    decision: {
      weightedAttainment: evalResult.weightedAttainment,
      weightedGoScore: config.decisionPolicy.weightedGoScore,
      p0AllExecuted: evalResult.p0AllExecuted,
      p0AllPass: evalResult.p0AllPass,
      go: evalResult.go,
    },
    rows: evalResult.rows,
  };

  await fs.writeFile(outJson, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  await fs.writeFile(outMd, toScoreMarkdown(config, input, evalResult, outJson), 'utf-8');

  console.log(`[industry-matrix] decision=${evalResult.go ? 'GO' : 'HOLD'}`);
  console.log(`[industry-matrix] weightedAttainment=${evalResult.weightedAttainment}`);
  console.log(`[industry-matrix] report(json): ${outJson}`);
  console.log(`[industry-matrix] report(md):   ${outMd}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[industry-matrix] fatal: ${message}`);
  process.exitCode = 1;
});
