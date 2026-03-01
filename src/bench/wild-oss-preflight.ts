import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface CandidateRow {
  fullName: string;
  language: string;
  weightedTotal: number;
  selectedIssue: { number: number; title: string } | null;
}

interface CandidatePool {
  generatedAt: string;
  rows: CandidateRow[];
}

interface CommandResult {
  ok: boolean;
  code: number;
  durationMs: number;
  stdoutPreview: string;
  stderrPreview: string;
  errorMessage?: string;
}

interface RepoPreflightResult {
  fullName: string;
  language: string;
  weightedTotal: number;
  selectedIssue: CandidateRow['selectedIssue'];
  toolchainSupported: boolean;
  toolchainReason: string;
  workspaceDir: string | null;
  clone: CommandResult | null;
  install: CommandResult | null;
  testProbe: CommandResult | null;
  verdict: 'PASS' | 'FAIL' | 'SKIP';
}

interface PreflightReport {
  stamp: string;
  generatedAt: string;
  sourcePoolGeneratedAt: string;
  policy: {
    maxRepos: number;
    maxScan: number;
    timeoutMs: {
      clone: number;
      install: number;
      testProbe: number;
    };
  };
  toolchains: {
    node: boolean;
    go: boolean;
    python: boolean;
    npm: boolean;
    pip: boolean;
    pnpm: boolean;
    yarn: boolean;
    uv: boolean;
  };
  summary: {
    selected: number;
    pass: number;
    fail: number;
    skip: number;
  };
  rows: RepoPreflightResult[];
}

const ROOT = path.resolve(process.cwd());
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'longrun');
const HANDOVER_DIR = path.join(ROOT, 'handover');
const SOURCE_POOL = path.join(HANDOVER_DIR, 'wild_oss_candidate_pool.json');

function timestamp(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function trimPreview(text: string, maxChars = 4000): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '').slice(0, maxChars);
}

