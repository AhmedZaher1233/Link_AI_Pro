<#
.SYNOPSIS
  Creates the user-level environment variable AZURE_DEVOPS_PAT_B64 on this PC.

.DESCRIPTION
  Run this yourself in a PowerShell window (not through Claude). It prompts for the Azure DevOps
  Personal Access Token with a masked input, encodes base64(":" + PAT), stores it as a
  USER environment variable (persistent, this Windows account only) and verifies it exists.
  The token is never echoed, logged or written to any file other than the user registry hive
  Windows uses for environment variables.

  Required PAT scopes: Work Items (Read, Write & Manage) + Test Management (Read & Write).

.USAGE
  powershell -ExecutionPolicy Bypass -File .claude/skills/1-generate-update-testing-structure/scripts/set-azure-devops-pat.ps1
  Then close and reopen every terminal / Claude Code / VS Code window so they see the variable.
#>
[CmdletBinding()]
param(
  [string]$VariableName = 'AZURE_DEVOPS_PAT_B64',
  [switch]$Remove
)

if ($Remove) {
  [Environment]::SetEnvironmentVariable($VariableName, $null, 'User')
  Write-Host "Removed user environment variable $VariableName." -ForegroundColor Yellow
  exit 0
}

$existing = [Environment]::GetEnvironmentVariable($VariableName, 'User')
if ($existing) {
  $answer = Read-Host "$VariableName already exists for this user. Replace it? (y/N)"
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
$plain = $null

[Environment]::SetEnvironmentVariable($VariableName, $encoded, 'User')
$encoded = $null

$check = [Environment]::GetEnvironmentVariable($VariableName, 'User')
if ($check) {
  Write-Host "OK - $VariableName is set for this Windows user (length $($check.Length))." -ForegroundColor Green
  Write-Host 'Close and reopen your terminals, VS Code and Claude Code so they pick it up, then reconnect the azure-devops MCP server (/mcp).'
  exit 0
} else {
  Write-Error "Failed to set $VariableName."
  exit 1
}
