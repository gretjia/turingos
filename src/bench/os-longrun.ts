import 'dotenv/config';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

type TrapKind = 'PAGE_FAULT' | 'CPU_FAULT' | 'IO_FAULT' | 'WATCHDOG_NMI';

interface TextExpectation {
  kind: 'text';
  path: string;
  exact: string;
}

interface JsonExpectation {
  kind: 'json';
  path: string;
  expected: Record<string, string | number | boolean>;
}

type FileExpectation = TextExpectation | JsonExpectation;

interface Scenario {
  id: string;
  name: string;
  maxTicks: number;
  stepIds: string[];
  mainTape: string;
  expectedFiles: FileExpectation[];
  mustContainTrap?: TrapKind;
}

interface FileCheckResult {
  path: string;
  passed: boolean;
  reason?: string;
}

interface ScenarioResult {
  repeat: number;
  id: string;
  name: string;
  maxTicks: number;
  exitCode: number | null;
  elapsedMs: number;
  halted: boolean;
  maxTickHit: boolean;
  ticksObserved: number;
  completionScore: number;
  planAdherence: number;
  pointerDriftRate: number;
  invalidPointerCount: number;
  trapCounts: Record<TrapKind, number>;
  mustContainTrapSatisfied: boolean;
  suspiciousFiles: string[];
  finalQ: string;
  finalD: string;
  fileChecks: FileCheckResult[];
  pass: boolean;
}

interface RunOutput {
  exitCode: number | null;
  elapsedMs: number;
  stdout: string;
  stderr: string;
}

interface PointerTransition {
  from: string;
  to: string;
}

interface ScenarioAggregate {
  id: string;
  name: string;
  runs: number;
  passRate: number;
  completionAvg: number;
  completionP50: number;
  completionP90: number;
  planAvg: number;
  driftAvg: number;
  haltedRate: number;
  maxTickRate: number;
  watchdogAvg: number;
}

const ROOT = path.resolve(process.cwd());
const LONGRUN_DIR = path.join(ROOT, 'benchmarks', 'os-longrun');
const WORKSPACES_DIR = path.join(LONGRUN_DIR, 'workspaces');
const RESULTS_DIR = path.join(ROOT, 'benchmarks', 'results');
const PROMPT_FILE = path.join(LONGRUN_DIR, 'discipline_prompt.txt');
const FILE_POINTER_RE = /^(?:\.?\/)?[A-Za-z0-9._/-]+$/;

