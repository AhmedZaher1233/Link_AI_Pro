<#
.SYNOPSIS
  Creates the user-level environment variables AZURE_DEVOPS_PAT_B64 and AZURE_DEVOPS_PAT on this PC.

.DESCRIPTION
  Run this yourself in a PowerShell window (not through Claude). It prompts ONCE for the Azure DevOps
  Personal Access Token with a masked input and stores it in two forms as USER environment variables
  (persistent, this Windows account only), then verifies both exist:
    AZURE_DEVOPS_PAT_B64 = base64(":" + PAT)   — the cloud server (@azure-devops/mcp, dev.azure.com)
    AZURE_DEVOPS_PAT     = PAT                  — the self-hosted server (@tiberriver256/mcp-server-azure-devops)
  The .mcp.json entry references one of them as ${AZURE_DEVOPS_PAT_B64} / ${AZURE_DEVOPS_PAT}; both are
  written so switching the server never needs a second run. The token is never echoed, logged or written
  to any file other than the user registry hive Windows uses for environment variables.

  Required PAT scopes: Work Items (Read, Write & Manage) + Test Management (Read & Write).

.USAGE
  powershell -ExecutionPolicy Bypass -File .claude/skills/link-qc-1-generate-update-testing-structure/scripts/set-azure-devops-pat.ps1
  Then FULLY QUIT VS Code (all windows) and relaunch it. A window reload or an /mcp reconnect keeps the old
  process environment, so the MCP server would still start without the token (401 / anonymous access).
  -Remove deletes both variables.
#>
[CmdletBinding()]
param(
  [switch]$Remove
)

$Names = @('AZURE_DEVOPS_PAT_B64', 'AZURE_DEVOPS_PAT')

if ($Remove) {
  foreach ($n in $Names) { [Environment]::SetEnvironmentVariable($n, $null, 'User') }
  Write-Host "Removed user environment variables $($Names -join ', ')." -ForegroundColor Yellow
  exit 0
}

$existing = @($Names | Where-Object { [Environment]::GetEnvironmentVariable($_, 'User') })
if ($existing.Count -gt 0) {
  $answer = Read-Host "$($existing -join ' and ') already exist(s) for this user. Replace both? (y/N)"
  if ($answer -notmatch '^[Yy]') { Write-Host 'Left unchanged.'; exit 0 }
}

$secure = Read-Host 'Paste your Azure DevOps PAT (input is hidden)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
if ([string]::IsNullOrWhiteSpace($plain)) { Write-Error 'No token entered. Nothing changed.'; exit 1 }
$plain = $plain.Trim()
if ($plain.Length -lt 20) { Write-Error 'That does not look like a PAT (too short). Nothing changed.'; exit 1 }

$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(':' + $plain))

[Environment]::SetEnvironmentVariable('AZURE_DEVOPS_PAT_B64', $encoded, 'User')
[Environment]::SetEnvironmentVariable('AZURE_DEVOPS_PAT', $plain, 'User')
$plain = $null
$encoded = $null

$missing = @($Names | Where-Object { -not [Environment]::GetEnvironmentVariable($_, 'User') })
if ($missing.Count -eq 0) {
  foreach ($n in $Names) {
    $len = ([Environment]::GetEnvironmentVariable($n, 'User')).Length
    Write-Host "OK - $n is set for this Windows user (length $len)." -ForegroundColor Green
  }
  Write-Host 'Now FULLY QUIT VS Code (close every window) and relaunch it — a window reload or an /mcp reconnect does not pick up new environment variables. Then re-run the validation.'
  exit 0
} else {
  Write-Error "Failed to set $($missing -join ', ')."
  exit 1
}
