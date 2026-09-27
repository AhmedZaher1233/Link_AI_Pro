# Skills sync — the one procedure

The canonical source of skills 1-12, 3b and 3c (12 = the ADHD chat overlay) and the `/sync-skills` command is
`https://github.com/AhmedZaher1233/Link_AI_Pro` (branch `main`). The only implementation is
`scripts/sync-qa-skills.mjs`; `/sync-skills` (`.claude/commands/sync-skills.md`) is a thin
wrapper around it. Never re-describe the procedure elsewhere — link here.

| Situation | Command | Writes? |
|---|---|---|
| Mode A (audit) | `node ${CLAUDE_SKILL_DIR}/scripts/sync-qa-skills.mjs --check --target <project>` | no |
| Mode B / C, new project | `node ${CLAUDE_SKILL_DIR}/scripts/sync-qa-skills.mjs --apply --target <project>` | yes — normal permission flow |
| one skill only | add `--only link-qc-5-test-run-automation` | |
| locally edited skill files | add `--force` (only when the user says so) | |
| install the optional tools — playwright-cli for skill 3c, Pillow + numpy for link-qc-6-ui-testing (opt-in) | add `--tools` to `--apply` (only after the user said yes) | yes — global `@playwright/cli`, its chromium browser, the `.playwright-cli/` line in `.gitignore`, and `pip install pillow numpy` when a Python interpreter already exists |

What the script does:
1. Refuses to run inside the canonical repository itself (`git pull` there instead).
2. Fetches the source into a temp folder — sparse clone of `.claude/skills` and
   `.claude/commands`; falls back to raw GitHub downloads; if unreachable it reports
   `error: source unreachable — local skills unchanged` and stops. It never invents content.
3. Classifies every owned file: `NEW`, `UPDATED`, `CURRENT`, `LOCAL-ONLY` (never deleted),
   `SKIPPED` (uncommitted or hand-made local edits, unless `--force`), `MISSING-IN-SOURCE`.
4. `--apply` copies `NEW` + `UPDATED` into `.claude/skills/<name>/` (sub-folders such as
   `assets/`, `references/`, `scripts/` included) and `.claude/commands/sync-skills.md`. An
   uppercase `.claude/Skills` folder is migrated to `.claude/skills` first (two-step rename,
   `git mv` when tracked).
5. `.mcp.json` migration (with `--apply`, unless `--no-mcp`): removes every legacy `word` server
   (`office-word-mcp-server`, read-only comments — superseded) and adds or re-pins the `docx`
   server (`docx-mcp-server`, absolute `uvx` path, `--with "mcp<2"`). Only those entries are
   touched; other servers, an unparsable file, and everything else stay as they are. `--check`
   lists the planned actions under `mcp.actions`.
6. Optional tools (**only with `--tools`** on `--apply`): `npm install -g
   @playwright/cli@latest`, `playwright-cli install-browser` (chromium) and the
   `.playwright-cli/` line in `.gitignore` (inside a git repository) for skill 3c; and
   `<python> -m pip install pillow numpy` for link-qc-6-ui-testing's static-image annotation — only when a
   Python interpreter is already present (the interpreter itself is never installed; without it
   link-qc-6-ui-testing annotates live pages in the DOM). `--check` always reports the tool status and the
   planned actions under `tools` (`tools.python` carries the interpreter and package state); a
   failed step is reported as `tool-failed` and never stops the skills copy. None of it is
   needed by 3b or any other skill, so the flag is never implied.
7. Owns nothing else: never touches `docs/`, `Testing/`, other `.mcp.json` servers, settings,
   tests, app code, or the browser secrets file (user-run script only).
8. Emits JSON: `files[]`, `summary`, `applied[]`, `localOnlySkills`, `mcp`, `tools`, `reloadRequired`. Pass the
   `--check` output file to `validate-setup.mjs --sync-report` so the `Skills current` row is
   measured, not guessed.

After any `SKILL.md` or the command changed: tell the user to reload the Claude Code session;
do not claim a newly installed skill is available until the environment lists it.

Steering documents are **not** synced by this script. To fetch the source repo's
`docs/steering/` tree for a missing L1/L2 (see `steering-governance.md`), extend the sparse
checkout in a temp clone: `git -C <tmp> sparse-checkout set .claude/skills .claude/commands docs/steering`.
