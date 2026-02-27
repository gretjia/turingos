import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileChronos } from '../chronos/file-chronos.js';
import { TuringEngine } from '../kernel/engine.js';
import { IOracle, Slice, State, Transition } from '../kernel/types.js';
import { LocalManifold } from '../manifold/local-manifold.js';

interface Check {
  id: string;
  pass: boolean;
  details: string;
}

interface ChaosGateReport {
  stamp: string;
  pass: boolean;
  checks: Check[];
}

interface ReplayTuple {
  tick_seq?: number;
  s_t?: string;
  a_t?: { op?: string; cmd?: string };
}

class HaltAfterFloodOracle implements IOracle {
  private step = 0;

  public async collapse(_discipline: string, _q: State, _s: Slice): Promise<Transition> {
    this.step += 1;
    if (this.step === 1) {
      return {
        q_next: 'q_after_flood_exec',
        a_t: { op: 'SYS_EXEC', cmd: 'echo flood_probe' },
      };
    }
    return {
      q_next: 'HALT',
      a_t: { op: 'SYS_HALT' },
    };
  }
}

class RecoverAfterFloodOracle implements IOracle {
  private booted = false;
  private recovered = false;

  public async collapse(_discipline: string, _q: State, s: Slice): Promise<Transition> {
    if (!this.booted) {
      this.booted = true;
      return {
        q_next: 'q_flood_probe',
        a_t: { op: 'SYS_EXEC', cmd: 'echo flood_probe' },
      };
    }

    if (
      !this.recovered &&
      (s.includes('[OS_TRAP: LOG_FLOOD]') ||
        (s.includes('[PAGE_TABLE_SUMMARY]') && s.includes('Source=command:')))
    ) {
      this.recovered = true;
      return {
        q_next: 'q_recover_probe',
        a_t: { op: 'SYS_EXEC', cmd: 'printf \"alpha\\nbeta\\n\" | tail -n 1' },
      };
    }

    return {
      q_next: 'q_continue_probe',
      a_t: { op: 'SYS_GOTO', pointer: 'sys://callstack' },
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

function toMarkdown(report: ChaosGateReport, jsonPath: string): string {
  return [
    '# Chaos Monkey Gate',
    '',
    `- stamp: ${report.stamp}`,
    `- pass: ${report.pass}`,
    `- report_json: ${jsonPath}`,
    '',
    '| Check | Result | Details |',
    '|---|---|---|',
    ...report.checks.map((check) => `| ${check.id} | ${check.pass ? 'PASS' : 'FAIL'} | ${check.details} |`),
    '',
  ].join('\n');
}

function parseReplayTuples(journalRaw: string): ReplayTuple[] {
  const tuples: ReplayTuple[] = [];
  const lines = journalRaw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    const match = line.match(/\[REPLAY_TUPLE\]\s*(\{.*\})$/);
    if (!match?.[1]) {
      continue;
    }
    try {
      tuples.push(JSON.parse(match[1]) as ReplayTuple);
    } catch {
      continue;
    }
  }
  return tuples;
}

async function main(): Promise<void> {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  const stamp = timestamp();
  const floodCharsRaw = Number.parseInt(process.env.TURINGOS_CHAOS_GATE_LOG_FLOOD_CHARS ?? '50000', 10);
  const floodChars = Number.isFinite(floodCharsRaw) && floodCharsRaw > 0 ? floodCharsRaw : 50_000;
  const checks: Check[] = [];

  {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'turingos-chaos-timeout-'));
    const manifold = new LocalManifold(ws, {
      maxSliceChars: 4096,
      enableChaos: true,
      chaosExecTimeoutRate: 1,
      chaosWriteDenyRate: 0,
      chaosLogFloodRate: 0,
    });
    const slice = await manifold.observe('$ echo chaos_timeout_probe');
    const pass =
      slice.includes('[EXIT_CODE] 124') && slice.includes('[FATAL] PROCESS_TIMEOUT: Execution hanging.');
    checks.push({
      id: 'chaos_exec_timeout',
      pass,
      details: pass ? 'timeout trap injected as expected' : slice.slice(0, 240).replace(/\n/g, ' | '),
    });
  }

