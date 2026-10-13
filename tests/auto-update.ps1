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

  # The launcher supports machines without PowerShell 7. Validate a real ZIP
  # with the actual Windows PowerShell runtime, not a mocked installer script.
  $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (Test-Path -LiteralPath $windowsPowerShell -PathType Leaf) {
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

  # Evaluate only the restart command against a mock. Start-Process joins its
  # argument array into a command line, so the script path must retain quotes.
  & {
    $tokens = $null
    $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'scripts\auto-update.ps1'), [ref]$tokens, [ref]$errors)
    $restart = $ast.Find({ param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Start-Process' }, $true)
    $installedRoot = Join-Path $testRoot 'installed with spaces\9.8.7'
    $pwsh = 'mock-powershell'
    $Port = 9345
    function Start-Process {
      param($FilePath, $ArgumentList, $WindowStyle)
      if ($FilePath -ne 'mock-powershell' -or $WindowStyle -ne 'Hidden') { throw 'Update restart must stay hidden.' }
      $index = [Array]::IndexOf($ArgumentList, '-File')
      $expected = '"' + (Join-Path $installedRoot 'scripts\start-monitor.ps1') + '"'
      if ($index -lt 0 -or $ArgumentList[$index + 1] -ne $expected) { throw 'Update restart lost the quoted script path.' }
      if (($ArgumentList -join ' ') -notmatch '-Port 9345 -Replace$') { throw 'Update restart lost the selected port or replacement flag.' }
    }
    & ([scriptblock]::Create($restart.Extent.Text))
  }
  Write-Host 'PASS: automatic update ZIP validation, digest verification, cleanup, and failure state.'
} finally {
  $env:LOCALAPPDATA = $originalLocalAppData
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
