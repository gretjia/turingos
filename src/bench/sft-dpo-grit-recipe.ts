import fs from 'node:fs/promises';
import path from 'node:path';

interface DatasetSummary {
  policyOutput: string;
  reflexOutput: string;
}

interface PolicyRow {
  input?: {
    s_t?: string;
  };
  output?: {
    a_t?: {
      op?: string;
    };
  };
  meta?: {
    source_trace?: string;
    tick_seq?: number;
  };
}

interface ReflexRow {
  input?: {
    trap_frame?: {
      trap_base?: string;
      details?: string;
    };
  };
  meta?: {
    source_trace?: string;
    trap_seq?: number;
  };
}

interface CandidateRef {
  id: string;
  sourceTrace: string;
  tick: number | null;
  kind: 'golden' | 'failure_recovery' | 'rejected';
  reason: string;
}

interface DpoPair {
  id: string;
  chosen: CandidateRef;
  rejected: CandidateRef;
  rationale: string;
}

interface GritRecipeReport {
  generatedAt: string;
  source: {
    datasetSummary: string;
    policyInput: string;
    reflexInput: string;
  };
  targetMix: {
    golden: number;
    failureRecovery: number;
    rejected: number;
  };
  available: {
    golden: number;
    failureRecovery: number;
    rejected: number;
  };
  selected: {
    total: number;
    golden: number;
    failureRecovery: number;
    rejected: number;
  };
  dpoPairs: DpoPair[];
  notes: string[];
}

const ROOT = path.resolve(process.cwd());
const SFT_AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'sft');
const SUMMARY_PATH = path.join(SFT_AUDIT_DIR, 'guard_sft_dataset_latest.json');
const HANDOVER_OUTPUT = path.join(ROOT, 'handover', 'sft_dpo_grit_recipe_dataset.json');
const AUDIT_OUTPUT = path.join(SFT_AUDIT_DIR, 'sft_dpo_grit_recipe_latest.json');

function parseRatioEnv(name: string, fallback: number): number {
  const raw = (process.env[name] ?? '').trim();
  if (raw.length === 0) {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
    throw new Error(`Invalid ${name}: ${raw}. Expected a float in (0,1).`);
  }
  return parsed;
}

