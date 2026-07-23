[CmdletBinding()]
param(
  [string]$OutputDirectory,
  [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $root 'VERSION') -Raw).Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid VERSION: $version" }
if (-not $SkipTests) {
  & (Join-Path $root 'tests\run-tests.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Windows tests failed.' }
}
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root 'dist' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$releaseName = "codex-usage-monitor-windows-$version"
$archivePath = Join-Path $OutputDirectory "$releaseName.zip"
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "codex-usage-monitor-build-$PID"
$packageRoot = Join-Path $temporaryRoot $releaseName
try {
  New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null
  $files = @(
    '.gitignore', 'CHANGELOG.md', 'LICENSE', 'NOTICE.md', 'README.md', 'VERSION', 'package.json', 'package-lock.json',
    'assets\usage-inject.js',
    'config\providers\cctq.example.json', 'config\providers\custom.example.json',
    'scripts\clear-api-provider.ps1', 'scripts\configure-api-provider.ps1', 'scripts\configure-cctq.ps1', 'scripts\injector.mjs',
    'scripts\install-monitor-launcher.ps1', 'scripts\launch-codex-monitor.ps1', 'scripts\monitor-utils.ps1',
    'scripts\restore-monitor.ps1', 'scripts\start-monitor.ps1', 'scripts\usage-client.mjs', 'scripts\validate-provider.mjs',
    'tests\provider-persistence.ps1', 'tests\run-tests.ps1', 'tests\usage-client.mjs', 'tests\usage-monitor-lifecycle.mjs'
  )
  foreach ($relative in $files) {
    $source = Join-Path $root $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Release file missing: $relative" }
    $destination = Join-Path $packageRoot $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
  }
  if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
  Compress-Archive -LiteralPath $packageRoot -DestinationPath $archivePath -CompressionLevel Optimal
  Write-Host "Built $archivePath"
} finally {
  if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
}
