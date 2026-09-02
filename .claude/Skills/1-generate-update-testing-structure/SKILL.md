---
name: generate-update-testing-structure
model: claude-opus-5
description: >
  Generate Testing Structure — QA Automation Project Configuration. Scans the existing
  project first (folders, package.json, Playwright config, MCP/.claude config, existing
  pages/tests/reports), then prepares a complete testing environment compatible with the
  Spec Development flow: a Testing/ root containing Requirements/, Manual_Test/TestCases/,
  Automation/ (pages, tests, reports, screenshots), and White_Box_Testing/; a docs/steering/
  root holding the L1/L2/L3 steering documents every QA skill reads as its quality
  authority (canonical file names, generic L1/L2, project values only in L3);
  Node.js + NPM validation,
  Playwright install + config, and Playwright/Azure/Word MCP configuration with a full
  health-check validation report. Never overwrites or duplicates a valid existing
  structure; never hardcodes credentials or PATs. Use once per project (or on
  environment drift) BEFORE spec-driven test design/automation agents run.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, mcp__playwright, mcp__azure-devops
---

<role>
You are acting as a **QA Automation Project Configuration Agent**.

Your responsibility is to inspect the existing project, understand its current structure
and technology stack, and prepare a complete testing environment **based on the
provided Spec Development structure**.

You must work carefully and must **not overwrite or recreate existing structures
unnecessarily**.
</role>

---

## 0. Sync the Latest Skills from the Source Repository (ALWAYS FIRST)

Before scanning or changing anything, refresh the local skill set from the canonical
source repository so every run uses the latest versions of skills 1-5:

```text
https://github.com/AhmedZaher1233/Link_AI_Pro
```

Procedure:

1. Fetch the latest `.claude/Skills/` tree from the repository's `main` branch. Prefer a
   sparse clone into a temporary folder:

   ```bash
   git clone --depth 1 --filter=blob:none --sparse https://github.com/AhmedZaher1233/Link_AI_Pro.git <tmp>
   git -C <tmp> sparse-checkout set .claude/Skills
   ```

   If `git` is unavailable, download the raw files from
   `https://raw.githubusercontent.com/AhmedZaher1233/Link_AI_Pro/main/.claude/Skills/...`.
2. Compare each remote skill folder (`1-generate-update-testing-structure`,
   `2-review-requirements`, `3-generate-manual-test-cases`, `4-white-box-testing`,
   `5-test-run-automation`) against the project's local `.claude/Skills/`.
3. Copy new or changed skill files into the project's `.claude/Skills/`.
4. If the repository also carries a `docs/steering/` tree, sparse-checkout it in the same
   clone (`git -C <tmp> sparse-checkout set .claude/Skills docs/steering`) and leave it in
   the temp folder — it is the preferred source for Section 2A. Do **not** copy steering
   files here; Section 2A owns their naming, their generic-vs-project check, and the
   never-overwrite rule.
5. Skills are the only files updated by this step — never touch agents, steering documents,
   `.mcp.json`, tests, or app code here.
6. Report which skills were added, updated, or already current. If the repository cannot
   be reached (offline, no access), say so explicitly and continue with the local copies —
   Section 2A then falls back to its other sources.
7. If this skill's own `SKILL.md` was updated, tell the user to reload the Claude Code
   session so the new version is used, then continue.

---

## 1. Scan and Understand the Existing Project

Start by scanning the entire project/repository.

Inspect:

* Project folders
* Existing testing/automation folders
* Existing test files
* Existing Playwright configuration
* `package.json`
* `package-lock.json`
* Node.js configuration
* TypeScript configuration
* Existing MCP configuration
* `.claude` configuration
* Existing pages
* Existing test/spec files
* Existing reports
* Existing screenshots
* Any existing QA/automation documentation
* An existing `docs/steering/` tree (L1/L2/L3 steering documents) — including files whose
  names carry copy/version suffixes such as `... 1.md`, `... 2.md`, `... (1).md`
* Any existing `project-config.md`, `tech-spec.md`, or `traceability-matrix.md`
* Any existing project naming conventions
* An existing `Testing/project-learning.md` (shared knowledge base) or a legacy
  `.planning/project-learning.md`

Determine:

1. Whether a testing/automation structure already exists.
2. What automation framework is currently being used.
3. Whether Playwright is already installed.
4. Whether Node.js is installed.
5. Whether MCP configuration already exists.
6. Whether Azure MCP is already configured.
7. Whether Word MCP is already configured.
8. Whether the project already follows a different automation structure.
9. Whether `docs/steering/` exists, which of the L1/L2/L3 layers are present, whether the
   file names are canonical (Section 2A.1), and whether any file sitting at L1/L2 is in
   fact product-specific (Section 2A.5).

### Important

**Do not delete or replace existing automation files without first understanding their
purpose.**

If a valid testing structure already exists, reuse and improve it instead of creating
a duplicate structure.

---

## 2. Create Testing Structure

The complete structure this skill delivers has two roots: `Testing/` (test assets, this
section) and `docs/steering/` (the L1/L2/L3 quality authority, Section 2A). Both must
exist before any later QA skill runs.

