[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 9335
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'monitor-utils.ps1')

Remove-CodexUsageTokenBaseline
$env:CODEX_USAGE_ACCOUNT_COUNTER_PATH = $CodexUsageAccountCounterPath
$activePort = Resolve-CodexUsageCdpPort $Port
if ($activePort) {
  & (Join-Path $PSScriptRoot 'start-monitor.ps1') -Port $activePort -Replace
  if ($LASTEXITCODE -ne 0) { throw "清除后重启监视器失败，退出码 $LASTEXITCODE。" }
  Write-Host '累计 Token 初始值已清除，监视器已恢复为可见日志汇总。'
} else {
  Write-Host '累计 Token 初始值已清除。'
}
