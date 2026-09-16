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
   `_optional_azure_resources_server` key unless the project needs Azure resource tooling).
3. `npx`-based servers need no pre-installation (`npx -y` fetches on first launch). Never run
   `npm install -g` for them.
4. Replace `{ORG_NAME}` with the Azure DevOps organization — derive it from the git remote, else
   from the learning file, else ask.
5. Validate the JSON, then smoke-test launchers (`npx @playwright/mcp --version`, and for the
   Docx MCP the pre-warm command in §1a step d). Replace `{UVX_PATH}` with the absolute `uvx`
   path (§1a step c).

## 1a. Docx MCP — prerequisites (verify each with a command, in this order)

The `docx` server is `docx-mcp-server` (SecurityRonin, PyPI `docx-mcp-server`, tools
`mcp__docx__*`). It replaces the legacy read-only `word` server (`office-word-mcp-server`).
**Detection:** a server counts as present only if its `args` contain `docx-mcp-server`. An entry
whose args contain `office-word-mcp-server` / `word_mcp_server` is the superseded legacy server:
`sync-qa-skills.mjs --apply` removes it automatically; if one is still there, tell the user it is
superseded and OFFER to remove it — ask, never delete silently (`3-generate-manual-test-cases`
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

What it is for: QA/UAT document generation, and — for `2-review-requirements` — writing review
findings into the RSD/spec `.docx` as real Word comments and reading the replies reviewers leave
on them. Never generate documents during setup.

## 2. Servers

| Server | Auth | Notes |
|---|---|---|
| `playwright` | none | configure fully and unconditionally |
| `azure-devops` | PAT via `${AZURE_DEVOPS_PAT_B64}` | value = base64 of `":" + PAT`; scopes Work Items Read/Write/Manage + Test Management Read/Write. It is a PAT — not an Azure Storage SAS token; no `az login`. Write the entry even when the variable is not set yet and report "set `AZURE_DEVOPS_PAT_B64` and reconnect" as the only user action |
| `docx` | none | `{UVX_PATH} --from docx-mcp-server --with "mcp<2" docx-mcp-server` (§1a); used later by skills 2/3 for documents and review comments — never generate documents during setup. A legacy `word` (`office-word-mcp-server`) entry is superseded — removed by the skills sync, or offered for removal |
| `azure` (optional) | `az login` when a call fails | Azure resources only, not DevOps |

Secret rules: never hardcode the PAT in `.mcp.json`, `.env`, a skill or a doc; never commit,
print, log or ask the user to paste it in chat. `validate-setup.mjs` flags inline secrets as
FAIL.

## 2a. Creating the PAT environment variable on the user's PC (Mode B/C, new project)

The `azure-devops` entry reads `${AZURE_DEVOPS_PAT_B64}` from a **user-level environment
variable on the machine**. Whenever you write or merge that entry and the preflight/validator
reports `PAT env var` as not set (`pat.persisted = false`), **ask the user to create it now** —
do not leave it as a vague "set the variable" note:

1. Tell the user, in one message, exactly what to run **in their own terminal** (the masked
   prompt cannot run through Claude's shell):

   ```text
   The azure-devops MCP entry needs the PAT stored as a user environment variable on this PC.
   Please run this in a PowerShell window and paste the token when prompted (input is hidden):

     powershell -ExecutionPolicy Bypass -File .claude/skills/1-generate-update-testing-structure/scripts/set-azure-devops-pat.ps1

   (macOS/Linux: bash .claude/skills/1-generate-update-testing-structure/scripts/set-azure-devops-pat.sh)

   It stores base64(":" + PAT) as AZURE_DEVOPS_PAT_B64 for your Windows user, verifies it, and
   prints nothing secret. Required PAT scopes: Work Items Read/Write/Manage + Test Management
   Read/Write. Reply "done" when finished — then reopen the terminal / Claude Code so the new
   variable is visible and reconnect the azure-devops MCP server (/mcp).
   ```

   Never ask for the token in chat, never accept it if pasted (tell the user to run the script
   instead), never write it to any file yourself.
2. WAIT for the user. Then re-run `validate-setup.mjs`: the `PAT env var` row reads the
   variable's **existence** from the user registry hive (`HKCU\Environment`) or the shell
   profile — never its value. `inProcess: false` with `persisted: true` is expected until the
   session is reopened; report it as "set, reopen the session".
3. Only after the session was reopened can the Azure DevOps probe succeed; until then report
   `Azure DevOps MCP: reload pending`, not FAIL.

The script is idempotent (asks before replacing an existing value) and supports `-Remove`.
Mode A never asks for this — it only reports `PAT env var: FAIL/WARN` with the command to run.

## 3. Probing (Claude-side, results passed to `validate-setup.mjs --mcp ...`)

* Newly configured servers attach **only after the Claude Code session is reloaded** (and may
  need approval via `/mcp`). "Configured, reload pending" is the correct, complete outcome —
  report it as WARN `reload pending`, not as a failure and not as PASS.
* Attached server → one cheap read each: Playwright MCP (e.g. browser status), Azure DevOps
  (`core_list_projects`), Docx (e.g. `get_document_outline` on a scratch `.docx`, or any cheap
  read that returns without error). Pass `--mcp playwright=PASS,azure-devops=FAIL,docx=PASS`
  to the validator; unprobed servers stay `NOT_RUN` — never PASS.

## 4. Diagnostics

| Symptom | Meaning | Action |
|---|---|---|
| Azure DevOps 401 | rejected/stale token (expired, revoked, wrong org, old env value) | ask the user to renew the token if needed and **reconnect the server** (`/mcp` → azure-devops → reconnect). You cannot connect or disconnect MCP servers yourself — ask, wait, retry once |
| Azure DevOps 403 | token valid, scope missing | name the missing scope |
| Azure DevOps 404 | wrong project/org name | fix the org in `.mcp.json` |
| launcher fails | `npx` / `uvx` not resolvable | check Node / `uv` installation; for `docx` make sure `command` is the absolute `uvx` path (§1a step c) |
| docx server exits with `ModuleNotFoundError: No module named 'mcp.server.fastmcp'` | `mcp` 2.x was resolved — the `--with "mcp<2"` pin is missing | add `"--with", "mcp<2"` before the final `docx-mcp-server` arg (validate-setup.mjs reports this as FAIL) |
| still failing after fixes at environment level | machine-level issue | tell the user: setup is complete but a PC restart is required, then re-run validation |

Do not retry indefinitely. Never claim an MCP works if it was not actually verified.
