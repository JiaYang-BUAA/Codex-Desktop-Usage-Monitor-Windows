[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'monitor-utils.ps1')

function Write-PanelResult {
  param([bool]$Ok, [string]$Message, $Configuration = $null)
  $result = [ordered]@{ ok = $Ok; message = $Message }
  if ($null -ne $Configuration) { $result.configuration = $Configuration }
  [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 12 -Compress))
}

function Get-SafeConfigurationSummary {
  $account = [ordered]@{ configured = (Test-CodexUsagePersistedAccount); baseUrl = 'https://www.cctq.ai'; userId = ''; baselineConfigured = $false; initialTokens = '0' }
  if (Test-Path -LiteralPath $CodexUsagePersistedAccountConfigPath -PathType Leaf) {
    $accountConfig = Get-Content -LiteralPath $CodexUsagePersistedAccountConfigPath -Raw | ConvertFrom-Json
    $account.baseUrl = [string]$accountConfig.baseUrl
    $account.userId = [string]$accountConfig.userId
  }
  if (Test-Path -LiteralPath $CodexUsageAccountCounterPath -PathType Leaf) {
    $counter = Get-Content -LiteralPath $CodexUsageAccountCounterPath -Raw | ConvertFrom-Json
    if ($counter.baselineConfigured -eq $true -and $null -ne $counter.initialTokens) {
      $account.baselineConfigured = $true
      $account.initialTokens = [string]$counter.initialTokens
    }
  }
  $provider = [ordered]@{ configured = (Test-CodexUsagePersistedProvider) }
  if (Test-Path -LiteralPath $CodexUsagePersistedProviderConfigPath -PathType Leaf) {
    $providerConfig = Get-Content -LiteralPath $CodexUsagePersistedProviderConfigPath -Raw | ConvertFrom-Json
    foreach ($property in $providerConfig.PSObject.Properties) { $provider[$property.Name] = $property.Value }
  }
  return [ordered]@{ account = $account; provider = $provider }
}

