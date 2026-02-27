import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

interface StepResult {
  id: string;
  pass: boolean;
  details: string;
}

interface DevopsBlindboxVpsReport {
  stamp: string;
  host: string;
  remoteShell: RemoteShell;
  workspace: string;
  port: number;
  mttrOps: number;
  checks: StepResult[];
  pass: boolean;
  sshExitCode: number;
  sshStderrPreview: string;
}

type RemoteShell = 'bash' | 'powershell';

const ROOT = path.resolve(process.cwd());
const AUDIT_DIR = path.join(ROOT, 'benchmarks', 'audits', 'longrun');

function parseApprovedHosts(raw: string | undefined): Set<string> {
  const values =
    raw
      ?.split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0) ?? [];
  return new Set(values);
}

function assertApprovedHost(host: string, approvedHosts: Set<string>): void {
  if (host.length === 0) {
    throw new Error(
      'TURINGOS_VPS_HOST is required. Hardware usage requires explicit host approval from owner.'
    );
  }
  if (approvedHosts.size === 0) {
    throw new Error(
      'TURINGOS_APPROVED_HOSTS is empty. Refusing to run on any remote host without explicit approval.'
    );
  }
  if (!approvedHosts.has(host)) {
    throw new Error(
      `Host "${host}" is not approved. Allowed hosts: ${Array.from(approvedHosts).join(', ')}`
    );
  }
}

function resolveRemoteShell(host: string): RemoteShell {
  const raw = (process.env.TURINGOS_VPS_REMOTE_SHELL ?? 'auto').trim().toLowerCase();
  if (raw === 'auto') {
    return host.includes('windows') ? 'powershell' : 'bash';
  }
  if (raw === 'bash' || raw === 'powershell') {
    return raw;
  }
  throw new Error(`Invalid TURINGOS_VPS_REMOTE_SHELL=${raw}. Expected: auto|bash|powershell`);
}

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

