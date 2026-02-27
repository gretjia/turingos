import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

type LoopMode = 'auto' | 'gold' | 'model';

interface CliArgs {
  mode: LoopMode;
  thresholdProfile: '' | 'prod' | 'dev';
  datasetArgs: string;
  splitArgs: string;
  evalArgs: string;
}

interface StepResult {
  id: string;
  command: string;
  exitCode: number | null;
  ok: boolean;
}

interface LoopReport {
  stamp: string;
  mode: LoopMode;
  resolvedEvalMode: 'gold' | 'model';
  steps: StepResult[];
  pass: boolean;
}

const ROOT = path.resolve(process.cwd());
const SFT_AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'sft');
const LATEST_LOOP_REPORT = path.join(SFT_AUDIT_DIR, 'guard_mcu_loop_latest.json');

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
  let mode: LoopMode = 'auto';
  let thresholdProfile: '' | 'prod' | 'dev' = '';
  let datasetArgs = '';
  let splitArgs = '';
  let evalArgs = '';
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      continue;
    }
    if (key === '--mode' && (value === 'auto' || value === 'gold' || value === 'model')) {
      mode = value;
    }
    if (key === '--threshold-profile' && (value === 'prod' || value === 'dev')) {
      thresholdProfile = value;
    }
    if (key === '--dataset-args') datasetArgs = value;
    if (key === '--split-args') splitArgs = value;
    if (key === '--eval-args') evalArgs = value;
  }
  return { mode, thresholdProfile, datasetArgs, splitArgs, evalArgs };
}

function resolveEvalMode(mode: LoopMode): 'gold' | 'model' {
  if (mode === 'gold' || mode === 'model') {
    return mode;
  }
  const hasModelConfig =
    (process.env.TURINGOS_GUARD_MODEL_BASE_URL ?? '').trim().length > 0 &&
    (process.env.TURINGOS_GUARD_MODEL_NAME ?? '').trim().length > 0 &&
    (
      (process.env.TURINGOS_GUARD_MODEL_API_KEY ?? '').trim().length > 0 ||
      (process.env.OPENAI_API_KEY ?? '').trim().length > 0 ||
      (process.env.KIMI_API_KEY ?? '').trim().length > 0
    );
  return hasModelConfig ? 'model' : 'gold';
}

async function runStep(id: string, command: string): Promise<StepResult> {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], {
      cwd: ROOT,
      env: process.env,
    });
    child.stdout.on('data', (chunk: Buffer) => process.stdout.write(chunk.toString('utf-8')));
    child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk.toString('utf-8')));
    child.on('close', (exitCode) => {
      resolve({
        id,
        command,
        exitCode,
        ok: exitCode === 0,
      });
    });
  });
}

function toMarkdown(report: LoopReport, jsonPath: string): string {
  return [
    '# Guard MCU Loop Report',
    '',
    `- stamp: ${report.stamp}`,
    `- mode: ${report.mode}`,
    `- resolved_eval_mode: ${report.resolvedEvalMode}`,
    `- pass: ${report.pass}`,
    `- report_json: ${jsonPath}`,
    '',
    '| Step | Exit | Result | Command |',
    '|---|---:|---|---|',
    ...report.steps.map((step) => `| ${step.id} | ${step.exitCode ?? -1} | ${step.ok ? 'PASS' : 'FAIL'} | \`${step.command}\` |`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const evalMode = resolveEvalMode(args.mode);
  await fs.mkdir(SFT_AUDIT_DIR, { recursive: true });

  const steps: StepResult[] = [];
  const datasetCmd = `npm run bench:guard-sft-dataset${args.datasetArgs ? ` -- ${args.datasetArgs}` : ''}`;
  const splitCmd = `npm run bench:guard-sft-split${args.splitArgs ? ` -- ${args.splitArgs}` : ''}`;
  const evalCmd = `npm run bench:guard-mcu-eval -- --mode ${evalMode}${
    args.thresholdProfile ? ` --threshold-profile ${args.thresholdProfile}` : ''
  }${args.evalArgs ? ` ${args.evalArgs}` : ''}`;

  steps.push(await runStep('build_dataset', datasetCmd));
  if (!steps[steps.length - 1].ok) {
    const report: LoopReport = {
      stamp: timestamp(),
      mode: args.mode,
      resolvedEvalMode: evalMode,
      steps,
      pass: false,
    };
    const jsonPath = path.join(SFT_AUDIT_DIR, `guard_mcu_loop_${report.stamp}.json`);
    const mdPath = path.join(SFT_AUDIT_DIR, `guard_mcu_loop_${report.stamp}.md`);
    await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
    await fs.writeFile(mdPath, `${toMarkdown(report, jsonPath)}\n`, 'utf-8');
    await fs.writeFile(LATEST_LOOP_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
    process.exitCode = 2;
    return;
  }

  steps.push(await runStep('split_dataset', splitCmd));
  steps.push(await runStep('eval_guard_mcu', evalCmd));

  const report: LoopReport = {
    stamp: timestamp(),
    mode: args.mode,
    resolvedEvalMode: evalMode,
    steps,
    pass: steps.every((step) => step.ok),
  };
  const jsonPath = path.join(SFT_AUDIT_DIR, `guard_mcu_loop_${report.stamp}.json`);
  const mdPath = path.join(SFT_AUDIT_DIR, `guard_mcu_loop_${report.stamp}.md`);
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(mdPath, `${toMarkdown(report, jsonPath)}\n`, 'utf-8');
  await fs.writeFile(LATEST_LOOP_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');

  console.log(`[guard-mcu-loop] mode=${report.mode} resolved=${report.resolvedEvalMode} pass=${report.pass}`);
  console.log(`[guard-mcu-loop] report=${jsonPath}`);
  process.exit(report.pass ? 0 : 2);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[guard-mcu-loop] fatal: ${message}`);
  process.exit(1);
});
