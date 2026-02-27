import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileChronos } from '../chronos/file-chronos.js';
import { TuringEngine } from '../kernel/engine.js';
import { IOracle, Slice, State, Transition } from '../kernel/types.js';
import { LocalManifold } from '../manifold/local-manifold.js';

interface TrapFrame {
  seq: number;
  ts: string;
  trap_base: string;
  trap_pointer: string;
  details: string;
  panic_reset_count: number;
}

interface ScenarioSummary {
  id: string;
  workspace: string;
  ticks: number;
  finalQ: string;
  finalD: string;
  trapFrames: TrapFrame[];
}

interface AnalyticsReport {
  stamp: string;
  pass: boolean;
  checks: Array<{ id: string; pass: boolean; details: string }>;
  scenarios: {
    thrashing: ScenarioSummary;
    panicBudget: ScenarioSummary;
  };
  metrics: {
    totalTrapFrames: number;
    schemaValidRate: number;
    cpuFaultFrames: number;
    thrashingFrames: number;
    panicResetFrames: number;
    unrecoverableFrames: number;
  };
}

class ThrashingScenarioOracle implements IOracle {
  private step = 0;

  public async collapse(_discipline: string, q: State, _s: Slice): Promise<Transition> {
    if (q.includes('[OS_TRAP: THRASHING]')) {
      return {
        q_next: 'post_thrashing_recover',
        a_t: { op: 'SYS_WRITE', payload: 'RECOVERED\n' },
      };
    }

    this.step += 1;
    if (this.step === 1) {
      return { q_next: 'queue_seed', a_t: { op: 'SYS_PUSH', task: 'seed_task_for_thrashing_probe' } };
    }
    if (this.step === 2) {
      return { q_next: 'plan_refine_1', a_t: { op: 'SYS_EDIT', task: 'refine_task_step_1' } };
    }
    if (this.step === 3) {
      return {
        q_next: 'plan_refine_2',
        a_t: { op: 'SYS_MOVE', task_id: 'task_alpha', target_pos: 'BOTTOM', status: 'SUSPENDED' },
      };
    }
    return { q_next: 'plan_refine_3', a_t: { op: 'SYS_EDIT', task: 'refine_task_step_3' } };
  }
}

class PanicBudgetOracle implements IOracle {
  public async collapse(_discipline: string, _q: State, _s: Slice): Promise<Transition> {
    throw new Error('[CPU_FAULT: INVALID_OPCODE] synthetic panic budget probe');
  }
}

const ROOT = path.resolve(process.cwd());
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'guard');

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

function parseTrapFrames(journalRaw: string): TrapFrame[] {
  const frames: TrapFrame[] = [];
  const lines = journalRaw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    const match = line.match(/\[TRAP_FRAME\]\s*(\{.*\})$/);
    if (!match?.[1]) {
      continue;
    }
    try {
      const parsed = JSON.parse(match[1]) as Record<string, unknown>;
      const frame: TrapFrame = {
        seq: typeof parsed.seq === 'number' ? parsed.seq : -1,
        ts: typeof parsed.ts === 'string' ? parsed.ts : '',
        trap_base: typeof parsed.trap_base === 'string' ? parsed.trap_base : '',
        trap_pointer: typeof parsed.trap_pointer === 'string' ? parsed.trap_pointer : '',
        details: typeof parsed.details === 'string' ? parsed.details : '',
        panic_reset_count: typeof parsed.panic_reset_count === 'number' ? parsed.panic_reset_count : -1,
      };
      frames.push(frame);
    } catch {
      continue;
    }
  }
  return frames;
}

function isSchemaValid(frame: TrapFrame): boolean {
  return (
    Number.isFinite(frame.seq) &&
    frame.seq >= 0 &&
    frame.ts.length > 0 &&
    frame.trap_base.startsWith('sys://trap/') &&
    frame.trap_pointer.length > 0 &&
    frame.details.length > 0 &&
    Number.isFinite(frame.panic_reset_count) &&
    frame.panic_reset_count >= 0
  );
}

async function runScenario(
  id: string,
  oracle: IOracle,
  initialQ: string,
  maxTicks: number
): Promise<ScenarioSummary> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), `turingos-guard-${id}-`));
  await fs.writeFile(path.join(workspace, 'MAIN_TAPE.md'), `# ${id}\n`, 'utf-8');
  const manifold = new LocalManifold(workspace);
  const chronos = new FileChronos(path.join(workspace, '.journal.log'));
  const engine = new TuringEngine(manifold, oracle, chronos, 'strict json');
  const result = await engine.ignite(initialQ, 'MAIN_TAPE.md', { maxTicks });
  const journal = await fs.readFile(path.join(workspace, '.journal.log'), 'utf-8');
  const trapFrames = parseTrapFrames(journal);
  return {
    id,
    workspace,
    ticks: result.ticks,
    finalQ: result.q,
    finalD: result.d,
    trapFrames,
  };
}

