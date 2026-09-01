[CmdletBinding()]
param([switch]$SkipPackageTest)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$nodeCandidates = @(
  $env:CODEX_USAGE_NODE_PATH,
  (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'),
  (Get-Command node.exe -ErrorAction SilentlyContinue).Source
) | Where-Object { $_ }
$node = $nodeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $node) { throw 'Node.js 22+ is required for tests.' }
$nodeVersion = (& $node --version).TrimStart('v').Split('.')[0]
if ([int]$nodeVersion -lt 22) { throw "Node.js 22+ is required; found $(& $node --version)." }
$pwsh = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
if (-not $pwsh) { $pwsh = (Get-Command powershell.exe -ErrorAction Stop).Source }

$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$lockPath = Join-Path $root 'package-lock.json'
if ($PSVersionTable.PSVersion.Major -ge 6) {
  $lockVersion = (Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json -AsHashtable)['version']
} else {
  Add-Type -AssemblyName System.Web.Extensions
  $serializer = New-Object Web.Script.Serialization.JavaScriptSerializer
  $lockVersion = $serializer.DeserializeObject((Get-Content -LiteralPath $lockPath -Raw))['version']
}
$version = (Get-Content -LiteralPath (Join-Path $root 'VERSION') -Raw).Trim()
if ($package.name -ne 'codex-usage-monitor-windows') { throw 'Unexpected package name.' }
if ($package.version -ne $version -or $lockVersion -ne $version) { throw 'VERSION, package.json, and package-lock.json must match.' }
$dependencyNames = @($package.devDependencies.PSObject.Properties.Name)
if ($dependencyNames.Count -ne 1 -or $dependencyNames[0] -ne 'jsdom') { throw 'Only jsdom should remain as a development dependency.' }
$lockText = Get-Content -LiteralPath $lockPath -Raw
foreach ($match in [regex]::Matches($lockText, '"resolved"\s*:\s*"(https://[^"]+)"')) {
  $resolvedUri = [Uri]$match.Groups[1].Value
  if ($resolvedUri.Host -ne 'registry.npmjs.org') { throw "Unexpected package-lock registry host: $($resolvedUri.Host)" }
}

$powerShellFiles = Get-ChildItem -LiteralPath (Join-Path $root 'scripts') -Filter '*.ps1' -File
$powerShellFiles += Get-ChildItem -LiteralPath (Join-Path $root 'tests') -Filter '*.ps1' -File
$powerShellFiles += Get-ChildItem -LiteralPath $root -Filter '*.ps1' -File
foreach ($file in $powerShellFiles) {
  $bytes = [IO.File]::ReadAllBytes($file.FullName)
  if ($bytes.Length -lt 3 -or $bytes[0] -ne 0xEF -or $bytes[1] -ne 0xBB -or $bytes[2] -ne 0xBF) {
    throw "PowerShell file must use UTF-8 BOM for Windows PowerShell 5.1: $($file.Name)"
  }
  $tokens = $null
  $parseErrors = $null
  [void][Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count) { throw "PowerShell parse failed for $($file.Name): $($parseErrors[0].Message)" }
}

$javascriptFiles = @(
  'assets\usage-constants.js', 'assets\usage-i18n.js', 'assets\usage-placement.js',
  'assets\usage-inject.js', 'scripts\injector.mjs', 'scripts\current-thread.mjs', 'scripts\usage-client.mjs', 'scripts\usage\scheduling.mjs', 'scripts\validate-provider.mjs',
  'scripts\ui-settings.mjs', 'scripts\auto-updater.mjs', 'scripts\auto-resume.mjs', 'scripts\desktop-request.mjs', 'tests\current-thread.mjs', 'tests\usage-client.mjs', 'tests\usage-monitor-lifecycle.mjs', 'tests\ui-settings.mjs', 'tests\auto-updater.mjs', 'tests\auto-resume.mjs', 'tests\desktop-request.mjs'
)
foreach ($relative in $javascriptFiles) {
  & $node --check (Join-Path $root $relative)
  if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax failed: $relative" }
}

& $node (Join-Path $root 'tests\current-thread.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Current task selection tests failed.' }
& $node (Join-Path $root 'tests\usage-client.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Usage client tests failed.' }
& $node (Join-Path $root 'tests\usage-monitor-lifecycle.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Renderer lifecycle tests failed.' }
& $node (Join-Path $root 'tests\ui-settings.mjs')
if ($LASTEXITCODE -ne 0) { throw 'UI settings persistence tests failed.' }
& $node (Join-Path $root 'tests\auto-updater.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Automatic updater tests failed.' }
& $node (Join-Path $root 'tests\auto-resume.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Quota recovery auto-resume tests failed.' }
& $node (Join-Path $root 'tests\desktop-request.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Codex Desktop internal request submission tests failed.' }
& $pwsh -NoLogo -NoProfile -File (Join-Path $root 'tests\auto-update.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Automatic update package validation tests failed.' }
& $pwsh -NoLogo -NoProfile -File (Join-Path $root 'tests\provider-persistence.ps1')
& $pwsh -NoLogo -NoProfile -File (Join-Path $root 'tests\panel-configuration.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Provider persistence tests failed.' }
foreach ($relative in @('config\providers\cctq.example.json', 'config\providers\custom.example.json')) {
  & $node (Join-Path $root 'scripts\validate-provider.mjs') (Join-Path $root $relative) *> $null
  if ($LASTEXITCODE -ne 0) { throw "Provider validation failed: $relative" }
}

