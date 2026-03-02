param(
  [string]$Root = 'D:\work\turingos_llm',
  [string]$HostBind = '0.0.0.0:11434',
  [string]$ClientHost = 'http://127.0.0.1:11434',
  [string]$Model = 'qwen2.5-coder:7b'
)

$ErrorActionPreference = 'Stop'

$binDir = Join-Path $Root 'bin'
$modelsDir = Join-Path $Root 'models'
$homeDir = Join-Path $Root 'home'
$tmpDir = Join-Path $Root 'tmp'
$cacheDir = Join-Path $Root 'cache'
$logsDir = Join-Path $Root 'logs'

foreach ($dir in @($Root, $binDir, $modelsDir, $homeDir, $tmpDir, $cacheDir, $logsDir)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

$ollamaExe = Join-Path $binDir 'ollama.exe'
if (-not (Test-Path $ollamaExe)) {
  throw "Missing ollama executable: $ollamaExe"
}

$existing = Get-CimInstance Win32_Process -Filter "Name='ollama.exe'" -ErrorAction SilentlyContinue
foreach ($proc in $existing) {
  if ($proc.CommandLine -and $proc.CommandLine -match '\sserve(\s|$)') {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

$env:OLLAMA_MODELS = $modelsDir
$env:OLLAMA_HOME = $homeDir
$env:OLLAMA_TMPDIR = $tmpDir
$env:TEMP = $tmpDir
$env:TMP = $tmpDir
$env:OLLAMA_HOST = $HostBind

$stdoutLog = Join-Path $logsDir 'ollama_stdout.log'
$stderrLog = Join-Path $logsDir 'ollama_stderr.log'

Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -WorkingDirectory $Root -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -WindowStyle Hidden
$ready = $false
$lastReadyError = ''
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    # Use RestMethod for PS5.1 compatibility (avoids IE parser dependency in WebRequest).
    Invoke-RestMethod -Uri "$ClientHost/api/tags" -Method Get -TimeoutSec 2 | Out-Null
    $ready = $true
    break
  } catch {
    $lastReadyError = $_.Exception.Message
  }
}
if (-not $ready) {
  $stderrTail = ''
  if (Test-Path $stderrLog) {
    $stderrTail = (Get-Content -Path $stderrLog -Tail 40 -ErrorAction SilentlyContinue) -join "`n"
  }
  throw "Ollama server did not become ready at $ClientHost. LastError=$lastReadyError`n$stderrTail"
}

$env:OLLAMA_HOST = $ClientHost
& $ollamaExe pull $Model | Out-Host

Write-Output "OLLAMA_ROOT=$Root"
Write-Output "OLLAMA_HOST=$HostBind"
Write-Output "OLLAMA_CLIENT_HOST=$ClientHost"
Write-Output "OLLAMA_MODEL=$Model"
Write-Output "OLLAMA_STDOUT=$stdoutLog"
Write-Output "OLLAMA_STDERR=$stderrLog"
