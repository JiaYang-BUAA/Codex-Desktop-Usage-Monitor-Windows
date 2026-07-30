Set-StrictMode -Version 2.0

$CodexUsageRoot = Split-Path -Parent $PSScriptRoot
$CodexUsageStateRoot = Join-Path $env:LOCALAPPDATA 'CodexUsageMonitor'
$CodexUsageStatePath = Join-Path $CodexUsageStateRoot 'state.json'
$CodexUsagePersistedProviderConfigPath = Join-Path $CodexUsageStateRoot 'provider.json'
$CodexUsagePersistedProviderKeyPath = Join-Path $CodexUsageStateRoot 'api-key.dpapi'
$CodexUsagePersistedProviderEntropy = [Text.Encoding]::UTF8.GetBytes('CodexUsageMonitor/v1/APIKey')
$CodexUsagePersistedAccountConfigPath = Join-Path $CodexUsageStateRoot 'account.json'
$CodexUsagePersistedAccountTokenPath = Join-Path $CodexUsageStateRoot 'account-token.dpapi'
$CodexUsagePersistedAccountEntropy = [Text.Encoding]::UTF8.GetBytes('CodexUsageMonitor/v1/APIAccountToken')
$CodexUsageAccountCounterPath = Join-Path $CodexUsageStateRoot 'account-token-counter.json'
$CodexUsageLegacyStatePath = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin\state.json'
$CodexUsageVersion = (Get-Content -LiteralPath (Join-Path $CodexUsageRoot 'VERSION') -Raw).Trim()
$CodexUsageUtf8 = [Text.UTF8Encoding]::new($false)
try { [Console]::OutputEncoding = $CodexUsageUtf8 } catch {}
$global:OutputEncoding = $CodexUsageUtf8

function Invoke-CodexUsageProcessWithTimeout {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string]$ArgumentLine = '',
    [ValidateRange(100, 120000)]
    [int]$TimeoutMs = 10000
  )

  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = $ArgumentLine
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true

  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  $stdoutTask = $null
  $stderrTask = $null
  try {
    if (-not $process.Start()) { throw "无法启动进程：$FilePath" }
    $processId = $process.Id
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $timedOut = -not $process.WaitForExit($TimeoutMs)
    if ($timedOut) {
      try {
        if (-not $process.HasExited) { $process.Kill() }
      } catch {}
      if (-not $process.WaitForExit(5000)) { throw "超时进程无法终止：PID $processId" }
    } else {
      $process.WaitForExit()
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    return [pscustomobject]@{
      ProcessId = $processId
      ExitCode = if ($timedOut) { 124 } else { $process.ExitCode }
      TimedOut = $timedOut
      StandardOutput = $stdout
      StandardError = $stderr
    }
  } finally {
    if ($process) { $process.Dispose() }
  }
}

function Save-CodexUsagePersistedProvider {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,
    [Parameter(Mandatory = $true)]
    [string]$ApiKey
  )

  if ([string]::IsNullOrWhiteSpace($ApiKey)) { throw 'API key 不能为空。' }
  $resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath -ErrorAction Stop).Path
  New-Item -ItemType Directory -Force -Path $CodexUsageStateRoot | Out-Null
  $temporaryConfig = "$CodexUsagePersistedProviderConfigPath.$PID.tmp"
  $temporaryKey = "$CodexUsagePersistedProviderKeyPath.$PID.tmp"
  $plainBytes = $null
  $protectedBytes = $null
  try {
    $plainBytes = [Text.Encoding]::UTF8.GetBytes($ApiKey)
    $protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
      $plainBytes,
      $CodexUsagePersistedProviderEntropy,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [IO.File]::WriteAllBytes($temporaryConfig, [IO.File]::ReadAllBytes($resolvedConfig))
    [IO.File]::WriteAllBytes($temporaryKey, $protectedBytes)
    Move-Item -LiteralPath $temporaryConfig -Destination $CodexUsagePersistedProviderConfigPath -Force
    Move-Item -LiteralPath $temporaryKey -Destination $CodexUsagePersistedProviderKeyPath -Force
  } finally {
    Remove-Item -LiteralPath $temporaryConfig,$temporaryKey -Force -ErrorAction SilentlyContinue
    if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
    if ($protectedBytes) { [Array]::Clear($protectedBytes, 0, $protectedBytes.Length) }
  }
}

