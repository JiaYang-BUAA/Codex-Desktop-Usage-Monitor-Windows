[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 9335
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'monitor-utils.ps1')

$savedToken = $env:CODEX_USAGE_ACCOUNT_TOKEN
$savedUserId = $env:CODEX_USAGE_ACCOUNT_USER_ID
$savedBaseUrl = $env:CODEX_USAGE_ACCOUNT_BASE_URL
$savedDisable = $env:CODEX_USAGE_DISABLE_PERSISTED_ACCOUNT
try {
  Remove-CodexUsagePersistedAccount
  Remove-Item Env:CODEX_USAGE_ACCOUNT_TOKEN,Env:CODEX_USAGE_ACCOUNT_USER_ID,Env:CODEX_USAGE_ACCOUNT_BASE_URL -ErrorAction SilentlyContinue
  $env:CODEX_USAGE_DISABLE_PERSISTED_ACCOUNT = '1'
  $activePort = Resolve-CodexUsageCdpPort $Port
  if ($activePort) {
    & (Join-Path $PSScriptRoot 'start-monitor.ps1') -Port $activePort -Replace
    if ($LASTEXITCODE -ne 0) { throw "清除后重启监视器失败，退出码 $LASTEXITCODE。" }
    Write-Host 'API 账户持久化凭据已清除，监视器已重新加载。'
  } else {
    Write-Host 'API 账户持久化凭据已清除。'
  }
} finally {
  if ($null -ne $savedToken) { $env:CODEX_USAGE_ACCOUNT_TOKEN = $savedToken } else { Remove-Item Env:CODEX_USAGE_ACCOUNT_TOKEN -ErrorAction SilentlyContinue }
  if ($null -ne $savedUserId) { $env:CODEX_USAGE_ACCOUNT_USER_ID = $savedUserId } else { Remove-Item Env:CODEX_USAGE_ACCOUNT_USER_ID -ErrorAction SilentlyContinue }
  if ($null -ne $savedBaseUrl) { $env:CODEX_USAGE_ACCOUNT_BASE_URL = $savedBaseUrl } else { Remove-Item Env:CODEX_USAGE_ACCOUNT_BASE_URL -ErrorAction SilentlyContinue }
  if ($null -ne $savedDisable) { $env:CODEX_USAGE_DISABLE_PERSISTED_ACCOUNT = $savedDisable } else { Remove-Item Env:CODEX_USAGE_DISABLE_PERSISTED_ACCOUNT -ErrorAction SilentlyContinue }
}
