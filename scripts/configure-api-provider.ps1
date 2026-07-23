[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 9335,
  [string]$ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'config\providers\cctq.example.json'),
  [switch]$FromClipboard
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'monitor-utils.ps1')
$resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath -ErrorAction Stop).Path
$node = Resolve-CodexUsageNodePath
& $node (Join-Path $PSScriptRoot 'validate-provider.mjs') $resolvedConfig *> $null
if ($LASTEXITCODE -ne 0) { throw 'API Provider 配置校验失败。' }

$savedKey = $env:CODEX_USAGE_API_KEY
$savedConfig = $env:CODEX_USAGE_PROVIDER_CONFIG_PATH
$plainKey = $null
$secureKey = $null
try {
  if ($FromClipboard) {
    $plainKey = (Get-Clipboard -Raw).Trim()
    if (-not $plainKey) { throw '剪贴板为空。请先复制 API key。' }
  } else {
    $secureKey = Read-Host '请输入 API key' -AsSecureString
    $plainKey = [Net.NetworkCredential]::new('', $secureKey).Password
  }
  if (-not $plainKey) { throw 'API key 不能为空。' }
  $env:CODEX_USAGE_API_KEY = $plainKey
  $env:CODEX_USAGE_PROVIDER_CONFIG_PATH = $resolvedConfig
  & (Join-Path $PSScriptRoot 'start-monitor.ps1') -Port $Port -Replace
  if ($LASTEXITCODE -ne 0) { throw "API 用量监视器启动失败，退出码 $LASTEXITCODE。" }
  Write-Host 'API Provider 已启用。Key 只保留在后台 Node 进程内存中。'
} finally {
  if ($null -ne $savedKey) { $env:CODEX_USAGE_API_KEY = $savedKey } else { Remove-Item Env:CODEX_USAGE_API_KEY -ErrorAction SilentlyContinue }
  if ($null -ne $savedConfig) { $env:CODEX_USAGE_PROVIDER_CONFIG_PATH = $savedConfig } else { Remove-Item Env:CODEX_USAGE_PROVIDER_CONFIG_PATH -ErrorAction SilentlyContinue }
  $plainKey = $null
  $secureKey = $null
  if ($FromClipboard) { Set-Clipboard '' }
}
