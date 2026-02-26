import { exec, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileChronos } from '../chronos/file-chronos.js';
import { TuringEngine } from '../kernel/engine.js';
import { IOracle, Slice, State, Transition } from '../kernel/types.js';
import { LocalManifold } from '../manifold/local-manifold.js';
import { UniversalOracle } from '../oracle/universal-oracle.js';

type AcStatus = 'PASS' | 'FAIL' | 'BLOCKED';
type StageId = 'S1' | 'S2' | 'S3' | 'S4' | 'VOYAGER';

interface AcResult {
  stage: StageId;
  acId: string;
  title: string;
  status: AcStatus;
  requirement: string;
  details: string;
  evidence: string[];
  nextActions: string[];
}

interface StageSummary {
  stage: StageId;
  total: number;
  pass: number;
  fail: number;
  blocked: number;
  status: 'PASS' | 'FAIL' | 'PARTIAL';
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface SpawnResult extends CommandResult {
  signal: NodeJS.Signals | null;
}

interface AcceptanceRuntimeContext {
  auditStamp?: string;
  ac31Workspace?: string;
  ac31TracePath?: string;
}

const ROOT = path.resolve(process.cwd());
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'recursive');
const GOLDEN_TRACE_DIR = path.join(ROOT, 'benchmarks', 'audits', 'evidence', 'golden_traces');
const LOCAL_ALU_AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'local_alu');
const LOCAL_ALU_LATEST_FILE = path.join(LOCAL_ALU_AUDIT_DIR, 'ac41b_latest.json');
const AC42_LATEST_FILE = path.join(AUDIT_DIR, 'ac42_deadlock_reflex_latest.json');

interface GoldenTraceSource {
  source: string;
  targetName: string;
  required?: boolean;
}

interface GoldenTraceBundle {
  bundleDir: string;
  manifestPath: string;
  copiedPaths: string[];
}

interface LocalAluGateMetrics {
  stamp: string;
  source: string;
  totalSamples: number;
  validSamples: number;
  mutexViolations: number;
  validJsonRate: number;
  mutexViolationRate: number;
  pass: boolean;
  reportJsonPath: string;
  reportMdPath: string;
}

interface Ac42GateMetrics {
  stamp: string;
  source: string;
  runtimeMode: string;
  liveOracleCycles: number | null;
  setupReady: boolean | null;
  setupError: string | null;
  oracleCalls: number | null;
  oracleBypassDecisions: number | null;
  deadlockEvents: number;
  popOnTrap: number;
  gotoAfterPop: number;
  escapeRate: number;
  gotoAfterPopRate: number;
  pass: boolean;
  reportJsonPath: string;
  reportMdPath: string;
}

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

