#!/usr/bin/env bash
# Creates the user-level environment variables AZURE_DEVOPS_PAT_B64 and AZURE_DEVOPS_PAT on macOS / Linux.
# Run it yourself in a terminal (not through Claude): it prompts ONCE for the PAT with hidden input and
# appends two export lines to your shell profile, then verifies them:
#   AZURE_DEVOPS_PAT_B64 = base64(":" + PAT)   — the cloud server (@azure-devops/mcp, dev.azure.com)
#   AZURE_DEVOPS_PAT     = PAT                  — the self-hosted server (@tiberriver256/mcp-server-azure-devops)
# The .mcp.json entry references one of them; both are written so switching the server never needs a second
# run. The token is never echoed or logged. Required PAT scopes: Work Items Read/Write/Manage +
# Test Management Read/Write.
#
#   bash .claude/skills/link-qc-1-generate-update-testing-structure/scripts/set-azure-devops-pat.sh
#   then FULLY QUIT VS Code (all windows) and relaunch it — a window reload or an /mcp reconnect keeps the old
#   process environment, so the MCP server would still start without the token (401 / anonymous access).
#   --remove deletes both lines from the profile.
set -euo pipefail
NAMES=(AZURE_DEVOPS_PAT_B64 AZURE_DEVOPS_PAT)

case "${SHELL:-}" in
  */zsh)  PROFILE="$HOME/.zshrc" ;;
  */bash) PROFILE="$HOME/.bashrc"; [ -f "$HOME/.bash_profile" ] && [ "$(uname)" = "Darwin" ] && PROFILE="$HOME/.bash_profile" ;;
  *)      PROFILE="$HOME/.profile" ;;
esac

if [ "${1:-}" = "--remove" ]; then
  for VAR in "${NAMES[@]}"; do sed -i.bak "/^export $VAR=/d" "$PROFILE" 2>/dev/null || true; done
  echo "Removed ${NAMES[*]} from $PROFILE (open a new terminal)."
  exit 0
fi

EXISTING=()
for VAR in "${NAMES[@]}"; do grep -q "^export $VAR=" "$PROFILE" 2>/dev/null && EXISTING+=("$VAR"); done
if [ "${#EXISTING[@]}" -gt 0 ]; then
  read -r -p "${EXISTING[*]} already exist(s) in $PROFILE. Replace both? (y/N) " ans
  [[ "$ans" =~ ^[Yy] ]] || { echo "Left unchanged."; exit 0; }
  for VAR in "${NAMES[@]}"; do sed -i.bak "/^export $VAR=/d" "$PROFILE"; done
fi

read -r -s -p "Paste your Azure DevOps PAT (input is hidden): " PAT; echo
PAT="$(printf '%s' "$PAT" | tr -d '[:space:]')"
[ -n "$PAT" ] || { echo "No token entered. Nothing changed." >&2; exit 1; }
[ "${#PAT}" -ge 20 ] || { echo "That does not look like a PAT (too short). Nothing changed." >&2; exit 1; }

ENCODED="$(printf ':%s' "$PAT" | base64 | tr -d '\n')"
printf '\nexport %s=%s\nexport %s=%s\n' "AZURE_DEVOPS_PAT_B64" "$ENCODED" "AZURE_DEVOPS_PAT" "$PAT" >> "$PROFILE"
unset PAT ENCODED

OK=1
for VAR in "${NAMES[@]}"; do grep -q "^export $VAR=" "$PROFILE" || OK=0; done
if [ "$OK" = 1 ]; then
  echo "OK — ${NAMES[*]} added to $PROFILE."
  echo "Now FULLY QUIT VS Code (close every window) and relaunch it from a NEW terminal (or after: source $PROFILE) — a window reload or an /mcp reconnect does not pick up new environment variables. Then re-run the validation."
else
  echo "Failed to write $PROFILE." >&2; exit 1
fi
