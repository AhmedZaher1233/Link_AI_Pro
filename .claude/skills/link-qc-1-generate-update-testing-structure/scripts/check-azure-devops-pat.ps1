<#
.SYNOPSIS
  Diagnoses the AZURE_DEVOPS_PAT_B64 environment variable WITHOUT revealing anything about its value.

.DESCRIPTION
  Run it yourself in a PowerShell window (the first diagnostic step of
  references/azure-mcp-troubleshooting.md). It prints ONLY booleans:
    User-scope set                 - the variable exists for this Windows user (registry hive)
    Current process set            - this PowerShell process received it (a window opened after the
                                     variable was set answers for VS Code too)
    Both values equal              - user-scope and process values are identical (not an old value)
    Valid base64                   - the process value decodes as base64
    Decodes with a leading ':'     - the decoded text starts with ':' (base64(":" + PAT), what
                                     @azure-devops/mcp expects)
  It never prints the value, its length or any part of it, and ends with the one-line fix for the
  first failing check. Its output is safe to paste into the chat.

.USAGE
  powershell -ExecutionPolicy Bypass -File .claude/skills/link-qc-1-generate-update-testing-structure/scripts/check-azure-devops-pat.ps1
#>
[CmdletBinding()]
param()

$Name = 'AZURE_DEVOPS_PAT_B64'

$userValue = [Environment]::GetEnvironmentVariable($Name, 'User')
$procValue = [Environment]::GetEnvironmentVariable($Name, 'Process')

$userSet = -not [string]::IsNullOrEmpty($userValue)
$procSet = -not [string]::IsNullOrEmpty($procValue)
$equal   = $userSet -and $procSet -and ([string]::Equals($userValue, $procValue, [StringComparison]::Ordinal))

$validB64 = $false
$leadingColon = $false
if ($procSet) {
  try {
    $bytes = [Convert]::FromBase64String($procValue.Trim())
    $validB64 = $true
    $decoded = [Text.Encoding]::UTF8.GetString($bytes)
    $leadingColon = $decoded.Length -gt 1 -and $decoded[0] -eq ':'
    $decoded = $null
    $bytes = $null
  } catch {
    $validB64 = $false
  }
}
$userValue = $null
$procValue = $null

Write-Host "$Name"
Write-Host ("  User-scope set             : {0}" -f $userSet)
Write-Host ("  Current process set        : {0}" -f $procSet)
Write-Host ("  Both values equal          : {0}" -f $equal)
Write-Host ("  Valid base64               : {0}" -f $validB64)
Write-Host ("  Decodes with a leading ':' : {0}" -f $leadingColon)
Write-Host ''

$fix = $null
if (-not $userSet) {
  $fix = 'FIX: the variable is not set - follow "Set or replace the PAT" (azure-mcp-troubleshooting.md section 4).'
} elseif (-not $procSet) {
  $fix = 'FIX: set for this user but not in this process - fully quit VS Code (every window, no Code.exe in Task Manager) and relaunch it; Reload Window and /mcp reconnect do not reload environment variables.'
} elseif (-not $equal) {
  $fix = 'FIX: this process still holds an older value - fully quit VS Code (every window) and relaunch it.'
} elseif (-not $validB64 -or -not $leadingColon) {
  $fix = 'FIX: the value is not base64(":" + PAT) - follow "Set or replace the PAT" (azure-mcp-troubleshooting.md section 4) and answer y to "Replace both? (y/N)".'
}

if ($fix) {
  Write-Host $fix -ForegroundColor Yellow
  exit 1
}
Write-Host 'OK: every check passed. If Azure DevOps still answers TF400813, the PAT is expired or revoked (guide row 5); 401 on some calls or 403 means a missing PAT scope (row 6).' -ForegroundColor Green
exit 0