function parseRepeats(argv: string[]): number {
  const index = argv.findIndex((arg) => arg === '--repeats');
  if (index < 0) {
    return 1;
  }

  const raw = argv[index + 1];
  const parsed = Number.parseInt(raw ?? '1', 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
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

function compact(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

function buildScenarios(): Scenario[] {
  const pipelineSteps = ['INIT', 'WRITE_INPUT', 'FILTER_HIGH', 'SUM', 'MANIFEST', 'RESULT', 'HALT'];
  const recoverySteps = ['INIT', 'TRIGGER_PAGE_FAULT', 'RECOVER_SOURCE', 'TRANSFORM', 'COUNT', 'RESULT', 'HALT'];
  const checklistSteps = [
    'INIT',
    'M01',
    'M02',
    'M03',
    'M04',
    'M05',
    'M06',
    'M07',
    'M08',
    'SEQUENCE',
    'RESULT',
    'HALT',
  ];

  return [
    {
      id: 'pipeline_ordered_execution',
      name: 'Pipeline Ordered Execution',
      maxTicks: 28,
      stepIds: pipelineSteps,
      mainTape: [
        '# Mission: Pipeline Ordered Execution',
        '',
        'You must complete all plan steps in order and keep `plan/progress.log` updated.',
        'After finishing each step append one new line: `DONE:<STEP_ID>`.',
        'Never skip steps.',
        '',
        'Execution protocol:',
        '- Use `$ <command>` in `d_next` for shell commands.',
        '- Use relative file path in `d_next` for file read/write.',
        '- Append progress using `d_next=sys://append/plan/progress.log` and `s_prime=DONE:<STEP_ID>`.',
        '- Never output natural language pointer text.',
        '',
        'Plan:',
        `1) ${pipelineSteps[0]}: create directories plan, artifacts, result.`,
        `2) ${pipelineSteps[1]}: create \`artifacts/input.csv\` exactly:`,
        'id,value',
        'a,10',
        'b,40',
        'c,70',
        'd,100',
        `3) ${pipelineSteps[2]}: create \`artifacts/high.csv\` exactly:`,
        'id,value',
        'c,70',
        'd,100',
        `4) ${pipelineSteps[3]}: create \`artifacts/sum.txt\` exactly: 220`,
        `5) ${pipelineSteps[4]}: create \`artifacts/manifest.txt\` exactly:`,
        'INPUT_ROWS=4',
        'HIGH_ROWS=2',
        'SUM=220',
        `6) ${pipelineSteps[5]}: create \`result/RESULT.json\` with JSON fields`,
        '{"scenario":"pipeline","status":"done","sum":220,"high_rows":2}',
        `7) ${pipelineSteps[6]}: verify all outputs and then HALT.`,
      ].join('\n'),
      expectedFiles: [
        {
          kind: 'text',
          path: 'artifacts/input.csv',
          exact: ['id,value', 'a,10', 'b,40', 'c,70', 'd,100'].join('\n'),
        },
        {
          kind: 'text',
          path: 'artifacts/high.csv',
          exact: ['id,value', 'c,70', 'd,100'].join('\n'),
        },
        { kind: 'text', path: 'artifacts/sum.txt', exact: '220' },
        {
          kind: 'text',
          path: 'artifacts/manifest.txt',
          exact: ['INPUT_ROWS=4', 'HIGH_ROWS=2', 'SUM=220'].join('\n'),
        },
        {
          kind: 'json',
          path: 'result/RESULT.json',
          expected: { scenario: 'pipeline', status: 'done', sum: 220, high_rows: 2 },
        },
      ],
    },
    {
      id: 'fault_recovery_resume',
      name: 'Fault Recovery Resume',
      maxTicks: 28,
      stepIds: recoverySteps,
      mainTape: [
        '# Mission: Fault Recovery Resume',
        '',
        'You must recover from a planned page fault and still complete mission outputs.',
        'After finishing each step append one new line in `plan/progress.log`: `DONE:<STEP_ID>`.',
        '',
        'Execution protocol:',
        '- Use `$ <command>` in `d_next` for shell commands.',
        '- Use relative file path for file read/write.',
        '- Append progress using `d_next=sys://append/plan/progress.log` and `s_prime=DONE:<STEP_ID>`.',
        '- Never output natural language pointer text.',
        '',
        'Plan:',
        `1) ${recoverySteps[0]}: create directories plan, inputs, outputs, result.`,
        `2) ${recoverySteps[1]}: read \`inputs/source.txt\` before it exists (this should trigger PAGE_FAULT).`,
        `3) ${recoverySteps[2]}: create \`inputs/source.txt\` exactly:`,
        'red',
        'green',
        'blue',
        `4) ${recoverySteps[3]}: create \`outputs/colors_upper.txt\` exactly:`,
        'RED',
        'GREEN',
        'BLUE',
        `5) ${recoverySteps[4]}: create \`outputs/count.txt\` exactly: 3`,
        `6) ${recoverySteps[5]}: create \`result/RESULT.json\` with JSON fields`,
        '{"scenario":"recovery","status":"done","recovered":true,"count":3}',
        `7) ${recoverySteps[6]}: verify all outputs and HALT.`,
      ].join('\n'),
      expectedFiles: [
        { kind: 'text', path: 'inputs/source.txt', exact: ['red', 'green', 'blue'].join('\n') },
        { kind: 'text', path: 'outputs/colors_upper.txt', exact: ['RED', 'GREEN', 'BLUE'].join('\n') },
        { kind: 'text', path: 'outputs/count.txt', exact: '3' },
        {
          kind: 'json',
          path: 'result/RESULT.json',
          expected: { scenario: 'recovery', status: 'done', recovered: true, count: 3 },
        },
      ],
      mustContainTrap: 'PAGE_FAULT',
    },
    {
      id: 'long_checklist_stability',
      name: 'Long Checklist Stability',
      maxTicks: 36,
      stepIds: checklistSteps,
      mainTape: [
        '# Mission: Long Checklist Stability',
        '',
        'You must complete a long checklist without pointer drift.',
        'After each step append one new line in `plan/progress.log`: `DONE:<STEP_ID>`.',
        '',
        'Execution protocol:',
        '- Use `$ <command>` in `d_next` for shell commands.',
        '- Use relative file path for file read/write.',
        '- Append progress using `d_next=sys://append/plan/progress.log` and `s_prime=DONE:<STEP_ID>`.',
        '- Never output natural language pointer text.',
        '',
        'Plan:',
        `1) ${checklistSteps[0]}: create directories plan, milestones, result.`,
        `2) ${checklistSteps[1]}: create \`milestones/m01.txt\` exactly: T01`,
        `3) ${checklistSteps[2]}: create \`milestones/m02.txt\` exactly: T02`,
        `4) ${checklistSteps[3]}: create \`milestones/m03.txt\` exactly: T03`,
        `5) ${checklistSteps[4]}: create \`milestones/m04.txt\` exactly: T04`,
        `6) ${checklistSteps[5]}: create \`milestones/m05.txt\` exactly: T05`,
        `7) ${checklistSteps[6]}: create \`milestones/m06.txt\` exactly: T06`,
        `8) ${checklistSteps[7]}: create \`milestones/m07.txt\` exactly: T07`,
        `9) ${checklistSteps[8]}: create \`milestones/m08.txt\` exactly: T08`,
        `10) ${checklistSteps[9]}: create \`milestones/sequence.txt\` exactly lines T01..T08 in order.`,
        `11) ${checklistSteps[10]}: create \`result/RESULT.json\` with JSON fields`,
        '{"scenario":"checklist","status":"done","count":8}',
        `12) ${checklistSteps[11]}: verify outputs and HALT.`,
      ].join('\n'),
      expectedFiles: [
        { kind: 'text', path: 'milestones/m01.txt', exact: 'T01' },
        { kind: 'text', path: 'milestones/m02.txt', exact: 'T02' },
        { kind: 'text', path: 'milestones/m03.txt', exact: 'T03' },
        { kind: 'text', path: 'milestones/m04.txt', exact: 'T04' },
        { kind: 'text', path: 'milestones/m05.txt', exact: 'T05' },
        { kind: 'text', path: 'milestones/m06.txt', exact: 'T06' },
        { kind: 'text', path: 'milestones/m07.txt', exact: 'T07' },
        { kind: 'text', path: 'milestones/m08.txt', exact: 'T08' },
        {
          kind: 'text',
          path: 'milestones/sequence.txt',
          exact: ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08'].join('\n'),
        },
        {
          kind: 'json',
          path: 'result/RESULT.json',
          expected: { scenario: 'checklist', status: 'done', count: 8 },
        },
      ],
    },
  ];
}

async function ensureDirs(): Promise<void> {
  await fs.mkdir(WORKSPACES_DIR, { recursive: true });
  await fs.mkdir(RESULTS_DIR, { recursive: true });
}

async function writeExecutionContract(workspace: string, scenario: Scenario): Promise<void> {
  const contractPath = path.join(workspace, '.turingos.contract.json');
  const payload = {
    enabled: true,
    progress_file: 'plan/progress.log',
    ordered_steps: scenario.stepIds,
    required_files: scenario.expectedFiles.map((item) => item.path),
  };
  await fs.writeFile(contractPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

async function runBoot(workspace: string, maxTicks: number): Promise<RunOutput> {
  const started = Date.now();
  const args = [
    'run',
    'dev',
    '--',
    '--workspace',
    workspace,
    '--max-ticks',
    String(maxTicks),
    '--prompt-file',
    PROMPT_FILE,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, { cwd: ROOT, env: process.env });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stderr += text;
      process.stderr.write(text);
    });

    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({
        exitCode,
        elapsedMs: Date.now() - started,
        stdout,
        stderr,
      });
    });
  });
}

