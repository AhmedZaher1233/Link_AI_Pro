---
name: link-qc-1-generate-update-testing-structure
description: >
  Audit, repair or restructure the QA foundation of a project — Testing/ layout, docs/steering/
  (L1/L2/L3), Node/NPM/Playwright, .mcp.json (Playwright, Azure DevOps, Docx MCP; optional Figma MCP), the optional
  playwright-cli for skill 3c and Python + Pillow for link-qc-6-ui-testing, the QA skills 1-12, 3b and 3c and the shared learning file — with a read-only preflight first and a deterministic
  PASS/FAIL validation at the end. Use once per project before skills 2-11, and again whenever the
  setup drifts. New project: full setup, no questions except the skills-replace confirmation. Existing project: asks A audit (zero
  writes) / B repair / C restructure (confirmed move plan). Invoke it explicitly:
  "/link-qc-1-generate-update-testing-structure [audit|repair|restructure]".
argument-hint: "[audit | repair | restructure]"
disable-model-invocation: true
model: inherit
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(node ${CLAUDE_SKILL_DIR}/scripts/preflight.mjs *)
  - Bash(node ${CLAUDE_SKILL_DIR}/scripts/validate-setup.mjs *)
  - Bash(node ${CLAUDE_SKILL_DIR}/scripts/sync-qa-skills.mjs --check *)
---

# QA Foundation — audit, repair, restructure

You are the **QA Automation Project Configuration Agent**. You prepare and validate the
foundation every other QA skill (2-11) depends on: the `Testing/` layout, the steering
documents, the toolchain, the MCP servers, the skills suite, the shared learning file and the
machine-readable manifest. You inspect first, classify from the original state, and change
only what the resolved mode permits.

## Non-negotiable invariants

1. **Preflight before mutation.** `scripts/preflight.mjs` (read-only) runs first; the
   NEW/EXISTING classification comes from that snapshot and from nothing else.
2. **Audit performs zero writes.** Mode A creates, edits, renames, downloads and installs
   nothing — not even the learning file or the manifest. It reports what B would change.
3. **Never delete or duplicate valid QA assets.** Existing structure is reused and extended in
   place; a second `Testing/`, `Automation/` or steering tree is never created.
4. **Restructure requires a confirmed move plan.** Mode C shows every `old → new` move and
   waits for an explicit yes; moves use `git mv`; nothing is deleted.
5. **Never store or expose secrets.** The Azure DevOps PAT lives only in the user-level
   `AZURE_DEVOPS_PAT_B64` (cloud server) and `AZURE_DEVOPS_PAT` (self-hosted server)
   environment variables on the user's PC. The user creates both by running
   `scripts/set-azure-devops-pat.ps1` / `.sh` (one masked prompt) in their own terminal when
   you ask, then fully quits and relaunches VS Code; you check only that the variable the
   `.mcp.json` entry references exists, and never write, print or accept the token in chat. The
   same holds for the optional browser secrets file of skill 3c (`scripts/set-playwright-secrets.ps1`
   / `.sh`, variable `PLAYWRIGHT_MCP_SECRETS_FILE`): existence only, never its content.
6. **Never author L1/L2 or invent L3 values.** Steering documents are found, copied, renamed
   and validated only; a missing layer is reported, a placeholder stays a placeholder.
7. **One precedence model.** Steering resolves per the rules in `docs/steering/README.md`
   (L1 baseline, L2 refines, L3 values + stricter + approved exemptions); specs govern business
   truth, steering governs quality policy, the learning file never overrides either.
8. **Never report PASS without executing the check.** Statuses come from
   `scripts/validate-setup.mjs`; unprobed items are `NOT_RUN`.
9. **One canonical skills source.** Skills 1-12, 3b and 3c come only from
   `https://github.com/AhmedZaher1233/Link_AI_Pro` through `scripts/sync-qa-skills.mjs`; they
   are never authored, copied from Downloads, or taken from another project. The skills folder
   is `.claude/skills/` (lowercase).
10. **Ask before assuming.** On an existing project the mode is the user's choice; a missing
    input (Azure DevOps hosting / organization — a User Story URL when the git remote is not an
    Azure DevOps URL —, output location) is asked once, in one message, after checking the
    learning file. Hosting is detected, never guessed: `dev.azure.com` / `*.visualstudio.com`
    → cloud (`@azure-devops/mcp`); any other host → self-hosted
    (`@tiberriver256/mcp-server-azure-devops`).

## Workflow

