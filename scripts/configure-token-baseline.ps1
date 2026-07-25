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

function Invoke-AccountLogPage([int]$Page) {
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      return Invoke-RestMethod -Uri "$baseUrl/api/log/self?p=$Page&size=$requestedPageSize" -Headers $headers -Method Get -TimeoutSec 20
    } catch {
      if ($attempt -eq 3) { throw }
      Start-Sleep -Milliseconds (500 * $attempt)
    }
  }
}

$response = Invoke-AccountLogPage 1
$data = if ($response.data) { $response.data } else { $response }
$items = [Collections.Generic.List[object]]::new()
foreach ($item in @($data.items)) { $items.Add($item) }
$reportedTotal = [Math]::Max($items.Count, [long]$data.total)
$reportedPageSize = [Math]::Max(1, [int]$data.page_size)
$pageCount = [Math]::Min($maximumPages, [Math]::Ceiling($reportedTotal / $reportedPageSize))
for ($page = 2; $page -le $pageCount; $page++) {
  $pageResponse = Invoke-AccountLogPage $page
  $pageData = if ($pageResponse.data) { $pageResponse.data } else { $pageResponse }
  $pageItems = @($pageData.items)
  if ($pageItems.Count -eq 0) { break }
  foreach ($item in $pageItems) { $items.Add($item) }
}

function ConvertTo-IdentityPart($Value) {
  if ($null -eq $Value) { return '' }
  $text = if ($Value -is [IFormattable]) {
    $Value.ToString($null, [Globalization.CultureInfo]::InvariantCulture)
  } else {
    [string]$Value
  }
  return [Uri]::EscapeDataString($text)
}

function Get-TokenLogIdentity($Item) {
  foreach ($field in @('request_id', 'requestId', 'log_id', 'logId', 'trace_id', 'traceId', 'uuid')) {
    $value = $Item.$field
    if ($null -ne $value -and -not [string]::IsNullOrWhiteSpace([string]$value)) {
      return "${field}:$(ConvertTo-IdentityPart $value)"
    }
  }
  $prompt = [Math]::Max(0L, [long]$Item.prompt_tokens)
  $completion = [Math]::Max(0L, [long]$Item.completion_tokens)
  $parts = @($Item.created_at, $prompt, $completion, $Item.quota, $Item.model_name, $Item.use_time) |
    ForEach-Object { ConvertTo-IdentityPart $_ }
  return "record:$($parts -join '|')"
}

$checkpointAt = 0L
$recentLogIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$seenLogIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($item in $items) {
  $identity = Get-TokenLogIdentity $item
  if (-not $seenLogIds.Add($identity)) { continue }
  $timestamp = 0L
  if ([long]::TryParse([string]$item.created_at, [ref]$timestamp) -and $timestamp -gt 0) {
    if ($timestamp -lt 100000000000) { $timestamp *= 1000 }
    if ($timestamp -gt $checkpointAt) {
      $checkpointAt = $timestamp
      $recentLogIds.Clear()
    }
    if ($timestamp -eq $checkpointAt) { [void]$recentLogIds.Add($identity) }
  }
}

$dailyDate = Get-Date -Format 'yyyy-MM-dd'
$dailyCheckpointAt = ([DateTimeOffset](Get-Date).Date).ToUnixTimeMilliseconds()
$dailyTokens = 0L
$dailyLogIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$dailySeenLogIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($item in $items) {
  $timestamp = 0L
  if (-not [long]::TryParse([string]$item.created_at, [ref]$timestamp) -or $timestamp -le 0) { continue }
  if ($timestamp -lt 100000000000) { $timestamp *= 1000 }
  if ([DateTimeOffset]::FromUnixTimeMilliseconds($timestamp).LocalDateTime.ToString('yyyy-MM-dd') -ne $dailyDate) { continue }
  $identity = Get-TokenLogIdentity $item
  if (-not $dailySeenLogIds.Add($identity)) { continue }
  $tokens = [Math]::Max(0L, [long]$item.prompt_tokens) + [Math]::Max(0L, [long]$item.completion_tokens)
  $dailyTokens += $tokens
  if ($timestamp -gt $dailyCheckpointAt) {
    $dailyCheckpointAt = $timestamp
    $dailyLogIds.Clear()
  }
  if ($timestamp -eq $dailyCheckpointAt) { [void]$dailyLogIds.Add($identity) }
}

Save-CodexUsageTokenBaseline -InitialTokens $InitialTokens -CheckpointAt $checkpointAt -RecentLogIds @($recentLogIds) `
  -DailyDate $dailyDate -DailyTokens $dailyTokens -DailyCheckpointAt $dailyCheckpointAt -DailyLogIds @($dailyLogIds)
$env:CODEX_USAGE_ACCOUNT_COUNTER_PATH = $CodexUsageAccountCounterPath
$activePort = Resolve-CodexUsageCdpPort $Port
if ($activePort) {
  & (Join-Path $PSScriptRoot 'start-monitor.ps1') -Port $activePort -Replace
  if ($LASTEXITCODE -ne 0) { throw "初始值已保存，但重启监视器失败，退出码 $LASTEXITCODE。" }
  Write-Host "累计 Token 初始值已设置为 $InitialTokens，监视器已重新加载。"
} else {
  Write-Host "累计 Token 初始值已设置为 $InitialTokens；下次启动监视器时生效。"
}
