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
# Exercise only the shell-selection statements, with command discovery mocked.
# This never starts a monitor or imports the user's stored provider credentials.
& {
  $originalPowerShell = $env:CODEX_USAGE_POWERSHELL_PATH
  $shellSelection = [scriptblock]::Create((@($startupAst.EndBlock.Statements | Where-Object {
    $_.Extent.Text -match '^\$powerShellCommand\s*=' -or $_.Extent.Text -match '^if\s*\(\$powerShellCommand\)'
  } | ForEach-Object { $_.Extent.Text }) -join "`n"))
  function Get-Command { param($Name, $ErrorAction) return $script:availableTestShell }
  try {
    $script:availableTestShell = $null
    $env:CODEX_USAGE_POWERSHELL_PATH = 'stale-pwsh.exe'
    . $shellSelection
    Assert-Startup ($env:CODEX_USAGE_POWERSHELL_PATH -eq (Get-CodexUsageWindowsPowerShellPath)) 'Without PowerShell 7, the updater must receive the real Windows PowerShell path.'
    $script:availableTestShell = [pscustomobject]@{ Source = 'C:\test\PowerShell 7\pwsh.exe' }
    . $shellSelection
    Assert-Startup ($env:CODEX_USAGE_POWERSHELL_PATH -eq $script:availableTestShell.Source) 'An available PowerShell 7 should remain preferred.'
  } finally { $env:CODEX_USAGE_POWERSHELL_PATH = $originalPowerShell }
}
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

