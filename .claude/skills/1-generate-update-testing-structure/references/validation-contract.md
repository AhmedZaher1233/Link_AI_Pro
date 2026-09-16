# Validation contract

`scripts/validate-setup.mjs` produces every row below. A row is **PASS only when its check
executed and succeeded**; a check that did not run is `NOT_RUN`, never PASS. Claude adds
judgment (what to do about a FAIL), never a status the script did not produce — except the
three MCP probe rows, whose results Claude passes in via `--mcp`.

| Row | PASS means | WARN | FAIL |
|---|---|---|---|
| Node.js | `node` ≥ 18 on PATH | older Node | not found |
| NPM | `npm` runs and `package.json` parses | no `package.json` / does not parse | npm not found |
| Playwright | `npx playwright --version` works and `@playwright/test` declared | one of the two | neither |
| Playwright cfg | `playwright.config.*` present, `testDir` folder exists | `testDir` points at a missing folder | no config |
| Folder layout | all canonical `Testing/` folders present | root or legacy names present, some folders missing | no `Testing/` root |
| Steering Docs | L1 + L2 present, canonical, README present, no duplicates | L3 missing / README missing / non-canonical names / duplicate layers | dir missing or L1/L2 missing |
| L1/L2 generic | no product-specific tokens detected (heuristic) | possible product content — review per steering-governance.md §3.5 | — (`NOT_RUN` when L1/L2 missing) |
| Learning File | file present with Index, 6 shared sections, 7 model sections | sections missing or legacy heading present | file missing |
| .mcp.json | parses; `playwright`, `azure-devops`, `docx` present; `docx` args carry `--with "mcp<2"`; no inline secret | a required server missing, or a legacy `word` (office-word-mcp-server) entry still present | missing / invalid JSON / inline secret / `docx` present but the `mcp<2` pin missing (fix hint: add `"--with", "mcp<2"` before the final `docx-mcp-server` arg) |
| PAT env var | `AZURE_DEVOPS_PAT_B64` exists as a user-level variable (registry hive / shell profile) — existence only, value never read | not set and no azure-devops entry yet | azure-devops entry present but variable not set → user runs `scripts/set-azure-devops-pat.ps1` (masked prompt), reopens the session |
| Playwright MCP · Azure DevOps MCP · Docx MCP | Claude probed the attached server and it responded | configured, reload pending | probe failed | (`NOT_RUN` when not probed) |
| QA Skills | 7/7 skill folders with valid front-matter | folder is `.claude/Skills` (uppercase) | any missing or invalid |
| Skills current | `sync --check` report: all CURRENT | some BEHIND / missing | — (`NOT_RUN` without a report) |
| sync-skills cmd | `.claude/commands/sync-skills.md` present | — | missing |
| Manifest | `Testing/qa-manifest.json` parses | missing (Mode A on a pre-manifest project) | invalid JSON |

`overall`: FAIL if any row FAIL; PARTIAL if any WARN or NOT_RUN; else PASS.

## Reporting rules
* Print the table exactly as the script returns it (item, status, reason) — do not reorder or
  soften statuses.
* Mode A adds two lists after the table: **Would be fixed by B** (every FAIL/WARN Mode B can
  repair: missing skills, folders, steering layer, MCP entry, learning sections, manifest,
  folder case, names) and **Needs C** (layout deviations that require moves).
* Never say "setup completed" unless `overall` is PASS (or PARTIAL with only `reload pending`
  and `NOT_RUN` probe rows, stated explicitly).
* `USER ACTION REQUIRED` may contain only: set the PAT environment variable, run an interactive
  `az login`, reconnect an MCP server, reload the session, fill L3 placeholders / supply a
  missing L1-L2 document, restart the PC when the environment demands it.
