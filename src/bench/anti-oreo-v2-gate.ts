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
  fs.writeFileSync(path.join(workspace, 'MAIN_TAPE.md'), '# anti-oreo gate\n', 'utf8');
}

class ScenarioOnePlannerOracle implements IOracle {
  public async collapse(_discipline: string, q: State, _s: Slice): Promise<Transition> {
    if (q.includes('[MAP_REDUCE_JOIN]')) {
      return {
        q_next: 'planner_done',
        mind_ops: [],
        world_op: { op: 'SYS_HALT' },
        a_t: { op: 'SYS_HALT' },
      };
    }

    if (q.includes('[WHITE_BOX_REJECTED]')) {
      return {
        q_next: 'planner_dispatch_workers',
        mind_ops: [{ op: 'SYS_MAP_REDUCE', tasks: ['write result file', 'write proof file'] }],
        world_op: null,
        a_t: { op: 'SYS_MAP_REDUCE', tasks: ['write result file', 'write proof file'] },
      };
    }

    // First action intentionally attempts HALT before artifacts exist.
    return {
      q_next: 'planner_precheck_halt',
      mind_ops: [],
      world_op: { op: 'SYS_HALT' },
      a_t: { op: 'SYS_HALT' },
    };
  }
}

class ScenarioOneWorkerOracle implements IOracle {
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

class ScenarioTwoPlannerOracle implements IOracle {
  public async collapse(_discipline: string, q: State, _s: Slice): Promise<Transition> {
    return {
      q_next: `${q}\ninvalid_combination`,
      mind_ops: [{ op: 'SYS_MAP_REDUCE', tasks: ['noop'] }],
      world_op: { op: 'SYS_GOTO', pointer: 'MAIN_TAPE.md' },
      a_t: { op: 'SYS_GOTO', pointer: 'MAIN_TAPE.md' },
    };
  }
}

class ScenarioTwoWorkerOracle implements IOracle {
  public async collapse(_discipline: string, q: State, _s: Slice): Promise<Transition> {
    return {
      q_next: q,
      mind_ops: [{ op: 'SYS_POP' }],
      world_op: null,
      a_t: { op: 'SYS_POP' },
    };
  }
}

async function runScenarioOne(workspace: string): Promise<{ pass: boolean; checks: Array<{ name: string; pass: boolean; detail: string }>; result: { ticks: number; rootState: string } }> {
  ensureWorkspace(workspace);
  process.env.TURINGOS_HALT_STANDARD_LOCK_FILE = path.join(workspace, '.halt-standard.lock.json');
  process.env.TURINGOS_HALT_VERIFY_CMD = 'test -f result.txt && test -f proof.txt';

  const haltCommand = HaltVerifier.resolveLockedCommand(workspace);
  const verifier = new HaltVerifier({
    workspaceDir: workspace,
    command: haltCommand,
    timeoutMs: 30_000,
  });

  const manifold = new LocalManifold(workspace, { timeoutMs: 30_000 });
  const chronos = new FileChronos(path.join(workspace, '.journal.log'));
  const oracle = new DualBrainOracle({
    plannerOracle: new ScenarioOnePlannerOracle(),
    workerOracle: new ScenarioOneWorkerOracle(),
    plannerLabel: 'P:planner-gate',
    workerLabel: 'E:worker-gate',
  });

  const scheduler = new TuringHyperCore({ manifold, chronos, oracle, verifier, disciplinePrompt: 'anti-oreo-v2-gate-s1' });
  const rootPid = scheduler.spawnRoot('q_root_boot', 'MAIN_TAPE.md');
  const result = await scheduler.run(rootPid, { maxTicks: 48 });

  const journalPath = path.join(workspace, '.journal.log');
  const journal = fs.existsSync(journalPath) ? fs.readFileSync(journalPath, 'utf8') : '';
  const checks = [
    { name: 'root_terminated', pass: result.rootState === 'TERMINATED', detail: result.rootState },
    { name: 'map_logged', pass: journal.includes('[HYPERCORE_MAP]'), detail: 'journal contains HYPERCORE_MAP' },
    { name: 'reduce_logged', pass: journal.includes('[HYPERCORE_REDUCE]'), detail: 'journal contains HYPERCORE_REDUCE' },
    { name: 'pricing_fail_logged', pass: journal.includes('verdict=FAIL'), detail: 'journal contains verdict=FAIL' },
    { name: 'pricing_pass_logged', pass: journal.includes('verdict=PASS'), detail: 'journal contains verdict=PASS' },
    { name: 'result_file_exists', pass: fs.existsSync(path.join(workspace, 'result.txt')), detail: 'result.txt' },
    { name: 'proof_file_exists', pass: fs.existsSync(path.join(workspace, 'proof.txt')), detail: 'proof.txt' },
  ];

  return {
    pass: checks.every((c) => c.pass),
    checks,
    result: {
      ticks: result.ticks,
      rootState: result.rootState,
    },
  };
}

async function runScenarioTwo(workspace: string): Promise<{ pass: boolean; checks: Array<{ name: string; pass: boolean; detail: string }>; result: { ticks: number; rootState: string } }> {
  ensureWorkspace(workspace);
  process.env.TURINGOS_HALT_STANDARD_LOCK_FILE = path.join(workspace, '.halt-standard.lock.json');
  process.env.TURINGOS_HALT_VERIFY_CMD = 'true';

  const haltCommand = HaltVerifier.resolveLockedCommand(workspace);
  const verifier = new HaltVerifier({
    workspaceDir: workspace,
    command: haltCommand,
    timeoutMs: 30_000,
  });

  const manifold = new LocalManifold(workspace, { timeoutMs: 30_000 });
  const chronos = new FileChronos(path.join(workspace, '.journal.log'));
  const oracle = new DualBrainOracle({
    plannerOracle: new ScenarioTwoPlannerOracle(),
    workerOracle: new ScenarioTwoWorkerOracle(),
    plannerLabel: 'P:planner-invalid',
    workerLabel: 'E:worker-invalid',
  });

  const scheduler = new TuringHyperCore({ manifold, chronos, oracle, verifier, disciplinePrompt: 'anti-oreo-v2-gate-s2' });
  const rootPid = scheduler.spawnRoot('q_root_boot', 'MAIN_TAPE.md');
  const result = await scheduler.run(rootPid, { maxTicks: 12 });

  const journalPath = path.join(workspace, '.journal.log');
  const journal = fs.existsSync(journalPath) ? fs.readFileSync(journalPath, 'utf8') : '';
  const checks = [
    { name: 'root_killed', pass: result.rootState === 'KILLED', detail: result.rootState },
    { name: 'red_flag_threshold_reached', pass: journal.includes('red_flags=3/3'), detail: 'journal contains red_flags=3/3' },
  ];

  return {
    pass: checks.every((c) => c.pass),
    checks,
    result: {
      ticks: result.ticks,
      rootState: result.rootState,
    },
  };
}

async function main(): Promise<void> {
  const stamp = stampNow();
  const workspaceA = path.resolve(ROOT, 'benchmarks', 'tmp', `anti_oreo_v2_gate_s1_${stamp}`);
  const workspaceB = path.resolve(ROOT, 'benchmarks', 'tmp', `anti_oreo_v2_gate_s2_${stamp}`);

  const s1 = await runScenarioOne(workspaceA);
  const s2 = await runScenarioTwo(workspaceB);

  const report = {
    stamp,
    pass: s1.pass && s2.pass,
    topologyProfile: 'turingos.anti_oreo.v2',
    scenarios: {
      pricing_map_reduce_flow: {
        workspace: workspaceA,
        pass: s1.pass,
        result: s1.result,
        checks: s1.checks,
      },
      red_flag_kill_flow: {
        workspace: workspaceB,
        pass: s2.pass,
        result: s2.result,
        checks: s2.checks,
      },
    },
  };

  const stamped = path.join(AUDIT_DIR, `anti_oreo_v2_gate_${stamp}.json`);
  const latest = path.join(AUDIT_DIR, 'anti_oreo_v2_gate_latest.json');
  writeJson(stamped, report);
  writeJson(latest, report);

  console.log(`[anti-oreo-v2-gate] pass=${report.pass ? 'true' : 'false'}`);
  console.log(`[anti-oreo-v2-gate] report=${stamped}`);
  if (!report.pass) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[anti-oreo-v2-gate] FAIL ${message}`);
  process.exitCode = 1;
});
