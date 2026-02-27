import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { FileChronos } from '../chronos/file-chronos.js';

interface StepResult {
  id: string;
  pass: boolean;
  details: string;
}

interface DevopsBlindboxReport {
  stamp: string;
  workspace: string;
  journalPath: string;
  service: {
    port: number;
    pidFile: string;
  };
  checks: StepResult[];
  pass: boolean;
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

function run(command: string, cwd: string): { code: number; stdout: string; stderr: string } {
  const result = spawnSync('bash', ['-lc', command], {
    cwd,
    encoding: 'utf-8',
    timeout: 20_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    code: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

async function startService(workspace: string, port: number, pidFile: string): Promise<void> {
  const logPath = path.join(workspace, 'service.log');
  const out = await fs.open(logPath, 'a');
  const child = spawn('python3', ['-m', 'http.server', String(port)], {
    cwd: workspace,
    detached: true,
    stdio: ['ignore', out.fd, out.fd],
  });
  child.unref();
  await fs.writeFile(pidFile, `${child.pid}\n`, 'utf-8');
  await out.close();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(workspace: string, port: number, retries = 10, delayMs = 200): Promise<boolean> {
  for (let i = 0; i < retries; i += 1) {
    const res = run(`curl -fsS --max-time 2 http://127.0.0.1:${port} >/dev/null`, workspace);
    if (res.code === 0) {
      return true;
    }
    await sleep(delayMs);
  }
  return false;
}

async function waitForDown(workspace: string, port: number, retries = 10, delayMs = 200): Promise<boolean> {
  for (let i = 0; i < retries; i += 1) {
    const res = run(`curl -fsS --max-time 2 http://127.0.0.1:${port} >/dev/null`, workspace);
    if (res.code !== 0) {
      return true;
    }
    await sleep(delayMs);
  }
  return false;
}

async function main(): Promise<void> {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  const stamp = timestamp();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'turingos-devops-local-'));
  const journalPath = path.join(workspace, '.journal.log');
  const chronos = new FileChronos(journalPath);

  const port = 18080 + Math.floor(Math.random() * 1000);
  const pidFile = path.join(workspace, 'service.pid');
  const checks: StepResult[] = [];

  await chronos.engrave('[DEVOPS] boot local blindbox scenario');
  await startService(workspace, port, pidFile);
  const startupOk = await waitForHealth(workspace, port);
  await chronos.engrave(`[DEVOPS] service started at http://127.0.0.1:${port}`);

  const health1 = run(`curl -fsS --max-time 2 http://127.0.0.1:${port} >/dev/null`, workspace);
  checks.push({
    id: 'service_initial_health',
    pass: startupOk && health1.code === 0,
    details: `startup_ok=${startupOk} curl_exit=${health1.code}`,
  });

  const pid = (await fs.readFile(pidFile, 'utf-8')).trim();
  const killRes = run(`kill -9 ${pid}`, workspace);
  const downOk = await waitForDown(workspace, port);
  await chronos.engrave(`[ATTACK] kill -9 service pid=${pid} exit=${killRes.code}`);

  const health2 = run(`curl -fsS --max-time 2 http://127.0.0.1:${port} >/dev/null`, workspace);
  checks.push({
    id: 'service_down_after_kill',
    pass: killRes.code === 0 && downOk && health2.code !== 0,
    details: `kill_exit=${killRes.code} down_ok=${downOk} curl_exit=${health2.code}`,
  });

  await startService(workspace, port, pidFile);
  const recoveredOk = await waitForHealth(workspace, port);
  await chronos.engrave('[RECOVERY] service restarted after kill -9');
  const health3 = run(`curl -fsS --max-time 2 http://127.0.0.1:${port} >/dev/null`, workspace);
  checks.push({
    id: 'service_recovered_after_restart',
    pass: recoveredOk && health3.code === 0,
    details: `recovered_ok=${recoveredOk} curl_exit=${health3.code}`,
  });

  const cfgPath = path.join(workspace, 'deploy.env');
  await fs.writeFile(cfgPath, 'APP_MODE=prod\n', 'utf-8');
  run(`chmod 400 ${cfgPath}`, workspace);
  const writeDenied = run(`echo 'RECOVER=0' >> ${cfgPath}`, workspace);
  await chronos.engrave(`[ATTACK] chmod 400 + append attempt exit=${writeDenied.code}`);
  checks.push({
    id: 'permission_denied_observed',
    pass: writeDenied.code !== 0,
    details: `append_exit=${writeDenied.code}`,
  });

  const fixPerm = run(`chmod 600 ${cfgPath} && echo 'RECOVER=1' >> ${cfgPath}`, workspace);
  await chronos.engrave(`[RECOVERY] permission restored exit=${fixPerm.code}`);
  checks.push({
    id: 'permission_recovered',
    pass: fixPerm.code === 0,
    details: `fix_exit=${fixPerm.code}`,
  });

  const netFail = run(`curl -fsS --max-time 2 http://10.255.255.1 >/dev/null`, workspace);
  await chronos.engrave(`[ATTACK] network blackhole probe exit=${netFail.code}`);
  checks.push({
    id: 'network_timeout_observed',
    pass: netFail.code !== 0,
    details: `blackhole_exit=${netFail.code}`,
  });

  const netFallback = run(`curl -fsS --max-time 2 http://127.0.0.1:${port} >/dev/null`, workspace);
  await chronos.engrave(`[RECOVERY] fallback to local endpoint exit=${netFallback.code}`);
  checks.push({
    id: 'network_fallback_recovered',
    pass: netFallback.code === 0,
    details: `fallback_exit=${netFallback.code}`,
  });

  const report: DevopsBlindboxReport = {
    stamp,
    workspace,
    journalPath,
    service: {
      port,
      pidFile,
    },
    checks,
    pass: checks.every((item) => item.pass),
  };

  const reportJson = path.join(AUDIT_DIR, `devops_blindbox_local_${stamp}.json`);
  const reportMd = path.join(AUDIT_DIR, `devops_blindbox_local_${stamp}.md`);
  const latestJson = path.join(AUDIT_DIR, 'devops_blindbox_local_latest.json');
  const latestMd = path.join(AUDIT_DIR, 'devops_blindbox_local_latest.md');

  const md = [
    '# DevOps Blindbox Local',
    '',
    `- stamp: ${report.stamp}`,
    `- workspace: ${report.workspace}`,
    `- journal: ${report.journalPath}`,
    `- pass: ${report.pass}`,
    '',
    '| Check | Result | Details |',
    '|---|---|---|',
    ...report.checks.map((c) => `| ${c.id} | ${c.pass ? 'PASS' : 'FAIL'} | ${c.details} |`),
    '',
    '## Note',
    '',
    '- This is local equivalent of DevOps blindbox due missing Docker/VPS orchestration in current VM.',
  ].join('\n');

  await fs.writeFile(reportJson, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(reportMd, `${md}\n`, 'utf-8');
  await fs.writeFile(latestJson, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(latestMd, `${md}\n`, 'utf-8');

  console.log(`[devops-blindbox-local] pass=${report.pass} report=${reportJson}`);
  process.exit(report.pass ? 0 : 2);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[devops-blindbox-local] fatal: ${message}`);
  process.exitCode = 1;
});
