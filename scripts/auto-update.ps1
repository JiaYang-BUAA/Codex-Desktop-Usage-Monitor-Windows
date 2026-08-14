[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
  [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
  [ValidateRange(1024, 65535)][int]$Port = 9335,
  [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\CodexUsageMonitor'),
  [string]$ShortcutDirectory = [Environment]::GetFolderPath('Desktop'),
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$ArchivePath = [IO.Path]::GetFullPath($ArchivePath)
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$stateRoot = Join-Path $env:LOCALAPPDATA 'CodexUsageMonitor'
$statePath = Join-Path $stateRoot 'update-state.json'
$extractRoot = Join-Path $stateRoot "updates\extract-$PID"
$expectedRootName = "codex-usage-monitor-windows-$Version"
$utf8 = [Text.UTF8Encoding]::new($false)

function Write-UpdateState([string]$Status, [string]$ErrorMessage = '') {
  New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
  $value = [ordered]@{ schemaVersion = 1; checkedAt = (Get-Date).ToUniversalTime().ToString('o'); status = $Status; currentVersion = $Version }
  if ($ErrorMessage) { $value.error = $ErrorMessage.Substring(0, [Math]::Min(500, $ErrorMessage.Length)) }
  $temporary = "$statePath.$PID.tmp"
  try {
    [IO.File]::WriteAllText($temporary, ($value | ConvertTo-Json), $utf8)
    Move-Item -LiteralPath $temporary -Destination $statePath -Force
  } finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
}

$stream = $null
$archive = $null
try {
  if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) { throw 'Downloaded update archive is missing.' }
  Add-Type -AssemblyName System.IO.Compression
  $stream = [IO.File]::Open($ArchivePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $actual = [Convert]::ToHexString($sha.ComputeHash($stream)).ToLowerInvariant() } finally { $sha.Dispose() }
  if ($actual -ne $ExpectedSha256.ToLowerInvariant()) { throw 'Downloaded update SHA-256 changed before installation.' }
  $stream.Position = 0
  $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Read, $false)
  if ($archive.Entries.Count -le 0 -or $archive.Entries.Count -gt 512) { throw 'Update archive has an invalid entry count.' }
  $totalLength = [int64]0
  $required = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($item in @('VERSION','install.ps1','config/package-files.json','scripts/start-monitor.ps1','scripts/auto-update.ps1')) { [void]$required.Add($item) }
  $entries = @()
  foreach ($entry in $archive.Entries) {
    $name = $entry.FullName.Replace('\', '/')
    if (-not $name.StartsWith("$expectedRootName/", [StringComparison]::Ordinal) -or $name.Contains([char]0) -or $name.Contains(':') -or $name -match '(^|/)\.\.(/|$)' -or $name.StartsWith('/')) {
      throw "Unsafe update archive path: $name"
    }
    $relative = $name.Substring($expectedRootName.Length + 1)
    if (-not $relative) { continue }
    foreach ($segment in $relative.TrimEnd('/').Split('/')) {
      if (-not $segment -or $segment -match '[ .]$' -or $segment -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$') {
        throw "Unsafe Windows update archive path: $name"
      }
    }
    $unixType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
    if ($unixType -eq 0xA000) { throw "Update archive contains a symbolic link: $name" }
    if (-not $name.EndsWith('/')) {
      if ($entry.Length -gt 64MB) { throw "Update archive entry is too large: $name" }
      $totalLength += $entry.Length
      if ($totalLength -gt 128MB) { throw 'Update archive expands beyond the safety limit.' }
      [void]$required.Remove($relative)
      $entries += [pscustomobject]@{ Entry = $entry; Relative = $relative }
    }
  }
  if ($required.Count) { throw "Update archive is missing required files: $($required -join ', ')" }
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
  $packageRoot = Join-Path $extractRoot $expectedRootName
  $packagePrefix = [IO.Path]::GetFullPath($packageRoot).TrimEnd('\') + '\'
  foreach ($item in $entries) {
    $destination = [IO.Path]::GetFullPath((Join-Path $packageRoot $item.Relative))
    if (-not $destination.StartsWith($packagePrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Update path escapes extraction root: $($item.Relative)" }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    $sourceStream = $item.Entry.Open()
    $destinationStream = $null
    try {
      $destinationStream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      $sourceStream.CopyTo($destinationStream)
    } finally {
      if ($destinationStream) { $destinationStream.Dispose() }
      $sourceStream.Dispose()
    }
  }
  $archive.Dispose(); $archive = $null
  $stream.Dispose(); $stream = $null
  if ((Get-Content -LiteralPath (Join-Path $packageRoot 'VERSION') -Raw).Trim() -ne $Version) { throw 'Update package VERSION does not match the release tag.' }
  if ($ValidateOnly) { Write-Host "Validated update package $Version."; return }
  & (Join-Path $packageRoot 'install.ps1') -Port $Port -InstallRoot $InstallRoot -ShortcutDirectory $ShortcutDirectory -NonInteractive
  $installedRoot = Join-Path $InstallRoot $Version
  if (-not (Test-Path -LiteralPath (Join-Path $installedRoot 'scripts\start-monitor.ps1') -PathType Leaf)) { throw 'Installed update could not be verified.' }
  Write-UpdateState 'installed'
  $pwsh = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
  if (-not $pwsh) { $pwsh = (Get-Command powershell.exe -ErrorAction Stop).Source }
  Start-Process -FilePath $pwsh -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $installedRoot 'scripts\start-monitor.ps1'),'-Port',"$Port",'-Replace') -WindowStyle Hidden
} catch {
  Write-UpdateState 'error' $_.Exception.Message
  throw
} finally {
  if ($archive) { $archive.Dispose() }
  if ($stream) { $stream.Dispose() }
  Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $ArchivePath -Force -ErrorAction SilentlyContinue
}
