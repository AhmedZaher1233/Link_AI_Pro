# Link_AI_Pro — QC Skills for Claude Code

A set of Claude Code skills that take a User Story from **requirement review** to **manual test
cases**, **implementation audit**, **hidden-rule discovery**, **Azure DevOps publishing** and
**Playwright automation**, with every step writing into one shared, plain-English project
knowledge base.

This repository is the **canonical source**. Any project pulls the skills from here with the
`/sync-skills` command; nothing project-specific lives in this repo.

```
.claude/
  skills/
    1-generate-update-testing-structure/   audit / repair / restructure a project's QA foundation
      SKILL.md · INPUT.txt · references/ · scripts/ (preflight, validate-setup, sync-qa-skills) · assets/ (templates)
    2-review-requirements/                 review a story / spec, produce the structured REQ file
    3-generate-manual-test-cases/          design manual TCs (EN + AR), HTML review page, human approval gate
    4-white-box-testing/                   audit the code against the requirement: gaps, bugs, repro scenarios
    5-publish-test-cases-azure/            beautify the approved TCs and publish them to Azure DevOps (ADO-MAP.md)
    6-test-run-automation/                 generate + run Playwright (POM), coverage, reports, DevOps close-out
    7-discover-business-rules/             find rules the code enforces that the spec never states (PO approval gate)
    find-skills/                           helper: discover and install skills from skills.sh
  commands/
    sync-skills.md                         /sync-skills — thin wrapper around scripts/sync-qa-skills.mjs
docs/
  steering/                                L1 / L2 / L3 quality-authority documents copied into projects
```

Every skill folder has a `SKILL.md` (the instructions Claude follows) and an `INPUT.txt`
(what you must provide, what you get back, when to run it). Read `INPUT.txt` first.

---

## Quick start in a new project

1. Install the sync command once (from the project root):

   ```bash
   mkdir -p .claude/commands
   curl -fsSL -o .claude/commands/sync-skills.md https://raw.githubusercontent.com/AhmedZaher1233/Link_AI_Pro/main/.claude/commands/sync-skills.md
   ```

2. In Claude Code run `/sync-skills` — it bootstraps the sync script, copies skills 1–7 into
   `.claude/skills/` and updates itself. Reload the session when it tells you to.
3. Run `/1-generate-update-testing-structure`. On a fresh project it runs the full setup
   without questions. On a project that already has automation it asks for a mode, or you pass
   one: `audit` (zero writes), `repair`, or `restructure` (confirmed move plan). This skill must
   be invoked explicitly; other skills never run it for you.
4. When skill 1 writes the Azure DevOps MCP entry it asks you to run
   `scripts/set-azure-devops-pat.ps1` (or `.sh`) in your own terminal: a hidden prompt takes the
   PAT and stores `AZURE_DEVOPS_PAT_B64 = base64(":" + PAT)` as a user-level environment variable
   on your PC. The token never goes through the chat or into a file.

---

## The flow

```
   spec / story / Word / Azure DevOps
                 │
                 ▼
   ┌──────────────────────────┐
   │ 2  review-requirements   │──► Testing/Requirements/US-{id}-{name}/REQ-*.md + review
   └──────────────────────────┘
                 │
     ┌───────────┼──────────────────────┐
     ▼           ▼                      ▼
┌─────────┐ ┌──────────────┐  ┌────────────────────────┐
│ 4 white │ │ 7 discover   │  │ 3 manual test cases    │──► TEST-CASES-*.md (PENDING HUMAN REVIEW)
│  box    │ │  business    │  │   + HTML review page   │         │ human sets APPROVED
│ (bugs,  │ │  rules       │  └────────────────────────┘         ▼
│  gaps)  │ │ (code→spec)  │                          ┌──────────────────────────┐
└─────────┘ └──────────────┘                          │ 5 publish-test-cases-    │──► *-beautified.md,
     │              │  PO approves → --apply-approved  │   azure (beautify + ADO) │    ADO Test Cases,
     └──────────────┴──────────► REQ delta → 2 → 3    └──────────────────────────┘    ADO-MAP.md
                                                                     │ gate: ADO-MAP.md matches source
                                                                     ▼
                                                      ┌──────────────────────────┐
                                                      │ 6 test-run-automation    │──► Playwright suite,
                                                      │  (Playwright, POM, smoke │    coverage, reports,
                                                      │   gate, live progress)   │    screenshots, close-out
                                                      └──────────────────────────┘
```