# A command-line flag proves intent, not that a process is still starting.
# Keep all process/window boundaries mocked; this never touches a live Codex.
& {
  $script:pendingCdpProcesses = @()
  $script:pendingCdpProbes = [Collections.Generic.List[int]]::new()
  $script:pendingCdpSleeps = [Collections.Generic.List[int]]::new()
  $script:pendingReadyPort = 0
  $script:pendingCreateDuringDiscovery = $false
  function Get-CimInstance($ClassName, $Filter, $ErrorAction) {
    if ($Filter -match '^ProcessId = (\d+)$') {
      return $script:pendingCdpProcesses | Where-Object { $_.ProcessId -eq [int]$Matches[1] }
    }
    if ($script:pendingCreateDuringDiscovery) {
      # Simulate process creation while the CIM enumeration is in progress.
      [Threading.Thread]::Sleep(2)
      $script:pendingCdpProcesses = @([pscustomobject]@{
        ProcessId = 507; CreationDate = [DateTime]::UtcNow
        CommandLine = 'ChatGPT.exe --remote-debugging-port=9340'
      })
      $script:pendingCreateDuringDiscovery = $false
    }
    return $script:pendingCdpProcesses
  }
  function Test-CodexUsageCdpPort([int]$Port) {
    $script:pendingCdpProbes.Add($Port)
    return $Port -eq $script:pendingReadyPort
  }
  function Start-Sleep([int]$Milliseconds) {
    $script:pendingCdpSleeps.Add($Milliseconds)
    # Simulate the same process exiting between polls, without sleeping.
    $script:pendingCdpProcesses = @()
  }
  $oldProcess = [pscustomobject]@{
    ProcessId = 501; CreationDate = [DateTime]::UtcNow.AddHours(-2)
    CommandLine = 'ChatGPT.exe --remote-debugging-port=9335'
  }
  $normalProcess = [pscustomobject]@{
    ProcessId = 502; CreationDate = [DateTime]::UtcNow.AddSeconds(-1)
    CommandLine = 'ChatGPT.exe'
  }
  $script:pendingCdpProcesses = @($oldProcess, $normalProcess)
  $candidates = @(Get-CodexUsageProcessCdpCandidates)
  Assert-Startup ($candidates.Count -eq 1 -and $candidates[0].ProcessId -eq 501 -and $candidates[0].CreationDate -eq $oldProcess.CreationDate) 'CDP candidates must retain process identity and creation time.'
  foreach ($attempt in 1..2) {
    $staleFailure = ''
    try { [void](Wait-CodexUsagePendingCdpPort) } catch { $staleFailure = $_.Exception.Message }
    Assert-Startup ($staleFailure -match '调试端口未就绪' -and $staleFailure -match '残留' -and $staleFailure -match 'PID 501') 'Repeated shortcut clicks must identify stale startup processes instead of waiting another 180 seconds.'
  }
  Assert-Startup ($script:pendingCdpProbes.Count -eq 0 -and $script:pendingCdpSleeps.Count -eq 0) 'Expired candidates should return without probing or sleeping.'

  $freshProcess = [pscustomobject]@{
    ProcessId = 503; CreationDate = [DateTime]::UtcNow.AddSeconds(-2)
    CommandLine = 'ChatGPT.exe --remote-debugging-port 9336'
  }
  $childProcess = [pscustomobject]@{
    ProcessId = 504; CreationDate = [DateTime]::UtcNow.AddSeconds(-1)
    CommandLine = 'ChatGPT.exe --type=renderer --remote-debugging-port=9337'
  }
  $script:pendingCdpProcesses = @($oldProcess, $freshProcess, $childProcess)
  $script:pendingReadyPort = 9336
  Assert-Startup ((Wait-CodexUsagePendingCdpPort) -eq 9336) 'A fresh main process should be selected instead of an older residual process or renderer child.'
  Assert-Startup (($script:pendingCdpProbes -join ',') -eq '9336') 'Only the current startup candidate should be awaited.'

  $script:pendingCreateDuringDiscovery = $true
  $script:pendingReadyPort = 9340
  Assert-Startup ((Wait-CodexUsagePendingCdpPort) -eq 9340) 'A process created during discovery must not be misclassified as a future or stale process.'

  $script:pendingReadyPort = 0
  $script:pendingCdpProbes.Clear()
  $budgetProcess = [pscustomobject]@{
    ProcessId = 505; CreationDate = [DateTime]::UtcNow.AddSeconds(-18)
    CommandLine = 'ChatGPT.exe --remote-debugging-port=9338'
  }
  $script:pendingCdpProcesses = @($budgetProcess)
  $budgetCandidate = @(Get-CodexUsageProcessCdpCandidates)[0]
  Assert-Startup (-not (Wait-CodexUsageCdpPort 9338 20 5000 $budgetCandidate)) 'A candidate that exits must end its wait.'
  Assert-Startup ($script:pendingCdpSleeps.Count -eq 1 -and $script:pendingCdpSleeps[0] -gt 0 -and $script:pendingCdpSleeps[0] -le 2000) 'Only the remaining creation-time budget may be slept, not a new full timeout.'
  Assert-Startup ($script:pendingCdpProbes.Count -eq 1) 'A process exit should stop before the next port probe.'

  $script:pendingCdpProbes.Clear()
  $script:pendingCdpSleeps.Clear()
  $script:pendingCdpProcesses = @([pscustomobject]@{
    ProcessId = 503; CreationDate = [DateTime]::UtcNow
    CommandLine = 'ChatGPT.exe --remote-debugging-port=9336'
  })
  $script:pendingReadyPort = 9336
  Assert-Startup (-not (Wait-CodexUsageCdpPort 9336 180 0 ([pscustomobject]@{ ProcessId = 503; CreationDate = $freshProcess.CreationDate }))) 'A reused PID must not inherit the original startup wait.'
  Assert-Startup ($script:pendingCdpProbes.Count -eq 0) 'Process identity must be checked before probing a reused PID.'

  $script:pendingCdpProcesses = @()
  Assert-Startup (-not (Wait-CodexUsageCdpPort -Port 9339 -ProcessId 506)) 'A newly launched process that already exited must fail promptly.'
  Assert-Startup ($script:pendingCdpProbes.Count -eq 0 -and $script:pendingCdpSleeps.Count -eq 0) 'A missing new process must not start an unbound 180-second wait.'
  $script:pendingCdpProcesses = @($freshProcess)
  Assert-Startup (Wait-CodexUsageCdpPort -Port 9336 -ProcessId 503) 'A new process should use its actual creation time and remain eligible once CDP is ready.'

  # Age limits apply only to pending starts. An old healthy CDP process remains
  # eligible for the normal port-resolution fast path used by both entrypoints.
  $originalAppData = $env:APPDATA
  function Get-CodexUsageState { return $null }
  try {
    $env:APPDATA = Join-Path $startupTestRoot 'unused-profile'
    $script:pendingCdpProcesses = @($oldProcess)
    $script:pendingReadyPort = 9335
    Assert-Startup ((Resolve-CodexUsageCdpPort 9335) -eq 9335) 'An already-open CDP port must remain reusable regardless of process age.'
  } finally { $env:APPDATA = $originalAppData }
}
Write-Host 'PASS: startup wait, pending reuse, safe replacement, and failure diagnostics.'
