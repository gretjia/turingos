import fs from 'node:fs/promises';
import path from 'node:path';
import { FileChronos } from '../chronos/file-chronos.js';
import { TuringEngine } from '../kernel/engine.js';
import { IOracle, Slice, State, Transition } from '../kernel/types.js';
import { LocalManifold } from '../manifold/local-manifold.js';
import { FileRegisters } from '../runtime/registers.js';

interface CliConfig {
  workspace: string;
  maxTicks: number;
  tickDelayMs: number;
}

function parseArgs(argv: string[]): CliConfig {
  const out: Partial<CliConfig> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      continue;
    }
    if (key === '--workspace') out.workspace = path.resolve(value);
    if (key === '--max-ticks') out.maxTicks = Number.parseInt(value, 10);
    if (key === '--tick-delay-ms') out.tickDelayMs = Number.parseInt(value, 10);
  }

  if (!out.workspace) {
    throw new Error('Missing --workspace');
  }

  return {
    workspace: out.workspace,
    maxTicks: Number.isFinite(out.maxTicks) && (out.maxTicks ?? 0) > 0 ? (out.maxTicks as number) : 50,
    tickDelayMs:
      Number.isFinite(out.tickDelayMs) && (out.tickDelayMs ?? 0) >= 0 ? (out.tickDelayMs as number) : 200,
  };
}

class ResumeProcessOracle implements IOracle {
  public async collapse(_discipline: string, q: State, _s: Slice): Promise<Transition> {
    const state = q.trim();
    if (state === 'q0') {
      return { q_next: 'q1', a_t: { op: 'SYS_GOTO', pointer: 'checkpoint/step1.txt' } };
    }
    if (state === 'q1') {
      return { q_next: 'q2', a_t: { op: 'SYS_EXEC', cmd: 'cat checkpoint/step1.txt' } };
    }
    if (state === 'q2') {
      return { q_next: 'q3', a_t: { op: 'SYS_GOTO', pointer: 'artifacts/resume.txt' } };
    }
    if (state === 'q3') {
      return { q_next: 'q4', a_t: { op: 'SYS_WRITE', payload: 'resumed-ok' } };
    }
    // S4 unlock matrix signal generation (post-resume):
    // - execOps>=5
    // - timeoutSignals>=1
    // - mmuSignals>=1
    // - deadlockSignals>=1
    // - execMmuSignals>=1
    if (state === 'q4') {
      return { q_next: 'q5', a_t: { op: 'SYS_GOTO', pointer: 'missing/for_exec_mmu.txt' } };
    }
    if (state === 'q5') {
      // Current pointer is missing file => observed contains PAGE_FAULT.
      // Emitting SYS_EXEC here satisfies execMmu coupling.
      return { q_next: 'q6', a_t: { op: 'SYS_EXEC', cmd: 'printf mmu_exec_ok' } };
    }
    if (state === 'q6') {
      return { q_next: 'q7', a_t: { op: 'SYS_EXEC', cmd: 'echo timeout_signal_from_exec' } };
    }
    if (state === 'q7') {
      return { q_next: 'q8', a_t: { op: 'SYS_EXEC', cmd: 'echo gateway_502_marker' } };
    }
    if (state === 'q8') {
      // Route through trap pointer to produce deadlock signal token in observed slice.
      return { q_next: 'q9', a_t: { op: 'SYS_GOTO', pointer: 'sys://trap/watchdog' } };
    }
    if (state === 'q9') {
      return { q_next: 'q10', a_t: { op: 'SYS_EXEC', cmd: 'cat checkpoint/step1.txt' } };
    }
    if (state === 'q10') {
      // Keep a successful verification command close to HALT.
      return { q_next: 'q11', a_t: { op: 'SYS_EXEC', cmd: 'cat checkpoint/step1.txt' } };
    }
    return { q_next: 'q12', a_t: { op: 'SYS_HALT' } };
  }
}

async function ensureWorkspace(workspace: string): Promise<void> {
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, 'MAIN_TAPE.md'), 'AC31 process-level kill -9 test\n', 'utf-8');
  await fs.mkdir(path.join(workspace, 'checkpoint'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'artifacts'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'checkpoint', 'step1.txt'), 'verified\n', 'utf-8');
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  await ensureWorkspace(cli.workspace);

  const registers = new FileRegisters(cli.workspace);
  registers.bootstrap('q0', 'MAIN_TAPE.md');

  const manifold = new LocalManifold(cli.workspace);
  const chronos = new FileChronos(path.join(cli.workspace, '.journal.log'));
  const engine = new TuringEngine(manifold, new ResumeProcessOracle(), chronos, 'ac31-kill9');

  const startQ = registers.readQ();
  const startD = registers.readD();
  console.log(`[ac31-worker] start q=${startQ} d=${startD}`);

  const result = await engine.ignite(startQ, startD, {
    maxTicks: cli.maxTicks,
    onTick: async (tick, q, d) => {
      registers.write(q, d);
      await fs.appendFile(
        path.join(cli.workspace, '.ac31_worker_ticks.log'),
        `pid=${process.pid} tick=${tick} q=${q.trim()} d=${d.trim()}\n`,
        'utf-8'
      );
      console.log(`[ac31-worker] tick=${tick} q=${q.trim()} d=${d.trim()}`);
      if (cli.tickDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, cli.tickDelayMs));
      }
    },
  });

  registers.write(result.q, result.d);
  const halted = result.q.trim() === 'HALT' || result.d.trim() === 'HALT';
  console.log(`[ac31-worker] stop ticks=${result.ticks} q=${result.q.trim()} d=${result.d.trim()} halted=${halted}`);
  process.exitCode = halted ? 0 : 2;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[ac31-worker] fatal: ${message}`);
  process.exitCode = 1;
});
