#!/usr/bin/env bash
# Creates the OPTIONAL browser secrets file used by skill link-qc-3c-validate-manual-test-cases-cli (and by
# any Playwright MCP backend) on macOS / Linux, so a validation run can log in without a password ever
# being typed in chat or on a command line.
#
# Run it yourself in a terminal (not through Claude). Per role it prompts for the role name, the
# username and the password (hidden) and writes <ROLE>_USER / <ROLE>_PASSWORD lines to
# ~/.link-ai-pro/playwright-secrets.env (chmod 600, outside every repository). It then exports
# PLAYWRIGHT_MCP_SECRETS_FILE=<that path> from your shell profile; playwright-cli and the Playwright MCP
# server read it and substitute a secret NAME typed into a field with its value (masked in output).
# The skills only ever see and type the names. Nothing secret is echoed or logged.
#
#   bash .claude/skills/link-qc-1-generate-update-testing-structure/scripts/set-playwright-secrets.sh
#   bash ... set-playwright-secrets.sh --list     # key names only, never values
#   bash ... set-playwright-secrets.sh --remove   # delete the file and the export line
#   then fully quit VS Code (all windows) and relaunch it from a new terminal — a window reload does not pick up the new variable.
set -euo pipefail
VAR="PLAYWRIGHT_MCP_SECRETS_FILE"
FILE="$HOME/.link-ai-pro/playwright-secrets.env"

case "${SHELL:-}" in
  */zsh)  PROFILE="$HOME/.zshrc" ;;
  */bash) PROFILE="$HOME/.bashrc"; [ -f "$HOME/.bash_profile" ] && [ "$(uname)" = "Darwin" ] && PROFILE="$HOME/.bash_profile" ;;
  *)      PROFILE="$HOME/.profile" ;;
esac

keys() { [ -f "$FILE" ] && grep -E '^[A-Z0-9_]+=' "$FILE" | cut -d= -f1 || true; }

if [ "${1:-}" = "--remove" ]; then
  [ -f "$FILE" ] && rm -f "$FILE" && echo "Removed $FILE."
  [ -f "$PROFILE" ] && sed -i.bak "/^export $VAR=/d" "$PROFILE" && echo "Removed export $VAR from $PROFILE."
  exit 0
fi

if [ "${1:-}" = "--list" ]; then
  if ! grep -q "^export $VAR=" "$PROFILE" 2>/dev/null; then echo "$VAR is not set in $PROFILE."; exit 0; fi
  echo "$VAR is exported from $PROFILE."
  k="$(keys)"; [ -n "$k" ] && { echo "Stored keys (values are never printed):"; echo "$k" | sed 's/^/  /'; } || echo "Secrets file missing or empty."
  exit 0
fi

mkdir -p "$(dirname "$FILE")"
touch "$FILE"; chmod 600 "$FILE"

while true; do
  read -r -p "Role name as the test cases call it (e.g. admin, hr-manager) — empty to finish: " role
  [ -n "${role// }" ] || break
  key="$(printf '%s' "$role" | tr '[:lower:]' '[:upper:]' | sed -E 's/[^A-Z0-9]+/_/g; s/^_+|_+$//g')"
  [ -n "$key" ] || { echo "Role name must contain letters or digits."; continue; }
  if grep -q "^${key}_PASSWORD=" "$FILE"; then
    read -r -p "$key already stored. Replace it? (y/N) " ans
    [[ "$ans" =~ ^[Yy] ]] || { echo "Kept $key."; continue; }
    sed -i.bak "/^${key}_\(USER\|PASSWORD\)=/d" "$FILE"; rm -f "$FILE.bak"
  fi
  read -r -p "Username for role $key: " user
  [ -n "${user// }" ] || { echo "No username entered. Skipped."; continue; }
  read -r -s -p "Password for role $key (input is hidden): " pass; echo
  [ -n "$pass" ] || { echo "No password entered. Skipped."; continue; }
  printf '%s_USER=%s\n%s_PASSWORD=%s\n' "$key" "$user" "$key" "$pass" >> "$FILE"
  unset pass
  echo "Stored ${key}_USER and ${key}_PASSWORD."
done

if [ ! -s "$FILE" ]; then rm -f "$FILE"; echo "Nothing stored. No file written."; exit 0; fi
chmod 600 "$FILE"
if grep -q "^export $VAR=" "$PROFILE" 2>/dev/null; then sed -i.bak "/^export $VAR=/d" "$PROFILE"; rm -f "$PROFILE.bak"; fi
printf '\nexport %s=%s\n' "$VAR" "$FILE" >> "$PROFILE"
echo "OK — $VAR exported from $PROFILE (keys: $(keys | paste -sd, -))."
echo "Now fully quit VS Code (all windows) and relaunch it from a new terminal (or after: source $PROFILE) — a window reload does not pick up the new variable. The skills type only the key names."
