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
  'scripts\start-monitor.ps1', 'scripts\launch-codex-monitor.ps1', 'scripts\configure-api-provider.ps1', 'scripts\clear-api-provider.ps1'
)
$runtimeSource = ($runtimeFiles | ForEach-Object { Get-Content -LiteralPath (Join-Path $root $_) -Raw }) -join "`n"
foreach ($forbidden in @('.codex\auth.json', '.codex/config.toml', 'Stop-Process ChatGPT', 'Invoke-Expression', 'DownloadString')) {
  if ($runtimeSource.IndexOf($forbidden, [StringComparison]::OrdinalIgnoreCase) -ge 0) { throw "Forbidden runtime behavior found: $forbidden" }
}
if ($runtimeSource -match 'C:\\Users\\yang|E:\\codex') { throw 'A personal absolute path is embedded in runtime source.' }
if ($runtimeSource -notmatch 'IApplicationActivationManager') { throw 'Packaged Codex must be launched through the Windows activation API.' }
if ($runtimeSource -notmatch 'CODEX_USAGE_API_KEY') { throw 'API key environment contract is missing.' }
if ($runtimeSource -notmatch 'ProtectedData') { throw 'DPAPI persistence contract is missing.' }
if ($runtimeSource -notmatch 'Resolve-CodexUsageCliPath') { throw 'Codex CLI auto-discovery contract is missing.' }
if ($runtimeSource -notmatch 'CODEX_USAGE_DESKTOP_PATH') { throw 'Custom desktop executable contract is missing.' }
if ($runtimeSource -notmatch '\[Threading\.Mutex\]') { throw 'Startup mutex contract is missing.' }
if ($runtimeSource -notmatch 'runtimeVersion') { throw 'Runtime version state contract is missing.' }
if ($runtimeSource -notmatch '--remote-debugging-address=127\.0\.0\.1') { throw 'Local CDP binding contract is missing.' }

$agentGuide = Get-Content -LiteralPath (Join-Path $root 'AGENTS.md') -Raw
foreach ($requiredGuideText in @('install\.ps1', 'Never ask.*API key', 'WindowsApps', 'run-tests\.ps1')) {
  if ($agentGuide -notmatch $requiredGuideText) { throw "Codex installation guide is missing: $requiredGuideText" }
}
$readme = Get-Content -LiteralPath (Join-Path $root 'README.md') -Raw
foreach ($requiredReadmeText in @('推荐：让 Codex 帮你安装', 'AGENTS.md', 'install.ps1')) {
  if ($readme -notmatch [regex]::Escape($requiredReadmeText)) { throw "README installation guidance is missing: $requiredReadmeText" }
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
    if ($actual -match 'themes|renderer-inject|\.png$|\.exe$|theme-manager|build-exe') { throw 'Theme or binary content leaked into the release.' }

    $installRoot = Join-Path $testRoot 'install'
    & (Join-Path $root 'install.ps1') -InstallRoot $installRoot -SkipShortcut
    $installedDirectory = Join-Path $installRoot $version
    if (-not (Test-Path -LiteralPath (Join-Path $installedDirectory 'scripts\start-monitor.ps1') -PathType Leaf)) {
      throw 'Persistent installer did not copy the runtime scripts.'
    }
    if (Test-Path -LiteralPath (Join-Path $installedDirectory 'node_modules')) { throw 'Persistent installer copied node_modules.' }
  } finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
  }
}

Write-Host 'PASS: syntax, protocols, renderer lifecycle, provider safety, launcher policy, secrets, and release package.'
