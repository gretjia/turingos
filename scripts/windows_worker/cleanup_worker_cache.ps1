param(
  [string]$Root = 'D:\work\turingos_llm',
  [int]$KeepHours = 24,
  [int]$KeepLatestCaseDirs = 300,
  [string]$BaselineTmpDir = 'D:\work\Omega_vNext\benchmarks\tmp\baseline_dualbrain'
)

$ErrorActionPreference = 'Stop'

function Remove-OldFiles {
  param(
    [string]$Path,
    [datetime]$Cutoff
  )
  if (-not (Test-Path $Path)) {
    return 0
  }
  $removed = 0
  Get-ChildItem -Path $Path -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $Cutoff } |
    ForEach-Object {
      Remove-Item -Path $_.FullName -Force -ErrorAction SilentlyContinue
      $removed += 1
    }
  return $removed
}

function Remove-OldCaseDirs {
  param(
    [string]$Path,
    [int]$KeepLatest
  )
  if (-not (Test-Path $Path)) {
    return 0
  }
  $dirs = Get-ChildItem -Path $Path -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^case_\d{6}$' } |
    Sort-Object Name
  if ($dirs.Count -le $KeepLatest) {
    return 0
  }
  $toRemove = $dirs | Select-Object -First ($dirs.Count - $KeepLatest)
  $removed = 0
  foreach ($dir in $toRemove) {
    Remove-Item -Path $dir.FullName -Recurse -Force -ErrorAction SilentlyContinue
    $removed += 1
  }
  return $removed
}

$cutoff = (Get-Date).AddHours(-1 * [math]::Abs($KeepHours))
$tmpDir = Join-Path $Root 'tmp'
$cacheDir = Join-Path $Root 'cache'
$logsDir = Join-Path $Root 'logs'

$removedTmp = Remove-OldFiles -Path $tmpDir -Cutoff $cutoff
$removedCache = Remove-OldFiles -Path $cacheDir -Cutoff $cutoff
$removedLogs = Remove-OldFiles -Path $logsDir -Cutoff $cutoff
$removedCaseDirs = Remove-OldCaseDirs -Path $BaselineTmpDir -KeepLatest $KeepLatestCaseDirs

Write-Output "CLEANUP_ROOT=$Root"
Write-Output "CUTOFF=$($cutoff.ToString('s'))"
Write-Output "REMOVED_TMP_FILES=$removedTmp"
Write-Output "REMOVED_CACHE_FILES=$removedCache"
Write-Output "REMOVED_LOG_FILES=$removedLogs"
Write-Output "REMOVED_CASE_DIRS=$removedCaseDirs"