function Get-CodexUsagePersistedProvider {
  $hasConfig = Test-Path -LiteralPath $CodexUsagePersistedProviderConfigPath -PathType Leaf
  $hasKey = Test-Path -LiteralPath $CodexUsagePersistedProviderKeyPath -PathType Leaf
  if (-not $hasConfig -and -not $hasKey) { return $null }
  if (-not $hasConfig -or -not $hasKey) { throw '持久化 API Provider 配置不完整，请重新运行配置命令。' }

  $protectedBytes = $null
  $plainBytes = $null
  try {
    $protectedBytes = [IO.File]::ReadAllBytes($CodexUsagePersistedProviderKeyPath)
    $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
      $protectedBytes,
      $CodexUsagePersistedProviderEntropy,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $apiKey = [Text.Encoding]::UTF8.GetString($plainBytes)
    if ([string]::IsNullOrWhiteSpace($apiKey)) { throw '持久化 API key 为空，请重新运行配置命令。' }
    return [pscustomobject]@{
      ApiKey = $apiKey
      ConfigPath = [IO.Path]::GetFullPath($CodexUsagePersistedProviderConfigPath)
    }
  } catch {
    throw "无法解密持久化 API key。它可能由其他 Windows 用户或其他系统写入，请重新运行配置命令。$($_.Exception.Message)"
  } finally {
    if ($protectedBytes) { [Array]::Clear($protectedBytes, 0, $protectedBytes.Length) }
    if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
  }
}

function Import-CodexUsagePersistedProvider {
  if ($env:CODEX_USAGE_DISABLE_PERSISTED_PROVIDER -eq '1') { return $false }
  if ($env:CODEX_USAGE_API_KEY -or $env:CODEX_USAGE_PROVIDER_CONFIG_PATH) { return $false }
  $stored = Get-CodexUsagePersistedProvider
  if (-not $stored) { return $false }
  $env:CODEX_USAGE_API_KEY = $stored.ApiKey
  $env:CODEX_USAGE_PROVIDER_CONFIG_PATH = $stored.ConfigPath
  return $true
}

function Remove-CodexUsagePersistedProvider {
  Remove-Item -LiteralPath $CodexUsagePersistedProviderConfigPath,$CodexUsagePersistedProviderKeyPath -Force -ErrorAction SilentlyContinue
}

function Test-CodexUsagePersistedProvider {
  return (Test-Path -LiteralPath $CodexUsagePersistedProviderConfigPath -PathType Leaf) -and
    (Test-Path -LiteralPath $CodexUsagePersistedProviderKeyPath -PathType Leaf)
}

function Save-CodexUsagePersistedAccount {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Token,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[1-9][0-9]{0,19}$')]
    [string]$UserId,
    [string]$BaseUrl = 'https://www.cctq.ai'
  )

  if ([string]::IsNullOrWhiteSpace($Token)) { throw 'API 账户令牌不能为空。' }
  $baseUri = $null
  if (-not [Uri]::TryCreate($BaseUrl, [UriKind]::Absolute, [ref]$baseUri) -or $baseUri.Scheme -notin @('http', 'https')) {
    throw 'API 账户 BaseUrl 必须是有效的 HTTP 或 HTTPS 地址。'
  }
  if (-not [string]::IsNullOrEmpty($baseUri.UserInfo)) { throw 'API 账户 BaseUrl 不能包含凭据。' }
  $normalizedBaseUrl = $baseUri.AbsoluteUri.TrimEnd('/')
  New-Item -ItemType Directory -Force -Path $CodexUsageStateRoot | Out-Null
  $temporaryConfig = "$CodexUsagePersistedAccountConfigPath.$PID.tmp"
  $temporaryToken = "$CodexUsagePersistedAccountTokenPath.$PID.tmp"
  $plainBytes = $null
  $protectedBytes = $null
  try {
    $plainBytes = [Text.Encoding]::UTF8.GetBytes($Token)
    $protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
      $plainBytes,
      $CodexUsagePersistedAccountEntropy,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $configJson = [ordered]@{ schemaVersion = 1; baseUrl = $normalizedBaseUrl; userId = $UserId } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($temporaryConfig, $configJson, $CodexUsageUtf8)
    [IO.File]::WriteAllBytes($temporaryToken, $protectedBytes)
    Move-Item -LiteralPath $temporaryConfig -Destination $CodexUsagePersistedAccountConfigPath -Force
    Move-Item -LiteralPath $temporaryToken -Destination $CodexUsagePersistedAccountTokenPath -Force
  } finally {
    Remove-Item -LiteralPath $temporaryConfig,$temporaryToken -Force -ErrorAction SilentlyContinue
    if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
    if ($protectedBytes) { [Array]::Clear($protectedBytes, 0, $protectedBytes.Length) }
  }
}