& $pwsh -NoLogo -NoProfile -File (Join-Path $root 'scripts\launch-codex-monitor.ps1') -SelfTest
if ($LASTEXITCODE -ne 0) { throw 'Launcher decision tests failed.' }

. (Join-Path $root 'scripts\monitor-utils.ps1')
$originalLocalAppData = $env:LOCALAPPDATA
$originalPath = $env:PATH
$originalCliOverride = $env:CODEX_USAGE_CODEX_PATH
$originalAppxTestOutput = $env:CODEX_USAGE_TEST_OUTPUT
try {
  $resolutionRoot = Join-Path ([IO.Path]::GetTempPath()) "codex-usage-cli-resolution-$PID"
  $fakeLocalAppData = Join-Path $resolutionRoot 'local'
  $dedicatedCli = Join-Path $fakeLocalAppData 'Programs\OpenAI Codex CLI\codex.exe'
  $commandDirectory = Join-Path $resolutionRoot 'path'
  $pathCli = Join-Path $commandDirectory 'codex.exe'
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dedicatedCli), $commandDirectory | Out-Null
  Set-Content -LiteralPath $dedicatedCli -Value 'dedicated-cli' -Encoding ascii
  Set-Content -LiteralPath $pathCli -Value 'path-cli' -Encoding ascii
  $env:LOCALAPPDATA = $fakeLocalAppData
  $env:PATH = "$commandDirectory;$originalPath"
  $env:CODEX_USAGE_CODEX_PATH = $null
  if ((Resolve-CodexUsageCliPath) -ne $dedicatedCli) {
    throw 'Dedicated Codex CLI should be preferred over a desktop-bundled CLI discovered on PATH.'
  }
} finally {
  $env:LOCALAPPDATA = $originalLocalAppData
  $env:PATH = $originalPath
  $env:CODEX_USAGE_CODEX_PATH = $originalCliOverride
  $env:CODEX_USAGE_TEST_OUTPUT = $originalAppxTestOutput
  if ($resolutionRoot -and (Test-Path -LiteralPath $resolutionRoot)) {
    Remove-Item -LiteralPath $resolutionRoot -Recurse -Force
  }
}
$windowsPowerShellPath = Get-CodexUsageWindowsPowerShellPath
if (-not $windowsPowerShellPath -or $windowsPowerShellPath -notmatch '(?i)[\\/]System32[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$') {
  throw "Windows PowerShell must resolve to the trusted system location: $windowsPowerShellPath"
}
$appxProbeRoot = Join-Path ([IO.Path]::GetTempPath()) "codex-usage-appx-probe-$PID"
try {
  New-Item -ItemType Directory -Force -Path $appxProbeRoot | Out-Null
  $fakePowerShell = Join-Path $appxProbeRoot 'fake-powershell.cmd'
  Set-Content -LiteralPath $fakePowerShell -Encoding ascii -Value @(
    '@echo off',
    'if /I "%CODEX_USAGE_TEST_OUTPUT%"=="valid" echo {"Name":"OpenAI.Codex","InstallLocation":"C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.0.0.0_x64__test","PackageFamilyName":"OpenAI.Codex_test","Version":"1.0.0.0"}',
    'if /I "%CODEX_USAGE_TEST_OUTPUT%"=="malformed" echo {invalid-json',
    'exit /b 0'
  )
  $env:CODEX_USAGE_TEST_OUTPUT = 'valid'
  $validPackage = Get-CodexUsageAppPackageViaWindowsPowerShell -WindowsPowerShellPath $fakePowerShell
  if ($validPackage.Name -ne 'OpenAI.Codex' -or $validPackage.PackageFamilyName -ne 'OpenAI.Codex_test') {
    throw 'Windows PowerShell fallback did not parse valid package JSON.'
  }
  $env:CODEX_USAGE_TEST_OUTPUT = 'empty'
  if ($null -ne (Get-CodexUsageAppPackageViaWindowsPowerShell -WindowsPowerShellPath $fakePowerShell)) {
    throw 'Windows PowerShell fallback should ignore empty output.'
  }
  $env:CODEX_USAGE_TEST_OUTPUT = 'malformed'
  if ($null -ne (Get-CodexUsageAppPackageViaWindowsPowerShell -WindowsPowerShellPath $fakePowerShell)) {
    throw 'Windows PowerShell fallback should ignore malformed JSON.'
  }
  if ($null -ne (Get-CodexUsageAppPackageViaWindowsPowerShell -WindowsPowerShellPath (Join-Path $appxProbeRoot 'missing.exe'))) {
    throw 'Windows PowerShell fallback should reject a missing executable path.'
  }
} finally {
  $env:CODEX_USAGE_TEST_OUTPUT = $originalAppxTestOutput
  if (Test-Path -LiteralPath $appxProbeRoot) { Remove-Item -LiteralPath $appxProbeRoot -Recurse -Force }
}
$timeoutStopwatch = [Diagnostics.Stopwatch]::StartNew()
$timeoutProbe = Invoke-CodexUsageProcessWithTimeout -FilePath $pwsh -ArgumentLine '-NoLogo -NoProfile -Command "Start-Sleep -Seconds 10"' -TimeoutMs 300
$timeoutStopwatch.Stop()
if (-not $timeoutProbe.TimedOut -or $timeoutProbe.ExitCode -ne 124) { throw 'Timed process probe was not terminated.' }
if ($timeoutStopwatch.Elapsed.TotalSeconds -gt 5) { throw "Timed process probe exceeded its outer deadline: $($timeoutStopwatch.Elapsed)." }
if (Get-Process -Id $timeoutProbe.ProcessId -ErrorAction SilentlyContinue) { throw 'Timed process probe is still running.' }
$successProbe = Invoke-CodexUsageProcessWithTimeout -FilePath $node -ArgumentLine '--version' -TimeoutMs 5000
if ($successProbe.TimedOut -or $successProbe.ExitCode -ne 0 -or $successProbe.StandardOutput -notmatch '^v\d+') {
  throw 'Successful process probe returned an unexpected result.'
}

