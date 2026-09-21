# CLAUDE.md

Guidance for Claude Code when working **inside this repository**.

## What this repo is

`Link_AI_Pro` is the **canonical source** for a suite of Claude Code QA skills that carry a User
Story from requirement review → manual test cases → implementation audit → Azure DevOps
publishing → Playwright automation. It contains **no application code, no package.json, no build
and no test suite** — the deliverable is prompt/instruction content plus eight zero-dependency
Node scripts (five under skill 1, three under skill 6).

Consumer projects pull the skills from here with `/sync-skills`. Nothing project-specific ever
belongs in this repo.

**Two worlds — don't confuse them:**

| | This repo (authoring) | A consumer project (runtime) |
|---|---|---|
| Content | `.claude/skills/`, `.claude/commands/`, `docs/steering/` | `Testing/`, `docs/steering/`, `.mcp.json`, synced `.claude/skills/` |
| Your job here | edit skill instructions, scripts, templates | run the skills |

Paths like `Testing/qa-manifest.json`, `Testing/project-learning.md`,
`Testing/Requirements/US-{id}-{name}/` described throughout the skills refer to the **consumer
project**, not to this repo. Do not create them here.

## Layout

```
.claude/
  skills/
    1-generate-update-testing-structure/   QA foundation: audit / repair / restructure
      SKILL.md INPUT.txt references/ (9) scripts/ (5) assets/ (4 templates)
    2-review-requirements/                 story/spec → REQ-*.md + review
    3-generate-manual-test-cases/          manual TCs (EN/AR) + HTML review page (human gate)
    4-white-box-testing/                   code audit against a requirement
    5-publish-test-cases-azure/            beautify approved TCs → Azure DevOps + ADO-MAP.md
    6-test-run-automation/                 Playwright POM generation + phased run + 2 compliance gates
      SKILL.md INPUT.txt references/ (3) scripts/ (3 + fixtures/) assets/ (1)
    7-discover-business-rules/             code-enforced rules (EARS) not in the spec
    find-skills/ i-have-adhd/              helper skills (not part of the 1-7 sync set)
  commands/sync-skills.md                  thin wrapper over scripts/sync-qa-skills.mjs
  agents/                                  empty
docs/steering/                             L1 / L2 / L3 quality-authority documents
README.md                                  the full user-facing documentation — keep it current
```

Every skill folder has `SKILL.md` (what Claude follows) and `INPUT.txt` (what the user must
provide / gets back). Read `README.md` for the pipeline diagram and the shared conventions; it is
the most complete description of the system and is treated as part of the product.

## Scripts

Node ≥ 18, ESM, zero dependencies, read-only, result returned as a JSON payload (`--pretty` for
human output). Skill 1 owns the project-setup scripts; skill 6 owns the automation-code validator.

### `skills/1-generate-update-testing-structure/scripts/`

All three `.mjs` entry points always exit 0 — the result lives in the payload.

```bash
node .claude/skills/1-generate-update-testing-structure/scripts/preflight.mjs      --root <project> --pretty
node .claude/skills/1-generate-update-testing-structure/scripts/validate-setup.mjs --root <project> --pretty [--mcp k=PASS,…] [--sync-report x.json]
node .claude/skills/1-generate-update-testing-structure/scripts/sync-qa-skills.mjs --check|--apply --pretty [--target <dir>] [--only <skill>]… [--force] [--no-mcp] [--branch main]
```

- `lib.mjs` holds every shared scanner and **all the canonical constants** (`SKILLS`,
  `TESTING_FOLDERS`, `STEERING_CANONICAL`, `LEARNING_*`, `MCP_REQUIRED`, `DOCX_*`, `MANIFEST`).
  Change a name there first, then everywhere it is echoed in prose.
- `sync-qa-skills.mjs` **refuses to run when the git origin is this repo** — use `git pull` here.
  It is the single implementation of sync; `sync-skills.md` must stay a wrapper and never
  re-describe the algorithm in prose.
- `set-azure-devops-pat.ps1` / `.sh` are run by the *user* in their own terminal; they store
  `AZURE_DEVOPS_PAT_B64 = base64(":" + PAT)` as a user-level env var. Never handle the token.

### `skills/6-test-run-automation/scripts/`

```bash
node .claude/skills/6-test-run-automation/scripts/validate-automation.mjs --root <project> --pretty [--files a,b] [--tc-ids <csv|file>] [--req-ids <csv|file>] [--strict]
node .claude/skills/6-test-run-automation/scripts/selftest.mjs --pretty
```

