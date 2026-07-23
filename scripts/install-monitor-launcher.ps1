[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 9335,
  [string]$ShortcutName = 'Codex 监视器版.lnk',
  [string]$DestinationDirectory = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'launch-codex-monitor.ps1'
$monitorUtils = Join-Path $PSScriptRoot 'monitor-utils.ps1'
. $monitorUtils
[void](Resolve-CodexUsageNodePath)
$shortcutPath = Join-Path $DestinationDirectory $ShortcutName
if (-not (Test-Path -LiteralPath $DestinationDirectory -PathType Container)) { throw "快捷方式目录不存在：$DestinationDirectory" }
$pwsh = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
if (-not $pwsh) { $pwsh = (Get-Command powershell.exe -ErrorAction Stop).Source }

$iconPath = $null
try {
  $candidate = $null
  if ($env:CODEX_USAGE_DESKTOP_PATH) {
    $candidate = [IO.Path]::GetFullPath($env:CODEX_USAGE_DESKTOP_PATH)
  } else {
    $package = Get-CodexUsageAppPackage
    if ($package) { $candidate = Join-Path $package.InstallLocation 'app\ChatGPT.exe' }
  }
  if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { $iconPath = $candidate }
} catch {}
if (-not $iconPath) { $iconPath = $pwsh }

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $pwsh
$shortcut.Arguments = "-NoLogo -NoProfile -File `"$launcher`" -Port $Port"
$shortcut.WorkingDirectory = $root
$shortcut.Description = '启动 Codex 并加载本机用量监视器'
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Save()
Write-Host "已创建桌面快捷方式：$shortcutPath"