async function readMaybe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

async function checkExpectedFiles(workspace: string, expectedFiles: FileExpectation[]): Promise<FileCheckResult[]> {
  const checks: FileCheckResult[] = [];

  for (const expected of expectedFiles) {
    const absolutePath = path.join(workspace, expected.path);
    const actualRaw = await readMaybe(absolutePath);
    if (actualRaw === null) {
      checks.push({ path: expected.path, passed: false, reason: 'missing file' });
      continue;
    }

    if (expected.kind === 'text') {
      const passed = compact(actualRaw) === compact(expected.exact);
      checks.push({
        path: expected.path,
        passed,
        reason: passed ? undefined : 'text mismatch',
      });
      continue;
    }

    try {
      const actualJson = JSON.parse(actualRaw) as Record<string, unknown>;
      const mismatch = Object.entries(expected.expected).find(([key, value]) => actualJson[key] !== value);
      if (mismatch) {
        checks.push({
          path: expected.path,
          passed: false,
          reason: `json mismatch on key ${mismatch[0]}`,
        });
      } else {
        checks.push({ path: expected.path, passed: true });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({ path: expected.path, passed: false, reason: `invalid json: ${message}` });
    }
  }

  return checks;
}

function parseProgressAdherence(progressRaw: string | null, stepIds: string[]): number {
  if (!progressRaw) {
    return 0;
  }

  const lines = progressRaw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let matched = 0;
  for (const line of lines) {
    const expected = `DONE:${stepIds[matched]}`;
    if (line === expected) {
      matched += 1;
      if (matched >= stepIds.length) {
        break;
      }
    }
  }

  return Number((matched / stepIds.length).toFixed(4));
}

function parseTransitions(journalRaw: string | null): PointerTransition[] {
  if (!journalRaw) {
    return [];
  }

  const markerFrom = ' d:';
  const markerTo = " -> d':";
  const markerTail = ' | ';

  const transitions: PointerTransition[] = [];
  const lines = journalRaw.split('\n').filter((line) => line.includes('[Tick]'));
  for (const line of lines) {
    const iFrom = line.indexOf(markerFrom);
    const iTo = line.indexOf(markerTo);
    const iTail = line.indexOf(markerTail, iTo + markerTo.length);
    if (iFrom < 0 || iTo < 0 || iTail < 0) {
      continue;
    }

    transitions.push({
      from: line.slice(iFrom + markerFrom.length, iTo).trim(),
      to: line.slice(iTo + markerTo.length, iTail).trim(),
    });
  }

  return transitions;
}

function isValidPointer(pointer: string): boolean {
  const trimmed = pointer.trim();
  if (trimmed === 'HALT') return true;
  if (trimmed.startsWith('$')) return true;
  if (trimmed.startsWith('sys://')) return true;
  return FILE_POINTER_RE.test(trimmed);
}

function countTrap(text: string, trap: TrapKind): number {
  const pattern = new RegExp(trap, 'g');
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

async function listSuspiciousFiles(workspace: string): Promise<string[]> {
  const suspicious: string[] = [];
  const ignoreNames = new Set(['MAIN_TAPE.md', '.journal.log', '.reg_q', '.reg_d']);

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(workspace, absolute).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }

      if (ignoreNames.has(entry.name)) {
        continue;
      }

      if (/[\s:><|$]/.test(relative)) {
        suspicious.push(relative);
      }
    }
  }

  await walk(workspace);
  return suspicious.sort();
}