If there is **no proper testing structure**, create one.

The testing root folder must be named:

```text
Testing
```

Inside `Testing/`, four sibling folders live at the same level, in this order:

1. `Requirements/` — requirement documents, specs, and traceability inputs
2. `Manual_Test/` — manual testing assets, with `TestCases/` under it
3. `Automation/` — E2E/UI automation (Playwright)
4. `White_Box_Testing/` — white box tests (unit/integration-level test assets and docs)

Inside the automation folder, use the project name as the project identifier where
appropriate.

Create the following structure:

```text
Testing/
├── project-learning.md      ← shared knowledge base for all QA skills (see below)
├── Requirements/
├── Manual_Test/
│   └── TestCases/
├── Automation/
│   ├── pages/
│   ├── tests/
│   ├── reports/
│   ├── screenshots/
│   └── automation-logs/
└── White_Box_Testing/
```

The purpose of each folder is:

### `Testing/Requirements/`

Holds requirement inputs for the testing flow: user stories, acceptance criteria,
spec documents, REQ-ID catalogues, and traceability material consumed by test design
agents.

Contents are organized **one folder per User Story** (written by the
`2-review-requirements` skill):

```text
Testing/Requirements/
  US-{id}-{kebab-name}/
    REQ-{id}-{name}.md      ← structured requirement
    US-{id}-review.md       ← requirement review
  SPEC-REVIEW-SUMMARY.md    ← cross-story findings for multi-story specs
```

Do not author requirement content during setup — create the empty folder (with a short
`README.md` describing its purpose if the project has no conventions yet).

### `Testing/Manual_Test/`

Holds manual testing assets.

Its `TestCases/` subfolder holds human-readable manual test case documents (the output
of test design agents) and their review pages.

Do not author test cases during setup — create the empty `Manual_Test/TestCases/`
structure only.

### `Testing/Automation/pages/`

Contains Page Object Model files.

Examples:

```text
Testing/Automation/pages/LoginPage.ts
Testing/Automation/pages/DashboardPage.ts
Testing/Automation/pages/StrategyPage.ts
```

Do not create fake page implementations if the application has not yet been analyzed.

Create only the required base structure and configuration unless the Spec Development
explicitly requires specific pages.

### `Testing/Automation/tests/`

Contains Playwright automation tests.

Organize tests according to the project's specification structure.

Example:

```text
Testing/Automation/tests/
├── login/
├── strategy/
├── objective/
└── kpi/
```

Do not invent test cases.

The structure should support tests that will later be generated from the project
specifications.

### `Testing/Automation/reports/`

Used for generated automation reports and run-of-record results, organized per
User Story with immutable phase history (see the `test-automation` skill):

```text
reports/US-{UserStoryID}/phase-1.json · phase-1.html · phase-2.json · …
```

Configure Playwright so that reports can be generated into this location where
technically appropriate.

### `Testing/Automation/screenshots/`

Used for screenshots captured during test execution. The automation skill creates one
sub-folder per User Story (same name as the story's folder under
`Manual_Test/TestCases/`) holding `{TC-ID}.png` for every executed TC and
`{TC-ID}-failed.png` for failures; a re-run replaces these images.

Create the empty folder only. Configure Playwright to store its own failure attachments
here where technically appropriate.

### `Testing/Automation/automation-logs/`

Live run-progress logs written by the `test-automation` skill, organized per
User Story, one new file per run, historical logs never overwritten:

```text
automation-logs/US-{UserStoryID}/run-progress-{YYYY-MM-DD-HHmm}.log
```

Create the empty folder only — logs are produced at run time.

### `Testing/White_Box_Testing/`

Holds white box testing assets: unit/integration test plans, code-coverage analysis,
and internal-logic test documentation.

Do not generate white box tests during setup — create the folder structure only.

### `Testing/project-learning.md` — shared project knowledge base

One plain-English file, directly under `Testing/`, that every QA skill (1-5) reads
**before asking the QC/user anything** and updates **after learning anything**. It holds
what the team learns about the system (modules, rules, roles, screens, flows, test data,
EN/AR differences) and the automation tricks that work in this app — separated per model
(one section per skill), each with its own `Knowledge` and `Questions and Answers`.

**Create it only if it is missing.** If it exists, never delete or rewrite content: only
verify the `## Index`, the shared sections, and the five model subsections exist, and add
any that are missing. If a legacy `.planning/project-learning.md` exists and the new file
does not, move its content under the matching sections of the new file and tell the user.

Seed the file with exactly this skeleton (replace `{project name}` only):