function mkWorkspace(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sanitizeBundleId(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized.length > 0 ? normalized.slice(0, 120) : 'bundle';
}

async function sha256File(filePath: string): Promise<string> {
  const raw = await fsp.readFile(filePath);
  return createHash('sha256').update(raw).digest('hex');
}

async function archiveGoldenTraceBundle(
  bundleId: string,
  sources: GoldenTraceSource[],
  metadata: Record<string, unknown>
): Promise<GoldenTraceBundle> {
  const safeId = sanitizeBundleId(bundleId);
  const bundleDir = path.join(GOLDEN_TRACE_DIR, safeId);
  await fsp.mkdir(bundleDir, { recursive: true });

  const copiedPaths: string[] = [];
  const copiedManifest: Array<Record<string, unknown>> = [];
  for (const source of sources) {
    const required = source.required ?? true;
    if (!fs.existsSync(source.source)) {
      if (required) {
        throw new Error(`[GOLDEN_TRACE_MISSING] required source not found: ${source.source}`);
      }
      copiedManifest.push({
        source: source.source,
        target: source.targetName,
        status: 'missing_optional',
      });
      continue;
    }

    const targetPath = path.join(bundleDir, source.targetName);
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.copyFile(source.source, targetPath);
    const stat = await fsp.stat(targetPath);
    const digest = await sha256File(targetPath);
    copiedPaths.push(targetPath);
    copiedManifest.push({
      source: source.source,
      target: targetPath,
      bytes: stat.size,
      sha256: digest,
      status: 'copied',
    });
  }

  const manifestPath = path.join(bundleDir, 'manifest.json');
  await fsp.writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        bundleId: safeId,
        metadata,
        files: copiedManifest,
      },
      null,
      2
    )}\n`,
    'utf-8'
  );

  return {
    bundleDir,
    manifestPath,
    copiedPaths,
  };
}

function runCommand(command: string, cwd = ROOT, timeoutMs = 120000): Promise<CommandResult> {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 8,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const anyErr = error as Error & { code?: number | null };
        resolve({
          code: anyErr.code ?? 1,
          stdout,
          stderr: `${stderr}\n${error.message}`,
        });
      }
    );
  });
}

function spawnNpm(
  args: string[],
  cwd = ROOT,
  env: NodeJS.ProcessEnv = process.env
): { child: ReturnType<typeof spawn>; done: Promise<SpawnResult> } {
  const child = spawn('npm', args, { cwd, env, detached: true });
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf-8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf-8');
  });

  const done = new Promise<SpawnResult>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({
        code,
        signal,
        stdout,
        stderr,
      });
    });
  });

  return { child, done };
}

async function readTrimmed(filePath: string): Promise<string> {
  try {
    return (await fsp.readFile(filePath, 'utf-8')).trim();
  } catch {
    return '';
  }
}

async function readLocalAluGateMetrics(): Promise<LocalAluGateMetrics | null> {
  try {
    const raw = await fsp.readFile(LOCAL_ALU_LATEST_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const toNumber = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;
    const toString = (value: unknown): string | null =>
      typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

    const stamp = toString(parsed.stamp);
    const source = toString(parsed.source);
    const totalSamples = toNumber(parsed.totalSamples);
    const validSamples = toNumber(parsed.validSamples);
    const mutexViolations = toNumber(parsed.mutexViolations);
    const validJsonRate = toNumber(parsed.validJsonRate);
    const mutexViolationRate = toNumber(parsed.mutexViolationRate);
    const pass = parsed.pass === true;
    const reportJsonPath = toString(parsed.reportJsonPath);
    const reportMdPath = toString(parsed.reportMdPath);

    if (
      !stamp ||
      !source ||
      totalSamples === null ||
      validSamples === null ||
      mutexViolations === null ||
      validJsonRate === null ||
      mutexViolationRate === null ||
      !reportJsonPath ||
      !reportMdPath
    ) {
      return null;
    }

    return {
      stamp,
      source,
      totalSamples,
      validSamples,
      mutexViolations,
      validJsonRate,
      mutexViolationRate,
      pass,
      reportJsonPath,
      reportMdPath,
    };
  } catch {
    return null;
  }
}

async function readAc42GateMetrics(): Promise<Ac42GateMetrics | null> {
  try {
    const raw = await fsp.readFile(AC42_LATEST_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const toNumber = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;
    const toString = (value: unknown): string | null =>
      typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

    const stamp = toString(parsed.stamp);
    const source = toString(parsed.source);
    const runtimeMode = toString(parsed.runtimeMode) ?? 'legacy_unknown';
    const liveOracleCycles = toNumber(parsed.liveOracleCycles);
    const setupReady = typeof parsed.setupReady === 'boolean' ? parsed.setupReady : null;
    const setupError = toString(parsed.setupError);
    const oracleCalls = toNumber(parsed.oracleCalls);
    const oracleBypassDecisions = toNumber(parsed.oracleBypassDecisions);
    const deadlockEvents = toNumber(parsed.deadlockEvents);
    const popOnTrap = toNumber(parsed.popOnTrap);
    const gotoAfterPop = toNumber(parsed.gotoAfterPop);
    const escapeRate = toNumber(parsed.escapeRate);
    const gotoAfterPopRate = toNumber(parsed.gotoAfterPopRate);
    const pass = parsed.pass === true;
    const reportJsonPath = toString(parsed.reportJsonPath);
    const reportMdPath = toString(parsed.reportMdPath);

    if (
      !stamp ||
      !source ||
      deadlockEvents === null ||
      popOnTrap === null ||
      gotoAfterPop === null ||
      escapeRate === null ||
      gotoAfterPopRate === null ||
      !reportJsonPath ||
      !reportMdPath
    ) {
      return null;
    }

    return {
      stamp,
      source,
      runtimeMode,
      liveOracleCycles,
      setupReady,
      setupError,
      oracleCalls,
      oracleBypassDecisions,
      deadlockEvents,
      popOnTrap,
      gotoAfterPop,
      escapeRate,
      gotoAfterPopRate,
      pass,
      reportJsonPath,
      reportMdPath,
    };
  } catch {
    return null;
  }
}

async function waitForRegisterQ(workspace: string, expectedQ: string, timeoutMs: number): Promise<boolean> {
  const qPath = path.join(workspace, '.reg_q');
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const q = await readTrimmed(qPath);
    if (q === expectedQ) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function collectFiles(root: string, current = root, out: string[] = []): Promise<string[]> {
  const entries = await fsp.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(root, full, out);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const relative = path.relative(root, full).replace(/\\/g, '/');
    if (
      relative === '.journal.log' ||
      relative === '.journal.merkle.jsonl' ||
      relative.startsWith('.reg_') ||
      relative === '.ac31_worker_ticks.log'
    ) {
      continue;
    }
    out.push(relative);
  }
  return out;
}

async function computeWorkspaceTreeHash(workspace: string): Promise<string> {
  const relFiles = (await collectFiles(workspace)).sort((a, b) => a.localeCompare(b));
  const chunks: string[] = [];
  for (const rel of relFiles) {
    const full = path.join(workspace, rel);
    const raw = await fsp.readFile(full);
    const digest = createHash('sha256').update(raw).digest('hex');
    chunks.push(`${rel}\t${digest}`);
  }
  return createHash('sha256').update(chunks.join('\n')).digest('hex');
}

async function seedAc31Baseline(workspace: string): Promise<void> {
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.mkdir(path.join(workspace, 'checkpoint'), { recursive: true });
  await fsp.mkdir(path.join(workspace, 'artifacts'), { recursive: true });
  await fsp.writeFile(path.join(workspace, 'MAIN_TAPE.md'), 'AC31 process-level kill -9 test\n', 'utf-8');
  await fsp.writeFile(path.join(workspace, 'checkpoint', 'step1.txt'), 'verified\n', 'utf-8');
}

async function collectTraceStats(tracePath: string): Promise<{
  execOps: number;
  timeoutSignals: number;
  mmuSignals: number;
  deadlockSignals: number;
  execMmuSignals: number;
  frames: number;
  traceCorrupted: boolean;
  corruptionReason: string;
}> {
  try {
    const raw = await fsp.readFile(tracePath, 'utf-8');
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    let execOps = 0;
    let timeoutSignals = 0;
    let mmuSignals = 0;
    let deadlockSignals = 0;
    let execMmuSignals = 0;
    let frames = 0;
    for (const line of lines) {
      const match = line.match(/\[REPLAY_TUPLE\]\s*(\{.*\})$/);
      if (!match?.[1]) {
        continue;
      }
      try {
        const tuple = JSON.parse(match[1]) as {
          a_t?: { op?: string };
          observed_slice?: string;
          s_t?: string;
        };
        frames += 1;
        if (tuple.a_t?.op === 'SYS_EXEC') {
          execOps += 1;
        }
        const observed = `${tuple.observed_slice ?? ''}\n${tuple.s_t ?? ''}`;
        if (/(429|502|timeout|rate limit|gateway)/i.test(observed)) {
          timeoutSignals += 1;
        }
        const hasMmuSignal = /(\[OS_FRAME_HARD_LIMIT\]|\[OS_SECTION_CLIPPED\]|\[OS_TRAP: PAGE_FAULT\])/i.test(observed);
        if (hasMmuSignal) {
          mmuSignals += 1;
          if (tuple.a_t?.op === 'SYS_EXEC') {
            execMmuSignals += 1;
          }
        }
        if (/\[OS_PANIC: INFINITE_LOOP_KILLED\]|sys:\/\/trap\/panic_reset|sys:\/\/trap\/watchdog|sys:\/\/trap\/l1_cache_hit/i.test(observed)) {
          deadlockSignals += 1;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`[TRACE_CORRUPTION] malformed replay tuple line: ${message}`);
      }
    }
    return {
      execOps,
      timeoutSignals,
      mmuSignals,
      deadlockSignals,
      execMmuSignals,
      frames,
      traceCorrupted: false,
      corruptionReason: '',
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      execOps: 0,
      timeoutSignals: 0,
      mmuSignals: 0,
      deadlockSignals: 0,
      execMmuSignals: 0,
      frames: 0,
      traceCorrupted: true,
      corruptionReason: message,
    };
  }
}

class DualActionOracle implements IOracle {
  public async collapse(_discipline: string, q: State, _s: Slice): Promise<Transition> {
    return {
      q_next: `${q}\nDUAL_ACTION_SENT`,
      a_t: {
        op: 'SYS_WRITE',
        payload: 'X',
        // Intentional illegal mixed intent for AC1.2.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...( { pointer: 'illegal-next-pointer.txt' } as any ),
      },
    };
  }
}

class ReplayTupleOracle implements IOracle {
  private step = 0;

  public async collapse(_discipline: string, q: State, _s: Slice): Promise<Transition> {
    this.step += 1;
    if (this.step === 1) {
      return { q_next: `${q}\nW_A`, a_t: { op: 'SYS_WRITE', payload: 'A' } };
    }
    if (this.step === 2) {
      return { q_next: `${q}\nTO_B`, a_t: { op: 'SYS_GOTO', pointer: 'artifacts/b.txt' } };
    }
    if (this.step === 3) {
      return { q_next: `${q}\nW_B`, a_t: { op: 'SYS_WRITE', payload: 'B' } };
    }
    if (this.step === 4) {
      return { q_next: `${q}\nBACK_A`, a_t: { op: 'SYS_GOTO', pointer: 'artifacts/a.txt' } };
    }

    return { q_next: q, a_t: { op: 'SYS_GOTO', pointer: 'artifacts/a.txt' } };
  }
}

class FrameCaptureOracle implements IOracle {
  public calls = 0;
  public lastFrame: Slice = '';

  public async collapse(_discipline: string, q: State, s: Slice): Promise<Transition> {
    this.calls += 1;
    this.lastFrame = s;
    return {
      q_next: `${q}\nFRAME_CAPTURED`,
      a_t: { op: 'SYS_GOTO', pointer: 'logs/huge.log' },
    };
  }
}

function stageStatus(results: AcResult[]): StageSummary[] {
  const stages: StageId[] = ['S1', 'S2', 'S3', 'S4', 'VOYAGER'];
  return stages.map((stage) => {
    const rows = results.filter((row) => row.stage === stage);
    const pass = rows.filter((row) => row.status === 'PASS').length;
    const fail = rows.filter((row) => row.status === 'FAIL').length;
    const blocked = rows.filter((row) => row.status === 'BLOCKED').length;
    let status: StageSummary['status'] = 'PASS';
    if (fail > 0) {
      status = 'FAIL';
    } else if (blocked > 0) {
      status = 'PARTIAL';
    }
    return {
      stage,
      total: rows.length,
      pass,
      fail,
      blocked,
      status,
    };
  });
}

function recursiveActionsForStage(stageRows: AcResult[]): string[] {
  const actions = new Set<string>();
  for (const row of stageRows) {
    for (const action of row.nextActions) {
      actions.add(action);
    }
  }
  return [...actions];
}

function toMarkdown(results: AcResult[], summaries: StageSummary[], stamp: string): string {
  const lines: string[] = [
    '# TuringOS Staged Acceptance + Recursive Audit',
    '',
    `- timestamp: ${stamp}`,
    `- repo: ${ROOT}`,
    '',
    '## Stage Summary',
    '',
    '| Stage | Total | Pass | Fail | Blocked | StageStatus |',
    '|---|---:|---:|---:|---:|---|',
    ...summaries.map((s) => `| ${s.stage} | ${s.total} | ${s.pass} | ${s.fail} | ${s.blocked} | ${s.status} |`),
    '',
    '## AC Results',
    '',
    '| Stage | AC | Status | Title |',
    '|---|---|---|---|',
    ...results.map((r) => `| ${r.stage} | ${r.acId} | ${r.status} | ${r.title} |`),
    '',
  ];

  const stageOrder: StageId[] = ['S1', 'S2', 'S3', 'S4', 'VOYAGER'];
  for (const stage of stageOrder) {
    const rows = results.filter((r) => r.stage === stage);
    if (rows.length === 0) continue;
    lines.push(`## ${stage} Recursive Audit`);
    lines.push('');
    for (const row of rows) {
      lines.push(`### ${row.acId} ${row.title} [${row.status}]`);
      lines.push(`- requirement: ${row.requirement}`);
      lines.push(`- details: ${row.details}`);
      lines.push(`- evidence: ${row.evidence.length > 0 ? row.evidence.join(' ; ') : '(none)'}`);
      lines.push(`- next_actions: ${row.nextActions.length > 0 ? row.nextActions.join(' ; ') : '(none)'}`);
      lines.push('');
    }
    const stageActions = recursiveActionsForStage(rows);
    lines.push(`### ${stage} Next Recursive Loop`);
    if (stageActions.length === 0) {
      lines.push('- no pending actions');
    } else {
      for (const action of stageActions) {
        lines.push(`- ${action}`);
      }
    }
    lines.push('');
  }

  lines.push('## Notes');
  lines.push('- AC marked BLOCKED means the requirement is defined but current repo lacks required infrastructure/telemetry/runtime scale.');
  lines.push('- AC marked FAIL means requirement is testable now and did not meet pass condition.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function ac11(): Promise<AcResult> {
  const ws = mkWorkspace('turingos-ac11-');
  const manifold = new LocalManifold(ws);
  const chronos = new FileChronos(path.join(ws, '.journal.log'));
  await manifold.interfere('MAIN_TAPE.md', 'AC11');
  const oracle = new UniversalOracle('openai', { apiKey: 'test-key', model: 'test-model' });
  let requestCount = 0;
  (oracle as unknown as { openai: unknown }).openai = {
    chat: {
      completions: {
        create: async (payload: unknown) => {
          requestCount += 1;
          if (requestCount === 1) {
            return {
              choices: [
                {
                  message: {
                    content: 'not-a-json-payload',
                  },
                },
              ],
            };
          }

          const record = payload as { messages?: Array<{ role?: string; content?: string }> };
          const userFrame = record.messages?.find((item) => item.role === 'user')?.content ?? '';
          const sawCpuFaultTrap = userFrame.includes('[OS_TRAP: CPU_FAULT]');
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    q_next: sawCpuFaultTrap ? 'q_recovered' : 'q_unrecovered',
                    a_t: { op: 'SYS_GOTO', pointer: 'MAIN_TAPE.md' },
                  }),
                },
              },
            ],
          };
        },
      },
    },
  };
  const engine = new TuringEngine(manifold, oracle, chronos, 'ac11');

  const [q1, d1] = await engine.tick('q0', 'MAIN_TAPE.md');
  const [q2, d2] = await engine.tick(q1, d1);
  const trapped = d1.includes('sys://trap/cpu_fault') && q1.includes('[OS_TRAP: CPU_FAULT]');
  const recovered = d2 === 'MAIN_TAPE.md' && q2.includes('q_recovered') && requestCount >= 2;
  const pass = trapped && recovered;
  return {
    stage: 'S1',
    acId: 'AC1.1',
    title: 'No-Yapping Protocol',
    status: pass ? 'PASS' : 'FAIL',
    requirement:
      '非法输出必须触发 INVALID_OPCODE trap，且在最多2个tick内恢复到合法系统调用。',
    details: pass
      ? 'Engine trapped invalid opcode and recovered via runtime trap-aware oracle response in second tick.'
      : `Unexpected flow. requests=${requestCount} q1=${q1.slice(0, 120)} d1=${d1} q2=${q2.slice(0, 120)} d2=${d2}`,
    evidence: [ws, path.join(ws, '.journal.log')],
    nextActions: pass
      ? []
      : ['收紧 oracle 解析异常路径，确保 INVALID_OPCODE 固定映射到 sys://trap/cpu_fault 并完成二次收敛。'],
  };
}

