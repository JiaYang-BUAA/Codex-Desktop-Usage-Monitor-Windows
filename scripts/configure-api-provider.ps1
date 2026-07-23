[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 9335,
  [string]$ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'config\providers\cctq.example.json'),
  [switch]$FromClipboard,
  [switch]$SessionOnly
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
  if (-not $SessionOnly) {
    Save-CodexUsagePersistedProvider -ConfigPath $resolvedConfig -ApiKey $plainKey
  }
  $env:CODEX_USAGE_API_KEY = $plainKey
  $env:CODEX_USAGE_PROVIDER_CONFIG_PATH = $resolvedConfig
  try {
    & (Join-Path $PSScriptRoot 'start-monitor.ps1') -Port $Port -Replace
    if ($LASTEXITCODE -ne 0) { throw "API 用量监视器启动失败，退出码 $LASTEXITCODE。" }
  } catch {
    if (-not $SessionOnly) { throw "API Provider 已安全保存，但本次监视器启动失败：$($_.Exception.Message)" }
    throw
  }
  if ($SessionOnly) {
    Write-Host 'API Provider 已启用。本次为仅会话模式，后台进程或 Windows 重启后需要重新配置。'
  } else {
    Write-Host 'API Provider 已启用。Key 已使用当前 Windows 用户 DPAPI 加密保存，重启后会自动恢复。'
  }
} finally {
  if ($null -ne $savedKey) { $env:CODEX_USAGE_API_KEY = $savedKey } else { Remove-Item Env:CODEX_USAGE_API_KEY -ErrorAction SilentlyContinue }
  if ($null -ne $savedConfig) { $env:CODEX_USAGE_PROVIDER_CONFIG_PATH = $savedConfig } else { Remove-Item Env:CODEX_USAGE_PROVIDER_CONFIG_PATH -ErrorAction SilentlyContinue }
  $plainKey = $null
  $secureKey = $null
  if ($FromClipboard) { Set-Clipboard '' }
}