$runtimeFiles = @(
  'assets\usage-constants.js', 'assets\usage-i18n.js', 'assets\usage-placement.js',
  'assets\usage-inject.js', 'scripts\injector.mjs', 'scripts\current-thread.mjs', 'scripts\auto-updater.mjs', 'scripts\auto-resume.mjs', 'scripts\desktop-request.mjs', 'scripts\auto-update.ps1', 'scripts\usage-client.mjs', 'scripts\usage\scheduling.mjs', 'scripts\monitor-utils.ps1',
  'scripts\start-monitor.ps1', 'scripts\launch-codex-monitor.ps1', 'scripts\launch-codex-monitor-hidden.vbs',
  'scripts\install-monitor-launcher.ps1', 'scripts\configure-api-provider.ps1', 'scripts\clear-api-provider.ps1',
  'scripts\configure-api-account.ps1', 'scripts\clear-api-account.ps1', 'scripts\configure-token-baseline.ps1', 'scripts\clear-token-baseline.ps1'
)
$runtimeSource = ($runtimeFiles | ForEach-Object { Get-Content -LiteralPath (Join-Path $root $_) -Raw -Encoding UTF8 }) -join "`n"
foreach ($forbidden in @('.codex\auth.json', '.codex/config.toml', 'Stop-Process ChatGPT', 'Invoke-Expression', 'DownloadString')) {
  if ($runtimeSource.IndexOf($forbidden, [StringComparison]::OrdinalIgnoreCase) -ge 0) { throw "Forbidden runtime behavior found: $forbidden" }
}
if ($runtimeSource -match 'C:\\Users\\yang|E:\\codex') { throw 'A personal absolute path is embedded in runtime source.' }
if ($runtimeSource -notmatch 'IApplicationActivationManager') { throw 'Packaged Codex must be launched through the Windows activation API.' }
if ($runtimeSource -notmatch 'CODEX_USAGE_API_KEY') { throw 'API key environment contract is missing.' }
if ($runtimeSource -notmatch 'CODEX_USAGE_ACCOUNT_TOKEN' -or $runtimeSource -notmatch 'New-Api-User') { throw 'API account environment or authentication contract is missing.' }
if ($runtimeSource -notmatch 'account-token-counter.json' -or $runtimeSource -notmatch 'InitialTokens') { throw 'Token baseline persistence contract is missing.' }
if ($runtimeSource -notmatch 'official-token-counter.json' -or $runtimeSource -notmatch 'LocalCodexTokenTracker' -or $runtimeSource -notmatch 'last_token_usage' -or $runtimeSource -notmatch 'LOCAL_TOKEN_COUNTER_SCHEMA_VERSION\s*=\s*8' -or $runtimeSource -notmatch 'officialLifetimePendingTokens' -or $runtimeSource -notmatch 'setOfficialLifetimeTokens' -or $runtimeSource -notmatch 'officialLast7DaysPendingTokens' -or $runtimeSource -notmatch 'setOfficialLast7DaysTokens' -or $runtimeSource -notmatch 'OFFICIAL_MODEL_PROVIDER_ID' -or $runtimeSource -notmatch 'requires_openai_auth' -or $runtimeSource -notmatch 'account/read' -or $runtimeSource -notmatch 'config/read' -or $runtimeSource -notmatch 'conversationTokenDelta' -or $runtimeSource -notmatch 'official-conversation-raw' -or $runtimeSource -notmatch 'seenEvents' -or $runtimeSource -notmatch 'thread_settings_applied' -or $runtimeSource -notmatch 'session_meta' -or $runtimeSource -notmatch 'turn_id' -or $runtimeSource -notmatch 'chatgptauthtokens' -or $runtimeSource -notmatch 'personalaccesstoken') { throw 'Official authenticated-provider raw conversation Token attribution and persistence contract is missing.' }
if ($runtimeSource -notmatch 'data-above-composer-conversation-id' -or $runtimeSource -notmatch 'data-conversation-id' -or $runtimeSource -notmatch 'data-thread-id' -or $runtimeSource -notmatch 'chatgpt' -or $runtimeSource -notmatch 'auxiliaryConversationPresent' -or $runtimeSource -notmatch 'initialRoute' -or $runtimeSource -notmatch 'isMainCodexRendererTarget' -or $runtimeSource -notmatch 'currentStatus' -or $runtimeSource -notmatch 'turn_aborted' -or $runtimeSource -notmatch 'currentTaskTokens' -or $runtimeSource -notmatch 'lastTurnTokens' -or $runtimeSource -notmatch 'cacheHitRate' -or $runtimeSource -notmatch 'cached_input_tokens' -or $runtimeSource -notmatch 'last7DaysTokens' -or $runtimeSource -notmatch 'dailyUsageBuckets' -or $runtimeSource -notmatch 'contextCompactions' -or $runtimeSource -notmatch 'window_number') { throw 'Current-session and seven-day usage contract is missing.' }
if ($runtimeSource -notmatch 'ProtectedData') { throw 'DPAPI persistence contract is missing.' }
if ($runtimeSource -notmatch 'Resolve-CodexUsageCliPath') { throw 'Codex CLI auto-discovery contract is missing.' }
if ($runtimeSource -notmatch 'Resolve-CodexUsageNonStoreDesktopPath') { throw 'Non-Store Codex Desktop auto-discovery contract is missing.' }
if ($runtimeSource -notmatch 'Get-CodexUsageAppPackageViaWindowsPowerShell' -or $runtimeSource -notmatch 'Get-CodexUsageWindowsPowerShellPath') { throw 'PowerShell 7 Store package compatibility fallback is missing.' }
if ($runtimeSource -notmatch 'Resolve-CodexUsageAvailablePort') { throw 'Automatic CDP port fallback contract is missing.' }
if ($runtimeSource -notmatch 'CODEX_USAGE_DESKTOP_PATH') { throw 'Custom desktop executable contract is missing.' }
if ($runtimeSource -notmatch '\[Threading\.Mutex\]') { throw 'Startup mutex contract is missing.' }
if ($runtimeSource -notmatch "Local\\CodexUsageMonitor'") { throw 'Cross-port startup mutex contract is missing.' }
if ($runtimeSource -notmatch 'TARGET_ABSENCE_EXIT_MS\s*=\s*60000') { throw 'Orphan injector shutdown grace-period contract is missing.' }
if ($runtimeSource -notmatch 'redirect:\s*"error"' -or $runtimeSource -notmatch '只有本机回环地址允许 HTTP') { throw 'Credential transport hardening contract is missing.' }
if ($runtimeSource -match 'await usageClient\.start\(\)') { throw 'Initial usage refresh must not delay renderer injection.' }
if ($runtimeSource -notmatch 'usageStartPromise = usageClient\.start\(\)') { throw 'Background initial usage refresh contract is missing.' }
if ($runtimeSource -notmatch '注入验证探针失败，将继续重试' -or $runtimeSource -notmatch '\$detailText\s*=.*\[string\]\(Get-Content') { throw 'Monitor startup retry and empty-log safety contract is missing.' }
if ($runtimeSource -notmatch '\$owned = @\(Get-CodexUsageInjectorProcesses\)') { throw 'Cross-port injector cleanup contract is missing.' }
if ($runtimeSource -notmatch 'rate-limited' -or $runtimeSource -notmatch 'HTTP 429') { throw 'API rate-limit backoff contract is missing.' }
if ($runtimeSource -notmatch 'minimalMode' -or $runtimeSource -notmatch 'countdownVisualization' -or $runtimeSource -notmatch 'englishUi' -or $runtimeSource -notmatch 'updateNotifications' -or $runtimeSource -notmatch 'usage-refresh-ring') { throw 'Display mode controls are missing.' }
if ($runtimeSource -notmatch 'autoResume' -or $runtimeSource -notmatch 'autoResumeMessage' -or $runtimeSource -notmatch 'usage_limit_exceeded' -or $runtimeSource -notmatch 'sendContinueThroughDesktop' -or $runtimeSource -notmatch 'normalizeAutoResumeMessage' -or $runtimeSource -notmatch 'thread/resume' -or $runtimeSource -notmatch 'turn/start' -or $runtimeSource -notmatch 'clientUserMessageId' -or $runtimeSource -notmatch 'usage_monitor_auto_resume') { throw 'Quota recovery desktop internal-request auto-resume contract is missing.' }
if ($runtimeSource -match 'Input\.insertText' -or $runtimeSource -match 'prepareAutoResume') { throw 'Legacy Composer typing auto-resume must not remain active.' }
if ($runtimeSource -notmatch 'placementStrategy' -or $runtimeSource -notmatch 'visible-editable-not-found' -or $runtimeSource -notmatch 'preferredComposer' -or $runtimeSource -notmatch 'candidateScore' -or $runtimeSource -notmatch 'diagnose\(\)') { throw 'DOM compatibility diagnostics are missing.' }
if ($runtimeSource -match 'window-not-focused' -or $runtimeSource -match 'blurHandler' -or $runtimeSource -match 'document\.hasFocus') { throw 'The monitor must remain visible when the Codex window loses focus.' }
if ($runtimeSource -notmatch 'LOCAL_TOKEN_IDLE_SCAN_MS\s*=\s*12000' -or $runtimeSource -notmatch 'localTokenNextScanDelay') { throw 'Adaptive local-token scan contract is missing.' }
if ($runtimeSource -match '(?i)dream[ -]?skin|CODEX_DREAM|codex-dream') { throw 'Removed Dream Skin runtime compatibility is still present.' }
if ($runtimeSource -notmatch 'runtimeVersion') { throw 'Runtime version state contract is missing.' }
if ($runtimeSource -notmatch '--remote-debugging-address=127\.0\.0\.1') { throw 'Local CDP binding contract is missing.' }
if ($runtimeSource -notmatch 'Codex Usage Monitor\.lnk') { throw 'English shortcut name contract is missing.' }
if ($runtimeSource -notmatch 'launch-codex-monitor-hidden\.vbs') { throw 'Hidden launcher contract is missing.' }
if ($runtimeSource -notmatch 'Resolve-CodexUsageRunnableCliPath') { throw 'Store Codex CLI mirroring contract is missing.' }
if ($runtimeSource -notmatch '-ExecutionPolicy Bypass') { throw 'Hidden launcher execution-policy bypass is missing.' }
if ($runtimeSource -notmatch 'exitCode = shell\.Run\(command, 0, True\)') { throw 'Hidden launcher exit-code capture is missing.' }
if ($runtimeSource -notmatch 'launcher-error\.log') { throw 'Hidden launcher bootstrap log contract is missing.' }
if ($runtimeSource -notmatch 'release-assets\.githubusercontent\.com' -or $runtimeSource -notmatch 'SHA-256' -or $runtimeSource -notmatch '24 \* 60 \* 60 \* 1000') { throw 'Automatic update verification and 24-hour schedule contract is missing.' }
if ($runtimeSource -match 'fetch\(API_URL' -or $runtimeSource -match 'checkForUpdate') { throw 'Renderer-side update checks must not remain active.' }

