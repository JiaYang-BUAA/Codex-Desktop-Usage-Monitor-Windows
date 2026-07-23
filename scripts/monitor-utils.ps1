Set-StrictMode -Version 2.0

$CodexUsageRoot = Split-Path -Parent $PSScriptRoot
$CodexUsageStateRoot = Join-Path $env:LOCALAPPDATA 'CodexUsageMonitor'
$CodexUsageStatePath = Join-Path $CodexUsageStateRoot 'state.json'
$CodexUsageLegacyStatePath = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin\state.json'
$CodexUsageVersion = (Get-Content -LiteralPath (Join-Path $CodexUsageRoot 'VERSION') -Raw).Trim()
$CodexUsageUtf8 = [Text.UTF8Encoding]::new($false)
try { [Console]::OutputEncoding = $CodexUsageUtf8 } catch {}
$global:OutputEncoding = $CodexUsageUtf8

function Resolve-CodexUsageNodePath {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  $candidates = @(
    (Join-Path $CodexUsageRoot 'runtime\node.exe'),
    $env:CODEX_USAGE_NODE_PATH,
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'),
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    $(if ($nodeCommand) { $nodeCommand.Source } else { $null })
  ) | Where-Object { $_ } | Select-Object -Unique
  $outdated = @()
  foreach ($candidate in $candidates) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    $version = (& $candidate -p 'process.versions.node' 2>$null)
    $major = 0
    if ($LASTEXITCODE -eq 0 -and [int]::TryParse(([string]$version).Split('.')[0], [ref]$major) -and $major -ge 22) {
      return [IO.Path]::GetFullPath($candidate)
    }
    $outdated += "${candidate} ($version)"
  }
  if ($outdated.Count) { throw "需要 Node.js 22+。已找到但版本不兼容：$($outdated -join ', ')" }
  throw 'Node.js 未找到。请安装 Node.js 22+，或设置 CODEX_USAGE_NODE_PATH。'
}

function Get-CodexUsageAppPackage {
  $packageNames = @($env:CODEX_USAGE_APP_PACKAGE_NAME, 'OpenAI.Codex') | Where-Object { $_ } | Select-Object -Unique
  foreach ($name in $packageNames) {
    $package = Get-AppxPackage -Name $name -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
    if ($package) { return $package }
  }
  try {
    $package = Get-AppxPackage -ErrorAction Stop | Where-Object {
      $_.InstallLocation -and
      ($_.Name -match '(?i)OpenAI|Codex|ChatGPT') -and
      (Test-Path -LiteralPath (Join-Path $_.InstallLocation 'app\ChatGPT.exe') -PathType Leaf)
    } | Sort-Object Version -Descending | Select-Object -First 1
    if ($package) { return $package }
  } catch {}

  $codexCommand = Get-Command codex.exe -ErrorAction SilentlyContinue
  $codexPath = @($env:CODEX_USAGE_CODEX_PATH, $(if ($codexCommand) { $codexCommand.Source } else { $null })) |
    Where-Object { $_ -and $_ -match '(?i)[\\/]WindowsApps[\\/]' -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
    Select-Object -First 1
  if (-not $codexPath) { return $null }
  $installLocation = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent ([IO.Path]::GetFullPath($codexPath))))
  $folderName = Split-Path -Leaf $installLocation
  $match = [regex]::Match($folderName, '^(?<name>.+)_(?<version>\d+(?:\.\d+){3})_[^_]+__(?<publisher>[^_]+)$')
  if (-not $match.Success -or -not (Test-Path -LiteralPath (Join-Path $installLocation 'AppxManifest.xml') -PathType Leaf)) { return $null }
  return [pscustomobject]@{
    Name = $match.Groups['name'].Value
    InstallLocation = $installLocation
    PackageFamilyName = "$($match.Groups['name'].Value)_$($match.Groups['publisher'].Value)"
    Version = [version]$match.Groups['version'].Value
  }
}

function Resolve-CodexUsageCliPath {
  $command = Get-Command codex.exe -ErrorAction SilentlyContinue
  $package = Get-CodexUsageAppPackage
  $candidates = @(
    $env:CODEX_USAGE_CODEX_PATH,
    $(if ($command) { $command.Source } else { $null }),
    $(if ($package) { Join-Path $package.InstallLocation 'app\resources\codex.exe' } else { $null }),
    (Join-Path $env:LOCALAPPDATA 'Programs\OpenAI Codex CLI\codex.exe')
  ) | Where-Object { $_ } | Select-Object -Unique
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return [IO.Path]::GetFullPath($candidate) }
  }
  return $null
}

