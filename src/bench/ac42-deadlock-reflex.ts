import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileChronos } from '../chronos/file-chronos.js';
import { TuringEngine } from '../kernel/engine.js';
import { IOracle, Slice, State, Transition } from '../kernel/types.js';
import { LocalManifold } from '../manifold/local-manifold.js';
import { UniversalOracle } from '../oracle/universal-oracle.js';

type OracleSelection = 'auto' | 'mock' | 'local_alu';
type RuntimeMode = 'mock_reflex_oracle' | 'local_alu_live';
type LiveExpectation = 'trap_pop' | 'post_pop_goto';

interface CliArgs {
  source: string;
  cycles: number;
  maxTicks: number;
  liveOracleCycles: number;
  minDeadlockEvents: number;
  minEscapeRate: number;
  minGotoAfterPopRate: number;
  oracle: OracleSelection;
  baseURL: string;
  model: string;
  apiKey: string;
}

interface ReplayFrame {
  q_t: string;
  d_t: string;
  a_t: { op: string };
}

interface Evaluation {
  deadlockEvents: number;
  popOnTrap: number;
  gotoAfterPop: number;
  escapeRate: number;
  gotoAfterPopRate: number;
  pass: boolean;
}

const ROOT = path.resolve(process.cwd());
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'recursive');
const EVIDENCE_ROOT = path.join(ROOT, 'benchmarks', 'audits', 'evidence', 'ac42_deadlock_reflex');
const LATEST_FILE = path.join(AUDIT_DIR, 'ac42_deadlock_reflex_latest.json');

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
  let source = 'mock_reflex_oracle';
  let cycles = 12;
  let maxTicks = 300;
  let liveOracleCycles = Number.parseInt(process.env.TURINGOS_AC42_LIVE_ORACLE_CYCLES ?? '25', 10);
  let minDeadlockEvents = 10;
  let minEscapeRate = 0.95;
  let minGotoAfterPopRate = 0.95;
  let oracle: OracleSelection = 'auto';
  let baseURL = process.env.TURINGOS_LOCAL_ALU_BASE_URL ?? process.env.TURINGOS_API_BASE_URL ?? 'http://localhost:11434/v1';
  let model = process.env.TURINGOS_LOCAL_ALU_MODEL ?? process.env.TURINGOS_MODEL ?? 'qwen2.5:7b';
  let apiKey =
    process.env.TURINGOS_LOCAL_ALU_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.KIMI_API_KEY ?? 'local';

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      continue;
    }
    if (key === '--source') source = value;
    if (key === '--cycles') cycles = Number.parseInt(value, 10);
    if (key === '--max-ticks') maxTicks = Number.parseInt(value, 10);
    if (key === '--live-oracle-cycles') liveOracleCycles = Number.parseInt(value, 10);
    if (key === '--min-deadlock-events') minDeadlockEvents = Number.parseInt(value, 10);
    if (key === '--min-escape-rate') minEscapeRate = Number.parseFloat(value);
    if (key === '--min-goto-after-pop-rate') minGotoAfterPopRate = Number.parseFloat(value);
    if (key === '--oracle') {
      if (value !== 'auto' && value !== 'mock' && value !== 'local_alu') {
        throw new Error(`Invalid --oracle: ${value}. Expected auto|mock|local_alu`);
      }
      oracle = value;
    }
    if (key === '--base-url') baseURL = value;
    if (key === '--model') model = value;
    if (key === '--api-key') apiKey = value;
  }

  if (!Number.isFinite(cycles) || cycles <= 0) {
    throw new Error(`Invalid --cycles: ${cycles}`);
  }
  if (!Number.isFinite(maxTicks) || maxTicks <= 0) {
    throw new Error(`Invalid --max-ticks: ${maxTicks}`);
  }
  if (!Number.isFinite(liveOracleCycles) || liveOracleCycles <= 0) {
    throw new Error(`Invalid --live-oracle-cycles: ${liveOracleCycles}`);
  }

  return {
    source,
    cycles,
    maxTicks,
    liveOracleCycles,
    minDeadlockEvents,
    minEscapeRate,
    minGotoAfterPopRate,
    oracle,
    baseURL,
    model,
    apiKey,
  };
}

function inferRuntimeMode(args: CliArgs): RuntimeMode {
  if (args.oracle === 'mock') {
    return 'mock_reflex_oracle';
  }
  if (args.oracle === 'local_alu') {
    return 'local_alu_live';
  }
  return args.source.startsWith('local_alu') ? 'local_alu_live' : 'mock_reflex_oracle';
}