function Get-CodexUsagePersistedAccount {
  $hasConfig = Test-Path -LiteralPath $CodexUsagePersistedAccountConfigPath -PathType Leaf
  $hasToken = Test-Path -LiteralPath $CodexUsagePersistedAccountTokenPath -PathType Leaf
  if (-not $hasConfig -and -not $hasToken) { return $null }
  if (-not $hasConfig -or -not $hasToken) { throw '持久化 API 账户配置不完整，请重新运行配置命令。' }

  $protectedBytes = $null
  $plainBytes = $null
  try {
    $config = Get-Content -LiteralPath $CodexUsagePersistedAccountConfigPath -Raw | ConvertFrom-Json
    if ($config.schemaVersion -ne 1 -or [string]::IsNullOrWhiteSpace([string]$config.baseUrl) -or [string]$config.userId -notmatch '^[1-9][0-9]{0,19}$') {
      throw 'API 账户配置格式无效。'
    }
    $protectedBytes = [IO.File]::ReadAllBytes($CodexUsagePersistedAccountTokenPath)
    $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
      $protectedBytes,
      $CodexUsagePersistedAccountEntropy,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    $token = [Text.Encoding]::UTF8.GetString($plainBytes)
    if ([string]::IsNullOrWhiteSpace($token)) { throw '持久化 API 账户令牌为空。' }
    return [pscustomobject]@{ Token = $token; UserId = [string]$config.userId; BaseUrl = [string]$config.baseUrl }
  } catch {
    throw "无法读取持久化 API 账户凭据，请重新运行配置命令。$($_.Exception.Message)"
  } finally {
    if ($protectedBytes) { [Array]::Clear($protectedBytes, 0, $protectedBytes.Length) }
    if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
  }
}

function Import-CodexUsagePersistedAccount {
  if ($env:CODEX_USAGE_DISABLE_PERSISTED_ACCOUNT -eq '1') { return $false }
  if ($env:CODEX_USAGE_ACCOUNT_TOKEN -or $env:CODEX_USAGE_ACCOUNT_USER_ID) { return $false }
  $stored = Get-CodexUsagePersistedAccount
  if (-not $stored) { return $false }
  $env:CODEX_USAGE_ACCOUNT_TOKEN = $stored.Token
  $env:CODEX_USAGE_ACCOUNT_USER_ID = $stored.UserId
  $env:CODEX_USAGE_ACCOUNT_BASE_URL = $stored.BaseUrl
  return $true
}

function Remove-CodexUsagePersistedAccount {
  Remove-Item -LiteralPath $CodexUsagePersistedAccountConfigPath,$CodexUsagePersistedAccountTokenPath -Force -ErrorAction SilentlyContinue
}

function Test-CodexUsagePersistedAccount {
  return (Test-Path -LiteralPath $CodexUsagePersistedAccountConfigPath -PathType Leaf) -and
    (Test-Path -LiteralPath $CodexUsagePersistedAccountTokenPath -PathType Leaf)
}

function Save-CodexUsageTokenBaseline {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(0, [long]::MaxValue)]
    [long]$InitialTokens,
    [Parameter(Mandatory = $true)]
    [ValidateRange(0, [long]::MaxValue)]
    [long]$CheckpointAt,
    [string[]]$RecentLogIds = @(),
    [ValidatePattern('^\d{4}-\d{2}-\d{2}$')]
    [string]$DailyDate = (Get-Date -Format 'yyyy-MM-dd'),
    [ValidateRange(0, [long]::MaxValue)]
    [long]$DailyTokens = 0,
    [ValidateRange(0, [long]::MaxValue)]
    [long]$DailyCheckpointAt = 0,
    [string[]]$DailyLogIds = @()
  )

  New-Item -ItemType Directory -Force -Path $CodexUsageStateRoot | Out-Null
  $temporaryPath = "$CodexUsageAccountCounterPath.$PID.tmp"
  try {
    $now = (Get-Date).ToUniversalTime().ToString('o')
    $state = [ordered]@{
      schemaVersion = 5
      baselineConfigured = $true
      initialTokens = $InitialTokens
      totalTokens = $InitialTokens
      checkpointAt = $CheckpointAt
      recentLogIds = @($RecentLogIds | Where-Object { $_ } | Select-Object -Last 100000)
      dailyDate = $DailyDate
      dailyTokens = $DailyTokens
      dailyCheckpointAt = $DailyCheckpointAt
      dailyLogIds = @($DailyLogIds | Where-Object { $_ } | Select-Object -Last 100000)
      configuredAt = $now
      updatedAt = $now
    }
    [IO.File]::WriteAllText($temporaryPath, ($state | ConvertTo-Json -Depth 4), $CodexUsageUtf8)
    Move-Item -LiteralPath $temporaryPath -Destination $CodexUsageAccountCounterPath -Force
  } finally {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
  }
}

