import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

type Verdict = 'PASS' | 'FAIL';

interface SyscallEnvelopeCheck {
  ok: boolean;
  mutexViolation: boolean;
}

interface Evaluation {
  totalSamples: number;
  validSamples: number;
  mutexViolations: number;
  validJsonRate: number;
  mutexViolationRate: number;
  pass: boolean;
}

interface CliArgs {
  input: string;
  source: string;
  minSamples: number;
  minValidJsonRate: number;
  maxMutexViolationRate: number;
}

const ROOT = path.resolve(process.cwd());
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'local_alu');
const LATEST_FILE = path.join(AUDIT_DIR, 'ac41b_latest.json');

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
  let input = '';
  let source = 'unknown';
  let minSamples = 1000;
  let minValidJsonRate = 0.999;
  let maxMutexViolationRate = 0;

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      continue;
    }
    if (key === '--input') {
      input = path.resolve(value);
    }
    if (key === '--source') {
      source = value;
    }
    if (key === '--min-samples') {
      minSamples = Number.parseInt(value, 10);
    }
    if (key === '--min-valid-json-rate') {
      minValidJsonRate = Number.parseFloat(value);
    }
    if (key === '--max-mutex-violation-rate') {
      maxMutexViolationRate = Number.parseFloat(value);
    }
  }

  if (!input) {
    throw new Error('Missing required arg: --input <responses.jsonl>');
  }

  if (!Number.isFinite(minSamples) || minSamples <= 0) {
    throw new Error(`Invalid --min-samples: ${minSamples}`);
  }
  if (!Number.isFinite(minValidJsonRate) || minValidJsonRate < 0 || minValidJsonRate > 1) {
    throw new Error(`Invalid --min-valid-json-rate: ${minValidJsonRate}`);
  }
  if (!Number.isFinite(maxMutexViolationRate) || maxMutexViolationRate < 0 || maxMutexViolationRate > 1) {
    throw new Error(`Invalid --max-mutex-violation-rate: ${maxMutexViolationRate}`);
  }

  return {
    input,
    source,
    minSamples,
    minValidJsonRate,
    maxMutexViolationRate,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateSyscallEnvelope(syscall: Record<string, unknown>): SyscallEnvelopeCheck {
  const op = typeof syscall.op === 'string' ? syscall.op : '';
  if (!op) {
    return { ok: false, mutexViolation: false };
  }

  const keys = Object.keys(syscall);
  const allowOnly = (allowed: string[]): SyscallEnvelopeCheck => {
    const extras = keys.filter((k) => !allowed.includes(k));
    if (extras.length > 0) {
      return { ok: false, mutexViolation: true };
    }
    return { ok: true, mutexViolation: false };
  };

  if (op === 'SYS_WRITE') {
    const envelope = allowOnly(['op', 'payload', 'semantic_cap']);
    if (!envelope.ok) {
      return envelope;
    }
    if (typeof syscall.payload !== 'string') {
      return { ok: false, mutexViolation: false };
    }
    if (syscall.semantic_cap !== undefined && typeof syscall.semantic_cap !== 'string') {
      return { ok: false, mutexViolation: false };
    }
    return envelope;
  }

  if (op === 'SYS_GOTO') {
    const envelope = allowOnly(['op', 'pointer']);
    if (!envelope.ok) {
      return envelope;
    }
    return typeof syscall.pointer === 'string' ? envelope : { ok: false, mutexViolation: false };
  }

  if (op === 'SYS_EXEC') {
    const envelope = allowOnly(['op', 'cmd']);
    if (!envelope.ok) {
      return envelope;
    }
    return typeof syscall.cmd === 'string' ? envelope : { ok: false, mutexViolation: false };
  }

  if (op === 'SYS_GIT_LOG') {
    const envelope = allowOnly(['op', 'query_params', 'path', 'limit', 'ref', 'grep', 'since']);
    if (!envelope.ok) {
      return envelope;
    }
    if (syscall.query_params !== undefined && typeof syscall.query_params !== 'string') {
      return { ok: false, mutexViolation: false };
    }
    if (syscall.path !== undefined && typeof syscall.path !== 'string') {
      return { ok: false, mutexViolation: false };
    }
    if (syscall.ref !== undefined && typeof syscall.ref !== 'string') {
      return { ok: false, mutexViolation: false };
    }
    if (syscall.grep !== undefined && typeof syscall.grep !== 'string') {
      return { ok: false, mutexViolation: false };
    }
    if (syscall.since !== undefined && typeof syscall.since !== 'string') {
      return { ok: false, mutexViolation: false };
    }
    if (syscall.limit !== undefined) {
      const limit =
        typeof syscall.limit === 'number'
          ? syscall.limit
          : typeof syscall.limit === 'string'
            ? Number.parseInt(syscall.limit, 10)
            : Number.NaN;
      if (!Number.isFinite(limit) || limit <= 0) {
        return { ok: false, mutexViolation: false };
      }
    }
    return envelope;
  }

  if (op === 'SYS_PUSH') {
    const envelope = allowOnly(['op', 'task']);
    if (!envelope.ok) {
      return envelope;
    }
    return typeof syscall.task === 'string' ? envelope : { ok: false, mutexViolation: false };
  }

  if (op === 'SYS_EDIT') {
    const envelope = allowOnly(['op', 'task']);
    if (!envelope.ok) {
      return envelope;
    }
    return typeof syscall.task === 'string' ? envelope : { ok: false, mutexViolation: false };
  }

  if (op === 'SYS_POP' || op === 'SYS_HALT') {
    return allowOnly(['op']);
  }

  return { ok: false, mutexViolation: false };
}

function extractTransitionCandidate(parsed: unknown): Record<string, unknown> | null {
  if (!isRecord(parsed)) {
    return null;
  }

  if (isRecord(parsed.a_t) && typeof parsed.q_next === 'string') {
    return parsed;
  }

  const output = parsed.output;
  const raw = parsed.raw;
  const embedded = typeof output === 'string' ? output : typeof raw === 'string' ? raw : null;
  if (!embedded) {
    return null;
  }

  try {
    const nested = JSON.parse(embedded) as unknown;
    if (isRecord(nested) && isRecord(nested.a_t) && typeof nested.q_next === 'string') {
      return nested;
    }
    return null;
  } catch {
    return null;
  }
}

function evaluate(lines: string[], minSamples: number, minValidJsonRate: number, maxMutexViolationRate: number): Evaluation {
  let totalSamples = 0;
  let validSamples = 0;
  let mutexViolations = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    totalSamples += 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const candidate = extractTransitionCandidate(parsed);
    if (!candidate) {
      continue;
    }

    const syscall = candidate.a_t as Record<string, unknown>;
    const syscallCheck = validateSyscallEnvelope(syscall);
    if (syscallCheck.mutexViolation) {
      mutexViolations += 1;
      continue;
    }
    if (!syscallCheck.ok) {
      continue;
    }

    validSamples += 1;
  }

  const safeTotal = Math.max(1, totalSamples);
  const validJsonRate = validSamples / safeTotal;
  const mutexViolationRate = mutexViolations / safeTotal;
  const pass =
    totalSamples >= minSamples &&
    validJsonRate >= minValidJsonRate &&
    mutexViolationRate <= maxMutexViolationRate;

  return {
    totalSamples,
    validSamples,
    mutexViolations,
    validJsonRate,
    mutexViolationRate,
    pass,
  };
}

