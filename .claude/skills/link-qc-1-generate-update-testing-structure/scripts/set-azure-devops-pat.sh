#!/usr/bin/env bash
# Creates the user-level environment variable AZURE_DEVOPS_PAT_B64 on macOS / Linux.
# Run it yourself in a terminal (not through Claude): it prompts for the PAT with hidden input,
# encodes base64(":" + PAT), appends an export line to your shell profile and verifies it.
# The token is never echoed or logged. Required PAT scopes: Work Items Read/Write/Manage +
# Test Management Read/Write.
#
#   bash .claude/skills/1-generate-update-testing-structure/scripts/set-azure-devops-pat.sh
#   then open a new terminal / restart Claude Code and reconnect the azure-devops MCP server.
set -euo pipefail
VAR="${1:-AZURE_DEVOPS_PAT_B64}"

case "${SHELL:-}" in
  */zsh)  PROFILE="$HOME/.zshrc" ;;
  */bash) PROFILE="$HOME/.bashrc"; [ -f "$HOME/.bash_profile" ] && [ "$(uname)" = "Darwin" ] && PROFILE="$HOME/.bash_profile" ;;
  *)      PROFILE="$HOME/.profile" ;;
esac

if grep -q "^export $VAR=" "$PROFILE" 2>/dev/null; then
  read -r -p "$VAR already exists in $PROFILE. Replace it? (y/N) " ans
  [[ "$ans" =~ ^[Yy] ]] || { echo "Left unchanged."; exit 0; }
  sed -i.bak "/^export $VAR=/d" "$PROFILE"
fi

read -r -s -p "Paste your Azure DevOps PAT (input is hidden): " PAT; echo
PAT="$(printf '%s' "$PAT" | tr -d '[:space:]')"
[ -n "$PAT" ] || { echo "No token entered. Nothing changed." >&2; exit 1; }
[ "${#PAT}" -ge 20 ] || { echo "That does not look like a PAT (too short). Nothing changed." >&2; exit 1; }

ENCODED="$(printf ':%s' "$PAT" | base64 | tr -d '\n')"
unset PAT
printf '\nexport %s=%s\n' "$VAR" "$ENCODED" >> "$PROFILE"
unset ENCODED

if grep -q "^export $VAR=" "$PROFILE"; then
  echo "OK — $VAR added to $PROFILE."
  echo "Open a new terminal (or: source $PROFILE), restart Claude Code, then reconnect the azure-devops MCP server (/mcp)."
else
  echo "Failed to write $PROFILE." >&2; exit 1
fi
