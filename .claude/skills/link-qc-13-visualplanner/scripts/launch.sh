#!/usr/bin/env sh
# Opens a generated visualplanner breakdown in the default browser.
# Run it right after the HTML file is written (macOS, Linux, WSL, Git Bash on Windows).
# Usage: sh launch.sh <path-to-breakdown.html>
set -e

if [ -z "$1" ] || [ ! -f "$1" ]; then
  echo "Breakdown not found: $1" >&2
  exit 1
fi

file="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"

case "$(uname -s)" in
  Darwin)
    open "$file" ;;
  MINGW*|MSYS*|CYGWIN*)
    # PowerShell single-quoted string: a ' in the path is written as ''
    win="$(cygpath -w "$file" | sed "s/'/''/g")"
    powershell.exe -NoProfile -Command "Start-Process -FilePath '$win'" ;;
  *)
    if command -v wslview >/dev/null 2>&1; then
      wslview "$file"
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$file" >/dev/null 2>&1 &
    else
      echo "No browser opener found (xdg-open). Open it manually: $file" >&2
      exit 1
    fi ;;
esac

echo "Opened $file"
