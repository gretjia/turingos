import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Syscall } from '../kernel/types.js';
import { LocalManifold } from '../manifold/local-manifold.js';

interface ReplayFrame {
  d_t: string;
  a_t: Syscall;
}

interface ReplayTupleLine {
  d_t?: string;
  a_t?: Syscall;
}

interface ReplaySummary {
  trace: string;
  workspace: string;
  steps: number;
  halted: boolean;
  finalPointer: string;
  treeHash: string;
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

async function readTrace(tracePath: string): Promise<ReplayFrame[]> {
  const raw = await fsp.readFile(tracePath, 'utf-8');
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const frames: ReplayFrame[] = [];
  for (const line of lines) {
    let parsed: Partial<ReplayFrame> | null = null;
    try {
      const replayMatch = line.match(/\[REPLAY_TUPLE\]\s*(\{.*\})$/);
      if (replayMatch?.[1]) {
        const tuple = JSON.parse(replayMatch[1]) as ReplayTupleLine;
        parsed = {
          d_t: tuple.d_t,
          a_t: tuple.a_t,
        };
      } else if (line.startsWith('{')) {
        parsed = JSON.parse(line) as Partial<ReplayFrame>;
      }
    } catch {
      parsed = null;
    }

    if (!parsed || typeof parsed !== 'object') {
      continue;
    }
    if (typeof parsed.d_t !== 'string' || !parsed.a_t || typeof parsed.a_t !== 'object') {
      continue;
    }
    frames.push({
      d_t: parsed.d_t,
      a_t: parsed.a_t as Syscall,
    });
  }

  if (frames.length === 0) {
    throw new Error(`No replay frames found in trace: ${tracePath}`);
  }

  return frames;
}

async function ensureWorkspace(workspace: string): Promise<void> {
  await fsp.mkdir(workspace, { recursive: true });
}

function isLikelyMutatingCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  const mutatingPatterns = [
    /(^|\s)(rm|mv|cp|install|touch|chmod|chown|mkdir|rmdir|truncate|tee|dd)(\s|$)/,
    /(^|\s)git\s+(add|commit|reset|clean|checkout|restore|pull|push)(\s|$)/,
    /(^|\s)(npm|pnpm|yarn)\s+(install|add|remove|update|up|dedupe)(\s|$)/,
    /(>|>>|2>|2>>|&>|1>|1>>)/,
  ];
  return mutatingPatterns.some((pattern) => pattern.test(normalized));
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
      const command = syscall.cmd.trim();
      if (isLikelyMutatingCommand(command)) {
        throw new Error(`Offline replay blocked mutating SYS_EXEC: ${command.slice(0, 160)}`);
      }
      // Strict offline replay: never execute host commands from historical trace.
      return pointer;
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
      relative.startsWith('.reg_')
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

  for (const frame of frames) {
    pointer = await applyFrame(manifold, frame);
    steps += 1;
    if (pointer === 'HALT' || frame.a_t.op === 'SYS_HALT') {
      halted = true;
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