```markdown
# Project Learning — {project name}
<!-- Shared knowledge base for all QA skills (skills 1-5). Read before asking; update after learning.
     One tagged line per fact, plain English. Never store credentials, tokens or secrets here.
     Specs and steering documents always win over this file. -->

## Index
| Module | Pages | Similar to | Sections that mention it |
|---|---|---|---|

## Project Knowledge
<!-- system overview, environments + base URLs, roles, modules, business rules learned, glossary -->

## Common Flows
<!-- how to reach each screen: sign in → menu → page → panel -->

## UI Knowledge
<!-- how controls behave: waits, dialogs, validation messages, sorting, paging -->

## Test Data
<!-- seeded entities, valid / invalid samples, boundaries — no credentials -->

## Locale Knowledge
<!-- EN / AR label differences, RTL quirks, date and number formats -->

## Automation Tricks
<!-- how elements are identified, waits that work, environment quirks, run slicing, VPN / proxy notes -->

## Model Notes

### Setup Model (skill 1)
#### Knowledge
#### Questions and Answers

### Requirements Review Model (skill 2)
#### Knowledge
#### Questions and Answers

### Manual TC Model (skill 3)
#### Knowledge
#### Questions and Answers

### White-Box Model (skill 4)
#### Knowledge
<!-- which business area each feature belongs to, rules the code enforces (in words), where checks happen, bug patterns; link to White_Box_Testing/.project-profile.md -->
#### Questions and Answers

### Automation Model (skill 5)
#### Knowledge
<!-- pages that already have page objects (page names only), how to run, environment presets, heal patterns -->
#### Questions and Answers
```

**Entry format (every line in every section):** one fact per line, starting with tags so a
grep on a tag finds it without reading the file:

```markdown
- [module: Strategy] [page: KPI Details] [element: Year filter] [type: flow] To see yearly KPI numbers: open the strategy, open its objective, pick the KPI, then choose the year at the top right.
- [module: Strategy] [page: KPI Details] [type: rule] A KPI cannot be closed while it still has open initiatives. (source: US-1234 AC-3)
- [module: Login] [page: Sign in] [element: Password field] [type: ui] After 5 wrong passwords the account is locked for 15 minutes.
- [module: Strategy] [similar: Objective, Initiative] [type: ui] Strategy, Objective and Initiative share the same list page: same filters, same table, same export button.
- [module: Login] [type: qa] **Q (skill 3, 2026-09-02):** Which URL is the test environment? — **A:** the UAT site (recorded under Project Knowledge).
```

Tag keys (fixed, lowercase): `module:` (always), `page:`, `element:`, `type:` one of
`flow | rule | ui | data | locale | trick | qa | env`, `similar:` (other modules / pages /
elements that behave the same — lets a skill reuse knowledge instead of re-discovering),
and `(source: …)` in the text when known.

**Content rules:** written for a QC who has never seen the code. Never write method,
class, function or file names, variables, CSS/XPath selectors, code snippets, stack traces,
secrets, or requirement text copied verbatim (record the learned rule and its source
instead). The only technical tokens allowed are `data-testid` values and URLs, only under
`Automation Tricks` / `Automation Model`, each explained in words on the same line.

---

## 2A. Create the Steering Documents Structure (`docs/steering/`)

Every QA skill (1-5) reads its quality standards from the project's **steering
documents**. They outrank `CLAUDE.md`, the skills' own rules, and the learning file, so
the testing structure is not complete until they exist, are correctly named, and are
discoverable by a plain glob.

### 2A.1 Location and canonical file names

The steering root is `docs/steering/` at the project root. One file per authority layer:

```text
docs/
└── steering/
    ├── README.md                      ← index: what each layer holds + resolution order
    ├── L1-testing-foundation.md       ← L1 — organization-wide principles (GENERIC)
    ├── L2-testing-qa-standards.md     ← L2 — cross-project standards & checklists (GENERIC)
    └── L3-project-testing.md          ← L3 — THIS project's config, SLAs, thresholds
```

Naming rules — every later skill globs `docs/steering/*` and some reference layers by
name, so names must be predictable:

* Lowercase kebab-case, `.md` extension, prefixed with its layer (`L1-`, `L2-`, `L3-`).
* **No spaces**, no `(1)`, no trailing ` 1` / ` 2` copy suffixes, and no version number in
  the file name — the version lives in the document's header table, not in its name.
* Exactly one file per layer. Two L1 files means an ambiguous authority — merge or archive.
* Any additional steering file must be layer-prefixed too (e.g. `L2-api-standards.md`).

### 2A.2 Check what already exists

Read `docs/steering/` before touching it. For each file found, record: which layer it
declares in its header, whether it is non-empty and readable, and whether its name is
canonical.

**If a valid steering document already exists for a layer, never overwrite it.** Same
rule as the QA agent definitions (Section 9).

### 2A.3 Normalize non-canonical file names

If a file is valid but its name breaks 2A.1, rename it — content untouched:

```bash
git mv "docs/steering/L1-testing-foundation-v1.1 1.md" docs/steering/L1-testing-foundation.md
git mv "docs/steering/L3-final-integration-testing 2.md" docs/steering/L3-project-testing.md
```

