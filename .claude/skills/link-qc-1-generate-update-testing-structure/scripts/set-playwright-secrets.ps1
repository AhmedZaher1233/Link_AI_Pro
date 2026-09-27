<#
.SYNOPSIS
  Creates the OPTIONAL browser secrets file used by skill link-qc-3c-validate-manual-test-cases-cli
  (and by any Playwright MCP backend) so a validation run can log in without ever typing a
  password in chat or on a command line.

.DESCRIPTION
  Run this yourself in a PowerShell window (not through Claude). For each role it prompts for
  the role name, the username and the password (masked), and writes
    <ROLE>_USER=<username>
    <ROLE>_PASSWORD=<password>
  to %USERPROFILE%\.link-ai-pro\playwright-secrets.env (outside every repository, readable by
  this Windows account only). It then stores the file's path in the USER environment variable
  PLAYWRIGHT_MCP_SECRETS_FILE, which playwright-cli and the Playwright MCP server read: when a
  skill types the NAME (e.g. ADMIN_PASSWORD) into a field, the tool substitutes the value and
  masks it in every output. The skills only ever see and type the names.

  Nothing secret is echoed, logged, or written anywhere else. Attended login (you log in in the
  browser window the skill opens) works without this file — it is optional.

.USAGE
  powershell -ExecutionPolicy Bypass -File .claude/skills/link-qc-1-generate-update-testing-structure/scripts/set-playwright-secrets.ps1
  powershell ... set-playwright-secrets.ps1 -List      # print the role names / keys stored (never values)
  powershell ... set-playwright-secrets.ps1 -Remove    # delete the file and the variable
  Then FULLY QUIT VS Code (all windows) and relaunch it - a window reload does not pick up a new environment variable.
#>
[CmdletBinding()]
param(
  [string]$VariableName = 'PLAYWRIGHT_MCP_SECRETS_FILE',
  [string]$FilePath = (Join-Path $env:USERPROFILE '.link-ai-pro\playwright-secrets.env'),
  [switch]$List,
  [switch]$Remove
)

function Get-StoredKeys([string]$path) {
  if (-not (Test-Path $path)) { return @() }
  return @(Get-Content $path | Where-Object { $_ -match '^[A-Z0-9_]+=' } | ForEach-Object { ($_ -split '=', 2)[0] })
}

if ($Remove) {
  if (Test-Path $FilePath) { Remove-Item -Force $FilePath; Write-Host "Removed $FilePath." -ForegroundColor Yellow } else { Write-Host 'No secrets file found.' }
  [Environment]::SetEnvironmentVariable($VariableName, $null, 'User')
  Write-Host "Removed user environment variable $VariableName." -ForegroundColor Yellow
  exit 0
}

if ($List) {
  $cur = [Environment]::GetEnvironmentVariable($VariableName, 'User')
  if (-not $cur) { Write-Host "$VariableName is not set for this user."; exit 0 }
  Write-Host "$VariableName = $cur"
  $keys = Get-StoredKeys $cur
  if ($keys.Count -eq 0) { Write-Host 'Secrets file missing or empty.'; exit 0 }
  Write-Host 'Stored keys (values are never printed):'
  $keys | ForEach-Object { Write-Host "  $_" }
  exit 0
}

$dir = Split-Path $FilePath -Parent
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
$existingKeys = Get-StoredKeys $FilePath
$lines = @()
if (Test-Path $FilePath) { $lines = @(Get-Content $FilePath) }

while ($true) {
  $role = Read-Host 'Role name as the test cases call it (e.g. admin, hr-manager) — empty to finish'
  if ([string]::IsNullOrWhiteSpace($role)) { break }
  $key = ($role.Trim().ToUpperInvariant() -replace '[^A-Z0-9]+', '_').Trim('_')
  if (-not $key) { Write-Host 'Role name must contain letters or digits.'; continue }
  if ($existingKeys -contains "$($key)_PASSWORD") {
    $answer = Read-Host "$key already stored. Replace it? (y/N)"
    if ($answer -notmatch '^[Yy]') { Write-Host "Kept $key."; continue }
    $lines = @($lines | Where-Object { $_ -notmatch "^$($key)_(USER|PASSWORD)=" })
  }
  $user = Read-Host "Username for role $key"
  if ([string]::IsNullOrWhiteSpace($user)) { Write-Host 'No username entered. Skipped.'; continue }
  $secure = Read-Host "Password for role $key (input is hidden)" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if ([string]::IsNullOrWhiteSpace($plain)) { Write-Host 'No password entered. Skipped.'; $plain = $null; continue }
  $lines += "$($key)_USER=$($user.Trim())"
  $lines += "$($key)_PASSWORD=$plain"
  $plain = $null
  $existingKeys += "$($key)_PASSWORD"
  Write-Host "Stored $($key)_USER and $($key)_PASSWORD." -ForegroundColor Green
}

if ($lines.Count -eq 0) { Write-Host 'Nothing stored. No file written.'; exit 0 }
Set-Content -Path $FilePath -Value $lines -Encoding ascii
$lines = $null

# Restrict the file to this Windows account only.
try {
  $acl = Get-Acl $FilePath
  $acl.SetAccessRuleProtection($true, $false)
  $acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) | Out-Null }
  $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($me, 'FullControl', 'Allow')
  $acl.AddAccessRule($rule)
  Set-Acl $FilePath $acl
} catch { Write-Warning "Could not restrict the file ACL: $($_.Exception.Message)" }

[Environment]::SetEnvironmentVariable($VariableName, $FilePath, 'User')
$check = [Environment]::GetEnvironmentVariable($VariableName, 'User')
if ($check -eq $FilePath) {
  Write-Host "OK - $VariableName points at $FilePath (keys: $((Get-StoredKeys $FilePath) -join ', '))." -ForegroundColor Green
  Write-Host 'Now FULLY QUIT VS Code (close every window) and relaunch it - a window reload does not pick up the new variable. The skills type only the key names.'
  exit 0
} else {
  Write-Error "Failed to set $VariableName."
  exit 1
}