async function ac12(): Promise<AcResult> {
  const ws = mkWorkspace('turingos-ac12-');
  const manifold = new LocalManifold(ws);
  const chronos = new FileChronos(path.join(ws, '.journal.log'));
  await manifold.interfere('MAIN_TAPE.md', 'AC12');
  const engine = new TuringEngine(manifold, new DualActionOracle(), chronos, 'ac12');

  const [q1, d1] = await engine.tick('q0', 'MAIN_TAPE.md');
  const wrote = await manifold.observe('MAIN_TAPE.md');
  const trapped = d1.includes('sys://trap/cpu_fault') || q1.includes('MUTEX');
  const parserOracle = new UniversalOracle('openai', { apiKey: 'test-key', model: 'test-model' });
  let parserRejectedMixedIntent = false;
  try {
    (parserOracle as unknown as { parseTransition: (raw: string) => Transition }).parseTransition(
      JSON.stringify({
        q_next: 'q_bad',
        a_t: { op: 'SYS_WRITE', payload: 'X', pointer: 'illegal-next-pointer.txt' },
      })
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    parserRejectedMixedIntent = message.includes('MUTEX_VIOLATION') || message.includes('INVALID_OPCODE');
  }
  const pass = trapped && parserRejectedMixedIntent;
  return {
    stage: 'S1',
    acId: 'AC1.2',
    title: 'Mutex Test',
    status: pass ? 'PASS' : 'FAIL',
    requirement:
      '当输出同时包含写入与跳转意图时，内核应拒绝执行并抛出互斥违规中断。',
    details: pass
      ? 'Engine rejected mixed action intent and UniversalOracle parser rejected mixed-intent syscall payload.'
      : `Runtime trapped=${trapped}; parserRejectedMixedIntent=${parserRejectedMixedIntent}; d1=${d1}; MAIN_TAPE preview=${wrote.slice(0, 80)}`,
    evidence: [ws, path.join(ws, '.journal.log')],
    nextActions: pass
      ? []
      : [
          '补充 UniversalOracle 解析层混合意图拒绝测试，验证 MUTEX_VIOLATION 错误路径。',
          '补充端到端测试覆盖双动作输出拒绝路径（解析层 + 内核层双防线）。',
        ],
  };
}

async function ac13(): Promise<AcResult> {
  const filePath = path.join(ROOT, 'src', 'oracle', 'universal-oracle.ts');
  const openAIOracle = new UniversalOracle('openai', { apiKey: 'test-key', model: 'test-model' });
  let openAIRequestPayload: { messages?: unknown; [key: string]: unknown } = {};
  (openAIOracle as unknown as { openai: unknown }).openai = {
    chat: {
      completions: {
        create: async (payload: unknown) => {
          openAIRequestPayload = (payload as { messages?: unknown; [key: string]: unknown }) ?? {};
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    q_next: 'q_openai_next',
                    a_t: { op: 'SYS_GOTO', pointer: 'NEXT_OPENAI.md' },
                  }),
                },
              },
            ],
          };
        },
      },
    },
  };

  let kimiRequestPayload: { messages?: unknown; system?: unknown; [key: string]: unknown } = {};
  const originalFetch = globalThis.fetch;
  const mockedFetch: typeof fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof init?.body === 'string') {
      try {
        kimiRequestPayload = JSON.parse(init.body) as {
          messages?: unknown;
          system?: unknown;
          [key: string]: unknown;
        };
      } catch {
        kimiRequestPayload = {};
      }
    }

    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                q_next: 'q_kimi_next',
                a_t: { op: 'SYS_GOTO', pointer: 'NEXT_KIMI.md' },
              }),
            },
          ],
        }),
    } as Response;
  };

  try {
    (globalThis as { fetch: typeof fetch }).fetch = mockedFetch;
    await openAIOracle.collapse('ROM_OPENAI', 'q_openai', 's_openai');
    const kimiOracle = new UniversalOracle('kimi', {
      apiKey: 'test-key',
      model: 'test-model',
      baseURL: 'https://api.kimi.com/coding',
    });
    await kimiOracle.collapse('ROM_KIMI', 'q_kimi', 's_kimi');
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  }

  const openAIMessages = Array.isArray(openAIRequestPayload?.messages)
    ? (openAIRequestPayload.messages as Array<Record<string, unknown>>)
    : [];
  const openAISystemRole = openAIMessages[0]?.role === 'system';
  const openAIUserRole = openAIMessages[1]?.role === 'user';
  const openAIFrameOk = openAIMessages.length === 2 && openAISystemRole && openAIUserRole;

  const kimiMessages = Array.isArray(kimiRequestPayload?.messages)
    ? (kimiRequestPayload.messages as Array<Record<string, unknown>>)
    : [];
  const kimiSystem = typeof kimiRequestPayload?.system === 'string' ? kimiRequestPayload.system : '';
  const kimiRoleOk = kimiMessages.length === 1 && kimiMessages[0]?.role === 'user';
  const kimiFrameOk = kimiSystem.trim().length > 0 && kimiRoleOk;

  const pass = openAIFrameOk && kimiFrameOk;

  return {
    stage: 'S1',
    acId: 'AC1.3',
    title: 'Stateless Payload',
    status: pass ? 'PASS' : 'FAIL',
    requirement:
      '发送给模型的请求帧必须只包含 ROM + 当前帧，不得拼接历史对话。',
    details: pass
      ? 'Runtime payload capture confirmed OpenAI(2-frame) and Kimi(system + single-user-frame) stateless requests.'
      : `Runtime payload assertion failed. openAIFrameOk=${openAIFrameOk} kimiFrameOk=${kimiFrameOk}`,
    evidence: [filePath],
    nextActions: pass
      ? []
      : [
          '增加 provider 请求层拦截断言，确保每次请求不携带历史消息。',
          '修复 OpenAI/Kimi 请求构造，保持仅 ROM + 当前 tick 输入帧。',
        ],
  };
}

