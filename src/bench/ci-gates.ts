import fs from 'node:fs/promises';
import path from 'node:path';

interface AcRow {
  acId: string;
  status: string;
  details?: string;
}

interface AuditReport {
  stamp?: string;
  results?: AcRow[];
}

const REQUIRED_GATES = ['AC2.3', 'AC3.1', 'AC3.2'] as const;
const REPORT_PATTERN = /^staged_acceptance_recursive_\d{8}_\d{6}\.json$/;
const AUDIT_DIR = path.join(process.cwd(), 'benchmarks', 'audits', 'recursive');

function toAbs(filePath: string): string {
  return path.resolve(filePath);
}

async function latestReportPath(): Promise<string> {
  const entries = await fs.readdir(AUDIT_DIR, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && REPORT_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));

  if (candidates.length === 0) {
    throw new Error(`No staged acceptance JSON report found in ${AUDIT_DIR}`);
  }

  return path.join(AUDIT_DIR, candidates[0]);
}

function findGate(rows: AcRow[], acId: string): AcRow | undefined {
  return rows.find((row) => row.acId === acId);
}

async function main(): Promise<void> {
  const reportPath = await latestReportPath();
  const raw = await fs.readFile(reportPath, 'utf-8');
  const parsed = JSON.parse(raw) as AuditReport;
  const rows = Array.isArray(parsed.results) ? parsed.results : [];

  const failures: string[] = [];
  for (const acId of REQUIRED_GATES) {
    const row = findGate(rows, acId);
    if (!row) {
      failures.push(`${acId}: missing from report`);
      continue;
    }
    if (row.status !== 'PASS') {
      failures.push(`${acId}: expected PASS, got ${row.status}. details=${row.details ?? '(none)'}`);
    }
  }

  console.log(`[ci-gates] report=${toAbs(reportPath)}`);
  for (const acId of REQUIRED_GATES) {
    const row = findGate(rows, acId);
    const status = row?.status ?? 'MISSING';
    console.log(`[ci-gates] ${acId}=${status}`);
  }

  if (failures.length > 0) {
    console.error('[ci-gates] FAILED');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('[ci-gates] PASS');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[ci-gates] fatal: ${message}`);
  process.exitCode = 1;
});