function syntheticResult(ok: boolean, note: string): CommandResult {
  return {
    ok,
    code: ok ? 0 : 1,
    durationMs: 0,
    stdoutPreview: ok ? note : '',
    stderrPreview: ok ? '' : note,
  };
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync('bash', ['-lc', `command -v ${cmd}`], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function pythonModuleExists(moduleName: string): Promise<boolean> {
  try {
    await execFileAsync('python3', ['-m', moduleName, '--version'], {
      timeout: 7000,
      maxBuffer: 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function runCommand(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<CommandResult> {
  const start = Date.now();
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));

  try {
    const { stdout, stderr } = await execFileAsync('timeout', ['--signal=KILL', `${timeoutSeconds}s`, cmd, ...args], {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
      env: process.env,
    });
    return {
      ok: true,
      code: 0,
      durationMs: Date.now() - start,
      stdoutPreview: trimPreview(stdout),
      stderrPreview: trimPreview(stderr),
    };
  } catch (error: unknown) {
    const e = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };

    const timeoutMissing =
      e.code === 'ENOENT' ||
      `${e.message ?? ''}`.includes('spawn timeout ENOENT') ||
      `${e.message ?? ''}`.includes('No such file or directory');

    if (timeoutMissing) {
      try {
        const { stdout, stderr } = await execFileAsync(cmd, args, {
          cwd,
          timeout: timeoutMs,
          maxBuffer: 16 * 1024 * 1024,
          env: process.env,
        });
        return {
          ok: true,
          code: 0,
          durationMs: Date.now() - start,
          stdoutPreview: trimPreview(stdout),
          stderrPreview: trimPreview(stderr),
        };
      } catch (error2: unknown) {
        const e2 = error2 as {
          code?: number | string;
          stdout?: string;
          stderr?: string;
          message?: string;
        };
        return {
          ok: false,
          code: typeof e2.code === 'number' ? e2.code : -1,
          durationMs: Date.now() - start,
          stdoutPreview: trimPreview(e2.stdout ?? ''),
          stderrPreview: trimPreview(e2.stderr ?? ''),
          errorMessage: e2.message ?? String(error2),
        };
      }
    }

    return {
      ok: false,
      code: typeof e.code === 'number' ? e.code : -1,
      durationMs: Date.now() - start,
      stdoutPreview: trimPreview(e.stdout ?? ''),
      stderrPreview: trimPreview(e.stderr ?? ''),
      errorMessage: e.message ?? String(error),
    };
  }
}

function isNodeLike(language: string): boolean {
  return language === 'TypeScript' || language === 'JavaScript';
}

function isPython(language: string): boolean {
  return language === 'Python';
}

function isGo(language: string): boolean {
  return language === 'Go';
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

function markdownForReport(report: PreflightReport, reportJsonPath: string): string {
  return [
    '# Wild OSS Top3 Preflight',
    '',
    `- generated_at: ${report.generatedAt}`,
    `- report_json: ${reportJsonPath}`,
    `- source_pool: ${path.relative(ROOT, SOURCE_POOL)}`,
    `- max_repos: ${report.policy.maxRepos}`,
    `- max_scan: ${report.policy.maxScan}`,
    `- selected: ${report.summary.selected}`,
    `- pass: ${report.summary.pass}`,
    `- fail: ${report.summary.fail}`,
    `- skip: ${report.summary.skip}`,
    '',
    '## Toolchains',
    `- node: ${report.toolchains.node}`,
    `- go: ${report.toolchains.go}`,
    `- npm: ${report.toolchains.npm}`,
    `- pnpm: ${report.toolchains.pnpm}`,
    `- yarn: ${report.toolchains.yarn}`,
    `- python: ${report.toolchains.python}`,
    `- pip: ${report.toolchains.pip}`,
    `- uv: ${report.toolchains.uv}`,
    '',
    '| Repo | Lang | Score | Verdict | Clone | Install | Test Probe |',
    '|---|---|---:|---|---|---|---|',
    ...report.rows.map((r) => {
      const clone = r.clone ? (r.clone.ok ? `PASS ${r.clone.durationMs}ms` : `FAIL ${r.clone.durationMs}ms`) : 'SKIP';
      const install = r.install ? (r.install.ok ? `PASS ${r.install.durationMs}ms` : `FAIL ${r.install.durationMs}ms`) : 'SKIP';
      const test = r.testProbe
        ? r.testProbe.ok
          ? `PASS ${r.testProbe.durationMs}ms`
          : `FAIL ${r.testProbe.durationMs}ms`
        : 'SKIP';
      return `| ${r.fullName} | ${r.language} | ${r.weightedTotal} | ${r.verdict} | ${clone} | ${install} | ${test} |`;
    }),
    '',
    '## Notes',
    '- This preflight is a deterministic feasibility gate before 150+ tick wild longrun.',
    '- FAIL/SKIP entries remain valuable for fallback routing and task scheduling.',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  await fs.mkdir(HANDOVER_DIR, { recursive: true });
  const goModCache = path.join(os.tmpdir(), 'turingos-go-mod-cache');
  process.env.GOMODCACHE = goModCache;
  await fs.mkdir(goModCache, { recursive: true });

  const maxRepos = Number.parseInt(process.env.WILD_OSS_PREFLIGHT_TOPK ?? '3', 10) || 3;
  const maxScan = Number.parseInt(process.env.WILD_OSS_PREFLIGHT_MAX_SCAN ?? '12', 10) || 12;
  const cloneTimeoutMs = Number.parseInt(process.env.WILD_OSS_PREFLIGHT_CLONE_TIMEOUT_MS ?? '180000', 10) || 180000;
  const installTimeoutMs = Number.parseInt(process.env.WILD_OSS_PREFLIGHT_INSTALL_TIMEOUT_MS ?? '300000', 10) || 300000;
  const testTimeoutMs = Number.parseInt(process.env.WILD_OSS_PREFLIGHT_TEST_TIMEOUT_MS ?? '180000', 10) || 180000;

  const [hasNode, hasGoToolchain, hasNpm, hasPython, hasPnpm, hasYarn, hasUv] = await Promise.all([
    commandExists('node'),
    commandExists('go'),
    commandExists('npm'),
    commandExists('python3'),
    commandExists('pnpm'),
    commandExists('yarn'),
    commandExists('uv'),
  ]);
  const hasPip = hasPython ? await pythonModuleExists('pip') : false;

  const pool = await readJson<CandidatePool>(SOURCE_POOL);
  const sorted = [...pool.rows].sort((a, b) => b.weightedTotal - a.weightedTotal);

  const selected = sorted.filter((row) => {
    if (isNodeLike(row.language)) return hasNode && hasNpm;
    if (isGo(row.language)) return hasGoToolchain;
    if (isPython(row.language)) return hasUv || (hasPython && hasPip);
    return false;
  });

  const picked = selected.slice(0, Math.max(maxRepos, maxScan));
  if (picked.length === 0) {
    throw new Error('No supported candidates found for local toolchains (Node/Python).');
  }

  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'turingos-wild-oss-preflight-'));
  const rows: RepoPreflightResult[] = [];

  let passCount = 0;
  const passLanguages = new Set<string>();
  for (const row of picked) {
    if (rows.length >= maxScan || (passCount >= maxRepos && passLanguages.size >= 2)) {
      break;
    }

    const repoDir = path.join(workspaceRoot, row.fullName.replace('/', '__'));
    const repoUrl = `https://github.com/${row.fullName}.git`;

    const result: RepoPreflightResult = {
      fullName: row.fullName,
      language: row.language,
      weightedTotal: row.weightedTotal,
      selectedIssue: row.selectedIssue,
      toolchainSupported: true,
      toolchainReason: '',
      workspaceDir: repoDir,
      clone: null,
      install: null,
      testProbe: null,
      verdict: 'FAIL',
    };

    result.clone = await runCommand('git', ['clone', '--depth', '1', repoUrl, repoDir], workspaceRoot, cloneTimeoutMs);
    if (!result.clone.ok) {
      result.verdict = 'FAIL';
      rows.push(result);
      await fs.rm(repoDir, { recursive: true, force: true });
      continue;
    }

    if (isNodeLike(row.language)) {
      const hasPnpmLock = await fs
        .access(path.join(repoDir, 'pnpm-lock.yaml'))
        .then(() => true)
        .catch(() => false);
      const hasYarnLock = await fs
        .access(path.join(repoDir, 'yarn.lock'))
        .then(() => true)
        .catch(() => false);

      if (hasPnpmLock && !hasPnpm) {
        result.toolchainSupported = false;
        result.toolchainReason = 'pnpm-lock.yaml found but pnpm is unavailable';
        result.verdict = 'SKIP';
        rows.push(result);
        await fs.rm(repoDir, { recursive: true, force: true });
        continue;
      }
      if (hasYarnLock && !hasYarn && !hasPnpm) {
        result.toolchainSupported = false;
        result.toolchainReason = 'yarn.lock found but yarn/pnpm is unavailable';
        result.verdict = 'SKIP';
        rows.push(result);
        await fs.rm(repoDir, { recursive: true, force: true });
        continue;
      }

      if (hasPnpmLock && hasPnpm) {
        result.install = await runCommand(
          'pnpm',
          ['install', '--frozen-lockfile', '--ignore-scripts', '--lockfile-only'],
          repoDir,
          installTimeoutMs
        );
      } else if (hasYarnLock && hasYarn) {
        result.install = await runCommand('yarn', ['install', '--ignore-scripts'], repoDir, installTimeoutMs);
      } else {
        result.install = await runCommand(
          'npm',
          ['install', '--ignore-scripts', '--package-lock-only', '--no-audit', '--fund=false'],
          repoDir,
          installTimeoutMs
        );
      }

      const packageJsonPath = path.join(repoDir, 'package.json');
      const packageJsonRaw = await fs.readFile(packageJsonPath, 'utf-8').catch(() => '');
      if (packageJsonRaw.length === 0) {
        result.testProbe = syntheticResult(false, 'package.json not found');
      } else {
        let scriptName = '';
        try {
          const pkg = JSON.parse(packageJsonRaw) as { scripts?: Record<string, string> };
          const scripts = pkg.scripts ?? {};
          const preferred = ['test', 'test:ci', 'ci:test', 'unit', 'unit:test'];
          scriptName = preferred.find((key) => typeof scripts[key] === 'string' && scripts[key].trim().length > 0) ?? '';
        } catch {
          scriptName = '';
        }
        result.testProbe = scriptName
          ? syntheticResult(true, `test_script_detected:${scriptName}`)
          : syntheticResult(false, 'no test-like script found in package.json');
      }
    } else if (isGo(row.language)) {
      const hasGoMod = await fs
        .access(path.join(repoDir, 'go.mod'))
        .then(() => true)
        .catch(() => false);
      if (!hasGoMod) {
        result.install = syntheticResult(false, 'go.mod not found');
      } else {
        result.install = await runCommand('go', ['mod', 'download'], repoDir, installTimeoutMs);
      }

      const goTests = await runCommand('bash', ['-lc', "find . -name '*_test.go' | head -n 1"], repoDir, testTimeoutMs);
      const hasGoTestFiles = goTests.ok && goTests.stdoutPreview.trim().length > 0;
      const workflowsDir = path.join(repoDir, '.github', 'workflows');
      const workflowSignals = await fs
        .readdir(workflowsDir)
        .then(async (files) => {
          const checks = await Promise.all(
            files
              .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
              .map(async (name) => {
                const raw = await fs.readFile(path.join(workflowsDir, name), 'utf-8').catch(() => '');
                return /go test/i.test(raw);
              })
          );
          return checks.some(Boolean);
        })
        .catch(() => false);
      result.testProbe = hasGoTestFiles || workflowSignals
        ? syntheticResult(true, 'go_test_signal_detected')
        : syntheticResult(false, 'no go test signal found');
    } else if (isPython(row.language)) {
      const hasReq = await fs
        .access(path.join(repoDir, 'requirements.txt'))
        .then(() => true)
        .catch(() => false);
      const hasPyproject = await fs
        .access(path.join(repoDir, 'pyproject.toml'))
        .then(() => true)
        .catch(() => false);

      if (hasUv) {
        if (hasReq) {
          result.install = await runCommand(
            'uv',
            ['pip', 'install', '--dry-run', '--system', '--break-system-packages', '-r', 'requirements.txt'],
            repoDir,
            installTimeoutMs
          );
        } else if (hasPyproject) {
          result.install = await runCommand(
            'uv',
            ['pip', 'install', '--dry-run', '--system', '--break-system-packages', '-e', '.'],
            repoDir,
            installTimeoutMs
          );
        } else {
          result.install = syntheticResult(true, 'no requirements/pyproject, install probe skipped');
        }
      } else if (hasPip) {
        if (hasReq) {
          result.install = await runCommand(
            'python3',
            ['-m', 'pip', 'install', '--dry-run', '-r', 'requirements.txt'],
            repoDir,
            installTimeoutMs
          );
        } else {
          result.install = await runCommand('python3', ['-m', 'pip', 'install', '--dry-run', '-e', '.'], repoDir, installTimeoutMs);
        }
      } else {
        result.toolchainSupported = false;
        result.toolchainReason = 'missing python package manager (pip/uv)';
        result.verdict = 'SKIP';
        rows.push(result);
        await fs.rm(repoDir, { recursive: true, force: true });
        continue;
      }

      const hasTestsDir = await fs
        .access(path.join(repoDir, 'tests'))
        .then(() => true)
        .catch(() => false);
      const hasPytestIni = await fs
        .access(path.join(repoDir, 'pytest.ini'))
        .then(() => true)
        .catch(() => false);
      const pyprojectRaw = hasPyproject ? await fs.readFile(path.join(repoDir, 'pyproject.toml'), 'utf-8').catch(() => '') : '';
      const hasPytestConfig = pyprojectRaw.includes('tool.pytest') || pyprojectRaw.includes('pytest.ini_options');
      const workflowsDir = path.join(repoDir, '.github', 'workflows');
      const workflowSignals = await fs
        .readdir(workflowsDir)
        .then(async (files) => {
          const checks = await Promise.all(
            files
              .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
              .map(async (name) => {
                const raw = await fs.readFile(path.join(workflowsDir, name), 'utf-8').catch(() => '');
                return /pytest|python -m unittest|tox|nox/i.test(raw);
              })
          );
          return checks.some(Boolean);
        })
        .catch(() => false);
      result.testProbe = hasTestsDir || hasPytestIni || hasPytestConfig || workflowSignals
        ? syntheticResult(true, 'python_test_signal_detected')
        : syntheticResult(false, 'no python test signal found');
    } else {
      result.toolchainSupported = false;
      result.toolchainReason = `unsupported language: ${row.language}`;
      result.verdict = 'SKIP';
      rows.push(result);
      await fs.rm(repoDir, { recursive: true, force: true });
      continue;
    }

    result.verdict = result.clone.ok && !!result.install?.ok && !!result.testProbe?.ok ? 'PASS' : 'FAIL';
    rows.push(result);
    if (result.verdict === 'PASS') {
      passCount += 1;
      passLanguages.add(result.language);
    }

    // Keep disk usage bounded in low-storage environments.
    await fs.rm(repoDir, { recursive: true, force: true });
  }

  const pass = rows.filter((r) => r.verdict === 'PASS').length;
  const fail = rows.filter((r) => r.verdict === 'FAIL').length;
  const skip = rows.filter((r) => r.verdict === 'SKIP').length;

  const stamp = timestamp();
  const report: PreflightReport = {
    stamp,
    generatedAt: new Date().toISOString(),
    sourcePoolGeneratedAt: pool.generatedAt,
    policy: {
      maxRepos,
      maxScan,
      timeoutMs: {
        clone: cloneTimeoutMs,
        install: installTimeoutMs,
        testProbe: testTimeoutMs,
      },
    },
    toolchains: {
      node: hasNode,
      go: hasGoToolchain,
      python: hasPython,
      npm: hasNpm,
      pip: hasPip,
      pnpm: hasPnpm,
      yarn: hasYarn,
      uv: hasUv,
    },
    summary: {
      selected: rows.length,
      pass,
      fail,
      skip,
    },
    rows,
  };

  const reportJsonPath = path.join(AUDIT_DIR, `wild_oss_preflight_${stamp}.json`);
  const reportMdPath = path.join(AUDIT_DIR, `wild_oss_preflight_${stamp}.md`);
  const latestJsonPath = path.join(AUDIT_DIR, 'wild_oss_preflight_latest.json');
  const latestMdPath = path.join(AUDIT_DIR, 'wild_oss_preflight_latest.md');
  const handoverJsonPath = path.join(HANDOVER_DIR, 'wild_oss_preflight.json');
  const handoverMdPath = path.join(HANDOVER_DIR, 'wild_oss_preflight.md');

  const md = markdownForReport(report, reportJsonPath);
  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(reportMdPath, `${md}\n`, 'utf-8');
  await fs.writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(latestMdPath, `${md}\n`, 'utf-8');
  await fs.writeFile(handoverJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(handoverMdPath, `${md}\n`, 'utf-8');

  console.log(
    `[wild-oss-preflight] selected=${report.summary.selected} pass=${report.summary.pass} fail=${report.summary.fail} skip=${report.summary.skip}`
  );
  console.log(`[wild-oss-preflight] output=${reportJsonPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[wild-oss-preflight] fatal: ${message}`);
  process.exitCode = 1;
});
