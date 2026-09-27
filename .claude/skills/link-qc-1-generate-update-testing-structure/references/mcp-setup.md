# MCP setup and diagnostics — `.mcp.json`

Load only when the preflight reports `.mcp.json` missing/invalid/incomplete, or an MCP probe
fails. A healthy project never needs this file.

## 1. Writing `.mcp.json` (Mode B/C, new project)

`.mcp.json` lives at the project root. **Writing it is this skill's job** — never tell the user
to configure MCPs by hand and never stop at "not configured". Only secrets and interactive
logins belong to the user.

1. Exists → read it and **merge**: add only the missing server entries; never remove or rewrite
   existing ones.
2. Missing → create it from `assets/mcp.template.json` (`mcpServers` block only; drop the
   `_self_hosted_azure_devops_server`, `_optional_azure_resources_server` and
   `_optional_figma_server_for_qc_ui` keys — they are alternatives you copy from, never
   written as-is).
3. `npx`-based servers need no pre-installation (`npx -y` fetches on first launch). Never run
   `npm install -g` for them.
4. **Azure DevOps hosting decides which `azure-devops` entry you write** (§1b). Read
   `preflight.azureDevOps.hosting` (from the git remote: `dev.azure.com` / `*.visualstudio.com`
   → `cloud`; any other host with an ADO-shaped path, e.g. `https://devops.example.com/DefaultCollection/…`
   → `self-hosted`). Not detectable (no ADO remote) → check the learning file (`[type: env]`
   hosting line), else ask the user for a User Story URL and run the same rule on it. Never
   guess from the org name alone.
   - cloud → the `mcpServers.azure-devops` block; replace `{ORG_NAME}` with the organization.
   - self-hosted → the `_self_hosted_azure_devops_server.azure-devops` block, written under the
     same key `azure-devops`; replace `{ORG_URL}` with `https://host[:port]/[tfs/]{collection}`
     (`preflight.git.azureDevOps.orgUrl` / the story URL) and `{PROJECT_NAME}` with the project.
5. Validate the JSON, then smoke-test launchers (`npx @playwright/mcp --version`, and for the
   Docx MCP the pre-warm command in §1a step d). Replace `{UVX_PATH}` with the absolute `uvx`
   path (§1a step c).

## 1b. Azure DevOps — cloud vs self-hosted (one key, two servers)

| | Cloud (`dev.azure.com`, `*.visualstudio.com`) | Self-hosted Azure DevOps Server (any other host) |
|---|---|---|
| Package | `@azure-devops/mcp` (Microsoft) | `@tiberriver256/mcp-server-azure-devops` |
| Entry | `"args": ["-y", "@azure-devops/mcp", "{ORG_NAME}", "--authentication", "pat"]`, `"env": { "PERSONAL_ACCESS_TOKEN": "${AZURE_DEVOPS_PAT_B64}" }` | `"args": ["-y", "@tiberriver256/mcp-server-azure-devops"]`, `"env": { "AZURE_DEVOPS_ORG_URL": "{ORG_URL}", "AZURE_DEVOPS_AUTH_METHOD": "pat", "AZURE_DEVOPS_PAT": "${AZURE_DEVOPS_PAT}", "AZURE_DEVOPS_DEFAULT_PROJECT": "{PROJECT_NAME}" }` |
| PAT variable | `AZURE_DEVOPS_PAT_B64` = base64(`":" + PAT`) | `AZURE_DEVOPS_PAT` = the raw PAT (on-prem supports PAT auth only) |
| Org value | organization name | `https://host[:port]/[tfs/]{collection}` — the collection is part of the URL |
| Tools | `wit_*`, `search_workitem`, `testplan_*`, `core_list_projects` | `get_work_item`, `create_work_item`, `update_work_item`, `list_work_items`, `search_work_items`, `manage_work_item_link`, `list_projects`, … — **no test plan / suite tools** |
| Probe | `core_list_projects` | `list_projects` |

Both servers live under the key `azure-devops`, so every skill's `mcp__azure-devops` permission
covers either. The user-run PAT script stores **both** variables from one prompt (§2a), so an
entry never has to change when the hosting is corrected — only the package, args and env do.
`validate-setup.mjs` reports the detected hosting (`Azure DevOps hosting` row), checks the PAT
variable the entry actually references (`PAT env var` row) and FAILs `.mcp.json` when a literal
token sits in `PERSONAL_ACCESS_TOKEN` or `AZURE_DEVOPS_PAT`. Never write a project's real host,
collection or project into a template, a skill or the learning file's shared sections — only into
the consumer project's `.mcp.json` and its `[type: env]` line.