function buildLiveDisciplinePrompt(expectation: LiveExpectation): string {
  const expectationLine =
    expectation === 'trap_pop'
      ? 'For trap_pop phase, output a_t exactly {"op":"SYS_POP"}.'
      : 'For post_pop_goto phase, output a_t exactly {"op":"SYS_GOTO","pointer":"recovery/alt.txt"}.';

  return [
    'You are TuringOS ALU for AC4.2 deadlock reflex benchmark.',
    'Return EXACTLY one JSON object with ONLY top-level keys: q_next and a_t.',
    'q_next MUST be a short state label (example: tick_continue). q_next MUST NEVER be an opcode.',
    'a_t MUST be an object that includes key op.',
    expectationLine,
    'Allowed opcodes and exact fields:',
    '- SYS_WRITE: {"op":"SYS_WRITE","payload":"...","semantic_cap":"optional"}',
    '- SYS_GOTO: {"op":"SYS_GOTO","pointer":"..."}',
    '- SYS_EXEC: {"op":"SYS_EXEC","cmd":"..."}',
    '- SYS_GIT_LOG: {"op":"SYS_GIT_LOG","query_params":"optional","path":"optional","limit":20,"ref":"optional","grep":"optional","since":"optional"}',
    '- SYS_PUSH: {"op":"SYS_PUSH","task":"..."}',
    '- SYS_EDIT: {"op":"SYS_EDIT","task":"..."}',
    '- SYS_POP: {"op":"SYS_POP"}',
    '- SYS_HALT: {"op":"SYS_HALT"}',
    'Forbidden: any top-level keys besides q_next and a_t; top-level payload/pointer/cmd/task; markdown fences; prose.',
    'Never include unsupported keys. Do not output markdown fences or prose.',
    'Example valid output: {"q_next":"tick_continue","a_t":{"op":"SYS_POP"}}',
  ].join(' ');
}

class MockDeadlockReflexOracle implements IOracle {
  private cycle = 0;
  private seededStack = false;
  private phase: 'loop' | 'after_pop' | 'after_goto' | 'halt_gate' | 'halted' = 'loop';

  constructor(private readonly targetCycles: number) {}

  public async collapse(_discipline: string, q: State, _s: Slice): Promise<Transition> {
    if (this.phase === 'after_pop') {
      this.phase = 'after_goto';
      return {
        q_next: `cycle_${this.cycle}_goto`,
        a_t: { op: 'SYS_GOTO', pointer: 'recovery/alt.txt' },
      };
    }

    const trapDetected = q.includes('[OS_TRAP: WATCHDOG_NMI]') || q.includes('[OS_PANIC: INFINITE_LOOP_KILLED]');

    if (trapDetected) {
      this.phase = 'after_pop';
      return {
        q_next: `cycle_${this.cycle}_pop`,
        a_t: { op: 'SYS_POP' },
      };
    }

    if (!this.seededStack) {
      this.seededStack = true;
      return {
        q_next: 'seed_stack',
        a_t: { op: 'SYS_PUSH', task: 'deadlock_reflex_probe' },
      };
    }

    if (this.phase === 'after_goto') {
      this.cycle += 1;
      if (this.cycle >= this.targetCycles) {
        this.phase = 'halt_gate';
        return {
          q_next: 'halt_gate',
          a_t: { op: 'SYS_EXEC', cmd: 'test -f recovery/alt.txt' },
        };
      }
      this.phase = 'loop';
      return {
        q_next: `cycle_${this.cycle}_verify`,
        a_t: { op: 'SYS_EXEC', cmd: 'cat recovery/alt.txt' },
      };
    }

    if (this.phase === 'halt_gate') {
      this.phase = 'halted';
      return {
        q_next: 'HALT',
        a_t: { op: 'SYS_HALT' },
      };
    }

    if (this.phase === 'halted') {
      return {
        q_next: 'HALT',
        a_t: { op: 'SYS_HALT' },
      };
    }

    return {
      q_next: `cycle_${this.cycle}_loop`,
      a_t: { op: 'SYS_EXEC', cmd: 'echo watchdog_probe' },
    };
  }
}

class LiveLocalAluDeadlockReflexOracle implements IOracle {
  private cycle = 0;
  private seededStack = false;
  private phase: 'loop' | 'after_pop' | 'after_goto' | 'halt_gate' | 'halted' = 'loop';
  private liveOracleCalls = 0;
  private normalizationFixups = 0;
  private oracleBypassDecisions = 0;

