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
  rejected: number
): number {
  if (golden <= 0 || failureRecovery <= 0 || rejected <= 0) {
    return 0;
  }
  const byGolden = Math.floor(golden / 0.4);
  const byFailure = Math.floor(failureRecovery / 0.4);
  const byRejected = Math.floor(rejected / 0.2);
  return Math.max(0, Math.min(byGolden, byFailure, byRejected));
}

async function main(): Promise<void> {
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

  const proposedTotal = computeProposedTotal(goldenRows, failureRecoveryRows, rejectedRows);
  const proposedGolden = Math.floor(proposedTotal * 0.4);
  const proposedFailure = Math.floor(proposedTotal * 0.4);
  const proposedRejected = proposedTotal - proposedGolden - proposedFailure;

  const notes: string[] = [];
  if (proposedTotal === 0) {
    notes.push('Cannot satisfy 40/40/20 mix with current rejected candidate pool.');
  }
  if (rejectedRows < Math.ceil((policyRows.length + reflexRows.length) * 0.2)) {
    notes.push('Rejected candidates are relatively scarce; consider mining more trap-halt or invalid-output traces.');
  }

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
      golden: 0.4,
      failureRecovery: 0.4,
      rejected: 0.2,
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
    `[failure-recovery-dataset-stats] proposed_total=${proposedTotal} mix=${proposedGolden}/${proposedFailure}/${proposedRejected}`
  );
}

void main();
