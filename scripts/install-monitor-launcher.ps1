[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 9335,
  [string]$ShortcutName = 'Codex Usage Monitor.lnk',
  [string]$DestinationDirectory = [Environment]::GetFolderPath('Desktop'),
  [string]$IconCachePath = (Join-Path $env:LOCALAPPDATA 'CodexUsageMonitor\codex-usage-monitor-v2.ico'),
  [string]$IconSourcePath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$hiddenLauncher = Join-Path $PSScriptRoot 'launch-codex-monitor-hidden.vbs'
$monitorUtils = Join-Path $PSScriptRoot 'monitor-utils.ps1'
. $monitorUtils
[void](Resolve-CodexUsageNodePath)
$shortcutPath = Join-Path $DestinationDirectory $ShortcutName
if (-not (Test-Path -LiteralPath $DestinationDirectory -PathType Container)) { throw "快捷方式目录不存在：$DestinationDirectory" }
if (-not (Test-Path -LiteralPath $hiddenLauncher -PathType Leaf)) { throw "隐藏启动器不存在：$hiddenLauncher" }
$pwsh = Resolve-CodexUsagePowerShellPath
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $wscript -PathType Leaf)) { throw "Windows Script Host 不存在：$wscript" }

function Export-CodexUsageShortcutIcon {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$DestinationPath
  )

  if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) { return $false }
  $destinationDirectory = Split-Path -Parent $DestinationPath
  New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
  $temporary = "$DestinationPath.$PID.tmp"
  $image = $null
  $writer = $null
  $stream = $null
  try {
    Add-Type -AssemblyName System.Drawing
    $image = [Drawing.Image]::FromFile([IO.Path]::GetFullPath($SourcePath))
    if ($image.RawFormat.Guid -ne [Drawing.Imaging.ImageFormat]::Png.Guid -or
      $image.Width -ne $image.Height -or $image.Width -lt 16 -or $image.Width -gt 256) { return $false }
    $pngBytes = [IO.File]::ReadAllBytes([IO.Path]::GetFullPath($SourcePath))
    $stream = [IO.File]::Open($temporary, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $writer = [IO.BinaryWriter]::new($stream)
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]1)
    $writer.Write([byte]$(if ($image.Width -eq 256) { 0 } else { $image.Width }))
    $writer.Write([byte]$(if ($image.Height -eq 256) { 0 } else { $image.Height }))
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$pngBytes.Length)
    $writer.Write([uint32]22)
    $writer.Write([byte[]]$pngBytes)
    $writer.Flush()
    $stream.Flush()
    if ((Get-Item -LiteralPath $temporary -ErrorAction Stop).Length -lt 100) { return $false }
    $writer.Dispose()
    $writer = $null
    $stream.Dispose()
    $stream = $null
    Move-Item -LiteralPath $temporary -Destination $DestinationPath -Force
    return $true
  } catch {
    return $false
  } finally {
    if ($writer) { $writer.Dispose() }
    if ($stream) { $stream.Dispose() }
    if ($image) { $image.Dispose() }
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
}

$IconCachePath = [IO.Path]::GetFullPath($IconCachePath)
$iconPath = if ((Test-Path -LiteralPath $IconCachePath -PathType Leaf) -and (Get-Item -LiteralPath $IconCachePath).Length -ge 100) {
  $IconCachePath
} else {
  if (-not ($IconSourcePath -and (Export-CodexUsageShortcutIcon -SourcePath $IconSourcePath -DestinationPath $IconCachePath))) {
    try {
      $package = Get-CodexUsageAppPackage
      if ($package) {
        foreach ($asset in @('assets\Square44x44Logo.targetsize-256_altform-unplated.png', 'assets\Square150x150Logo.scale-200.png')) {
          if (Export-CodexUsageShortcutIcon -SourcePath (Join-Path $package.InstallLocation $asset) -DestinationPath $IconCachePath) { break }
        }
      }
    } catch {}
  }
  if ((Test-Path -LiteralPath $IconCachePath -PathType Leaf) -and (Get-Item -LiteralPath $IconCachePath).Length -ge 100) {
    $IconCachePath
  } else {
    $pwsh
  }
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $wscript
$shortcut.Arguments = "`"$hiddenLauncher`" `"$pwsh`" $Port"
$shortcut.WorkingDirectory = $root
$shortcut.Description = '启动 Codex 并加载本机用量监视器'
$shortcut.IconLocation = "$iconPath,0"
$shortcut.WindowStyle = 7
$shortcut.Save()
try {
  if (-not ('CodexUsageMonitorShell.ShortcutRefresh' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace CodexUsageMonitorShell {
  public static class ShortcutRefresh {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern void SHChangeNotify(uint eventId, uint flags, string item1, IntPtr item2);
    public static void Notify(string path) { SHChangeNotify(0x00002000, 0x0005, path, IntPtr.Zero); }
  }
}
'@
  }
  [CodexUsageMonitorShell.ShortcutRefresh]::Notify([IO.Path]::GetFullPath($shortcutPath))
} catch {}

$legacyShortcutPath = Join-Path $DestinationDirectory 'Codex 监视器版.lnk'
if ($legacyShortcutPath -ne $shortcutPath -and (Test-Path -LiteralPath $legacyShortcutPath -PathType Leaf)) {
  Remove-Item -LiteralPath $legacyShortcutPath -Force
}
Write-Host "已创建桌面快捷方式：$shortcutPath"
