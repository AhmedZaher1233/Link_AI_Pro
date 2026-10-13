<!-- MIRROR: byte-identical in every Azure skill. Canonical: link-qc-1-generate-update-testing-structure. Edit all together. -->
# Azure DevOps MCP — connection and authentication failures

One shared guide for every skill that calls `mcp__azure-devops`. When an Azure DevOps MCP
call fails with `CONNECT_TIMEOUT`, "server not connected", `TF400813`, 401 or 403: **stop the
Azure calls**, run the diagnostic below, pick the ONE row that matches, and give the user that
row's fix as the **first line of the reply**. The skill keeps its own outcome wording
(`NOT_RUN`, `BLOCKED`, drop to `local` mode, …) — this guide only decides what the user does
next.

## 0. First diagnostic step — the check script

Ask the user to run, in their own terminal (its output is safe to paste into the chat — it
holds booleans only, never the token, its length or any part of it):

```text
powershell -ExecutionPolicy Bypass -File "<repo>\.claude\skills\link-qc-1-generate-update-testing-structure\scripts\check-azure-devops-pat.ps1"
```

macOS / Linux:

```text
bash "<repo>/.claude/skills/link-qc-1-generate-update-testing-structure/scripts/check-azure-devops-pat.sh"
```

It prints five booleans — `User-scope set`, `Current process set`, `Both values equal`,
`Valid base64`, `Decodes with a leading ':'` — and ends with the one-line fix for the **first**
failing check. Every line `True` → the variable is fine; the cause is in row 1, 5 or 6 of the
table. The skill never runs this script itself from the chat shell: the window the user opens
is the one whose environment answers for VS Code (both inherit the same User-scope variables),
provided the user opened that window after the variable was set.

## 1. Symptom → cause → fix

