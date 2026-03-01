import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileChronos } from '../chronos/file-chronos.js';
import { HaltVerifier } from '../kernel/halt-verifier.js';
import { TuringHyperCore } from '../kernel/scheduler.js';
import { IOracle, Slice, State, Transition } from '../kernel/types.js';
import { LocalManifold } from '../manifold/local-manifold.js';
import { DualBrainOracle } from '../oracle/dual-brain-oracle.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUDIT_DIR = path.resolve(ROOT, 'benchmarks', 'audits', 'hypercore');

class PlannerOracle implements IOracle {
  public async collapse(_discipline: string, q: State, _s: Slice): Promise<Transition> {
    if (q.includes('[MAP_REDUCE_JOIN]')) {
      return {
        q_next: 'planner_done',
        mind_ops: [],
        world_op: { op: 'SYS_HALT' },
        a_t: { op: 'SYS_HALT' },
      };
    }
    return {
      q_next: 'planner_waiting_workers',
      mind_ops: [
        {
          op: 'SYS_MAP_REDUCE',
          tasks: ['write result file', 'write proof file'],
        },
      ],
      world_op: null,
      a_t: {
        op: 'SYS_MAP_REDUCE',
        tasks: ['write result file', 'write proof file'],
      },
    };
  }
}

class WorkerOracle implements IOracle {
  public async collapse(_discipline: string, q: State, _s: Slice): Promise<Transition> {
    if (q.includes('write result file') && !q.includes('worker_result_written')) {
      return {
        q_next: 'worker_result_written',
        mind_ops: [],
        world_op: { op: 'SYS_WRITE', payload: 'result=ok\n', semantic_cap: 'result.txt' },
        a_t: { op: 'SYS_WRITE', payload: 'result=ok\n', semantic_cap: 'result.txt' },
      };
    }
    if (q.includes('write proof file') && !q.includes('worker_proof_written')) {
      return {
        q_next: 'worker_proof_written',
        mind_ops: [],
        world_op: { op: 'SYS_WRITE', payload: 'proof=ok\n', semantic_cap: 'proof.txt' },
        a_t: { op: 'SYS_WRITE', payload: 'proof=ok\n', semantic_cap: 'proof.txt' },
      };
    }
    return {
      q_next: `${q}\nworker_halt_ready`,
      mind_ops: [],
      world_op: { op: 'SYS_HALT' },
      a_t: { op: 'SYS_HALT' },
    };
  }
}

function stampNow(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function ensureWorkspace(workspace: string): void {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'MAIN_TAPE.md'), '# hypercore gate\n', 'utf8');
}

async function main(): Promise<void> {
  const stamp = stampNow();
  const workspace = path.resolve(ROOT, 'benchmarks', 'tmp', `hypercore_v2_gate_${stamp}`);
  ensureWorkspace(workspace);

  const haltCmd = 'test -f result.txt && test -f proof.txt';
  process.env.TURINGOS_HALT_STANDARD_LOCK_FILE = path.join(workspace, '.halt-standard.lock.json');
  process.env.TURINGOS_HALT_VERIFY_CMD = haltCmd;
  const locked = HaltVerifier.resolveLockedCommand(workspace);
  const verifier = new HaltVerifier({
    workspaceDir: workspace,
    command: locked,
    timeoutMs: 30_000,
  });

  const manifold = new LocalManifold(workspace, { timeoutMs: 30_000 });
  const chronos = new FileChronos(path.join(workspace, '.journal.log'));
  const dualOracle = new DualBrainOracle({
    plannerOracle: new PlannerOracle(),
    workerOracle: new WorkerOracle(),
    plannerLabel: 'P:planner-mock',
    workerLabel: 'E:worker-mock',
  });

  const scheduler = new TuringHyperCore({
    manifold,
    chronos,
    oracle: dualOracle,
    verifier,
    disciplinePrompt: 'hypercore-gate',
  });
  const rootPid = scheduler.spawnRoot('q_root_boot', 'MAIN_TAPE.md');
  const result = await scheduler.run(rootPid, { maxTicks: 32 });

  const journal = fs.readFileSync(path.join(workspace, '.journal.log'), 'utf8');
  const checks = [
    { name: 'root_terminated', pass: result.rootState === 'TERMINATED', detail: result.rootState },
    { name: 'result_file_exists', pass: fs.existsSync(path.join(workspace, 'result.txt')), detail: 'result.txt' },
    { name: 'proof_file_exists', pass: fs.existsSync(path.join(workspace, 'proof.txt')), detail: 'proof.txt' },
    { name: 'map_reduce_logged', pass: journal.includes('[HYPERCORE_MAP]'), detail: 'journal contains HYPERCORE_MAP' },
    {
      name: 'reduce_join_logged',
      pass: journal.includes('[HYPERCORE_REDUCE]'),
      detail: 'journal contains HYPERCORE_REDUCE',
    },
    { name: 'pricing_logged', pass: journal.includes('[HYPERCORE_PRICE]'), detail: 'journal contains HYPERCORE_PRICE' },
  ];

  const pass = checks.every((item) => item.pass);
  const report = {
    stamp,
    pass,
    workspace,
    rootPid,
    ticks: result.ticks,
    rootState: result.rootState,
    haltCommand: locked,
    checks,
  };

  const stamped = path.join(AUDIT_DIR, `hypercore_v2_gate_${stamp}.json`);
  const latest = path.join(AUDIT_DIR, 'hypercore_v2_gate_latest.json');
  writeJson(stamped, report);
  writeJson(latest, report);

  console.log(`[hypercore-v2-gate] pass=${pass ? 'true' : 'false'} ticks=${result.ticks} root_state=${result.rootState}`);
  console.log(`[hypercore-v2-gate] report=${stamped}`);
  if (!pass) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[hypercore-v2-gate] FAIL ${message}`);
  process.exitCode = 1;
});
