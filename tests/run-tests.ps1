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
  'assets\usage-inject.js', 'scripts\injector.mjs', 'scripts\usage-client.mjs', 'scripts\validate-provider.mjs',
  'tests\usage-client.mjs', 'tests\usage-monitor-lifecycle.mjs'
)
foreach ($relative in $javascriptFiles) {
  & $node --check (Join-Path $root $relative)
  if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax failed: $relative" }
}

& $node (Join-Path $root 'tests\usage-client.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Usage client tests failed.' }
& $node (Join-Path $root 'tests\usage-monitor-lifecycle.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Renderer lifecycle tests failed.' }
& $pwsh -NoLogo -NoProfile -File (Join-Path $root 'tests\provider-persistence.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Provider persistence tests failed.' }
foreach ($relative in @('config\providers\cctq.example.json', 'config\providers\custom.example.json')) {
  & $node (Join-Path $root 'scripts\validate-provider.mjs') (Join-Path $root $relative) *> $null
  if ($LASTEXITCODE -ne 0) { throw "Provider validation failed: $relative" }
}

& $pwsh -NoLogo -NoProfile -File (Join-Path $root 'scripts\launch-codex-monitor.ps1') -SelfTest
if ($LASTEXITCODE -ne 0) { throw 'Launcher decision tests failed.' }

$runtimeFiles = @(
  'assets\usage-inject.js', 'scripts\injector.mjs', 'scripts\usage-client.mjs', 'scripts\monitor-utils.ps1',
  'scripts\start-monitor.ps1', 'scripts\launch-codex-monitor.ps1', 'scripts\launch-codex-monitor-hidden.vbs',
  'scripts\install-monitor-launcher.ps1', 'scripts\configure-api-provider.ps1', 'scripts\clear-api-provider.ps1',
  'scripts\configure-api-account.ps1', 'scripts\clear-api-account.ps1', 'scripts\configure-token-baseline.ps1', 'scripts\clear-token-baseline.ps1'
)
$runtimeSource = ($runtimeFiles | ForEach-Object { Get-Content -LiteralPath (Join-Path $root $_) -Raw }) -join "`n"
foreach ($forbidden in @('.codex\auth.json', '.codex/config.toml', 'Stop-Process ChatGPT', 'Invoke-Expression', 'DownloadString')) {
  if ($runtimeSource.IndexOf($forbidden, [StringComparison]::OrdinalIgnoreCase) -ge 0) { throw "Forbidden runtime behavior found: $forbidden" }
}
if ($runtimeSource -match 'C:\\Users\\yang|E:\\codex') { throw 'A personal absolute path is embedded in runtime source.' }
if ($runtimeSource -notmatch 'IApplicationActivationManager') { throw 'Packaged Codex must be launched through the Windows activation API.' }
if ($runtimeSource -notmatch 'CODEX_USAGE_API_KEY') { throw 'API key environment contract is missing.' }
if ($runtimeSource -notmatch 'CODEX_USAGE_ACCOUNT_TOKEN' -or $runtimeSource -notmatch 'New-Api-User') { throw 'API account environment or authentication contract is missing.' }
if ($runtimeSource -notmatch 'account-token-counter.json' -or $runtimeSource -notmatch 'InitialTokens') { throw 'Token baseline persistence contract is missing.' }
if ($runtimeSource -notmatch 'ProtectedData') { throw 'DPAPI persistence contract is missing.' }
if ($runtimeSource -notmatch 'Resolve-CodexUsageCliPath') { throw 'Codex CLI auto-discovery contract is missing.' }
if ($runtimeSource -notmatch 'Resolve-CodexUsageNonStoreDesktopPath') { throw 'Non-Store Codex Desktop auto-discovery contract is missing.' }
if ($runtimeSource -notmatch 'Resolve-CodexUsageAvailablePort') { throw 'Automatic CDP port fallback contract is missing.' }
if ($runtimeSource -notmatch 'CODEX_USAGE_DESKTOP_PATH') { throw 'Custom desktop executable contract is missing.' }
if ($runtimeSource -notmatch '\[Threading\.Mutex\]') { throw 'Startup mutex contract is missing.' }
if ($runtimeSource -notmatch "Local\\CodexUsageMonitor'") { throw 'Cross-port startup mutex contract is missing.' }
if ($runtimeSource -notmatch 'TARGET_ABSENCE_EXIT_MS') { throw 'Orphan injector shutdown contract is missing.' }
if ($runtimeSource -notmatch '\$owned = @\(Get-CodexUsageInjectorProcesses\)') { throw 'Cross-port injector cleanup contract is missing.' }
if ($runtimeSource -notmatch 'rate-limited' -or $runtimeSource -notmatch 'HTTP 429') { throw 'API rate-limit backoff contract is missing.' }
if ($runtimeSource -notmatch 'runtimeVersion') { throw 'Runtime version state contract is missing.' }
if ($runtimeSource -notmatch '--remote-debugging-address=127\.0\.0\.1') { throw 'Local CDP binding contract is missing.' }
if ($runtimeSource -notmatch 'Codex Usage Monitor\.lnk') { throw 'English shortcut name contract is missing.' }
if ($runtimeSource -notmatch 'launch-codex-monitor-hidden\.vbs') { throw 'Hidden launcher contract is missing.' }
if ($runtimeSource -notmatch 'shell\.Run command, 0, False') { throw 'Hidden WindowStyle contract is missing.' }

