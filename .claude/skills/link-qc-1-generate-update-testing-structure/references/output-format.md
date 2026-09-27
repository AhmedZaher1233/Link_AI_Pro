# Final report format

Keep it short: the validation table is the centre; everything else is a list of changes and
the actions left for the user.

```text
## QA Foundation — {NEW PROJECT: full setup | EXISTING PROJECT: Mode A audit | Mode B repair | Mode C restructure}

**Project:** {name} · **Root:** {path} · **Preflight:** {classification} — {one-line evidence}
**Skills suite:** {n}/7 present · {current | m behind | k missing} · folder {.claude/skills | .claude/Skills → migrated}

### Changes made            ← Mode A: "None — audit is read-only"
Created:   {folders / files actually created, one per line}
Renamed:   {old → new, one per line}          ← steering names, skills folder case, legacy heading
Installed: {Playwright, browsers, uv …}
Updated:   {.mcp.json entries added, learning-file sections added, manifest written}
Moved (Mode C): {old → new, one per line} · playwright test --list: {n tests discovered}

### Validation
| Item | Status | Reason |
|---|---|---|
{rows from validate-setup.mjs, in order}
Overall: {PASS | PARTIAL | FAIL}

### Would be fixed by B / Needs C        ← Mode A only
- {row} → {what B would do} · {row} → needs C (move plan)

### USER ACTION REQUIRED                 ← omit when empty
1. Run scripts/set-azure-devops-pat.ps1 in your own PowerShell window (masked prompt creates the
   user-level AZURE_DEVOPS_PAT_B64 variable), reopen the session, reconnect the azure-devops MCP server
2. Reload the Claude Code session (skills / MCP servers changed) and approve the new `docx` server via /mcp
3. Fill L3 placeholders: {keys}
4. {supply missing L1/L2 document | az login | restart PC}

**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge" | "not touched (audit)"}
**Manifest:** Testing/qa-manifest.json {written | refreshed | not written (audit)}
```

Rules: list only what actually happened; never claim PASS the script did not report; never
print a token or credential; expand the first use of any acronym the QC may not know.