function normalizeRatios(golden: number, failure: number, rejected: number): {
  golden: number;
  failure: number;
  rejected: number;
} {
  const sum = golden + failure + rejected;
  if (!Number.isFinite(sum) || sum <= 0) {
    throw new Error(`Invalid ratio sum: ${sum}`);
  }
  return {
    golden: golden / sum,
    failure: failure / sum,
    rejected: rejected / sum,
  };
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

function stablePick<T>(items: T[], count: number): T[] {
  if (count <= 0) return [];
  if (items.length <= count) return [...items];
  return items.slice(0, count);
}

function computeTotal(available: { golden: number; failure: number; rejected: number }, ratios: {
  golden: number;
  failure: number;
  rejected: number;
}): number {
  if (available.golden <= 0 || available.failure <= 0 || available.rejected <= 0) {
    return 0;
  }
  const byGolden = Math.floor(available.golden / ratios.golden);
  const byFailure = Math.floor(available.failure / ratios.failure);
  const byRejected = Math.floor(available.rejected / ratios.rejected);
  return Math.max(0, Math.min(byGolden, byFailure, byRejected));
}

function toCandidateFromPolicy(row: PolicyRow, index: number, kind: CandidateRef['kind'], reason: string): CandidateRef {
  const sourceTrace = row.meta?.source_trace ?? '(unknown)';
  const tick = typeof row.meta?.tick_seq === 'number' ? row.meta.tick_seq : null;
  return {
    id: `p_${index}`,
    sourceTrace,
    tick,
    kind,
    reason,
  };
}

function toCandidateFromReflex(row: ReflexRow, index: number, reason: string): CandidateRef {
  const sourceTrace = row.meta?.source_trace ?? '(unknown)';
  const tick = typeof row.meta?.trap_seq === 'number' ? row.meta.trap_seq : null;
  return {
    id: `r_${index}`,
    sourceTrace,
    tick,
    kind: 'failure_recovery',
    reason,
  };
}

async function main(): Promise<void> {
  const ratios = normalizeRatios(
    parseRatioEnv('TURINGOS_SFT_RATIO_GOLDEN', 0.15),
    parseRatioEnv('TURINGOS_SFT_RATIO_FAILURE', 0.65),
    parseRatioEnv('TURINGOS_SFT_RATIO_REJECTED', 0.2)
  );

  const summary = await readJson<DatasetSummary>(SUMMARY_PATH);
  const policyRows = await readJsonl<PolicyRow>(summary.policyOutput);
  const reflexRows = await readJsonl<ReflexRow>(summary.reflexOutput);

  const goldenCandidates = policyRows
    .filter((row) => (row.meta?.source_trace ?? '').includes('/golden_traces/'))
    .map((row, idx) => toCandidateFromPolicy(row, idx, 'golden', 'golden_success_trace'));

  const failureFromPolicy = policyRows
    .filter((row) => {
      const src = row.meta?.source_trace ?? '';
      const s_t = row.input?.s_t ?? '';
      return (
        includesAny(src, ['/guard_analytics/', '/os-longrun/']) ||
        s_t.includes('[OS_TRAP') ||
        s_t.includes('[TRAP_FRAME]')
      );
    })
    .map((row, idx) => toCandidateFromPolicy(row, idx, 'failure_recovery', 'policy_failure_recovery'));

  const failureFromReflex = reflexRows.map((row, idx) =>
    toCandidateFromReflex(row, idx, `reflex_${row.input?.trap_frame?.trap_base ?? 'unknown_trap'}`)
  );

  const failureCandidates = [...failureFromPolicy, ...failureFromReflex];

  const rejectedCandidates = policyRows
    .filter((row) => {
      const s_t = row.input?.s_t ?? '';
      const op = row.output?.a_t?.op ?? '';
      return (s_t.includes('[OS_TRAP') || s_t.includes('[TRAP_FRAME]')) && op === 'SYS_HALT';
    })
    .map((row, idx) => toCandidateFromPolicy(row, idx, 'rejected', 'trap_context_halt_rejected'));

  const available = {
    golden: goldenCandidates.length,
    failure: failureCandidates.length,
    rejected: rejectedCandidates.length,
  };
  const total = computeTotal(available, ratios);
  const selectedGoldenCount = Math.floor(total * ratios.golden);
  const selectedFailureCount = Math.floor(total * ratios.failure);
  const selectedRejectedCount = total - selectedGoldenCount - selectedFailureCount;

  const selectedGolden = stablePick(goldenCandidates, selectedGoldenCount);
  const selectedFailure = stablePick(failureCandidates, selectedFailureCount);
  const selectedRejected = stablePick(rejectedCandidates, selectedRejectedCount);

  const dpoPairCount = Math.min(selectedFailure.length, selectedRejected.length, 100);
  const dpoPairs: DpoPair[] = [];
  for (let i = 0; i < dpoPairCount; i += 1) {
    dpoPairs.push({
      id: `dpo_${String(i + 1).padStart(3, '0')}`,
      chosen: selectedFailure[i]!,
      rejected: selectedRejected[i]!,
      rationale: 'Prefer recovery action in trap context; reject blind halt/abort behavior.',
    });
  }

  const notes: string[] = [];
  if (total === 0) {
    notes.push('Unable to satisfy target ratio with current candidate pools.');
  }
  if (selectedRejectedCount < 10) {
    notes.push('Rejected pool is small; collect more trap->halt negatives for stronger DPO contrast.');
  }
  notes.push(
    `Target ratios golden/failure/rejected=${ratios.golden.toFixed(4)}/${ratios.failure.toFixed(4)}/${ratios.rejected.toFixed(4)}`
  );

  const report: GritRecipeReport = {
    generatedAt: new Date().toISOString(),
    source: {
      datasetSummary: SUMMARY_PATH,
      policyInput: summary.policyOutput,
      reflexInput: summary.reflexOutput,
    },
    targetMix: {
      golden: ratios.golden,
      failureRecovery: ratios.failure,
      rejected: ratios.rejected,
    },
    available: {
      golden: available.golden,
      failureRecovery: available.failure,
      rejected: available.rejected,
    },
    selected: {
      total,
      golden: selectedGolden.length,
      failureRecovery: selectedFailure.length,
      rejected: selectedRejected.length,
    },
    dpoPairs,
    notes,
  };

  await fs.mkdir(path.dirname(HANDOVER_OUTPUT), { recursive: true });
  await fs.mkdir(path.dirname(AUDIT_OUTPUT), { recursive: true });
  await fs.writeFile(HANDOVER_OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(AUDIT_OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');

  console.log(`[sft-dpo-grit-recipe] output=${HANDOVER_OUTPUT}`);
  console.log(
    `[sft-dpo-grit-recipe] selected=${report.selected.total} mix=${report.selected.golden}/${report.selected.failureRecovery}/${report.selected.rejected} dpo_pairs=${report.dpoPairs.length}`
  );
}

void main();