$githubDirectory = Join-Path $root '.github'
if (Test-Path -LiteralPath $githubDirectory -PathType Container) {
  $releaseWorkflowPath = Join-Path $githubDirectory 'workflows\release.yml'
  if (-not (Test-Path -LiteralPath $releaseWorkflowPath -PathType Leaf)) { throw 'Release workflow is missing from the source checkout.' }
  $releaseWorkflow = Get-Content -LiteralPath $releaseWorkflowPath -Raw -Encoding UTF8
  foreach ($requiredReleaseText in @('gh release list', 'gh release upload', '--clobber', 'gh release create')) {
    if ($releaseWorkflow -notmatch [regex]::Escape($requiredReleaseText)) { throw "Idempotent release workflow contract is missing: $requiredReleaseText" }
  }
}

$agentGuide = Get-Content -LiteralPath (Join-Path $root 'AGENTS.md') -Raw -Encoding UTF8
foreach ($requiredGuideText in @('install\.ps1', 'Never ask.*API key', 'WindowsApps', 'run-tests\.ps1', 'Codex-Assisted Configuration', 'InitialTokens', 'sanitized.*response')) {
  if ($agentGuide -notmatch $requiredGuideText) { throw "Codex installation guide is missing: $requiredGuideText" }
}
$readme = Get-Content -LiteralPath (Join-Path $root 'README.md') -Raw -Encoding UTF8
foreach ($requiredReadmeText in @('三步开始使用', 'docs/images/monitor-collapsed.png', 'docs/images/monitor-expanded.png', 'docs/images/monitor-minimal.png', 'docs/images/configure-api-key.png', 'docs/data-sources.md', 'docs/troubleshooting.md', 'AGENTS.md', 'install.ps1', '本会话', 'API 账户', 'API Key', '累计 Token 基准', '请求状态', '账户余额', '限额', '60', '极简模式', '倒计时可视化', '当前会话累计 Token', '上次回答消耗 Token', '缓存命中率', '近7天 Token', '自动压缩上下文次数', 'Tibo', 'latestTiboActivity', '直接关闭杀毒软件')) {
  if ($readme -notmatch [regex]::Escape($requiredReadmeText)) { throw "README installation guidance is missing: $requiredReadmeText" }
}
if ($readme -match '(?m)^#{2,}\s+[\d.]*\s*界面预览\s*$') { throw 'README preview should be an unnumbered introduction.' }
$briefInstallAt = $readme.IndexOf('## 1. 三步开始使用')
$previewAt = $readme.IndexOf('docs/images/monitor-expanded.png')
$disclaimerAt = $readme.IndexOf('本项目是非官方项目')
if ($previewAt -lt 0 -or $briefInstallAt -lt 0 -or $previewAt -ge $briefInstallAt) { throw 'README preview must appear before the brief installation section.' }
if ($disclaimerAt -lt 0 -or $disclaimerAt -ge $previewAt) { throw 'README unofficial-project disclaimer must appear before the preview.' }
if ($readme -match 'CCTQ') { throw 'README quick path should remain provider-neutral; protocol compatibility belongs in the detailed data-source guide.' }