function Get-CodexUsageTokenBaseline {
  if (-not (Test-Path -LiteralPath $CodexUsageAccountCounterPath -PathType Leaf)) { return $null }
  $state = Get-Content -LiteralPath $CodexUsageAccountCounterPath -Raw | ConvertFrom-Json
  if ($state.schemaVersion -notin @(1, 2, 3, 4, 5) -or [long]$state.totalTokens -lt 0 -or [long]$state.checkpointAt -lt 0) {
    throw '累计 Token 初始值配置格式无效，请重新配置。'
  }
  if ($state.schemaVersion -ge 2 -and ($state.dailyDate -notmatch '^\d{4}-\d{2}-\d{2}$' -or [long]$state.dailyTokens -lt 0)) {
    throw '每日 Token 计数格式无效，请重新配置。'
  }
  return $state
}

function Remove-CodexUsageTokenBaseline {
  Remove-Item -LiteralPath $CodexUsageAccountCounterPath -Force -ErrorAction SilentlyContinue
}

function Resolve-CodexUsageNodePath {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  $candidates = @(
    (Join-Path $CodexUsageRoot 'runtime\node.exe'),
    $env:CODEX_USAGE_NODE_PATH,
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'),
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    $(if ($nodeCommand) { $nodeCommand.Source } else { $null })
  ) | Where-Object { $_ } | Select-Object -Unique
  $outdated = @()
  foreach ($candidate in $candidates) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    $version = (& $candidate -p 'process.versions.node' 2>$null)
    $major = 0
    if ($LASTEXITCODE -eq 0 -and [int]::TryParse(([string]$version).Split('.')[0], [ref]$major) -and $major -ge 22) {
      return [IO.Path]::GetFullPath($candidate)
    }
    $outdated += "${candidate} ($version)"
  }
  if ($outdated.Count) { throw "需要 Node.js 22+。已找到但版本不兼容：$($outdated -join ', ')" }
  throw 'Node.js 未找到。请安装 Node.js 22+，或设置 CODEX_USAGE_NODE_PATH。'
}

function Get-CodexUsageAppPackage {
  $packageNames = @($env:CODEX_USAGE_APP_PACKAGE_NAME, 'OpenAI.Codex') | Where-Object { $_ } | Select-Object -Unique
  foreach ($name in $packageNames) {
    $package = Get-AppxPackage -Name $name -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
    if ($package) { return $package }
  }
  try {
    $package = Get-AppxPackage -ErrorAction Stop | Where-Object {
      $_.InstallLocation -and
      ($_.Name -match '(?i)OpenAI|Codex|ChatGPT') -and
      (Test-Path -LiteralPath (Join-Path $_.InstallLocation 'app\ChatGPT.exe') -PathType Leaf)
    } | Sort-Object Version -Descending | Select-Object -First 1
    if ($package) { return $package }
  } catch {}

  $codexCommand = Get-Command codex.exe -ErrorAction SilentlyContinue
  $codexPath = @($env:CODEX_USAGE_CODEX_PATH, $(if ($codexCommand) { $codexCommand.Source } else { $null })) |
    Where-Object { $_ -and $_ -match '(?i)[\\/]WindowsApps[\\/]' -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
    Select-Object -First 1
  if (-not $codexPath) { return $null }
  $installLocation = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent ([IO.Path]::GetFullPath($codexPath))))
  $folderName = Split-Path -Leaf $installLocation
  $match = [regex]::Match($folderName, '^(?<name>.+)_(?<version>\d+(?:\.\d+){3})_[^_]+__(?<publisher>[^_]+)$')
  if (-not $match.Success -or -not (Test-Path -LiteralPath (Join-Path $installLocation 'AppxManifest.xml') -PathType Leaf)) { return $null }
  return [pscustomobject]@{
    Name = $match.Groups['name'].Value
    InstallLocation = $installLocation
    PackageFamilyName = "$($match.Groups['name'].Value)_$($match.Groups['publisher'].Value)"
    Version = [version]$match.Groups['version'].Value
  }
}

