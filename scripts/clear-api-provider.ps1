[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 9335
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'monitor-utils.ps1')

$savedKey = $env:CODEX_USAGE_API_KEY
$savedConfig = $env:CODEX_USAGE_PROVIDER_CONFIG_PATH
$savedDisable = $env:CODEX_USAGE_DISABLE_PERSISTED_PROVIDER
try {
  Remove-CodexUsagePersistedProvider
  Remove-Item Env:CODEX_USAGE_API_KEY,Env:CODEX_USAGE_PROVIDER_CONFIG_PATH -ErrorAction SilentlyContinue
  $env:CODEX_USAGE_DISABLE_PERSISTED_PROVIDER = '1'
  $activePort = Resolve-CodexUsageCdpPort $Port
  if ($activePort) {
    & (Join-Path $PSScriptRoot 'start-monitor.ps1') -Port $activePort -Replace
    if ($LASTEXITCODE -ne 0) { throw "清除后重启监视器失败，退出码 $LASTEXITCODE。" }
    Write-Host 'API Provider 持久化凭据已清除；当前监视器已切换为官方订阅模式。'
  } else {
    Write-Host 'API Provider 持久化凭据已清除；下次启动监视器时将使用官方订阅模式。'
  }
} finally {
  if ($null -ne $savedKey) { $env:CODEX_USAGE_API_KEY = $savedKey } else { Remove-Item Env:CODEX_USAGE_API_KEY -ErrorAction SilentlyContinue }
  if ($null -ne $savedConfig) { $env:CODEX_USAGE_PROVIDER_CONFIG_PATH = $savedConfig } else { Remove-Item Env:CODEX_USAGE_PROVIDER_CONFIG_PATH -ErrorAction SilentlyContinue }
  if ($null -ne $savedDisable) { $env:CODEX_USAGE_DISABLE_PERSISTED_PROVIDER = $savedDisable } else { Remove-Item Env:CODEX_USAGE_DISABLE_PERSISTED_PROVIDER -ErrorAction SilentlyContinue }
}
