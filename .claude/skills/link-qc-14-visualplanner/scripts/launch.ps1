<#
.SYNOPSIS
  Opens a generated visualplanner breakdown in the browser.

.DESCRIPTION
  Run it right after the HTML file is written. By default the page opens in the default browser; pass -Browser edge
  or -Browser chrome to pick one (in Chrome and Edge, the page's Save button writes back into the same file).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File launch.ps1 -Path .\specs\008-audit\audit-breakdown.html
#>
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Path,
  [ValidateSet('default', 'edge', 'chrome')][string]$Browser = 'default'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
  Write-Error "Breakdown not found: $Path"
  exit 1
}

$full = (Resolve-Path -LiteralPath $Path).ProviderPath
$uri = ([System.Uri]$full).AbsoluteUri

switch ($Browser) {
  'edge'   { Start-Process -FilePath 'msedge' -ArgumentList $uri }
  'chrome' { Start-Process -FilePath 'chrome' -ArgumentList $uri }
  default  { Start-Process -FilePath $full }
}

Write-Output "Opened $full"