function buildTrapCounts(text: string): Record<TrapKind, number> {
  return {
    PAGE_FAULT: countTrap(text, 'PAGE_FAULT'),
    CPU_FAULT: countTrap(text, 'CPU_FAULT'),
    IO_FAULT: countTrap(text, 'IO_FAULT'),
    WATCHDOG_NMI: countTrap(text, 'WATCHDOG_NMI'),
  };
}

function computePass(result: Omit<ScenarioResult, 'pass'>): boolean {
  const noCriticalTrap = result.trapCounts.CPU_FAULT === 0 && result.trapCounts.WATCHDOG_NMI === 0;
  return (
    result.completionScore === 1 &&
    result.planAdherence === 1 &&
    result.pointerDriftRate <= 0.1 &&
    result.halted &&
    !result.maxTickHit &&
    result.mustContainTrapSatisfied &&
    result.suspiciousFiles.length === 0 &&
    noCriticalTrap
  );
}

async function runScenario(scenario: Scenario, runStamp: string, repeat: number): Promise<ScenarioResult> {
  const workspace = path.join(WORKSPACES_DIR, `${scenario.id}-${runStamp}-r${repeat}`);
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, 'MAIN_TAPE.md'), `${scenario.mainTape}\n`, 'utf-8');
  await writeExecutionContract(workspace, scenario);

  console.log(`\n[os-longrun] repeat=${repeat} scenario=${scenario.id} maxTicks=${scenario.maxTicks}`);
  const run = await runBoot(workspace, scenario.maxTicks);

  const regQ = (await readMaybe(path.join(workspace, '.reg_q'))) ?? '';
  const regD = (await readMaybe(path.join(workspace, '.reg_d'))) ?? '';
  const journal = await readMaybe(path.join(workspace, '.journal.log'));
  const progress = await readMaybe(path.join(workspace, 'plan', 'progress.log'));

  const checks = await checkExpectedFiles(workspace, scenario.expectedFiles);
  const completionScore = Number(
    (
      checks.filter((check) => check.passed).length /
      (checks.length === 0 ? 1 : checks.length)
    ).toFixed(4)
  );
  const planAdherence = parseProgressAdherence(progress, scenario.stepIds);

  const transitions = parseTransitions(journal);
  const invalidPointerCount = transitions.filter((transition) => !isValidPointer(transition.to)).length;
  const pointerDriftRate = Number(
    (invalidPointerCount / (transitions.length === 0 ? 1 : transitions.length)).toFixed(4)
  );

  const mergedLog = [run.stdout, run.stderr, regQ, regD, journal ?? ''].join('\n');
  const trapCounts = buildTrapCounts(mergedLog);
  const mustContainTrapSatisfied = scenario.mustContainTrap ? trapCounts[scenario.mustContainTrap] > 0 : true;
  const maxTickHit = (journal ?? '').includes('[HALT_GUARD]');
  const halted = regQ.trim() === 'HALT' || regD.trim() === 'HALT';
  const suspiciousFiles = await listSuspiciousFiles(workspace);

  const baseResult: Omit<ScenarioResult, 'pass'> = {
    repeat,
    id: scenario.id,
    name: scenario.name,
    maxTicks: scenario.maxTicks,
    exitCode: run.exitCode,
    elapsedMs: run.elapsedMs,
    halted,
    maxTickHit,
    ticksObserved: transitions.length,
    completionScore,
    planAdherence,
    pointerDriftRate,
    invalidPointerCount,
    trapCounts,
    mustContainTrapSatisfied,
    suspiciousFiles,
    finalQ: regQ.trim(),
    finalD: regD.trim(),
    fileChecks: checks,
  };

  return {
    ...baseResult,
    pass: computePass(baseResult),
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, item) => sum + item, 0) / values.length).toFixed(4));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[rank].toFixed(4));
}

