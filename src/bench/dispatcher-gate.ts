import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DispatcherOracle } from '../oracle/dispatcher-oracle.js';
import { IOracle, Slice, State, Transition } from '../kernel/types.js';

interface GateResult {
  name: string;
  pass: boolean;
  details: string;
}

interface GateReport {
  stamp: string;
  pass: boolean;
  results: GateResult[];
}

class FixedOracle implements IOracle {
  constructor(private readonly transition: Transition) {}

  public async collapse(_discipline: string, _q: State, _s: Slice): Promise<Transition> {
    return this.transition;
  }
}

class FailingOracle implements IOracle {
  constructor(private readonly message: string) {}

  public async collapse(_discipline: string, _q: State, _s: Slice): Promise<Transition> {
    throw new Error(this.message);
  }
}

const ROOT = path.resolve(process.cwd());
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'protocol');

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

function toMarkdown(report: GateReport, jsonPath: string): string {
  return [
    '# Dispatcher Gate',
    '',
    `- stamp: ${report.stamp}`,
    `- pass: ${report.pass}`,
    `- report_json: ${jsonPath}`,
    '',
    '| Check | Result | Details |',
    '|---|---|---|',
    ...report.results.map((item) => `| ${item.name} | ${item.pass ? 'PASS' : 'FAIL'} | ${item.details} |`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  const results: GateResult[] = [];

  try {
    const dispatcher = new DispatcherOracle({
      pOracle: new FixedOracle({ q_next: 'p_lane', a_t: { op: 'SYS_POP' } }),
      eOracle: new FixedOracle({ q_next: 'e_lane', a_t: { op: 'SYS_GOTO', pointer: 'MAIN_TAPE.md' } }),
      pLaneLabel: 'P:test',
      eLaneLabel: 'E:test',
    });
    const transition = await dispatcher.collapse('disc', 'q_work', '[OBSERVED] normal');
    const trace = dispatcher.consumeLastRouteTrace();
    assert.equal(transition.a_t.op, 'SYS_GOTO');
    assert.ok(trace && trace.lane === 'E', `expected E lane, got ${trace ? trace.lane : 'none'}`);
    results.push({ name: 'Routine route -> E lane', pass: true, details: `lane=${trace?.lane}` });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name: 'Routine route -> E lane', pass: false, details: message });
  }

  try {
    const dispatcher = new DispatcherOracle({
      pOracle: new FixedOracle({ q_next: 'p_recover', a_t: { op: 'SYS_POP' } }),
      eOracle: new FixedOracle({ q_next: 'e_routine', a_t: { op: 'SYS_GOTO', pointer: 'MAIN_TAPE.md' } }),
      pLaneLabel: 'P:test',
      eLaneLabel: 'E:test',
    });
    const transition = await dispatcher.collapse('disc', 'q_fault', '[OS_TRAP: CPU_FAULT] invalid syscall');
    const trace = dispatcher.consumeLastRouteTrace();
    assert.equal(transition.a_t.op, 'SYS_POP');
    assert.ok(trace && trace.lane === 'P', `expected P lane, got ${trace ? trace.lane : 'none'}`);
    assert.ok(trace && trace.reason.includes('trap_context'), `expected trap_context reason, got ${trace?.reason}`);
    results.push({ name: 'Trap escalation -> P lane', pass: true, details: `lane=${trace?.lane}; reason=${trace?.reason}` });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name: 'Trap escalation -> P lane', pass: false, details: message });
  }

  try {
    const dispatcher = new DispatcherOracle({
      pOracle: new FixedOracle({ q_next: 'p_failover', a_t: { op: 'SYS_EXEC', cmd: 'echo recovered' } }),
      eOracle: new FailingOracle('E lane simulated failure'),
      pLaneLabel: 'P:test',
      eLaneLabel: 'E:test',
    });
    const transition = await dispatcher.collapse('disc', 'q_work', '[OBSERVED] routine');
    const trace = dispatcher.consumeLastRouteTrace();
    assert.equal(transition.a_t.op, 'SYS_EXEC');
    assert.ok(trace && trace.lane === 'P', `expected failover to P, got ${trace ? trace.lane : 'none'}`);
    assert.ok(trace && trace.failover_from === 'E', `expected failover_from=E, got ${trace?.failover_from}`);
    results.push({ name: 'Runtime failover E->P', pass: true, details: `lane=${trace?.lane}; failover=${trace?.failover_from}` });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name: 'Runtime failover E->P', pass: false, details: message });
  }

  const report: GateReport = {
    stamp: timestamp(),
    pass: results.every((item) => item.pass),
    results,
  };
  const jsonPath = path.join(AUDIT_DIR, `dispatcher_gate_${report.stamp}.json`);
  const mdPath = path.join(AUDIT_DIR, `dispatcher_gate_${report.stamp}.md`);
  const latestJsonPath = path.join(AUDIT_DIR, 'dispatcher_gate_latest.json');
  const latestMdPath = path.join(AUDIT_DIR, 'dispatcher_gate_latest.md');

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(mdPath, `${toMarkdown(report, jsonPath)}\n`, 'utf-8');
  await fs.writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(latestMdPath, `${toMarkdown(report, jsonPath)}\n`, 'utf-8');

  for (const result of results) {
    console.log(`[dispatcher-gate] ${result.pass ? 'PASS' : 'FAIL'} ${result.name}: ${result.details}`);
  }
  console.log(`[dispatcher-gate] report=${jsonPath}`);

  if (!report.pass) {
    console.error('[dispatcher-gate] FAIL');
    process.exitCode = 1;
    return;
  }
  console.log('[dispatcher-gate] PASS');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[dispatcher-gate] fatal: ${message}`);
  process.exitCode = 1;
});
