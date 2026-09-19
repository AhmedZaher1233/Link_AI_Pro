---
description: Pull the latest QA skills (1-7) and this command from the canonical GitHub repo AhmedZaher1233/Link_AI_Pro into the current project's .claude/skills/, and migrate .mcp.json from the legacy `word` MCP (office-word-mcp-server) to the `docx` MCP (docx-mcp-server, pinned `--with mcp<2`). Use in ANY project. Args: [skill names…] [--dry-run] [--branch <name>] [--force] [--no-mcp]
argument-hint: "[1-generate-update-testing-structure … 7-discover-business-rules] [--dry-run] [--branch main] [--force] [--no-mcp]"
allowed-tools: Bash(node *sync-qa-skills.mjs*), Bash(curl *), Bash(mkdir *), Read, Glob, Grep
---

# /sync-skills — update the QA skills in this project from the source repo

Source of truth: `https://github.com/AhmedZaher1233/Link_AI_Pro` (branch `main` unless
`--branch` is given). It owns `.claude/skills/1-…7-*/` (all sub-folders), this command, and — inside
`.mcp.json` — only the `docx` MCP entry plus any legacy `word` entry it replaces.
**The only implementation is** `.claude/skills/1-generate-update-testing-structure/scripts/sync-qa-skills.mjs`
— this command is a thin wrapper around it. Never re-implement the sync in prose.

Arguments: `$ARGUMENTS`
- No skill names → all seven skills + this command.
- Skill folder names → `--only <name>` for each.
- `--dry-run` → run the script with `--check` (read-only, nothing copied).
- `--force` → overwrite files that have local edits.
- `--branch <name>` → passed through.
- `--no-mcp` → leave `.mcp.json` untouched (skills only).

**`.mcp.json` migration (default on `--apply`):** the legacy `word` server (`office-word-mcp-server`,
read-only comments) is superseded by the `docx` server (`docx-mcp-server` — real Word review comments,
threads, track changes, used by skills 2/3). The script removes every legacy `word` entry and
adds or re-pins the `docx` entry with the absolute `uvx` path and the mandatory `--with "mcp<2"`
(the package declares an unpinned `mcp` dependency; `mcp` 2.x breaks the server on import). No other
server is ever changed; a `.mcp.json` that does not parse is left alone and reported.

## Steps

1. **Locate the script.** If `.claude/skills/1-generate-update-testing-structure/scripts/sync-qa-skills.mjs`
   (or the same path under a legacy uppercase `.claude/Skills/`) is missing, bootstrap it — one
   time, from the project root:

   ```bash
   mkdir -p .claude/skills/1-generate-update-testing-structure/scripts
   for f in lib.mjs sync-qa-skills.mjs; do
     curl -fsSL -o ".claude/skills/1-generate-update-testing-structure/scripts/$f" \
       "https://raw.githubusercontent.com/AhmedZaher1233/Link_AI_Pro/main/.claude/skills/1-generate-update-testing-structure/scripts/$f"
   done
   ```

   If the download fails → report "source unreachable — local skills unchanged" and stop.

2. **Run it** from the project root, passing the mapped arguments:

   ```bash
   node .claude/skills/1-generate-update-testing-structure/scripts/sync-qa-skills.mjs --check --pretty [--branch X] [--only …]
   node .claude/skills/1-generate-update-testing-structure/scripts/sync-qa-skills.mjs --apply --pretty [--force] [--branch X] [--only …]
   ```

   Always run `--check` first and show the result; without `--dry-run`, follow with `--apply`.
   **Run `--apply` only once.** If that pass updates the sync implementation itself (the script,
   `lib.mjs` or this command), the script re-runs itself once with the new code and returns both
   passes in one payload (`rerun` field) — never ask the user to run `/sync-skills` a second time.
   The script refuses to run inside the canonical repo itself (use `git pull` there), migrates a
   legacy uppercase `.claude/Skills` folder to `.claude/skills`, skips files with uncommitted
   local edits unless `--force`, never deletes local-only files, and never touches anything
   outside `.claude/skills/`, this command and the `docx` / legacy `word` entries of `.mcp.json`
   (see the migration note above; `--no-mcp` disables it).

3. **Report** the script's `summary`, `applied`, `localOnlySkills`, `mcp` and `hint` fields as a short
   table (skill · result · files new/updated/current). When a `rerun` field is present, add one line
   `sync updated itself and re-ran: pass 1 {n} files · pass 2 {m} files` — the table reflects pass 2.
   Then one `.mcp.json` line:
   `mcp: {actions performed | planned | none} · docx pinned {yes/no} · uvx {path | not found}`
   (`--dry-run` shows the *planned* actions, e.g. `remove:word, add:docx`). If `reloadRequired` is
   true, tell the user to **reload the Claude Code session** so the new versions are picked up, and
   — when an `mcp-*` action ran — to approve the new `docx` server via `/mcp`. If `mcp.uvxFound` is
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
