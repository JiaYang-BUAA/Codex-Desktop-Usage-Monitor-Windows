$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$helper = Join-Path $root 'scripts\configure-from-panel.ps1'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "codex-usage-panel-config-test-$PID"
$savedLocalAppData = $env:LOCALAPPDATA
$testKey = 'unit-test-panel-key-do-not-use'
$testAccountToken = 'unit-test-panel-account-token-do-not-use'
$serverJob = $null

function Invoke-PanelHelper($Payload) {
  $pwsh = (Get-Command pwsh -ErrorAction Stop).Source
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $pwsh
  $startInfo.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$helper`""
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw 'Unable to start panel helper.' }
    $process.StandardInput.Write(($Payload | ConvertTo-Json -Depth 12 -Compress))
    $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    if (-not $process.WaitForExit(30000)) { $process.Kill(); throw 'Panel helper timed out.' }
    $line = @($stdout -split '\r?\n' | Where-Object { $_.Trim() })[-1]
    if (-not $line) { throw "Panel helper returned no JSON. $stderr" }
    return $line | ConvertFrom-Json
  } finally {
    $process.Dispose()
  }
}

try {
  New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
  $env:LOCALAPPDATA = $testRoot
  $providerResult = Invoke-PanelHelper ([ordered]@{
    requestId = 'panel-test-provider'
    type = 'api-key'
    apiKey = $testKey
    provider = [ordered]@{
      id = 'custom'; label = 'Test API'; baseUrl = 'https://api.example.test'
      usagePath = '/v1/usage'; statusPath = ''; authHeader = 'Authorization'; authScheme = 'Bearer'
      usageRoot = 'data'; statusRoot = 'data'; used = 'used'; limit = 'limit'; unlimited = 'unlimited'
      expiresAt = 'expires_at'; quotaPerUnit = 'quota_per_unit'; currency = 'currency'
      defaultQuotaPerUnit = 1; defaultCurrency = 'USD'
    }
  })
  if (-not $providerResult.ok) { throw "Provider panel configuration failed: $($providerResult.message)" }
  $stateRoot = Join-Path $testRoot 'CodexUsageMonitor'
  $providerPath = Join-Path $stateRoot 'provider.json'
  $keyPath = Join-Path $stateRoot 'api-key.dpapi'
  if (-not (Test-Path -LiteralPath $providerPath -PathType Leaf) -or -not (Test-Path -LiteralPath $keyPath -PathType Leaf)) {
    throw 'Panel configuration did not create both provider files.'
  }
  if ((Get-Content -LiteralPath $providerPath -Raw).Contains($testKey)) { throw 'Provider JSON contains plaintext API key.' }
  if ([Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($keyPath)).Contains($testKey)) { throw 'DPAPI file contains plaintext API key.' }

  . (Join-Path $root 'scripts\monitor-utils.ps1')
  $stored = Get-CodexUsagePersistedProvider
  if ($stored.ApiKey -ne $testKey) { throw 'DPAPI panel key round-trip failed.' }

  $invalidResult = Invoke-PanelHelper ([ordered]@{
    requestId = 'panel-test-account'
    type = 'api-account'
    baseUrl = 'https://www.cctq.ai'
    userId = '0'
    token = 'invalid-test-token'
    initialTokens = '0'
  })
  if ($invalidResult.ok) { throw 'Invalid account request was accepted.' }
  if (Test-Path -LiteralPath (Join-Path $stateRoot 'account.json')) { throw 'Invalid account request created a configuration file.' }

  $invalidBaseline = Invoke-PanelHelper ([ordered]@{
    requestId = 'panel-test-baseline'
    type = 'api-account'
    baseUrl = 'https://www.cctq.ai'
    userId = '10530'
    token = 'invalid-test-token'
    initialTokens = '1万'
  })
  if ($invalidBaseline.ok) { throw 'Invalid token baseline was accepted.' }

  $tcp = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $tcp.Start()
  $port = ([Net.IPEndPoint]$tcp.LocalEndpoint).Port
  $tcp.Stop()
  $serverJob = Start-Job -ArgumentList $port -ScriptBlock {
    param($Port)
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    $listener.Start()
    try {
      for ($index = 0; $index -lt 2; $index++) {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
        $requestLine = $reader.ReadLine()
        while ($reader.ReadLine()) {}
        $path = (($requestLine -split ' ')[1] -split '\?')[0]
        $body = if ($path -eq '/api/user/self') {
          '{"data":{"quota":1000000,"used_quota":1000}}'
        } elseif ($path -eq '/api/log/self') {
          $createdAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
          "{`"data`":{`"total`":1,`"page_size`":1000,`"items`":[{`"request_id`":`"baseline-test`",`"created_at`":$createdAt,`"prompt_tokens`":2,`"completion_tokens`":3}]}}"
        } else {
          '{}'
        }
        $bytes = [Text.Encoding]::UTF8.GetBytes($body)
        $status = if ($path -in @('/api/user/self', '/api/log/self')) { '200 OK' } else { '404 Not Found' }
        $headers = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $status`r`nContent-Type: application/json`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n")
        $stream.Write($headers, 0, $headers.Length)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()
        $reader.Dispose()
        $stream.Dispose()
        $client.Dispose()
      }
    } finally {
      $listener.Stop()
    }
  }
  Start-Sleep -Milliseconds 600
  $accountResult = Invoke-PanelHelper ([ordered]@{
    requestId = 'panel-valid-account'
    type = 'api-account'
    baseUrl = "http://127.0.0.1:$port"
    userId = '10530'
    token = $testAccountToken
    initialTokens = '12345'
  })
  if (-not $accountResult.ok) { throw "Account panel configuration failed: $($accountResult.message)" }
  if ([string]$accountResult.configuration.account.initialTokens -ne '12345') { throw 'Account panel result omitted the token baseline.' }
  $counter = Get-Content -LiteralPath (Join-Path $stateRoot 'account-token-counter.json') -Raw | ConvertFrom-Json
  if ($counter.baselineConfigured -ne $true -or [long]$counter.initialTokens -ne 12345L) { throw 'Token baseline was not persisted.' }
  $storedAccount = Get-CodexUsagePersistedAccount
  if ($storedAccount.Token -ne $testAccountToken) { throw 'DPAPI account token round-trip failed.' }
  if ((Get-Content -LiteralPath (Join-Path $stateRoot 'account.json') -Raw).Contains($testAccountToken)) { throw 'Account JSON contains plaintext token.' }
  Wait-Job -Job $serverJob -Timeout 10 | Out-Null
  if ($serverJob.State -ne 'Completed') { throw 'Local account test server did not complete.' }

  Write-Host 'PASS: panel configuration validation, cumulative token baseline, DPAPI persistence, and plaintext protection.'
} finally {
  if ($serverJob) { Stop-Job -Job $serverJob -ErrorAction SilentlyContinue; Remove-Job -Job $serverJob -Force -ErrorAction SilentlyContinue }
  $env:LOCALAPPDATA = $savedLocalAppData
  $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $resolvedTest = [IO.Path]::GetFullPath($testRoot)
  if ($resolvedTest.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedTest -Recurse -Force -ErrorAction SilentlyContinue
  }
}