function aggregateByScenario(results: ScenarioResult[]): ScenarioAggregate[] {
  const groups = new Map<string, ScenarioResult[]>();
  for (const result of results) {
    const key = `${result.id}::${result.name}`;
    const current = groups.get(key) ?? [];
    current.push(result);
    groups.set(key, current);
  }

  const aggregates: ScenarioAggregate[] = [];
  for (const [key, items] of groups.entries()) {
    const [id, name] = key.split('::');
    const completionValues = items.map((item) => item.completionScore);
    const passRate = average(items.map((item) => (item.pass ? 1 : 0)));
    const haltedRate = average(items.map((item) => (item.halted ? 1 : 0)));
    const maxTickRate = average(items.map((item) => (item.maxTickHit ? 1 : 0)));

    aggregates.push({
      id,
      name,
      runs: items.length,
      passRate,
      completionAvg: average(completionValues),
      completionP50: percentile(completionValues, 50),
      completionP90: percentile(completionValues, 90),
      planAvg: average(items.map((item) => item.planAdherence)),
      driftAvg: average(items.map((item) => item.pointerDriftRate)),
      haltedRate,
      maxTickRate,
      watchdogAvg: average(items.map((item) => item.trapCounts.WATCHDOG_NMI)),
    });
  }

  return aggregates.sort((a, b) => a.id.localeCompare(b.id));
}

