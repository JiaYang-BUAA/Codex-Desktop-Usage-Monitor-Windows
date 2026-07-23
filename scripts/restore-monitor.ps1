[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 9335
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'monitor-utils.ps1')
$node = Resolve-CodexUsageNodePath
$injector = Join-Path $PSScriptRoot 'injector.mjs'
$state = Get-CodexUsageState
if ($state -and $state.port) { $Port = [int]$state.port }

if (Test-CodexUsageCdpPort $Port) {
  & $node $injector --remove --port $Port --timeout-ms 5000 *> $null
}
foreach ($process in @(Get-CodexUsageInjectorProcesses)) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}
foreach ($statePath in @($CodexUsageStatePath, $CodexUsageLegacyStatePath)) {
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
}
if (Test-Path -LiteralPath $CodexUsageStateRoot -PathType Container) {
  Get-ChildItem -LiteralPath $CodexUsageStateRoot -File -Filter 'injector-*.log' | Remove-Item -Force -ErrorAction SilentlyContinue
}
Write-Host 'Codex 用量监视器已停止并从当前 renderer 移除。'
