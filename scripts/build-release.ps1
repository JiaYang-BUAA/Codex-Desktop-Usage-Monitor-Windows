[CmdletBinding()]
param(
  [string]$OutputDirectory,
  [string]$ManifestPath,
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
$manifestPath = if ($ManifestPath) { [IO.Path]::GetFullPath($ManifestPath) } else { Join-Path $root 'config\package-files.json' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$files = @()
foreach ($item in $manifest) { $files += [string]$item }
if (-not $files.Count) { throw 'Package manifest is empty.' }
$rootPrefix = [IO.Path]::GetFullPath($root).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
$seenFiles = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($relative in $files) {
  if ([string]::IsNullOrWhiteSpace($relative) -or [IO.Path]::IsPathRooted($relative) -or $relative -match '(^|[\\/])\.\.([\\/]|$)') {
    throw "Unsafe package manifest path: $relative"
  }
  if (-not $seenFiles.Add($relative)) { throw "Duplicate package manifest path: $relative" }
  $sourcePath = [IO.Path]::GetFullPath((Join-Path $root $relative))
  if (-not $sourcePath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Package manifest path escapes the repository: $relative"
  }
}
try {
  New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null
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