$dataSourceGuide = Get-Content -LiteralPath (Join-Path $root 'docs\data-sources.md') -Raw -Encoding UTF8
foreach ($requiredDataSourceText in @('official-token-counter.json', '本机实时累计', '有限页数', '圆形表盘', 'CCTQ 风格', '请求指纹', 'HTTP 429', 'K', 'M', 'B')) {
  if ($dataSourceGuide -notmatch [regex]::Escape($requiredDataSourceText)) { throw "Detailed data-source guide is missing: $requiredDataSourceText" }
}

$troubleshootingGuide = Get-Content -LiteralPath (Join-Path $root 'docs\troubleshooting.md') -Raw -Encoding UTF8
foreach ($requiredTroubleshootingText in @('state.json', '动态端口', 'launcher-error.log', '-Replace', '直接关闭杀毒软件')) {
  if ($troubleshootingGuide -notmatch [regex]::Escape($requiredTroubleshootingText)) { throw "Troubleshooting guide is missing: $requiredTroubleshootingText" }
}

function Test-JsonPropertyNames($Value) {
  if ($null -eq $Value) { return }
  if ($Value -is [Collections.IDictionary]) {
    foreach ($key in $Value.Keys) {
      if ([string]$key -match '(?i)api.?key|access.?token|secret|password|credential') { throw "Secret-like property found in example config: $key" }
      Test-JsonPropertyNames $Value[$key]
    }
    return
  }
  if ($Value -is [Management.Automation.PSCustomObject]) {
    foreach ($property in $Value.PSObject.Properties) {
      if ($property.Name -match '(?i)api.?key|access.?token|secret|password|credential') { throw "Secret-like property found in example config: $($property.Name)" }
      Test-JsonPropertyNames $property.Value
    }
    return
  }
  if ($Value -is [Collections.IEnumerable] -and $Value -isnot [string]) {
    foreach ($item in $Value) { Test-JsonPropertyNames $item }
  }
}
foreach ($example in Get-ChildItem -LiteralPath (Join-Path $root 'config\providers') -Filter '*.example.json' -File) {
  Test-JsonPropertyNames (Get-Content -LiteralPath $example.FullName -Raw | ConvertFrom-Json)
}