function Get-CodexUsageState {
  foreach ($statePath in @($CodexUsageStatePath, $CodexUsageLegacyStatePath)) {
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { continue }
    try { return Get-Content -LiteralPath $statePath -Raw -Encoding utf8 | ConvertFrom-Json } catch {}
  }
  return $null
}

function Get-CodexUsageInjectorPathFromCommandLine([string]$CommandLine) {
  if (-not $CommandLine -or $CommandLine -notmatch '(?i)(?:^|\s)--watch(?:\s|$)') { return $null }
  $match = [regex]::Match($CommandLine, '(?i)(?:"(?<quoted>[^\"]*[\\/]scripts[\\/]injector\.mjs)"|(?<plain>\S*[\\/]scripts[\\/]injector\.mjs))')
  if (-not $match.Success) { return $null }
  $value = if ($match.Groups['quoted'].Success) { $match.Groups['quoted'].Value } else { $match.Groups['plain'].Value }
  try { return [IO.Path]::GetFullPath($value) } catch { return $null }
}

function Test-CodexUsagePackagePath([string]$InjectorPath) {
  if (-not $InjectorPath) { return $false }
  try {
    $full = [IO.Path]::GetFullPath($InjectorPath)
    if ([IO.Path]::GetFileName($full) -ine 'injector.mjs') { return $false }
    $scripts = Split-Path -Parent $full
    $package = Split-Path -Parent $scripts
    foreach ($relative in @('VERSION', 'assets\usage-inject.js', 'scripts\usage-client.mjs', 'scripts\monitor-utils.ps1')) {
      if (-not (Test-Path -LiteralPath (Join-Path $package $relative) -PathType Leaf)) { return $false }
    }
    return $true
  } catch { return $false }
}

function Get-CodexUsageInjectorProcesses {
  try {
    foreach ($process in Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop) {
      $commandLine = [string]$process.CommandLine
      $injectorPath = Get-CodexUsageInjectorPathFromCommandLine $commandLine
      if (-not $injectorPath -or -not (Test-CodexUsagePackagePath $injectorPath)) { continue }
      $port = 0
      $match = [regex]::Match($commandLine, '(?i)(?:^|\s)--port(?:=|\s+)(\d+)(?:\s|$)')
      if ($match.Success) { [void][int]::TryParse($match.Groups[1].Value, [ref]$port) }
      [pscustomobject]@{
        ProcessId = [int]$process.ProcessId
        ParentProcessId = [int]$process.ParentProcessId
        InjectorPath = $injectorPath
        Port = $port
        CommandLine = $commandLine
      }
    }
  } catch {}
}

function Get-CodexUsageInjectorById([int]$ProcessId) {
  if ($ProcessId -le 0) { return $null }
  return Get-CodexUsageInjectorProcesses | Where-Object { $_.ProcessId -eq $ProcessId } | Select-Object -First 1
}

function Test-CodexUsageReusableInjector($State, $InjectorProcess, [string]$InjectorPath) {
  if (-not $State -or -not $InjectorProcess -or -not $InjectorPath) { return $false }
  $statePid = if ($State.PSObject.Properties['injectorPid']) { [int]$State.injectorPid } else { 0 }
  $statePath = if ($State.PSObject.Properties['injectorPath']) { [string]$State.injectorPath } else { '' }
  $stateVersion = if ($State.PSObject.Properties['runtimeVersion']) { [string]$State.runtimeVersion } else { '' }
  return $InjectorProcess.ProcessId -eq $statePid -and
    $InjectorProcess.InjectorPath -eq $InjectorPath -and
    $statePath -eq $InjectorPath -and
    $stateVersion -eq $CodexUsageVersion
}

function Get-CodexUsageTargets([int]$Port) {
  if ($Port -lt 1024 -or $Port -gt 65535) { return @() }
  foreach ($hostName in @('127.0.0.1', '[::1]', 'localhost')) {
    $response = $null
    $reader = $null
    try {
      $request = [Net.HttpWebRequest]::Create("http://${hostName}:$Port/json/list")
      $request.Proxy = $null
      $request.Timeout = 1000
      $response = $request.GetResponse()
      $reader = [IO.StreamReader]::new($response.GetResponseStream(), $CodexUsageUtf8)
      return @(($reader.ReadToEnd() | ConvertFrom-Json))
    } catch {} finally {
      if ($reader) { $reader.Dispose() }
      if ($response) { $response.Dispose() }
    }
  }
  return @()
}

function Test-CodexUsageCdpPort([int]$Port) {
  return [bool](Get-CodexUsageTargets $Port | Where-Object { $_.type -eq 'page' -and [string]$_.url -like 'app://*' })
}