function toMarkdown(report: AnalyticsReport, jsonPath: string): string {
  return [
    '# Guard Analytics Report',
    '',
    `- stamp: ${report.stamp}`,
    `- pass: ${report.pass}`,
    `- report_json: ${jsonPath}`,
    '',
    '## Checks',
    '',
    '| Check | Result | Details |',
    '|---|---|---|',
    ...report.checks.map((item) => `| ${item.id} | ${item.pass ? 'PASS' : 'FAIL'} | ${item.details} |`),
    '',
    '## Metrics',
    '',
    `- total_trap_frames: ${report.metrics.totalTrapFrames}`,
    `- schema_valid_rate: ${report.metrics.schemaValidRate}`,
    `- cpu_fault_frames: ${report.metrics.cpuFaultFrames}`,
    `- thrashing_frames: ${report.metrics.thrashingFrames}`,
    `- panic_reset_frames: ${report.metrics.panicResetFrames}`,
    `- unrecoverable_frames: ${report.metrics.unrecoverableFrames}`,
    '',
    '## Scenario Workspaces',
    '',
    `- thrashing: ${report.scenarios.thrashing.workspace}`,
    `- panic_budget: ${report.scenarios.panicBudget.workspace}`,
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  const thrashing = await runScenario('thrashing', new ThrashingScenarioOracle(), 'q_thrashing_boot', 7);
  const panicBudget = await runScenario('panic_budget', new PanicBudgetOracle(), 'q_panic_boot', 12);

  const allFrames = [...thrashing.trapFrames, ...panicBudget.trapFrames];
  const schemaValidFrames = allFrames.filter(isSchemaValid).length;
  const cpuFaultFrames = allFrames.filter((frame) => frame.trap_base === 'sys://trap/cpu_fault').length;
  const thrashingFrames = allFrames.filter((frame) => frame.trap_base === 'sys://trap/thrashing').length;
  const panicResetFrames = allFrames.filter((frame) => frame.trap_base === 'sys://trap/panic_reset').length;
  const unrecoverableFrames = allFrames.filter((frame) => frame.trap_base === 'sys://trap/unrecoverable_loop').length;
  const schemaValidRate = Number(
    (schemaValidFrames / (allFrames.length === 0 ? 1 : allFrames.length)).toFixed(4)
  );

  const checks: AnalyticsReport['checks'] = [
    {
      id: 'trap_frame_schema_valid',
      pass: schemaValidRate === 1,
      details: `schema_valid_rate=${schemaValidRate}`,
    },
    {
      id: 'thrashing_trap_detected',
      pass: thrashingFrames >= 1,
      details: `thrashing_frames=${thrashingFrames}`,
    },
    {
      id: 'panic_reset_engages_under_cpu_fault_loop',
      pass: cpuFaultFrames >= 1 && panicResetFrames >= 1,
      details: `cpu_fault_frames=${cpuFaultFrames}, panic_reset_frames=${panicResetFrames}`,
    },
    {
      id: 'panic_reset_rate_bounded',
      pass: panicResetFrames <= 4,
      details: `panic_reset_frames=${panicResetFrames} (expected <= 4 within 12 ticks)`,
    },
  ];

  const stamp = timestamp();
  const report: AnalyticsReport = {
    stamp,
    pass: checks.every((item) => item.pass),
    checks,
    scenarios: {
      thrashing,
      panicBudget,
    },
    metrics: {
      totalTrapFrames: allFrames.length,
      schemaValidRate,
      cpuFaultFrames,
      thrashingFrames,
      panicResetFrames,
      unrecoverableFrames,
    },
  };

  const reportJsonPath = path.join(AUDIT_DIR, `guard_analytics_${stamp}.json`);
  const reportMdPath = path.join(AUDIT_DIR, `guard_analytics_${stamp}.md`);
  const latestJsonPath = path.join(AUDIT_DIR, 'guard_analytics_latest.json');
  const latestMdPath = path.join(AUDIT_DIR, 'guard_analytics_latest.md');

  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(reportMdPath, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');
  await fs.writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(latestMdPath, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');

  for (const check of checks) {
    console.log(`[guard-analytics] ${check.pass ? 'PASS' : 'FAIL'} ${check.id}: ${check.details}`);
  }
  console.log(`[guard-analytics] report=${reportJsonPath}`);
  if (!report.pass) {
    console.error('[guard-analytics] FAIL');
    process.exitCode = 1;
    return;
  }
  console.log('[guard-analytics] PASS');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[guard-analytics] fatal: ${message}`);
  process.exitCode = 1;
});