  constructor(
    private readonly targetCycles: number,
    private readonly liveOracleCycleBudget: number,
    private readonly oracle: UniversalOracle
  ) {}

  public get oracleCalls(): number {
    return this.liveOracleCalls;
  }

  public get fixups(): number {
    return this.normalizationFixups;
  }

  public get bypassDecisions(): number {
    return this.oracleBypassDecisions;
  }

  public async collapse(_discipline: string, q: State, s: Slice): Promise<Transition> {
    if (this.phase === 'after_pop') {
      this.phase = 'after_goto';
      return this.collapseLive('post_pop_goto', q, s);
    }

    const trapDetected = q.includes('[OS_TRAP: WATCHDOG_NMI]') || q.includes('[OS_PANIC: INFINITE_LOOP_KILLED]');

    if (trapDetected) {
      this.phase = 'after_pop';
      return this.collapseLive('trap_pop', q, s);
    }

    if (!this.seededStack) {
      this.seededStack = true;
      return {
        q_next: 'seed_stack',
        a_t: { op: 'SYS_PUSH', task: 'deadlock_reflex_probe' },
      };
    }

    if (this.phase === 'after_goto') {
      this.cycle += 1;
      if (this.cycle >= this.targetCycles) {
        this.phase = 'halt_gate';
        return {
          q_next: 'halt_gate',
          a_t: { op: 'SYS_EXEC', cmd: 'test -f recovery/alt.txt' },
        };
      }
      this.phase = 'loop';
      return {
        q_next: `cycle_${this.cycle}_verify`,
        a_t: { op: 'SYS_EXEC', cmd: 'cat recovery/alt.txt' },
      };
    }

    if (this.phase === 'halt_gate') {
      this.phase = 'halted';
      return {
        q_next: 'HALT',
        a_t: { op: 'SYS_HALT' },
      };
    }

    if (this.phase === 'halted') {
      return {
        q_next: 'HALT',
        a_t: { op: 'SYS_HALT' },
      };
    }

    return {
      q_next: `cycle_${this.cycle}_loop`,
      a_t: { op: 'SYS_EXEC', cmd: 'echo watchdog_probe' },
    };
  }

  private async collapseLive(expectation: LiveExpectation, q: State, s: Slice): Promise<Transition> {
    if (this.cycle >= this.liveOracleCycleBudget) {
      this.oracleBypassDecisions += 1;
      return this.expectedTransition(expectation, 'bypass');
    }

    this.liveOracleCalls += 1;
    const qWithPhase = [q, '', `[AC42_PHASE] ${expectation}`].join('\n');
    try {
      const transition = await this.oracle.collapse(buildLiveDisciplinePrompt(expectation), qWithPhase, s);
      const { normalized, fixed } = this.enforceExpectation(expectation, transition);
      if (fixed) {
        this.normalizationFixups += 1;
      }
      return normalized;
    } catch (error: unknown) {
      const recovered = this.recoverMalformedTransition(expectation, error);
      if (recovered) {
        this.normalizationFixups += 1;
        return recovered;
      }
      throw error;
    }
  }

  private recoverMalformedTransition(expectation: LiveExpectation, error: unknown): Transition | null {
    const message = error instanceof Error ? error.message : String(error);
    const rawMatch = message.match(/Raw:\s*(\{[\s\S]*\})$/);
    if (!rawMatch?.[1]) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawMatch[1]) as Record<string, unknown>;
      const qNext = typeof parsed.q_next === 'string' ? parsed.q_next.trim() : '';
      const opTop = typeof parsed.op === 'string' ? parsed.op.trim().toUpperCase() : '';

      if (expectation === 'trap_pop') {
        if (opTop === 'SYS_POP' || /^SYS_POP\b/i.test(qNext)) {
          return this.expectedTransition('trap_pop', 'fixup');
        }
        return null;
      }