async function ac21(): Promise<AcResult> {
  const ws = mkWorkspace('turingos-ac21-');
  const manifold = new LocalManifold(ws);
  for (let i = 0; i < 200; i += 1) {
    await manifold.interfere('sys://callstack', `PUSH: AC21_STACK_${i}_${'X'.repeat(180)}`);
  }
  const huge = Array.from({ length: 100000 }, (_, i) => `ERR_${i}`).join('\n');
  await manifold.interfere('logs/huge.log', huge);
  const chronos = new FileChronos(path.join(ws, '.journal.log'));
  const oracle = new FrameCaptureOracle();
  const engine = new TuringEngine(manifold, oracle, chronos, 'ac21');
  await engine.tick('q_ac21', 'logs/huge.log');
  const stackSnapshot = await manifold.observe('sys://callstack');
  const stackDepth = Number.parseInt(stackSnapshot.match(/\[CALL_STACK_DEPTH\]\s+(\d+)/)?.[1] ?? '0', 10);
  const frame = oracle.lastFrame;
  const journal = await fsp.readFile(path.join(ws, '.journal.log'), 'utf-8').catch(() => '');
  const observedSourceSeen = frame.includes('Source=file:logs/huge.log');
  const hardwallVisible = frame.includes('[OS_FRAME_HARD_LIMIT]') || frame.includes('[OS_SECTION_CLIPPED]');
  const pass =
    oracle.calls === 1 &&
    frame.length <= 4096 &&
    observedSourceSeen &&
    hardwallVisible &&
    stackDepth === 64 &&
    journal.includes('[FRAME_HARD_LIMIT]');
  return {
    stage: 'S2',
    acId: 'AC2.1',
    title: 'OOM Shield',
    status: pass ? 'PASS' : 'FAIL',
    requirement:
      '超长观测必须分页，焦点页输出长度受硬墙约束（<=4096 chars），不能发生上下文溢出。',
    details: pass
      ? `Engine frame hardwall ok. frame_len=${frame.length} stack_depth=${stackDepth} observed_source=file:logs/huge.log oracle_calls=${oracle.calls}`
      : `Engine hardwall failed. frame_len=${frame.length} stack_depth=${stackDepth} oracle_calls=${oracle.calls} observed_source=${observedSourceSeen} hardwall_marker=${hardwallVisible}`,
    evidence: [ws, path.join(ROOT, 'src', 'kernel', 'engine.ts'), path.join(ROOT, 'src', 'manifold', 'local-manifold.ts')],
    nextActions: pass ? [] : ['在 engine tick 前增加最终帧长度断言，并将超限写入 chronos 审计日志。'],
  };
}

async function ac22(): Promise<AcResult> {
  const ws = mkWorkspace('turingos-ac22-');
  const manifold = new LocalManifold(ws);
  const huge = Array.from({ length: 5000 }, (_, i) => `LINE_${i.toString().padStart(4, '0')}`).join('\n');
  await manifold.interfere('logs/nav.log', huge);
  const p1 = await manifold.observe('logs/nav.log');
  const token = p1.match(/Token=([a-f0-9]+)/)?.[1] ?? '';
  const p2 = token ? await manifold.observe(`sys://page/${token}?p=2`) : '';
  const pass = token.length > 0 && p2.includes('FocusPage=2');
  return {
    stage: 'S2',
    acId: 'AC2.2',
    title: 'Semantic Navigation',
    status: pass ? 'PASS' : 'FAIL',
    requirement:
      '系统应支持翻页导航，模型可通过页面句柄定位下一页而不丢失执行状态。',
    details: pass ? `Token=${token}` : 'Failed to obtain token or navigate to page 2.',
    evidence: [ws],
    nextActions: pass ? [] : ['修复 page token 生成/解析链路，保障 SYS_GOTO 翻页可达。'],
  };
}

async function ac23(): Promise<AcResult> {
  const ws = mkWorkspace('turingos-ac23-');
  const telemetryPath = path.join(ws, '.token_telemetry.jsonl');
  const previousTelemetryPath = process.env.TURINGOS_TOKEN_TELEMETRY_PATH;
  process.env.TURINGOS_TOKEN_TELEMETRY_PATH = telemetryPath;

  const manifold = new LocalManifold(ws);
  await manifold.interfere('MAIN_TAPE.md', 'AC23 entropy line dynamic paging benchmark');
  const huge = Array.from({ length: 20000 }, (_, i) => `ROW_${i.toString().padStart(5, '0')}`).join('\n');
  await manifold.interfere('logs/huge.log', huge);
  const chronos = new FileChronos(path.join(ws, '.journal.log'));
  const oracle = new UniversalOracle('openai', { apiKey: 'test-key', model: 'test-model' });
  let observedRequestCount = 0;
  let pageNavigationCount = 0;
  let fallbackReads = 0;
  (oracle as unknown as { openai: unknown }).openai = {
    chat: {
      completions: {
        create: async (payload: unknown) => {
          observedRequestCount += 1;
          const record = payload as { messages?: Array<{ role?: string; content?: string }> };
          const userFrame = record.messages?.find((item) => item.role === 'user')?.content ?? '';
          const token = userFrame.match(/Token=([a-f0-9]+)/)?.[1] ?? '';
          const phase = (observedRequestCount - 1) % 4;
          let pointer = 'MAIN_TAPE.md';
          if (phase === 0) {
            pointer = 'logs/huge.log';
          } else if (phase === 1) {
            pointer = token ? `sys://page/${token}?p=2` : 'logs/huge.log';
          } else if (phase === 2) {
            pointer = token ? `sys://page/${token}?p=3` : 'logs/huge.log';
          } else {
            pointer = 'MAIN_TAPE.md';
          }
          if (pointer.startsWith('sys://page/')) {
            pageNavigationCount += 1;
          }
          if (pointer === 'logs/huge.log' && phase !== 0) {
            fallbackReads += 1;
          }

          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    q_next: `q_entropy_${phase}`,
                    a_t: { op: 'SYS_GOTO', pointer },
                  }),
                },
              },
            ],
          };
        },
      },
    },
  };
  const engine = new TuringEngine(manifold, oracle, chronos, 'ac23');

  const ticks = 500;
  try {
    let q = 'q_entropy';
    let d = 'MAIN_TAPE.md';
    for (let i = 0; i < ticks; i += 1) {
      [q, d] = await engine.tick(q, d);
    }
  } finally {
    if (previousTelemetryPath === undefined) {
      delete process.env.TURINGOS_TOKEN_TELEMETRY_PATH;
    } else {
      process.env.TURINGOS_TOKEN_TELEMETRY_PATH = previousTelemetryPath;
    }
  }

  const raw = await fsp.readFile(telemetryPath, 'utf-8').catch(() => '');
  const totals = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        const v = row.total_tokens_est ?? row.total_tokens;
        return typeof v === 'number' && Number.isFinite(v) ? v : null;
      } catch {
        return null;
      }
    })
    .filter((value): value is number => value !== null);

  const samples = totals.length;
  const mean = samples > 0 ? totals.reduce((sum, value) => sum + value, 0) / samples : 0;
  const variance =
    samples > 0 ? totals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples : Number.POSITIVE_INFINITY;
  const cv = mean === 0 ? Number.POSITIVE_INFINITY : Math.sqrt(variance) / mean;
  const headWindow = totals.slice(0, Math.min(100, totals.length));
  const tailWindow = totals.slice(Math.max(0, totals.length - 100));
  const headMean =
    headWindow.length > 0 ? headWindow.reduce((sum, value) => sum + value, 0) / headWindow.length : 0;
  const tailMean =
    tailWindow.length > 0 ? tailWindow.reduce((sum, value) => sum + value, 0) / tailWindow.length : 0;
  const driftRatio = headMean === 0 ? Number.POSITIVE_INFINITY : Math.abs(tailMean - headMean) / headMean;
  let slope = Number.POSITIVE_INFINITY;
  if (samples > 1) {
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;
    for (let i = 0; i < samples; i += 1) {
      const x = i;
      const y = totals[i];
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    const denominator = samples * sumX2 - sumX * sumX;
    if (denominator !== 0) {
      slope = (samples * sumXY - sumX * sumY) / denominator;
    }
  }
  const pass =
    samples === ticks &&
    observedRequestCount === ticks &&
    pageNavigationCount >= Math.floor(ticks / 4) &&
    fallbackReads <= Math.floor(ticks * 0.1) &&
    Math.abs(slope) <= 0.2 &&
    driftRatio <= 0.15;

  return {
    stage: 'S2',
    acId: 'AC2.3',
    title: 'O(1) Entropy Line',
    status: pass ? 'PASS' : 'FAIL',
    requirement:
      '500 tick 长程任务中，API token 消耗折线需保持稳定水平线（O(1)）。',
    details: pass
      ? `Engine-driven telemetry on dynamic paging workload passed. samples=${samples} requests=${observedRequestCount} pageNavigations=${pageNavigationCount} fallbackReads=${fallbackReads} tokenCV=${cv.toFixed(4)} slope=${Number.isFinite(slope) ? slope.toFixed(4) : 'inf'} drift=${Number.isFinite(driftRatio) ? driftRatio.toFixed(4) : 'inf'}`
      : `Telemetry trend check failed. samples=${samples} expected=500 requests=${observedRequestCount} pageNavigations=${pageNavigationCount} fallbackReads=${fallbackReads} cv=${
          Number.isFinite(cv) ? cv.toFixed(4) : 'inf'
        } slope=${
          Number.isFinite(slope) ? slope.toFixed(4) : 'inf'
        } drift=${Number.isFinite(driftRatio) ? driftRatio.toFixed(4) : 'inf'
        }`,
    evidence: [
      telemetryPath,
      path.join(ws, '.journal.log'),
      path.join(ROOT, 'src', 'oracle', 'universal-oracle.ts'),
      path.join(ROOT, 'src', 'bench', 'os-longrun.ts'),
    ],
    nextActions: pass
      ? ['将 telemetry 统计接入 os-longrun 报告与 CI 基线门禁。']
      : [
          '检查 telemetry 写入链路，确保每 tick 固定写入一条 token 样本。',
          '扩展 os-longrun 的 500 tick 长跑并输出 token CV 折线。',
        ],
  };
}