All seven skills read `Testing/qa-manifest.json` for paths and `Testing/project-learning.md`
for behaviour knowledge — see below.

---

## Skills

### 1 — generate-update-testing-structure
A compact orchestrator (SKILL.md ≈ 150 lines) over three read-only Node scripts and nine
reference files. `scripts/preflight.mjs` snapshots the original project state and classifies
it NEW or EXISTING before anything is touched; the mode is resolved from that snapshot;
`scripts/validate-setup.mjs` produces the PASS / WARN / FAIL / NOT_RUN table at the end and
never reports PASS for a check that did not run. Run modes on an existing project:
**audit** writes nothing at all and lists what repair would change; **repair** syncs skills
1–7, adds missing folders, steering layers, MCP entries and learning-file sections, normalizes
names (steering files, `.claude/Skills` → `.claude/skills`, legacy learning heading) and writes
the manifest; **restructure** adds a confirmed `git mv` migration to the canonical layout.
Front-matter: `disable-model-invocation: true`, `model: inherit`, and `allowed-tools` limited
to reads plus the three script invocations — every mutation goes through the normal permission
flow. Templates live in `assets/` (learning file, steering README with the single resolution
rule set, manifest, `.mcp.json`).

### 2 — review-requirements
Input: an Azure DevOps story ID, a Word document, pasted text, or a spec file (multi-story
specs are split). Output per story: `REQ-{id}-{name}.md` (structured requirement, the input
for skills 3, 4 and 7) and `US-{id}-review.md` (testability, completeness, clarity,
consistency, feasibility, risk). Multi-story specs also get `SPEC-REVIEW-SUMMARY.md`.

### 3 — generate-manual-test-cases
Designs complete manual test cases (EN + AR) from the REQ file and the learning file, then
uses Playwright MCP to discover the live application (asks for URL and credentials first).
Detects whether the story is implemented before validating. Delivers the markdown TC document
(source of truth, `Status: PENDING HUMAN REVIEW`), a plain-English `TEST-DATA-{feature}.md`
per story (what data the TCs need, whether it exists, how to create what is missing — skill 6
starts its test-data readiness from it) and an HTML review page with a coverage gauge.
**A human must set `Status: APPROVED`** — that unlocks skills 5 and 6.

### 4 — white-box-testing
Stack-agnostic implementation audit. First run profiles the repository (languages,
frameworks, layers, requirement sources) and caches it in
`Testing/White_Box_Testing/.project-profile.md`. Then traces the requirement in code and
reports gaps, potential bugs and reproduction scenarios. Read-only on the codebase.

### 5 — publish-test-cases-azure
Takes the **approved** TC document and **beautifies** it into a separate upload document:
"Validate that / Check that" titles, every Steps block opening with `Login with <role>` and
the navigation journey, the nine canonical step verbs, every `as TC-…` delegation expanded
inline, every step confirmed from page objects, the learning file or the app source
(Playwright MCP only for a genuine gap), and a hard meaning-preservation gate. Then it
**publishes** that document to Azure DevOps as Test Case work items linked to the User Story
with Tested-By, idempotently, `AutomationStatus = Planned`, and writes `ADO-MAP.md` with the
TC-ID → work item map and the source hash. The approved source document is never modified.

### 6 — test-run-automation
Starts only when skill 5 has published **this** version of the approved document
(`ADO-MAP.md` and the beautified file carry the same source hash). Generates Playwright
automation with a mandatory Page Object Model from the original approved document, builds a
per-story run plan (parallel vs serial groups), measures static coverage against the L3
target, resolves test-data readiness with the QC, then runs headed in priority order (smoke
behind a 30 % failure gate, then positive, then negative) with live progress and ETA, takes
a final-state screenshot per TC, and closes the loop in DevOps: `Custom.TestAutomated` and
automated-test metadata on the work items skill 5 created, plus a summary comment, a phase
report and a bug report.

