import 'dotenv/config';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

type TrapKind = 'PAGE_FAULT' | 'CPU_FAULT' | 'IO_FAULT' | 'WATCHDOG_NMI';
type OracleMode = 'kimi' | 'openai' | 'mock';

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

interface SetupFile {
  path: string;
  content: string;
}

interface Scenario {
  id: string;
  name: string;
  maxTicks: number;
  stepIds: string[];
  stepFileMap?: Record<string, string>;
  setupFiles?: SetupFile[];
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
  routeSamples: number;
  routeCoverage: number;
  routePLaneRate: number;
  routeELaneRate: number;
  routeFailoverCount: number;
  completionScore: number;
  planAdherence: number;
  pointerDriftRate: number;
  invalidPointerCount: number;
  trapCounts: Record<TrapKind, number>;
  mustContainTrapSatisfied: boolean;
  suspiciousFiles: string[];
  finalQ: string;
  finalD: string;
  telemetrySamples: number;
  telemetryAvgTotalTokens: number;
  telemetryTokenCv: number;
  telemetryStable: boolean;
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

interface RouteEvent {
  lane: 'P' | 'E' | 'UNKNOWN';
  failoverFrom?: 'P' | 'E';
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
  routeCoverageAvg: number;
  routeFailoverAvg: number;
  telemetrySamplesAvg: number;
  telemetryTokenCvAvg: number;
}

const ROOT = path.resolve(process.cwd());
const LONGRUN_DIR = path.join(ROOT, 'benchmarks', 'os-longrun');
const WORKSPACES_DIR = path.join(LONGRUN_DIR, 'workspaces');
const RESULTS_DIR = path.join(ROOT, 'benchmarks', 'results');
const PROMPT_FILE = path.join(LONGRUN_DIR, 'discipline_prompt.txt');
const FILE_POINTER_RE = /^(?:\.?\/)?[A-Za-z0-9._/$-]+$/;

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

function parseScenarioFilter(argv: string[]): string | null {
  const index = argv.findIndex((arg) => arg === '--scenario');
  if (index < 0) {
    return null;
  }
  const raw = (argv[index + 1] ?? '').trim();
  return raw.length > 0 ? raw : null;
}

function parseLongRunTicks(argv: string[]): number | null {
  const index = argv.findIndex((arg) => arg === '--longrun-ticks');
  if (index < 0) {
    return null;
  }
  const raw = argv[index + 1];
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function parseOracleOverride(argv: string[]): OracleMode | null {
  const index = argv.findIndex((arg) => arg === '--oracle');
  if (index < 0) {
    return null;
  }
  const raw = (argv[index + 1] ?? '').trim();
  return raw === 'kimi' || raw === 'openai' || raw === 'mock' ? raw : null;
}

function parseDispatcherOverride(argv: string[]): boolean | null {
  const index = argv.findIndex((arg) => arg === '--dispatcher');
  if (index < 0) {
    return null;
  }
  const raw = (argv[index + 1] ?? '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') {
    return true;
  }
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') {
    return false;
  }
  return null;
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
      stepFileMap: {
        WRITE_INPUT: 'artifacts/input.csv',
        FILTER_HIGH: 'artifacts/high.csv',
        SUM: 'artifacts/sum.txt',
        MANIFEST: 'artifacts/manifest.txt',
        RESULT: 'result/RESULT.json',
      },
      mainTape: [
        '# Mission: Pipeline Ordered Execution',
        '',
        'You must complete all plan steps in order and keep `plan/progress.log` updated.',
        'After finishing each step append one new line: `DONE:<STEP_ID>`.',
        'Never skip steps.',
        '',
        'Execution protocol:',
        '- Use `SYS_EXEC` for shell commands.',
        '- Use `SYS_GOTO` to move pointer; use `SYS_WRITE` to write at current pointer.',
        '- Append progress using `SYS_GOTO` `sys://append/plan/progress.log`, then `SYS_WRITE` `DONE:<STEP_ID>`.',
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
      stepFileMap: {
        RECOVER_SOURCE: 'inputs/source.txt',
        TRANSFORM: 'outputs/colors_upper.txt',
        COUNT: 'outputs/count.txt',
        RESULT: 'result/RESULT.json',
      },
      mainTape: [
        '# Mission: Fault Recovery Resume',
        '',
        'You must recover from a planned page fault and still complete mission outputs.',
        'After finishing each step append one new line in `plan/progress.log`: `DONE:<STEP_ID>`.',
        '',
        'Execution protocol:',
        '- Use `SYS_EXEC` for shell commands.',
        '- Use `SYS_GOTO` to move pointer; use `SYS_WRITE` to write at current pointer.',
        '- Append progress using `SYS_GOTO` `sys://append/plan/progress.log`, then `SYS_WRITE` `DONE:<STEP_ID>`.',
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
      id: 'home1_parity_sim',
      name: 'Home1 Parity Simulation',
      maxTicks: 120,
      stepIds: ['INIT', 'SCAN_TREE', 'WRITE_RESULT', 'HALT'],
      stepFileMap: {
        WRITE_RESULT: '$home1/result.md',
      },
      setupFiles: [
        {
          path: '$home1/.ls',
          content: ['.', '..', '.ls', '1', '2', '3', '4', '32342323.md'].join('\n'),
        },
        { path: '$home1/32342323.md', content: '32342323' },
        {
          path: '$home1/1/.ls',
          content: ['.', '..', '.ls', '12312432.md', 'a', 'b'].join('\n'),
        },
        { path: '$home1/1/12312432.md', content: '12312432' },
        {
          path: '$home1/1/a/.ls',
          content: ['.', '..', '.ls', '23563425.md'].join('\n'),
        },
        { path: '$home1/1/a/23563425.md', content: '23563425' },
        { path: '$home1/1/b/.ls', content: ['.', '..', '.ls'].join('\n') },
        { path: '$home1/2/.ls', content: ['.', '..', '.ls'].join('\n') },
        {
          path: '$home1/3/.ls',
          content: ['.', '..', '.ls', '135246547.md'].join('\n'),
        },
        { path: '$home1/3/135246547.md', content: '135246547' },
        { path: '$home1/4/.ls', content: ['.', '..', '.ls'].join('\n') },
      ],
      mainTape: [
        '# 模拟运行：$home1 奇偶判定',
        '',
        '任务目标：',
        '- 已创建路径 `./$home1`（目录名包含字符 `$`）。',
        '- 你需要判断该目录树中所有数字 md 文件的数字总和是奇数还是偶数。',
        '- 不需要输出总和，只需 odd/even。',
        '',
        '环境信息：',
        '- 每个目录包含 `.ls` 文件，其内容等价于该目录 `ls` 结果。',
        '',
        '系统规则：',
        '- 维护 todo-stack，避免重复处理已完成任务。',
        '- `q` 用于任务指示，不要在 `q` 存大数据。',
        '- 中间数据写文件；若不改当前文件，使用 `SYS_GOTO`。',
        '- 写入发生时，目标路径就是当前指针 `d_t`。',
        '- 路径请使用 `./$home1/...` 形式。',
        '',
        '执行协议：',
        '- 使用 `SYS_EXEC` 执行 shell 命令。',
        '- 使用 `SYS_GOTO` 跳转到相对路径文件/系统通道。',
        '- 使用 `SYS_WRITE` 覆写当前指针文件。',
        '- 每完成一个阶段，向 `plan/progress.log` 追加一行 `DONE:<STEP_ID>`。',
        '',
        'Plan:',
        '1) INIT: 创建 `plan/` 和 `./$home1/parity.md`，初始化 parity 为 `0`。',
        '2) SCAN_TREE: 通过 `./$home1/.ls` 及各子目录 `.ls` 找到全部数字 md 并更新 parity。',
        '3) WRITE_RESULT: 在 `./$home1/result.md` 写入最终结果，内容必须是 `odd` 或 `even`。',
        '4) HALT: 验证结果后 HALT。',
      ].join('\n'),
      expectedFiles: [{ kind: 'text', path: '$home1/result.md', exact: 'odd' }],
    },
    {
      id: 'long_checklist_stability',
      name: 'Long Checklist Stability',
      maxTicks: 36,
      stepIds: checklistSteps,
      stepFileMap: {
        M01: 'milestones/m01.txt',
        M02: 'milestones/m02.txt',
        M03: 'milestones/m03.txt',
        M04: 'milestones/m04.txt',
        M05: 'milestones/m05.txt',
        M06: 'milestones/m06.txt',
        M07: 'milestones/m07.txt',
        M08: 'milestones/m08.txt',
        SEQUENCE: 'milestones/sequence.txt',
        RESULT: 'result/RESULT.json',
      },
      mainTape: [
        '# Mission: Long Checklist Stability',
        '',
        'You must complete a long checklist without pointer drift.',
        'After each step append one new line in `plan/progress.log`: `DONE:<STEP_ID>`.',
        '',
        'Execution protocol:',
        '- Use `SYS_EXEC` for shell commands.',
        '- Use `SYS_GOTO` to move pointer; use `SYS_WRITE` to write at current pointer.',
        '- Append progress using `SYS_GOTO` `sys://append/plan/progress.log`, then `SYS_WRITE` `DONE:<STEP_ID>`.',
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

function buildStepExpectations(scenario: Scenario): Record<string, FileExpectation> {
  const map = scenario.stepFileMap ?? {};
  const out: Record<string, FileExpectation> = {};
  for (const [stepId, filePath] of Object.entries(map)) {
    const expected = scenario.expectedFiles.find((item) => item.path === filePath);
    if (!expected) {
      continue;
    }
    out[stepId] = expected;
  }
  return out;
}

async function writeExecutionContract(workspace: string, scenario: Scenario): Promise<void> {
  const contractPath = path.join(workspace, '.turingos.contract.json');
  const payload = {
    enabled: true,
    progress_file: 'plan/progress.log',
    ordered_steps: scenario.stepIds,
    required_files: scenario.expectedFiles.map((item) => item.path),
    step_file_map: scenario.stepFileMap ?? {},
    step_expectations: buildStepExpectations(scenario),
  };
  await fs.writeFile(contractPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

async function writeSetupFiles(workspace: string, setupFiles: SetupFile[] | undefined): Promise<void> {
  if (!setupFiles || setupFiles.length === 0) {
    return;
  }

  const aliasRoots = new Set<string>();
  for (const setup of setupFiles) {
    const aliasMatch = setup.path.match(/^\$([A-Za-z0-9_-]+)(?:\/|$)/);
    if (aliasMatch?.[1]) {
      aliasRoots.add(aliasMatch[1]);
    }

    const target = path.join(workspace, setup.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${setup.content}\n`, 'utf-8');
  }

  for (const aliasRoot of aliasRoots) {
    const sourceDir = `$${aliasRoot}`;
    const sourcePath = path.join(workspace, sourceDir);
    const aliasPath = path.join(workspace, aliasRoot);
    try {
      await fs.access(sourcePath);
    } catch {
      continue;
    }

    try {
      await fs.access(aliasPath);
      continue;
    } catch {
      // Alias path missing; create symlink fallback.
    }

    try {
      await fs.symlink(sourceDir, aliasPath, 'dir');
    } catch {
      // Non-fatal; benchmark still runs without alias.
    }
  }
}

async function runBoot(
  workspace: string,
  maxTicks: number,
  runtimeOverrides: { oracle: OracleMode | null; dispatcherEnabled: boolean | null }
): Promise<RunOutput> {
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
    const child = spawn('npm', args, {
      cwd: ROOT,
      env: {
        ...process.env,
        TURINGOS_TOKEN_TELEMETRY_PATH: path.join(workspace, '.token_telemetry.jsonl'),
        ...(runtimeOverrides.oracle ? { TURINGOS_ORACLE: runtimeOverrides.oracle } : {}),
        ...(runtimeOverrides.dispatcherEnabled === null
          ? {}
          : { TURINGOS_DISPATCHER_ENABLED: runtimeOverrides.dispatcherEnabled ? '1' : '0' }),
      },
    });
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

function parseBusRoutes(journalRaw: string | null): RouteEvent[] {
  if (!journalRaw) {
    return [];
  }

  const events: RouteEvent[] = [];
  const lines = journalRaw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('[BUS_ROUTE]'));
  for (const line of lines) {
    const match = line.match(/\[BUS_ROUTE\]\s*(\{.*\})$/);
    if (!match?.[1]) {
      continue;
    }
    try {
      const parsed = JSON.parse(match[1]) as Record<string, unknown>;
      const laneRaw = typeof parsed.lane === 'string' ? parsed.lane.trim().toUpperCase() : '';
      const failoverRaw =
        typeof parsed.failover_from === 'string' ? parsed.failover_from.trim().toUpperCase() : undefined;
      events.push({
        lane: laneRaw === 'P' || laneRaw === 'E' ? laneRaw : 'UNKNOWN',
        ...(failoverRaw === 'P' || failoverRaw === 'E' ? { failoverFrom: failoverRaw } : {}),
      });
    } catch {
      continue;
    }
  }

  return events;
}

function parseTelemetryStats(raw: string | null): {
  samples: number;
  avgTotalTokens: number;
  tokenCv: number;
  stable: boolean;
} {
  if (!raw) {
    return { samples: 0, avgTotalTokens: 0, tokenCv: 0, stable: false };
  }

  const totals: number[] = [];
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      const rawTotal = row.total_tokens ?? row.total_tokens_est;
      const total = typeof rawTotal === 'number' && Number.isFinite(rawTotal) ? rawTotal : null;
      if (total !== null && total >= 0) {
        totals.push(total);
      }
    } catch {
      // Ignore malformed telemetry lines; validator only counts valid rows.
    }
  }

  if (totals.length === 0) {
    return { samples: 0, avgTotalTokens: 0, tokenCv: 0, stable: false };
  }

  const mean = totals.reduce((sum, value) => sum + value, 0) / totals.length;
  const variance = totals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / totals.length;
  const stddev = Math.sqrt(variance);
  const cv = mean === 0 ? 0 : stddev / mean;

  return {
    samples: totals.length,
    avgTotalTokens: Number(mean.toFixed(4)),
    tokenCv: Number(cv.toFixed(4)),
    stable: totals.length >= 100 && cv <= 0.15,
  };
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

      if (/[\s:><|]/.test(relative)) {
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
  const noCriticalTrap = result.trapCounts.CPU_FAULT === 0;
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

async function runScenario(
  scenario: Scenario,
  runStamp: string,
  repeat: number,
  longRunTicks: number | null,
  runtimeOverrides: { oracle: OracleMode | null; dispatcherEnabled: boolean | null }
): Promise<ScenarioResult> {
  const workspace = path.join(WORKSPACES_DIR, `${scenario.id}-${runStamp}-r${repeat}`);
  const effectiveMaxTicks = longRunTicks ?? scenario.maxTicks;
  await fs.mkdir(workspace, { recursive: true });
  await writeSetupFiles(workspace, scenario.setupFiles);
  await fs.writeFile(path.join(workspace, 'MAIN_TAPE.md'), `${scenario.mainTape}\n`, 'utf-8');
  await writeExecutionContract(workspace, scenario);

  console.log(`\n[os-longrun] repeat=${repeat} scenario=${scenario.id} maxTicks=${effectiveMaxTicks}`);
  const run = await runBoot(workspace, effectiveMaxTicks, runtimeOverrides);

  const regQ = (await readMaybe(path.join(workspace, '.reg_q'))) ?? '';
  const regD = (await readMaybe(path.join(workspace, '.reg_d'))) ?? '';
  const journal = await readMaybe(path.join(workspace, '.journal.log'));
  const progress = await readMaybe(path.join(workspace, 'plan', 'progress.log'));
  const telemetryRaw = await readMaybe(path.join(workspace, '.token_telemetry.jsonl'));

  const checks = await checkExpectedFiles(workspace, scenario.expectedFiles);
  const completionScore = Number(
    (
      checks.filter((check) => check.passed).length /
      (checks.length === 0 ? 1 : checks.length)
    ).toFixed(4)
  );
  const planAdherence = parseProgressAdherence(progress, scenario.stepIds);

  const transitions = parseTransitions(journal);
  const routes = parseBusRoutes(journal);
  const invalidPointerCount = transitions.filter((transition) => !isValidPointer(transition.to)).length;
  const pointerDriftRate = Number(
    (invalidPointerCount / (transitions.length === 0 ? 1 : transitions.length)).toFixed(4)
  );
  const routeSamples = routes.length;
  const routeCoverage = Number(
    (routeSamples / (transitions.length === 0 ? 1 : transitions.length)).toFixed(4)
  );
  const routePLaneRate = Number(
    (
      routes.filter((route) => route.lane === 'P').length /
      (routeSamples === 0 ? 1 : routeSamples)
    ).toFixed(4)
  );
  const routeELaneRate = Number(
    (
      routes.filter((route) => route.lane === 'E').length /
      (routeSamples === 0 ? 1 : routeSamples)
    ).toFixed(4)
  );
  const routeFailoverCount = routes.filter((route) => route.failoverFrom === 'P' || route.failoverFrom === 'E').length;

  const mergedLog = [run.stdout, run.stderr, regQ, regD, journal ?? ''].join('\n');
  const trapCounts = buildTrapCounts(mergedLog);
  const mustContainTrapSatisfied = scenario.mustContainTrap ? trapCounts[scenario.mustContainTrap] > 0 : true;
  const maxTickHit = (journal ?? '').includes('[HALT_GUARD]');
  const halted = regQ.trim() === 'HALT' || regD.trim() === 'HALT';
  const suspiciousFiles = await listSuspiciousFiles(workspace);
  const telemetry = parseTelemetryStats(telemetryRaw);

  const baseResult: Omit<ScenarioResult, 'pass'> = {
    repeat,
    id: scenario.id,
    name: scenario.name,
    maxTicks: effectiveMaxTicks,
    exitCode: run.exitCode,
    elapsedMs: run.elapsedMs,
    halted,
    maxTickHit,
    ticksObserved: transitions.length,
    routeSamples,
    routeCoverage,
    routePLaneRate,
    routeELaneRate,
    routeFailoverCount,
    completionScore,
    planAdherence,
    pointerDriftRate,
    invalidPointerCount,
    trapCounts,
    mustContainTrapSatisfied,
    suspiciousFiles,
    finalQ: regQ.trim(),
    finalD: regD.trim(),
    telemetrySamples: telemetry.samples,
    telemetryAvgTotalTokens: telemetry.avgTotalTokens,
    telemetryTokenCv: telemetry.tokenCv,
    telemetryStable: telemetry.stable,
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
      routeCoverageAvg: average(items.map((item) => item.routeCoverage)),
      routeFailoverAvg: average(items.map((item) => item.routeFailoverCount)),
      telemetrySamplesAvg: average(items.map((item) => item.telemetrySamples)),
      telemetryTokenCvAvg: average(items.map((item) => item.telemetryTokenCv)),
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
  const avgTelemetryCv = average(results.map((result) => result.telemetryTokenCv));

  const lines = [
    '# TuringOS OS Long-Run Report',
    '',
    `- Runs: ${results.length}`,
    `- Passed: ${passed}/${results.length}`,
    `- Avg completion_score: ${avgCompletion}`,
    `- Avg plan_adherence: ${avgPlanAdherence}`,
    `- Avg pointer_drift_rate: ${avgDrift}`,
    `- Avg telemetry_token_cv: ${avgTelemetryCv}`,
    '',
    '## Scenario Distribution',
    '',
    '| Scenario | Runs | pass_rate | completion_avg | completion_p50 | completion_p90 | plan_avg | drift_avg | halted_rate | max_tick_rate | watchdog_avg | route_coverage_avg | route_failover_avg | tele_samples_avg | tele_cv_avg |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...aggregates.map(
      (item) =>
        `| ${item.id} | ${item.runs} | ${item.passRate} | ${item.completionAvg} | ${item.completionP50} | ${item.completionP90} | ${item.planAvg} | ${item.driftAvg} | ${item.haltedRate} | ${item.maxTickRate} | ${item.watchdogAvg} | ${item.routeCoverageAvg} | ${item.routeFailoverAvg} | ${item.telemetrySamplesAvg} | ${item.telemetryTokenCvAvg} |`
    ),
    '',
    '## Per Run Detail',
    '',
    '| Repeat | Scenario | Pass | completion | plan | drift | route_cov | route_p | route_e | route_failover | halted | max_tick | PAGE_FAULT | CPU_FAULT | WATCHDOG_NMI | tele_samples | tele_cv | tele_stable |',
    '|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...results.map(
      (result) =>
        `| ${result.repeat} | ${result.id} | ${result.pass ? 'Y' : 'N'} | ${result.completionScore} | ${result.planAdherence} | ${result.pointerDriftRate} | ${result.routeCoverage} | ${result.routePLaneRate} | ${result.routeELaneRate} | ${result.routeFailoverCount} | ${result.halted ? 'Y' : 'N'} | ${result.maxTickHit ? 'Y' : 'N'} | ${result.trapCounts.PAGE_FAULT} | ${result.trapCounts.CPU_FAULT} | ${result.trapCounts.WATCHDOG_NMI} | ${result.telemetrySamples} | ${result.telemetryTokenCv} | ${result.telemetryStable ? 'Y' : 'N'} |`
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
  const argv = process.argv.slice(2);
  const repeats = parseRepeats(argv);
  const scenarioFilter = parseScenarioFilter(argv);
  const longRunTicks = parseLongRunTicks(argv);
  const oracleOverride = parseOracleOverride(argv);
  const dispatcherOverride = parseDispatcherOverride(argv);
  await ensureDirs();
  const runStamp = timestamp();
  const allScenarios = buildScenarios();
  const scenarios = scenarioFilter
    ? allScenarios.filter((scenario) => scenario.id === scenarioFilter)
    : allScenarios;
  if (scenarios.length === 0) {
    throw new Error(
      scenarioFilter
        ? `Scenario not found: ${scenarioFilter}`
        : 'No scenarios available for os-longrun benchmark.'
    );
  }
  const results: ScenarioResult[] = [];

  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    for (const scenario of scenarios) {
      const result = await runScenario(scenario, runStamp, repeat, longRunTicks, {
        oracle: oracleOverride,
        dispatcherEnabled: dispatcherOverride,
      });
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
      oracle: oracleOverride ?? process.env.TURINGOS_ORACLE ?? 'kimi',
      dispatcherEnabled:
        dispatcherOverride === null
          ? /^(1|true|yes|on)$/i.test((process.env.TURINGOS_DISPATCHER_ENABLED ?? '').trim())
          : dispatcherOverride,
      promptFile: PROMPT_FILE,
      repeats,
      longRunTicks,
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