Use `git mv` in a git repo (plain `mv` otherwise) so history is preserved. After renaming,
grep the repository for the old paths (`.claude/Skills/**`, `CLAUDE.md`, other steering
documents' "Related Documents" appendices) and update every reference. Report every rename
and every reference updated. **Never rename a file whose new name would collide with an
existing one** — report the collision and stop.

### 2A.4 Install missing steering documents

If a layer is missing, find its source in this order:

1. A source path explicitly provided by the user.
2. The `docs/steering/` tree fetched in Step 0 from
   `https://github.com/AhmedZaher1233/Link_AI_Pro`.
3. Another steering location already present in the repository or workspace.
4. The user's Downloads folder.

Copy the file into `docs/steering/` under its canonical name.

#### Critical rule

**Never author L1 or L2 from scratch.** They are organization-wide authority documents
owned by the Engineering Lead / QA Chapter. This skill only finds, copies, renames, and
validates them. If a layer cannot be found anywhere, report it under
`USER ACTION REQUIRED` — do not write a substitute, a summary, or a placeholder standard.

L3 is the exception in one direction only: an L3 **template** may be copied and left with
its `[placeholder]` values intact. This skill never invents L3 values — no SLA numbers, no
locale list, no browser matrix, no coverage thresholds. Unknown values stay as
`[placeholder]` or `PENDING — [owner] by [date]` for the QA Lead to fill in.

### 2A.5 L1 and L2 must stay generic — project detail belongs in L3

L1 and L2 apply to every project in the organization. Scan each L1/L2 file for
product-specific content: application or repository names, concrete module/entity names,
framework or auth-provider names, real endpoint paths, database identifiers, regexes tied
to one domain's data, or known-issue notes about a specific codebase.

If a file sitting at L1/L2 is in fact product-specific, it is not steering at that layer:

* **Do not delete it and do not rewrite it.**
* Report it as a finding, naming the file and quoting the project-specific lines.
* Propose the split: its generic rules fold into the matching L1/L2 section, and its
  project-specific rules move to L3 or to a clearly non-steering location such as
  `docs/project-rules/`.
* Apply the move only with explicit user confirmation, then update every reference to it.

The same test applies in reverse: a value that varies per project (locale set, SLA, browser
matrix, coverage threshold, file-size limit) must not be hardcoded into L1 or L2 — it
belongs to the L2 §0 Project Configuration Contract and is resolved in L3.

### 2A.6 The Project Configuration Contract

L2 §0 requires a populated `/project-config.md` before any checklist may run, and the L3
document normally declares itself to be that file. Confirm which one this project uses:

* **L3 fulfils it** (the common case) — no separate file. Verify that L3's configuration
  section actually exists, and record in the report how many keys are still
  `[placeholder]`.
* **A standalone `project-config.md`** — verify it sits where L2 expects it and that L3
  points at it.

Never populate the contract yourself. Report unfilled keys under `USER ACTION REQUIRED`,
because L2 §17.8 makes an incomplete contract a QA blocker for skills 3 and 5.

### 2A.7 Seed `docs/steering/README.md`

This index is the one steering file this skill may author, because it only describes what
is present. Create it if missing (never overwrite an existing one):

```markdown
# Steering Documents

Quality authority for this project. Every QA skill reads these before test design,
automation, or execution.

| Layer | File | Authority | Owner |
|-------|------|-----------|-------|
| L1 | [L1-testing-foundation.md](L1-testing-foundation.md) | Organization-wide principles and minimum requirements | Engineering Lead / QA Chapter |
| L2 | [L2-testing-qa-standards.md](L2-testing-qa-standards.md) | Cross-project standards, checklists, and the Project Configuration Contract | QA Chapter |
| L3 | [L3-project-testing.md](L3-project-testing.md) | This project's configuration, SLAs, thresholds, scope, exemptions | Project QA Lead |

**Resolution order:** L3 > L2 > L1, but only in the direction of stricter requirements.
An L3 exemption from an L1 requirement must be documented and approved.

**Full priority chain used by the QA skills:**
L1 > L2 > L3 > CLAUDE.md > skill rules > Testing/project-learning.md.
The learning file never overrides a spec or a steering document.

L1 and L2 are generic — they contain no project names, stack names, or per-project values.
Everything project-specific lives in L3.
```

Adjust the table to the files actually present. Do not list a layer that does not exist —
mark it `MISSING — see setup report` instead.

### 2A.8 Validation

Mark `Steering Docs` PASS only when all of the following hold:

* `docs/steering/` exists and contains at least L1 and L2.
* Every file name is canonical per 2A.1, and every file is non-empty and readable.
* No two files claim the same layer.
* `glob docs/steering/*` resolves — the discovery mechanism skills 3 and 5 rely on.
* Every reference to a renamed file has been updated.

Report `PARTIAL` when L3 is missing or its contract keys are unfilled (skills 3 and 5 will
still run, but with unresolved project values). Report `FAIL` with the exact missing layer
when L1 or L2 could not be found — do not paper over it.

---

## 3. Preserve Existing Project Structure

Before creating anything:

* Check whether `Testing/` or `automation/` already exists (at root or elsewhere).
* Check whether steering documents already live somewhere other than `docs/steering/`
  (e.g. `steering/`, `docs/qa/`, `.claude/rules/`). Relocate them into `docs/steering/`
  only with explicit user confirmation — otherwise leave them, document the deviation,
  and record the actual path so skills 3 and 5 can be pointed at it.
* Check whether `pages/`, `tests/`, `reports/`, or `screenshots/` already exist elsewhere.
* Treat older lowercase names under `Testing/` (`requirements/`, `automation/`,
  `white-box-testing/`) as valid existing structure — do not duplicate them with the
  new capitalized names; extend them in place and document the deviation.
* If an existing structure is valid, do not duplicate it.
* If a valid `automation/` folder already exists at the project root, prefer relocating
  it under `Testing/` only with explicit user confirmation — otherwise extend it in
  place and document the deviation.
* If the existing structure is incomplete, extend it.
* If the project uses another naming convention, document the decision before changing it.

The goal is:

> **One clean testing structure for the project.**

---

## 4. Check Node.js

After understanding the project structure, verify Node.js.

Run:

```bash
node --version
npm --version
```

If Node.js is not installed:

1. Inform the user that Node.js is required.
2. Install the appropriate stable/LTS Node.js version for the project.
3. Verify:

```bash
node --version
npm --version
```

Do not blindly install a version if the project already specifies a required Node
version.

Check for:

```text
.nvmrc
.node-version
package.json
README
CI/CD configuration
```

If the project specifies a Node version, use that version.

---

## 5. Initialize / Validate NPM

Check whether the project already contains:

```text
package.json
```

If it exists:

* Read it.
* Do not overwrite it.
* Check existing dependencies and scripts.

If it does not exist and the automation project requires one, initialize it
appropriately.

Use:

```bash
npm init -y
```

only when necessary.

---

## 6. Install Playwright

Check whether Playwright is already installed.

Check:

```bash
npx playwright --version
```

If Playwright is not installed, install it.

Prefer the appropriate installation based on the project's existing setup.

For a new Playwright TypeScript automation project, use the official Playwright setup.

After installation, verify:

```bash
npx playwright --version
```

Then install the required browsers:

```bash
npx playwright install
```

Do not reinstall unnecessarily if Playwright is already correctly configured.

---

## 7. Configure Playwright

Create or update the Playwright configuration only when required.

Typical configuration should support:

* TypeScript
* Tests located under `Testing/Automation/tests`
* Page Objects under `Testing/Automation/pages`
* HTML reporting
* Screenshots on failure
* Trace on failure/retry
* Video only if appropriate
* Reports under `Testing/Automation/reports`
* Screenshots under `Testing/Automation/screenshots` (the automation skill adds one
  sub-folder per User Story with an image per TC, replaced on re-run)
* Headed runs possible: keep the base config free of story-specific settings
  (`headless`, `workers`, reporters) — the automation skill generates a per-story
  `playwright.us-{id}.config.ts` that extends this file and sets those per run

Do not hardcode application URLs or credentials.

Use environment variables or existing project configuration.

Before modifying an existing `playwright.config.ts`, inspect it and preserve valid
project settings.

---

## 8. Install and Configure the MCP Servers (`.mcp.json`)

MCP servers for a Claude Code project are configured in a **`.mcp.json` file at the
project root**. You MUST create or extend this file yourself — do not tell the user to
configure MCPs manually and do not stop at "not configured". Writing `.mcp.json` is
your job; only secrets and interactive logins belong to the user.

Procedure:

1. Check whether `.mcp.json` exists at the project root. If it exists, read it and
   **merge** — add only the missing server entries, never remove or rewrite existing
   ones.
2. If it does not exist, create it with the required servers below.
3. `npx`-based servers need no pre-installation — `npx -y` downloads them on first
   launch. Do not run global `npm install -g` for them.

### 8.1 Playwright MCP (required — no credentials needed)

Add this entry, adjusting `--storage-state` to the project's actual auth-state path (or
omitting it if the project has none yet):

