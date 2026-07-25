[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 9335,
  [long]$InitialTokens = -1
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'monitor-utils.ps1')

if ($InitialTokens -lt 0) {
  $answer = (Read-Host '请输入当前真实累计 Token（完整整数，不含万或亿）').Trim().Replace(',', '')
  $parsed = 0L
  if (-not [long]::TryParse($answer, [ref]$parsed) -or $parsed -lt 0) { throw '累计 Token 必须是非负整数。' }
  $InitialTokens = $parsed
}

[void](Import-CodexUsagePersistedAccount)
if (-not $env:CODEX_USAGE_ACCOUNT_TOKEN -or -not $env:CODEX_USAGE_ACCOUNT_USER_ID) {
  throw '请先配置 API 账户访问令牌。'
}

$baseUrl = $(if ($env:CODEX_USAGE_ACCOUNT_BASE_URL) { $env:CODEX_USAGE_ACCOUNT_BASE_URL } else { 'https://www.cctq.ai' }).TrimEnd('/')
$headers = @{ Authorization = "Bearer $env:CODEX_USAGE_ACCOUNT_TOKEN"; 'New-Api-User' = $env:CODEX_USAGE_ACCOUNT_USER_ID; Accept = 'application/json' }
$requestedPageSize = 1000
$maximumPages = 100
$response = Invoke-RestMethod -Uri "$baseUrl/api/log/self?p=1&size=$requestedPageSize" -Headers $headers -Method Get -TimeoutSec 20
$data = if ($response.data) { $response.data } else { $response }
$items = [Collections.Generic.List[object]]::new()
foreach ($item in @($data.items)) { $items.Add($item) }
$reportedTotal = [Math]::Max($items.Count, [long]$data.total)
$reportedPageSize = [Math]::Max(1, [int]$data.page_size)
$pageCount = [Math]::Min($maximumPages, [Math]::Ceiling($reportedTotal / $reportedPageSize))
for ($page = 2; $page -le $pageCount; $page++) {
  $pageResponse = Invoke-RestMethod -Uri "$baseUrl/api/log/self?p=$page&size=$requestedPageSize" -Headers $headers -Method Get -TimeoutSec 20
  $pageData = if ($pageResponse.data) { $pageResponse.data } else { $pageResponse }
  $pageItems = @($pageData.items)
  if ($pageItems.Count -eq 0) { break }
  foreach ($item in $pageItems) { $items.Add($item) }
}

function Get-TokenLogIdentity($Item) {
  if ($null -ne $Item.id) { return "id:$($Item.id)" }
  return @($Item.created_at, $Item.prompt_tokens, $Item.completion_tokens, $Item.quota, $Item.model_name, $Item.use_time) -join '|'
}

$checkpointAt = 0L
$recentLogIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$recentLogTokens = [ordered]@{}
foreach ($item in $items) {
  $timestamp = 0L
  if ([long]::TryParse([string]$item.created_at, [ref]$timestamp) -and $timestamp -gt 0) {
    if ($timestamp -lt 100000000000) { $timestamp *= 1000 }
    if ($timestamp -gt $checkpointAt) { $checkpointAt = $timestamp }
  }
  $identity = Get-TokenLogIdentity $item
  $tokens = [Math]::Max(0L, [long]$item.prompt_tokens) + [Math]::Max(0L, [long]$item.completion_tokens)
  [void]$recentLogIds.Add($identity)
  $recentLogTokens[$identity] = $tokens
}

$dailyDate = Get-Date -Format 'yyyy-MM-dd'
$dailyTokens = 0L
$dailyLogIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$dailyLogTokens = [ordered]@{}
foreach ($item in $items) {
  $timestamp = 0L
  if (-not [long]::TryParse([string]$item.created_at, [ref]$timestamp) -or $timestamp -le 0) { continue }
  if ($timestamp -lt 100000000000) { $timestamp *= 1000 }
  if ([DateTimeOffset]::FromUnixTimeMilliseconds($timestamp).LocalDateTime.ToString('yyyy-MM-dd') -ne $dailyDate) { continue }
  $identity = Get-TokenLogIdentity $item
  $tokens = [Math]::Max(0L, [long]$item.prompt_tokens) + [Math]::Max(0L, [long]$item.completion_tokens)
  $previous = if ($dailyLogTokens.Contains($identity)) { [long]$dailyLogTokens[$identity] } else { 0L }
  $dailyTokens += $tokens - $previous
  [void]$dailyLogIds.Add($identity)
  $dailyLogTokens[$identity] = $tokens
}

Save-CodexUsageTokenBaseline -InitialTokens $InitialTokens -CheckpointAt $checkpointAt -RecentLogIds @($recentLogIds) -RecentLogTokens $recentLogTokens `
  -DailyDate $dailyDate -DailyTokens $dailyTokens -DailyLogIds @($dailyLogIds) -DailyLogTokens $dailyLogTokens
$env:CODEX_USAGE_ACCOUNT_COUNTER_PATH = $CodexUsageAccountCounterPath
$activePort = Resolve-CodexUsageCdpPort $Port
if ($activePort) {
  & (Join-Path $PSScriptRoot 'start-monitor.ps1') -Port $activePort -Replace
  if ($LASTEXITCODE -ne 0) { throw "初始值已保存，但重启监视器失败，退出码 $LASTEXITCODE。" }
  Write-Host "累计 Token 初始值已设置为 $InitialTokens，监视器已重新加载。"
} else {
  Write-Host "累计 Token 初始值已设置为 $InitialTokens；下次启动监视器时生效。"
}
