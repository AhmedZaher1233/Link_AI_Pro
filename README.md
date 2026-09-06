# Link_AI_Pro — QC Skills for Claude Code

A set of Claude Code skills that take a User Story from **requirement review** to **manual test
cases**, **implementation audit**, **hidden-rule discovery**, **Azure DevOps publishing** and
**Playwright automation**, with every step writing into one shared, plain-English project
knowledge base.

This repository is the **canonical source**. Any project pulls the skills from here with the
`/sync-skills` command; nothing project-specific lives in this repo.

```
.claude/
  Skills/
    1-generate-update-testing-structure/   set up (or health-check) a project's testing environment
    2-review-requirements/                 review a story / spec, produce the structured REQ file
    3-generate-manual-test-cases/          design manual TCs (EN + AR), HTML review page, human approval gate
    4-white-box-testing/                   audit the code against the requirement: gaps, bugs, repro scenarios
    5-publish-test-cases-azure/            beautify the approved TCs and publish them to Azure DevOps (ADO-MAP.md)
    6-test-run-automation/                 generate + run Playwright (POM), coverage, reports, DevOps close-out
    7-discover-business-rules/             find rules the code enforces that the spec never states (PO approval gate)
    find-skills/                           helper: discover and install skills from skills.sh
  commands/
    sync-skills.md                         /sync-skills — pull the latest skills into any project
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

2. In Claude Code run `/sync-skills` — it copies skills 1–7 into `.claude/Skills/` and
   updates itself. Reload the session when it tells you to.
3. Run skill 1 (`/1-generate-update-testing-structure`). On a fresh project it creates the
   whole layout without questions. On a project that already has automation it asks whether
   you want **A** a health-check, **B** an update/repair, or **C** a restructure.
4. Set the Azure DevOps token as an environment variable (never in a file):
   `AZURE_DEVOPS_PAT_B64 = base64(":" + PAT)`.

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

All seven skills read and write `Testing/project-learning.md` — see below.

---

## Skills

### 1 — generate-update-testing-structure
Scans the project, then creates or validates: `Testing/` (Requirements, Manual_Test,
Automation, White_Box_Testing, `project-learning.md`), `docs/steering/` (L1/L2/L3 with
canonical names), Node/NPM, Playwright, `.mcp.json` (Playwright, Azure DevOps, Word MCP) and
the skills themselves. Ends with a PASS/FAIL health-check table.
Run modes on an existing project: **A** health-check only (writes nothing), **B** update
skills and repair what is missing, **C** restructure to the canonical layout after you confirm
a move plan. Missing skills are always downloaded from this repo, in every mode.

### 2 — review-requirements
Input: an Azure DevOps story ID, a Word document, pasted text, or a spec file (multi-story
specs are split). Output per story: `REQ-{id}-{name}.md` (structured requirement, the input
for skills 3, 4 and 7) and `US-{id}-review.md` (testability, completeness, clarity,
consistency, feasibility, risk). Multi-story specs also get `SPEC-REVIEW-SUMMARY.md`.

### 3 — generate-manual-test-cases
Designs complete manual test cases (EN + AR) from the REQ file and the learning file, then
uses Playwright MCP to discover the live application (asks for URL and credentials first).
Detects whether the story is implemented before validating. Delivers the markdown TC document
(source of truth, `Status: PENDING HUMAN REVIEW`) plus an HTML review page with a coverage
gauge. **A human must set `Status: APPROVED`** — that unlocks skills 5 and 6.

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
(Playwright MCP only for a genuine gap), and a hard meaning-preservation gate (same TC count,
same IDs, same expected results). Then it **publishes** that document to Azure DevOps as Test
Case work items linked to the User Story with Tested-By, idempotently (re-runs update, never
duplicate), `AutomationStatus = Planned`, and writes `ADO-MAP.md` with the TC-ID → work item
map and the source hash. The approved source document is never modified.

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
The reverse direction of skill 4: starting from a story it reads the code (validators,
entities, migrations, services, guards, UI forms) and writes every rule the code **enforces**
as an EARS statement with file:line evidence — field limits, formats, uniqueness of
names/codes/IDs, defaults, ranges, state transitions, permissions, duplicate handling,
messages, locale differences. It compares them with the spec and exports the rules that exist
**only in the code** to `Testing/Requirements/US-{id}-{name}/US-{id}-code-rules.md`, one
file per story, with proposed requirement wording and suggested test cases.
Findings are **proposals** (`PENDING PO APPROVAL`): nothing reaches the learning file or the
REQ until the QC and Product Owner fill the decision block and the skill is re-run with
`--apply-approved`. If `Testing/Requirements/` does not exist it asks where to write.
Adapted from [jeffallan/claude-skills@spec-miner](https://github.com/Jeffallan/claude-skills) (MIT).

### find-skills
Helper for discovering and installing community skills from <https://skills.sh/> with
`npx skills find` / `npx skills add`.

---

## Shared conventions

**Project learning file** — `Testing/project-learning.md`, created by skill 1. One tagged
plain-English line per fact (`[module: X] [page: Y] [type: rule|qa|data|env|trick|status]`),
an `## Index` of modules, shared sections (Project Knowledge, Common Flows, UI Knowledge,
Test Data, Locale Knowledge, Automation Tricks) and one section per skill with `Knowledge`
and `Questions and Answers` (Setup, Requirements Review, Manual TC, White-Box, Publish,
Automation, Rule Discovery). Every skill greps it **before asking you anything** and writes
back what it learned and what you answered. No secrets, file paths, selectors or code
identifiers ever go in it. Specs and steering documents always win over it.

