[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'scripts\monitor-utils.ps1')

$testRoot = Join-Path ([IO.Path]::GetTempPath()) "codex-usage-monitor-provider-test-$PID"
$providerPath = Join-Path $root 'config\providers\custom.example.json'
$testKey = 'unit-test-key-do-not-use'
$oldStateRoot = $CodexUsageStateRoot
$oldConfigPath = $CodexUsagePersistedProviderConfigPath
$oldKeyPath = $CodexUsagePersistedProviderKeyPath
$oldAccountConfigPath = $CodexUsagePersistedAccountConfigPath
$oldAccountTokenPath = $CodexUsagePersistedAccountTokenPath
$oldAccountCounterPath = $CodexUsageAccountCounterPath
$oldEnvKey = $env:CODEX_USAGE_API_KEY
$oldEnvConfig = $env:CODEX_USAGE_PROVIDER_CONFIG_PATH
$oldEnvAccountToken = $env:CODEX_USAGE_ACCOUNT_TOKEN
$oldEnvAccountUserId = $env:CODEX_USAGE_ACCOUNT_USER_ID
$oldEnvAccountBaseUrl = $env:CODEX_USAGE_ACCOUNT_BASE_URL
try {
  New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
  $CodexUsageStateRoot = $testRoot
  $CodexUsagePersistedProviderConfigPath = Join-Path $testRoot 'provider.json'
  $CodexUsagePersistedProviderKeyPath = Join-Path $testRoot 'api-key.dpapi'
  $CodexUsagePersistedAccountConfigPath = Join-Path $testRoot 'account.json'
  $CodexUsagePersistedAccountTokenPath = Join-Path $testRoot 'account-token.dpapi'
  $CodexUsageAccountCounterPath = Join-Path $testRoot 'account-token-counter.json'
  Save-CodexUsagePersistedProvider -ConfigPath $providerPath -ApiKey $testKey
  if (-not (Test-CodexUsagePersistedProvider)) { throw 'Persisted provider files were not created.' }
  $cipher = [IO.File]::ReadAllBytes($CodexUsagePersistedProviderKeyPath)
  $cipherText = [Text.Encoding]::UTF8.GetString($cipher)
  if ($cipherText.Contains($testKey)) { throw 'API key was written as plaintext.' }
  $stored = Get-CodexUsagePersistedProvider
  if ($stored.ApiKey -ne $testKey) { throw 'DPAPI round-trip returned the wrong API key.' }
  if ($stored.ConfigPath -ne [IO.Path]::GetFullPath($CodexUsagePersistedProviderConfigPath)) { throw 'Persisted provider path mismatch.' }
  Remove-Item Env:CODEX_USAGE_API_KEY,Env:CODEX_USAGE_PROVIDER_CONFIG_PATH -ErrorAction SilentlyContinue
  if (-not (Import-CodexUsagePersistedProvider)) { throw 'Persisted provider was not imported.' }
  if ($env:CODEX_USAGE_API_KEY -ne $testKey) { throw 'Imported API key mismatch.' }
  Remove-CodexUsagePersistedProvider
  if (Test-CodexUsagePersistedProvider) { throw 'Persisted provider files were not removed.' }

  $accountToken = 'unit-test-account-token-do-not-use'
  Save-CodexUsagePersistedAccount -Token $accountToken -UserId '10530' -BaseUrl 'https://example.test/'
  if (-not (Test-CodexUsagePersistedAccount)) { throw 'Persisted account files were not created.' }
  $accountCipher = [IO.File]::ReadAllBytes($CodexUsagePersistedAccountTokenPath)
  if ([Text.Encoding]::UTF8.GetString($accountCipher).Contains($accountToken)) { throw 'Account token was written as plaintext.' }
  $accountConfigText = Get-Content -LiteralPath $CodexUsagePersistedAccountConfigPath -Raw
  if ($accountConfigText.Contains($accountToken)) { throw 'Account config contains the account token.' }
  $storedAccount = Get-CodexUsagePersistedAccount
  if ($storedAccount.Token -ne $accountToken -or $storedAccount.UserId -ne '10530' -or $storedAccount.BaseUrl -ne 'https://example.test') {
    throw 'DPAPI account round-trip returned incorrect data.'
  }
  Remove-Item Env:CODEX_USAGE_ACCOUNT_TOKEN,Env:CODEX_USAGE_ACCOUNT_USER_ID,Env:CODEX_USAGE_ACCOUNT_BASE_URL -ErrorAction SilentlyContinue
  if (-not (Import-CodexUsagePersistedAccount)) { throw 'Persisted account was not imported.' }
  if ($env:CODEX_USAGE_ACCOUNT_TOKEN -ne $accountToken -or $env:CODEX_USAGE_ACCOUNT_USER_ID -ne '10530') { throw 'Imported account mismatch.' }
  Remove-CodexUsagePersistedAccount
  if (Test-CodexUsagePersistedAccount) { throw 'Persisted account files were not removed.' }
  Save-CodexUsageTokenBaseline -InitialTokens 500000000 -CheckpointAt 1784892000000 -RecentLogIds @('id:1', 'id:2') `
    -DailyDate '2026-07-24' -DailyTokens 125000 -DailyLogIds @('id:10', 'id:11')
  $baseline = Get-CodexUsageTokenBaseline
  if ([long]$baseline.totalTokens -ne 500000000 -or [long]$baseline.checkpointAt -ne 1784892000000) { throw 'Token baseline round-trip returned incorrect data.' }
  if ($baseline.schemaVersion -ne 2 -or -not $baseline.baselineConfigured -or $baseline.dailyDate -ne '2026-07-24' -or [long]$baseline.dailyTokens -ne 125000) { throw 'Daily Token state round-trip returned incorrect data.' }
  if (@($baseline.recentLogIds).Count -ne 2) { throw 'Token baseline checkpoint IDs were not saved.' }
  if (@($baseline.dailyLogIds).Count -ne 2) { throw 'Daily Token log IDs were not saved.' }
  Remove-CodexUsageTokenBaseline
  if (Test-Path -LiteralPath $CodexUsageAccountCounterPath) { throw 'Token baseline was not removed.' }
  Write-Host 'PASS: DPAPI API provider and API account persistence, import, plaintext protection, and cleanup.'
} finally {
  $CodexUsageStateRoot = $oldStateRoot
  $CodexUsagePersistedProviderConfigPath = $oldConfigPath
  $CodexUsagePersistedProviderKeyPath = $oldKeyPath
  $CodexUsagePersistedAccountConfigPath = $oldAccountConfigPath
  $CodexUsagePersistedAccountTokenPath = $oldAccountTokenPath
  $CodexUsageAccountCounterPath = $oldAccountCounterPath
  if ($null -ne $oldEnvKey) { $env:CODEX_USAGE_API_KEY = $oldEnvKey } else { Remove-Item Env:CODEX_USAGE_API_KEY -ErrorAction SilentlyContinue }
  if ($null -ne $oldEnvConfig) { $env:CODEX_USAGE_PROVIDER_CONFIG_PATH = $oldEnvConfig } else { Remove-Item Env:CODEX_USAGE_PROVIDER_CONFIG_PATH -ErrorAction SilentlyContinue }
  if ($null -ne $oldEnvAccountToken) { $env:CODEX_USAGE_ACCOUNT_TOKEN = $oldEnvAccountToken } else { Remove-Item Env:CODEX_USAGE_ACCOUNT_TOKEN -ErrorAction SilentlyContinue }
  if ($null -ne $oldEnvAccountUserId) { $env:CODEX_USAGE_ACCOUNT_USER_ID = $oldEnvAccountUserId } else { Remove-Item Env:CODEX_USAGE_ACCOUNT_USER_ID -ErrorAction SilentlyContinue }
  if ($null -ne $oldEnvAccountBaseUrl) { $env:CODEX_USAGE_ACCOUNT_BASE_URL = $oldEnvAccountBaseUrl } else { Remove-Item Env:CODEX_USAGE_ACCOUNT_BASE_URL -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
