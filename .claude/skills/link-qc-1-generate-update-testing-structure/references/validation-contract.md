# Validation contract

`scripts/validate-setup.mjs` produces every row below. A row is **PASS only when its check
executed and succeeded**; a check that did not run is `NOT_RUN`, never PASS. Claude adds
judgment (what to do about a FAIL), never a status the script did not produce — except the
four MCP probe rows, whose results Claude passes in via `--mcp` (`figma=` only when the entry
exists).

| Row | PASS means | WARN | FAIL |
|---|---|---|---|
| Node.js | `node` ≥ 18 on PATH | older Node | not found |
| NPM | `npm` runs and `package.json` parses | no `package.json` / does not parse | npm not found |
| Playwright | `npx playwright --version` works and `@playwright/test` declared | one of the two | neither |
| Playwright cfg | `playwright.config.*` present, `testDir` folder exists | `testDir` points at a missing folder | no config |
| Playwright CLI | `playwright-cli --version` (global) or `npx --no-install playwright-cli --version` (local) works — used by 3c only | not installed (`/sync-skills --tools` installs it; 3b needs nothing) | — (never FAIL: 3c is optional) |
| Playwright CLI browser | a chromium build is present in the Playwright browsers cache (cache check; 3c's first `open` is the real one) | none found (`/sync-skills --tools` runs `install-browser`) | — (`NOT_RUN` when the CLI is absent) |
| Python + Pillow | a Python 3 interpreter (`py -3` / `python` / `python3`) runs and imports `PIL` + `numpy` — used by link-qc-6-ui-testing only, to annotate static design images | interpreter present but a package missing (`/sync-skills --tools` installs them), or no interpreter (optional — link-qc-6-ui-testing annotates live pages in the DOM without it; Python is never installed by this suite) | — (never FAIL) |
| .gitignore | `.playwright-cli/` is ignored | line missing, or no `.gitignore` (`/sync-skills --tools` adds it) | — (`NOT_RUN` outside a git repository) |
| Folder layout | all canonical `Testing/` folders present (including `UI-Testing/` for link-qc-6-ui-testing) | root or legacy names present, some folders missing | no `Testing/` root |
| Steering Docs | L1 + L2 present, canonical, README present, no duplicates | L3 missing / README missing / non-canonical names / duplicate layers | dir missing or L1/L2 missing |
| L1/L2 generic | no product-specific tokens detected (heuristic) | possible product content — review per steering-governance.md §3.5 | — (`NOT_RUN` when L1/L2 missing) |
| Learning File | file present with Index, 6 shared sections, 11 model sections (skills 1-11, 3b and 3c) | sections missing or legacy heading present | file missing |
| .mcp.json | parses; `playwright`, `azure-devops`, `docx` present; `docx` args carry `--with "mcp<2"`; no inline secret; the reason names the Azure DevOps package (`cloud (@azure-devops/mcp)` / `self-hosted (@tiberriver256/…, org URL)`) | a required server missing, a legacy `word` (office-word-mcp-server) entry still present, a self-hosted entry without `AZURE_DEVOPS_ORG_URL` / `AZURE_DEVOPS_AUTH_METHOD=pat`, or an unknown Azure DevOps package | missing / invalid JSON / inline secret (a literal token in `PERSONAL_ACCESS_TOKEN` or `AZURE_DEVOPS_PAT` — the hint names the `${…}` reference the entry must use) / `docx` present but the `mcp<2` pin missing (fix hint: add `"--with", "mcp<2"` before the final `docx-mcp-server` arg) |
| Azure DevOps hosting | `cloud` or `self-hosted` with its evidence: the `.mcp.json` entry (package / org URL), confirmed by the git remote when it is an ADO URL | git remote hosting ≠ entry hosting (wrong package for the host), or an entry whose hosting cannot be told | — (`NOT_RUN` when there is no entry and the git remote is not an Azure DevOps URL → ask the user for a User Story URL) |
| PAT env var | the variable the `azure-devops` entry references (`AZURE_DEVOPS_PAT_B64` cloud / `AZURE_DEVOPS_PAT` self-hosted; both names checked when there is no entry) exists as a user-level variable (registry hive / shell profile) **and** is visible to this process — existence only, value never read | saved on this machine but missing from this session → the user must fully quit VS Code (all windows) and relaunch; or not set and no azure-devops entry yet | azure-devops entry present but variable not set → user runs `scripts/set-azure-devops-pat.ps1` / `.sh` (masked prompt; stores both variables), then fully quits and relaunches VS Code |
| Browser secrets file | `PLAYWRIGHT_MCP_SECRETS_FILE` exists as a user-level variable and the file it names exists — existence only, never read (3c logs in by secret name) | not set (optional — attended login works without it; user runs `scripts/set-playwright-secrets.ps1`), or set but the file is missing | — (never FAIL) |
| Playwright MCP · Azure DevOps MCP · Docx MCP | Claude probed the attached server and it responded (Azure DevOps: `core_list_projects` cloud / `list_projects` self-hosted) | configured, reload pending — or, for Azure DevOps with `PAT env var` WARN, restart pending | probe failed (an Azure DevOps 401 while the PAT row says "missing from this session" is the missing full restart, not a bad token) | (`NOT_RUN` when not probed) |
| Figma MCP | `figma` entry configured and Claude probed it (it needs a Figma login through `/mcp`) | not configured (optional — link-qc-6-ui-testing only; Figma links fall back to exported screenshots, `mcp-setup.md` §2c), or configured + reload pending | — (never FAIL; `NOT_RUN` when configured but not probed) |
| QA Skills | 14/14 skill folders (1-12, 3b and 3c) with valid front-matter | folder is `.claude/Skills` (uppercase) | any missing or invalid |
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
* Never say "setup completed" unless `overall` is PASS (or PARTIAL with only `reload pending` /
  `restart pending` and `NOT_RUN` probe rows, stated explicitly).
* `USER ACTION REQUIRED` may contain only: set the PAT environment variable (the script, then a
  full quit + relaunch of VS Code — never "reconnect" or "reload" for a new variable), run an
  interactive `az login`, reload the session (new server entries / skills), approve a server via
  `/mcp`, fill L3 placeholders / supply a
  missing L1-L2 document, restart the PC when the environment demands it, and — optional, for
  skill 3c only — run the browser secrets script; — optional, for link-qc-6-ui-testing only — log in to the
  Figma MCP through `/mcp`, or install Python 3 for static-image annotation.