$plainCredential = $null
$temporaryConfig = $null
try {
  $inputJson = [Console]::In.ReadToEnd()
  if ([Text.Encoding]::UTF8.GetByteCount($inputJson) -gt 131072) { throw '配置内容过大。' }
  $request = $inputJson | ConvertFrom-Json
  if ($null -eq $request -or [string]$request.requestId -notmatch '^[a-z0-9-]{8,64}$') { throw '配置请求无效。' }

  if ([string]$request.type -eq 'api-account') {
    $baseUrl = Resolve-CodexUsageCredentialBaseUrl -BaseUrl ([string]$request.baseUrl) -Label 'API 账户 Base URL'
    $userId = [string]$request.userId
    if ($userId -notmatch '^[1-9][0-9]{0,19}$') { throw '用户 ID 必须是 1–20 位正整数。' }
    $initialTokens = 0L
    if (-not [long]::TryParse([string]$request.initialTokens, [ref]$initialTokens) -or $initialTokens -lt 0) {
      throw '累计 Token 基准必须是非负完整整数。'
    }
    $plainCredential = [string]$request.token
    if ([string]::IsNullOrWhiteSpace($plainCredential)) {
      $stored = Get-CodexUsagePersistedAccount
      if (-not $stored) { throw 'Access Token 不能为空。' }
      $plainCredential = $stored.Token
    }
    if ($plainCredential.Length -gt 16384 -or $plainCredential -notmatch '^[\x21-\x7E]+$') { throw 'Access Token 必须是单行 ASCII 文本。' }
    $headers = @{ Authorization = "Bearer $plainCredential"; 'New-Api-User' = $userId; Accept = 'application/json' }
    try {
      $response = Invoke-RestMethod -Uri "$baseUrl/api/user/self" -Headers $headers -Method Get -TimeoutSec 15
      if ($null -eq $response.data) { throw 'missing-account-data' }
    } catch {
      throw 'API 账户验证失败，请检查 Base URL、用户 ID 和 Access Token。'
    }
    $env:CODEX_USAGE_ACCOUNT_TOKEN = $plainCredential
    $env:CODEX_USAGE_ACCOUNT_USER_ID = $userId
    $env:CODEX_USAGE_ACCOUNT_BASE_URL = $baseUrl
    & (Join-Path $PSScriptRoot 'configure-token-baseline.ps1') -InitialTokens $initialTokens -NoRestart
    Save-CodexUsagePersistedAccount -Token $plainCredential -UserId $userId -BaseUrl $baseUrl
    Write-PanelResult -Ok $true -Message 'API 账户已安全保存。' -Configuration (Get-SafeConfigurationSummary)
  } elseif ([string]$request.type -eq 'api-key') {
    $plainCredential = [string]$request.apiKey
    if ([string]::IsNullOrWhiteSpace($plainCredential)) {
      $stored = Get-CodexUsagePersistedProvider
      if (-not $stored) { throw 'API Key 不能为空。' }
      $plainCredential = $stored.ApiKey
    }
    if ($plainCredential.Length -gt 16384 -or $plainCredential -notmatch '^[\x21-\x7E]+$') { throw 'API Key 必须是单行 ASCII 文本。' }
    $source = $request.provider
    if ($null -eq $source) { throw 'Provider 配置不能为空。' }
    $baseUrl = Resolve-CodexUsageCredentialBaseUrl -BaseUrl ([string]$source.baseUrl) -Label 'API Provider Base URL'
    $statusPath = [string]$source.statusPath
    $provider = [ordered]@{
      schemaVersion = 1
      id = [string]$source.id
      label = [string]$source.label
      baseUrl = $baseUrl
      requests = [ordered]@{ usagePath = [string]$source.usagePath; statusPath = $(if ($statusPath) { $statusPath } else { $null }) }
      auth = [ordered]@{ header = [string]$source.authHeader; scheme = [string]$source.authScheme }
      response = [ordered]@{
        usageRoot = [string]$source.usageRoot; statusRoot = [string]$source.statusRoot
        used = [string]$source.used; limit = [string]$source.limit; unlimited = [string]$source.unlimited
        expiresAt = [string]$source.expiresAt; quotaPerUnit = [string]$source.quotaPerUnit; currency = [string]$source.currency
        defaultQuotaPerUnit = [double]$source.defaultQuotaPerUnit; defaultCurrency = [string]$source.defaultCurrency
      }
    }
    New-Item -ItemType Directory -Force -Path $CodexUsageStateRoot | Out-Null
    $temporaryConfig = Join-Path $CodexUsageStateRoot "provider-panel-$PID.tmp.json"
    [IO.File]::WriteAllText($temporaryConfig, ($provider | ConvertTo-Json -Depth 8), $CodexUsageUtf8)
    $node = Resolve-CodexUsageNodePath
    $validation = Invoke-CodexUsageProcessWithTimeout -FilePath $node -ArgumentLine "`"$(Join-Path $PSScriptRoot 'validate-provider.mjs')`" `"$temporaryConfig`"" -TimeoutMs 10000
    if ($validation.ExitCode -ne 0) { throw 'Provider 配置校验失败，请检查接口路径和字段映射。' }
    Save-CodexUsagePersistedProvider -ConfigPath $temporaryConfig -ApiKey $plainCredential
    Write-PanelResult -Ok $true -Message 'API Key 已安全保存。' -Configuration (Get-SafeConfigurationSummary)
  } else {
    throw '不支持的配置类型。'
  }
} catch {
  Write-PanelResult -Ok $false -Message ([string]$_.Exception.Message)
  exit 1
} finally {
  $plainCredential = $null
  if ($temporaryConfig) { Remove-Item -LiteralPath $temporaryConfig -Force -ErrorAction SilentlyContinue }
}