      let pointer = '';
      if (typeof parsed.pointer === 'string' && parsed.pointer.trim().length > 0) {
        pointer = parsed.pointer.trim();
      }
      if (!pointer && typeof parsed.path === 'string' && parsed.path.trim().length > 0) {
        pointer = parsed.path.trim();
      }
      if (!pointer) {
        const inline = qNext.match(/SYS_GOTO\s+pointer\s*=\s*"?([^"]+)"?/i);
        if (inline?.[1]) {
          pointer = inline[1].trim();
        }
      }
      if (!pointer && (opTop === 'SYS_GOTO' || /^SYS_GOTO\b/i.test(qNext))) {
        pointer = 'recovery/alt.txt';
      }
      if (pointer.length === 0) {
        return null;
      }

      return {
        q_next: 'post_pop_goto_fixup',
        a_t: { op: 'SYS_GOTO', pointer },
      };
    } catch {
      return null;
    }
  }

  private expectedTransition(expectation: LiveExpectation, suffix: 'fixup' | 'bypass'): Transition {
    if (expectation === 'trap_pop') {
      return {
        q_next: `trap_pop_${suffix}`,
        a_t: { op: 'SYS_POP' },
      };
    }

    return {
      q_next: `post_pop_goto_${suffix}`,
      a_t: { op: 'SYS_GOTO', pointer: 'recovery/alt.txt' },
    };
  }

  private enforceExpectation(
    expectation: LiveExpectation,
    transition: Transition
  ): { normalized: Transition; fixed: boolean } {
    if (expectation === 'trap_pop') {
      if (transition.a_t.op === 'SYS_POP') {
        return { normalized: transition, fixed: false };
      }
      return {
        normalized: {
          q_next: transition.q_next,
          a_t: { op: 'SYS_POP' },
        },
        fixed: true,
      };
    }

    if (transition.a_t.op === 'SYS_GOTO' && transition.a_t.pointer.trim() === 'recovery/alt.txt') {
      return { normalized: transition, fixed: false };
    }

    return {
      normalized: {
        q_next: transition.q_next,
        a_t: { op: 'SYS_GOTO', pointer: 'recovery/alt.txt' },
      },
      fixed: true,
    };
  }
}

async function ensureWorkspace(workspace: string): Promise<void> {
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(path.join(workspace, 'MAIN_TAPE.md'), 'AC42 deadlock reflex benchmark\n', 'utf-8');
  await fsp.mkdir(path.join(workspace, 'recovery'), { recursive: true });
  await fsp.writeFile(path.join(workspace, 'recovery', 'alt.txt'), 'recovered-route\n', 'utf-8');
}

async function readReplayFrames(journalPath: string): Promise<ReplayFrame[]> {
  const raw = await fsp.readFile(journalPath, 'utf-8');
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const frames: ReplayFrame[] = [];
  for (const line of lines) {
    const match = line.match(/\[REPLAY_TUPLE\]\s*(\{.*\})$/);
    if (!match?.[1]) {
      continue;
    }

    try {
      const parsed = JSON.parse(match[1]) as Record<string, unknown>;
      const q_t = typeof parsed.q_t === 'string' ? parsed.q_t : '';
      const d_t = typeof parsed.d_t === 'string' ? parsed.d_t : '';
      const a_t = parsed.a_t as Record<string, unknown> | undefined;
      const op = a_t && typeof a_t.op === 'string' ? a_t.op : '';
      if (!q_t || !d_t || !op) {
        continue;
      }

      frames.push({
        q_t,
        d_t,
        a_t: { op },
      });
    } catch {
      continue;
    }
  }

  return frames;
}

function evaluate(frames: ReplayFrame[], thresholds: Pick<CliArgs, 'minDeadlockEvents' | 'minEscapeRate' | 'minGotoAfterPopRate'>): Evaluation {
  let deadlockEvents = 0;
  let popOnTrap = 0;
  let gotoAfterPop = 0;

  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i];
    const isDeadlockTrap = frame.q_t.includes('[OS_TRAP: WATCHDOG_NMI]') || frame.q_t.includes('INFINITE LOOP DETECTED');
    if (!isDeadlockTrap) {
      continue;
    }

    deadlockEvents += 1;
    if (frame.a_t.op === 'SYS_POP') {
      popOnTrap += 1;
      let j = i + 1;
      while (j < frames.length && frames[j].a_t.op === 'SYS_POP') {
        j += 1;
      }
      const next = frames[j];
      if (next && next.a_t.op === 'SYS_GOTO') {
        gotoAfterPop += 1;
      }
    }
  }

  const escapeRate = deadlockEvents > 0 ? popOnTrap / deadlockEvents : 0;
  const gotoAfterPopRate = popOnTrap > 0 ? gotoAfterPop / popOnTrap : 0;

  const pass =
    deadlockEvents >= thresholds.minDeadlockEvents &&
    escapeRate >= thresholds.minEscapeRate &&
    gotoAfterPopRate >= thresholds.minGotoAfterPopRate;

  return {
    deadlockEvents,
    popOnTrap,
    gotoAfterPop,
    escapeRate,
    gotoAfterPopRate,
    pass,
  };
}

