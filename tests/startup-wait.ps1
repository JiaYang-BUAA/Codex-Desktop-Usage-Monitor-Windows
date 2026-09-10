$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/monitor-utils.ps1')

function Assert-Startup($Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

Assert-Startup ((Get-CodexUsageStartupPhase $true $false) -eq 'waiting-ui') 'A live slow-starting daemon must remain pending, not fail.'
Assert-Startup ((Get-CodexUsageStartupPhase $true $true) -eq 'ready') 'A matching live heartbeat should promote pending to ready.'
Assert-Startup ((Get-CodexUsageStartupPhase $false $false) -eq 'failed') 'A daemon that exits must fail.'
Assert-Startup ((Get-CodexUsageStartupPhase $false $true) -eq 'failed') 'A previous heartbeat must not conceal subsequent daemon exit.'

$startupTestRoot = Join-Path ([IO.Path]::GetTempPath()) ('codex-startup-wait-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $startupTestRoot | Out-Null
try {
  $emptyPath = Join-Path $startupTestRoot 'empty.log'
  $outputPath = Join-Path $startupTestRoot 'stdout.log'
  [IO.File]::WriteAllText($emptyPath, '')
  [IO.File]::WriteAllText($outputPath, 'real-startup-error')
  Assert-Startup ((Read-CodexUsageStartupLog $emptyPath) -eq '') 'An empty log must return a safe empty string.'
  Assert-Startup ((Read-CodexUsageStartupLog (Join-Path $startupTestRoot 'absent.log')) -eq '') 'A missing log must not conceal the failure.'
  $failure = Get-CodexUsageStartupFailure 321 7 $emptyPath $outputPath
  Assert-Startup ($failure -match '321' -and $failure -match '退出码 7' -and $failure -match 'real-startup-error') 'Failure diagnostics should include PID, exit code, and fallback stdout.'
  $failure = Get-CodexUsageStartupFailure 321 9 $emptyPath $emptyPath
  Assert-Startup ($failure -match '日志为空' -and $failure -match '退出码 9') 'Empty logs must retain useful failure diagnostics.'
  $locked = [IO.File]::Open($outputPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  try {
    Assert-Startup ((Read-CodexUsageStartupLog $outputPath) -match '暂时不可读取') 'An exclusively locked log must produce a safe diagnostic.'
  } finally { $locked.Dispose() }
  $shared = [IO.File]::Open($outputPath, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
  try {
    Assert-Startup ((Read-CodexUsageStartupLog $outputPath) -eq 'real-startup-error') 'A live redirected log must remain readable.'
  } finally { $shared.Dispose() }
  Assert-Startup ((Read-CodexUsageStartupLog $outputPath 5) -eq 'error') 'Log diagnostics must be bounded.'
} finally {
  # The exact GUID directory above is test-owned; no user state is touched.
  Remove-Item -LiteralPath $startupTestRoot -Recurse -Force
}

# Mock only the process boundary: exercise the real retirement policy without
# launching, probing, stopping, or otherwise changing any user's monitor.
$script:stoppedStartupPids = [Collections.Generic.List[int]]::new()
$script:startupProcesses = @{
  101 = [pscustomobject]@{ ProcessId = 101; InjectorPath = 'C:\test\old\scripts\injector.mjs'; Port = 9335 }
  102 = [pscustomobject]@{ ProcessId = 102; InjectorPath = 'C:\test\new\scripts\injector.mjs'; Port = 9335 }
  103 = [pscustomobject]@{ ProcessId = 103; InjectorPath = 'C:\other\scripts\injector.mjs'; Port = 9335 }
}
function Get-CodexUsageInjectorById([int]$ProcessId) { return $script:startupProcesses[$ProcessId] }
function Stop-Process([int]$Id, [switch]$Force, $ErrorAction) { $script:stoppedStartupPids.Add($Id) }
$prior = @(
  $script:startupProcesses[101],
  $script:startupProcesses[102],
  [pscustomobject]@{ ProcessId = 103; InjectorPath = 'C:\test\old\scripts\injector.mjs'; Port = 9335 }
)
Stop-CodexUsagePreviousInjectors $prior 102 $false
Assert-Startup ($script:stoppedStartupPids.Count -eq 0) 'Pending/failed replacement must preserve every existing daemon.'
Stop-CodexUsagePreviousInjectors $prior 102 $true
Assert-Startup (($script:stoppedStartupPids -join ',') -eq '101') 'Verified replacement should retire only the old matching identity, never itself or a reused PID.'
$script:stoppedStartupPids.Clear()
Stop-CodexUsagePreviousInjectors $prior 999 $true
Assert-Startup ($script:stoppedStartupPids.Count -eq 0) 'A candidate that exits after verification must not retire the fallback runtime.'

$testPath = 'C:\test\new\scripts\injector.mjs'
$pending = [pscustomobject]@{ injectorPid = 102; injectorPath = $testPath; runtimeVersion = $CodexUsageVersion; startupPhase = 'waiting-ui' }
Assert-Startup (Test-CodexUsageReusableInjector $pending $script:startupProcesses[102] $testPath) 'Repeated shortcut launches must reuse the matching waiting daemon.'

# Parse and execute the actual verification wrapper with a mocked child runner.
$startupSource = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/start-monitor.ps1'
$parseTokens = $null
$parseErrors = $null
$startupAst = [Management.Automation.Language.Parser]::ParseFile($startupSource, [ref]$parseTokens, [ref]$parseErrors)
Assert-Startup ($parseErrors.Count -eq 0) 'Startup script must parse.'
$probeAst = $startupAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-MonitorInjection' }, $true)
. ([scriptblock]::Create($probeAst.Extent.Text))
$node = 'mock-node'
$injector = 'C:\test\scripts\injector.mjs'
$script:probeArguments = ''
function Invoke-CodexUsageProcessWithTimeout($FilePath, $ArgumentLine, $TimeoutMs) {
  $script:probeArguments = $ArgumentLine
  return [pscustomobject]@{ TimedOut = $false; ExitCode = 0 }
}
Assert-Startup (Test-MonitorInjection 9335 102 1000) 'Successful heartbeat probe should verify.'
Assert-Startup ($script:probeArguments -match '--verify' -and $script:probeArguments -match '--expected-pid 102') 'Readiness must require the candidate backend identity, not merely a stale DOM host.'
$script:cdpProbeCount = 0
function Test-CodexUsageCdpPort([int]$Port) { $script:cdpProbeCount++; return $script:cdpProbeCount -ge 3 }
Assert-Startup (Wait-CodexUsageCdpPort 9335 1 0) 'A slow renderer should become ready after repeated port probes.'
Assert-Startup ($script:cdpProbeCount -eq 3) 'The CDP wait should not stop after its first unsuccessful probe.'
function Test-CodexUsageCdpPort([int]$Port) { return $false }
Assert-Startup (-not (Wait-CodexUsageCdpPort 9335 0 0)) 'A CDP deadline should return unavailable, not success.'
Write-Host 'PASS: startup wait, pending reuse, safe replacement, and failure diagnostics.'