function Get-CodexUsageNonStoreDesktopCandidates {
  [CmdletBinding()]
  param([string[]]$CandidatePaths)

  if ($CandidatePaths) {
    return @($CandidatePaths | Where-Object { $_ } | Select-Object -Unique)
  }

  $command = Get-Command ChatGPT.exe -ErrorAction SilentlyContinue
  $candidates = [Collections.Generic.List[string]]::new()
  foreach ($candidate in @(
    $env:CODEX_USAGE_DESKTOP_PATH,
    $(if ($command) { $command.Source } else { $null }),
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\ChatGPT\ChatGPT.exe' }),
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\OpenAI Codex\ChatGPT.exe' }),
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\ChatGPT.exe' }),
    $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'ChatGPT\ChatGPT.exe' }),
    $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'OpenAI Codex\ChatGPT.exe' }),
    $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'OpenAI\Codex\ChatGPT.exe' }),
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'ChatGPT\ChatGPT.exe' }),
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'OpenAI Codex\ChatGPT.exe' })
  ) | Where-Object { $_ }) {
    try { [void]$candidates.Add([IO.Path]::GetFullPath([string]$candidate)) } catch {}
  }

  $scanRoots = @(
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs' }),
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)}
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -Unique
  foreach ($root in $scanRoots) {
    try {
      Get-ChildItem -LiteralPath $root -Filter 'ChatGPT.exe' -File -Recurse -Depth 4 -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '(?i)[\\/]WindowsApps[\\/]|[\\/]node_modules[\\/]|[\\/]Temp[\\/]' } |
        ForEach-Object { [void]$candidates.Add($_.FullName) }
    } catch {}
  }
  return @($candidates | Select-Object -Unique)
}

function Resolve-CodexUsageNonStoreDesktopPath {
  [CmdletBinding()]
  param([string[]]$CandidatePaths)

  foreach ($candidate in Get-CodexUsageNonStoreDesktopCandidates -CandidatePaths $CandidatePaths) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return [IO.Path]::GetFullPath($candidate) }
  }
  return $null
}

function Resolve-CodexUsageCliPath {
  [CmdletBinding()]
  param([string]$DesktopPath)

  $command = Get-Command codex.exe -ErrorAction SilentlyContinue
  $package = Get-CodexUsageAppPackage
  $candidates = [Collections.Generic.List[string]]::new()
  foreach ($candidate in @(
    $env:CODEX_USAGE_CODEX_PATH,
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\OpenAI Codex CLI\codex.exe' }),
    $(if ($command) { $command.Source } else { $null }),
    $(if ($package) { Join-Path $package.InstallLocation 'app\resources\codex.exe' } else { $null })
  ) | Where-Object { $_ }) {
    try { [void]$candidates.Add([IO.Path]::GetFullPath([string]$candidate)) } catch {}
  }

  $desktop = if ($DesktopPath) { $DesktopPath } else { Resolve-CodexUsageNonStoreDesktopPath }
  if ($desktop -and (Test-Path -LiteralPath $desktop -PathType Leaf)) {
    $desktopDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($desktop))
    $installDirectory = Split-Path -Parent $desktopDirectory
    foreach ($candidate in @(
      (Join-Path $desktopDirectory 'resources\codex.exe'),
      (Join-Path $installDirectory 'resources\codex.exe'),
      (Join-Path $installDirectory 'codex.exe'),
      (Join-Path $desktopDirectory 'codex.exe')
    )) {
      [void]$candidates.Add($candidate)
    }
  }

  foreach ($candidate in @($candidates | Select-Object -Unique)) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return [IO.Path]::GetFullPath($candidate) }
  }
  return $null
}

function Test-CodexUsageWindowsAppsPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
  try { $fullPath = [IO.Path]::GetFullPath($Path) } catch { return $false }
  return $fullPath -match '(?i)(?:^|[\\/])WindowsApps(?:[\\/]|$)'
}