function toMarkdown(
  results: ScenarioResult[],
  aggregates: ScenarioAggregate[],
  reportPath: string,
  jsonPath: string
): string {
  const passed = results.filter((result) => result.pass).length;
  const avgCompletion = average(results.map((result) => result.completionScore));
  const avgPlanAdherence = average(results.map((result) => result.planAdherence));
  const avgDrift = average(results.map((result) => result.pointerDriftRate));

  const lines = [
    '# TuringOS OS Long-Run Report',
    '',
    `- Runs: ${results.length}`,
    `- Passed: ${passed}/${results.length}`,
    `- Avg completion_score: ${avgCompletion}`,
    `- Avg plan_adherence: ${avgPlanAdherence}`,
    `- Avg pointer_drift_rate: ${avgDrift}`,
    '',
    '## Scenario Distribution',
    '',
    '| Scenario | Runs | pass_rate | completion_avg | completion_p50 | completion_p90 | plan_avg | drift_avg | halted_rate | max_tick_rate | watchdog_avg |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...aggregates.map(
      (item) =>
        `| ${item.id} | ${item.runs} | ${item.passRate} | ${item.completionAvg} | ${item.completionP50} | ${item.completionP90} | ${item.planAvg} | ${item.driftAvg} | ${item.haltedRate} | ${item.maxTickRate} | ${item.watchdogAvg} |`
    ),
    '',
    '## Per Run Detail',
    '',
    '| Repeat | Scenario | Pass | completion | plan | drift | halted | max_tick | PAGE_FAULT | CPU_FAULT | WATCHDOG_NMI |',
    '|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...results.map(
      (result) =>
        `| ${result.repeat} | ${result.id} | ${result.pass ? 'Y' : 'N'} | ${result.completionScore} | ${result.planAdherence} | ${result.pointerDriftRate} | ${result.halted ? 'Y' : 'N'} | ${result.maxTickHit ? 'Y' : 'N'} | ${result.trapCounts.PAGE_FAULT} | ${result.trapCounts.CPU_FAULT} | ${result.trapCounts.WATCHDOG_NMI} |`
    ),
    '',
    '## Artifacts',
    '',
    `- JSON: \`${jsonPath}\``,
    `- Markdown: \`${reportPath}\``,
  ];

  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) {
    throw new Error('KIMI_API_KEY missing. Set it in .env before running os-longrun benchmark.');
  }

  const repeats = parseRepeats(process.argv.slice(2));
  await ensureDirs();
  const runStamp = timestamp();
  const scenarios = buildScenarios();
  const results: ScenarioResult[] = [];

  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    for (const scenario of scenarios) {
      const result = await runScenario(scenario, runStamp, repeat);
      results.push(result);
    }
  }

  const jsonPath = path.join(RESULTS_DIR, `os-longrun-${runStamp}.json`);
  const mdPath = path.join(RESULTS_DIR, `os-longrun-${runStamp}.md`);
  const aggregates = aggregateByScenario(results);
  const payload = {
    metadata: {
      runStamp,
      executedAt: new Date().toISOString(),
      model: process.env.TURINGOS_MODEL ?? 'kimi-for-coding',
      promptFile: PROMPT_FILE,
      repeats,
    },
    aggregates,
    results,
  };

  await fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  await fs.writeFile(mdPath, toMarkdown(results, aggregates, mdPath, jsonPath), 'utf-8');

  const passed = results.filter((result) => result.pass).length;
  console.log(`\n[os-longrun] finished. passed=${passed}/${results.length}`);
  console.log(`[os-longrun] report(json): ${jsonPath}`);
  console.log(`[os-longrun] report(md):   ${mdPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[os-longrun] fatal: ${message}`);
  process.exitCode = 1;
});