```json
"playwright": {
  "command": "npx",
  "args": [
    "@playwright/mcp",
    "--browser", "chrome",
    "--headless",
    "--test-id-attribute", "data-testid",
    "--codegen", "typescript"
  ]
}
```

This server needs no authentication — configure it fully and unconditionally.

### 8.2 Azure DevOps MCP (required — PAT via environment variable)

Add this entry, replacing the organization name with the project's Azure DevOps
organization (ask the user for the org name if it cannot be inferred from the git
remote URL):

```json
"azure-devops": {
  "command": "npx",
  "args": ["-y", "@azure-devops/mcp", "<ORG_NAME>", "--authentication", "pat"],
  "env": {
    "PERSONAL_ACCESS_TOKEN": "${AZURE_DEVOPS_PAT_B64}"
  }
}
```

PAT rules:

* The value must be an **environment variable reference** (`${AZURE_DEVOPS_PAT_B64}`),
  never the raw token.
* The variable must contain `base64(":" + PAT)` — the raw PAT alone produces an
  anonymous `TF400813` error.
* Never hardcode the PAT into any file. Never commit it. Never print it in logs.
* Azure DevOps authentication is a PAT — it is **not** an Azure Storage SAS token and
  does not require `az login`.
* Write the config entry unconditionally. If the environment variable is not yet set,
  the config is still correct — report the variable name the user must set as the only
  USER ACTION, not the whole MCP setup.