if (-not $SkipPackageTest) {
  $testRoot = Join-Path ([IO.Path]::GetTempPath()) "codex-usage-monitor-package-test-$PID"
  try {
    New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
    $fakeDesktop = Join-Path $testRoot 'non-store\app\ChatGPT.exe'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $fakeDesktop) | Out-Null
    Set-Content -LiteralPath $fakeDesktop -Value 'test' -Encoding ascii
    . (Join-Path $root 'scripts\monitor-utils.ps1')
    $resolvedDesktop = Resolve-CodexUsageNonStoreDesktopPath -CandidatePaths @(
      (Join-Path $testRoot 'missing\ChatGPT.exe'),
      $fakeDesktop
    )
    if ($resolvedDesktop -ne [IO.Path]::GetFullPath($fakeDesktop)) { throw 'Non-Store desktop discovery did not select the valid candidate.' }

    $fakeNonStoreCli = Join-Path $testRoot 'non-store\resources\codex.exe'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $fakeNonStoreCli) | Out-Null
    Set-Content -LiteralPath $fakeNonStoreCli -Value 'non-store-cli' -Encoding ascii
    $resolvedNonStoreCli = Resolve-CodexUsageRunnableCliPath -CliPath $fakeNonStoreCli -MirrorRoot (Join-Path $testRoot 'unused-mirror')
    if ($resolvedNonStoreCli -ne [IO.Path]::GetFullPath($fakeNonStoreCli)) { throw 'Non-Store Codex CLI must run from its original path.' }

    $fakeStoreCli = Join-Path $testRoot 'WindowsApps\OpenAI.Codex_1.0.0.0_x64__test\app\resources\codex.exe'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $fakeStoreCli) | Out-Null
    Set-Content -LiteralPath $fakeStoreCli -Value 'store-cli-v1' -Encoding ascii
    $mirrorRoot = Join-Path $testRoot 'state\runtime\codex-cli'
    $firstMirror = Resolve-CodexUsageRunnableCliPath -CliPath $fakeStoreCli -MirrorRoot $mirrorRoot
    if ($firstMirror -eq [IO.Path]::GetFullPath($fakeStoreCli)) { throw 'Store Codex CLI must not run directly from WindowsApps.' }
    if (-not (Test-Path -LiteralPath $firstMirror -PathType Leaf)) { throw 'Store Codex CLI mirror was not created.' }
    if ((Get-Content -LiteralPath $firstMirror -Raw).Trim() -ne 'store-cli-v1') { throw 'Store Codex CLI mirror content differs from the source.' }
    if ((Resolve-CodexUsageRunnableCliPath -CliPath $fakeStoreCli -MirrorRoot $mirrorRoot) -ne $firstMirror) { throw 'Unchanged Store CLI should reuse its existing mirror.' }

    Set-Content -LiteralPath $fakeStoreCli -Value 'store-cli-v2-updated' -Encoding ascii
    $secondMirror = Resolve-CodexUsageRunnableCliPath -CliPath $fakeStoreCli -MirrorRoot $mirrorRoot
    if ($secondMirror -eq $firstMirror) { throw 'Updated Store CLI should create a refreshed mirror path.' }
    if ((Get-Content -LiteralPath $secondMirror -Raw).Trim() -ne 'store-cli-v2-updated') { throw 'Updated Store CLI mirror content differs from the source.' }
    if (@(Get-ChildItem -LiteralPath $mirrorRoot -Filter 'codex-*.exe' -File).Count -ne 1) { throw 'Stale Store CLI mirrors were not cleaned up.' }

    $installerSource = Get-Content -LiteralPath (Join-Path $root 'install.ps1') -Raw
    foreach ($pattern in @('Read-Host', "SetEnvironmentVariable\('CODEX_USAGE_DESKTOP_PATH'", "SetEnvironmentVariable\('CODEX_USAGE_CODEX_PATH'", 'NonInteractive')) {
      if ($installerSource -notmatch $pattern) { throw "Installer discovery contract is missing: $pattern" }
    }

    $unsafeManifest = Join-Path $testRoot 'unsafe-package-files.json'
    [IO.File]::WriteAllText($unsafeManifest, '["..\\outside.txt"]', [Text.UTF8Encoding]::new($false))
    $unsafeManifestRejected = $false
    try {
      & (Join-Path $root 'scripts\build-release.ps1') -SkipTests -OutputDirectory $testRoot -ManifestPath $unsafeManifest
    } catch {
      if ($_.Exception.Message -notmatch 'Unsafe package manifest path') { throw }
      $unsafeManifestRejected = $true
    }
    if (-not $unsafeManifestRejected) { throw 'Unsafe release manifest path was not rejected.' }

    & (Join-Path $root 'scripts\build-release.ps1') -SkipTests -OutputDirectory $testRoot
    if ($LASTEXITCODE -ne 0) { throw 'Release build failed.' }
    $archive = Get-ChildItem -LiteralPath $testRoot -Filter '*.zip' -File | Select-Object -First 1
    if (-not $archive) { throw 'Release archive was not created.' }
    if ($archive.Length -gt 750KB) { throw "Release archive is unexpectedly large: $($archive.Length) bytes." }
    $extract = Join-Path $testRoot 'extract'
    Expand-Archive -LiteralPath $archive.FullName -DestinationPath $extract
    $packageRoot = Get-ChildItem -LiteralPath $extract -Directory | Select-Object -First 1
    $actual = @(Get-ChildItem -LiteralPath $packageRoot.FullName -File -Recurse | ForEach-Object {
      $_.FullName.Substring($packageRoot.FullName.Length + 1).Replace('/', '\')
    } | Sort-Object)
    $manifest = Get-Content -LiteralPath (Join-Path $root 'config\package-files.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $expectedItems = @()
    foreach ($item in $manifest) { $expectedItems += ([string]$item).Replace('/', '\') }
    $expected = @($expectedItems | Sort-Object)
    if (Compare-Object $expected $actual) { throw 'Release archive content differs from the allowlist.' }
    $text = ($actual | Where-Object { $_ -match '\.(?:js|mjs|json|md|ps1|txt)$' } | ForEach-Object {
      Get-Content -LiteralPath (Join-Path $packageRoot.FullName $_) -Raw
    }) -join "`n"
    foreach ($pattern in @('C:\\Users\\yang', 'E:\\codex', 'sk-[A-Za-z0-9_-]{20,}', 'Bearer\s+[A-Za-z0-9._-]{16,}')) {
      if ($text -match $pattern) { throw "Potential secret or personal path found in release: $pattern" }
    }
    if ($actual -match 'themes|renderer-inject|\.exe$|theme-manager|build-exe') { throw 'Theme or executable content leaked into the release.' }
    foreach ($imagePath in @('docs\images\monitor-collapsed.png', 'docs\images\monitor-expanded.png')) {
      if ($actual -notcontains $imagePath) { throw "README screenshot is missing from the release: $imagePath" }
    }

    $sourceNodeModules = Join-Path $root 'node_modules'
    if (-not (Test-Path -LiteralPath $sourceNodeModules -PathType Container)) { throw 'Source test dependencies are missing.' }
    $packageNodeModules = Join-Path $packageRoot.FullName 'node_modules'
    try {
      New-Item -ItemType Junction -Path $packageNodeModules -Target $sourceNodeModules | Out-Null
      & (Join-Path $packageRoot.FullName 'tests\run-tests.ps1') -SkipPackageTest
      if ($LASTEXITCODE -ne 0) { throw 'Release package self-test failed.' }
    } finally {
      if (Test-Path -LiteralPath $packageNodeModules) { [IO.Directory]::Delete($packageNodeModules) }
    }

    $installRoot = Join-Path $testRoot 'install'
    & (Join-Path $root 'install.ps1') -InstallRoot $installRoot -SkipShortcut
    $installedDirectory = Join-Path $installRoot $version
    if (-not (Test-Path -LiteralPath (Join-Path $installedDirectory 'scripts\start-monitor.ps1') -PathType Leaf)) {
      throw 'Persistent installer did not copy the runtime scripts.'
    }
    if (Test-Path -LiteralPath (Join-Path $installedDirectory 'node_modules')) { throw 'Persistent installer copied node_modules.' }

    $shortcutDirectory = Join-Path $testRoot 'desktop'
    New-Item -ItemType Directory -Force -Path $shortcutDirectory | Out-Null
    Set-Content -LiteralPath (Join-Path $shortcutDirectory 'Codex 监视器版.lnk') -Value 'legacy' -Encoding ascii
    $shortcutIconSource = Join-Path $testRoot 'shortcut-icon-source.png'
    Add-Type -AssemblyName System.Drawing
    $testIconBitmap = [Drawing.Bitmap]::new(256, 256, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $testIconGraphics = [Drawing.Graphics]::FromImage($testIconBitmap)
    $testIconBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(255, 16, 185, 129))
    try {
      $testIconGraphics.Clear([Drawing.Color]::Transparent)
      $testIconGraphics.FillEllipse($testIconBrush, 16, 16, 224, 224)
      $testIconBitmap.Save($shortcutIconSource, [Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $testIconBrush.Dispose()
      $testIconGraphics.Dispose()
      $testIconBitmap.Dispose()
    }
    $shortcutIcon = Join-Path $testRoot 'shortcut-icon\codex-usage-monitor-v2.ico'
    & (Join-Path $root 'scripts\install-monitor-launcher.ps1') -DestinationDirectory $shortcutDirectory -IconCachePath $shortcutIcon -IconSourcePath $shortcutIconSource
    $shortcutPath = Join-Path $shortcutDirectory 'Codex Usage Monitor.lnk'

    $installedVbs = Join-Path $installedDirectory 'scripts\launch-codex-monitor-hidden.vbs'
    $fakePowerShell = Join-Path $testRoot 'fake-powershell.cmd'
    $capturedArguments = Join-Path $testRoot 'captured-powershell-arguments.txt'
    $vbsLocalAppData = Join-Path $testRoot 'vbs-local-app-data'
    $launcherErrorPath = Join-Path $vbsLocalAppData 'CodexUsageMonitor\launcher-error.log'
    $cscript = Join-Path $env:SystemRoot 'System32\cscript.exe'
    $previousLocalAppData = $env:LOCALAPPDATA
    try {
      $env:LOCALAPPDATA = $vbsLocalAppData
      Set-Content -LiteralPath $fakePowerShell -Encoding ascii -Value @(
        '@echo off',
        "echo %*>`"$capturedArguments`"",
        'exit /b 0'
      )
      & $cscript //nologo $installedVbs $fakePowerShell 9335
      if ($LASTEXITCODE -ne 0) { throw "Hidden VBS parameter test failed with exit code $LASTEXITCODE." }
      $captured = Get-Content -LiteralPath $capturedArguments -Raw
      if ($captured -notmatch '(?i)-ExecutionPolicy\s+Bypass') { throw 'Hidden VBS did not pass -ExecutionPolicy Bypass.' }
      if ($captured -notmatch '(?i)-File\s+.*launch-codex-monitor\.ps1') { throw 'Hidden VBS did not pass the PowerShell launcher path.' }

      Set-Content -LiteralPath $fakePowerShell -Encoding ascii -Value @('@echo off', 'exit /b 17')
      & $cscript //nologo $installedVbs $fakePowerShell 9335
      if ($LASTEXITCODE -ne 17) { throw "Hidden VBS failure test returned $LASTEXITCODE instead of 17." }
      if (-not (Test-Path -LiteralPath $launcherErrorPath -PathType Leaf)) { throw 'Hidden VBS did not create launcher-error.log.' }
      if ((Get-Content -LiteralPath $launcherErrorPath -Raw) -notmatch 'exited with code 17') { throw 'Hidden VBS launcher log does not include the PowerShell exit code.' }
      $global:LASTEXITCODE = 0
    } finally {
      $env:LOCALAPPDATA = $previousLocalAppData
    }
    if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { throw 'Hidden launcher shortcut was not created.' }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    if ([IO.Path]::GetFileName($shortcut.TargetPath) -ine 'wscript.exe') { throw 'Shortcut target must be wscript.exe.' }
    if ($shortcut.Arguments -notmatch 'launch-codex-monitor-hidden\.vbs') { throw 'Shortcut does not reference the hidden launcher.' }
    if ($shortcut.Arguments -notmatch '\s9335$') { throw 'Shortcut does not preserve the CDP port.' }
    if (-not (Test-Path -LiteralPath $shortcutIcon -PathType Leaf) -or (Get-Item -LiteralPath $shortcutIcon).Length -lt 100) { throw 'Stable shortcut icon cache was not created.' }
    $shortcutIconObject = [Drawing.Icon]::new($shortcutIcon)
    try {
      if ($shortcutIconObject.Width -ne 256 -or $shortcutIconObject.Height -ne 256) { throw 'Stable shortcut icon dimensions are invalid.' }
    } finally { $shortcutIconObject.Dispose() }
    $shortcutIconLocation = ($shortcut.IconLocation -replace ',\s*-?\d+$', '').Trim('"')
    if ([IO.Path]::GetFullPath($shortcutIconLocation) -ne [IO.Path]::GetFullPath($shortcutIcon)) { throw 'Shortcut does not use the stable cached icon.' }
    if ($shortcut.IconLocation -match '(?i)[\\/]WindowsApps[\\/]') { throw 'Shortcut icon must not reference a versioned WindowsApps path.' }
    if (Test-Path -LiteralPath (Join-Path $shortcutDirectory 'Codex 监视器版.lnk')) { throw 'Legacy shortcut was not removed.' }
  } finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
  }
}

Write-Host 'PASS: syntax, protocols, renderer lifecycle, provider safety, launcher policy, secrets, and release package.'
