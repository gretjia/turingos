import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Syscall } from '../kernel/types.js';
import { LocalManifold } from '../manifold/local-manifold.js';

interface ReplayFrame {
  tick_seq?: number;
  q_t?: string;
  h_q?: string;
  d_t: string;
  observed_slice?: string;
  s_t?: string;
  h_s?: string;
  a_t: Syscall;
  q_next?: string;
  d_next?: string;
  write_target?: string;
  leaf_hash?: string;
  prev_merkle_root?: string;
  merkle_root?: string;
}

interface ReplayTupleLine {
  tick_seq?: unknown;
  q_t?: unknown;
  h_q?: unknown;
  d_t?: unknown;
  observed_slice?: unknown;
  s_t?: unknown;
  h_s?: unknown;
  a_t?: unknown;
  q_next?: unknown;
  d_next?: unknown;
  write_target?: unknown;
  leaf_hash?: unknown;
  prev_merkle_root?: unknown;
  merkle_root?: unknown;
}

interface ReplaySummary {
  trace: string;
  workspace: string;
  steps: number;
  halted: boolean;
  finalPointer: string;
  treeHash: string;
  qsHashVerified: boolean;
  merkleVerified: boolean;
  continuityVerified: boolean;
  execSnapshotFrames: number;
  lastMerkleRoot: string;
}

interface ReplayOptions {
  trace: string;
  workspace: string;
}

function parseArgs(argv: string[]): ReplayOptions {
  let trace = '';
  let workspace = '';

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      continue;
    }
    if (key === '--trace') {
      trace = path.resolve(value);
    }
    if (key === '--workspace') {
      workspace = path.resolve(value);
    }
  }

  if (!trace) {
    throw new Error('Missing required arg: --trace <trace.jsonl>');
  }
  if (!workspace) {
    throw new Error('Missing required arg: --workspace <workspace>');
  }

  return { trace, workspace };
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseReplayTuple(value: ReplayTupleLine, strict: boolean): ReplayFrame | null {
  const d_t = asString(value.d_t);
  const a_t = value.a_t as Syscall | undefined;
  if (!d_t || !a_t || typeof a_t !== 'object' || typeof (a_t as { op?: unknown }).op !== 'string') {
    return null;
  }

  const frame: ReplayFrame = {
    tick_seq: asNumber(value.tick_seq),
    q_t: asString(value.q_t),
    h_q: asString(value.h_q),
    d_t,
    observed_slice: asString(value.observed_slice),
    s_t: asString(value.s_t),
    h_s: asString(value.h_s),
    a_t,
    q_next: asString(value.q_next),
    d_next: asString(value.d_next),
    write_target: asString(value.write_target),
    leaf_hash: asString(value.leaf_hash),
    prev_merkle_root: asString(value.prev_merkle_root),
    merkle_root: asString(value.merkle_root),
  };

  if (!strict) {
    return frame;
  }

  const requiredStringFields: Array<keyof ReplayFrame> = [
    'q_t',
    'h_q',
    'observed_slice',
    's_t',
    'h_s',
    'q_next',
    'd_next',
    'leaf_hash',
    'prev_merkle_root',
    'merkle_root',
  ];
  for (const key of requiredStringFields) {
    if (typeof frame[key] !== 'string' || (frame[key] as string).length === 0) {
      throw new Error(`[TRACE_CORRUPTION] missing field "${key}" in replay tuple`);
    }
  }
  if (typeof frame.tick_seq !== 'number' || !Number.isFinite(frame.tick_seq)) {
    throw new Error('[TRACE_CORRUPTION] missing or invalid "tick_seq" in replay tuple');
  }

  return frame;
}

async function readTrace(tracePath: string): Promise<ReplayFrame[]> {
  const raw = await fsp.readFile(tracePath, 'utf-8');
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const frames: ReplayFrame[] = [];
  for (const line of lines) {
    let parsed: ReplayFrame | null = null;
    try {
      const replayMatch = line.match(/\[REPLAY_TUPLE\]\s*(\{.*\})$/);
      if (replayMatch?.[1]) {
        const tuple = JSON.parse(replayMatch[1]) as ReplayTupleLine;
        parsed = parseReplayTuple(tuple, true);
      } else if (line.startsWith('{')) {
        const tuple = JSON.parse(line) as ReplayTupleLine;
        parsed = parseReplayTuple(tuple, false);
      }
    } catch {
      parsed = null;
    }

    if (!parsed) {
      continue;
    }
    frames.push(parsed);
  }

  if (frames.length === 0) {
    throw new Error(`No replay frames found in trace: ${tracePath}`);
  }

  return frames;
}

