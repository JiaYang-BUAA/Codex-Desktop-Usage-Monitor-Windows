[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 9335,
  [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\CodexUsageMonitor'),
  [string]$ShortcutDirectory = [Environment]::GetFolderPath('Desktop'),
  [switch]$SkipShortcut,
  [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
$sourceRoot = $PSScriptRoot
$manifestPath = Join-Path $sourceRoot 'config\package-files.json'
$monitorUtils = Join-Path $sourceRoot 'scripts\monitor-utils.ps1'
if (-not (Test-Path -LiteralPath $monitorUtils -PathType Leaf)) { throw "Monitor utilities not found: $monitorUtils" }
. $monitorUtils
$version = (Get-Content -LiteralPath (Join-Path $sourceRoot 'VERSION') -Raw).Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid VERSION: $version" }
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Package manifest not found: $manifestPath" }

$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$installDirectory = Join-Path $InstallRoot $version
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$files = @()
foreach ($item in $manifest) { $files += [string]$item }
if (-not $files.Count) { throw 'Package manifest is empty.' }
if (@($files | Sort-Object -Unique).Count -ne $files.Count) { throw 'Package manifest contains duplicate paths.' }

foreach ($relative in $files) {
  if ([IO.Path]::IsPathRooted($relative) -or $relative -match '(^|[\\/])\.\.([\\/]|$)') {
    throw "Unsafe package path: $relative"
  }
  $source = Join-Path $sourceRoot $relative
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Installation file missing: $relative" }
}

function Read-CodexUsageExecutablePath([string]$Label) {
  while ($true) {
    $answer = (Read-Host "$Label 路径（直接回车取消）").Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($answer)) { return $null }
    if (Test-Path -LiteralPath $answer -PathType Leaf) { return [IO.Path]::GetFullPath($answer) }
    Write-Warning "文件不存在：$answer"
  }
}

if (-not $SkipShortcut) {
  $desktopPath = $null
  $storePackage = $null
  if ($env:CODEX_USAGE_DESKTOP_PATH) {
    if (-not (Test-Path -LiteralPath $env:CODEX_USAGE_DESKTOP_PATH -PathType Leaf)) {
      throw "CODEX_USAGE_DESKTOP_PATH 不存在：$($env:CODEX_USAGE_DESKTOP_PATH)"
    }
    $desktopPath = [IO.Path]::GetFullPath($env:CODEX_USAGE_DESKTOP_PATH)
  } else {
    $storePackage = Get-CodexUsageAppPackage
    if (-not $storePackage) { $desktopPath = Resolve-CodexUsageNonStoreDesktopPath }
  }

  if (-not $storePackage -and -not $desktopPath) {
    if ($NonInteractive) {
      Write-Warning '未找到 Codex Desktop。请设置 CODEX_USAGE_DESKTOP_PATH 后重新运行 install.ps1。'
    } else {
      $desktopPath = Read-CodexUsageExecutablePath '未自动找到 Codex Desktop，请输入 ChatGPT.exe'
      if (-not $desktopPath) { throw '未提供 Codex Desktop 路径，安装已取消。' }
    }
  }

  if ($desktopPath -and -not $storePackage) {
    [Environment]::SetEnvironmentVariable('CODEX_USAGE_DESKTOP_PATH', $desktopPath, 'User')
    $env:CODEX_USAGE_DESKTOP_PATH = $desktopPath
    Write-Host "已发现非 Store Codex Desktop：$desktopPath"
  }

  $cliPath = Resolve-CodexUsageCliPath -DesktopPath $desktopPath
  if (-not $storePackage -and -not $cliPath) {
    if ($NonInteractive) {
      Write-Warning '未找到 codex.exe。官方订阅用量可能不可用；API Provider 模式仍可使用。'
    } else {
      $cliPath = Read-CodexUsageExecutablePath '未自动找到 Codex CLI，请输入 codex.exe'
      if (-not $cliPath) { Write-Warning '未提供 codex.exe，官方订阅用量可能不可用。' }
    }
  }
  if ($cliPath -and -not $storePackage) {
    [Environment]::SetEnvironmentVariable('CODEX_USAGE_CODEX_PATH', $cliPath, 'User')
    $env:CODEX_USAGE_CODEX_PATH = $cliPath
    Write-Host "已发现 Codex CLI：$cliPath"
  }
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