### 7 — discover-business-rules
The reverse direction of skill 4: starting from a story it reads the code and writes every rule
the code **enforces** as an EARS statement with file:line evidence — field limits, formats,
uniqueness, defaults, ranges, state transitions, permissions, duplicate handling, messages,
locale differences. It compares them with the spec and exports the rules that exist **only in
the code** to `Testing/Requirements/US-{id}-{name}/US-{id}-code-rules.md`, one file per story,
with proposed requirement wording and suggested test cases. Findings are **proposals**
(`PENDING PO APPROVAL`): nothing reaches the learning file or the REQ until the QC and Product
Owner fill the decision block and the skill is re-run with `--apply-approved`. If
`Testing/Requirements/` does not exist it asks where to write.
Adapted from [jeffallan/claude-skills@spec-miner](https://github.com/Jeffallan/claude-skills) (MIT).

### find-skills
Helper for discovering and installing community skills from <https://skills.sh/> with
`npx skills find` / `npx skills add`.

---

## Shared conventions

**QA manifest** — `Testing/qa-manifest.json`, written by skill 1 (repair / restructure / new
project, never by audit). Machine-readable structure contract: QA paths, steering file paths,
framework config, documented deviations. Skills 2–7 read it first and fall back to detection
only when it is missing, telling the user to run skill 1.

**Project learning file** — `Testing/project-learning.md`, created by skill 1 from
`assets/project-learning.template.md`. One tagged plain-English line per fact
(`[module: X] [page: Y] [type: rule|qa|data|env|trick|status|bug]`), an `## Index` of modules,
shared sections (Project Knowledge, Common Flows, UI Knowledge, Test Data, Locale Knowledge,
Automation Tricks) and one section per skill with `Knowledge` and `Questions and Answers`.
Every skill greps it **before asking you anything** and writes back what it learned. No secrets,
file paths, selectors or code identifiers ever go in it.

**Steering documents** — `docs/steering/L1-testing-foundation.md` (organization baseline),
`L2-testing-qa-standards.md` (organization implementation standards),
`L3-project-testing.md` (this project's values, stricter constraints, approved exemptions).
One set of **resolution rules**, stated once in `docs/steering/README.md`: L1 is mandatory and
nothing below may weaken it; L2 refines L1; L3 supplies values and may only weaken through an
approved exemption; specs govern business truth, steering governs quality policy, the learning
file overrides neither. L1 and L2 are copied from this repo and never authored by a skill; L3
is a template you fill in.

**Requirement folders** — one folder per User Story: `Testing/Requirements/US-{id}-{kebab-name}/`
holding the REQ file and review (skill 2) and the code-rules export (skill 7).

**Test-case folders** — `Testing/Manual_Test/TestCases/{UserStoryName}/` holding the approved
TC document (skill 3), the beautified upload document and `ADO-MAP.md` (skill 5).

**Human gates** — skill 3's TC document must be approved by a human before skills 5 and 6
run; skill 6 refuses to start until skill 5 has published the current document; skill 7's
findings must be approved by the Product Owner before they become knowledge; skill 1's
restructure needs a confirmed move plan.

**Credentials** — never in files or logs. Azure DevOps uses `AZURE_DEVOPS_PAT_B64`; the app
URL and test users are asked for at run time and stored only as non-secret facts.

---

## MCP servers the skills use

| Server | Used by | Purpose |
|---|---|---|
| Playwright MCP | 3, 5 (gap-filler only), 6 | live application discovery and automation |
| Azure DevOps MCP | 2, 3, 5, 6, 7 | read User Stories, publish Test Cases, update automation fields, comment results |
| Word MCP | 2, 3 | read requirement and test-case documents |

Skill 1 writes `.mcp.json` from `assets/mcp.template.json` and validates each server.

---

## Keeping projects up to date

```
/sync-skills                            # all skills + the command itself
/sync-skills 6-test-run-automation      # one skill
/sync-skills --dry-run                  # read-only check, nothing copied
/sync-skills --force                    # overwrite locally edited skill files
```

The command is a wrapper around `scripts/sync-qa-skills.mjs` (`--check` / `--apply`). It never
touches anything outside `.claude/skills/` and `.claude/commands/sync-skills.md`, never deletes
local-only files, and skips locally edited files unless `--force` is given.

**Upgrading a project set up before September 2026:** run `/sync-skills` (it migrates
`.claude/Skills` to `.claude/skills`), then `/1-generate-update-testing-structure audit` to see
what changed, then `repair`. Repair renames the learning-file heading
`### Automation Model (skill 5)` to `(skill 6)`, adds the `Publish Model (skill 5)` section,
seeds the steering README with the single resolution rule set, and writes the manifest.

---

## Contributing

Edit the skill in this repository, keep `SKILL.md` and `INPUT.txt` in step, and update
`scripts/lib.mjs` (skill list), skill 1's references and `sync-skills.md` when a skill is added
or renamed. Skill front-matter needs `name`, `description` (this is what triggers the skill —
keep the trigger phrases) and, where useful, `argument-hint`. Skills with side effects set
`disable-model-invocation: true`. Commit, push to `main`, and every project picks the change
up on its next `/sync-skills`.