function Resolve-CodexUsageRunnableCliPath {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$CliPath,
    [string]$MirrorRoot = (Join-Path $CodexUsageStateRoot 'runtime\codex-cli')
  )

  $sourcePath = [IO.Path]::GetFullPath($CliPath)
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Codex CLI 不存在：$sourcePath" }
  if (-not (Test-CodexUsageWindowsAppsPath $sourcePath)) { return $sourcePath }

  $source = Get-Item -LiteralPath $sourcePath -ErrorAction Stop
  $identity = "$sourcePath|$($source.Length)|$($source.LastWriteTimeUtc.Ticks)"
  $identityBytes = [Text.Encoding]::UTF8.GetBytes($identity)
  $hasher = [Security.Cryptography.SHA256]::Create()
  try {
    $fingerprint = ([BitConverter]::ToString($hasher.ComputeHash($identityBytes))).Replace('-', '').ToLowerInvariant().Substring(0, 20)
  } finally {
    $hasher.Dispose()
    [Array]::Clear($identityBytes, 0, $identityBytes.Length)
  }

  $MirrorRoot = [IO.Path]::GetFullPath($MirrorRoot)
  $destination = Join-Path $MirrorRoot "codex-$fingerprint.exe"
  if ((Test-Path -LiteralPath $destination -PathType Leaf) -and (Get-Item -LiteralPath $destination).Length -eq $source.Length) {
    return $destination
  }

  New-Item -ItemType Directory -Force -Path $MirrorRoot | Out-Null
  $temporary = Join-Path $MirrorRoot ".$fingerprint-$PID.tmp"
  try {
    $sourceStream = $null
    $destinationStream = $null
    try {
      $sourceStream = [IO.File]::Open($sourcePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      $destinationStream = [IO.File]::Open($temporary, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
      $sourceStream.CopyTo($destinationStream, 1MB)
      $destinationStream.Flush()
    } finally {
      if ($destinationStream) { $destinationStream.Dispose() }
      if ($sourceStream) { $sourceStream.Dispose() }
    }
    if ((Get-Item -LiteralPath $temporary -ErrorAction Stop).Length -ne $source.Length) { throw '复制后的 Codex CLI 大小不一致。' }
    Move-Item -LiteralPath $temporary -Destination $destination -Force
  } catch {
    throw "无法为 Microsoft Store 版 Codex 创建用户级 CLI 副本：$($_.Exception.Message)"
  } finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }

  Get-ChildItem -LiteralPath $MirrorRoot -Filter 'codex-*.exe' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -ne $destination } |
    Remove-Item -Force -ErrorAction SilentlyContinue
  return $destination
}

function Get-CodexUsageState {
  foreach ($statePath in @($CodexUsageStatePath, $CodexUsageLegacyStatePath)) {
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { continue }
    try { return Get-Content -LiteralPath $statePath -Raw -Encoding utf8 | ConvertFrom-Json } catch {}
  }
  return $null
}

function Get-CodexUsageInjectorPathFromCommandLine([string]$CommandLine) {
  if (-not $CommandLine -or $CommandLine -notmatch '(?i)(?:^|\s)--watch(?:\s|$)') { return $null }
  $match = [regex]::Match($CommandLine, '(?i)(?:"(?<quoted>[^\"]*[\\/]scripts[\\/]injector\.mjs)"|(?<plain>\S*[\\/]scripts[\\/]injector\.mjs))')
  if (-not $match.Success) { return $null }
  $value = if ($match.Groups['quoted'].Success) { $match.Groups['quoted'].Value } else { $match.Groups['plain'].Value }
  try { return [IO.Path]::GetFullPath($value) } catch { return $null }
}

function Test-CodexUsagePackagePath([string]$InjectorPath) {
  if (-not $InjectorPath) { return $false }
  try {
    $full = [IO.Path]::GetFullPath($InjectorPath)
    if ([IO.Path]::GetFileName($full) -ine 'injector.mjs') { return $false }
    $scripts = Split-Path -Parent $full
    $package = Split-Path -Parent $scripts
    foreach ($relative in @('VERSION', 'assets\usage-inject.js', 'scripts\usage-client.mjs', 'scripts\monitor-utils.ps1')) {
      if (-not (Test-Path -LiteralPath (Join-Path $package $relative) -PathType Leaf)) { return $false }
    }
    return $true
  } catch { return $false }
}

function Get-CodexUsageInjectorProcesses {
  try {
    foreach ($process in Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop) {
      $commandLine = [string]$process.CommandLine
      $injectorPath = Get-CodexUsageInjectorPathFromCommandLine $commandLine
      if (-not $injectorPath -or -not (Test-CodexUsagePackagePath $injectorPath)) { continue }
      $port = 0
      $match = [regex]::Match($commandLine, '(?i)(?:^|\s)--port(?:=|\s+)(\d+)(?:\s|$)')
      if ($match.Success) { [void][int]::TryParse($match.Groups[1].Value, [ref]$port) }
      [pscustomobject]@{
        ProcessId = [int]$process.ProcessId
        ParentProcessId = [int]$process.ParentProcessId
        InjectorPath = $injectorPath
        Port = $port
        CommandLine = $commandLine
      }
    }
  } catch {}
}