async function ac31(runtime?: AcceptanceRuntimeContext): Promise<AcResult> {
  const ws = mkWorkspace('turingos-ac31-');
  const workerScriptPath = path.join(ROOT, 'src', 'bench', 'ac31-kill9-worker.ts');
  if (runtime) {
    runtime.ac31Workspace = ws;
    runtime.ac31TracePath = path.join(ws, '.journal.log');
  }
  const firstArgs = [
    'run',
    'bench:ac31-worker',
    '--',
    '--workspace',
    ws,
    '--max-ticks',
    '30',
    '--tick-delay-ms',
    '800',
  ];
  const firstRun = spawnNpm(firstArgs);
  const reachedCheckpoint = await waitForRegisterQ(ws, 'q1', 15000);
  if (firstRun.child.pid && !firstRun.child.killed) {
    try {
      process.kill(-firstRun.child.pid, 'SIGKILL');
    } catch {
      firstRun.child.kill('SIGKILL');
    }
  }
  const killedResult = await firstRun.done;

  const qAfterKill = await readTrimmed(path.join(ws, '.reg_q'));
  const dAfterKill = await readTrimmed(path.join(ws, '.reg_d'));

  const secondArgs = [
    'run',
    'bench:ac31-worker',
    '--',
    '--workspace',
    ws,
    '--max-ticks',
    '30',
    '--tick-delay-ms',
    '20',
  ];
  const secondRun = spawnNpm(secondArgs);
  const resumedResult = await secondRun.done;

  const qFinal = await readTrimmed(path.join(ws, '.reg_q'));
  const dFinal = await readTrimmed(path.join(ws, '.reg_d'));
  const resumeFile = await readTrimmed(path.join(ws, 'artifacts', 'resume.txt'));
  const ticksLog = await readTrimmed(path.join(ws, '.ac31_worker_ticks.log'));

  const wasKilled = killedResult.signal === 'SIGKILL';
  const resumedFromQ1 = qAfterKill === 'q1' && resumedResult.stdout.includes('tick=1 q=q2');
  const halted = qFinal === 'HALT' || dFinal === 'HALT';
  const pass = reachedCheckpoint && wasKilled && resumedFromQ1 && resumedResult.code === 0 && halted && resumeFile === 'resumed-ok';
  const evidence = [
    workerScriptPath,
    ws,
    path.join(ws, '.reg_q'),
    path.join(ws, '.reg_d'),
    path.join(ws, '.journal.log'),
    path.join(ws, '.ac31_worker_ticks.log'),
    path.join(ws, 'artifacts', 'resume.txt'),
  ];
  if (pass) {
    const bundle = await archiveGoldenTraceBundle(
      `${runtime?.auditStamp ?? timestamp()}_ac31_lazarus`,
      [
        { source: path.join(ws, '.journal.log'), targetName: 'ac31.journal.log' },
        { source: path.join(ws, '.journal.merkle.jsonl'), targetName: 'ac31.journal.merkle.jsonl', required: false },
        { source: path.join(ws, '.ac31_worker_ticks.log'), targetName: 'ac31.worker_ticks.log' },
        { source: path.join(ws, 'artifacts', 'resume.txt'), targetName: 'ac31.resume.txt' },
        { source: path.join(ws, '.reg_q'), targetName: 'ac31.reg_q' },
        { source: path.join(ws, '.reg_d'), targetName: 'ac31.reg_d' },
      ],
      {
        acId: 'AC3.1',
        pass,
        reachedCheckpoint,
        killSignal: killedResult.signal,
        resumedExitCode: resumedResult.code,
        qAfterKill,
        qFinal,
        dFinal,
      }
    );
    evidence.push(bundle.bundleDir, bundle.manifestPath, ...bundle.copiedPaths);
  }

  return {
    stage: 'S3',
    acId: 'AC3.1',
    title: 'Lazarus Test',
    status: pass ? 'PASS' : 'FAIL',
    requirement:
      '进程被 kill -9 后，重启必须从持久化寄存器继续推进下一步，而不是重置到初始状态。',
    details: pass
      ? 'Process-level kill -9 + restart continuation succeeded from persisted registers.'
      : `Kill/restart mismatch. reachedCheckpoint=${reachedCheckpoint} killSignal=${killedResult.signal} qAfterKill=${qAfterKill} dAfterKill=${dAfterKill} resumedExit=${resumedResult.code} qFinal=${qFinal} dFinal=${dFinal} resumeFile=${resumeFile} ticksLogTail=${ticksLog.slice(-200)}`,
    evidence,
    nextActions: pass
      ? ['将该 kill -9 验收接入 CI，防止续跑能力回归。']
      : [
          '检查 worker 重启时寄存器读取顺序，确认未被 bootstrap 回写覆盖。',
          '检查 kill -9 时机，确保第一阶段状态已持久化再杀进程。',
        ],
  };
}