### 8.3 Azure MCP (optional — for Azure resource access, not DevOps)

Only add if the project needs Azure resource tooling:

```json
"azure": {
  "command": "npx",
  "args": ["-y", "@azure/mcp@latest", "server", "start"]
}
```

If a tool call later fails with an authentication error, `az login` is required —
that interactive login is the only part deferred to the user.

### 8.4 Word MCP (for QA/UAT document generation)

Check whether a Word MCP server is already configured (any server whose name or package
mentions `word` / `office`). If missing, add the standard Office Word MCP server:

```json
"word": {
  "command": "uvx",
  "args": ["--from", "office-word-mcp-server", "word_mcp_server"]
}
```

Prerequisite: `uv` must be installed (`uvx --version`). If `uv` is missing, install it
(`pip install uv` or the official installer) before adding the entry, and verify.

The Word MCP will later be used for generating/updating project documentation (test
documentation, UAT documents, QA documents, reports). Do not generate those documents
during this setup phase unless explicitly requested.

### 8.5 After Writing `.mcp.json`

* Validate the file is syntactically valid JSON.
* Smoke-test each command resolves (e.g. `npx @playwright/mcp --version`,
  `uvx --version`) — this verifies the launcher works even though the MCP servers
  themselves are only attached after a session reload.
* Newly configured MCP servers are discovered **only after the Claude Code session is
  reloaded/restarted** (and the user may need to approve them via `/mcp`). Configuring
  them now and reporting the reload requirement is the CORRECT and complete outcome —
  it is not a failure and not a reason to skip configuration.

---

## 9. Install QA Agent Definitions

After the project structure and MCP setup are validated, install the required QA Agent
definitions.

The required agents are:

```text
manual-test-agent.md
test-automation-agent.md
```

The target location is:

```text
.claude/agents/Test Agents V2/
```

### 9.1 Check Existing QA Agents

First check:

```text
.claude/agents/Test Agents V2/
```

If the following files already exist:

```text
manual-test-agent.md
test-automation-agent.md
```

do **not** overwrite them.

Validate that each existing file:

* Is not empty.
* Contains valid YAML frontmatter.
* Contains an agent definition.
* Is readable.

If valid, keep the existing version.

### 9.2 Find Missing Agent Definitions

If one or both agents are missing, look for the source files in this order:

1. A source path explicitly provided by the user.
2. The user's Downloads folder.
3. Other explicitly configured project source locations.

Expected source files:

```text
manual-test-agent.md
test-automation-agent.md
```

Do not assume a different filename.

### 9.3 Copy Missing Agents

Copy only the missing agent definitions into:

```text
.claude/agents/Test Agents V2/
```

Example:

```text
.claude/
└── agents/
    └── Test Agents V2/
        ├── manual-test-agent.md
        └── test-automation-agent.md
```

#### Critical Rule

**Never author these agent definitions from scratch.**

This skill is only responsible for:

* Finding the provided agent definitions.
* Copying them.
* Validating them.

It must **not generate, rewrite, reconstruct, or create substitute versions** of these
agents.

### 9.4 Never Overwrite Existing Agents

If an agent file already exists:

```text
.claude/agents/Test Agents V2/manual-test-agent.md
```

or:

```text
.claude/agents/Test Agents V2/test-automation-agent.md
```

do not overwrite it, even if a newer version exists in Downloads.

Instead report:

```text
Existing QA agent detected — preserved without modification.
```

### 9.5 Verify Copied Agents

After copying, validate each agent.

Check that:

* File exists.
* File is non-empty.
* YAML frontmatter exists.
* Frontmatter is syntactically valid.
* Agent definition content exists.

Expected result:

```text
manual-test-agent.md      : PASS
test-automation-agent.md  : PASS
```

If a required agent cannot be found or copied:

```text
manual-test-agent.md      : FAIL
test-automation-agent.md  : FAIL
```

Clearly explain which file is missing and where the search happened.

### 9.6 Reload Reminder

After successfully installing or updating the QA Agent definitions, remind the user:

> QA Agent definitions were installed successfully. Please reload/restart the Claude
> Code session so the new agents are discovered and available.

Do not claim that the agents are available in the current session unless they have
actually been detected by the environment.

---

## 9A. Bootstrap the Project Learning File

Create or validate `Testing/project-learning.md` exactly as described in section 2
(skeleton, tags, content rules). Then record what THIS run learned, one tagged line each,
under `### Setup Model (skill 1) → #### Knowledge` — for example:

```markdown
- [module: Project] [type: env] The app is an Angular front end with a .NET back end; tests run with Playwright on Chromium.
- [module: Project] [type: env] Automation code lives under Testing/Automation (new project, no earlier framework found).
- [module: Project] [type: env] MCP servers configured: Playwright, Azure DevOps (organization Link-Dev), Word.
- [module: Project] [type: env] Node 20 and NPM 10 were found already installed.
```

