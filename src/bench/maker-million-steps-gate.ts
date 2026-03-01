import fs from 'node:fs';
import path from 'node:path';

interface CliArgs {
  trace?: string;
  answer?: string;
}

interface GateReport {
  generatedAt: string;
  paperUrl: string;
  requiredSteps: number;
  observedSteps: number;
  reachedStepThreshold: boolean;
  answerCorrect: boolean;
  pass: boolean;
  tracePath: string | null;
  answerPath: string | null;
  notes: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      continue;
    }
    if (key === '--trace') {
      parsed.trace = value;
    }
    if (key === '--answer') {
      parsed.answer = value;
    }
  }
  return parsed;
}

function readStepCount(tracePath: string): number {
  const raw = fs.readFileSync(tracePath, 'utf8');
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length;
}

function readAnswerCorrect(answerPath: string): boolean {
  const raw = fs.readFileSync(answerPath, 'utf8').trim();
  if (raw.length === 0) {
    return false;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const directBool = parsed.final_answer_correct;
    if (typeof directBool === 'boolean') {
      return directBool;
    }
    const passBool = parsed.pass;
    if (typeof passBool === 'boolean') {
      return passBool;
    }
    const verdict = parsed.verdict;
    if (typeof verdict === 'string') {
      const normalized = verdict.trim().toUpperCase();
      return normalized === 'PASS' || normalized === 'CORRECT' || normalized === 'SUCCESS';
    }
  } catch {
    const normalized = raw.toUpperCase();
    if (normalized.includes('FINAL_ANSWER_CORRECT=true')) {
      return true;
    }
    if (normalized === 'PASS' || normalized === 'CORRECT' || normalized === 'SUCCESS') {
      return true;
    }
  }

  return false;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const requiredSteps = 1_000_000;
  const paperUrl = 'https://arxiv.org/html/2511.09030v1';
  const notes: string[] = [];

  const tracePath = args.trace ?? process.env.TURINGOS_MAKER_TRACE ?? '';
  const answerPath = args.answer ?? process.env.TURINGOS_MAKER_ANSWER ?? '';

  let observedSteps = 0;
  if (tracePath && fs.existsSync(tracePath)) {
    observedSteps = readStepCount(tracePath);
  } else {
    notes.push('Trace file missing. Provide --trace or TURINGOS_MAKER_TRACE.');
  }

  let answerCorrect = false;
  if (answerPath && fs.existsSync(answerPath)) {
    answerCorrect = readAnswerCorrect(answerPath);
  } else {
    notes.push('Answer verdict file missing. Provide --answer or TURINGOS_MAKER_ANSWER.');
  }

  const reachedStepThreshold = observedSteps >= requiredSteps;
  const pass = reachedStepThreshold && answerCorrect;
  if (!reachedStepThreshold) {
    notes.push(
      `Step threshold not met: observed=${observedSteps}, required=${requiredSteps}. Continue hardening and rerun.`
    );
  }
  if (!answerCorrect) {
    notes.push('Final answer correctness proof missing or failed.');
  }

  const report: GateReport = {
    generatedAt: new Date().toISOString(),
    paperUrl,
    requiredSteps,
    observedSteps,
    reachedStepThreshold,
    answerCorrect,
    pass,
    tracePath: tracePath || null,
    answerPath: answerPath || null,
    notes,
  };

  const stamp = report.generatedAt.replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
  const outDir = path.resolve('benchmarks/audits/final_gate');
  const stamped = path.join(outDir, `maker_1m_steps_gate_${stamp}.json`);
  const latest = path.join(outDir, 'maker_1m_steps_gate_latest.json');
  writeJson(stamped, report);
  writeJson(latest, report);

  console.log(`[maker-1m-gate] required_steps=${requiredSteps}`);
  console.log(`[maker-1m-gate] observed_steps=${observedSteps}`);
  console.log(`[maker-1m-gate] answer_correct=${answerCorrect ? 'true' : 'false'}`);
  console.log(`[maker-1m-gate] report=${stamped}`);
  console.log(`[maker-1m-gate] ${pass ? 'PASS' : 'FAIL'}`);

  if (!pass) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[maker-1m-gate] FAIL ${message}`);
  process.exitCode = 1;
});