async function ac32(runtime?: AcceptanceRuntimeContext): Promise<AcResult> {
  const replayRunnerPath = path.join(ROOT, 'src', 'bench', 'replay-runner.ts');
  if (!fs.existsSync(replayRunnerPath)) {
    return {
      stage: 'S3',
      acId: 'AC3.2',
      title: 'Bit-for-bit Replay',
      status: 'FAIL',
      requirement:
        '应支持离线重放 trace.jsonl，在断网条件下重建最终状态并校验哈希一致性。',
      details: 'No dedicated replay-runner implementation found in repo.',
      evidence: [path.join(ROOT, 'src', 'bench')],
      nextActions: [
        '新增 replay-runner：读取 REPLAY_TUPLE/trace，离线应用动作并输出最终树哈希。',
        '新增断网 CI 用例验证 bit-for-bit 一致性。',
      ],
    };
  }

  const parseSummary = (stdout: string): Record<string, unknown> | null => {
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(stdout.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const tempRoot = mkWorkspace('turingos-ac32-');
  const sourceWorkspace = path.join(tempRoot, 'source');
  const tracePath = path.join(sourceWorkspace, '.journal.log');
  const run1Workspace = path.join(tempRoot, 'run1');
  const run2Workspace = path.join(tempRoot, 'run2');
  await fsp.mkdir(sourceWorkspace, { recursive: true });
  const sourceManifold = new LocalManifold(sourceWorkspace);
  const sourceChronos = new FileChronos(path.join(sourceWorkspace, '.journal.log'));
  const sourceEngine = new TuringEngine(sourceManifold, new ReplayTupleOracle(), sourceChronos, 'ac32');
  let sourceQ = 'q0';
  let sourceD = 'artifacts/a.txt';
  for (let i = 0; i < 4; i += 1) {
    [sourceQ, sourceD] = await sourceEngine.tick(sourceQ, sourceD);
  }
  const sourceHash = await computeWorkspaceTreeHash(sourceWorkspace);

  const cmd1 = `npm run bench:replay-runner -- --trace "${tracePath}" --workspace "${run1Workspace}"`;
  const cmd2 = `npm run bench:replay-runner -- --trace "${tracePath}" --workspace "${run2Workspace}"`;
  const r1 = await runCommand(cmd1);
  const r2 = await runCommand(cmd2);
  const summary1 = parseSummary(r1.stdout);
  const summary2 = parseSummary(r2.stdout);
  const hash1 = typeof summary1?.treeHash === 'string' ? summary1.treeHash : '';
  const hash2 = typeof summary2?.treeHash === 'string' ? summary2.treeHash : '';
  const s1Qs = summary1?.qsHashVerified === true;
  const s1Merkle = summary1?.merkleVerified === true;
  const s1Continuity = summary1?.continuityVerified === true;
  const s2Qs = summary2?.qsHashVerified === true;
  const s2Merkle = summary2?.merkleVerified === true;
  const s2Continuity = summary2?.continuityVerified === true;
  const syntheticPass =
    r1.code === 0 &&
    r2.code === 0 &&
    hash1.length > 0 &&
    hash1 === hash2 &&
    hash1 === sourceHash &&
    s1Qs &&
    s1Merkle &&
    s1Continuity &&
    s2Qs &&
    s2Merkle &&
    s2Continuity;

  const dirtyTracePath = runtime?.ac31TracePath ?? '';
  const dirtySourceWorkspace = runtime?.ac31Workspace ?? '';
  const dirtyRun1Workspace = path.join(tempRoot, 'dirty_run1');
  const dirtyRun2Workspace = path.join(tempRoot, 'dirty_run2');
  const dirtyTraceReady =
    dirtyTracePath.length > 0 &&
    dirtySourceWorkspace.length > 0 &&
    fs.existsSync(dirtyTracePath) &&
    fs.existsSync(dirtySourceWorkspace);

  let dirtyPass = false;
  let dirtyDetails = `dirtyTraceReady=${dirtyTraceReady}`;
  let dirtyHash1 = '';
  let dirtyHash2 = '';
  let dirtySourceHash = '';
  let dirtyQs1 = false;
  let dirtyQs2 = false;
  let dirtyMerkle1 = false;
  let dirtyMerkle2 = false;
  let dirtyContinuity1 = false;
  let dirtyContinuity2 = false;
  let dirtyCode1: number | null = null;
  let dirtyCode2: number | null = null;
  if (dirtyTraceReady) {
    await seedAc31Baseline(dirtyRun1Workspace);
    await seedAc31Baseline(dirtyRun2Workspace);
    dirtySourceHash = await computeWorkspaceTreeHash(dirtySourceWorkspace);
    const dirtyCmd1 = `npm run bench:replay-runner -- --trace "${dirtyTracePath}" --workspace "${dirtyRun1Workspace}"`;
    const dirtyCmd2 = `npm run bench:replay-runner -- --trace "${dirtyTracePath}" --workspace "${dirtyRun2Workspace}"`;
    const dr1 = await runCommand(dirtyCmd1);
    const dr2 = await runCommand(dirtyCmd2);
    const dSummary1 = parseSummary(dr1.stdout);
    const dSummary2 = parseSummary(dr2.stdout);
    dirtyCode1 = dr1.code;
    dirtyCode2 = dr2.code;
    dirtyHash1 = typeof dSummary1?.treeHash === 'string' ? dSummary1.treeHash : '';
    dirtyHash2 = typeof dSummary2?.treeHash === 'string' ? dSummary2.treeHash : '';
    dirtyQs1 = dSummary1?.qsHashVerified === true;
    dirtyQs2 = dSummary2?.qsHashVerified === true;
    dirtyMerkle1 = dSummary1?.merkleVerified === true;
    dirtyMerkle2 = dSummary2?.merkleVerified === true;
    dirtyContinuity1 = dSummary1?.continuityVerified === true;
    dirtyContinuity2 = dSummary2?.continuityVerified === true;
    dirtyPass =
      dr1.code === 0 &&
      dr2.code === 0 &&
      dirtyHash1.length > 0 &&
      dirtyHash1 === dirtyHash2 &&
      dirtyHash1 === dirtySourceHash &&
      dirtyQs1 &&
      dirtyQs2 &&
      dirtyMerkle1 &&
      dirtyMerkle2 &&
      dirtyContinuity1 &&
      dirtyContinuity2;
    dirtyDetails = `dirtySource=${dirtySourceHash} dirtyHash1=${dirtyHash1} dirtyHash2=${dirtyHash2} dirtyCode1=${dr1.code} dirtyCode2=${dr2.code} dirtyQs=(${dirtyQs1},${dirtyQs2}) dirtyMerkle=(${dirtyMerkle1},${dirtyMerkle2}) dirtyContinuity=(${dirtyContinuity1},${dirtyContinuity2})`;
  }

  const execSnapshotTracePath = path.join(tempRoot, 'exec_snapshot_trace.jsonl');
  const execSnapshotWorkspace = path.join(tempRoot, 'exec_snapshot_run');
  const execCmd = 'echo 123 > mutation.txt';
  const execPointer = `$ ${execCmd}`;
  const execPreSlice = '[SYSTEM] replay exec bootstrap';
  const commandSlice = ['[COMMAND] echo 123 > mutation.txt', '[EXIT_CODE] 0', '[STDOUT]', '', '[STDERR]', ''].join('\n');
  const execTuple0Payload = {
    tick_seq: 0,
    q_t: 'q_exec_0',
    h_q: createHash('sha256').update('q_exec_0').digest('hex'),
    d_t: 'MAIN_TAPE.md',
    observed_slice: execPreSlice,
    s_t: execPreSlice,
    h_s: createHash('sha256').update(execPreSlice).digest('hex'),
    a_t: { op: 'SYS_EXEC', cmd: execCmd },
    q_next: 'q_exec_1',
    d_next: execPointer,
    write_target: execPointer,
  };
  const execTuple0Leaf = createHash('sha256').update(JSON.stringify(execTuple0Payload)).digest('hex');
  const execTuple0Prev = 'GENESIS';
  const execTuple0Merkle = createHash('sha256').update(`${execTuple0Prev}\n${execTuple0Leaf}`).digest('hex');
  const execTuple0 = {
    ...execTuple0Payload,
    leaf_hash: execTuple0Leaf,
    prev_merkle_root: execTuple0Prev,
    merkle_root: execTuple0Merkle,
  };

  const execTuple1Payload = {
    tick_seq: 1,
    q_t: 'q_exec_1',
    h_q: createHash('sha256').update('q_exec_1').digest('hex'),
    d_t: execPointer,
    observed_slice: commandSlice,
    s_t: commandSlice,
    h_s: createHash('sha256').update(commandSlice).digest('hex'),
    a_t: { op: 'SYS_HALT' },
    q_next: 'HALT',
    d_next: 'HALT',
    write_target: 'HALT',
  };
  const execTuple1Leaf = createHash('sha256').update(JSON.stringify(execTuple1Payload)).digest('hex');
  const execTuple1Prev = execTuple0Merkle;
  const execTuple1Merkle = createHash('sha256').update(`${execTuple1Prev}\n${execTuple1Leaf}`).digest('hex');
  const execTuple1 = {
    ...execTuple1Payload,
    leaf_hash: execTuple1Leaf,
    prev_merkle_root: execTuple1Prev,
    merkle_root: execTuple1Merkle,
  };

  await fsp.writeFile(
    execSnapshotTracePath,
    [JSON.stringify(execTuple0), JSON.stringify(execTuple1)].join('\n') + '\n',
    'utf-8'
  );
  await fsp.mkdir(execSnapshotWorkspace, { recursive: true });
  const execSnapshotCmd = `npm run bench:replay-runner -- --trace "${execSnapshotTracePath}" --workspace "${execSnapshotWorkspace}"`;
  const execSnapshotRun = await runCommand(execSnapshotCmd);
  const execSummary = parseSummary(execSnapshotRun.stdout);
  const execSnapshotFrames =
    typeof execSummary?.execSnapshotFrames === 'number' ? (execSummary.execSnapshotFrames as number) : 0;
  const mutationArtifact = path.join(execSnapshotWorkspace, 'mutation.txt');
  let mutationArtifactExists = false;
  try {
    await fsp.access(mutationArtifact);
    mutationArtifactExists = true;
  } catch {
    mutationArtifactExists = false;
  }
  const execSnapshotPass =
    execSnapshotRun.code === 0 &&
    execSnapshotFrames >= 1 &&
    execSummary?.qsHashVerified === true &&
    execSummary?.merkleVerified === true &&
    execSummary?.continuityVerified === true &&
    !mutationArtifactExists;
  const execSnapshotDetails = `execCode=${execSnapshotRun.code} execSnapshotFrames=${execSnapshotFrames} qs=${
    execSummary?.qsHashVerified === true
  } merkle=${execSummary?.merkleVerified === true} continuity=${execSummary?.continuityVerified === true} mutationArtifactExists=${mutationArtifactExists}`;

  const pass = syntheticPass && dirtyPass && execSnapshotPass;
  const evidence = [
    replayRunnerPath,
    tracePath,
    sourceWorkspace,
    run1Workspace,
    run2Workspace,
    execSnapshotTracePath,
    execSnapshotWorkspace,
  ];
  if (dirtyTraceReady) {
    evidence.push(dirtyTracePath, dirtySourceWorkspace, dirtyRun1Workspace, dirtyRun2Workspace);
  }
  if (pass) {
    const bundle = await archiveGoldenTraceBundle(
      `${runtime?.auditStamp ?? timestamp()}_ac32_replay`,
      [
        { source: tracePath, targetName: 'ac32.synthetic.journal.log' },
        {
          source: path.join(sourceWorkspace, '.journal.merkle.jsonl'),
          targetName: 'ac32.synthetic.journal.merkle.jsonl',
          required: false,
        },
        { source: execSnapshotTracePath, targetName: 'ac32.exec_snapshot_trace.jsonl' },
        { source: dirtyTracePath, targetName: 'ac32.dirty.journal.log', required: false },
        {
          source: path.join(dirtySourceWorkspace, '.journal.merkle.jsonl'),
          targetName: 'ac32.dirty.journal.merkle.jsonl',
          required: false,
        },
      ],
      {
        acId: 'AC3.2',
        pass,
        syntheticHash: hash1,
        dirtyHash: dirtyHash1,
        syntheticPass,
        dirtyPass,
        execSnapshotPass,
        execSnapshotFrames,
        dirtyTraceReady,
      }
    );
    evidence.push(bundle.bundleDir, bundle.manifestPath, ...bundle.copiedPaths);
  }

  return {
    stage: 'S3',
    acId: 'AC3.2',
    title: 'Bit-for-bit Replay',
    status: pass ? 'PASS' : 'FAIL',
    requirement:
      '应支持离线重放 trace.jsonl，并通过 synthetic + kill -9 dirty trace 双轨校验哈希一致性；每 tick 强制校验 h_q/h_s 与 Merkle 链；SYS_EXEC 通过历史快照注入而非宿主重执行。',
    details: pass
      ? `Synthetic/dirty replay passed with per-tick hash+merkle checks and exec-snapshot injection. synthetic=${hash1} dirty=${dirtyHash1} ${execSnapshotDetails}`
      : `Replay mismatch. synthetic(code1=${r1.code},code2=${r2.code},source=${sourceHash},hash1=${hash1},hash2=${hash2},qs=(${s1Qs},${s2Qs}),merkle=(${s1Merkle},${s2Merkle}),continuity=(${s1Continuity},${s2Continuity})) dirty(${dirtyDetails},dirtyCode1=${dirtyCode1},dirtyCode2=${dirtyCode2}) execSnapshot(${execSnapshotDetails})`,
    evidence,
    nextActions: pass
      ? ['将 AC3.2 h_q/h_s + Merkle + dirty replay + exec snapshot 注入结果接入 CI，形成强门禁。']
      : [
          '修复 replay-runner 逐 tick 校验链路，确保 h_q/h_s 与 Merkle 链强一致。',
          '修复 exec snapshot 注入链路，禁止宿主命令重执行但保留历史命令观测。',
          '修复 replay-runner/seed 基线链路，确保 dirty trace 在双 workspace 回放哈希稳定。',
          '将 replay-runner 结果接入 CI 断网回放用例。',
        ],
  };
}

async function ac41(runtime?: AcceptanceRuntimeContext): Promise<AcResult> {
  const matrixThresholds = {
    execOpsMin: 5,
    timeoutSignalsMin: 1,
    mmuSignalsMin: 1,
    deadlockSignalsMin: 1,
    execMmuSignalsMin: 1,
  };
  const localAluThresholds = {
    minSamples: 1000,
    validJsonRateMin: 0.999,
    mutexViolationRateMax: 0,
  };
  const tracePath = runtime?.ac31TracePath ?? '';
  const traceReady = tracePath.length > 0 && fs.existsSync(tracePath);
  const stats = traceReady
    ? await collectTraceStats(tracePath)
    : {
        execOps: 0,
        timeoutSignals: 0,
        mmuSignals: 0,
        deadlockSignals: 0,
        execMmuSignals: 0,
        frames: 0,
        traceCorrupted: false,
        corruptionReason: '',
      };
  const ac41aTraceMatrixReady =
    !stats.traceCorrupted &&
    stats.execOps >= matrixThresholds.execOpsMin &&
    stats.timeoutSignals >= matrixThresholds.timeoutSignalsMin &&
    stats.mmuSignals >= matrixThresholds.mmuSignalsMin &&
    stats.deadlockSignals >= matrixThresholds.deadlockSignalsMin &&
    stats.execMmuSignals >= matrixThresholds.execMmuSignalsMin;
  const localAluMetrics = await readLocalAluGateMetrics();
  const ac41bSourceEligible = localAluMetrics !== null && localAluMetrics.source === 'local_alu';
  const ac41bThresholdSatisfied =
    localAluMetrics !== null &&
    localAluMetrics.totalSamples >= localAluThresholds.minSamples &&
    localAluMetrics.validJsonRate >= localAluThresholds.validJsonRateMin &&
    localAluMetrics.mutexViolationRate <= localAluThresholds.mutexViolationRateMax;
  const ac41bLocalAluReady =
    localAluMetrics !== null &&
    ac41bSourceEligible &&
    ac41bThresholdSatisfied &&
    localAluMetrics.pass;
  const unlockReady = ac41aTraceMatrixReady && ac41bLocalAluReady;
  const status: AcStatus = unlockReady ? 'PASS' : 'BLOCKED';
  const localAluMetricsSegment =
    localAluMetrics === null
      ? 'ac41b_source=(none) ac41b_sourceEligible=false ac41b_thresholdSatisfied=false ac41b_passFlag=false ac41b_totalSamples=0 ac41b_validJsonRate=0 ac41b_mutexViolationRate=1 ac41b_report=(none)'
      : `ac41b_source=${localAluMetrics.source} ac41b_sourceEligible=${ac41bSourceEligible} ac41b_thresholdSatisfied=${ac41bThresholdSatisfied} ac41b_passFlag=${localAluMetrics.pass} ac41b_totalSamples=${localAluMetrics.totalSamples} ac41b_validJsonRate=${localAluMetrics.validJsonRate} ac41b_mutexViolationRate=${localAluMetrics.mutexViolationRate} ac41b_reportJson=${localAluMetrics.reportJsonPath} ac41b_reportMd=${localAluMetrics.reportMdPath}`;
  return {
    stage: 'S4',
    acId: 'AC4.1',
    title: 'Zero-Prompt Instinct (Split Gate AC4.1a/AC4.1b)',
    status,
    requirement:
      '需完成专属7B微调并在极短系统提示下保持 99.9% JSON syscall 良品率；且 S4 解锁前必须提供混沌矩阵证据：>=5 次 SYS_EXEC、>=1 次 timeout(429/502/timeout)、>=1 次 MMU 截断信号、>=1 次 deadlock/panic 信号、>=1 次 SYS_EXEC 与 MMU 信号耦合命中。',
    details: `S4 unlock gate status. traceReady=${traceReady} replayFrames=${stats.frames} execOps=${stats.execOps}/${matrixThresholds.execOpsMin} timeoutSignals=${stats.timeoutSignals}/${matrixThresholds.timeoutSignalsMin} mmuSignals=${stats.mmuSignals}/${matrixThresholds.mmuSignalsMin} deadlockSignals=${stats.deadlockSignals}/${matrixThresholds.deadlockSignalsMin} execMmuSignals=${stats.execMmuSignals}/${matrixThresholds.execMmuSignalsMin} traceCorrupted=${stats.traceCorrupted} corruptionReason=${stats.corruptionReason || '(none)'} ac41a_traceMatrixReady=${ac41aTraceMatrixReady} ac41b_localAluReady=${ac41bLocalAluReady} ac41b_minSamples=${localAluThresholds.minSamples} ac41b_validJsonRateMin=${localAluThresholds.validJsonRateMin} ac41b_mutexViolationRateMax=${localAluThresholds.mutexViolationRateMax} ${localAluMetricsSegment} unlockReady=${unlockReady}`,
    evidence: [
      path.join(ROOT, 'src'),
      tracePath || path.join(ROOT, 'benchmarks'),
      LOCAL_ALU_LATEST_FILE,
      path.join(ROOT, 'benchmarks', 'audits', 'local_alu'),
    ],
    nextActions: unlockReady
      ? []
      : [
          ac41aTraceMatrixReady
            ? '混沌矩阵已满足，进入本地 7B ALU 微调与良品率验证（>=99.9% JSON syscall）。'
            : '生成真实脏轨迹并满足混沌矩阵：>=5 SYS_EXEC、>=1 timeout、>=1 MMU 截断、>=1 deadlock/panic、>=1 execMmu 耦合。',
          '建立 trace 数据清洗与 SFT 数据集生成管线。',
          '新增 syscall JSON 良品率评估脚本（>=99.9%）。',
        ],
  };
}

async function ac42(): Promise<AcResult> {
  const thresholds = {
    minDeadlockEvents: 500,
    minEscapeRate: 0.95,
    minGotoAfterPopRate: 0.95,
  };
  const metrics = await readAc42GateMetrics();
  const hasMetrics = metrics !== null;
  const sourceEligible = hasMetrics && metrics.source.startsWith('local_alu');
  const runtimeEligible = hasMetrics && metrics.runtimeMode === 'local_alu_live';
  const oracleCallEligible = hasMetrics && (metrics.oracleCalls ?? 0) > 0;
  const setupEligible = hasMetrics && metrics.setupReady !== false;
  const thresholdSatisfied =
    hasMetrics &&
    metrics.deadlockEvents >= thresholds.minDeadlockEvents &&
    metrics.escapeRate >= thresholds.minEscapeRate &&
    metrics.gotoAfterPopRate >= thresholds.minGotoAfterPopRate;
  const pass = hasMetrics && sourceEligible && runtimeEligible && oracleCallEligible && setupEligible && thresholdSatisfied;
  return {
    stage: 'S4',
    acId: 'AC4.2',
    title: 'Deadlock Reflex',
    status: pass ? 'PASS' : 'BLOCKED',
    requirement:
      '7B 模型在连续死锁陷阱后应本能输出 SYS_POP 并切换路径。',
    details: hasMetrics
      ? `AC4.2 gate status. source=${metrics.source} runtimeMode=${metrics.runtimeMode} liveOracleCycles=${metrics.liveOracleCycles ?? '(n/a)'} setupReady=${metrics.setupReady} setupError=${metrics.setupError ?? '(none)'} oracleCalls=${metrics.oracleCalls ?? '(n/a)'} oracleBypassDecisions=${metrics.oracleBypassDecisions ?? '(n/a)'} deadlockEvents=${metrics.deadlockEvents}/${thresholds.minDeadlockEvents} popOnTrap=${metrics.popOnTrap} gotoAfterPop=${metrics.gotoAfterPop} escapeRate=${metrics.escapeRate}/${thresholds.minEscapeRate} gotoAfterPopRate=${metrics.gotoAfterPopRate}/${thresholds.minGotoAfterPopRate} sourceEligible=${sourceEligible} runtimeEligible=${runtimeEligible} oracleCallEligible=${oracleCallEligible} setupEligible=${setupEligible} thresholdSatisfied=${thresholdSatisfied} unlockReady=${pass} reportJson=${metrics.reportJsonPath} reportMd=${metrics.reportMdPath}`
      : `AC4.2 gate status. metricsReady=false source=(none) deadlockEvents=0/${thresholds.minDeadlockEvents} escapeRate=0/${thresholds.minEscapeRate} gotoAfterPopRate=0/${thresholds.minGotoAfterPopRate} unlockReady=false`,
    evidence: [AC42_LATEST_FILE, path.join(ROOT, 'benchmarks', 'audits', 'recursive')],
    nextActions: pass
      ? []
      : [
          hasMetrics
            ? sourceEligible
              ? runtimeEligible
                ? oracleCallEligible
                  ? setupEligible
                    ? '提高 local ALU deadlock 反射覆盖样本（>=500）并维持 escapeRate/gotoAfterPopRate >= 95%。'
                    : 'local_alu 运行未就绪；请补齐 --base-url/--model/--api-key 或环境变量后重跑 AC4.2。'
                  : 'AC4.2 需至少产生一次真实 oracle 调用（oracleCalls>0）。'
                : 'AC4.2 需使用真实 local_alu_live 路径，使用 --oracle local_alu 并确认 runtimeMode=local_alu_live。'
              : '当前仅有 mock/harness 指标；需要切换到 local_alu 来源并输出同格式指标。'
            : '先运行 deadlock reflex benchmark 生成 ac42_deadlock_reflex_latest.json。',
          '将 AC4.2 指标接入微调后回归测试，作为 S4 进入条件之一。',
        ],
  };
}

async function voyager(): Promise<AcResult> {
  return {
    stage: 'VOYAGER',
    acId: 'V-1',
    title: 'Voyager Infinite Horizon Benchmark',
    status: 'BLOCKED',
    requirement:
      '在4K窗口限制+混沌注入（网络抖动/权限陷阱/周期性kill -9）下完成长期真实仓库修复并最终 SYS_HALT。',
    details:
      'Long-duration chaos harness and target-repo benchmark pack are not yet assembled in current repo.',
    evidence: [path.join(ROOT, 'benchmarks')],
    nextActions: [
      '实现 chaos monkey harness（API断连、chmod陷阱、定时kill -9）。',
      '定义 Voyager 目标仓库与验收指标（ticks、恢复次数、最终测试通过）。',
      '接入图形化指标：恢复曲线、HALT 证据、O(1) token 折线。',
    ],
  };
}

async function runPreflight(): Promise<AcResult[]> {
  const results: AcResult[] = [];
  const typecheck = await runCommand('npm run typecheck');
  results.push({
    stage: 'S1',
    acId: 'PRECHECK',
    title: 'Repo Typecheck Baseline',
    status: typecheck.code === 0 ? 'PASS' : 'FAIL',
    requirement: '执行阶段验收前需保证当前代码可通过 typecheck。',
    details: typecheck.code === 0 ? 'typecheck passed' : `typecheck failed code=${typecheck.code}`,
    evidence: [path.join(ROOT, 'package.json')],
    nextActions: typecheck.code === 0 ? [] : ['先修复 typecheck 再执行分阶段验收。'],
  });
  return results;
}

async function main(): Promise<void> {
  await fsp.mkdir(AUDIT_DIR, { recursive: true });
  await fsp.mkdir(GOLDEN_TRACE_DIR, { recursive: true });
  const stamp = timestamp();
  const runtime: AcceptanceRuntimeContext = { auditStamp: stamp };

  const results: AcResult[] = [];
  results.push(...(await runPreflight()));
  results.push(await ac11());
  results.push(await ac12());
  results.push(await ac13());
  results.push(await ac21());
  results.push(await ac22());
  results.push(await ac23());
  results.push(await ac31(runtime));
  results.push(await ac32(runtime));
  results.push(await ac41(runtime));
  results.push(await ac42());
  results.push(await voyager());

  const summaries = stageStatus(results);
  const jsonPath = path.join(AUDIT_DIR, `staged_acceptance_recursive_${stamp}.json`);
  const mdPath = path.join(AUDIT_DIR, `staged_acceptance_recursive_${stamp}.md`);
  await fsp.writeFile(jsonPath, `${JSON.stringify({ stamp, summaries, results }, null, 2)}\n`, 'utf-8');
  await fsp.writeFile(mdPath, toMarkdown(results, summaries, stamp), 'utf-8');

  console.log(`[staged-acceptance] wrote ${jsonPath}`);
  console.log(`[staged-acceptance] wrote ${mdPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[staged-acceptance] fatal: ${message}`);
  process.exitCode = 1;
});
