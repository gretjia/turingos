import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalManifold } from '../manifold/local-manifold.js';

interface Check {
  id: string;
  pass: boolean;
  details: string;
}

interface ChaosGateReport {
  stamp: string;
  pass: boolean;
  checks: Check[];
}

const ROOT = path.resolve(process.cwd());
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'longrun');

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

function withChaosEnv(overrides: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const keys = Object.keys(overrides);
  const prev = new Map<string, string | undefined>();
  for (const key of keys) {
    prev.set(key, process.env[key]);
    process.env[key] = overrides[key];
  }

  return fn().finally(() => {
    for (const key of keys) {
      const oldValue = prev.get(key);
      if (oldValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = oldValue;
      }
    }
  });
}

function toMarkdown(report: ChaosGateReport, jsonPath: string): string {
  return [
    '# Chaos Monkey Gate',
    '',
    `- stamp: ${report.stamp}`,
    `- pass: ${report.pass}`,
    `- report_json: ${jsonPath}`,
    '',
    '| Check | Result | Details |',
    '|---|---|---|',
    ...report.checks.map((check) => `| ${check.id} | ${check.pass ? 'PASS' : 'FAIL'} | ${check.details} |`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  const stamp = timestamp();
  const checks: Check[] = [];

  await withChaosEnv(
    {
      ENABLE_CHAOS: 'true',
      CHAOS_EXEC_TIMEOUT_RATE: '1',
      CHAOS_WRITE_DENY_RATE: '0',
      CHAOS_LOG_FLOOD_RATE: '0',
    },
    async () => {
      const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'turingos-chaos-timeout-'));
      const manifold = new LocalManifold(ws, { maxSliceChars: 4096, enableChaos: true });
      const slice = await manifold.observe('$ echo chaos_timeout_probe');
      const pass =
        slice.includes('[EXIT_CODE] 124') && slice.includes('[FATAL] PROCESS_TIMEOUT: Execution hanging.');
      checks.push({
        id: 'chaos_exec_timeout',
        pass,
        details: pass ? 'timeout trap injected as expected' : slice.slice(0, 240).replace(/\n/g, ' | '),
      });
    }
  );

  await withChaosEnv(
    {
      ENABLE_CHAOS: 'true',
      CHAOS_EXEC_TIMEOUT_RATE: '0',
      CHAOS_WRITE_DENY_RATE: '1',
      CHAOS_LOG_FLOOD_RATE: '0',
    },
    async () => {
      const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'turingos-chaos-write-'));
      const manifold = new LocalManifold(ws, { maxSliceChars: 4096, enableChaos: true });
      let blocked = false;
      let details = '';
      try {
        await manifold.interfere('src/out.txt', 'write_probe');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        blocked = message.includes('EACCES');
        details = message;
      }
      checks.push({
        id: 'chaos_write_eacces',
        pass: blocked,
        details: blocked ? 'write blocked with EACCES as expected' : details || 'write unexpectedly succeeded',
      });
    }
  );

  await withChaosEnv(
    {
      ENABLE_CHAOS: 'true',
      CHAOS_EXEC_TIMEOUT_RATE: '0',
      CHAOS_WRITE_DENY_RATE: '0',
      CHAOS_LOG_FLOOD_RATE: '1',
      CHAOS_LOG_FLOOD_CHARS: '50000',
    },
    async () => {
      const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'turingos-chaos-flood-'));
      const manifold = new LocalManifold(ws, { maxSliceChars: 4096, enableChaos: true });
      const summary = await manifold.observe('$ echo flood_probe');
      const token = summary.match(/Token=([a-f0-9]+)/)?.[1];
      const page2 = token ? await manifold.observe(`sys://page/${token}?p=2`) : '';
      const pass =
        summary.includes('[PAGE_TABLE_SUMMARY]') &&
        summary.includes('Source=command:echo flood_probe') &&
        page2.includes('[FOCUS_PAGE_CONTENT]');
      checks.push({
        id: 'chaos_log_flood_paged',
        pass,
        details: pass
          ? `token=${token ?? '(missing)'}`
          : `summary=${summary.slice(0, 180).replace(/\n/g, ' | ')}`,
      });
    }
  );

  for (const check of checks) {
    assert.equal(check.pass, true, `${check.id} failed: ${check.details}`);
  }

  const report: ChaosGateReport = {
    stamp,
    pass: checks.every((check) => check.pass),
    checks,
  };

  const reportJsonPath = path.join(AUDIT_DIR, `chaos_monkey_gate_${stamp}.json`);
  const reportMdPath = path.join(AUDIT_DIR, `chaos_monkey_gate_${stamp}.md`);
  const latestJsonPath = path.join(AUDIT_DIR, 'chaos_monkey_gate_latest.json');
  const latestMdPath = path.join(AUDIT_DIR, 'chaos_monkey_gate_latest.md');

  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(reportMdPath, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');
  await fs.writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(latestMdPath, `${toMarkdown(report, reportJsonPath)}\n`, 'utf-8');

  for (const check of checks) {
    console.log(`[chaos-gate] ${check.pass ? 'PASS' : 'FAIL'} ${check.id}: ${check.details}`);
  }
  console.log(`[chaos-gate] report=${reportJsonPath}`);
  if (!report.pass) {
    console.error('[chaos-gate] FAIL');
    process.exitCode = 1;
    return;
  }
  console.log('[chaos-gate] PASS');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[chaos-gate] fatal: ${message}`);
  process.exitCode = 1;
});