function Get-CodexUsageInjectorById([int]$ProcessId) {
  if ($ProcessId -le 0) { return $null }
  return Get-CodexUsageInjectorProcesses | Where-Object { $_.ProcessId -eq $ProcessId } | Select-Object -First 1
}

function Test-CodexUsageReusableInjector($State, $InjectorProcess, [string]$InjectorPath) {
  if (-not $State -or -not $InjectorProcess -or -not $InjectorPath) { return $false }
  $statePid = if ($State.PSObject.Properties['injectorPid']) { [int]$State.injectorPid } else { 0 }
  $statePath = if ($State.PSObject.Properties['injectorPath']) { [string]$State.injectorPath } else { '' }
  $stateVersion = if ($State.PSObject.Properties['runtimeVersion']) { [string]$State.runtimeVersion } else { '' }
  return $InjectorProcess.ProcessId -eq $statePid -and
    $InjectorProcess.InjectorPath -eq $InjectorPath -and
    $statePath -eq $InjectorPath -and
    $stateVersion -eq $CodexUsageVersion
}

function Get-CodexUsageTargets([int]$Port) {
  if ($Port -lt 1024 -or $Port -gt 65535) { return @() }
  foreach ($hostName in @('127.0.0.1', '[::1]', 'localhost')) {
    $response = $null
    $reader = $null
    try {
      $request = [Net.HttpWebRequest]::Create("http://${hostName}:$Port/json/list")
      $request.Proxy = $null
      $request.Timeout = 1000
      $response = $request.GetResponse()
      $reader = [IO.StreamReader]::new($response.GetResponseStream(), $CodexUsageUtf8)
      return @(($reader.ReadToEnd() | ConvertFrom-Json))
    } catch {} finally {
      if ($reader) { $reader.Dispose() }
      if ($response) { $response.Dispose() }
    }
  }
  return @()
}

function Test-CodexUsageCdpPort([int]$Port) {
  return [bool](Get-CodexUsageTargets $Port | Where-Object { $_.type -eq 'page' -and [string]$_.url -like 'app://*' })
}

function Test-CodexUsageTcpPortAvailable([int]$Port) {
  if ($Port -lt 1024 -or $Port -gt 65535) { return $false }
  $listener = $null
  try {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    $listener.Server.ExclusiveAddressUse = $true
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($listener) { try { $listener.Stop() } catch {} }
  }
}

function Resolve-CodexUsageAvailablePort {
  [CmdletBinding()]
  param(
    [ValidateRange(1024, 65535)][int]$PreferredPort = 9335,
    [ValidateRange(1, 100)][int]$SearchCount = 20
  )
  for ($offset = 0; $offset -lt $SearchCount; $offset++) {
    $candidate = $PreferredPort + $offset
    if ($candidate -gt 65535) { break }
    if (Test-CodexUsageTcpPortAvailable $candidate) { return $candidate }
  }
  throw "从端口 $PreferredPort 开始的 $SearchCount 个本机端口均不可用。"
}

function Get-CodexUsageCdpCandidates {
  [CmdletBinding()]
  param(
    [ValidateRange(1024, 65535)][int]$PreferredPort = 9335,
    [int[]]$ProcessPorts = @(),
    [int]$ActiveFilePort = 0,
    [int]$StatePort = 0
  )

  $candidates = [Collections.Generic.List[int]]::new()
  foreach ($candidate in @($ProcessPorts) + @($ActiveFilePort, $StatePort, $PreferredPort, 9229, 9335)) {
    if ($candidate -lt 1024 -or $candidate -gt 65535) { continue }
    if (-not $candidates.Contains($candidate)) { $candidates.Add($candidate) }
  }
  return $candidates.ToArray()
}

