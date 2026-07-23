[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 9335,
  [switch]$FromClipboard,
  [switch]$SessionOnly
)

$ErrorActionPreference = 'Stop'
$config = Join-Path (Split-Path -Parent $PSScriptRoot) 'config\providers\cctq.example.json'
& (Join-Path $PSScriptRoot 'configure-api-provider.ps1') -Port $Port -ConfigPath $config -FromClipboard:$FromClipboard -SessionOnly:$SessionOnly
exit $LASTEXITCODE