## 1a. Docx MCP — prerequisites (verify each with a command, in this order)

The `docx` server is `docx-mcp-server` (SecurityRonin, PyPI `docx-mcp-server`, tools
`mcp__docx__*`). It replaces the legacy read-only `word` server (`office-word-mcp-server`).
**Detection:** a server counts as present only if its `args` contain `docx-mcp-server`. An entry
whose args contain `office-word-mcp-server` / `word_mcp_server` is the superseded legacy server:
`sync-qa-skills.mjs --apply` removes it automatically; if one is still there, tell the user it is
superseded and OFFER to remove it — ask, never delete silently (`link-qc-3-generate-manual-test-cases`
may still reference it in an older copy).

| Step | Check | If it fails |
|---|---|---|
| a | `uvx --version` | install uv — Windows: `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 \| iex"`, or `pip install uv` (docs: https://docs.astral.sh/uv/) — then re-run the check |
| b | `uv python find ">=3.10"` | `uv python install 3.12`, then re-run the check |
| c | absolute launcher path: `where.exe uvx` (PowerShell: `(Get-Command uvx).Source`) | write that path into the entry's `command` — never rely on PATH inside MCP launches |
| d | pre-warm + tool listing (below) — PASS when `tools/list` returns > 0 tools; minimum acceptable: the package downloads without error | read the error; `ModuleNotFoundError: No module named 'mcp.server.fastmcp'` means the `--with "mcp<2"` pin is missing |

Pre-warm command (step d), stdin carries one JSON-RPC `initialize`, the `initialized` notification and `tools/list`:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"qa-setup","version":"1.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | uvx --from docx-mcp-server --with "mcp<2" docx-mcp-server
```

Entry to write (the `docx` block of `assets/mcp.template.json`, `{UVX_PATH}` resolved):

```json
"docx": {
  "command": "C:/Users/<user>/.local/bin/uvx.exe",
  "args": ["--from", "docx-mcp-server", "--with", "mcp<2", "docx-mcp-server"]
}
```

Why the pin: `docx-mcp-server` declares an unpinned `mcp` dependency, uv resolves `mcp` 2.x, and
the server crashes on import — `--with "mcp<2"` is mandatory.

What it is for: QA/UAT document generation, and — for `link-qc-2-review-requirements` — writing review
findings into the RSD/spec `.docx` as real Word comments and reading the replies reviewers leave
on them. Never generate documents during setup.

## 2. Servers

| Server | Auth | Notes |
|---|---|---|
| `playwright` | none | configure fully and unconditionally — required by `link-qc-3b-validate-manual-test-cases` (BLOCKED without it) and `link-qc-5-test-run-automation`, used by skill 4 as a gap-filler only; skill 3 never uses it; `link-qc-3c-validate-manual-test-cases-cli` uses `playwright-cli` instead (`toolchain.md`) and never this server |
| `azure-devops` (cloud) | PAT via `${AZURE_DEVOPS_PAT_B64}` | `@azure-devops/mcp`; value = base64 of `":" + PAT`; scopes Work Items Read/Write/Manage + Test Management Read/Write. It is a PAT — not an Azure Storage SAS token; no `az login`. Write the entry even when the variable is not set yet and report "run the PAT script, then fully quit VS Code and relaunch" as the only user action (§2a) |
| `azure-devops` (self-hosted) | PAT via `${AZURE_DEVOPS_PAT}` (raw) | `@tiberriver256/mcp-server-azure-devops` with `AZURE_DEVOPS_ORG_URL` (`https://host/Collection`), `AZURE_DEVOPS_AUTH_METHOD=pat`, `AZURE_DEVOPS_DEFAULT_PROJECT`; same scopes; no test plan / suite tools (§1b). Same user action as the cloud row — the script stores both variables |
| `docx` | none | `{UVX_PATH} --from docx-mcp-server --with "mcp<2" docx-mcp-server` (§1a); used later by skills 2/3 for documents and review comments — never generate documents during setup. A legacy `word` (`office-word-mcp-server`) entry is superseded — removed by the skills sync, or offered for removal |
| `azure` (optional) | `az login` when a call fails | Azure resources only, not DevOps |
| `figma` (optional) | Figma login through `/mcp` (OAuth) | `link-qc-6-ui-testing` only — exact design tokens, layer inventory and frame screenshots from Figma links (§2c). Remote server, `"type": "http"`, `"url": "https://mcp.figma.com/mcp"`; no command, no token, nothing installed. Add it only when the project compares against Figma designs; link-qc-6-ui-testing falls back to exported screenshots without it |

Secret rules: never hardcode the PAT in `.mcp.json`, `.env`, a skill or a doc; never commit,
print, log or ask the user to paste it in chat. `validate-setup.mjs` flags inline secrets as
FAIL.

## 2a. Creating the PAT environment variable on the user's PC (Mode B/C, new project)

The `azure-devops` entry reads `${AZURE_DEVOPS_PAT_B64}` (cloud) or `${AZURE_DEVOPS_PAT}`
(self-hosted) from a **user-level environment variable on the machine**. Whenever you write or
merge that entry and the preflight/validator reports `PAT env var` as not set
(`pat.persisted = false`), **ask the user to create it now** — do not leave it as a vague "set
the variable" note:

1. Tell the user, in one message, exactly what to run **in their own terminal** (the masked
   prompt cannot run through Claude's shell):

   ```text
   The azure-devops MCP entry needs the PAT stored as a user environment variable on this PC.
   Please run this in a PowerShell window and paste the token when prompted (input is hidden):

     powershell -ExecutionPolicy Bypass -File .claude/skills/link-qc-1-generate-update-testing-structure/scripts/set-azure-devops-pat.ps1

   (macOS/Linux: bash .claude/skills/link-qc-1-generate-update-testing-structure/scripts/set-azure-devops-pat.sh)

   One prompt stores the token twice for your Windows user — AZURE_DEVOPS_PAT_B64 (base64, cloud
   server) and AZURE_DEVOPS_PAT (raw, self-hosted server) — verifies both, and prints nothing
   secret. Required PAT scopes: Work Items Read/Write/Manage + Test Management Read/Write.
   Then FULLY QUIT VS Code (close every window) and relaunch it: a window reload or an /mcp
   reconnect keeps the old process environment, so the server would still start without the
   token. Reply "done" once VS Code is back.
   ```

   Never ask for the token in chat, never accept it if pasted (tell the user to run the script
   instead), never write it to any file yourself.
2. WAIT for the user. Then re-run `validate-setup.mjs`: the `PAT env var` row reads the
   variable's **existence** from the user registry hive (`HKCU\Environment`) or the shell
   profile — never its value — for the variable the entry references. `persisted: true` with
   `inProcess: false` (`sessionMissing: true`, row WARN "saved on this machine but missing from
   this session") means VS Code was not fully restarted yet: repeat the full-quit instruction,
   nothing else.
3. Only after that restart can the Azure DevOps probe succeed; until then report
   `Azure DevOps MCP: restart pending`, not FAIL.

The script is idempotent (asks before replacing existing values) and supports `-Remove`
(`--remove` on macOS/Linux). Mode A never asks for this — it only reports `PAT env var:
FAIL/WARN` with the command to run.

## 2b. Browser secrets file — optional, skill 3c only (never the PAT script's job)

`link-qc-3c-validate-manual-test-cases-cli` drives the browser through command lines that land in the
chat transcript, so it never types a password: the user either logs in themselves in the browser
window the skill opens (attended login — works without any setup), or stores the credentials
ONCE in a secrets file the tool reads by NAME. When the validator reports `Browser secrets file`
as not set and the project intends to run 3c unattended, tell the user once (no wait):

```text
Optional, for skill 3c only: to let the CLI validator log in without you, run this in your own
PowerShell window (macOS/Linux: bash …/set-playwright-secrets.sh). It asks for each role's
username and password (hidden), writes them to a file outside the repository that only your
account can read, and points PLAYWRIGHT_MCP_SECRETS_FILE at it. The skills type only the key
names (e.g. ADMIN_PASSWORD); the tool substitutes the values and masks them.

  powershell -ExecutionPolicy Bypass -File .claude/skills/link-qc-1-generate-update-testing-structure/scripts/set-playwright-secrets.ps1

Skip it if you prefer to log in yourself when 3c opens the browser. Afterwards fully quit
VS Code (all windows) and relaunch it — a window reload does not pick up the new variable.
```

Never ask for a password in chat, never accept one if pasted, never write the file yourself, and
never read it — `validate-setup.mjs` checks existence only. The same file is read by the
Playwright MCP backend when `PLAYWRIGHT_MCP_SECRETS_FILE` is set, which changes nothing for 3b.

## 2c. Figma MCP — optional, link-qc-6-ui-testing only

`link-qc-6-ui-testing` compares an implemented screen against its approved design. With the Figma MCP it reads
the design's exact values (hex colours, spacing, typography, the full layer list) instead of
estimating them from a screenshot; without it, a Figma link falls back to an exported image of
the frame. Add the entry only when the user says the project audits against Figma designs (ask
once, record the answer as a `[type: qa]` line):

```json
"figma": {
  "type": "http",
  "url": "https://mcp.figma.com/mcp"
}
```

(the `_optional_figma_server_for_qc_ui` block of `assets/mcp.template.json`). It is Figma's
hosted Dev Mode server: no package, no launcher, no token in any file. After the session reload
the user authenticates once through `/mcp` → figma → authenticate (their Figma account; the
project's design files must be readable by it). A project that runs the Figma desktop app can
use its local server instead — `"url": "http://127.0.0.1:3845/mcp"` — with the same tools.

Never ask for or store a Figma personal access token; the OAuth login is the only supported
path. Report the row as `Figma MCP: configured, reload pending` until the login happened; it is
WARN, never FAIL, when absent.

## 3. Probing (Claude-side, results passed to `validate-setup.mjs --mcp ...`)

* Newly configured servers attach **only after the Claude Code session is reloaded** (and may
  need approval via `/mcp`). "Configured, reload pending" is the correct, complete outcome —
  report it as WARN `reload pending`, not as a failure and not as PASS. A server whose entry
  references a **newly created environment variable** needs more than a reload: the editor
  process must be fully quit and relaunched (`restart pending`).
* Attached server → one cheap read each: Playwright MCP (e.g. browser status), Azure DevOps
  (cloud: `core_list_projects`; self-hosted: `list_projects`), Docx (e.g. `get_document_outline` on a scratch `.docx`, or any cheap
  read that returns without error), Figma when configured (`whoami` / any cheap read; a 401 means
  the `/mcp` login has not happened yet → WARN `login pending`). Pass
  `--mcp playwright=PASS,azure-devops=FAIL,docx=PASS[,figma=PASS]` to the validator; unprobed
  servers stay `NOT_RUN` — never PASS.

## 4. Diagnostics

| Symptom | Meaning | Action |
|---|---|---|
| Azure DevOps 401, "anonymous access" / `TF400813` | the PAT variable is **empty in the MCP server's process** — VS Code was not fully restarted after the variable was created (`PAT env var` row: `sessionMissing`) | tell the user to fully quit VS Code (all windows) and relaunch; a reload or `/mcp` reconnect does not help. You cannot connect or disconnect MCP servers yourself — ask, wait, retry once |
| Azure DevOps 401 after a full restart | token expired, revoked, or the variable holds an old value | the user re-runs `set-azure-devops-pat.ps1` / `.sh` (replaces both variables), then fully quits and relaunches VS Code again |
| Azure DevOps 403 | token valid, scope missing | name the missing scope |
| Azure DevOps 404 | cloud: wrong organization / project; self-hosted: `AZURE_DEVOPS_ORG_URL` without the collection, or wrong `AZURE_DEVOPS_DEFAULT_PROJECT` | fix the entry in `.mcp.json` (§1b), reload the session |
| `Azure DevOps hosting` row WARN (package ≠ remote) | cloud package configured for a self-hosted host or the reverse | rewrite the entry from the other template block (§1b); the PAT script needs no re-run — both variables exist |
| launcher fails | `npx` / `uvx` not resolvable | check Node / `uv` installation; for `docx` make sure `command` is the absolute `uvx` path (§1a step c) |
| docx server exits with `ModuleNotFoundError: No module named 'mcp.server.fastmcp'` | `mcp` 2.x was resolved — the `--with "mcp<2"` pin is missing | add `"--with", "mcp<2"` before the final `docx-mcp-server` arg (validate-setup.mjs reports this as FAIL) |
| still failing after fixes at environment level | machine-level issue | tell the user: setup is complete but a PC restart is required, then re-run validation |

Do not retry indefinitely. Never claim an MCP works if it was not actually verified.

## QC sync family capabilities
All link-qc-7…link-qc-9 use mcp__azure-devops only, never token reads or REST. Skill 4 --suite-only requires suite listing/add tools; link-qc-7 requires point listing, run creation, result listing/update and run completion; link-qc-8 and link-qc-9 need work-item tools only. These testplan_* capabilities require the cloud @azure-devops/mcp server; probe actual attached schemas. Missing capability → NOT_RUN (server has no required test-plan tools), no fallback. link-qc-8–6 require work-item reads/writes, fields/states, revisions and evidence attachment tools; link-qc-9 also uses Playwright MCP. Interactive cloud capability probe and live writes/browser runs in this authoring repository: NOT_RUN; perform in a consumer project after sync.
