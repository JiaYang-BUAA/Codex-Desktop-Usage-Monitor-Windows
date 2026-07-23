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
$oldEnvKey = $env:CODEX_USAGE_API_KEY
$oldEnvConfig = $env:CODEX_USAGE_PROVIDER_CONFIG_PATH
try {
  New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
  $CodexUsageStateRoot = $testRoot
  $CodexUsagePersistedProviderConfigPath = Join-Path $testRoot 'provider.json'
  $CodexUsagePersistedProviderKeyPath = Join-Path $testRoot 'api-key.dpapi'
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
  Write-Host 'PASS: DPAPI API provider persistence, import, plaintext protection, and cleanup.'
} finally {
  $CodexUsageStateRoot = $oldStateRoot
  $CodexUsagePersistedProviderConfigPath = $oldConfigPath
  $CodexUsagePersistedProviderKeyPath = $oldKeyPath
  if ($null -ne $oldEnvKey) { $env:CODEX_USAGE_API_KEY = $oldEnvKey } else { Remove-Item Env:CODEX_USAGE_API_KEY -ErrorAction SilentlyContinue }
  if ($null -ne $oldEnvConfig) { $env:CODEX_USAGE_PROVIDER_CONFIG_PATH = $oldEnvConfig } else { Remove-Item Env:CODEX_USAGE_PROVIDER_CONFIG_PATH -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
