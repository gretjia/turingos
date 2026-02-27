import fs from 'node:fs/promises';
import path from 'node:path';

interface DatasetSummary {
  stamp: string;
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
  };
}

interface ReflexRow {
  meta?: {
    source_trace?: string;
  };
}

interface StatsReport {
  generatedAt: string;
  source: {
    datasetSummary: string;
    policyInput: string;
    reflexInput: string;
  };
  available: {
    policyRows: number;
    reflexRows: number;
    goldenRows: number;
    failureRecoveryRows: number;
    rejectedRows: number;
  };
  targetMix: {
    golden: number;
    failureRecovery: number;
    rejected: number;
  };
  proposedSample: {
    totalRows: number;
    goldenRows: number;
    failureRecoveryRows: number;
    rejectedRows: number;
  };
  notes: string[];
}

const ROOT = path.resolve(process.cwd());
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'sft');
const SUMMARY_PATH = path.join(AUDIT_DIR, 'guard_sft_dataset_latest.json');

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

function stampDate(now = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
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

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function computeProposedTotal(
  golden: number,
  failureRecovery: number,
  rejected: number,
  targetMix: {
    golden: number;
    failure: number;
    rejected: number;
  }
): number {
  if (golden <= 0 || failureRecovery <= 0 || rejected <= 0) {
    return 0;
  }
  const byGolden = Math.floor(golden / targetMix.golden);
  const byFailure = Math.floor(failureRecovery / targetMix.failure);
  const byRejected = Math.floor(rejected / targetMix.rejected);
  return Math.max(0, Math.min(byGolden, byFailure, byRejected));
}

async function main(): Promise<void> {
  const targetMix = normalizeRatios(
    parseRatioEnv('TURINGOS_SFT_RATIO_GOLDEN', 0.15),
    parseRatioEnv('TURINGOS_SFT_RATIO_FAILURE', 0.65),
    parseRatioEnv('TURINGOS_SFT_RATIO_REJECTED', 0.2)
  );

  const summary = await readJson<DatasetSummary>(SUMMARY_PATH);
  const policyRows = await readJsonl<PolicyRow>(summary.policyOutput);
  const reflexRows = await readJsonl<ReflexRow>(summary.reflexOutput);

  const goldenRows = policyRows.filter((row) => {
    const src = row.meta?.source_trace ?? '';
    return src.includes('/golden_traces/');
  }).length;

  const failureRecoveryPolicyRows = policyRows.filter((row) => {
    const src = row.meta?.source_trace ?? '';
    const s_t = row.input?.s_t ?? '';
    return (
      includesAny(src, ['/guard_analytics/', '/os-longrun/']) ||
      s_t.includes('[OS_TRAP') ||
      s_t.includes('[TRAP_FRAME]')
    );
  }).length;
  const failureRecoveryRows = failureRecoveryPolicyRows + reflexRows.length;

  const rejectedRows = policyRows.filter((row) => {
    const s_t = row.input?.s_t ?? '';
    const op = row.output?.a_t?.op ?? '';
    const inTrapContext = s_t.includes('[OS_TRAP') || s_t.includes('[TRAP_FRAME]');
    return inTrapContext && op === 'SYS_HALT';
  }).length;

  const proposedTotal = computeProposedTotal(goldenRows, failureRecoveryRows, rejectedRows, targetMix);
  const proposedGolden = Math.floor(proposedTotal * targetMix.golden);
  const proposedFailure = Math.floor(proposedTotal * targetMix.failure);
  const proposedRejected = proposedTotal - proposedGolden - proposedFailure;

  const notes: string[] = [];
  if (proposedTotal === 0) {
    notes.push('Cannot satisfy 40/40/20 mix with current rejected candidate pool.');
  }
  if (rejectedRows < Math.ceil((policyRows.length + reflexRows.length) * targetMix.rejected)) {
    notes.push('Rejected candidates are relatively scarce; consider mining more trap-halt or invalid-output traces.');
  }
  notes.push(
    `Target mix ratios (golden/failure/rejected) = ${targetMix.golden.toFixed(4)}/${targetMix.failure.toFixed(4)}/${targetMix.rejected.toFixed(4)}`
  );

  const report: StatsReport = {
    generatedAt: new Date().toISOString(),
    source: {
      datasetSummary: SUMMARY_PATH,
      policyInput: summary.policyOutput,
      reflexInput: summary.reflexOutput,
    },
    available: {
      policyRows: policyRows.length,
      reflexRows: reflexRows.length,
      goldenRows,
      failureRecoveryRows,
      rejectedRows,
    },
    targetMix: {
      golden: targetMix.golden,
      failureRecovery: targetMix.failure,
      rejected: targetMix.rejected,
    },
    proposedSample: {
      totalRows: proposedTotal,
      goldenRows: proposedGolden,
      failureRecoveryRows: proposedFailure,
      rejectedRows: proposedRejected,
    },
    notes,
  };

  const dateStamp = stampDate();
  const output = path.join(AUDIT_DIR, `failure_recovery_dataset_stats_${dateStamp}.json`);
  const latest = path.join(AUDIT_DIR, 'failure_recovery_dataset_stats_latest.json');
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(latest, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');

  console.log(`[failure-recovery-dataset-stats] output=${output}`);
  console.log(
    `[failure-recovery-dataset-stats] policy=${policyRows.length} reflex=${reflexRows.length} golden=${goldenRows} failure_recovery=${failureRecoveryRows} rejected=${rejectedRows}`
  );
  console.log(
    `[failure-recovery-dataset-stats] proposed_total=${proposedTotal} mix=${proposedGolden}/${proposedFailure}/${proposedRejected} ratios=${targetMix.golden.toFixed(4)}/${targetMix.failure.toFixed(4)}/${targetMix.rejected.toFixed(4)}`
  );
}

void main();