function remoteBashScript(host: string): string {
  return [
    'set -u -o pipefail',
    'set +e',
    `host_alias=${JSON.stringify(host)}`,
    'workspace=$(mktemp -d /tmp/turingos-devops-vps-XXXXXX)',
    'port=$((18080 + RANDOM % 1000))',
    'service_log="$workspace/service.log"',
    'pid_file="$workspace/service.pid"',
    'ops=0',
    'attack_op=0',
    'recover_op=0',
    '',
    'sanitize() {',
    "  printf '%s' \"$1\" | tr '\\n' ' ' | tr '|' '/'",
    '}',
    '',
    'emit_meta() {',
    "  printf 'META|%s|%s\\n' \"$1\" \"$2\"",
    '}',
    '',
    'emit_check() {',
    '  local id="$1"',
    '  local pass="$2"',
    '  local details="$3"',
    "  printf 'CHECK|%s|%s|%s\\n' \"$id\" \"$pass\" \"$(sanitize \"$details\")\"",
    '}',
    '',
    'probe_http() {',
    '  local p="$1"',
    "  python3 - \"$p\" <<'PY'",
    'import sys',
    'import urllib.request',
    'port = int(sys.argv[1])',
    'url = f"http://127.0.0.1:{port}"',
    'try:',
    '    with urllib.request.urlopen(url, timeout=2) as r:',
    '        r.read(1)',
    '    raise SystemExit(0)',
    'except Exception:',
    '    raise SystemExit(1)',
    'PY',
    '}',
    '',
    'start_service() {',
    '  local p="$1"',
    '  python3 -m http.server "$p" --bind 127.0.0.1 > "$service_log" 2>&1 &',
    '  started_pid=$!',
    '  echo "$started_pid" > "$pid_file"',
    '  return 0',
    '}',
    '',
    'append_cfg() {',
    '  local f="$1"',
    '  local line="$2"',
    "  python3 - \"$f\" \"$line\" <<'PY'",
    'import sys',
    'f = sys.argv[1]',
    'line = sys.argv[2]',
    'try:',
    '    with open(f, "a", encoding="utf-8") as h:',
    '        h.write(line + "\\n")',
    'except Exception:',
    '    raise SystemExit(1)',
    'raise SystemExit(0)',
    'PY',
    '}',
    '',
    'ops=$((ops+1))',
    'start_service "$port"',
    'service_pid="${started_pid:-}"',
    'sleep 2',
    'if kill -0 "$service_pid" >/dev/null 2>&1 && probe_http "$port" >/dev/null 2>&1; then',
    '  emit_check "service_initial_health" "PASS" "startup_ok pid=$service_pid port=$port"',
    'else',
    '  tail_info=$(tail -n 5 "$service_log" 2>/dev/null || true)',
    '  emit_check "service_initial_health" "FAIL" "startup_failed pid=$service_pid port=$port log=$tail_info"',
    'fi',
    '',
    'ops=$((ops+1))',
    'attack_op=$ops',
    'kill -9 "$service_pid" >/dev/null 2>&1 || true',
    'sleep 2',
    'if probe_http "$port" >/dev/null 2>&1; then',
    '  emit_check "service_down_after_kill" "FAIL" "service still alive after kill"',
    'else',
    '  emit_check "service_down_after_kill" "PASS" "service down confirmed"',
    'fi',
    '',
    'ops=$((ops+1))',
    'start_service "$port"',
    'recover_pid="${started_pid:-}"',
    'sleep 2',
    'if kill -0 "$recover_pid" >/dev/null 2>&1 && probe_http "$port" >/dev/null 2>&1; then',
    '  recover_op=$ops',
    '  emit_check "service_recovered_after_restart" "PASS" "recovered pid=$recover_pid"',
    'else',
    '  tail_info=$(tail -n 5 "$service_log" 2>/dev/null || true)',
    '  emit_check "service_recovered_after_restart" "FAIL" "restart_failed pid=$recover_pid log=$tail_info"',
    'fi',
    '',
    'ops=$((ops+1))',
    'cfg="$workspace/deploy.env"',
    "printf '%s\\n' 'APP_MODE=prod' > \"$cfg\"",
    'chmod 400 "$cfg"',
    'if append_cfg "$cfg" "RECOVER=0"; then',
    '  emit_check "permission_denied_observed" "FAIL" "append unexpectedly succeeded"',
    'else',
    '  emit_check "permission_denied_observed" "PASS" "append blocked by chmod 400"',
    'fi',
    '',
    'ops=$((ops+1))',
    'if chmod 600 "$cfg" && append_cfg "$cfg" "RECOVER=1"; then',
    '  emit_check "permission_recovered" "PASS" "chmod+append recovered"',
    'else',
    '  emit_check "permission_recovered" "FAIL" "permission recovery failed"',
    'fi',
    '',
    'ops=$((ops+1))',
    "if python3 - <<'PY'",
    'import urllib.request',
    'try:',
    '    urllib.request.urlopen("http://10.255.255.1", timeout=2)',
    '    raise SystemExit(0)',
    'except Exception:',
    '    raise SystemExit(1)',
    'PY',
    'then',
    '  emit_check "network_timeout_observed" "FAIL" "blackhole probe unexpectedly succeeded"',
    'else',
    '  emit_check "network_timeout_observed" "PASS" "blackhole probe failed as expected"',
    'fi',
    '',
    'ops=$((ops+1))',
    'if probe_http "$port" >/dev/null 2>&1; then',
    '  emit_check "network_fallback_recovered" "PASS" "local fallback healthy"',
    'else',
    '  emit_check "network_fallback_recovered" "FAIL" "local fallback unhealthy"',
    'fi',
    '',
    'if [ "$recover_op" -gt "$attack_op" ] && [ "$attack_op" -gt 0 ]; then',
    '  mttr_ops=$((recover_op - attack_op))',
    'else',
    '  mttr_ops=999',
    'fi',
    'if [ "$mttr_ops" -le 8 ]; then',
    '  emit_check "mttr_under_8_ops" "PASS" "mttr_ops=$mttr_ops"',
    'else',
    '  emit_check "mttr_under_8_ops" "FAIL" "mttr_ops=$mttr_ops"',
    'fi',
    '',
    'emit_meta "host" "$host_alias"',
    'emit_meta "workspace" "$workspace"',
    'emit_meta "port" "$port"',
    'emit_meta "mttr_ops" "$mttr_ops"',
    '',
    'if [ -n "${recover_pid:-}" ]; then kill "$recover_pid" >/dev/null 2>&1 || true; fi',
    'if [ -n "${service_pid:-}" ]; then kill "$service_pid" >/dev/null 2>&1 || true; fi',
    'exit 0',
  ].join('\n');
}