function toMarkdown(
  stamp: string,
  source: string,
  input: string,
  verdict: Verdict,
  evaluation: Evaluation,
  thresholds: { minSamples: number; minValidJsonRate: number; maxMutexViolationRate: number }
): string {
  return [
    '# AC4.1b Local ALU Gate Report',
    '',
    `- stamp: ${stamp}`,
    `- source: ${source}`,
    `- input: ${input}`,
    `- verdict: ${verdict}`,
    '',
    '## Metrics',
    '',
    `- totalSamples: ${evaluation.totalSamples}`,
    `- validSamples: ${evaluation.validSamples}`,
    `- mutexViolations: ${evaluation.mutexViolations}`,
    `- validJsonRate: ${evaluation.validJsonRate}`,
    `- mutexViolationRate: ${evaluation.mutexViolationRate}`,
    '',
    '## Thresholds',
    '',
    `- minSamples: ${thresholds.minSamples}`,
    `- minValidJsonRate: ${thresholds.minValidJsonRate}`,
    `- maxMutexViolationRate: ${thresholds.maxMutexViolationRate}`,
    '',
    '## Result',
    '',
    verdict === 'PASS'
      ? '- localAluReady=true'
      : '- localAluReady=false',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.input)) {
    throw new Error(`Input not found: ${args.input}`);
  }

  const raw = await fsp.readFile(args.input, 'utf-8');
  const lines = raw.split('\n');
  const evaluation = evaluate(lines, args.minSamples, args.minValidJsonRate, args.maxMutexViolationRate);

  await fsp.mkdir(AUDIT_DIR, { recursive: true });
  const stamp = timestamp();
  const verdict: Verdict = evaluation.pass ? 'PASS' : 'FAIL';
  const reportJsonPath = path.join(AUDIT_DIR, `ac41b_${stamp}.json`);
  const reportMdPath = path.join(AUDIT_DIR, `ac41b_${stamp}.md`);

  const payload = {
    stamp,
    source: args.source,
    input: args.input,
    totalSamples: evaluation.totalSamples,
    validSamples: evaluation.validSamples,
    mutexViolations: evaluation.mutexViolations,
    validJsonRate: evaluation.validJsonRate,
    mutexViolationRate: evaluation.mutexViolationRate,
    minSamples: args.minSamples,
    minValidJsonRate: args.minValidJsonRate,
    maxMutexViolationRate: args.maxMutexViolationRate,
    pass: evaluation.pass,
    reportJsonPath,
    reportMdPath,
    generatedAt: new Date().toISOString(),
  };

  await fsp.writeFile(reportJsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  await fsp.writeFile(
    reportMdPath,
    `${toMarkdown(stamp, args.source, args.input, verdict, evaluation, {
      minSamples: args.minSamples,
      minValidJsonRate: args.minValidJsonRate,
      maxMutexViolationRate: args.maxMutexViolationRate,
    })}`,
    'utf-8'
  );
  await fsp.writeFile(LATEST_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');

  console.log(`[ac41b-local-alu] verdict=${verdict} reportJson=${reportJsonPath} reportMd=${reportMdPath}`);
  process.exit(evaluation.pass ? 0 : 2);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ac41b-local-alu] fatal: ${message}`);
  process.exit(1);
});
