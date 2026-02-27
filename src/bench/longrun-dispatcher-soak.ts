import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileChronos } from '../chronos/file-chronos.js';
import { TuringEngine } from '../kernel/engine.js';
import { IOracle, Slice, State, Transition } from '../kernel/types.js';
import { LocalManifold } from '../manifold/local-manifold.js';
import { DispatcherOracle } from '../oracle/dispatcher-oracle.js';

interface RouteStats {
  samples: number;
  pSamples: number;
  eSamples: number;
  failovers: number;
}

interface SoakReport {
  stamp: string;
  workspace: string;
  ticksRequested: number;
  ticksObserved: number;
  route: RouteStats;
  cpuFaultCount: number;
  unrecoverableLoopCount: number;
  pass: boolean;
  checks: Array<{ id: string; pass: boolean; details: string }>;
}

class SoakEOracle implements IOracle {
  private seq = 0;

  public async collapse(_discipline: string, _q: State, _s: Slice): Promise<Transition> {
    this.seq += 1;
    const triggerEscalation = this.seq % 50 === 0;
    const q_next = triggerEscalation ? `[OS_TRAP: SYNTHETIC_ESCALATE] tick_${this.seq}` : `tick_${this.seq}`;
    return {
      q_next,
      a_t: { op: 'SYS_GOTO', pointer: 'MAIN_TAPE.md' },
    };
  }
}

class SoakPOracle implements IOracle {
  private seq = 0;

  public async collapse(_discipline: string, _q: State, _s: Slice): Promise<Transition> {
    this.seq += 1;
    return {
      q_next: `p_recover_${this.seq}`,
      a_t: { op: 'SYS_GOTO', pointer: 'MAIN_TAPE.md' },
    };
  }
}

const ROOT = path.resolve(process.cwd());
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'longrun');

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

function countMatches(raw: string, pattern: RegExp): number {
  const matches = raw.match(pattern);
  return matches ? matches.length : 0;
}

function parseRoutes(journalRaw: string): RouteStats {
  const lines = journalRaw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('[BUS_ROUTE]'));
  let pSamples = 0;
  let eSamples = 0;
  let failovers = 0;
  for (const line of lines) {
    const match = line.match(/\[BUS_ROUTE\]\s*(\{.*\})$/);
    if (!match?.[1]) {
      continue;
    }
    try {
      const payload = JSON.parse(match[1]) as Record<string, unknown>;
      const lane = typeof payload.lane === 'string' ? payload.lane.toUpperCase() : '';
      if (lane === 'P') {
        pSamples += 1;
      } else if (lane === 'E') {
        eSamples += 1;
      }
      if (typeof payload.failover_from === 'string') {
        failovers += 1;
      }
    } catch {
      continue;
    }
  }
  const samples = pSamples + eSamples;
  return { samples, pSamples, eSamples, failovers };
}

function toMarkdown(report: SoakReport, jsonPath: string): string {
  return [
    '# Dispatcher Longrun Soak Report',
    '',
    `- stamp: ${report.stamp}`,
    `- workspace: ${report.workspace}`,
    `- pass: ${report.pass}`,
    `- report_json: ${jsonPath}`,
    '',
    '## Metrics',
    '',
    `- ticks_requested: ${report.ticksRequested}`,
    `- ticks_observed: ${report.ticksObserved}`,
    `- route_samples: ${report.route.samples}`,
    `- route_coverage: ${Number((report.route.samples / (report.ticksRequested === 0 ? 1 : report.ticksRequested)).toFixed(4))}`,
    `- route_p_samples: ${report.route.pSamples}`,
    `- route_e_samples: ${report.route.eSamples}`,
    `- route_failovers: ${report.route.failovers}`,
    `- cpu_fault_count: ${report.cpuFaultCount}`,
    `- unrecoverable_loop_count: ${report.unrecoverableLoopCount}`,
    '',
    '## Checks',
    '',
    '| Check | Result | Details |',
    '|---|---|---|',
    ...report.checks.map((item) => `| ${item.id} | ${item.pass ? 'PASS' : 'FAIL'} | ${item.details} |`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  const ticksRequested = 1200;
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'turingos-longrun-dispatcher-'));
  await fs.writeFile(path.join(workspace, 'MAIN_TAPE.md'), '# dispatcher soak\n', 'utf-8');

  const manifold = new LocalManifold(workspace);
  const chronos = new FileChronos(path.join(workspace, '.journal.log'));
  const dispatcher = new DispatcherOracle({
    pOracle: new SoakPOracle(),
    eOracle: new SoakEOracle(),
    pLaneLabel: 'P:soak',
    eLaneLabel: 'E:soak',
  });
  const engine = new TuringEngine(manifold, dispatcher, chronos, 'strict json');
  const result = await engine.ignite('q_soak_boot', 'MAIN_TAPE.md', { maxTicks: ticksRequested });
  const journal = await fs.readFile(path.join(workspace, '.journal.log'), 'utf-8');
  const route = parseRoutes(journal);
  const ticksObserved = route.samples;
  const routeCoverage = Number((route.samples / ticksRequested).toFixed(4));
  const cpuFaultCount = countMatches(journal, /sys:\/\/trap\/cpu_fault/g);
  const unrecoverableLoopCount = countMatches(journal, /sys:\/\/trap\/unrecoverable_loop/g);

  const checks: SoakReport['checks'] = [
    {
      id: 'ticks_observed_>=_1000',
      pass: ticksObserved >= 1000,
      details: `ticks_observed=${ticksObserved}`,
    },
    {
      id: 'route_coverage_>=_0.99',
      pass: routeCoverage >= 0.99,
      details: `coverage=${routeCoverage}`,
    },
    {
      id: 'dual_lane_usage',
      pass: route.pSamples > 0 && route.eSamples > 0,
      details: `p_samples=${route.pSamples}, e_samples=${route.eSamples}`,
    },
    {
      id: 'no_cpu_fault_or_unrecoverable_loop',
      pass: cpuFaultCount === 0 && unrecoverableLoopCount === 0,
      details: `cpu_fault=${cpuFaultCount}, unrecoverable=${unrecoverableLoopCount}`,
    },
  ];

  const report: SoakReport = {
    stamp: timestamp(),
    workspace,
    ticksRequested,
    ticksObserved,
    route,
    cpuFaultCount,
    unrecoverableLoopCount,
    pass: checks.every((item) => item.pass) && (result.q.trim() !== 'HALT' || result.d.trim() !== 'HALT'),
    checks,
  };

  const reportJsonPath = path.join(AUDIT_DIR, `dispatcher_longrun_soak_${report.stamp}.json`);
  const reportMdPath = path.join(AUDIT_DIR, `dispatcher_longrun_soak_${report.stamp}.md`);
  const latestJsonPath = path.join(AUDIT_DIR, 'dispatcher_longrun_soak_latest.json');
  const latestMdPath = path.join(AUDIT_DIR, 'dispatcher_longrun_soak_latest.md');

  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(reportMdPath, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');
  await fs.writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(latestMdPath, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');

  for (const check of checks) {
    console.log(`[longrun-soak] ${check.pass ? 'PASS' : 'FAIL'} ${check.id}: ${check.details}`);
  }
  console.log(`[longrun-soak] report=${reportJsonPath}`);
  if (!report.pass) {
    console.error('[longrun-soak] FAIL');
    process.exitCode = 1;
    return;
  }
  console.log('[longrun-soak] PASS');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[longrun-soak] fatal: ${message}`);
  process.exitCode = 1;
});