function remotePowerShellScript(host: string): string {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$hostAlias = ${JSON.stringify(host)}`,
    "$workspace = Join-Path $env:TEMP ('turingos-devops-vps-' + [guid]::NewGuid().ToString('N').Substring(0,8))",
    'New-Item -ItemType Directory -Path $workspace -Force | Out-Null',
    '$port = Get-Random -Minimum 18080 -Maximum 19080',
    "$serviceOut = Join-Path $workspace 'service.out.log'",
    "$serviceErr = Join-Path $workspace 'service.err.log'",
    "$pidFile = Join-Path $workspace 'service.pid'",
    '$ops = 0',
    '$attackOp = 0',
    '$recoverOp = 0',
    '$startedPid = 0',
    '$servicePid = 0',
    '$recoverPid = 0',
    '$pythonExe = ""',
    '$denyApplied = $false',
    '$principal = "$env:USERDOMAIN\\$env:USERNAME"',
    '',
    'function Sanitize([string]$s) {',
    '  if ($null -eq $s) { return "" }',
    '  $x = [string]$s',
    '  $x = $x.Replace("`r", " ").Replace("`n", " ")',
    '  $x = $x.Replace("|", "/")',
    '  return $x',
    '}',
    '',
    'function Emit-Meta([string]$k, [string]$v) {',
    '  Write-Output ("META|{0}|{1}" -f $k, (Sanitize $v))',
    '}',
    '',
    'function Emit-Check([string]$id, [string]$pass, [string]$details) {',
    '  Write-Output ("CHECK|{0}|{1}|{2}" -f $id, $pass, (Sanitize $details))',
    '}',
    '',
    'function Probe-Http([int]$p) {',
    '  try {',
    '    Invoke-WebRequest -Uri ("http://127.0.0.1:{0}" -f $p) -UseBasicParsing -TimeoutSec 2 | Out-Null',
    '    return $true',
    '  } catch {',
    '    return $false',
    '  }',
    '}',
    '',
    'function Wait-Http([int]$p, [int]$retries) {',
    '  for ($i = 0; $i -lt $retries; $i++) {',
    '    if (Probe-Http $p) { return $true }',
    '    Start-Sleep -Seconds 1',
    '  }',
    '  return $false',
    '}',
    '',
    'function Wait-PortDown([int]$p, [int]$retries) {',
    '  for ($i = 0; $i -lt $retries; $i++) {',
    '    if (-not (Probe-Http $p)) { return $true }',
    '    Start-Sleep -Seconds 1',
    '  }',
    '  return $false',
    '}',
    '',
    'function Get-ListenerPids([int]$p) {',
    '  $ids = @()',
    '  try {',
    '    $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction Stop',
    '    foreach ($c in $conns) {',
    '      if ($null -ne $c.OwningProcess) { $ids += [int]$c.OwningProcess }',
    '    }',
    '  } catch {',
    '    try {',
    '      $lines = netstat -ano -p tcp | Select-String (":{0}\\s+" -f $p)',
    '      foreach ($ln in $lines) {',
    '        $parts = ($ln.ToString() -split "\\s+") | Where-Object { $_ -ne "" }',
    '        if ($parts.Length -ge 5) {',
    '          $pidVal = $parts[$parts.Length - 1]',
    '          if ($pidVal -match "^[0-9]+$") { $ids += [int]$pidVal }',
    '        }',
    '      }',
    '    } catch {}',
    '  }',
    '  return $ids | Sort-Object -Unique',
    '}',
    '',
    'function Resolve-PythonExe() {',
    '  $cmd = Get-Command python -ErrorAction SilentlyContinue',
    '  if ($null -ne $cmd) { return $cmd.Source }',
    '  return ""',
    '}',
    '',
    'function Start-ServicePy([int]$p) {',
    '  $global:startedPid = 0',
    '  if ([string]::IsNullOrEmpty($pythonExe)) { return }',
    '  $proc = Start-Process -FilePath $pythonExe -ArgumentList @("-m", "http.server", "$p", "--bind", "127.0.0.1") -RedirectStandardOutput $serviceOut -RedirectStandardError $serviceErr -PassThru',
    '  if ($null -ne $proc) {',
    '    $global:startedPid = $proc.Id',
    '    Set-Content -Path $pidFile -Value ("{0}" -f $proc.Id) -Encoding utf8',
    '  }',
    '}',
    '',
    'function Stop-Proc([int]$targetPid) {',
    '  try { & taskkill /PID $targetPid /T /F | Out-Null } catch {}',
    '  try { Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue } catch {}',
    '}',
    '',
    'function Append-Cfg([string]$f, [string]$line) {',
    '  try {',
    '    Add-Content -Path $f -Value $line -Encoding utf8 -ErrorAction Stop',
    '    return $true',
    '  } catch {',
    '    return $false',
    '  }',
    '}',
    '',
    '$pythonExe = Resolve-PythonExe',
    'if ([string]::IsNullOrEmpty($pythonExe)) {',
    '  Emit-Check "python_runtime_present" "FAIL" "python not found in PATH"',
    '} else {',
    '  Emit-Check "python_runtime_present" "PASS" ("python={0}" -f $pythonExe)',
    '}',
    '',
    '$ops = $ops + 1',
    'Start-ServicePy $port',
    '$servicePid = $startedPid',
    'if ($servicePid -gt 0 -and (Get-Process -Id $servicePid -ErrorAction SilentlyContinue) -and (Wait-Http $port 5)) {',
    '  Emit-Check "service_initial_health" "PASS" ("startup_ok pid={0} port={1}" -f $servicePid, $port)',
    '} else {',
    '  $tail = ""',
    '  if (Test-Path $serviceOut) { $tail = (Get-Content -Path $serviceOut -Tail 5 | Out-String) }',
    '  if (Test-Path $serviceErr) { $tail = $tail + " " + (Get-Content -Path $serviceErr -Tail 5 | Out-String) }',
    '  Emit-Check "service_initial_health" "FAIL" ("startup_failed pid={0} port={1} log={2}" -f $servicePid, $port, $tail)',
    '}',
    '',
    '$ops = $ops + 1',
    '$attackOp = $ops',
    '$listenerBefore = @(Get-ListenerPids $port)',
    'foreach ($listenerPid in $listenerBefore) { Stop-Proc $listenerPid }',
    'Stop-Proc $servicePid',
    '$portDown = Wait-PortDown $port 5',
    '$listenerAfter = @(Get-ListenerPids $port)',
    'if ($portDown) {',
    '  Emit-Check "service_down_after_kill" "PASS" ("listener_before={0} listener_after={1} port_down={2}" -f ($listenerBefore -join ","), ($listenerAfter -join ","), $portDown)',
    '} else {',
    '  Emit-Check "service_down_after_kill" "FAIL" ("listener_before={0} listener_after={1} port_down={2}" -f ($listenerBefore -join ","), ($listenerAfter -join ","), $portDown)',
    '}',
    '',
    '$ops = $ops + 1',
    'Start-ServicePy $port',
    '$recoverPid = $startedPid',
    'if ($recoverPid -gt 0 -and (Get-Process -Id $recoverPid -ErrorAction SilentlyContinue) -and (Wait-Http $port 5)) {',
    '  $recoverOp = $ops',
    '  Emit-Check "service_recovered_after_restart" "PASS" ("recovered pid={0}" -f $recoverPid)',
    '} else {',
    '  $tail = ""',
    '  if (Test-Path $serviceOut) { $tail = (Get-Content -Path $serviceOut -Tail 5 | Out-String) }',
    '  if (Test-Path $serviceErr) { $tail = $tail + " " + (Get-Content -Path $serviceErr -Tail 5 | Out-String) }',
    '  Emit-Check "service_recovered_after_restart" "FAIL" ("restart_failed pid={0} log={1}" -f $recoverPid, $tail)',
    '}',
    '',
    '$ops = $ops + 1',
    "$cfg = Join-Path $workspace 'deploy.env'",
    'Set-Content -Path $cfg -Value "APP_MODE=prod" -Encoding utf8',
    'if (Test-Path $cfg) {',
    '  (Get-Item $cfg).IsReadOnly = $true',
    '  $denyApplied = $true',
    '}',
    'if (Append-Cfg $cfg "RECOVER=0") {',
    '  Emit-Check "permission_denied_observed" "FAIL" ("append unexpectedly succeeded deny_applied={0}" -f $denyApplied)',
    '} else {',
    '  Emit-Check "permission_denied_observed" "PASS" ("append blocked deny_applied={0}" -f $denyApplied)',
    '}',
    '',
    '$ops = $ops + 1',
    'if (Test-Path $cfg) { (Get-Item $cfg).IsReadOnly = $false }',
    'if (Append-Cfg $cfg "RECOVER=1") {',
    '  Emit-Check "permission_recovered" "PASS" "readonly cleared + append recovered"',
    '} else {',
    '  Emit-Check "permission_recovered" "FAIL" "permission recovery failed"',
    '}',
    '',
    '$ops = $ops + 1',
    '$timeoutPass = $false',
    'try {',
    '  Invoke-WebRequest -Uri "http://10.255.255.1" -UseBasicParsing -TimeoutSec 2 | Out-Null',
    '  $timeoutPass = $false',
    '} catch {',
    '  $timeoutPass = $true',
    '}',
    'if ($timeoutPass) {',
    '  Emit-Check "network_timeout_observed" "PASS" "blackhole probe failed as expected"',
    '} else {',
    '  Emit-Check "network_timeout_observed" "FAIL" "blackhole probe unexpectedly succeeded"',
    '}',
    '',
    '$ops = $ops + 1',
    'if (Probe-Http $port) {',
    '  Emit-Check "network_fallback_recovered" "PASS" "local fallback healthy"',
    '} else {',
    '  Emit-Check "network_fallback_recovered" "FAIL" "local fallback unhealthy"',
    '}',
    '',
    'if ($recoverOp -gt $attackOp -and $attackOp -gt 0) {',
    '  $mttrOps = $recoverOp - $attackOp',
    '} else {',
    '  $mttrOps = 999',
    '}',
    'if ($mttrOps -le 8) {',
    '  Emit-Check "mttr_under_8_ops" "PASS" ("mttr_ops={0}" -f $mttrOps)',
    '} else {',
    '  Emit-Check "mttr_under_8_ops" "FAIL" ("mttr_ops={0}" -f $mttrOps)',
    '}',
    '',
    'Emit-Meta "host" $hostAlias',
    'Emit-Meta "workspace" $workspace',
    'Emit-Meta "port" ("{0}" -f $port)',
    'Emit-Meta "mttr_ops" ("{0}" -f $mttrOps)',
    '',
    'if ($recoverPid -gt 0) { Stop-Proc $recoverPid }',
    'if ($servicePid -gt 0) { Stop-Proc $servicePid }',
    'exit 0',
  ].join('\n');
}

function runRemote(host: string, remoteShell: RemoteShell, script: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  if (remoteShell === 'bash') {
    return spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, 'bash', '-s'], {
      input: script,
      encoding: 'utf-8',
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  }

  return spawnSync(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=8',
      host,
      'powershell',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      '-',
    ],
    {
      input: script,
      encoding: 'utf-8',
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    }
  );
}

function parseRemoteOutput(stdout: string): {
  metas: Record<string, string>;
  checks: StepResult[];
} {
  const metas: Record<string, string> = {};
  const checks: StepResult[] = [];
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    if (line.startsWith('META|')) {
      const [, key, value] = line.split('|');
      if (key && value !== undefined) {
        metas[key] = value;
      }
      continue;
    }
    if (line.startsWith('CHECK|')) {
      const [, id, passRaw, ...rest] = line.split('|');
      const details = rest.join('|');
      checks.push({
        id: id ?? 'unknown',
        pass: (passRaw ?? '').toUpperCase() === 'PASS',
        details,
      });
    }
  }
  return { metas, checks };
}

function toMarkdown(report: DevopsBlindboxVpsReport, jsonPath: string): string {
  return [
    '# DevOps Blindbox VPS',
    '',
    `- stamp: ${report.stamp}`,
    `- host: ${report.host}`,
    `- remote_shell: ${report.remoteShell}`,
    `- workspace: ${report.workspace}`,
    `- port: ${report.port}`,
    `- mttr_ops: ${report.mttrOps}`,
    `- ssh_exit_code: ${report.sshExitCode}`,
    `- pass: ${report.pass}`,
    `- report_json: ${jsonPath}`,
    '',
    '| Check | Result | Details |',
    '|---|---|---|',
    ...report.checks.map((c) => `| ${c.id} | ${c.pass ? 'PASS' : 'FAIL'} | ${c.details} |`),
    '',
    '## Note',
    '',
    '- This benchmark runs on a real remote host over SSH (not local equivalent).',
  ].join('\n');
}

async function main(): Promise<void> {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  const stamp = timestamp();
  const host = (process.env.TURINGOS_VPS_HOST ?? '').trim();
  const approvedHosts = parseApprovedHosts(process.env.TURINGOS_APPROVED_HOSTS);
  assertApprovedHost(host, approvedHosts);
  const remoteShell = resolveRemoteShell(host);

  const script = remoteShell === 'bash' ? remoteBashScript(host) : remotePowerShellScript(host);
  const ssh = runRemote(host, remoteShell, script);

  const code = typeof ssh.status === 'number' ? ssh.status : 1;
  const stdout = ssh.stdout ?? '';
  const stderr = ssh.stderr ?? '';
  const parsed = parseRemoteOutput(stdout);
  const checks = [...parsed.checks];
  if (checks.length === 0) {
    checks.push({
      id: 'remote_script_output_present',
      pass: false,
      details: `No CHECK rows parsed. stderr=${stderr.slice(0, 240).replace(/\n/g, ' | ')}`,
    });
  }
  checks.push({
    id: 'ssh_exit_zero',
    pass: code === 0,
    details: `exit_code=${code}`,
  });

  const report: DevopsBlindboxVpsReport = {
    stamp,
    host: parsed.metas.host ?? host,
    remoteShell,
    workspace: parsed.metas.workspace ?? '(unknown)',
    port: Number.parseInt(parsed.metas.port ?? '0', 10) || 0,
    mttrOps: Number.parseInt(parsed.metas.mttr_ops ?? '999', 10) || 999,
    checks,
    pass: checks.every((item) => item.pass),
    sshExitCode: code,
    sshStderrPreview: stderr.slice(0, 240),
  };

  const reportJson = path.join(AUDIT_DIR, `devops_blindbox_vps_${stamp}.json`);
  const reportMd = path.join(AUDIT_DIR, `devops_blindbox_vps_${stamp}.md`);
  const latestJson = path.join(AUDIT_DIR, 'devops_blindbox_vps_latest.json');
  const latestMd = path.join(AUDIT_DIR, 'devops_blindbox_vps_latest.md');

  await fs.writeFile(reportJson, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(reportMd, `${toMarkdown(report, reportJson)}\n`, 'utf-8');
  await fs.writeFile(latestJson, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  await fs.writeFile(latestMd, `${toMarkdown(report, reportJson)}\n`, 'utf-8');

  console.log(
    `[devops-blindbox-vps] host=${report.host} shell=${report.remoteShell} pass=${report.pass} report=${reportJson}`
  );
  for (const check of report.checks) {
    console.log(`[devops-blindbox-vps] ${check.pass ? 'PASS' : 'FAIL'} ${check.id}: ${check.details}`);
  }

  if (!report.pass) {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[devops-blindbox-vps] fatal: ${message}`);
  process.exitCode = 1;
});