async function ensureWorkspace(workspace: string): Promise<void> {
  await fsp.mkdir(workspace, { recursive: true });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function computeNextPointer(pointer: string, syscall: Syscall): string {
  switch (syscall.op) {
    case 'SYS_WRITE':
      return pointer;
    case 'SYS_GOTO':
      return syscall.pointer;
    case 'SYS_EXEC': {
      const command = syscall.cmd.trim();
      return command.startsWith('$') ? command : `$ ${command}`;
    }
    case 'SYS_PUSH':
    case 'SYS_POP':
      return pointer;
    case 'SYS_HALT':
      return 'HALT';
    default: {
      const exhaustiveCheck: never = syscall;
      throw new Error(`Unsupported syscall in replay trace: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

function buildReplayPayloadForMerkle(frame: ReplayFrame): Record<string, unknown> {
  return {
    tick_seq: frame.tick_seq,
    q_t: frame.q_t,
    h_q: frame.h_q,
    d_t: frame.d_t,
    observed_slice: frame.observed_slice,
    s_t: frame.s_t,
    h_s: frame.h_s,
    a_t: frame.a_t,
    q_next: frame.q_next,
    d_next: frame.d_next,
    write_target: frame.write_target,
  };
}

function verifyFrameHashes(frame: ReplayFrame, index: number): void {
  if (frame.h_q !== undefined) {
    if (typeof frame.q_t !== 'string') {
      throw new Error(`[DIVERGENCE] tick=${index} missing q_t for h_q verification.`);
    }
    const computed = sha256(frame.q_t);
    if (computed !== frame.h_q) {
      throw new Error(`[DIVERGENCE] tick=${index} h_q mismatch expected=${frame.h_q} got=${computed}`);
    }
  }

  if (frame.h_s !== undefined) {
    if (typeof frame.s_t !== 'string') {
      throw new Error(`[DIVERGENCE] tick=${index} missing s_t for h_s verification.`);
    }
    const computed = sha256(frame.s_t);
    if (computed !== frame.h_s) {
      throw new Error(`[DIVERGENCE] tick=${index} h_s mismatch expected=${frame.h_s} got=${computed}`);
    }
  }
}

function verifyMerkleChain(frame: ReplayFrame, index: number, prevMerkleRoot: string): string {
  if (!frame.leaf_hash && !frame.merkle_root && !frame.prev_merkle_root) {
    return prevMerkleRoot;
  }

  const payloadHash = sha256(JSON.stringify(buildReplayPayloadForMerkle(frame)));
  if (frame.leaf_hash && frame.leaf_hash !== payloadHash) {
    throw new Error(`[DIVERGENCE] tick=${index} leaf_hash mismatch expected=${frame.leaf_hash} got=${payloadHash}`);
  }

  const expectedPrev = frame.prev_merkle_root ?? prevMerkleRoot;
  if (expectedPrev !== prevMerkleRoot) {
    throw new Error(
      `[DIVERGENCE] tick=${index} prev_merkle_root mismatch expected=${prevMerkleRoot} got=${expectedPrev}`
    );
  }

  const computedMerkle = sha256(`${expectedPrev}\n${payloadHash}`);
  if (frame.merkle_root && frame.merkle_root !== computedMerkle) {
    throw new Error(
      `[DIVERGENCE] tick=${index} merkle_root mismatch expected=${frame.merkle_root} got=${computedMerkle}`
    );
  }

  return frame.merkle_root ?? computedMerkle;
}

async function applyFrame(manifold: LocalManifold, frame: ReplayFrame): Promise<string> {
  const pointer = frame.d_t.trim();
  const syscall = frame.a_t;

  switch (syscall.op) {
    case 'SYS_WRITE': {
      const target =
        typeof syscall.semantic_cap === 'string' && syscall.semantic_cap.trim().length > 0
          ? syscall.semantic_cap.trim()
          : pointer;
      await manifold.interfere(target, syscall.payload);
      return pointer;
    }
    case 'SYS_GOTO':
      return syscall.pointer;
    case 'SYS_EXEC': {
      // Offline deterministic replay: do not execute host commands.
      const command = syscall.cmd.trim();
      const execPointer = command.startsWith('$') ? command : `$ ${command}`;
      return execPointer;
    }
    case 'SYS_PUSH':
      await manifold.interfere('sys://callstack', `PUSH: ${syscall.task}`);
      return pointer;
    case 'SYS_POP':
      await manifold.interfere('sys://callstack', 'POP');
      return pointer;
    case 'SYS_HALT':
      return 'HALT';
    default: {
      const exhaustiveCheck: never = syscall;
      throw new Error(`Unsupported syscall in replay trace: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
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

async function computeTreeHash(workspace: string): Promise<string> {
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

export async function runReplay(options: ReplayOptions): Promise<ReplaySummary> {
  await ensureWorkspace(options.workspace);
  const manifold = new LocalManifold(options.workspace);
  const frames = await readTrace(options.trace);

  let halted = false;
  let pointer = 'MAIN_TAPE.md';
  let steps = 0;
  let expectedPointer: string | null = null;
  let expectedQ: string | null = null;
  let prevMerkleRoot = 'GENESIS';
  let qsHashVerified = true;
  let merkleVerified = true;
  let continuityVerified = true;
  let execSnapshotFrames = 0;

  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i];

    if (expectedPointer !== null && frame.d_t !== expectedPointer) {
      continuityVerified = false;
      throw new Error(`[DIVERGENCE] tick=${i} d_t mismatch expected=${expectedPointer} got=${frame.d_t}`);
    }

    if (expectedQ !== null && typeof frame.q_t === 'string' && frame.q_t !== expectedQ) {
      continuityVerified = false;
      throw new Error(`[DIVERGENCE] tick=${i} q_t mismatch expected=${expectedQ} got=${frame.q_t}`);
    }

    try {
      verifyFrameHashes(frame, i);
    } catch (error) {
      qsHashVerified = false;
      throw error;
    }

    try {
      prevMerkleRoot = verifyMerkleChain(frame, i, prevMerkleRoot);
    } catch (error) {
      merkleVerified = false;
      throw error;
    }

    if (frame.d_t.trim().startsWith('$')) {
      const hasSnapshot =
        (typeof frame.observed_slice === 'string' && frame.observed_slice.length > 0) ||
        (typeof frame.s_t === 'string' && frame.s_t.length > 0);
      if (!hasSnapshot) {
        throw new Error(`[DIVERGENCE] tick=${i} missing command snapshot for ${frame.d_t}`);
      }
      execSnapshotFrames += 1;
    }

    pointer = await applyFrame(manifold, frame);
    const expectedFromAction = computeNextPointer(frame.d_t, frame.a_t);
    if (frame.d_next && frame.d_next !== expectedFromAction) {
      continuityVerified = false;
      throw new Error(
        `[DIVERGENCE] tick=${i} d_next mismatch expected=${expectedFromAction} got=${frame.d_next}`
      );
    }

    expectedPointer = frame.d_next ?? expectedFromAction;
    expectedQ = typeof frame.q_next === 'string' ? frame.q_next : null;
    steps += 1;

    if (expectedPointer === 'HALT' || frame.a_t.op === 'SYS_HALT') {
      halted = true;
      pointer = 'HALT';
      break;
    }
  }

  const treeHash = await computeTreeHash(options.workspace);
  return {
    trace: options.trace,
    workspace: options.workspace,
    steps,
    halted,
    finalPointer: pointer,
    treeHash,
    qsHashVerified,
    merkleVerified,
    continuityVerified,
    execSnapshotFrames,
    lastMerkleRoot: prevMerkleRoot,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const summary = await runReplay(options);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[replay-runner] fatal: ${message}`);
  process.exitCode = 1;
});
