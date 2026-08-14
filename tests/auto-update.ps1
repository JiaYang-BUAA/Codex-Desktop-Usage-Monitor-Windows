[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "codex-auto-update-validation-$PID"
$originalLocalAppData = $env:LOCALAPPDATA

function New-TestArchive([string]$Version, [string]$Destination) {
  $staging = Join-Path $testRoot 'staging'
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  $package = Join-Path $staging "codex-usage-monitor-windows-$Version"
  foreach ($relative in @('config', 'scripts')) { New-Item -ItemType Directory -Force -Path (Join-Path $package $relative) | Out-Null }
  Set-Content -LiteralPath (Join-Path $package 'VERSION') -Value $Version -Encoding ascii
  Set-Content -LiteralPath (Join-Path $package 'install.ps1') -Value "Write-Host 'fixture'" -Encoding utf8BOM
  Set-Content -LiteralPath (Join-Path $package 'config\package-files.json') -Value '[]' -Encoding utf8
  Set-Content -LiteralPath (Join-Path $package 'scripts\start-monitor.ps1') -Value "Write-Host 'fixture'" -Encoding utf8BOM
  Set-Content -LiteralPath (Join-Path $package 'scripts\auto-update.ps1') -Value "Write-Host 'fixture'" -Encoding utf8BOM
  Compress-Archive -LiteralPath $package -DestinationPath $Destination -CompressionLevel Optimal
}

try {
  New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
  $env:LOCALAPPDATA = Join-Path $testRoot 'local'
  $archivePath = Join-Path $testRoot 'valid.zip'
  New-TestArchive '9.8.7' $archivePath
  $digest = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  & (Join-Path $root 'scripts\auto-update.ps1') -ArchivePath $archivePath -ExpectedSha256 $digest -Version '9.8.7' -ValidateOnly
  if (Test-Path -LiteralPath $archivePath) { throw 'Validated update archive was not cleaned up.' }

  $badArchivePath = Join-Path $testRoot 'bad-hash.zip'
  New-TestArchive '9.8.7' $badArchivePath
  $rejected = $false
  try {
    & (Join-Path $root 'scripts\auto-update.ps1') -ArchivePath $badArchivePath -ExpectedSha256 ('0' * 64) -Version '9.8.7' -ValidateOnly
  } catch { $rejected = $_.Exception.Message -match 'SHA-256' }
  if (-not $rejected) { throw 'A mismatched update SHA-256 was not rejected.' }
  if ((Get-Content -LiteralPath (Join-Path $env:LOCALAPPDATA 'CodexUsageMonitor\update-state.json') -Raw | ConvertFrom-Json).status -ne 'error') {
    throw 'Failed automatic update did not persist an error status.'
  }

  $unsafeArchivePath = Join-Path $testRoot 'unsafe-path.zip'
  New-TestArchive '9.8.7' $unsafeArchivePath
  Add-Type -AssemblyName System.IO.Compression
  $unsafeStream = [IO.File]::Open($unsafeArchivePath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  $unsafeZip = $null
  try {
    $unsafeZip = [IO.Compression.ZipArchive]::new($unsafeStream, [IO.Compression.ZipArchiveMode]::Update, $false)
    $unsafeEntry = $unsafeZip.CreateEntry('codex-usage-monitor-windows-9.8.7/scripts/payload.ps1:stream')
    $unsafeWriter = [IO.StreamWriter]::new($unsafeEntry.Open())
    try { $unsafeWriter.Write('fixture') } finally { $unsafeWriter.Dispose() }
  } finally {
    if ($unsafeZip) { $unsafeZip.Dispose() }
    $unsafeStream.Dispose()
  }
  $unsafeDigest = (Get-FileHash -LiteralPath $unsafeArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $unsafeRejected = $false
  try {
    & (Join-Path $root 'scripts\auto-update.ps1') -ArchivePath $unsafeArchivePath -ExpectedSha256 $unsafeDigest -Version '9.8.7' -ValidateOnly
  } catch { $unsafeRejected = $_.Exception.Message -match 'Unsafe update archive path' }
  if (-not $unsafeRejected) { throw 'A Windows alternate-data-stream update path was not rejected.' }
  Write-Host 'PASS: automatic update ZIP validation, digest verification, cleanup, and failure state.'
} finally {
  $env:LOCALAPPDATA = $originalLocalAppData
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