function Resolve-CodexUsageCdpPort {
  [CmdletBinding()]
  param([ValidateRange(1024, 65535)][int]$PreferredPort = 9335)
  $processPorts = [Collections.Generic.List[int]]::new()
  try {
    foreach ($process in Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" -ErrorAction Stop) {
      foreach ($match in [regex]::Matches([string]$process.CommandLine, '--remote-debugging-port(?:=|\s+)(\d+)')) {
        $candidate = [int]$match.Groups[1].Value
        if (-not $processPorts.Contains($candidate)) { $processPorts.Add($candidate) }
      }
    }
  } catch {}
  $activeFilePort = 0
  $activePortPath = Join-Path $env:APPDATA 'Codex\DevToolsActivePort'
  if (Test-Path -LiteralPath $activePortPath -PathType Leaf) {
    [void][int]::TryParse([string](Get-Content -LiteralPath $activePortPath -TotalCount 1), [ref]$activeFilePort)
  }
  $state = Get-CodexUsageState
  $statePort = if ($state -and $state.port) { [int]$state.port } else { 0 }
  $candidates = Get-CodexUsageCdpCandidates -PreferredPort $PreferredPort -ProcessPorts $processPorts.ToArray() -ActiveFilePort $activeFilePort -StatePort $statePort
  foreach ($candidate in $candidates) { if (Test-CodexUsageCdpPort $candidate) { return $candidate } }
  return 0
}

function Start-CodexUsagePackagedCodex {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1024, 65535)]
    [int]$Port
  )
  $arguments = @(
    "--remote-debugging-port=$Port",
    '--remote-debugging-address=127.0.0.1',
    "--remote-allow-origins=http://127.0.0.1:$Port"
  )
  $desktopPath = $null
  $package = $null
  if ($env:CODEX_USAGE_DESKTOP_PATH) {
    $desktopPath = [IO.Path]::GetFullPath($env:CODEX_USAGE_DESKTOP_PATH)
    if (-not (Test-Path -LiteralPath $desktopPath -PathType Leaf)) { throw "CODEX_USAGE_DESKTOP_PATH 不存在：$desktopPath" }
  } else {
    $package = Get-CodexUsageAppPackage
    if (-not $package) { $desktopPath = Resolve-CodexUsageNonStoreDesktopPath }
  }
  if ($desktopPath) {
    $process = Start-Process -FilePath $desktopPath -ArgumentList $arguments -PassThru
    return [pscustomobject]@{ ProcessId = $process.Id; Port = $Port; AppUserModelId = $null }
  }
  $appUserModelId = $env:CODEX_USAGE_APP_USER_MODEL_ID
  if (-not $appUserModelId) {
    if (-not $package) { $package = Get-CodexUsageAppPackage }
    if (-not $package) { throw '未找到 Codex Store 应用包。可通过 CODEX_USAGE_APP_PACKAGE_NAME 或 CODEX_USAGE_DESKTOP_PATH 指定其他安装。' }
    $manifestPath = Join-Path $package.InstallLocation 'AppxManifest.xml'
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
      $manifest = [xml](Get-Content -LiteralPath $manifestPath -Raw)
    } else {
      $manifest = Get-AppxPackageManifest -Package $package
    }
    $applications = @($manifest.Package.Applications.Application)
    $application = $applications | Where-Object { [string]$_.Executable -match '(?i)ChatGPT\.exe$' } | Select-Object -First 1
    if (-not $application) { $application = $applications | Select-Object -First 1 }
    if (-not $application -or -not $application.Id) { throw '无法解析 Codex 应用入口。' }
    $appUserModelId = "$($package.PackageFamilyName)!$($application.Id)"
  }
  if (-not ('CodexUsageMonitorActivation.Launcher' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace CodexUsageMonitorActivation {
  [Flags] public enum ActivateOptions { None = 0, DesignMode = 1, NoErrorUI = 2, NoSplashScreen = 4 }
  [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IApplicationActivationManager {
    [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId, [MarshalAs(UnmanagedType.LPWStr)] string arguments, ActivateOptions options, out uint processId);
  }
  [ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")] public class ApplicationActivationManager {}
  public static class Launcher {
    public static uint Activate(string id, string args) {
      var manager = (IApplicationActivationManager)new ApplicationActivationManager();
      uint processId;
      int result = manager.ActivateApplication(id, args, ActivateOptions.NoErrorUI, out processId);
      Marshal.ThrowExceptionForHR(result);
      return processId;
    }
  }
}
'@
  }
  $processId = [CodexUsageMonitorActivation.Launcher]::Activate($appUserModelId, ($arguments -join ' '))
  return [pscustomobject]@{ ProcessId = [int]$processId; Port = $Port; AppUserModelId = $appUserModelId }
}

function Write-CodexUsageState($State) {
  New-Item -ItemType Directory -Force -Path $CodexUsageStateRoot | Out-Null
  $temporary = "$CodexUsageStatePath.$PID.tmp"
  try {
    $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding utf8
    Move-Item -LiteralPath $temporary -Destination $CodexUsageStatePath -Force
  } finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
}
