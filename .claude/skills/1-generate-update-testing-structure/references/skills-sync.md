# Skills sync — the one procedure

The canonical source of skills 1-7 and the `/sync-skills` command is
`https://github.com/AhmedZaher1233/Link_AI_Pro` (branch `main`). The only implementation is
`scripts/sync-qa-skills.mjs`; `/sync-skills` (`.claude/commands/sync-skills.md`) is a thin
wrapper around it. Never re-describe the procedure elsewhere — link here.

| Situation | Command | Writes? |
|---|---|---|
| Mode A (audit) | `node ${CLAUDE_SKILL_DIR}/scripts/sync-qa-skills.mjs --check --target <project>` | no |
| Mode B / C, new project | `node ${CLAUDE_SKILL_DIR}/scripts/sync-qa-skills.mjs --apply --target <project>` | yes — normal permission flow |
| one skill only | add `--only 6-test-run-automation` | |
| locally edited skill files | add `--force` (only when the user says so) | |

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
5. Owns nothing else: never touches `docs/`, `Testing/`, `.mcp.json`, settings, tests or app
   code.
6. Emits JSON: `files[]`, `summary`, `applied[]`, `localOnlySkills`, `reloadRequired`. Pass the
   `--check` output file to `validate-setup.mjs --sync-report` so the `Skills current` row is
   measured, not guessed.

After any `SKILL.md` or the command changed: tell the user to reload the Claude Code session;
do not claim a newly installed skill is available until the environment lists it.

Steering documents are **not** synced by this script. To fetch the source repo's
`docs/steering/` tree for a missing L1/L2 (see `steering-governance.md`), extend the sparse
checkout in a temp clone: `git -C <tmp> sparse-checkout set .claude/skills .claude/commands docs/steering`.
