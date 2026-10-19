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
   `_self_hosted_azure_devops_server`, `_optional_azure_devops_attachments_server`,
   `_optional_azure_resources_server` and `_optional_figma_server_for_qc_ui` keys — they are
   alternatives you copy from, never written as-is).
3. `npx`-based servers need no pre-installation (`npx -y` fetches on first launch). Never run
   `npm install -g` for them.
4. **Azure DevOps hosting decides which `azure-devops` entry you write** (§1b). Read
   `preflight.azureDevOps.hosting` (from the git remote: `dev.azure.com` / `*.visualstudio.com`
   → `cloud`; any other host with an ADO-shaped path, e.g. `https://devops.example.com/DefaultCollection/…`
   → `self-hosted`). Not detectable (no ADO remote) → check the learning file (`[type: env]`
   hosting line), else ask the user for a User Story URL and run the same rule on it. Never
   guess from the org name alone.
   - cloud → the `mcpServers.azure-devops` block; replace `{ORG_NAME}` with the organization —
     and, always and without asking, the optional `azure-devops-attachments` entry plus its
     launcher (§2d).
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
| Attachments from disk (skills 8 / 9) | cannot — needs the optional second entry `azure-devops-attachments` + launcher (§2d) | built in (`create_work_item_attachment` / `delete_work_item_attachment`) — nothing to add |

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
| `playwright` | none | configure fully and unconditionally — required by `link-qc-3b-validate-manual-test-cases` (BLOCKED without it) and `link-qc-5-test-run-automation`, used by skill 4 as a gap-filler only; skill 3 never uses it; `link-qc-3c-validate-manual-test-cases-cli`, `link-qc-5b-test-run-manual-cli` and `link-qc-9-retesting` (its non-automated bugs; automated ones re-run skill 5's code) use `playwright-cli` instead (`toolchain.md`) and never this server |
| `azure-devops` (cloud) | PAT via `${AZURE_DEVOPS_PAT_B64}` | `@azure-devops/mcp`; value = base64 of `":" + PAT`; scopes Work Items Read/Write/Manage + Test Management Read/Write. It is a PAT — not an Azure Storage SAS token; no `az login`. Write the entry even when the variable is not set yet and report "run the PAT script, then fully quit VS Code and relaunch" as the only user action (§2a) |
| `azure-devops` (self-hosted) | PAT via `${AZURE_DEVOPS_PAT}` (raw) | `@tiberriver256/mcp-server-azure-devops` with `AZURE_DEVOPS_ORG_URL` (`https://host/Collection`), `AZURE_DEVOPS_AUTH_METHOD=pat`, `AZURE_DEVOPS_DEFAULT_PROJECT`; same scopes; no test plan / suite tools (§1b). Same user action as the cloud row — the script stores both variables |
| `docx` | none | `{UVX_PATH} --from docx-mcp-server --with "mcp<2" docx-mcp-server` (§1a); used later by skills 2/3 for documents and review comments — never generate documents during setup. A legacy `word` (`office-word-mcp-server`) entry is superseded — removed by the skills sync, or offered for removal |
| `azure-devops-attachments` (optional, cloud only) | the same PAT, read from the environment by the launcher (`AZURE_DEVOPS_PAT`, else derived in memory from `AZURE_DEVOPS_PAT_B64`) — no new variable, no key in the entry | `"command": "node", "args": [".claude/mcp-launchers/azure-devops-attachments.cjs"]`, env `AZURE_DEVOPS_ORG_URL` = `https://dev.azure.com/{ORG_NAME}`, `AZURE_DEVOPS_AUTH_METHOD=pat`, `AZURE_DEVOPS_DEFAULT_PROJECT`; the launcher runs `@tiberriver256/mcp-server-azure-devops@0.1.49` so skills 8 / 9 can upload evidence attachments (the cloud server cannot). Written with every cloud `azure-devops` entry, never asked; self-hosted projects never get it (§2d) |
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

1. Tell the user, in one message, the seven steps of **"Set or replace the PAT"** in
   `references/azure-mcp-troubleshooting.md` §4, with the command filled in with this
   project's absolute path (the masked prompt cannot run through Claude's shell — the user runs
   `scripts/set-azure-devops-pat.ps1` / `.sh` in their own window). One prompt stores the token
   twice — `AZURE_DEVOPS_PAT_B64` (base64, cloud server) and `AZURE_DEVOPS_PAT` (raw,
   self-hosted server) — verifies both, and prints nothing secret. Required PAT scopes: Work
   Items Read/Write/Manage + Test Management Read/Write. Ask the user to reply "done" once VS
   Code is back after the full quit + relaunch. Never ask for the token in chat, never accept it
   if pasted (tell the user to run the script instead), never write it to any file yourself.
