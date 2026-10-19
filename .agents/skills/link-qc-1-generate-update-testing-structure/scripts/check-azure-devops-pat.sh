#!/usr/bin/env bash
# Diagnoses the AZURE_DEVOPS_PAT_B64 environment variable WITHOUT revealing anything about its value
# (macOS / Linux twin of check-azure-devops-pat.ps1; the first diagnostic step of
# references/azure-mcp-troubleshooting.md). Run it yourself in a terminal. It prints ONLY booleans:
#   User-scope set              - an "export AZURE_DEVOPS_PAT_B64=" line exists in your shell profile
#   Current process set         - this shell received the variable (a terminal opened after the
#                                 variable was set answers for the editor too)
#   Both values equal           - profile value and process value are identical (not an old value)
#   Valid base64                - the process value decodes as base64
#   Decodes with a leading ':'  - the decoded text starts with ':' (base64(":" + PAT))
# It never prints the value, its length or any part of it, and ends with the one-line fix for the
# first failing check. Its output is safe to paste into the chat.
#
#   bash .claude/skills/link-qc-1-generate-update-testing-structure/scripts/check-azure-devops-pat.sh
set -u
NAME=AZURE_DEVOPS_PAT_B64

case "${SHELL:-}" in
  */zsh)  PROFILE="$HOME/.zshrc" ;;
  */bash) PROFILE="$HOME/.bashrc"; [ -f "$HOME/.bash_profile" ] && [ "$(uname)" = "Darwin" ] && PROFILE="$HOME/.bash_profile" ;;
  *)      PROFILE="$HOME/.profile" ;;
esac

user_value=""
if [ -f "$PROFILE" ]; then
  user_value="$(grep -E "^export $NAME=" "$PROFILE" 2>/dev/null | tail -n 1 | sed -E "s/^export $NAME=//; s/^[\"']//; s/[\"']$//")"
fi
proc_value="${AZURE_DEVOPS_PAT_B64:-}"

user_set=False; proc_set=False; equal=False; valid_b64=False; leading_colon=False
[ -n "$user_value" ] && user_set=True
[ -n "$proc_value" ] && proc_set=True
[ "$user_set" = True ] && [ "$proc_set" = True ] && [ "$user_value" = "$proc_value" ] && equal=True

if [ "$proc_set" = True ]; then
  if decoded="$(printf '%s' "$proc_value" | tr -d '[:space:]' | base64 -d 2>/dev/null)"; then
    valid_b64=True
    case "$decoded" in :?*) leading_colon=True ;; esac
  fi
fi
unset decoded user_value proc_value

echo "$NAME"
echo "  User-scope set             : $user_set"
echo "  Current process set        : $proc_set"
echo "  Both values equal          : $equal"
echo "  Valid base64               : $valid_b64"
echo "  Decodes with a leading ':' : $leading_colon"
echo

if [ "$user_set" != True ]; then
  echo 'FIX: the variable is not set - follow "Set or replace the PAT" (azure-mcp-troubleshooting.md section 4).'; exit 1
elif [ "$proc_set" != True ]; then
  echo 'FIX: set in the profile but not in this process - fully quit the editor and relaunch it from a NEW terminal (or after: source your profile); a window reload or /mcp reconnect does not reload environment variables.'; exit 1
elif [ "$equal" != True ]; then
  echo 'FIX: this process still holds an older value - fully quit the editor and relaunch it from a NEW terminal.'; exit 1
elif [ "$valid_b64" != True ] || [ "$leading_colon" != True ]; then
  echo 'FIX: the value is not base64(":" + PAT) - follow "Set or replace the PAT" (azure-mcp-troubleshooting.md section 4) and answer y to "Replace both? (y/N)".'; exit 1
fi
echo 'OK: every check passed. If Azure DevOps still answers TF400813, the PAT is expired or revoked (guide row 5); 401 on some calls or 403 means a missing PAT scope (row 6).'
exit 0
