import fsp from 'node:fs/promises';
import path from 'node:path';
import { buildSyscallAdversarialFixtures, SyscallFixtureCase } from './fixtures/syscall-adversarial.js';
import {
  normalizeModelSyscall,
  SYSCALL_OPCODE_PIPE,
  SYSCALL_OPCODES,
  validateCanonicalSyscallEnvelope,
} from '../kernel/syscall-schema.js';

interface FixtureFailure {
  id: string;
  reason: string;
}

interface GateReport {
  stamp: string;
  opcodes: readonly string[];
  opcodePipe: string;
  validFixtures: number;
  invalidFixtures: number;
  validAccepted: number;
  invalidRejected: number;
  mutexExpected: number;
  mutexRejected: number;
  pass: boolean;
  failures: FixtureFailure[];
}

const ROOT = path.resolve(process.cwd());
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'protocol');

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

function addFailure(failures: FixtureFailure[], fixture: SyscallFixtureCase, reason: string): void {
  failures.push({
    id: fixture.id,
    reason,
  });
}

function reportMarkdown(report: GateReport): string {
  return [
    '# Syscall Schema Gate',
    '',
    `- stamp: ${report.stamp}`,
    `- opcodes: ${report.opcodes.join(', ')}`,
    `- opcodePipe: ${report.opcodePipe}`,
    `- validFixtures: ${report.validFixtures}`,
    `- invalidFixtures: ${report.invalidFixtures}`,
    `- validAccepted: ${report.validAccepted}`,
    `- invalidRejected: ${report.invalidRejected}`,
    `- mutexExpected: ${report.mutexExpected}`,
    `- mutexRejected: ${report.mutexRejected}`,
    `- pass: ${report.pass}`,
    '',
    '## Failures',
    report.failures.length > 0
      ? report.failures.map((failure) => `- ${failure.id}: ${failure.reason}`).join('\n')
      : '- (none)',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const fixtures = buildSyscallAdversarialFixtures();
  const failures: FixtureFailure[] = [];
  const stamp = timestamp();

  let validAccepted = 0;
  for (const fixture of fixtures.valid) {
    const parsed = normalizeModelSyscall(fixture.input);
    if (!parsed.ok) {
      addFailure(failures, fixture, `expected ACCEPT but rejected: ${parsed.reason}`);
      continue;
    }

    const canonicalViolation = validateCanonicalSyscallEnvelope(parsed.syscall);
    if (canonicalViolation) {
      addFailure(
        failures,
        fixture,
        `expected canonical syscall envelope after normalization, got: ${canonicalViolation}`
      );
      continue;
    }

    validAccepted += 1;
  }

  let invalidRejected = 0;
  let mutexExpected = 0;
  let mutexRejected = 0;
  for (const fixture of fixtures.invalid) {
    const parsed = normalizeModelSyscall(fixture.input);
    if (parsed.ok) {
      addFailure(failures, fixture, `expected REJECT but accepted: ${JSON.stringify(parsed.syscall)}`);
      continue;
    }

    invalidRejected += 1;
    if (fixture.expectMutex) {
      mutexExpected += 1;
      if (parsed.reason.includes('MUTEX_VIOLATION')) {
        mutexRejected += 1;
      } else {
        addFailure(
          failures,
          fixture,
          `expected MUTEX_VIOLATION for unknown key rejection, got: ${parsed.reason}`
        );
      }
    }
  }

  if (fixtures.invalid.length < 50) {
    failures.push({
      id: 'gate_invalid_fixture_cardinality',
      reason: `expected at least 50 malformed fixtures, got ${fixtures.invalid.length}`,
    });
  }

  const report: GateReport = {
    stamp,
    opcodes: SYSCALL_OPCODES,
    opcodePipe: SYSCALL_OPCODE_PIPE,
    validFixtures: fixtures.valid.length,
    invalidFixtures: fixtures.invalid.length,
    validAccepted,
    invalidRejected,
    mutexExpected,
    mutexRejected,
    pass: failures.length === 0,
    failures,
  };

  await fsp.mkdir(AUDIT_DIR, { recursive: true });
  const reportJsonPath = path.join(AUDIT_DIR, `syscall_schema_gate_${stamp}.json`);
  const reportMdPath = path.join(AUDIT_DIR, `syscall_schema_gate_${stamp}.md`);
  const latestJsonPath = path.join(AUDIT_DIR, 'syscall_schema_gate_latest.json');
  const latestMdPath = path.join(AUDIT_DIR, 'syscall_schema_gate_latest.md');

  await fsp.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fsp.writeFile(reportMdPath, reportMarkdown(report), 'utf-8');
  await fsp.writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fsp.writeFile(latestMdPath, reportMarkdown(report), 'utf-8');

  console.log(`[schema-gate] opcodes=${SYSCALL_OPCODE_PIPE}`);
  console.log(`[schema-gate] valid=${validAccepted}/${fixtures.valid.length}`);
  console.log(`[schema-gate] invalid=${invalidRejected}/${fixtures.invalid.length}`);
  console.log(`[schema-gate] mutex=${mutexRejected}/${mutexExpected}`);
  console.log(`[schema-gate] report=${reportJsonPath}`);

  if (!report.pass) {
    console.error('[schema-gate] FAIL');
    for (const failure of failures) {
      console.error(`- ${failure.id}: ${failure.reason}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('[schema-gate] PASS');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[schema-gate] fatal: ${message}`);
  process.exitCode = 1;
});
