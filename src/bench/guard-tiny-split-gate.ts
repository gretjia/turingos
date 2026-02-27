import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

type SplitName = 'train' | 'val' | 'test';

interface StepResult {
  id: string;
  command: string;
  exitCode: number | null;
  ok: boolean;
}

interface GateResult {
  name: string;
  pass: boolean;
  details: string;
}

interface GateReport {
  stamp: string;
  pass: boolean;
  results: GateResult[];
  steps: StepResult[];
}

const ROOT = path.resolve(process.cwd());
const SFT_DATA_DIR = path.join(ROOT, 'benchmarks', 'data', 'sft');
const SFT_AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'sft');
const GUARD_AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'guard');
const LATEST_SPLIT_MANIFEST = path.join(SFT_DATA_DIR, 'splits', 'latest_manifest.json');
const LATEST_EVAL_REPORT = path.join(SFT_AUDIT_DIR, 'guard_mcu_eval_latest.json');
const LATEST_GATE_REPORT = path.join(GUARD_AUDIT_DIR, 'guard_tiny_split_gate_latest.json');

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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected object, got ${typeof value}`);
  }
  return value as Record<string, unknown>;
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

function toJsonl(rows: unknown[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

function toMarkdown(report: GateReport, jsonPath: string): string {
  return [
    '# Guard Tiny Split Gate',
    '',
    `- stamp: ${report.stamp}`,
    `- pass: ${report.pass}`,
    `- report_json: ${jsonPath}`,
    '',
    '| Check | Result | Details |',
    '|---|---|---|',
    ...report.results.map((item) => `| ${item.name} | ${item.pass ? 'PASS' : 'FAIL'} | ${item.details} |`),
    '',
    '| Step | Exit | Result | Command |',
    '|---|---:|---|---|',
    ...report.steps.map((step) => `| ${step.id} | ${step.exitCode ?? -1} | ${step.ok ? 'PASS' : 'FAIL'} | \`${step.command}\` |`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const stamp = timestamp();
  await fsp.mkdir(GUARD_AUDIT_DIR, { recursive: true });
  await fsp.mkdir(path.join(SFT_DATA_DIR, 'splits'), { recursive: true });

  const fixtureDir = path.join(SFT_DATA_DIR, `tiny_gate_${stamp}`);
  const splitOutDir = path.join(fixtureDir, 'splits');
  const policyInput = path.join(fixtureDir, 'policy_tiny.jsonl');
  const reflexInput = path.join(fixtureDir, 'reflex_tiny.jsonl');
  await fsp.mkdir(fixtureDir, { recursive: true });

  const policyRows = [
    {
      task: 'syscall_policy',
      input: { q_t: 'q_tiny_policy_1', s_t: '[OBS] tiny-1', d_t: 'disc_tiny' },
      output: { q_next: 'q_tiny_policy_1_next', a_t: { op: 'SYS_POP' } },
    },
    {
      task: 'syscall_policy',
      input: { q_t: 'q_tiny_policy_2', s_t: '[OBS] tiny-2', d_t: 'disc_tiny' },
      output: { q_next: 'q_tiny_policy_2_next', a_t: { op: 'SYS_POP' } },
    },
    {
      task: 'syscall_policy',
      input: { q_t: 'q_tiny_policy_3', s_t: '[OBS] tiny-3', d_t: 'disc_tiny' },
      output: { q_next: 'q_tiny_policy_3_next', a_t: { op: 'SYS_POP' } },
    },
  ];

  const reflexRows = [
    {
      task: 'guard_reflex',
      input: {
        trap_frame: {
          trap_base: 'sys://trap/deadlock',
          trap_pointer: 'MAIN_TAPE.md',
          details: 'deadlock A->B->A detected',
          panic_reset_count: 1,
        },
        instruction: 'recover from deadlock',
      },
      output: { q_next: 'q_reflex_resume_1', a_t: { op: 'SYS_POP' } },
    },
    {
      task: 'guard_reflex',
      input: {
        trap_frame: {
          trap_base: 'sys://trap/thrashing',
          trap_pointer: 'MAIN_TAPE.md',
          details: 'excessive edit/move without world mutation',
          panic_reset_count: 0,
        },
        instruction: 'stop thrashing',
      },
      output: { q_next: 'q_reflex_resume_2', a_t: { op: 'SYS_POP' } },
    },
  ];

  await fsp.writeFile(policyInput, toJsonl(policyRows), 'utf-8');
  await fsp.writeFile(reflexInput, toJsonl(reflexRows), 'utf-8');

  const steps: StepResult[] = [];
  const results: GateResult[] = [];

  const splitCmd = [
    'npm run bench:guard-sft-split --',
    `--policy-input ${shellQuote(policyInput)}`,
    `--reflex-input ${shellQuote(reflexInput)}`,
    `--out-dir ${shellQuote(splitOutDir)}`,
    '--train-pct 80',
    '--val-pct 10',
  ].join(' ');
  const splitStep = await runStep('split_tiny_dataset', splitCmd);
  steps.push(splitStep);
  if (!splitStep.ok) {
    results.push({
      name: 'Tiny split command',
      pass: false,
      details: `split command failed (exit=${splitStep.exitCode ?? -1})`,
    });
  } else {
    results.push({
      name: 'Tiny split command',
      pass: true,
      details: `split command passed (exit=${splitStep.exitCode ?? 0})`,
    });
  }

  let reflexValPath = '';
  if (splitStep.ok) {
    try {
      const manifestRaw = await fsp.readFile(LATEST_SPLIT_MANIFEST, 'utf-8');
      const manifest = asRecord(JSON.parse(manifestRaw));
      const reflex = asRecord(manifest.reflex);
      const reflexCounts = asRecord(reflex.counts);
      const reflexFiles = asRecord(reflex.files);
      const train = Number(reflexCounts.train ?? NaN);
      const val = Number(reflexCounts.val ?? NaN);
      const test = Number(reflexCounts.test ?? NaN);
      assert.equal(train, 1);
      assert.equal(val, 1);
      assert.equal(test, 0);
      reflexValPath = String(reflexFiles.val ?? '');
      assert.ok(reflexValPath.length > 0 && fs.existsSync(reflexValPath), `reflex val file missing: ${reflexValPath}`);
      results.push({
        name: 'Tiny split counts',
        pass: true,
        details: `reflex counts train=${train}, val=${val}, test=${test}`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        name: 'Tiny split counts',
        pass: false,
        details: message,
      });
    }
  }

  const evalCmd = [
    'npm run bench:guard-mcu-eval --',
    '--mode gold',
    `--split-manifest ${shellQuote(LATEST_SPLIT_MANIFEST)}`,
    '--policy-limit 50',
    '--reflex-limit 50',
  ].join(' ');
  const evalStep = await runStep('eval_tiny_dataset', evalCmd);
  steps.push(evalStep);
  if (!evalStep.ok) {
    results.push({
      name: 'Tiny eval command',
      pass: false,
      details: `eval command failed (exit=${evalStep.exitCode ?? -1})`,
    });
  } else {
    results.push({
      name: 'Tiny eval command',
      pass: true,
      details: `eval command passed (exit=${evalStep.exitCode ?? 0})`,
    });
  }

  if (evalStep.ok) {
    try {
      const evalRaw = await fsp.readFile(LATEST_EVAL_REPORT, 'utf-8');
      const evalReport = asRecord(JSON.parse(evalRaw));
      const counts = asRecord(evalReport.counts);
      const metrics = asRecord(evalReport.metrics);
      const selectedSplits = asRecord(evalReport.selectedSplits);

      const pass = evalReport.pass === true;
      assert.equal(pass, true, 'guard_mcu_eval_latest pass=false');

      const reflexTotal = Number(counts.reflexTotal ?? NaN);
      assert.ok(Number.isFinite(reflexTotal) && reflexTotal > 0, `unexpected reflexTotal=${counts.reflexTotal}`);

      const reflexSplit = String(selectedSplits.reflex ?? '');
      assert.ok((['train', 'val', 'test'] as SplitName[]).includes(reflexSplit as SplitName), `invalid split=${reflexSplit}`);

      results.push({
        name: 'Tiny eval report assertions',
        pass: true,
        details: `reflexTotal=${reflexTotal}, selected_reflex_split=${reflexSplit}, valid_json_rate=${metrics.validJsonRate}`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        name: 'Tiny eval report assertions',
        pass: false,
        details: message,
      });
    }
  }

  const report: GateReport = {
    stamp,
    pass: results.every((item) => item.pass),
    results,
    steps,
  };

  const reportJsonPath = path.join(GUARD_AUDIT_DIR, `guard_tiny_split_gate_${stamp}.json`);
  const reportMdPath = path.join(GUARD_AUDIT_DIR, `guard_tiny_split_gate_${stamp}.md`);
  const latestMdPath = path.join(GUARD_AUDIT_DIR, 'guard_tiny_split_gate_latest.md');
  await fsp.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fsp.writeFile(reportMdPath, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');
  await fsp.writeFile(LATEST_GATE_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fsp.writeFile(latestMdPath, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');

  for (const item of results) {
    console.log(`[guard-tiny-split-gate] ${item.pass ? 'PASS' : 'FAIL'} ${item.name}: ${item.details}`);
  }
  console.log(`[guard-tiny-split-gate] report=${reportJsonPath}`);

  if (!report.pass) {
    console.error('[guard-tiny-split-gate] FAIL');
    process.exitCode = 1;
    return;
  }
  console.log('[guard-tiny-split-gate] PASS');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[guard-tiny-split-gate] fatal: ${message}`);
  process.exitCode = 1;
});