2. WAIT for the user. Then re-run `validate-setup.mjs`: the `PAT env var` row reads the
   variable's **existence** from the user registry hive (`HKCU\Environment`) or the shell
   profile — never its value — for the variable the entry references. `persisted: true` with
   `inProcess: false` (`sessionMissing: true`, row WARN "saved on this machine but missing from
   this session") means VS Code was not fully restarted yet: repeat the full-quit instruction,
   nothing else. When the row disagrees with what the user reports, the user runs
   `scripts/check-azure-devops-pat.ps1` / `.sh` (guide §0 — booleans only) and pastes its output.
3. Only after that restart can the Azure DevOps probe succeed; until then report
   `Azure DevOps MCP: restart pending`, not FAIL.

The script is idempotent (asks `Replace both? (y/N)` before replacing existing values) and
supports `-Remove` (`--remove` on macOS/Linux). Mode A never asks for this — it only reports
`PAT env var: FAIL/WARN` with the command to run.

## 2b. Browser secrets file — optional, skills 3c, 5b and 9 only (never the PAT script's job)

`link-qc-3c-validate-manual-test-cases-cli`, `link-qc-5b-test-run-manual-cli` and `link-qc-9-retesting` (playwright-cli route) drive the browser through
command lines that land in the chat transcript, so they never type a password: the user either logs in themselves in the browser
window the skill opens (attended login — works without any setup), or stores the credentials
ONCE in a secrets file the tool reads by NAME. When the validator reports `Browser secrets file`
as not set and the project intends to run 3c, 5b or 9 unattended, tell the user once (no wait):

```text
Optional, for skills 3c, 5b and 9 only: to let the CLI validator, the manual CLI run and the CLI retest log in without you, run this in your own
PowerShell window (macOS/Linux: bash …/set-playwright-secrets.sh). It asks for each role's
username and password (hidden), writes them to a file outside the repository that only your
account can read, and points PLAYWRIGHT_MCP_SECRETS_FILE at it. The skills type only the key
names (e.g. ADMIN_PASSWORD); the tool substitutes the values and masks them.

  powershell -ExecutionPolicy Bypass -File .claude/skills/link-qc-1-generate-update-testing-structure/scripts/set-playwright-secrets.ps1

Skip it if you prefer to log in yourself when 3c or 5b opens the browser. Afterwards fully quit
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

## 2d. Azure DevOps attachments MCP — cloud projects only, optional

**Why.** Microsoft's cloud server `@azure-devops/mcp` (the `azure-devops` entry) can download a
work-item attachment but cannot upload one from disk (its nightly upload tool takes inline base64
only — a 150 KB screenshot is ~210,000 characters of tool input, unusable). `link-qc-8-sync-bugs-azure`
and `link-qc-9-retesting` attach evidence screenshots to Azure Bugs, and their contract forbids
REST. The self-hosted server `@tiberriver256/mcp-server-azure-devops` has
`create_work_item_attachment(workItemId, filePath, …)` and `delete_work_item_attachment`, which read
the file from disk — so a cloud project runs that server as a SECOND entry, used for those two tools
only. The existing `azure-devops` entry is never edited, replaced or merged. Proven on 2026-10-13.

**What to write** (the `_optional_azure_devops_attachments_server` block of `assets/mcp.template.json`,
under its own key beside `azure-devops`; `{ORG_NAME}` / `{PROJECT_NAME}` filled in like the cloud entry):

```json
"azure-devops-attachments": {
  "command": "node",
  "args": [".claude/mcp-launchers/azure-devops-attachments.cjs"],
  "env": {
    "AZURE_DEVOPS_ORG_URL": "https://dev.azure.com/{ORG_NAME}",
    "AZURE_DEVOPS_AUTH_METHOD": "pat",
    "AZURE_DEVOPS_DEFAULT_PROJECT": "{PROJECT_NAME}"
  }
}
```

No PAT key in the env. The server needs the raw PAT in `AZURE_DEVOPS_PAT`; the launcher takes it
from the environment when it is set (the user-run PAT script stores both variables) and otherwise
derives it in memory from `AZURE_DEVOPS_PAT_B64` (`base64(":" + PAT)`), prints nothing and writes
nothing. No new variable, no new prompt: a project whose `PAT env var` row is PASS is ready.

**The launcher.** Copy `assets/mcp-launchers/azure-devops-attachments.cjs` from this skill to
`.claude/mcp-launchers/azure-devops-attachments.cjs` in the project — a byte copy, never edited,
committed like `.mcp.json` (it holds no secret). Copy it when it is missing and replace it when
`validate-setup.mjs` / the preflight say `launcher outdated` (sha256 differs from the asset — an
outdated copy is not valid content). It lives outside `.claude/skills/`, so `/sync-skills` never
writes or updates it: this step is the only updater. The pinned package version lives in the
launcher and in `lib.mjs` (`ADO_ATTACHMENTS_PACKAGE_PIN`); `npx -y` fetches it on first start, nothing
is pre-installed. The entry's path is relative to the project root (Claude Code starts `.mcp.json`
servers there).

**When.** Always on a cloud project — with every cloud `azure-devops` entry written or repaired,
no question asked. Never on a self-hosted project: its `azure-devops` entry already has the upload
tool (the validator row reads `PASS — not needed`; an entry someone added anyway is reported as
redundant, harmless). Mode A only reports.

**Permissions.** `mcp__azure-devops-attachments` is granted
`create_work_item_attachment` and `delete_work_item_attachment` only — skills 8 and 9 list exactly
those two tools in their `allowed-tools`, and their contract (§3 ladder) forbids any other use of
this server (no create, update, link, state or query). Every other skill keeps `mcp__azure-devops`
unchanged.

**Validation and user action.** Row `Azure DevOps attachments MCP`: WARN at worst — not configured
on a cloud project (skills 8 / 9 then leave attachments pending with manual instructions), launcher
missing / not referenced / outdated, or a literal token in its env (the `.mcp.json` row carries the
FAIL). Probe: `list_projects` (`--mcp azure-devops-attachments=PASS`). After writing the entry the
user reloads the session and approves `azure-devops-attachments` via `/mcp`; a PAT variable created in
the same run still needs the full quit + relaunch of §2a. Failures: `references/azure-mcp-troubleshooting.md`
row 7.

## 3. Probing (Claude-side, results passed to `validate-setup.mjs --mcp ...`)

* Newly configured servers attach **only after the Claude Code session is reloaded** (and may
  need approval via `/mcp`). "Configured, reload pending" is the correct, complete outcome —
  report it as WARN `reload pending`, not as a failure and not as PASS. A server whose entry
  references a **newly created environment variable** needs more than a reload: the editor
  process must be fully quit and relaunched (`restart pending`).
* Attached server → one cheap read each: Playwright MCP (e.g. browser status), Azure DevOps
  (cloud: `core_list_projects`; self-hosted: `list_projects`), Docx (e.g. `get_document_outline` on a scratch `.docx`, or any cheap
  read that returns without error), Figma when configured (`whoami` / any cheap read; a 401 means
  the `/mcp` login has not happened yet → WARN `login pending`), the attachments server when
  configured (`list_projects` — the same PAT rows apply). Pass
  `--mcp playwright=PASS,azure-devops=FAIL,docx=PASS[,figma=PASS][,azure-devops-attachments=PASS]`
  to the validator; unprobed servers stay `NOT_RUN` — never PASS.

## 4. Diagnostics

| Symptom | Meaning | Action |
|---|---|---|
| Azure DevOps `CONNECT_TIMEOUT`, "anonymous access" / `TF400813`, 401, 403 | one of the six rows of `references/azure-mcp-troubleshooting.md` — never set up, missing full restart (`PAT env var` row: `sessionMissing`), raw PAT stored instead of base64, expired / revoked PAT, missing scope, or a server that never started | stop Azure calls; the user runs `scripts/check-azure-devops-pat.ps1` / `.sh` (booleans only) and you give the ONE fix for the matching row as the first line of the reply — the 7 "Set or replace the PAT" steps with the command filled in when that is the fix. You cannot connect or disconnect MCP servers yourself — ask, wait, retry once. Never the token in chat, never REST |
| Azure DevOps 404 | cloud: wrong organization / project; self-hosted: `AZURE_DEVOPS_ORG_URL` without the collection, or wrong `AZURE_DEVOPS_DEFAULT_PROJECT` | fix the entry in `.mcp.json` (§1b), reload the session |
| `Azure DevOps hosting` row WARN (package ≠ remote) | cloud package configured for a self-hosted host or the reverse | rewrite the entry from the other template block (§1b); the PAT script needs no re-run — both variables exist |
| launcher fails | `npx` / `uvx` not resolvable | check Node / `uv` installation; for `docx` make sure `command` is the absolute `uvx` path (§1a step c) |
| `azure-devops-attachments` `CONNECT_TIMEOUT` / its tools absent / `Cannot find module …azure-devops-attachments.cjs` | the launcher could not start: no PAT variable in the process, cold `npx` cache, or the launcher file missing (not copied, or the server started from another folder — the path is relative to the project root) | `references/azure-mcp-troubleshooting.md` row 7: PAT variable set + full quit and relaunch; warm the cache with `npm exec --yes --package=@tiberriver256/mcp-server-azure-devops@0.1.49 -- node -e 0`; run `node .claude/mcp-launchers/azure-devops-attachments.cjs` once by hand and read its stderr; launcher missing → re-run skill 1 Mode B |
| `azure-devops-attachments` starts but every call is 401 / `TF400813` | the launcher found neither `AZURE_DEVOPS_PAT` nor `AZURE_DEVOPS_PAT_B64`, or the token is stale | same rows as the `azure-devops` entry (one token, two servers) |
| docx server exits with `ModuleNotFoundError: No module named 'mcp.server.fastmcp'` | `mcp` 2.x was resolved — the `--with "mcp<2"` pin is missing | add `"--with", "mcp<2"` before the final `docx-mcp-server` arg (validate-setup.mjs reports this as FAIL) |
| still failing after fixes at environment level | machine-level issue | tell the user: setup is complete but a PC restart is required, then re-run validation |

Do not retry indefinitely. Never claim an MCP works if it was not actually verified.

## QC sync family capabilities
All link-qc-7…link-qc-9 use mcp__azure-devops only, never token reads or REST. Skill 4 --suite-only requires suite listing/add tools; link-qc-7 requires point listing, run creation, result listing/update and run completion; link-qc-8 and link-qc-9 need work-item tools only. These testplan_* capabilities require the cloud @azure-devops/mcp server; probe actual attached schemas. Missing capability → NOT_RUN (server has no required test-plan tools), no fallback. link-qc-8 and link-qc-9 require work-item reads/writes, fields/states and revisions on mcp__azure-devops, plus an attachment-upload tool that takes a FILE PATH for evidence: the self-hosted server's own, else the optional `azure-devops-attachments` entry (§2d; upload / delete only), else the attachment is NOT_RUN and stays pending with a manual instruction — never REST, never an inline base64 upload; link-qc-9 never uses the Playwright MCP — it re-runs automated TCs through skill 5's run-stage.mjs and retests the rest through playwright-cli. Interactive cloud capability probe and live writes/browser runs in this authoring repository: NOT_RUN; perform in a consumer project after sync.
