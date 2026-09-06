---
description: Pull the latest QA skills (1-7) and this command from the canonical GitHub repo AhmedZaher1233/Link_AI_Pro into the current project's .claude/ folder. Use in ANY project. Args: [skill names…] [--dry-run] [--branch <name>] [--force]
argument-hint: "[1-generate-update-testing-structure … 7-discover-business-rules] [--dry-run] [--branch main] [--force]"
allowed-tools: Bash, Read, Glob, Grep
---

# /sync-skills — update the QA skills in this project from the source repo

Source of truth: `https://github.com/AhmedZaher1233/Link_AI_Pro` (branch `main` unless
`--branch` is given). It owns:

- `.claude/Skills/1-generate-update-testing-structure/`
- `.claude/Skills/2-review-requirements/`
- `.claude/Skills/3-generate-manual-test-cases/`
- `.claude/Skills/4-white-box-testing/`
- `.claude/Skills/5-publish-test-cases-azure/`
- `.claude/Skills/6-test-run-automation/` (incl. `assets/`)
- `.claude/Skills/7-discover-business-rules/` (incl. `references/`)
- `.claude/commands/sync-skills.md` (this command — it updates itself)

Arguments: `$ARGUMENTS`
- No skill names → sync all seven skills + this command.
- One or more skill folder names → sync only those (+ this command).
- `--dry-run` → show what would change, copy nothing.
- `--force` → overwrite local files even if they have local edits (see step 4).

**Never touch anything else in the target project**: not `.claude/agents/`, `.mcp.json`,
`settings*.json`, `docs/`, `Testing/`, tests, or app code. Skills + this command only.

## Steps

1. **Resolve the target** — the current working directory is the project. Confirm it has (or
   create) `.claude/Skills/` and `.claude/commands/`. If the cwd IS the canonical repo checkout
   (`git remote get-url origin` ends with `AhmedZaher1233/Link_AI_Pro.git`), say so and stop:
   run `git pull` there instead.

2. **Fetch the latest source** into a temp folder (never inside the project). Prefer a sparse
   clone; keep it shallow:

   ```bash
   TMP="$(mktemp -d)"
   git clone --quiet --depth 1 --filter=blob:none --sparse --branch "${BRANCH:-main}" \
     https://github.com/AhmedZaher1233/Link_AI_Pro.git "$TMP"
   git -C "$TMP" sparse-checkout set .claude/Skills .claude/commands
   git -C "$TMP" log -1 --format='%h %ad %s' --date=short
   ```

   If `git` is unavailable or the clone fails, fall back to raw downloads per file from
   `https://raw.githubusercontent.com/AhmedZaher1233/Link_AI_Pro/<branch>/.claude/...`
   (enumerate the tree via `https://api.github.com/repos/AhmedZaher1233/Link_AI_Pro/git/trees/<branch>?recursive=1`).
   If the repo is unreachable at all → report "source unreachable — local skills unchanged"
   and stop. Never guess content.

3. **Diff** every file under the selected remote skill folders and `commands/sync-skills.md`
   against the project's local copy (byte compare, e.g. `cmp -s` / `diff -q`). Classify each
   file: `NEW` (missing locally), `UPDATED` (differs), `CURRENT` (identical),
   `LOCAL-ONLY` (exists locally, not in source — report, never delete).

4. **Local-edit guard** — before overwriting an `UPDATED` file, check whether the local copy
   differs from what the source repo shipped previously (if the project is a git repo:
   `git -C <project> diff --quiet -- <file>` clean + last commit of that file mentions
   sync/skills → safe). If the local file has uncommitted or hand-made edits and `--force`
   was not given → **do not overwrite**; list it under `SKIPPED (local edits)` with the
   suggestion to re-run with `--force` or commit first.

5. **Copy** (`--dry-run` → skip this step): mirror each selected skill folder from the temp
   clone into `.claude/Skills/<name>/` — including sub-folders such as `assets/` and `references/` — and
   `commands/sync-skills.md` into `.claude/commands/`. Preserve file names exactly (case
   included). Remove the temp folder afterwards.

6. **Report** in this shape:

   ```
   ✔ Skills synced from AhmedZaher1233/Link_AI_Pro@main ({commit} {date})
     Target: {project path}/.claude/
   | Skill / file                          | Result   | Files (new/updated/current) |
   |---------------------------------------|----------|-----------------------------|
   | 1-generate-update-testing-structure   | UPDATED  | 0 / 1 / 0                   |
   | …                                     |          |                             |
   | commands/sync-skills.md               | CURRENT  | 0 / 0 / 1                   |
     Skipped (local edits): {list or none}   Local-only: {list or none}
   ```

   Then, if ANY `SKILL.md` or this command changed: tell the user to **reload the Claude Code
   session** (or run `/reload-skills` if available) so the new versions are picked up.
   In `--dry-run` mode the header reads `⟳ Dry run — nothing copied`.

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
