[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 9335,
  [string]$Token,
  [switch]$FromClipboard,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[1-9][0-9]{0,19}$')]
  [string]$UserId,
  [string]$BaseUrl = 'https://www.cctq.ai',
  [switch]$SessionOnly
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'monitor-utils.ps1')

if ($FromClipboard) {
  $Token = [string](Get-Clipboard -Raw)
}
if ([string]::IsNullOrWhiteSpace($Token)) {
  $secureToken = Read-Host '请输入 API 账户访问令牌' -AsSecureString
  $credential = [pscredential]::new('token', $secureToken)
  $Token = $credential.GetNetworkCredential().Password
}
$Token = $Token.Trim()
if ([string]::IsNullOrWhiteSpace($Token)) { throw 'API 账户访问令牌不能为空。' }
if ($Token -notmatch '^[\x21-\x7E]+$') { throw 'API 账户访问令牌必须是单行 ASCII 文本；请重新复制令牌后再试。' }

$normalizedBaseUrl = $BaseUrl.TrimEnd('/')
$headers = @{ Authorization = "Bearer $Token"; 'New-Api-User' = $UserId; Accept = 'application/json' }
try {
  $response = Invoke-RestMethod -Uri "$normalizedBaseUrl/api/user/self" -Headers $headers -Method Get -TimeoutSec 15
  if ($null -eq $response.data) { throw '接口响应中没有账户数据。' }
} catch {
  throw "API 账户凭据验证失败：$($_.Exception.Message)"
}

if (-not $SessionOnly) {
  Save-CodexUsagePersistedAccount -Token $Token -UserId $UserId -BaseUrl $normalizedBaseUrl
}
$env:CODEX_USAGE_ACCOUNT_TOKEN = $Token
$env:CODEX_USAGE_ACCOUNT_USER_ID = $UserId
$env:CODEX_USAGE_ACCOUNT_BASE_URL = $normalizedBaseUrl

$activePort = Resolve-CodexUsageCdpPort $Port
if ($activePort) {
  & (Join-Path $PSScriptRoot 'start-monitor.ps1') -Port $activePort -Replace
  if ($LASTEXITCODE -ne 0) { throw "配置成功，但重启监视器失败，退出码 $LASTEXITCODE。" }
  Write-Host 'API 账户已配置，监视器已重新加载。'
} else {
  Write-Host 'API 账户已配置；下次从 Codex Usage Monitor 快捷方式启动时生效。'
}