- `scan-lib.mjs` is the text engine (comment/string stripper that preserves line numbers, brace
  balancing, relative-import resolution, sha256). It is **self-contained** — never import skill
  1's `lib.mjs` across skill folders, because `/sync-skills` copies one skill folder at a time;
  `parseArgs` and `print` are copied verbatim and must stay behaviourally identical.
- `validate-automation.mjs` is a **screen, not a judge**. It is deliberately not a parser: what a
  token scan cannot decide is emitted at severity `review` and left to semantic review, never
  guessed. Default exit 0; `--strict` maps the gate (FAIL 1 · BLOCKED 2 · NOT_RUN 3) for CI.
  Rule ids, the exemptible/non-exemptible split and the documented limits live in
  `references/validator.md` — change them together.
- `selftest.mjs` **exits non-zero on mismatch by design** (it is a harness, not a reporting
  script). Run it after any validator change. Its twelve fixtures include the false-PASS guards;
  when adding a rule, add the fixture case with it.

## Conventions to keep

**Skill front-matter** needs `name` and `description`. The `description` is the trigger — keep its
trigger phrases when editing, and keep it in step with `INPUT.txt`. Add `argument-hint` where
useful, `model: claude-opus-5` where the skill already sets it, and
`disable-model-invocation: true` for skills with side effects (1, i-have-adhd). Skill 1's
`allowed-tools` pre-approves only the three read-only script invocations — every mutation must go
through the normal permission flow.

**When adding or renaming a skill**, update all of: `scripts/lib.mjs` (`SKILLS`), the skill's own
`SKILL.md` + `INPUT.txt`, skill 1's `references/`, `.claude/commands/sync-skills.md`, and
`README.md`.

**When changing skill 6's compliance rules**, keep these four in step: the `<checkpoint_a>` /
`<checkpoint_b>` blocks and `<quality_checklist>` in `SKILL.md`, the derived checklist in
`references/compliance-checkpoints.md`, the rule catalogue in `scripts/validate-automation.mjs`
(`RULES` + `LIMITS`) and its mirror in `references/validator.md`. A new rule needs a
`scripts/fixtures/` case and a `selftest.mjs` expectation, or it is unverified.

**Progressive disclosure.** `SKILL.md` stays compact and delegates detail to `references/*.md`
loaded per step (skill 1 ≈ 110 lines over 9 references). Don't inline reference content back into
a SKILL.md.

**Hard rules the skills encode** (preserve them when editing):
- Human gates: skill 3's TC doc needs `Status: APPROVED` before 5/6; skill 7's findings need PO
  approval + `--apply-approved`; skill 1 Mode C needs a confirmed move plan. **Skill 5 is NOT a
  gate for skill 6** — `ADO-MAP.md` at a matching source hash only switches skill 6 from `local`
  to `linked`; keep skills 5 and 6 saying the same thing about this.
- Skill 6 enforces **two machine gates**: `<checkpoint_a>` before execution and `<checkpoint_b>`
  on the final code, both of which must PASS for the delivered scope. The scanner gate is not the
  compliance gate — open `review[]` / `notRun[]` items must be closed by semantic review or the
  checkpoint is BLOCKED.
- Never report PASS for a check that did not run — unprobed items are `NOT_RUN` (skill 1) or
  `unresolved` / `N/A + reason` (skill 6). This applies to both validators and to every checklist.
- No secrets in files, logs, chat or the learning file.
- Skills 2/4/7 are read-only on source code and never modify specs.
- The `docx` MCP entry **must** carry `--with mcp<2`; unpinned `mcp` 2.x crashes the server on
  import. The legacy `word` server (`office-word-mcp-server`) is superseded and migrated by sync.

## Known state / quirks

- `docs/steering/` here holds the source documents under **non-canonical filenames**
  (`L1-testing-foundation-v1.1 1.md`, `L2-Testing-QA-Standards-v2.md`,
  `L3-final-integration-testing 2.md`). Skill 1 renames them to
  `L1-testing-foundation.md` / `L2-testing-qa-standards.md` / `L3-project-testing.md` in the
  consumer project. There is no `docs/steering/README.md` here — the template lives at
  `skills/1-.../assets/steering-readme.template.md`.
- L1 and L2 must stay product-generic; `validate-setup.mjs` flags product tokens in them.
- `.claude/agents/` is empty (a second working directory of agents may be attached to a session;
  it is not part of this repo).

## Git

Branch `main`; commit and push only when asked. Projects pick changes up on their next
`/sync-skills`, so a push here is effectively a release — make sure `SKILL.md`, `INPUT.txt`,
`lib.mjs` and `README.md` are consistent before committing.