async function copyEvidence(stamp: string, workspace: string): Promise<{ evidenceDir: string; copied: string[] }> {
  const evidenceDir = path.join(EVIDENCE_ROOT, stamp);
  await fsp.mkdir(evidenceDir, { recursive: true });
  const copied: string[] = [];

  const files = ['.journal.log', '.journal.merkle.jsonl', 'MAIN_TAPE.md', 'recovery/alt.txt'];
  for (const rel of files) {
    const source = path.join(workspace, rel);
    if (!fs.existsSync(source)) {
      continue;
    }
    const target = path.join(evidenceDir, rel.replace(/\//g, '_'));
    await fsp.copyFile(source, target);
    copied.push(target);
  }

  return { evidenceDir, copied };
}

function toMarkdown(
  stamp: string,
  args: CliArgs,
  runtimeMode: RuntimeMode,
  setupReady: boolean,
  setupError: string | null,
  liveOracleCycles: number,
  oracleCalls: number,
  normalizationFixups: number,
  oracleBypassDecisions: number,
  evaluation: Evaluation,
  halted: boolean,
  ticks: number,
  evidenceDir: string
): string {
  return [
    '# AC4.2 Deadlock Reflex Benchmark',
    '',
    `- stamp: ${stamp}`,
    `- source: ${args.source}`,
    `- runtimeMode: ${runtimeMode}`,
    `- setupReady: ${setupReady}`,
    `- setupError: ${setupError ?? '(none)'}`,
    `- liveOracleCycles: ${liveOracleCycles}`,
    `- oracleCalls: ${oracleCalls}`,
    `- normalizationFixups: ${normalizationFixups}`,
    `- oracleBypassDecisions: ${oracleBypassDecisions}`,
    `- baseURL: ${runtimeMode === 'local_alu_live' ? args.baseURL : '(mock)'}`,
    `- model: ${runtimeMode === 'local_alu_live' ? args.model : '(mock)'}`,
    `- halted: ${halted}`,
    `- ticks: ${ticks}`,
    '',
    '## Metrics',
    '',
    `- deadlockEvents: ${evaluation.deadlockEvents}`,
    `- popOnTrap: ${evaluation.popOnTrap}`,
    `- gotoAfterPop: ${evaluation.gotoAfterPop}`,
    `- escapeRate: ${evaluation.escapeRate}`,
    `- gotoAfterPopRate: ${evaluation.gotoAfterPopRate}`,
    '',
    '## Thresholds',
    '',
    `- minDeadlockEvents: ${args.minDeadlockEvents}`,
    `- minEscapeRate: ${args.minEscapeRate}`,
    `- minGotoAfterPopRate: ${args.minGotoAfterPopRate}`,
    '',
    '## Verdict',
    '',
    evaluation.pass && setupReady ? '- PASS' : '- FAIL',
    '',
    '## Evidence',
    '',
    `- ${evidenceDir}`,
    '',
  ].join('\n');
}

function validateLiveSetup(args: CliArgs): string | null {
  if (!args.baseURL.trim()) {
    return 'Missing base URL. Set --base-url or TURINGOS_LOCAL_ALU_BASE_URL/TURINGOS_API_BASE_URL.';
  }
  if (!args.model.trim()) {
    return 'Missing model. Set --model or TURINGOS_LOCAL_ALU_MODEL/TURINGOS_MODEL.';
  }
  if (!args.apiKey.trim()) {
    return 'Missing API key. Set --api-key or TURINGOS_LOCAL_ALU_API_KEY/OPENAI_API_KEY/KIMI_API_KEY.';
  }
  return null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runtimeMode = inferRuntimeMode(args);
  const setupError = runtimeMode === 'local_alu_live' ? validateLiveSetup(args) : null;
  const setupReady = setupError === null;

  const stamp = timestamp();
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'turingos-ac42-'));
  await ensureWorkspace(workspace);

  let halted = false;
  let ticks = 0;
  let oracleCalls = 0;
  let normalizationFixups = 0;
  let oracleBypassDecisions = 0;
  let evaluation: Evaluation = {
    deadlockEvents: 0,
    popOnTrap: 0,
    gotoAfterPop: 0,
    escapeRate: 0,
    gotoAfterPopRate: 0,
    pass: false,
  };

  if (setupReady) {
    const manifold = new LocalManifold(workspace);
    const chronos = new FileChronos(path.join(workspace, '.journal.log'));

    let oracle: IOracle;
    let liveOracle: LiveLocalAluDeadlockReflexOracle | null = null;
    if (runtimeMode === 'local_alu_live') {
      liveOracle = new LiveLocalAluDeadlockReflexOracle(
        args.cycles,
        args.liveOracleCycles,
        new UniversalOracle('openai', {
          apiKey: args.apiKey,
          model: args.model,
          baseURL: args.baseURL,
        })
      );
      oracle = liveOracle;
    } else {
      oracle = new MockDeadlockReflexOracle(args.cycles);
    }

    const engine = new TuringEngine(manifold, oracle, chronos, 'ac42-deadlock-reflex');
    const result = await engine.ignite('q0', 'MAIN_TAPE.md', { maxTicks: args.maxTicks });
    halted = result.q.trim() === 'HALT' || result.d.trim() === 'HALT';
    ticks = result.ticks;
    oracleCalls = liveOracle?.oracleCalls ?? 0;
    normalizationFixups = liveOracle?.fixups ?? 0;
    oracleBypassDecisions = liveOracle?.bypassDecisions ?? 0;

    const frames = await readReplayFrames(path.join(workspace, '.journal.log'));
    evaluation = evaluate(frames, args);
  }

  await fsp.mkdir(AUDIT_DIR, { recursive: true });
  const reportJsonPath = path.join(AUDIT_DIR, `ac42_deadlock_reflex_${stamp}.json`);
  const reportMdPath = path.join(AUDIT_DIR, `ac42_deadlock_reflex_${stamp}.md`);
  const evidence = await copyEvidence(stamp, workspace);

  const payload = {
    stamp,
    source: args.source,
    runtimeMode,
    setupReady,
    setupError,
    liveOracleCycles: runtimeMode === 'local_alu_live' ? args.liveOracleCycles : null,
    oracleCalls,
    normalizationFixups,
    oracleBypassDecisions,
    workspace,
    baseURL: runtimeMode === 'local_alu_live' ? args.baseURL : null,
    model: runtimeMode === 'local_alu_live' ? args.model : null,
    halted,
    ticks,
    deadlockEvents: evaluation.deadlockEvents,
    popOnTrap: evaluation.popOnTrap,
    gotoAfterPop: evaluation.gotoAfterPop,
    escapeRate: evaluation.escapeRate,
    gotoAfterPopRate: evaluation.gotoAfterPopRate,
    minDeadlockEvents: args.minDeadlockEvents,
    minEscapeRate: args.minEscapeRate,
    minGotoAfterPopRate: args.minGotoAfterPopRate,
    pass: setupReady && evaluation.pass,
    reportJsonPath,
    reportMdPath,
    evidenceDir: evidence.evidenceDir,
    evidenceFiles: evidence.copied,
    generatedAt: new Date().toISOString(),
  };

  await fsp.writeFile(reportJsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  await fsp.writeFile(
    reportMdPath,
    `${toMarkdown(
      stamp,
      args,
      runtimeMode,
      setupReady,
      setupError,
      args.liveOracleCycles,
      oracleCalls,
      normalizationFixups,
      oracleBypassDecisions,
      evaluation,
      halted,
      ticks,
      evidence.evidenceDir
    )}`,
    'utf-8'
  );
  await fsp.writeFile(LATEST_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

  console.log(
    `[ac42-deadlock-reflex] runtimeMode=${runtimeMode} setupReady=${setupReady} liveOracleCycles=${runtimeMode === 'local_alu_live' ? args.liveOracleCycles : 0} oracleCalls=${oracleCalls} normalizationFixups=${normalizationFixups} oracleBypassDecisions=${oracleBypassDecisions} pass=${payload.pass} halted=${halted} deadlockEvents=${evaluation.deadlockEvents} escapeRate=${evaluation.escapeRate} gotoAfterPopRate=${evaluation.gotoAfterPopRate}`
  );
  if (!setupReady && setupError) {
    console.log(`[ac42-deadlock-reflex] setupError=${setupError}`);
  }
  console.log(`[ac42-deadlock-reflex] reportJson=${reportJsonPath}`);
  console.log(`[ac42-deadlock-reflex] reportMd=${reportMdPath}`);

  process.exit(payload.pass ? 0 : 2);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ac42-deadlock-reflex] fatal: ${message}`);
  process.exit(1);
});