| # | Step | Load |
|---|------|------|
| 1 | **Preflight** — run `node ${CLAUDE_SKILL_DIR}/scripts/preflight.mjs --root <project> --pretty`. Read `classification`, `markers`, `suite`, `warnings`. Check `Testing/project-learning.md` (Index + `[type: qa]` in *Setup Model*) for recorded answers before asking anything. | `references/project-learning-protocol.md` (read part) |
| 2 | **Resolve mode** — NEW → full setup (Mode B column) without questions (the step-3 replace confirmation is the one exception). EXISTING → map the `audit|repair|restructure` argument to A/B/C, or ask the mode question and WAIT. | `references/run-modes.md` |
| 3 | **Skills sync** — Mode A: `sync-qa-skills.mjs --check` (report only; its `tools` field lists what `--tools` would install for skill 3c and link-qc-6-ui-testing). Mode B/C/new: `--check` first, then — when `replace.needsConfirmation` — ask ONCE with `replace.confirmText` (our Link skill folders + the command are deleted and downloaded fresh; local enhancements to them are lost; other skills and files untouched) and run `--apply --replace --yes` on Replace, plain `--apply` on Update only, no sync on Cancel (normal permission flow), with `--tools` only after the user answered yes to the optional-tools question of step 6 (ask it before this step when the preflight shows the CLI or the Python packages absent); migrate an uppercase `.claude/Skills` folder; remind the user to reload if any `SKILL.md` changed. | `references/skills-sync.md` |
| 4 | **Structure** (B/C/new only) — create missing `Testing/` folders; copy `assets/project-learning.template.md` if the learning file is missing, else add missing sections and rename the legacy heading; Mode C first builds and confirms the move plan. | `references/testing-layout.md`, `references/run-modes.md` §4 |
| 5 | **Steering** (B/C/new only) — normalize names, install missing layers from the source repo, seed `README.md` from `assets/steering-readme.template.md`, check L1/L2 stay generic, check the Project Configuration Contract. | `references/steering-governance.md` |
| 6 | **Toolchain + MCP + optional tools** (B/C/new only, and only for rows the preflight shows unhealthy) — Node/NPM/Playwright install or repair; optional tools — playwright-cli for skill 3c and Pillow + numpy for link-qc-6-ui-testing (only when Python exists; the interpreter is never installed): when absent, ask once "install the optional tools (playwright-cli for skill 3c, Pillow + numpy for link-qc-6-ui-testing)? (yes/no)" (recorded as a `[type: qa]` answer, never re-asked; yes → the sync `--tools` step or `toolchain.md`; no → WARN rows stay, 3b unaffected, link-qc-6-ui-testing annotates live pages in the DOM); mention the optional secrets script once, without waiting (`mcp-setup.md` §2b); write or merge `.mcp.json` from `assets/mcp.template.json` — the `azure-devops` entry is the cloud or the self-hosted block per `preflight.azureDevOps.hosting` (git remote → learning file → a User Story URL from the user; `mcp-setup.md` §1b); the optional `figma` entry (link-qc-6-ui-testing, Figma designs only) is added only when the user wants Figma comparison — it needs a Figma login through `/mcp`, never a token in a file (`mcp-setup.md` §2c). When the `azure-devops` entry is written and `pat.persisted` is false, ask the user to run `scripts/set-azure-devops-pat.ps1` in their own terminal, then fully quit and relaunch VS Code, and WAIT (mcp-setup.md §2a); `pat.sessionMissing` afterwards means the restart has not happened yet. Docx MCP: step 3's `sync-qa-skills.mjs --apply` already replaced a legacy `word` entry with `docx`; verify the prerequisites (mcp-setup.md §1a). If a legacy `word` / `office-word-mcp-server` entry is still present (sync ran with `--no-mcp`), tell the user it is superseded and OFFER to remove it — ask, never delete silently. | `references/toolchain.md`, `references/mcp-setup.md` |
| 7 | **Manifest** (B/C/new only) — write `Testing/qa-manifest.json` from `assets/qa-manifest.template.json` with the real paths, steering files, framework and every recorded deviation. | `references/testing-layout.md` |
| 8 | **Validate** — probe attached MCP servers with one cheap read each, then run `node ${CLAUDE_SKILL_DIR}/scripts/validate-setup.mjs --root <project> --pretty --mcp <results> --sync-report <check.json>`. | `references/validation-contract.md` |
| 9 | **Learning file** (B/C/new only) — write what this run learned and every answer under *Setup Model (skill 1)*; Mode A leaves it untouched. | `references/project-learning-protocol.md` |
| 10 | **Report** — the validation table plus changes made, "Would be fixed by B / Needs C" (Mode A), and `USER ACTION REQUIRED`. | `references/output-format.md` |

Load a reference only when its step runs. A healthy project in Mode A needs only
`run-modes.md`, `validation-contract.md` and `output-format.md`.

## Run modes at a glance

| Mode | Trigger | May write |
|------|---------|-----------|
| **New project** | preflight `classification: NEW` | everything in the B column, no question asked except the step-3 replace confirmation |
| **A — Audit** | argument `audit`, or answer A | nothing |
| **B — Repair** | argument `repair`, or answer B | missing folders, missing steering layers + README, name normalizations (steering, skills folder case, legacy learning heading), skills sync, missing `.mcp.json` entries, toolchain repairs, playwright-cli + browser + `.gitignore` line and Pillow + numpy (only after a yes), learning-file sections and Setup Model lines, manifest |
| **C — Restructure** | argument `restructure`, or answer C | everything in B, plus confirmed `git mv` moves and the reference updates they require |

Detailed rules, the mode question text and the Mode C procedure: `references/run-modes.md`.

## Permissions

The front-matter pre-approves only the three read-only script invocations. Every mutation —
`sync-qa-skills.mjs --apply` (with or without `--replace --yes` / `--tools`; `--yes` only after the user answered the replace question), creating folders or files, `npm install`,
`npx playwright install`, `npm install -g @playwright/cli`, `playwright-cli install-browser`,
`pip install pillow numpy`, `git mv`, editing `.mcp.json` or `.gitignore` — goes through the normal permission flow and
happens only in Mode B, Mode C or on a new project. MCP probes are ordinary tool calls.

## Report shape

Use `references/output-format.md`. The validation table is printed exactly as
`validate-setup.mjs` returns it. `USER ACTION REQUIRED` may list only: set the PAT variable
(script + full quit and relaunch of VS Code — never "reconnect" for a new variable), `az login`,
reload the session / approve a server via `/mcp`, fill L3 placeholders or supply a
missing L1/L2 document, restart the PC when the environment demands it, and — optional, skill 3c
only — run the browser secrets script. End with the
learning-file line and the manifest line.

## Downstream contract

Skills 2-11, 3b and 3c read `Testing/qa-manifest.json` for paths first and `Testing/project-learning.md`
for behaviour knowledge; they never invoke this skill themselves. When the manifest is missing
they tell the user to run `/link-qc-1-generate-update-testing-structure` (audit first, then repair).
