[CmdletBinding()]
param([switch]$SkipLegacyRuntime)

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

  # The launcher supports machines without PowerShell 7. Validate a real ZIP
  # with the actual Windows PowerShell runtime, not a mocked installer script.
  $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not $SkipLegacyRuntime -and (Test-Path -LiteralPath $windowsPowerShell -PathType Leaf)) {
    $legacyArchivePath = Join-Path $testRoot 'windows-powershell.zip'
    New-TestArchive '9.8.7' $legacyArchivePath
    $legacyDigest = (Get-FileHash -LiteralPath $legacyArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    & $windowsPowerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\auto-update.ps1') -ArchivePath $legacyArchivePath -ExpectedSha256 $legacyDigest -Version '9.8.7' -ValidateOnly
    if ($LASTEXITCODE -ne 0) { throw 'Update ZIP validation failed under Windows PowerShell.' }
    if (Test-Path -LiteralPath $legacyArchivePath) { throw 'Windows PowerShell did not clean up the validated archive.' }
  }

  $badArchivePath = Join-Path $testRoot 'bad-hash.zip'
  New-TestArchive '9.8.7' $badArchivePath
  $rejected = $false
  try {
    & (Join-Path $root 'scripts\auto-update.ps1') -ArchivePath $badArchivePath -ExpectedSha256 ('0' * 64) -Version '9.8.7' -ValidateOnly
  } catch { $rejected = $_.Exception.Message -match 'SHA-256' }
  if (-not $rejected) { throw 'A mismatched update SHA-256 was not rejected.' }
  $failedUpdate = Get-Content -LiteralPath (Join-Path $env:LOCALAPPDATA 'CodexUsageMonitor\update-state.json') -Raw | ConvertFrom-Json
  if ($failedUpdate.status -ne 'error' -or $failedUpdate.currentVersion -eq '9.8.7' -or $failedUpdate.latestVersion -ne '9.8.7') {
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

  # Run the actual installer with a package whose launcher only writes fixture state.
  $installRoot = Join-Path $testRoot 'installed with spaces'
  $runtimeRoot = Join-Path $installRoot '9.8.7\scripts'
  New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
  $stateRoot = Join-Path $env:LOCALAPPDATA 'CodexUsageMonitor'
  $runtimeScript = @'
param([int]$Port,[switch]$Replace)
if ($Port -ne 9345 -or -not $Replace) { throw 'Incorrect restart arguments.' }
if ($env:CODEX_USAGE_TEST_STARTUP -eq 'error') { throw 'Fixture startup failure.' }
$runtime = @{ runtimeVersion = '9.8.7'; startupPhase = $env:CODEX_USAGE_TEST_STARTUP; injectorPid = 1234; injectorPath = (Join-Path $PSScriptRoot 'injector.mjs'); startupVerifiedAt = $null }
if ($runtime.startupPhase -eq 'ready') { $runtime.startupVerifiedAt = (Get-Date).ToString('o') }
[IO.File]::WriteAllText((Join-Path $env:LOCALAPPDATA 'CodexUsageMonitor\state.json'), ($runtime | ConvertTo-Json))
'@
  Set-Content -LiteralPath (Join-Path $runtimeRoot 'start-monitor.ps1') -Value $runtimeScript -Encoding utf8BOM
  $originalFixturePhase = $env:CODEX_USAGE_TEST_STARTUP
  try {
    foreach ($phase in @('waiting-ui','ready','error')) {
      $env:CODEX_USAGE_TEST_STARTUP = $phase
      $archivePath = Join-Path $testRoot "$phase.zip"
      New-TestArchive '9.8.7' $archivePath
      $digest = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
      try {
        & (Join-Path $root 'scripts\auto-update.ps1') -ArchivePath $archivePath -ExpectedSha256 $digest -Version '9.8.7' -Port 9345 -InstallRoot $installRoot -ShortcutDirectory $testRoot
        if ($phase -eq 'error') { throw 'Fixture failure was ignored.' }
      } catch { if ($phase -ne 'error' -or $_.Exception.Message -ne 'Fixture startup failure.') { throw } }
      $update = Get-Content -LiteralPath (Join-Path $stateRoot 'update-state.json') -Raw | ConvertFrom-Json
      $expectedStatus = if ($phase -eq 'ready') { 'installed' } else { $phase }
      if ($update.status -ne $expectedStatus -or $update.installedVersion -ne '9.8.7') { throw "Incorrect update status after $phase." }
      if (($update.currentVersion -eq '9.8.7') -ne ($phase -eq 'ready')) { throw "Incorrect active version after $phase." }
      if ($phase -eq 'waiting-ui') {
        & {
          . (Join-Path $root 'scripts\monitor-utils.ps1')
          $CodexUsageVersion = '9.8.7'
          Complete-CodexUsagePendingUpdate (Join-Path $root 'scripts\injector.mjs')
          $unrelated = Get-Content -LiteralPath (Join-Path $stateRoot 'update-state.json') -Raw | ConvertFrom-Json
          if ($unrelated.status -ne 'waiting-ui') { throw 'Unrelated installation promoted the update.' }
          Complete-CodexUsagePendingUpdate (Join-Path $runtimeRoot 'injector.mjs')
          $promoted = Get-Content -LiteralPath (Join-Path $stateRoot 'update-state.json') -Raw | ConvertFrom-Json
          if ($promoted.status -ne 'installed' -or $promoted.currentVersion -ne $CodexUsageVersion) { throw 'Verified startup did not promote the pending update.' }
        }
      }
    }
  } finally { $env:CODEX_USAGE_TEST_STARTUP = $originalFixturePhase }
  Write-Host 'PASS: automatic update ZIP validation, digest verification, cleanup, and failure state.'
} finally {
  $env:LOCALAPPDATA = $originalLocalAppData
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
