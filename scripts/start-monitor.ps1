[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 9335,
  [switch]$LaunchCodex,
  [switch]$Replace,
  [switch]$Foreground
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'monitor-utils.ps1')

$injector = Join-Path $PSScriptRoot 'injector.mjs'
$node = Resolve-CodexUsageNodePath
$cliPath = Resolve-CodexUsageCliPath
if ($cliPath -and -not $env:CODEX_USAGE_CODEX_PATH) { $env:CODEX_USAGE_CODEX_PATH = $cliPath }
try {
  [void](Import-CodexUsagePersistedProvider)
} catch {
  Write-Warning $_.Exception.Message
}
try {
  [void](Import-CodexUsagePersistedAccount)
} catch {
  Write-Warning $_.Exception.Message
}
$env:CODEX_USAGE_ACCOUNT_COUNTER_PATH = $CodexUsageAccountCounterPath

$mutexName = "Local\CodexUsageMonitor-$Port"
$mutex = [Threading.Mutex]::new($false, $mutexName)
$mutexAcquired = $false
try {
  try { $mutexAcquired = $mutex.WaitOne([TimeSpan]::FromSeconds(45)) }
  catch [Threading.AbandonedMutexException] { $mutexAcquired = $true }
  if (-not $mutexAcquired) { throw '另一个监视器启动操作仍在进行，请稍后再试。' }

function Test-MonitorInjection([int]$CandidatePort, [int]$TimeoutMs = 4000) {
  & $node $injector --verify --port $CandidatePort --monitor-only --timeout-ms $TimeoutMs *> $null
  return $LASTEXITCODE -eq 0
}

$activePort = Resolve-CodexUsageCdpPort $Port
if (-not $activePort) {
  if (-not $LaunchCodex) { throw '没有找到带 CDP 的 Codex。请先使用“Codex Usage Monitor”快捷方式启动 Codex。' }
  if (@(Get-Process ChatGPT -ErrorAction SilentlyContinue).Count -gt 0) {
    throw 'Codex 已经运行但未开放 CDP。请正常退出后再使用监视器启动器；脚本不会强制结束现有会话。'
  }
  [void](Start-CodexUsagePackagedCodex -Port $Port)
  $deadline = (Get-Date).AddSeconds(30)
  while (-not (Test-CodexUsageCdpPort $Port) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 400 }
  if (-not (Test-CodexUsageCdpPort $Port)) { throw "Codex 未在 30 秒内开放本机端口 $Port。" }
  $activePort = $Port
}
$Port = $activePort

$owned = @(Get-CodexUsageInjectorProcesses | Where-Object { $_.Port -eq $Port })
$currentInjectorPath = [IO.Path]::GetFullPath($injector)
$state = Get-CodexUsageState
$reusable = @($owned | Where-Object { Test-CodexUsageReusableInjector $state $_ $currentInjectorPath })
if (-not $Replace) {
  foreach ($candidate in $reusable) {
    if (Test-MonitorInjection $Port) {
      Write-Host "Codex 用量监视器已在端口 $Port 运行（PID $($candidate.ProcessId)）。"
      return
    }
  }
}

if ($Foreground) {
  & $node $injector --watch --port $Port --monitor-only
  exit $LASTEXITCODE
}

New-Item -ItemType Directory -Force -Path $CodexUsageStateRoot | Out-Null
$launchId = "$PID-$(Get-Date -Format 'yyyyMMddHHmmssfff')"
$stdoutPath = Join-Path $CodexUsageStateRoot "injector-$launchId.log"
$stderrPath = Join-Path $CodexUsageStateRoot "injector-$launchId-error.log"
$arguments = @("`"$injector`"", '--watch', '--port', "$Port", '--monitor-only')
$daemon = Start-Process -FilePath $node -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

$verified = $false
$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Milliseconds 600
  $daemon.Refresh()
  if ($daemon.HasExited) { break }
  if (Test-MonitorInjection $Port 5000) { $verified = $true; break }
} while ((Get-Date) -lt $deadline)

if (-not $verified) {
  if (-not $daemon.HasExited) { Stop-Process -Id $daemon.Id -Force -ErrorAction SilentlyContinue }
  $detail = if (Test-Path -LiteralPath $stderrPath) { (Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue).Trim() } else { '' }
  throw "监视器注入验证失败。$detail"
}

try {
  Write-CodexUsageState ([ordered]@{
    schemaVersion = 2
    runtimeVersion = $CodexUsageVersion
    port = $Port
    injectorPid = $daemon.Id
    injectorPath = $currentInjectorPath
    startedAt = (Get-Date).ToString('o')
    stdoutPath = $stdoutPath
    stderrPath = $stderrPath
    providerConfigPath = if ($env:CODEX_USAGE_PROVIDER_CONFIG_PATH) { [IO.Path]::GetFullPath($env:CODEX_USAGE_PROVIDER_CONFIG_PATH) } else { $null }
  })
} catch {
  if (-not $daemon.HasExited) { Stop-Process -Id $daemon.Id -Force -ErrorAction SilentlyContinue }
  throw
}

foreach ($previous in $owned) {
  if ($previous.ProcessId -ne $daemon.Id) { Stop-Process -Id $previous.ProcessId -Force -ErrorAction SilentlyContinue }
}
Write-Host "Codex 用量监视器已启动：端口 $Port，PID $($daemon.Id)。"
} finally {
  if ($mutexAcquired) { try { $mutex.ReleaseMutex() } catch {} }
  $mutex.Dispose()
}
