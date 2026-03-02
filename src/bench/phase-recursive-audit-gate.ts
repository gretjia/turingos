import fs from 'node:fs/promises';
import path from 'node:path';

type PhaseId = 'P0' | 'P1' | 'P2' | 'P3';
type PhaseStatus = 'LOCKED' | 'PASS' | 'FAIL';

interface GateAttempt {
  ts: string;
  phase: PhaseId;
  codexPass: boolean;
  geminiPass: boolean;
  status: Exclude<PhaseStatus, 'LOCKED'>;
  codexEvidence?: string;
  geminiEvidence?: string;
  note?: string;
}

interface GateState {
  updatedAt: string;
  currentPhase: PhaseId | null;
  phases: Record<PhaseId, PhaseStatus>;
  history: GateAttempt[];
}

const PHASE_ORDER: PhaseId[] = ['P0', 'P1', 'P2', 'P3'];
const ROOT = path.resolve(process.cwd());
const OUT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'phase_gate');

function stamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function parseBoolFlag(raw: string | undefined): boolean {
  if (!raw) {
    return false;
  }
  return /^(1|true|yes|y|pass)$/i.test(raw.trim());
}

function parseArgs(argv: string[]): {
  phase: PhaseId;
  codexPass: boolean;
  geminiPass: boolean;
  codexEvidence?: string;
  geminiEvidence?: string;
  note?: string;
} {
  const getValue = (name: string): string | undefined => {
    const idx = argv.indexOf(name);
    if (idx < 0 || idx + 1 >= argv.length) {
      return undefined;
    }
    return argv[idx + 1];
  };

  const phaseRaw = (getValue('--phase') ?? '').trim().toUpperCase();
  if (!PHASE_ORDER.includes(phaseRaw as PhaseId)) {
    throw new Error('Missing or invalid --phase. Allowed: P0|P1|P2|P3');
  }

  const codexPassRaw = getValue('--codex-pass');
  const geminiPassRaw = getValue('--gemini-pass');
  if (!codexPassRaw || !geminiPassRaw) {
    throw new Error('Both --codex-pass and --gemini-pass are required (yes/no).');
  }

  return {
    phase: phaseRaw as PhaseId,
    codexPass: parseBoolFlag(codexPassRaw),
    geminiPass: parseBoolFlag(geminiPassRaw),
    codexEvidence: getValue('--codex-evidence'),
    geminiEvidence: getValue('--gemini-evidence'),
    note: getValue('--note'),
  };
}

function initialState(): GateState {
  return {
    updatedAt: new Date().toISOString(),
    currentPhase: null,
    phases: {
      P0: 'LOCKED',
      P1: 'LOCKED',
      P2: 'LOCKED',
      P3: 'LOCKED',
    },
    history: [],
  };
}

async function loadState(latestPath: string): Promise<GateState> {
  try {
    const raw = await fs.readFile(latestPath, 'utf-8');
    const parsed = JSON.parse(raw) as GateState;
    if (!parsed || typeof parsed !== 'object') {
      return initialState();
    }
    if (!parsed.phases || !parsed.history) {
      return initialState();
    }
    return parsed;
  } catch {
    return initialState();
  }
}

function assertNoPhaseSkip(state: GateState, phase: PhaseId): void {
  const currentIndex = PHASE_ORDER.indexOf(phase);
  for (let i = 0; i < currentIndex; i += 1) {
    const prev = PHASE_ORDER[i];
    if (state.phases[prev] !== 'PASS') {
      throw new Error(`Phase gate blocked: ${phase} requires ${prev}=PASS (current=${state.phases[prev]}).`);
    }
  }
}

function freezeDownstream(state: GateState, phase: PhaseId): void {
  const currentIndex = PHASE_ORDER.indexOf(phase);
  for (let i = currentIndex + 1; i < PHASE_ORDER.length; i += 1) {
    const next = PHASE_ORDER[i];
    if (state.phases[next] !== 'PASS') {
      state.phases[next] = 'LOCKED';
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(OUT_DIR, { recursive: true });

  const latestJson = path.join(OUT_DIR, 'recursive_phase_gate_latest.json');
  const state = await loadState(latestJson);
  assertNoPhaseSkip(state, args.phase);

  const attemptStatus: Exclude<PhaseStatus, 'LOCKED'> =
    args.codexPass && args.geminiPass ? 'PASS' : 'FAIL';
  const attempt: GateAttempt = {
    ts: new Date().toISOString(),
    phase: args.phase,
    codexPass: args.codexPass,
    geminiPass: args.geminiPass,
    status: attemptStatus,
    ...(args.codexEvidence ? { codexEvidence: args.codexEvidence } : {}),
    ...(args.geminiEvidence ? { geminiEvidence: args.geminiEvidence } : {}),
    ...(args.note ? { note: args.note } : {}),
  };

  state.history.push(attempt);
  state.phases[args.phase] = attemptStatus;
  state.currentPhase = attemptStatus === 'PASS' ? args.phase : state.currentPhase;
  freezeDownstream(state, args.phase);
  state.updatedAt = new Date().toISOString();

  const ts = stamp();
  const reportJson = path.join(OUT_DIR, `recursive_phase_gate_${ts}.json`);
  const reportMd = path.join(OUT_DIR, `recursive_phase_gate_${ts}.md`);

  await fs.writeFile(reportJson, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  await fs.writeFile(latestJson, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');

  const md = [
    '# Recursive Phase Gate Report',
    '',
    `- Timestamp: ${state.updatedAt}`,
    `- Target phase: ${args.phase}`,
    `- Attempt status: ${attemptStatus}`,
    `- Codex pass: ${args.codexPass}`,
    `- Gemini pass: ${args.geminiPass}`,
    `- Latest state: ${path.relative(ROOT, latestJson)}`,
    '',
    '## Phase Status',
    ...PHASE_ORDER.map((phase) => `- ${phase}: ${state.phases[phase]}`),
    '',
    '## Latest Attempt',
    `- codex_evidence: ${args.codexEvidence ?? '(none)'}`,
    `- gemini_evidence: ${args.geminiEvidence ?? '(none)'}`,
    `- note: ${args.note ?? '(none)'}`,
    '',
    attemptStatus === 'PASS'
      ? 'Result: PASS (next phase may proceed only if all previous phases are PASS).'
      : 'Result: FAIL (next phases remain locked; remediation and recursive re-audit required).',
  ].join('\n');

  await fs.writeFile(reportMd, `${md}\n`, 'utf-8');
  await fs.copyFile(reportMd, path.join(OUT_DIR, 'recursive_phase_gate_latest.md'));

  console.log(`[phase-gate] phase=${args.phase} status=${attemptStatus}`);
  console.log(`[phase-gate] report_json=${path.relative(ROOT, reportJson)}`);
  console.log(`[phase-gate] report_md=${path.relative(ROOT, reportMd)}`);

  if (attemptStatus !== 'PASS') {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[phase-gate] fatal: ${message}`);
  process.exitCode = 1;
});