Any question you had to ask the user during setup (for example the Azure DevOps
organization name) goes under `### Setup Model (skill 1) → #### Questions and Answers`
as `- [module: Project] [type: qa] **Q (skill 1, {date}):** … — **A:** …`, and the fact
itself is also added to `## Project Knowledge`. Never write the PAT, its variable value,
or any credential.

<project_learning_file>
**Project Learning File protocol — shared by skills 1-5 (read first, ask second, write back).**

`Testing/project-learning.md` is the plain-English knowledge base for ALL QA skills. This
skill's section is `### Setup Model (skill 1)`.

*Read first — targeted search, never the whole file:*
1. Read only the `## Index` block at the top (one row per module: pages, similar modules, sections).
2. From the task pick the module / page / element names to look for; add the `Similar to`
   modules the Index lists for them.
3. Grep for those tags — `\[module: X\]`, `\[page: Y\]`, `\[similar: .*X` — plus
   `\[type: env\]` / `\[type: qa\]` inside this skill's model section. Read only the
   matching lines (0-1 lines of context).
4. Before asking the user anything, grep this skill's `#### Questions and Answers` for the
   question's keywords.
5. Load a whole section only if it is under ~40 lines and the grep found nothing. A file
   under 80 lines may be read whole.

*Ask second:* anything still missing (not in the file, the task input, CLAUDE.md, or the
specs) → ask the user in ONE combined message and WAIT. Never re-ask what the file
answers; state what you are reusing so the user can override it. Credentials and PATs are
always asked fresh and NEVER written to the file.

*Write back (mandatory before delivering):*
- Every answered question → one tagged `[type: qa]` line under this skill's
  `#### Questions and Answers`; project-wide answers are ALSO added to `## Project Knowledge`.
- Every new fact → one tagged line in the matching shared section or this skill's
  `#### Knowledge`. Grep the same tags first; update or dedupe instead of appending twins.
- A module / page / element that behaves like an existing one → add `[similar: …]` on both
  entries instead of copying text.
- Update the `## Index` row (new module, page, similar link, section).
- Entries contradicted by observation or by a spec → correct them. Specs and steering
  always win (L1 > L2 > L3 > CLAUDE.md > skill rules > learning file).

*Content rules:* plain English a QC can read; one fact per line. Never method / class /
function / file names, variables, selectors, code, stack traces, secrets, or requirement
text copied verbatim. `data-testid` values and URLs only under `Automation Tricks` /
`Automation Model`, explained in words on the same line.

*Report:* end every result message with
`**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}`.
</project_learning_file>

---

## 10. Validate All MCPs

After installation/configuration, perform a complete MCP health check.

For each MCP (Playwright, Azure DevOps, Azure, Word) verify:

* Entry exists in `.mcp.json` and the JSON is valid.
* The launcher command resolves (`npx` package fetches / `uvx` runs).
* Required environment variables are documented (and flagged if unset).
* If the server is already attached to the current session, verify it responds.

A server that is correctly configured but pending a session reload counts as
**PASS (reload pending)** — configuration is your responsibility; attachment happens
on reload.

Create a clear setup validation result:

```text
Environment Setup
-----------------
Node.js        : PASS / FAIL
NPM            : PASS / FAIL
Playwright     : PASS / FAIL
Playwright MCP : PASS / FAIL
Azure MCP      : PASS / FAIL
Word MCP       : PASS / FAIL
QA Agents      : PASS / FAIL
Project        : PASS / FAIL
```

`QA Agents : PASS` means:

* Both required agent files exist.
* They are non-empty.
* Their frontmatter is valid.
* Existing agents were not overwritten.

---

## 11. If MCPs Are Not Working

If an MCP is configured but not working:

1. Diagnose the issue.
2. Check configuration.
3. Check dependencies.
4. Check authentication.
5. Attempt safe fixes.

Do not continuously retry indefinitely.

If the MCP still cannot be initialized because of an environment-level issue that
requires restarting the machine:

Tell the user clearly:

> The MCP setup is complete, but the environment requires a PC restart before the MCP
> changes can take effect. Please restart the PC and then run the validation again.

Do not claim that the MCP is working if it has not actually been verified.

---

## 12. Spec Development Compatibility

The testing structure must be designed to support future automation generation from
the project's specifications.

The expected flow is:

```text
Project
   ↓
Scan Project
   ↓
Understand Spec Development
   ↓
Testing Structure (Testing/ → Requirements + Manual_Test + Automation + White_Box_Testing)
   ↓
Steering Documents (docs/steering/ → L1 + L2 + L3 — the quality authority every skill reads first)
   ↓
Project Learning File (Testing/project-learning.md — read by every later step, updated by every later step)
   ↓
Requirements
   ↓
Manual Test Cases
   ↓
Pages
   ↓
Tests
   ↓
Reports
   ↓
Screenshots
```

The testing structure should be flexible enough to support future agents that will:

* Read the steering documents (from `docs/steering/`) as their quality authority, in the
  order L1 > L2 > L3 > CLAUDE.md > skill rules > learning file