function Resolve-CodexUsageCdpPort {
  [CmdletBinding()]
  param([ValidateRange(1024, 65535)][int]$PreferredPort = 9335)
  $candidates = [Collections.Generic.List[int]]::new()
  foreach ($candidate in @($PreferredPort, 9229, 9335)) {
    if (-not $candidates.Contains($candidate)) { $candidates.Add($candidate) }
  }
  try {
    foreach ($process in Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" -ErrorAction Stop) {
      foreach ($match in [regex]::Matches([string]$process.CommandLine, '--remote-debugging-port(?:=|\s+)(\d+)')) {
        $candidate = [int]$match.Groups[1].Value
        if (-not $candidates.Contains($candidate)) { $candidates.Add($candidate) }
      }
    }
  } catch {}
  $activePortPath = Join-Path $env:APPDATA 'Codex\DevToolsActivePort'
  if (Test-Path -LiteralPath $activePortPath -PathType Leaf) {
    $candidate = 0
    if ([int]::TryParse([string](Get-Content -LiteralPath $activePortPath -TotalCount 1), [ref]$candidate) -and -not $candidates.Contains($candidate)) { $candidates.Add($candidate) }
  }
  $state = Get-CodexUsageState
  if ($state -and $state.port -and -not $candidates.Contains([int]$state.port)) { $candidates.Add([int]$state.port) }
  foreach ($candidate in $candidates) { if (Test-CodexUsageCdpPort $candidate) { return $candidate } }
  return 0
}

function Start-CodexUsagePackagedCodex {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1024, 65535)]
    [int]$Port
  )
  $arguments = @(
    "--remote-debugging-port=$Port",
    '--remote-debugging-address=127.0.0.1',
    "--remote-allow-origins=http://127.0.0.1:$Port"
  )
  if ($env:CODEX_USAGE_DESKTOP_PATH) {
    $desktopPath = [IO.Path]::GetFullPath($env:CODEX_USAGE_DESKTOP_PATH)
    if (-not (Test-Path -LiteralPath $desktopPath -PathType Leaf)) { throw "CODEX_USAGE_DESKTOP_PATH 不存在：$desktopPath" }
    $process = Start-Process -FilePath $desktopPath -ArgumentList $arguments -PassThru
    return [pscustomobject]@{ ProcessId = $process.Id; Port = $Port; AppUserModelId = $null }
  }
  $appUserModelId = $env:CODEX_USAGE_APP_USER_MODEL_ID
  if (-not $appUserModelId) {
    $package = Get-CodexUsageAppPackage
    if (-not $package) { throw '未找到 Codex Store 应用包。可通过 CODEX_USAGE_APP_PACKAGE_NAME 或 CODEX_USAGE_DESKTOP_PATH 指定其他安装。' }
    $manifestPath = Join-Path $package.InstallLocation 'AppxManifest.xml'
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
      $manifest = [xml](Get-Content -LiteralPath $manifestPath -Raw)
    } else {
      $manifest = Get-AppxPackageManifest -Package $package
    }
    $applications = @($manifest.Package.Applications.Application)
    $application = $applications | Where-Object { [string]$_.Executable -match '(?i)ChatGPT\.exe$' } | Select-Object -First 1
    if (-not $application) { $application = $applications | Select-Object -First 1 }
    if (-not $application -or -not $application.Id) { throw '无法解析 Codex 应用入口。' }
    $appUserModelId = "$($package.PackageFamilyName)!$($application.Id)"
  }
  if (-not ('CodexUsageMonitorActivation.Launcher' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace CodexUsageMonitorActivation {
  [Flags] public enum ActivateOptions { None = 0, DesignMode = 1, NoErrorUI = 2, NoSplashScreen = 4 }
  [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IApplicationActivationManager {
    [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId, [MarshalAs(UnmanagedType.LPWStr)] string arguments, ActivateOptions options, out uint processId);
  }
  [ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")] public class ApplicationActivationManager {}
  public static class Launcher {
    public static uint Activate(string id, string args) {
      var manager = (IApplicationActivationManager)new ApplicationActivationManager();
      uint processId;
      int result = manager.ActivateApplication(id, args, ActivateOptions.NoErrorUI, out processId);
      Marshal.ThrowExceptionForHR(result);
      return processId;
    }
  }
}
'@
  }
  $processId = [CodexUsageMonitorActivation.Launcher]::Activate($appUserModelId, ($arguments -join ' '))
  return [pscustomobject]@{ ProcessId = [int]$processId; Port = $Port; AppUserModelId = $appUserModelId }
}

function Write-CodexUsageState($State) {
  New-Item -ItemType Directory -Force -Path $CodexUsageStateRoot | Out-Null
  $temporary = "$CodexUsageStatePath.$PID.tmp"
  try {
    $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding utf8
    Move-Item -LiteralPath $temporary -Destination $CodexUsageStatePath -Force
  } finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
}
