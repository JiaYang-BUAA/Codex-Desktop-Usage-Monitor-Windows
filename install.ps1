[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 9335,
  [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\CodexUsageMonitor'),
  [string]$ShortcutDirectory = [Environment]::GetFolderPath('Desktop'),
  [switch]$SkipShortcut
)

$ErrorActionPreference = 'Stop'
$sourceRoot = $PSScriptRoot
$manifestPath = Join-Path $sourceRoot 'config\package-files.json'
$version = (Get-Content -LiteralPath (Join-Path $sourceRoot 'VERSION') -Raw).Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid VERSION: $version" }
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Package manifest not found: $manifestPath" }

$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$installDirectory = Join-Path $InstallRoot $version
$files = @(Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json)
if (-not $files.Count) { throw 'Package manifest is empty.' }
if (@($files | Sort-Object -Unique).Count -ne $files.Count) { throw 'Package manifest contains duplicate paths.' }

foreach ($relative in $files) {
  if ([IO.Path]::IsPathRooted($relative) -or $relative -match '(^|[\\/])\.\.([\\/]|$)') {
    throw "Unsafe package path: $relative"
  }
  $source = Join-Path $sourceRoot $relative
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Installation file missing: $relative" }
}

New-Item -ItemType Directory -Force -Path $installDirectory | Out-Null
foreach ($relative in $files) {
  $source = Join-Path $sourceRoot $relative
  $destination = Join-Path $installDirectory $relative
  $destinationParent = Split-Path -Parent $destination
  New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
}

if (-not $SkipShortcut) {
  $launcherInstaller = Join-Path $installDirectory 'scripts\install-monitor-launcher.ps1'
  & $launcherInstaller -Port $Port -DestinationDirectory $ShortcutDirectory
}

Write-Host "Codex Usage Monitor $version installed to: $installDirectory"
if ($SkipShortcut) {
  Write-Host 'Shortcut creation was skipped.'
} else {
  Write-Host 'Exit the current Codex session normally, then start Codex from the desktop shortcut: Codex Usage Monitor'
}