  {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'turingos-chaos-write-'));
    const manifold = new LocalManifold(ws, {
      maxSliceChars: 4096,
      enableChaos: true,
      chaosExecTimeoutRate: 0,
      chaosWriteDenyRate: 1,
      chaosLogFloodRate: 0,
    });
    let blocked = false;
    let details = '';
    let residue = '';
    let residuePass = false;
    try {
      await manifold.interfere('src/out.txt', 'write_probe');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      blocked = message.includes('EACCES');
      details = message;
    }
    try {
      residue = await fs.readFile(path.join(ws, 'src', 'out.txt'), 'utf-8');
      residuePass = residue.length > 0 && 'write_probe'.startsWith(residue);
    } catch {
      residuePass = false;
    }
    checks.push({
      id: 'chaos_write_eacces',
      pass: blocked && residuePass,
      details:
        blocked && residuePass
          ? `write blocked with EACCES and partial residue="${residue}"`
          : details || `write unexpectedly succeeded or residue check failed (residue="${residue}")`,
    });
  }

  {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'turingos-chaos-flood-'));
    const manifold = new LocalManifold(ws, {
      maxSliceChars: 4096,
      enableChaos: true,
      chaosExecTimeoutRate: 0,
      chaosWriteDenyRate: 0,
      chaosLogFloodRate: 1,
      chaosLogFloodChars: floodChars,
    });
    const summary = await manifold.observe('$ echo flood_probe');
    const token = summary.match(/Token=([a-f0-9]+)/)?.[1];
    const page2 = token ? await manifold.observe(`sys://page/${token}?p=2`) : '';
    const pagedEvidence =
      summary.includes('[PAGE_TABLE_SUMMARY]') &&
      summary.includes('Source=command:echo flood_probe') &&
      page2.includes('[FOCUS_PAGE_CONTENT]');
    const throttledEvidence =
      summary.includes('[OS_TRAP: LOG_FLOOD]') &&
      summary.includes('[LOG_BACKPRESSURE]') &&
      summary.includes('source_command=echo flood_probe');
    const pass =
      pagedEvidence || throttledEvidence;
    checks.push({
      id: 'chaos_log_flood_paged',
      pass,
      details: pass
        ? `mode=${pagedEvidence ? 'paged' : 'throttled'} token=${token ?? '(missing)'} flood_chars=${floodChars}`
        : `summary=${summary.slice(0, 180).replace(/\n/g, ' | ')}`,
    });
  }

  {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'turingos-chaos-anti-halt-'));
    await fs.writeFile(path.join(ws, 'MAIN_TAPE.md'), '# boot\n', 'utf-8');
    const manifold = new LocalManifold(ws, {
      maxSliceChars: 4096,
      enableChaos: true,
      chaosExecTimeoutRate: 0,
      chaosWriteDenyRate: 0,
      chaosLogFloodRate: 1,
      chaosLogFloodChars: floodChars,
      logBackpressureBytes: 4096,
      logMaxTailLines: 80,
      logFloodSummaryMode: 'tail',
    });
    const chronos = new FileChronos(path.join(ws, '.journal.log'));
    const engine = new TuringEngine(manifold, new HaltAfterFloodOracle(), chronos, 'strict json');
    const result = await engine.ignite('q_boot', 'MAIN_TAPE.md', { maxTicks: 3 });
    const blocked =
      result.d.startsWith('sys://trap/log_flood_followup_required') ||
      result.q.includes('[OS_TRAP: LOG_FLOOD_FOLLOWUP_REQUIRED]');
    checks.push({
      id: 'halt_blocked_until_log_flood_followup',
      pass: blocked,
      details: blocked
        ? `pointer=${result.d}`
        : `unexpected_result d=${result.d} q=${result.q.slice(0, 120).replace(/\n/g, ' | ')}`,
    });
  }

  {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'turingos-chaos-recovery-'));
    await fs.writeFile(path.join(ws, 'MAIN_TAPE.md'), '# boot\n', 'utf-8');
    const manifold = new LocalManifold(ws, {
      maxSliceChars: 4096,
      enableChaos: true,
      chaosExecTimeoutRate: 0,
      chaosWriteDenyRate: 0,
      chaosLogFloodRate: 1,
      chaosLogFloodChars: floodChars,
      logBackpressureBytes: 4096,
      logMaxTailLines: 80,
      logFloodSummaryMode: 'tail',
    });
    const chronosPath = path.join(ws, '.journal.log');
    const chronos = new FileChronos(chronosPath);
    const engine = new TuringEngine(manifold, new RecoverAfterFloodOracle(), chronos, 'strict json');
    let q = 'q_boot';
    let d = 'MAIN_TAPE.md';
    const tickDurationsMs: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const startedAt = Date.now();
      [q, d] = await engine.tick(q, d);
      tickDurationsMs.push(Date.now() - startedAt);
    }

    const journalRaw = await fs.readFile(chronosPath, 'utf-8');
    const tuples = parseReplayTuples(journalRaw);
    const floodTriggerIdx = tuples.findIndex(
      (tuple) => tuple.a_t?.op === 'SYS_EXEC' && (tuple.a_t?.cmd ?? '').toLowerCase().includes('flood_probe')
    );
    const floodObservedIdx = tuples.findIndex(
      (tuple) =>
        typeof tuple.s_t === 'string' &&
        (tuple.s_t.includes('[OS_TRAP: LOG_FLOOD]') ||
          (tuple.s_t.includes('[PAGE_TABLE_SUMMARY]') && tuple.s_t.includes('Source=command:')))
    );
    const followupIdx = tuples.findIndex((tuple, idx) => {
      if (idx <= floodTriggerIdx) {
        return false;
      }
      if (tuple.a_t?.op !== 'SYS_EXEC') {
        return false;
      }
      const cmd = (tuple.a_t?.cmd ?? '').toLowerCase();
      return /\b(grep|tail|head|sed|awk|wc|less|more)\b/.test(cmd) && !cmd.includes('flood_probe');
    });
    const mttrTicks = floodTriggerIdx >= 0 && followupIdx > floodTriggerIdx ? followupIdx - floodTriggerIdx : -1;
    const maxTickDuration = tickDurationsMs.length > 0 ? Math.max(...tickDurationsMs) : 0;
    checks.push({
      id: 'log_flood_recovery_mttr_lte_5',
      pass: floodTriggerIdx >= 0 && floodObservedIdx >= 0 && followupIdx > floodTriggerIdx && mttrTicks <= 5,
      details:
        floodTriggerIdx >= 0 && followupIdx > floodTriggerIdx
          ? `trigger_idx=${floodTriggerIdx} observed_idx=${floodObservedIdx} followup_idx=${followupIdx} mttr_ticks=${mttrTicks}`
          : `trigger_idx=${floodTriggerIdx} observed_idx=${floodObservedIdx} followup_idx=${followupIdx}`,
    });
    checks.push({
      id: 'tick_duration_under_30s',
      pass: maxTickDuration < 30_000,
      details: `max_tick_ms=${maxTickDuration}`,
    });
  }

  for (const check of checks) {
    assert.equal(check.pass, true, `${check.id} failed: ${check.details}`);
  }

  const report: ChaosGateReport = {
    stamp,
    pass: checks.every((check) => check.pass),
    checks,
  };

  const reportJsonPath = path.join(AUDIT_DIR, `chaos_monkey_gate_${stamp}.json`);
  const reportMdPath = path.join(AUDIT_DIR, `chaos_monkey_gate_${stamp}.md`);
  const latestJsonPath = path.join(AUDIT_DIR, 'chaos_monkey_gate_latest.json');
  const latestMdPath = path.join(AUDIT_DIR, 'chaos_monkey_gate_latest.md');

  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(reportMdPath, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');
  await fs.writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(latestMdPath, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');

  for (const check of checks) {
    console.log(`[chaos-gate] ${check.pass ? 'PASS' : 'FAIL'} ${check.id}: ${check.details}`);
  }
  console.log(`[chaos-gate] report=${reportJsonPath}`);
  if (!report.pass) {
    console.error('[chaos-gate] FAIL');
    process.exitCode = 1;
    return;
  }
  console.log('[chaos-gate] PASS');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[chaos-gate] fatal: ${message}`);
  process.exitCode = 1;
});
