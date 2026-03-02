param(
  [string]$Root = 'D:\work\turingos_llm',
  [string]$ArchivePath = '',
  [string]$DownloadUrl = 'https://ollama.com/download/ollama-windows-amd64.zip',
  [string]$FallbackDownloadUrl = 'https://github.com/ollama/ollama/releases/latest/download/ollama-windows-amd64.zip',
  [int]$MaxRetriesPerUrl = 3,
  [switch]$ForceReinstall
)

$ErrorActionPreference = 'Stop'

$binDir = Join-Path $Root 'bin'
$dlDir = Join-Path $Root 'downloads'
$extractDir = Join-Path $Root 'extract'

foreach ($dir in @($Root, $binDir, $dlDir, $extractDir)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

$ollamaExe = Join-Path $binDir 'ollama.exe'
if ((Test-Path $ollamaExe) -and (-not $ForceReinstall)) {
  & $ollamaExe --version | Out-Host
  Write-Output "OLLAMA_ALREADY_PRESENT=$ollamaExe"
  exit 0
}

function Get-FileLength {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return 0 }
  try {
    return (Get-Item -Path $Path).Length
  } catch {
    return 0
  }
}

function Download-WithRetry {
  param(
    [string]$Url,
    [string]$OutFile,
    [int]$Retries
  )

  for ($attempt = 1; $attempt -le $Retries; $attempt++) {
    try {
      if (Test-Path $OutFile) {
        Remove-Item -Path $OutFile -Force -ErrorAction SilentlyContinue
      }

      $downloadMethod = $null

      if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        Write-Host "Download attempt $attempt via curl.exe: $Url"
        & curl.exe --silent --show-error --fail --location --output $OutFile $Url | Out-Null
        if ($LASTEXITCODE -eq 0) {
          $downloadMethod = 'curl.exe'
        }
      }

      if (-not $downloadMethod -and (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue)) {
        try {
          Write-Host "Download attempt $attempt via BITS: $Url"
          Start-BitsTransfer -Source $Url -Destination $OutFile -ErrorAction Stop
          $downloadMethod = 'BITS'
        } catch {
          Write-Warning "BITS download failed, fallback to Invoke-WebRequest: $($_.Exception.Message)"
        }
      }

      if (-not $downloadMethod) {
        Write-Host "Download attempt $attempt via Invoke-WebRequest: $Url"
        Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
        $downloadMethod = 'Invoke-WebRequest'
      }

      $size = Get-FileLength -Path $OutFile
      if ($size -gt 10485760) {
        Write-Host "Download succeeded via $downloadMethod, size=$size bytes"
        return $true
      }
      throw "Downloaded file too small: $size bytes"
    } catch {
      Write-Warning "Download attempt $attempt failed for $Url : $($_.Exception.Message)"
      Start-Sleep -Seconds ([Math]::Min(5 * $attempt, 20))
    }
  }

  return $false
}

$zipPath = if ($ArchivePath) { $ArchivePath } else { Join-Path $dlDir 'ollama-windows-amd64.zip' }

if ((-not $ArchivePath) -and (Test-Path $zipPath) -and $ForceReinstall) {
  Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue
}

$archiveSize = Get-FileLength -Path $zipPath
if ($archiveSize -gt 10485760) {
  Write-Output "Using existing archive: $zipPath size=$archiveSize bytes"
} else {
  $urls = @($DownloadUrl)
  if ($FallbackDownloadUrl -and ($FallbackDownloadUrl -ne $DownloadUrl)) {
    $urls += $FallbackDownloadUrl
  }

  $downloaded = $false
  foreach ($url in $urls) {
    Write-Output "Downloading Ollama from $url ..."
    $ok = Download-WithRetry -Url $url -OutFile $zipPath -Retries $MaxRetriesPerUrl
    if ($ok -eq $true) {
      $downloaded = $true
      break
    }
  }

  if (-not $downloaded) {
    throw "Failed to download Ollama archive after trying all URLs"
  }
}

$archiveSize = Get-FileLength -Path $zipPath
if ($archiveSize -le 10485760) {
  throw "Downloaded archive missing or too small: $zipPath size=$archiveSize"
}

if (Test-Path $extractDir) {
  Remove-Item -Path $extractDir -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

Write-Output "Expanding archive ..."
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

$sourceExe = Get-ChildItem -Path $extractDir -Recurse -File -Filter 'ollama.exe' | Select-Object -First 1
if (-not $sourceExe) {
  throw "ollama.exe not found in extracted archive"
}

Get-Process ollama -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

if (Test-Path $binDir) {
  Remove-Item -Path $binDir -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

# Preserve the archive's relative layout (lib/ollama/...), required by the CLI.
Copy-Item -Path (Join-Path $extractDir '*') -Destination $binDir -Recurse -Force

if (-not (Test-Path $ollamaExe)) {
  throw "Install failed, missing $ollamaExe"
}

$runtimeLib = Join-Path $binDir 'lib\ollama\ggml-base.dll'
if (-not (Test-Path $runtimeLib)) {
  throw "Install failed, missing runtime library: $runtimeLib"
}

& $ollamaExe --version | Out-Host

Write-Output "OLLAMA_BIN=$binDir"
Write-Output "OLLAMA_EXE=$ollamaExe"
Write-Output "OLLAMA_ARCHIVE=$zipPath"