| # | Symptom | Cause | Fix (the first line of the reply) |
|---|---|---|---|
| 1 | `CONNECT_TIMEOUT` / "server not connected" / the `azure-devops` tools are absent | `npx` could not start the server (first download, blocked network, slow proxy) | `/mcp` → reconnect `azure-devops`. Still failing → check VPN / proxy, then fully quit VS Code (all windows) and relaunch |
| 2 | `TF400813: The user 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' is not authorized` (Azure's anonymous identity) **and the variable is NOT set at all** (check script: `User-scope set: False`) | the PAT was never set up on this PC | follow §4 "Set or replace the PAT" (the replace question is skipped) |
| 3 | `TF400813` … anonymous **and the variable is set for the user but NOT in the VS Code process** (`User-scope set: True`, `Current process set: False` in a window opened after the variable was set; `validate-setup.mjs` row `PAT env var`: "saved on this machine but missing from this session") | VS Code was not fully restarted after the variable was created | fully quit VS Code — close every window, check Task Manager shows no `Code.exe` — then relaunch it (§4 step 6). **Reload Window and `/mcp` reconnect do not reload environment variables** |
| 4 | `TF400813` … anonymous **and the variable is set but does not decode to a string starting with `:`** (`Valid base64: False` or `Decodes with a leading ':': False`) | the raw PAT was stored instead of `base64(":" + PAT)` (set by hand, not by the script) | follow §4 "Set or replace the PAT" and answer `y` to "Replace both? (y/N)" |
| 5 | `TF400813` … anonymous **and the variable is set and well-formed** (every check line `True`) | the PAT expired or was revoked in Azure DevOps | create a new PAT in Azure DevOps (User settings → Personal access tokens; scopes **Work Items Read & Write** and **Test Management Read & Write**), then follow §4 "Set or replace the PAT" (answer `y`) |
| 6 | 401 on some endpoints while others return 200, or **403** | a PAT scope is missing (the token is valid) | add the missing scope to the PAT in Azure DevOps (edit the existing token, or create a new one and go through §4). **Never retry with another credential** |
| 7 | `azure-devops-attachments` `CONNECT_TIMEOUT` / "server not connected" / its two attachment tools are absent (cloud projects only — the optional second server skills 8 / 9 use to upload evidence; `mcp-setup.md` §2d) | its launcher `.claude/mcp-launchers/azure-devops-attachments.cjs` could not start the pinned `@tiberriver256/mcp-server-azure-devops`: no PAT variable in the VS Code process, a cold `npx` cache, or the launcher file missing | three steps, in order: (1) `AZURE_DEVOPS_PAT_B64` or `AZURE_DEVOPS_PAT` must be set for the user (§0 check script) — a FULL quit and relaunch of VS Code is needed after setting it; (2) warm the cache in the user's own terminal: `npm exec --yes --package=@tiberriver256/mcp-server-azure-devops@0.1.49 -- node -e 0`; (3) run `node .claude/mcp-launchers/azure-devops-attachments.cjs` once by hand from the project root and read its stderr (a missing file → re-run skill 1 Mode B, which copies it). The skill's outcome: the attachment stays pending with the manual instruction; the `azure-devops` entry is unaffected |

Rows 2-5 are told apart by the check script only; never guess between them from the error
text — Azure returns the same `TF400813` for all four. Row 7 concerns the optional second server
only; the `azure-devops` entry keeps working without it.

## 2. Why the "anonymous user" error happens

`@azure-devops/mcp` (2.10.0) reads `PERSONAL_ACCESS_TOKEN`, **base64-decodes it and keeps only
the text after the first `:`** (HTTP Basic form, empty username). When the decoded value holds
no colon — a raw PAT, or a variable the process never received — it sends an **empty token**,
and Azure DevOps answers as the anonymous user `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`:
`TF400813 … is not authorized to access this resource`. That is why a missing restart, a raw
PAT and an expired PAT all show the same error, and why the check script's "decodes with a
leading `:`" line exists.

## 3. Where the token comes from

- `.mcp.json` → entry `azure-devops` → `"env": { "PERSONAL_ACCESS_TOKEN": "${AZURE_DEVOPS_PAT_B64}" }`
  (cloud server `@azure-devops/mcp`). `AZURE_DEVOPS_PAT_B64` is a **Windows User-scope
  environment variable** (`HKCU\Environment`; a shell-profile `export` on macOS / Linux) holding
  `base64(":" + PAT)`.
- The same script also writes `AZURE_DEVOPS_PAT` (the raw PAT) for the **self-hosted** server
  (`@tiberriver256/mcp-server-azure-devops`, `"AZURE_DEVOPS_PAT": "${AZURE_DEVOPS_PAT}"`), so
  switching servers never needs a second run.
- The optional `azure-devops-attachments` entry (cloud projects; `mcp-setup.md` §2d) carries no PAT
  key at all: its launcher reads `AZURE_DEVOPS_PAT` from the environment, or derives it in memory
  from `AZURE_DEVOPS_PAT_B64`. One token, one script, never a third variable.
- The MCP server process inherits the variable from VS Code, and VS Code reads User-scope
  variables **once, at launch**. That is the whole reason for the "fully quit and relaunch" rule.

**Hard rules (every skill):**
- Never ask for the PAT in chat; if the user pastes one, say "run the script instead" and do
  not use it.
- Never print, log, echo or store the token — not its value, not its length, not a prefix.
- Never fall back to REST, `curl`, `Invoke-WebRequest` or a PAT read from the environment to
  work around a failing MCP call. (Skill 4's documented suite-placement REST step is a
  separate, planned feature that reads the variable by name only — it is never an auth-failure
  fallback, and an auth failure there follows this guide too.)
- Never hardcode the token in `.mcp.json`, `settings.json`, `settings.local.json` or any other
  file — those files are tracked in git. `validate-setup.mjs` reports an inline token as FAIL.

## 4. "Set or replace the PAT" — the exact user steps

Confirmed working on 2026-10-09. **The skill gives these seven steps to the user and never runs
the script itself** — it needs a hidden interactive prompt that the chat shell cannot provide.
Fill `<repo>` with this project's absolute path before showing them.

1. Open a **separate PowerShell window** (Start → type `PowerShell` → Enter). Do not use the
   Claude chat.
2. Run (with the repo path filled in):
   ```text
   powershell -ExecutionPolicy Bypass -File "<repo>\.claude\skills\link-qc-1-generate-update-testing-structure\scripts\set-azure-devops-pat.ps1"
   ```
   On macOS / Linux, run the `.sh` twin instead:
   ```text
   bash "<repo>/.claude/skills/link-qc-1-generate-update-testing-structure/scripts/set-azure-devops-pat.sh"
   ```
3. If it asks `AZURE_DEVOPS_PAT_B64 and AZURE_DEVOPS_PAT already exist(s) for this user. Replace both? (y/N)`,
   type `y` and press Enter. If the variables do not exist yet, this question is skipped — go
   to step 4.
4. At `Paste your Azure DevOps PAT (input is hidden)`, paste the PAT (Ctrl+V or right-click)
   and press Enter. **Nothing appears while pasting — that is expected.**
5. Confirm two green lines: `OK - AZURE_DEVOPS_PAT_B64 is set for this Windows user (length N)`
   and the same for `AZURE_DEVOPS_PAT`. (macOS / Linux: one line,
   `OK — AZURE_DEVOPS_PAT_B64 AZURE_DEVOPS_PAT added to <profile>`.)
6. **Fully quit VS Code** — close every window, then check Task Manager shows no `Code.exe` —
   and relaunch it. (macOS / Linux: quit the editor and start it from a NEW terminal, or after
   `source <profile>`.)
7. Re-run the skill, or run `check-azure-devops-pat.ps1` (§0) first: every line should read
   `True`.

A PAT needs the scopes **Work Items (Read, Write & Manage)** and **Test Management (Read &
Write)**; anything less ends in row 6.
