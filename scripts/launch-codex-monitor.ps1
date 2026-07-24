[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 9335,
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'monitor-utils.ps1')

function Get-CodexMonitorLaunchPlan([bool]$DebugReady, [bool]$CodexRunning) {
  if ($DebugReady) { return 'reuse-codex' }
  if ($CodexRunning) { return 'blocked-running-without-cdp' }
  return 'launch-codex'
}

if ($SelfTest) {
  $cases = @(
    @{ DebugReady = $true; CodexRunning = $true; Expected = 'reuse-codex' },
    @{ DebugReady = $true; CodexRunning = $false; Expected = 'reuse-codex' },
    @{ DebugReady = $false; CodexRunning = $true; Expected = 'blocked-running-without-cdp' },
    @{ DebugReady = $false; CodexRunning = $false; Expected = 'launch-codex' }
  )
  foreach ($case in $cases) {
    if ((Get-CodexMonitorLaunchPlan $case.DebugReady $case.CodexRunning) -ne $case.Expected) { throw '监视器启动决策测试失败。' }
  }
  $injectorPath = Join-Path $PSScriptRoot 'injector.mjs'
  $injectorProcess = [pscustomobject]@{ ProcessId = 42; InjectorPath = $injectorPath }
  $legacyState = [pscustomobject]@{ injectorPid = 42; injectorPath = $injectorPath }
  $currentState = [pscustomobject]@{ injectorPid = 42; injectorPath = $injectorPath; runtimeVersion = $CodexUsageVersion }
  if (Test-CodexUsageReusableInjector $legacyState $injectorProcess $injectorPath) { throw '旧版状态不应复用新版监视器进程。' }
  if (-not (Test-CodexUsageReusableInjector $currentState $injectorProcess $injectorPath)) { throw '当前版本状态应允许复用监视器进程。' }
  $testListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  try {
    $testListener.Server.ExclusiveAddressUse = $true
    $testListener.Start()
    $occupiedPort = ([Net.IPEndPoint]$testListener.LocalEndpoint).Port
    if (Test-CodexUsageTcpPortAvailable $occupiedPort) { throw '已占用端口不应被识别为可用。' }
    $availablePort = Resolve-CodexUsageAvailablePort -PreferredPort $occupiedPort -SearchCount 2
    if ($availablePort -ne ($occupiedPort + 1)) { throw '端口冲突时应选择后续可用端口。' }
  } finally {
    $testListener.Stop()
  }
  if (-not (Test-CodexUsageTcpPortAvailable $occupiedPort)) { throw '监听器关闭后端口应恢复可用。' }
  Write-Host 'PASS: Codex monitor launcher decisions.'
  return
}

function Show-CodexMonitorMessage([string]$Message, [string]$Icon = 'Information') {
  try {
    Add-Type -AssemblyName PresentationFramework
    [void][System.Windows.MessageBox]::Show($Message, 'Codex 用量监视器', [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::$Icon)
  } catch { Write-Error $Message }
}

function Write-CodexMonitorLaunchError([string]$Message) {
  try {
    New-Item -ItemType Directory -Force -Path $CodexUsageStateRoot | Out-Null
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
    [IO.File]::WriteAllText((Join-Path $CodexUsageStateRoot 'launcher-error.log'), $line, $CodexUsageUtf8)
  } catch {}
}

try {
  $activePort = Resolve-CodexUsageCdpPort $Port
  $debugReady = [bool]$activePort
  $codexRunning = @(Get-Process ChatGPT -ErrorAction SilentlyContinue).Count -gt 0
  $plan = Get-CodexMonitorLaunchPlan $debugReady $codexRunning
  if ($plan -eq 'blocked-running-without-cdp') {
    Show-CodexMonitorMessage 'Codex 已通过原生入口运行，无法在不中断会话的情况下补加监视端口。请先正常退出 Codex，再点击“Codex Usage Monitor”。' 'Warning'
    exit 2
  }
  if ($debugReady) { $Port = $activePort }
  if (-not $debugReady) {
    $Port = Resolve-CodexUsageAvailablePort -PreferredPort $Port
    [void](Start-CodexUsagePackagedCodex -Port $Port)
    $deadline = (Get-Date).AddSeconds(30)
    while (-not (Test-CodexUsageCdpPort $Port) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 400 }
    if (-not (Test-CodexUsageCdpPort $Port)) { throw "Codex 未在 30 秒内开放端口 $Port。" }
  }
  & (Join-Path $PSScriptRoot 'start-monitor.ps1') -Port $Port
  if ($LASTEXITCODE -ne 0) { throw "监视器启动脚本退出码：$LASTEXITCODE" }
} catch {
  $message = "启动失败。`n`n$($_.Exception.Message)"
  Write-CodexMonitorLaunchError $message
  Show-CodexMonitorMessage $message 'Error'
  exit 1
}
