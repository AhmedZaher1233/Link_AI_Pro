---
description: Pull the latest QA skills (1-12, 3b and 3c) and this command from the canonical GitHub repo AhmedZaher1233/Link_AI_Pro into the current project's .claude/skills/, migrate .mcp.json from the legacy `word` MCP (office-word-mcp-server) to the `docx` MCP (docx-mcp-server, pinned `--with mcp<2`), and — only with --tools — install playwright-cli + its browser for skill 3c and Pillow + numpy for link-qc-6-ui-testing (when Python exists). Use in ANY project. Args: [skill names…] [--dry-run] [--branch <name>] [--force] [--no-mcp] [--tools]. By default it DELETES our Link skill folders and downloads them fresh — only after the user confirms; other skills and files are never deleted.
argument-hint: "[link-qc-1-generate-update-testing-structure … link-qc-3b-validate-manual-test-cases link-qc-3c-validate-manual-test-cases-cli … link-qc-11-discover-business-rules link-qc-12-adhd-output-style] [--dry-run] [--branch main] [--force] [--no-mcp] [--tools]"
allowed-tools: Bash(node *sync-qa-skills.mjs*), Bash(curl *), Bash(mkdir *), Read, Glob, Grep
---

# /sync-skills — update the QA skills in this project from the source repo

