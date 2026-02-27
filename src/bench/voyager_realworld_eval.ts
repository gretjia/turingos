import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileChronos } from '../chronos/file-chronos.js';
import { TuringEngine } from '../kernel/engine.js';
import { IOracle, Slice, State, Syscall, Transition } from '../kernel/types.js';
import { LocalManifold } from '../manifold/local-manifold.js';

interface ReplayTuple {
  tick_seq?: number;
  q_t?: string;
  d_t?: string;
  s_t?: string;
  a_t?: { op?: string };
  mind_ops?: Array<{ op?: string }>;
  world_op?: { op?: string } | null;
}

interface Check {
  id: string;
  pass: boolean;
  details: string;
}

interface EvalReport {
  stamp: string;
  workspace: string;
  ticksRequested: number;
  ticksObserved: number;
  replayTuples: number;
  contextStats: {
    min: number;
    max: number;
    avg: number;
    p95: number;
  };
  vliwEvidence: {
    found: boolean;
    tickSeq: number | null;
    details: string;
  };
  chaosEvidence: {
    pagedFloodDetected: boolean;
    tickSeq: number | null;
    followupAction: string;
  };
  checks: Check[];
  pass: boolean;
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

function setEnv(key: string, value: string): () => void {
  const prev = process.env[key];
  process.env[key] = value;
  return () => {
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  };
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

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}

async function createSyntheticProject(workspace: string): Promise<void> {
  const srcDir = path.join(workspace, 'src');
  await fs.mkdir(srcDir, { recursive: true });
  const totalFiles = 20;
  for (let i = 0; i < totalFiles; i += 1) {
    const next = (i + 1) % totalFiles;
    const prev = (i + totalFiles - 1) % totalFiles;
    const fileName = `mod_${String(i).padStart(2, '0')}.ts`;
    const content = [
      `import { f_${next} } from './mod_${String(next).padStart(2, '0')}';`,
      `import { f_${prev} } from './mod_${String(prev).padStart(2, '0')}';`,
      '',
      `export function f_${i}(v_${i}: number): number {`,
      `  const __z_${i} = (v_${i} + ${i}) ^ 0x${(4096 + i).toString(16)};`,
      `  if ((__z_${i} & 1) === 0) {`,
      `    return f_${next}((__z_${i} >>> 1) + 1);`,
      '  }',
      `  return (f_${prev}(1) + __z_${i}) & 0xffff;`,
      '}',
      '',
    ].join('\n');
    await fs.writeFile(path.join(srcDir, fileName), content, 'utf-8');
  }

  await fs.writeFile(
    path.join(workspace, 'MAIN_TAPE.md'),
    [
      '# Kobayashi Maru Synthetic Workspace',
      '',
      '- Objective: survive chaos and preserve O(1) context.',
      '- Verify VLIW mind_ops + world_op execution.',
      '- Navigate paged log floods via SYS_GOTO on sys://page tokens.',
      '',
    ].join('\n'),
    'utf-8'
  );
}

class VoyagerSyntheticOracle implements IOracle {
  private tick = 0;
  private totalFiles = 20;

  private frame(q_next: string, mind_ops: Syscall[], world_op: Syscall | null): Transition {
    const fallback = world_op ?? mind_ops[mind_ops.length - 1] ?? { op: 'SYS_GOTO', pointer: 'MAIN_TAPE.md' };
    return {
      q_next,
      a_t: fallback,
      mind_ops,
      world_op,
    };
  }

