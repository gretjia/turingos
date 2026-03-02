param(
  [string]$Root = 'D:\work\turingos_llm',
  [string]$TaskName = 'TuringOS-Worker-Cleanup',
  [int]$EveryMinutes = 30,
  [int]$KeepHours = 24,
  [int]$KeepLatestCaseDirs = 300,
  [string]$BaselineTmpDir = 'D:\work\Omega_vNext\benchmarks\tmp\baseline_dualbrain'
)

$ErrorActionPreference = 'Stop'

$cleanupScript = Join-Path $PSScriptRoot 'cleanup_worker_cache.ps1'
if (-not (Test-Path $cleanupScript)) {
  throw "cleanup script not found: $cleanupScript"
}

$taskCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$cleanupScript`" -Root `"$Root`" -KeepHours $KeepHours -KeepLatestCaseDirs $KeepLatestCaseDirs -BaselineTmpDir `"$BaselineTmpDir`""
$createArgs = @(
  '/Create',
  '/TN', $TaskName,
  '/SC', 'MINUTE',
  '/MO', "$EveryMinutes",
  '/TR', $taskCmd,
  '/F'
)

$createResult = & schtasks.exe @createArgs 2>&1
$createText = ($createResult | Out-String).Trim()

Write-Output "TASK_NAME=$TaskName"
Write-Output "TASK_INTERVAL_MIN=$EveryMinutes"
Write-Output "TASK_CREATE_RESULT=$createText"