**Steering documents** — `docs/steering/L1-testing-foundation.md` (org-wide),
`L2-testing-qa-standards.md` (cross-project), `L3-project-testing.md` (this project's values:
URLs, roles, SLAs, coverage targets). Skills resolve rules in the order L1 > L2 > L3 >
CLAUDE.md > skill rules > learning file. L1 and L2 are copied from this repo and never
authored or edited by a skill; L3 is a template you fill in. Skill 1 normalizes non-canonical
file names (copy suffixes such as ` 1`, ` (1)`) when it installs them.

**Requirement folders** — one folder per User Story: `Testing/Requirements/US-{id}-{kebab-name}/`
holding the REQ file (skill 2), the review (skill 2) and the code-rules export (skill 7).

**Test-case folders** — `Testing/Manual_Test/TestCases/{UserStoryName}/` holding the approved
TC document (skill 3), the beautified upload document and `ADO-MAP.md` (skill 5).

**Human gates** — skill 3's TC document must be approved by a human before skills 5 and 6
run; skill 6 refuses to start until skill 5 has published the current document; skill 7's
findings must be approved by the Product Owner before they become knowledge.

**Credentials** — never in files or logs. Azure DevOps uses `AZURE_DEVOPS_PAT_B64`; the app
URL and test users are asked for at run time and stored only as non-secret facts.

---

## MCP servers the skills use

| Server | Used by | Purpose |
|---|---|---|
| Playwright MCP | 3, 5 (gap-filler only), 6 | live application discovery and automation |
| Azure DevOps MCP | 2, 3, 5, 6, 7 | read User Stories, publish Test Cases, update automation fields, comment results |
| Word MCP | 2, 3 | read requirement and test-case documents |

Skill 1 writes `.mcp.json` and validates each server.

---

## Keeping projects up to date

```
/sync-skills                            # all skills + the command itself
/sync-skills 6-test-run-automation      # one skill
/sync-skills --dry-run                  # show what would change
/sync-skills --force                    # overwrite locally edited skill files
```

The command never touches anything outside `.claude/Skills/` and `.claude/commands/sync-skills.md`.
Locally edited skill files are skipped unless `--force` is given.

**Upgrading a project set up before the publish/automation split:** run `/sync-skills`, then
skill 1 in mode B. The learning-file heading `### Automation Model (skill 5)` is renamed to
`(skill 6)` in place and a `### Publish Model (skill 5)` section is added; the old
`5-test-run-automation` folder is reported as local-only and can be deleted.

---

## Contributing

Edit the skill in this repository, keep `SKILL.md` and `INPUT.txt` in step, and update skill 1
and `sync-skills.md` when a skill is added or renamed. Skill front-matter needs `name`,
`description` (this is what triggers the skill — keep the trigger phrases) and, where useful,
`argument-hint`. Commit, push to `main`, and every project picks the change up on its next
`/sync-skills`.