  public async collapse(_discipline: string, _q: State, s: Slice): Promise<Transition> {
    this.tick += 1;
    const tickTag = `voyager_tick_${this.tick}`;

    if (this.tick === 1) {
      return this.frame(
        `${tickTag}:seed_runqueue`,
        [{ op: 'SYS_PUSH', task: 'Bootstrap runqueue root task before VLIW scheduling.' }],
        { op: 'SYS_GOTO', pointer: 'MAIN_TAPE.md' }
      );
    }
    if (this.tick === 2) {
      return this.frame(
        `${tickTag}:vliw_proof_bundle`,
        [
          { op: 'SYS_EDIT', task: 'Prime VLIW proof frame for dual mind scheduling.' },
          { op: 'SYS_PUSH', task: `Capture explicit VLIW proof at tick ${this.tick}.` },
        ],
        { op: 'SYS_EXEC', cmd: `echo vliw_proof_${this.tick}; grep -R \"import\" -n src | head -n 20` }
      );
    }

    if (s.includes('[PAGE_TABLE_SUMMARY]')) {
      const nextPage = s.match(/NextPage=([^\n]+)/)?.[1]?.trim();
      if (nextPage && nextPage !== '(none)') {
        return this.frame(
          `${tickTag}:inspect_paged_output`,
          [
            { op: 'SYS_EDIT', task: 'Paged chaos output detected, inspect next page safely.' },
            { op: 'SYS_PUSH', task: `Track paged inspection branch at tick ${this.tick}.` },
          ],
          { op: 'SYS_GOTO', pointer: nextPage }
        );
      }
      return this.frame(
        `${tickTag}:grep_paged_output`,
        [{ op: 'SYS_EDIT', task: 'Fallback to grep when next page pointer is absent.' }],
        {
          op: 'SYS_EXEC',
          cmd: `echo pager_fallback_${this.tick}; grep -R \"PAGE_TABLE_SUMMARY\\|FATAL\\|ERROR\" -n . | head -n 20`,
        }
      );
    }

    const slot = this.tick % 5;
    if (slot === 1) {
      return this.frame(
        `${tickTag}:plan_and_test`,
        [
          { op: 'SYS_EDIT', task: 'Refine diagnosis and keep context compact.' },
          { op: 'SYS_PUSH', task: `Probe synthetic ring state ${this.tick}.` },
        ],
        { op: 'SYS_EXEC', cmd: `echo vliw_probe_${this.tick}; grep -R \"import\" -n src | head -n 40` }
      );
    }
    if (slot === 2) {
      const idx = this.tick % this.totalFiles;
      return this.frame(
        `${tickTag}:rotate_context`,
        [{ op: 'SYS_EDIT', task: `Rotate attention toward module ${idx}.` }],
        { op: 'SYS_GOTO', pointer: `src/mod_${String(idx).padStart(2, '0')}.ts` }
      );
    }
    if (slot === 3) {
      const idx = (this.tick + 7) % this.totalFiles;
      return this.frame(
        `${tickTag}:inspect_module`,
        [{ op: 'SYS_EDIT', task: `Inspect obfuscated module ${idx} and preserve constraints.` }],
        {
          op: 'SYS_EXEC',
          cmd: `echo module_probe_${this.tick}; sed -n '1,80p' src/mod_${String(idx).padStart(2, '0')}.ts`,
        }
      );
    }
    if (slot === 4) {
      return this.frame(
        `${tickTag}:filesystem_probe`,
        [],
        { op: 'SYS_EXEC', cmd: `echo fs_probe_${this.tick}; ls -la src | head -n 60` }
      );
    }
    return this.frame(
      `${tickTag}:stabilize`,
      [{ op: 'SYS_EDIT', task: 'Stabilize state and avoid repetitive action signatures.' }],
      { op: 'SYS_GOTO', pointer: 'MAIN_TAPE.md' }
    );
  }
}

function toMarkdown(report: EvalReport, jsonPath: string): string {
  return [
    '# Voyager Realworld Eval',
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
    `- replay_tuples: ${report.replayTuples}`,
    `- context_min: ${report.contextStats.min}`,
    `- context_max: ${report.contextStats.max}`,
    `- context_avg: ${report.contextStats.avg}`,
    `- context_p95: ${report.contextStats.p95}`,
    `- vliw_evidence: ${report.vliwEvidence.found} (tick=${report.vliwEvidence.tickSeq ?? 'n/a'})`,
    `- chaos_paged_flood: ${report.chaosEvidence.pagedFloodDetected} (tick=${report.chaosEvidence.tickSeq ?? 'n/a'})`,
    `- chaos_followup: ${report.chaosEvidence.followupAction || '(none)'}`,
    '',
    '## Checks',
    '',
    '| Check | Result | Details |',
    '|---|---|---|',
    ...report.checks.map((check) => `| ${check.id} | ${check.pass ? 'PASS' : 'FAIL'} | ${check.details} |`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  const stamp = timestamp();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'turingos-voyager-realworld-'));
  await createSyntheticProject(workspace);

  const restoreEnv = [
    setEnv('ENABLE_CHAOS', 'true'),
    setEnv('CHAOS_EXEC_TIMEOUT_RATE', '0'),
    setEnv('CHAOS_WRITE_DENY_RATE', '0'),
    setEnv('CHAOS_LOG_FLOOD_RATE', '1'),
    setEnv('CHAOS_LOG_FLOOD_CHARS', '50000'),
  ];

  try {
    const chronosPath = path.join(workspace, '.journal.log');
    const manifold = new LocalManifold(workspace, {
      timeoutMs: 60_000,
      maxSliceChars: 4096,
      enableChaos: true,
    });
    const chronos = new FileChronos(chronosPath);
    const oracle = new VoyagerSyntheticOracle();
    const engine = new TuringEngine(manifold, oracle, chronos, 'strict VLIW');

    const ticksRequested = 120;
    await engine.ignite('q_voyager_boot', 'MAIN_TAPE.md', { maxTicks: ticksRequested });

    const journalRaw = await fs.readFile(chronosPath, 'utf-8');
    const tuples = parseReplayTuples(journalRaw);
    const contextLengths = tuples.map((tuple) => (typeof tuple.s_t === 'string' ? tuple.s_t.length : 0));
    const minCtx = contextLengths.length > 0 ? Math.min(...contextLengths) : 0;
    const maxCtx = contextLengths.length > 0 ? Math.max(...contextLengths) : 0;
    const avgCtx =
      contextLengths.length > 0
        ? Number((contextLengths.reduce((acc, value) => acc + value, 0) / contextLengths.length).toFixed(2))
        : 0;
    const p95Ctx = percentile(contextLengths, 0.95);

    const vliwTuple = tuples.find((tuple) => {
      const mindOps = Array.isArray(tuple.mind_ops) ? tuple.mind_ops.map((op) => op.op) : [];
      const hasEdit = mindOps.includes('SYS_EDIT');
      const hasPush = mindOps.includes('SYS_PUSH');
      const worldOp = tuple.world_op?.op;
      return hasEdit && hasPush && worldOp === 'SYS_EXEC';
    });

    const pagedFloodTupleIndex = tuples.findIndex(
      (tuple) =>
        typeof tuple.s_t === 'string' &&
        tuple.s_t.includes('[PAGE_TABLE_SUMMARY]') &&
        tuple.s_t.includes('Source=command:')
    );
    const pagedFloodTuple = pagedFloodTupleIndex >= 0 ? tuples[pagedFloodTupleIndex] : undefined;
    const followupTuple =
      pagedFloodTupleIndex >= 0 && pagedFloodTupleIndex + 1 < tuples.length ? tuples[pagedFloodTupleIndex + 1] : undefined;
    const followupAction = followupTuple?.a_t?.op ?? '';
    const followupPass = followupAction === 'SYS_GOTO' || followupAction === 'SYS_EXEC';

    const checks: Check[] = [
      {
        id: 'ticks_observed_>=_100',
        pass: tuples.length >= 100,
        details: `ticks=${tuples.length}`,
      },
      {
        id: 'vliw_combo_edit_push_then_exec',
        pass: Boolean(vliwTuple),
        details: vliwTuple
          ? `tick_seq=${vliwTuple.tick_seq ?? 'n/a'} mind_ops=${(vliwTuple.mind_ops ?? []).map((op) => op.op).join('|')}`
          : 'missing tuple with [SYS_EDIT,SYS_PUSH] + SYS_EXEC',
      },
      {
        id: 'chaos_log_flood_detected_and_followed',
        pass: Boolean(pagedFloodTuple) && followupPass,
        details: pagedFloodTuple
          ? `flood_tick=${pagedFloodTuple.tick_seq ?? 'n/a'} followup=${followupAction || '(none)'}`
          : 'no paged command flood detected',
      },
      {
        id: 'context_o1_bound_under_4k_mmu',
        pass: maxCtx <= 5500 && p95Ctx <= 5500,
        details: `min=${minCtx} max=${maxCtx} avg=${avgCtx} p95=${p95Ctx}`,
      },
    ];

    const report: EvalReport = {
      stamp,
      workspace,
      ticksRequested,
      ticksObserved: tuples.length,
      replayTuples: tuples.length,
      contextStats: {
        min: minCtx,
        max: maxCtx,
        avg: avgCtx,
        p95: p95Ctx,
      },
      vliwEvidence: {
        found: Boolean(vliwTuple),
        tickSeq: vliwTuple?.tick_seq ?? null,
        details: vliwTuple
          ? JSON.stringify(
              {
                mind_ops: (vliwTuple.mind_ops ?? []).map((op) => op.op),
                world_op: vliwTuple.world_op?.op ?? null,
              },
              null,
              0
            )
          : '(missing)',
      },
      chaosEvidence: {
        pagedFloodDetected: Boolean(pagedFloodTuple),
        tickSeq: pagedFloodTuple?.tick_seq ?? null,
        followupAction,
      },
      checks,
      pass: checks.every((check) => check.pass),
    };

    const reportJsonPath = path.join(AUDIT_DIR, `voyager_realworld_eval_${stamp}.json`);
    const reportMdPath = path.join(AUDIT_DIR, `voyager_realworld_eval_${stamp}.md`);
    const latestJsonPath = path.join(AUDIT_DIR, 'voyager_realworld_eval_latest.json');
    const latestMdPath = path.join(AUDIT_DIR, 'voyager_realworld_eval_latest.md');

    await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
    await fs.writeFile(reportMdPath, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');
    await fs.writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
    await fs.writeFile(latestMdPath, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');

    for (const check of checks) {
      console.log(`[voyager-eval] ${check.pass ? 'PASS' : 'FAIL'} ${check.id}: ${check.details}`);
    }
    console.log(`[voyager-eval] report=${reportJsonPath}`);
    if (!report.pass) {
      console.error('[voyager-eval] FAIL');
      process.exitCode = 1;
      return;
    }
    console.log('[voyager-eval] PASS');
  } finally {
    for (const restore of restoreEnv.reverse()) {
      restore();
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[voyager-eval] fatal: ${message}`);
  process.exitCode = 1;
});