Source of truth: `https://github.com/AhmedZaher1233/Link_AI_Pro` (branch `main` unless
`--branch` is given). It owns every skill folder listed in `lib.mjs` `SKILLS` (1-12, 3b and 3c, all sub-folders), this command, — inside
`.mcp.json` — only the `docx` MCP entry plus any legacy `word` entry it replaces, and — only when
`--tools` is given — the global `@playwright/cli` package, its chromium browser, the
`.playwright-cli/` line of `.gitignore` (skill 3c's browser tool; never a prerequisite for 3b)
and the Python packages `pillow` + `numpy` when an interpreter already exists (link-qc-6-ui-testing's
static-image annotation; live URLs need none).
**The only implementation is** `.claude/skills/link-qc-1-generate-update-testing-structure/scripts/sync-qa-skills.mjs`
— this command is a thin wrapper around it. Never re-implement the sync in prose.

Arguments: `$ARGUMENTS`
- No skill names → every skill in `SKILLS` (1-12, 3b and 3c) + this command.
- Skill folder names → `--only <name>` for each.
- `--dry-run` → run the script with `--check` (read-only, nothing copied).
- `--force` → overwrite files that have local edits (update-only answer only).
- `--branch <name>` → passed through.
- `--no-mcp` → leave `.mcp.json` untouched (skills only).
- `--tools` → also install the optional tools: playwright-cli for skill 3c, and Pillow + numpy for link-qc-6-ui-testing when a Python interpreter already exists (passed through to `--apply`; `--check` only plans it). Without it nothing is installed — 3b and every other skill need none of it.

**`.mcp.json` migration (default on `--apply`):** the legacy `word` server (`office-word-mcp-server`,
read-only comments) is superseded by the `docx` server (`docx-mcp-server` — real Word review comments,
threads, track changes, used by skills 2/3). The script removes every legacy `word` entry and
adds or re-pins the `docx` entry with the absolute `uvx` path and the mandatory `--with "mcp<2"`
(the package declares an unpinned `mcp` dependency; `mcp` 2.x breaks the server on import). No other
server is ever changed; a `.mcp.json` that does not parse is left alone and reported.

## Steps

1. **Locate the script.** If `.claude/skills/link-qc-1-generate-update-testing-structure/scripts/sync-qa-skills.mjs`
   (or the same path under a legacy uppercase `.claude/Skills/`) is missing, bootstrap it — one
   time, from the project root:

   ```bash
   mkdir -p .claude/skills/link-qc-1-generate-update-testing-structure/scripts
   for f in lib.mjs sync-qa-skills.mjs; do
     curl -fsSL -o ".claude/skills/link-qc-1-generate-update-testing-structure/scripts/$f" \
       "https://raw.githubusercontent.com/AhmedZaher1233/Link_AI_Pro/main/.claude/skills/link-qc-1-generate-update-testing-structure/scripts/$f"
   done
   ```

   If the download fails → report "source unreachable — local skills unchanged" and stop.

2. **Check, then confirm.** Run `--check` (below) and read its `replace` block. When
   `replace.needsConfirmation` is true, show `replace.deleteAndRedownload`, `replace.legacyRemoved`,
   `replace.lost` (every local edit / extra file that will disappear) and `replace.keptUntouched`, then ask
   ONCE (AskUserQuestion) with `replace.confirmText` as the question — it says that any enhancement made to
   the Link skills is removed and replaced with the new version. Options:
   - **Replace — delete and download fresh** (recommended) → `--apply --replace --yes`
   - **Update only — keep my edits** → plain `--apply` (edited files are SKIPPED, extra files kept)
   - **Cancel** → stop; nothing changes.

   The delete + re-download covers ONLY our skill folders (`lib.mjs` `SKILLS` + legacy `SKILL_RENAMES`
   names) and this command file. Other skill folders under `.claude/skills/`, other commands, `.mcp.json`,
   `.gitignore`, `Testing/`, `docs/` and settings are never deleted; the `.mcp.json` migration and
   `--tools` keep their normal behaviour and are not part of the question. Never pass `--yes` without the
   user's answer in this run — the script refuses `--replace` without it. When `needsConfirmation` is false
   (first install, nothing of ours present) run plain `--apply` without asking. `--dry-run` shows the plan
   and asks nothing.

3. **Run it** from the project root, passing the mapped arguments:

   ```bash
   node .claude/skills/link-qc-1-generate-update-testing-structure/scripts/sync-qa-skills.mjs --check --pretty [--branch X] [--only …]
   node .claude/skills/link-qc-1-generate-update-testing-structure/scripts/sync-qa-skills.mjs --apply --pretty [--replace --yes | --force] [--branch X] [--only …]
   ```

   Always run `--check` first and show the result; without `--dry-run`, follow with `--apply` per the
   user's answer in step 2.
   **Run `--apply` only once.** If that pass updates the sync implementation itself (the script,
   `lib.mjs` or this command), the script re-runs itself once with the new code and returns both
   passes in one payload (`rerun` field) — never ask the user to run `/sync-skills` a second time.
   The script refuses to run inside the canonical repo itself (use `git pull` there), migrates a
   legacy uppercase `.claude/Skills` folder to `.claude/skills`; with `--replace --yes` it deletes each
   of our skill folders and puts the fresh copy in its place (staged first, the old folder restored on any
   failure — `replace-failed`). Plain `--apply` (update only) skips files with uncommitted
   local edits unless `--force` and never deletes local-only files (a folder carrying a pre-`link-qc-N` name from an
   earlier release — `lib.mjs` `SKILL_RENAMES` — is the one exception in both modes: `--apply` removes it once its replacement
   is in place and reports it under `legacy-removed`). It never touches anything
   outside `.claude/skills/`, this command, the `docx` / legacy `word` entries of `.mcp.json`
   (see the migration note above; `--no-mcp` disables it) and — with `--tools` only — the
   optional tools (`npm install -g @playwright/cli@latest`, `playwright-cli install-browser`,
   the `.playwright-cli/` gitignore line for skill 3c; `pip install pillow numpy` for link-qc-6-ui-testing when
   Python exists). A failed tool step is reported as `tool-failed` and never stops the skills copy.

4. **Report** the script's `summary`, `applied` (`replaced` / `installed` / `legacy-removed` / `replace-failed` per folder), `localOnlySkills`, `legacySkills`, `mcp` and `hint` fields as a short
   table (skill · result · files new/updated/current). When a `rerun` field is present, add one line
   `sync updated itself and re-ran: pass 1 {n} files · pass 2 {m} files` — the table reflects pass 2.
   Then one `.mcp.json` line:
   `mcp: {actions performed | planned | none} · docx pinned {yes/no} · uvx {path | not found}`
   and one tools line from the `tools` field:
   `tools: playwright-cli {version | installed now | not installed | failed: …} · browser {cached | installed now | —} · gitignore {ok | added | —} · python {ready | packages installed now | packages missing | absent}`
   (without `--tools` the planned actions are shown as "planned with --tools"; a `tool-failed`
   entry names the failing step and the fix — `/link-qc-1-generate-update-testing-structure repair`).
   (`--dry-run` shows the *planned* actions, e.g. `remove:word, add:docx`). If `reloadRequired` is
   true, tell the user to **reload the Claude Code session** so the new versions are picked up, and
   — when an `mcp-*` action ran — to approve the new `docx` server via `/mcp` (a reload covers
   server entries and skills; only a NEW environment variable, e.g. the Azure DevOps PAT, needs a
   full quit + relaunch of VS Code — that is skill 1's business, never this command's). The
   `azure-devops` entry (cloud or self-hosted) is never touched by the sync. If `mcp.uvxFound` is
   false, relay the install hint (`uv` is required for the docx server). In `--dry-run` mode the
   header reads `⟳ Dry run — nothing copied`.

## Installing this command in a project that does not have it yet

Run once from the project root (PowerShell):

```powershell
New-Item -ItemType Directory -Force .claude\commands | Out-Null
Invoke-WebRequest https://raw.githubusercontent.com/AhmedZaher1233/Link_AI_Pro/main/.claude/commands/sync-skills.md -OutFile .claude\commands\sync-skills.md
```

or Git Bash:

```bash
mkdir -p .claude/commands && curl -fsSL -o .claude/commands/sync-skills.md \
  https://raw.githubusercontent.com/AhmedZaher1233/Link_AI_Pro/main/.claude/commands/sync-skills.md
```

Then start Claude Code in that project and run `/sync-skills`.