$agentGuide = Get-Content -LiteralPath (Join-Path $root 'AGENTS.md') -Raw
foreach ($requiredGuideText in @('install\.ps1', 'Never ask.*API key', 'WindowsApps', 'run-tests\.ps1', 'Codex-Assisted Configuration', 'InitialTokens', 'sanitized.*response')) {
  if ($agentGuide -notmatch $requiredGuideText) { throw "Codex installation guide is missing: $requiredGuideText" }
}
$readme = Get-Content -LiteralPath (Join-Path $root 'README.md') -Raw
foreach ($requiredReadmeText in @('简要安装说明', 'docs/images/monitor-collapsed.png', 'docs/images/monitor-expanded.png', '完整说明', 'AGENTS.md', 'install.ps1', 'API 账户', 'API Key', '累计 Token 初始值', '请求状态', '账户余额', '限额', '30 秒', '有限页数')) {
  if ($readme -notmatch [regex]::Escape($requiredReadmeText)) { throw "README installation guidance is missing: $requiredReadmeText" }
}
if ($readme -match '(?m)^#{2,}\s+[\d.]*\s*界面预览\s*$') { throw 'README preview should be an unnumbered introduction.' }
$briefInstallAt = $readme.IndexOf('## 1. 简要安装说明')
$previewAt = $readme.IndexOf('docs/images/monitor-expanded.png')
$dataSourceAt = $readme.IndexOf('### 1.2 选择数据源并配置')
$codexHelpAt = $readme.IndexOf('如果不懂如何运行下面的命令')
$officialSourceAt = $readme.IndexOf('- 官方订阅：数据来自')
$expandedViewAt = $readme.IndexOf('### 1.3 展开监视栏查看和勾选')
if ($previewAt -lt 0 -or $briefInstallAt -lt 0 -or $previewAt -ge $briefInstallAt) { throw 'README preview must appear before the brief installation section.' }
if ($dataSourceAt -lt 0 -or $codexHelpAt -le $dataSourceAt -or $officialSourceAt -le $codexHelpAt -or $expandedViewAt -le $officialSourceAt) { throw 'README Codex help note must follow the data-source heading and precede its commands.' }

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

    $installerSource = Get-Content -LiteralPath (Join-Path $root 'install.ps1') -Raw
    foreach ($pattern in @('Read-Host', "SetEnvironmentVariable\('CODEX_USAGE_DESKTOP_PATH'", "SetEnvironmentVariable\('CODEX_USAGE_CODEX_PATH'", 'NonInteractive')) {
      if ($installerSource -notmatch $pattern) { throw "Installer discovery contract is missing: $pattern" }
    }

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
    $manifest = Get-Content -LiteralPath (Join-Path $root 'config\package-files.json') -Raw | ConvertFrom-Json
    $expected = @($manifest | ForEach-Object { ([string]$_).Replace('/', '\') }) | Sort-Object
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
    & (Join-Path $root 'scripts\install-monitor-launcher.ps1') -DestinationDirectory $shortcutDirectory
    $shortcutPath = Join-Path $shortcutDirectory 'Codex Usage Monitor.lnk'
    if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { throw 'Hidden launcher shortcut was not created.' }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    if ([IO.Path]::GetFileName($shortcut.TargetPath) -ine 'wscript.exe') { throw 'Shortcut target must be wscript.exe.' }
    if ($shortcut.Arguments -notmatch 'launch-codex-monitor-hidden\.vbs') { throw 'Shortcut does not reference the hidden launcher.' }
    if ($shortcut.Arguments -notmatch '\s9335$') { throw 'Shortcut does not preserve the CDP port.' }
    if (Test-Path -LiteralPath (Join-Path $shortcutDirectory 'Codex 监视器版.lnk')) { throw 'Legacy shortcut was not removed.' }
  } finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
  }
}

Write-Host 'PASS: syntax, protocols, renderer lifecycle, provider safety, launcher policy, secrets, and release package.'