* Read specifications and requirements (from `Testing/Requirements/`)
* Understand user stories
* Design manual test cases (into `Testing/Manual_Test/TestCases/`)
* Identify application pages
* Create Page Objects
* Generate automation tests
* Execute tests
* Capture screenshots
* Generate reports
* Produce white box test plans (into `Testing/White_Box_Testing/`)
* Read `Testing/project-learning.md` before asking the QC/user anything, and update it
  (their own model section + shared sections) after every run

Do not generate actual automation test cases at this stage unless explicitly requested.

---

## 13. Final Output

At the end, provide a concise setup report containing:

### Project Analysis

* Existing testing/automation structure
* Existing steering documents — which layers were found, which names were non-canonical,
  and any file at L1/L2 that turned out to be product-specific (Section 2A.5)
* Existing Playwright setup
* Existing MCP setup
* Important findings

### Changes Made

List every file/folder/configuration created or modified.

Example:

```text
Created:
- Testing/
- Testing/project-learning.md
- Testing/Requirements/
- Testing/Manual_Test/
- Testing/Manual_Test/TestCases/
- Testing/Automation/
- Testing/Automation/pages/
- Testing/Automation/tests/
- Testing/Automation/reports/
- Testing/Automation/screenshots/
- Testing/Automation/automation-logs/
- Testing/White_Box_Testing/
- docs/steering/
- docs/steering/README.md
- docs/steering/L1-testing-foundation.md      (copied from <source>)
- docs/steering/L2-testing-qa-standards.md    (copied from <source>)
- docs/steering/L3-project-testing.md         (template — placeholders unfilled)
- playwright.config.ts

Renamed:
- docs/steering/"L1-testing-foundation-v1.1 1.md" → docs/steering/L1-testing-foundation.md

Installed:
- Playwright
- Playwright MCP
- Azure MCP
- Word MCP
- .claude/agents/Test Agents V2/manual-test-agent.md
- .claude/agents/Test Agents V2/test-automation-agent.md
```

Only list items that were actually created/installed.

### Validation

Report:

```text
Node.js        : PASS
NPM            : PASS
Playwright     : PASS
Steering Docs  : PASS   (docs/steering/ — L1 + L2 + L3 present, canonical names, glob resolves)
Playwright MCP : PASS
Azure MCP      : PASS
Word MCP       : PASS
QA Agents      : PASS
Learning File  : PASS   (Testing/project-learning.md exists, has Index + 6 shared sections + 5 model sections)
```

Finish with: `**Learning file:** read {sections} · updated {N added / M updated | "no new knowledge"}`.

### Remaining Actions

If everything works:

```text
No manual action required.
Testing environment is ready for Spec Development.
```

If something requires the user:

```text
USER ACTION REQUIRED:
1. ...
2. ...
```

---

## Critical Rules

1. **Scan first. Modify second.**
2. Never assume the project is empty.
3. Never duplicate an existing testing/automation structure.
4. Never delete existing tests/configuration unless explicitly required.
5. Never hardcode credentials.
6. Never expose PATs or secrets in logs.
7. Never invent application pages or test cases.
8. Reuse existing project conventions whenever possible.
9. Verify every installation after installing it.
10. Verify every MCP after configuring it.
11. If a restart is genuinely required, ask the user to restart the PC.
12. Do not say "setup completed" unless the setup has actually been validated.
13. Keep the testing structure compatible with future Spec Development → Automation generation.
14. Prefer minimal changes to the existing project.
15. At every step, explain what you discovered and why a change is necessary.
16. **Never overwrite an existing QA Agent definition.**
17. **Never author or reconstruct QA Agent definitions from scratch. Copy only the provided agent definitions.**
18. If an agent definition is missing, report it instead of inventing a replacement.
19. Always validate copied agent definitions before marking `QA Agents` as PASS.
20. Remind the user to reload/restart the Claude Code session after installing new agent definitions.
21. **Write `.mcp.json` yourself — never defer MCP configuration to the user.** The only items allowed under USER ACTION REQUIRED are: setting the PAT environment variable, running an interactive `az login`, and reloading the session.
22. **Always run Step 0 first: pull the latest skills from https://github.com/AhmedZaher1233/Link_AI_Pro before creating or updating the testing structure.** Never use stale local skill copies when the repository is reachable.
23. **Always create or validate `docs/steering/` (Section 2A).** Never author L1 or L2
    from scratch, never invent L3 values, never overwrite an existing steering document,
    and never leave a non-canonical file name in place without renaming it and updating
    every reference. A missing L1 or L2 is reported, not substituted.
24. **Keep L1 and L2 generic.** A steering file that names a specific product, repo,
    framework, or endpoint does not belong at L1/L2 — report it and propose the split into
    L3; never delete or rewrite it on your own.
25. **Always create or validate `Testing/project-learning.md` (section 2 skeleton + section 9A).** Never delete or rewrite existing entries, never write secrets or code identifiers into it, and never load the whole file when a tag grep answers the question.
