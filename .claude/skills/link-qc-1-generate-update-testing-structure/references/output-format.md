# Final report format

Keep it short: the validation table is the centre; everything else is a list of changes and
the actions left for the user.

```text
## QA Foundation — {NEW PROJECT: full setup | EXISTING PROJECT: Mode A audit | Mode B repair | Mode C restructure}

**Project:** {name} · **Root:** {path} · **Preflight:** {classification} — {one-line evidence}
**Skills suite:** {n}/9 present · {current | m behind | k missing} · folder {.claude/skills | .claude/Skills → migrated}

### Changes made            ← Mode A: "None — audit is read-only"
Created:   {folders / files actually created, one per line}
Renamed:   {old → new, one per line}          ← steering names, skills folder case, legacy heading, legacy skill folder (SKILL_RENAMES)
Installed: {Playwright, browsers, uv, playwright-cli + its browser (only when the user said yes) …}
Updated:   {.mcp.json entries added (azure-devops: cloud | self-hosted, org / org URL), learning-file sections added, .gitignore line for .playwright-cli/, manifest written}
Moved (Mode C): {old → new, one per line} · playwright test --list: {n tests discovered}

### Validation
| Item | Status | Reason |
|---|---|---|
{rows from validate-setup.mjs, in order}
Overall: {PASS | PARTIAL | FAIL}

### Would be fixed by B / Needs C        ← Mode A only
- {row} → {what B would do} · {row} → needs C (move plan)

### USER ACTION REQUIRED                 ← omit when empty
1. Run scripts/set-azure-devops-pat.ps1 (or .sh) in your own terminal (masked prompt creates the
   user-level AZURE_DEVOPS_PAT_B64 and AZURE_DEVOPS_PAT variables), then FULLY QUIT VS Code (all
   windows) and relaunch it — a window reload or /mcp reconnect does not pick up a new variable
   ← also when the PAT row says "saved on this machine but missing from this session"
2. Reload the Claude Code session (skills / MCP server entries changed) and approve the new `docx` server via /mcp
3. Fill L3 placeholders: {keys}
4. {supply missing L1/L2 document | az login | restart PC}
5. Optional (skill 3c only): run scripts/set-playwright-secrets.ps1 in your own window if you want
   unattended browser logins; attended login works without it

**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge" | "not touched (audit)"}
**Manifest:** Testing/qa-manifest.json {written | refreshed | not written (audit)}
```

Rules: list only what actually happened; never claim PASS the script did not report; never
print a token or credential; expand the first use of any acronym the QC may not know.
