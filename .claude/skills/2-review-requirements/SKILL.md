---
name: 2-review-requirements
model: claude-opus-5
description: Review requirements, user stories, and acceptance criteria for testability, completeness, clarity, consistency, feasibility, and risk. Accepts EVERY input type — an Azure DevOps User Story (via Azure DevOps MCP), a Word document (via Word MCP), directly pasted text, a small spec file, or a big spec file containing multiple user stories. A multi-story spec is SPLIT: each user story is reviewed separately and its output lands in its own folder — stories that come from a spec FILE are grouped under a parent folder named after that spec, Testing/Requirements/SPEC-{spec-name}/US-{id}-{name}/, while Azure DevOps / Word / pasted-text stories go directly under Testing/Requirements/US-{id}-{name}/ (per the 1-generate-update-testing-structure layout) — holding both the extracted structured requirement file (REQ-*.md) and the review file, plus a SPEC-REVIEW-SUMMARY.md inside the spec folder for cross-story findings. Follows the spec's DEPENDENCIES: when the spec refers to other files (another spec, a glossary, data model, permission matrix, API contract, story IDs defined elsewhere) it resolves them, reads them, checks the spec against them, and fully reviews any dependency spec that has no review yet in its own SPEC-{dep-name}/ folder. Use whenever the user asks to review requirements, review a spec or spec.md, analyze user stories, check acceptance criteria, assess testability, find gaps in specs, or evaluate any PRD/feature document for QA readiness. Trigger on phrases like "review this spec", "review this story", "check requirements", "is this testable", "requirements analysis", "acceptance criteria review", "QA this spec", "QA this story", "review-user-story".
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, mcp__azure-devops
argument-hint: "[<story-id> | <feature-name> | <path/to/spec.md> | <path/to/story.md> | <pasted text> | all]"
---

# Requirement Review Skill

You are a senior QA engineer reviewing requirements for testability, completeness, and clarity.

**Constraint**: Write output ONLY to `Testing/Requirements/`. Never modify source code, the
original spec/story files, or anything outside that folder.

---

## Step 0 — Intake Gate: ask BEFORE starting

Check what the task input already provides: the requirement source (story ID, file path,
Word document, or pasted text) and, for Azure DevOps sources, the story ID or exact title.

**If the source is missing or ambiguous → ask the user in ONE combined message listing
exactly what is needed, and WAIT for the reply. Do NOT start the review, search, or fetch
anything on assumptions.** Skip the ask only when the input already answers everything —
and state what you resolved so the user can override it.

### Step 0.a — Consult `Testing/project-learning.md` BEFORE asking

Before the intake ask, search the shared learning file for what it already knows: recorded
spec/story locations, the Azure DevOps project and area path, story-ID conventions, module
names, glossary terms, and earlier answers under `### Requirements Review Model (skill 2)`.
Only what the file does not answer is asked. Follow the protocol below.

<qa_manifest>
**Structure contract — read `Testing/qa-manifest.json` first.** Written by
`1-generate-update-testing-structure`; it holds the project's QA paths (testing root,
requirements, manual test cases, automation root, pages, tests, reports, screenshots, logs,
white-box folder, learning file), the steering file paths, the framework config and every
documented deviation. Use its paths before any auto-detection; fall back to detection only when
the manifest is absent, and then tell the user to run `/1-generate-update-testing-structure`
(audit first, then repair) — never invoke that skill yourself. Steering conflicts resolve per
the rules in `docs/steering/README.md` (L1 baseline, L2 refines, L3 values + stricter +
approved exemptions; specs govern business truth, steering governs quality policy, the learning
file overrides neither). Behaviour knowledge stays in `Testing/project-learning.md`.
</qa_manifest>

<project_learning_file>
**Project Learning File protocol — shared by skills 1-7 (read first, ask second, write back).**

`Testing/project-learning.md` is the plain-English knowledge base for ALL QA skills
(created by `1-generate-update-testing-structure`). This skill's section is
`### Requirements Review Model (skill 2)`. If `Testing/` exists but the file does not,
create it with the skeleton defined in skill 1, section 2.

*Read first — targeted search, never the whole file:*
1. Read only the `## Index` block at the top (one row per module: pages, similar modules, sections).
2. From the task (story title, feature, page names) pick the module / page / element names
   to look for; add the `Similar to` modules the Index lists for them.
3. Grep for those tags — `\[module: X\]`, `\[page: Y\]`, `\[similar: .*X` — plus
   `\[type: qa\]` inside this skill's model section. Read only the matching lines
   (0-1 lines of context).
4. Before asking the user anything, grep this skill's `#### Questions and Answers` for the
   question's keywords.
5. Load a whole section only if it is under ~40 lines and the grep found nothing. A file
   under 80 lines may be read whole.

*Ask second:* anything still missing (not in the file, the task input, CLAUDE.md, or the
specs) → ask the user in ONE combined message and WAIT. Never re-ask what the file
answers; state what you are reusing so the user can override it. Credentials and PATs are
NEVER written to the file.

*Write back (mandatory before delivering):*
- Every answered question → one tagged line under this skill's `#### Questions and Answers`:
  `- [module: X] [type: qa] **Q (skill 2, {YYYY-MM-DD}):** … — **A:** …`. Project-wide
  answers (environments, roles, module names, where specs live) are ALSO added to
  `## Project Knowledge`.
- Every new fact → one tagged line in the matching shared section or this skill's
  `#### Knowledge`. Grep the same tags first; update or dedupe instead of appending twins.
- A module / page / element that behaves like an existing one → add `[similar: …]` on both
  entries instead of copying text.
- Update the `## Index` row (new module, page, similar link, section).
- Entries contradicted by a spec → correct them. Specs and steering always win
  (resolution rules in docs/steering/README.md).

*Content rules:* plain English a QC can read; one fact per line; what the user does, what
the system shows, which data works, what to avoid. Never method / class / function / file
names, variables, selectors, code, stack traces, secrets, or requirement text copied
verbatim (state the learned rule + its source instead).

*Report:* end the final message with
`**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}`.
</project_learning_file>

---

## Trigger Phrases

**General triggers:**
- "Review story"
- "review-user-story"
- "review requirements"
- "check requirements"
- "is this testable"
- "requirements analysis"
- "acceptance criteria review"
- "review user stories"

**Dimension-specific triggers:**
| User says | Review only |
|-----------|-------------|
| "check completeness", "is this complete" | Dimension 1 only |
| "check clarity", "find ambiguities" | Dimension 2 only |
| "check testability", "is this testable" | Dimension 3 only |
| "check consistency", "find conflicts" | Dimension 4 only |
| "assess feasibility", "technical risk assessment" | Dimension 5 only |
| "assess risk level", "risk analysis" | Dimension 6 only |
| No dimension specified | Review all 6 dimensions |

---

## Input Resolution — five source types

The requirement is the source of truth (the oracle) whichever way it arrives:

| Source | How to read |
|--------|-------------|
| **Azure DevOps User Story** (ID like `1031475` / `US-1031475`, or exact title) | Fetch via the Azure DevOps MCP (`wit_work_item` / `search_workitem`): title, description, acceptance criteria, linked items. Title given → resolve to exactly one ID; zero or multiple matches → ask the user (show candidates), never guess. On **401/403** STOP and report: 401 → the Azure DevOps MCP server is holding a rejected or stale token → ask the user to **reconnect the Azure DevOps MCP server** (`/mcp` → azure-devops → reconnect; if the PAT itself expired they renew it first where the server reads it from) — you cannot connect or disconnect MCP servers yourself, so always ask and wait, then retry once; 403 → missing scope on the PAT. Never ask for the token in chat |
| **Word document** (`.docx` path or reference) | Read via the Word MCP if configured; if no Word MCP is available, ask the user to export to markdown/text or paste the content |
| **Direct text** (requirement/PRD pasted inline) | Use the provided content directly |
| **Small spec file** (one user story) | Read the file directly |
| **Big spec file** (multiple user stories) | Read the file, then SPLIT per story — see Multi-Story Splitting below |

| Argument | Action |
|----------|--------|
| Any argument | FIRST grep `Testing/project-learning.md` (Index + `[module: …]` tags + this skill's Q&A) for a recorded spec location, ADO project, or story convention that resolves it — reuse it and say so |
| Path ending in `.md` / `.txt` / `.docx` | Read directly (spec.md, story .md, or Word doc per the table above) |
| Feature name or ID (e.g. "resource-request-hours", "1038145", "US-1003547") | Search `specs/**/spec.md`, `Testing/Requirements/**/*.md`, and `test/User stories/**/*.md`; nothing local → try Azure DevOps by ID/title. Matches in both spec and story form → **prefer the `specs/**/spec.md`** and note the story path as a cross-reference |
| Text/PRD/requirement provided inline | Use provided content directly |
| "all" or blank | Process every `specs/**/spec.md` **and** every `.md` in `test/User stories/` (confirm scope with the user first if this is more than ~10 documents) |
| No requirement found anywhere | Ask the user for the source (Step 0) — list where you searched |

### Reading a spec-driven `spec.md`

When the input is a `spec.md`, treat its sections as the review material:
- **User Scenarios & Testing** and each **User Story N (Priority Pn)** → the acceptance criteria to rate (Dimensions 1–3, 6).
- **Clarifications** → already-answered questions; do **not** re-raise them as gaps. Flag only what remains unanswered.
- Sibling artifacts, **if present**, are optional consistency/feasibility context only — read them read-only, never require them: `plan.md`, `data-model.md`, `contracts/`, `tasks.md`, `checklists/`.
- In the review's **Source** field, record the `spec.md` path (and the cross-referenced story path, if any).

---

## Dependency Resolution — specs that depend on other files

A spec is rarely self-contained. Before rating anything, find every file the input depends on,
read those files too, and review them — a gap or conflict in a dependency is a gap in this spec.

### 1. Detect the dependencies

Scan the whole input (all stories, shared sections, footnotes) for:

- Markdown links or plain paths to other files: `[..](../other/spec.md)`, `docs/x.md`,
  `*.docx`, `*.xlsx`, `*.json`, `*.yaml`, `*.pdf`, images/diagrams.
- Wording that hands off a definition: "see", "as defined in", "refer to", "per", "depends on",
  "extends", "inherits", "prerequisite", "based on", "shared with", "same as in", "reuses".
- Story or requirement IDs that are NOT defined in this spec (`US-\d+`, `REQ-…`, `FR-…`) and
  feature / module / spec names that are only mentioned, never described.
- Named shared artifacts: glossary, data model, permission matrix, workflow / state diagram,
  API contract, validation rules, localisation file, design / Figma link.

Build a **dependency list** (`what is referenced` · `where in this spec` · `what this spec relies
on from it`). Follow dependencies of dependencies up to **2 levels**; stop at a cycle or when a
file adds nothing this spec relies on.

### 2. Resolve each one — never guess

In order: path relative to the spec file's folder → same name anywhere in the repo (glob by
file name; `specs/**`, `docs/**`, `Testing/Requirements/**`) → `Testing/project-learning.md`
(`[module: …]` tags, recorded spec locations) → Azure DevOps by ID (IDs only) → **ask the user**.
Unresolved dependencies go into the ONE combined Step 0 question ("this spec refers to
`Pricing rules` and `US-1029001` — where are they? or reply `skip` to review without them").
`skip` = record the dependency as **Unresolved**, never treat it as satisfied.

External links (Figma, Confluence, SharePoint) you cannot open: record as **Unreadable** and ask
the user for an export only if an acceptance criterion cannot be rated without it.

Report the resolved dependency tree to the user in the same message as the story count
("This spec contains 3 user stories and depends on 2 files: …").

### 3. Review the dependency files — what "review" means per type

| Dependency type | What to do |
|---|---|
| Another **spec / story file** (has user stories or acceptance criteria) | Check whether it already has a review (`Testing/Requirements/**/US-{id}-review.md` or `SPEC-{dep-name}/`). **Not reviewed yet → give it the FULL review too**: split, REQ + review per story, into its own `Testing/Requirements/SPEC-{dep-spec-name}/` folder (same rules as any spec file). **Already reviewed → reuse** that review (read it, do not regenerate) and only re-run the cross-spec consistency check below; refresh it only if the dependency file changed after the review date. Tell the user which happened. |
| **Shared definition file** (glossary, data model, permission matrix, state / workflow diagram, API contract, validation rules, localisation file) | Read it read-only. Verify every item this spec relies on actually exists there and says what this spec assumes (field names, types, lengths, states, roles, messages, rules). No REQ / review file is produced for it — its findings live in the depending story's review. |
| **Design / image / external link** | Read if possible; otherwise mark Unreadable. Use only to rate completeness/clarity of the ACs that point to it. |
| **Missing / Unresolved** | The ACs that rely on it are rated ⚠️ at best; add a clarification question naming the file. |

### 4. Cross-spec consistency check (always, for every resolved dependency)

- Referenced section / item exists and is unambiguous.
- This spec's assumptions match the dependency: same field names, states, roles, limits,
  error messages, defaults, terminology (glossary).
- Neither file contradicts the other; neither duplicates the other's rules with a drift.
- Dependency prerequisites are stated (order of delivery, feature flags, data that must exist).
- Version / date: the dependency is not older than a rule this spec changed (stale dependency).

Record results in **Dimension 4 (Consistency)** — a conflict with a dependency is an
inconsistency of THIS story — and in **Dimension 5 (Feasibility)** for missing / unbuilt
dependencies. Every cross-spec finding is written in the review of EVERY affected story on both
sides (the depending story and, when it was reviewed, the dependency's story) and in the
`SPEC-REVIEW-SUMMARY.md` of the depending spec under **Dependencies**.

### 5. Rules

- Dependency files are **read-only**: never edit them, never copy them into the output folders.
- Reviews of a dependency spec land in ITS OWN `SPEC-{dep-spec-name}/` folder, never inside the
  depending spec's folder. The depending spec's summary links to them.
- Sibling artifacts of a `spec.md` (`plan.md`, `data-model.md`, `contracts/`, `tasks.md`) are
  dependencies of the shared-definition type when the spec refers to them; otherwise they stay
  optional context as stated above.
- Never load a large dependency in full when a grep for the referenced item answers the
  question; never re-review a dependency the user asked to skip.

---

## Multi-Story Splitting — big specs

Before reviewing, detect how many user stories the input contains:

- Boundary signals: `## User Story N` / `### User Story N (Priority Pn)` headings,
  distinct `US-\d+` IDs, `### Story:` blocks, or clearly separated requirement sections
  each with their own role/action/ACs.
- **Report the count found to the user before reviewing** (e.g. "This spec contains 4
  user stories — producing 4 separate reviews").

Then:

- **Derive `{spec-name}` first** (spec FILE inputs only — `.md` / `.txt` / `.docx` path):
  the file stem with the extension stripped, lowercased, kebab-case, at most 6 words
  (`Resource Request Hours v2.docx` → `resource-request-hours-v2`). When the stem is generic
  (`spec`, `specification`, `requirements`, `prd`, `readme`), use the parent folder name instead
  (`docs/specs/resource-request/spec.md` → `resource-request`). Every story extracted from
  that file lands under the parent folder `Testing/Requirements/SPEC-{spec-name}/`.
- **More than 1 story** → run the FULL review process PER STORY. Each story gets its own
  output folder and files inside `SPEC-{spec-name}/` (layout below). Shared/global spec
  sections (overview, glossary, common constraints) are reviewed once and referenced in each
  story's review under a short **"Shared spec context"** note — never duplicated in full.
- **Exactly 1 story** → one story folder, still inside `SPEC-{spec-name}/` when the input was
  a spec file; directly under `Testing/Requirements/` for Azure DevOps / Word / pasted text.
- **Cross-story consistency** (Dimension 4) still compares the stories against each other.
  A cross-story finding (conflict, duplication, dependency) is recorded in EVERY affected
  story's review AND in the spec-level summary:
  `Testing/Requirements/SPEC-{spec-name}/SPEC-REVIEW-SUMMARY.md` — spec source, list of
  stories reviewed, per-story verdicts, cross-story conflicts/dependencies, the folder
  path per story, and a **Dependencies** block: every file this spec depends on, its
  resolved path, status (Found / Reviewed at `SPEC-…/` / Reused existing review / Missing /
  Unreadable / Skipped) and the cross-spec findings. Regenerate this summary on every re-review of the same spec; the spec
  folder keeps summaries of different specs apart, so the file name never changes.

---

## Output Location — `1-generate-update-testing-structure` layout

All output goes under `Testing/Requirements/`, **one folder per user story**. Stories that
come from a spec FILE are grouped under a parent folder named after that spec
(`SPEC-{spec-name}/`); stories from Azure DevOps, Word or pasted text sit directly under
`Testing/Requirements/`:

```text
Testing/Requirements/
  SPEC-initiative-management/                   ← one per spec FILE (1 or many stories)
    US-1031475-initiative-yearly-values/
      REQ-1031475-initiative-yearly-values.md  ← structured requirement (extracted/converted)
      US-1031475-review.md                     ← the full review
    US-1031476-.../
      REQ-...
      US-1031476-review.md
    SPEC-REVIEW-SUMMARY.md                      ← only when the spec held >1 story
  US-2000001-from-azure-devops/                 ← ADO / Word / pasted text: no spec level
    REQ-2000001-from-azure-devops.md
    US-2000001-review.md
```

Rules:

0. **Spec level**: input is a spec FILE → parent folder `SPEC-{spec-name}/` (derived in
   Multi-Story Splitting above), story folders inside it. Input is an Azure DevOps story,
   a Word story, or pasted text → story folder directly under `Testing/Requirements/`.
   `{story-folder}` below means `Testing/Requirements/[SPEC-{spec-name}/]US-{id}-{name}/`.
1. Folder name: `US-{id}-{kebab-case-story-name}` (no ID available → `{kebab-case-story-name}`).
   Create the folder if missing. If `Testing/` does not exist, run the
   `1-generate-update-testing-structure` skill first or create the needed subtree —
   **never fall back to `test/reviews/`** or any other location.
2. **Structured requirement file** `REQ-{id}-{name}.md` — written whenever the source was
   Azure DevOps, Word, direct text, or a split section of a big spec. Contents: title,
   story ID, source reference, description, numbered acceptance criteria, derived
   requirement IDs (`REQ-{id}-NN`, one per testable statement), roles, out-of-scope notes,
   open questions. This is the same file the `3-generate-manual-test-cases` skill consumes.
   When the source is already a standalone requirement file in the repo, reference its path
   in the review instead of duplicating it.
3. **Review file** `US-{id}-review.md` (template below). Single-dimension reviews:
   `US-{id}-{dimension}-review.md` in the same folder
   (e.g. `US-1003547-auto-cancel/US-1003547-testability-review.md`).
4. Re-reviewing a story overwrites its review file (the review reflects the current
   requirement state) — but never touches other stories' folders. Re-reviewing the same
   spec file reuses its existing `SPEC-{spec-name}/` folder (glob
   `Testing/Requirements/**/US-{id}-*/` to find a story that already exists before creating
   a new folder — never create a second copy of a story at another level).

---

## Review Process

For each feature/story, perform a structured review across the requested dimensions:

### Dimension 1: Completeness

Check that the requirement covers:
- [ ] **Who** — user role / persona defined
- [ ] **What** — action/capability clearly stated
- [ ] **Why** — business value or goal stated
- [ ] **When** — trigger conditions defined
- [ ] **Happy path AND edge cases** covered
- [ ] **Error flows** — what happens on failure/invalid input
- [ ] **Boundary conditions** defined (empty, max length, special characters)
- [ ] **Non-functional requirements** stated (performance, security, accessibility)
- [ ] **Permissions** — who can/cannot perform the action
- [ ] **Concurrent user scenarios** considered
- [ ] **State transitions** defined

**Rate:** `✅ Complete` / `⚠️ Partially Complete` / `❌ Incomplete`

### Dimension 2: Clarity & Unambiguity

Identify vague or ambiguous language:
- Words like "fast", "user-friendly", "seamless", "quickly", "easily", "properly", "as needed" — flag each
- Pronouns with unclear referents
- Undefined technical terms or acronyms
- Contradictions within the requirement
- Inconsistent terminology across stories

**Rate:** `✅ Clear` / `⚠️ Needs Clarification` / `❌ Ambiguous`

### Dimension 3: Testability

Can this requirement be tested? Check:
- [ ] Is every acceptance criterion verifiable with a concrete pass/fail outcome?
- [ ] Are inputs, expected outputs, and preconditions explicit?
- [ ] Expected outcomes are specific and observable
- [ ] No criteria rely on subjective judgment ("looks good", "user-friendly")
- [ ] Pass/fail is deterministic

**Rate:** `✅ Testable` / `⚠️ Partially Testable` / `❌ Not Testable`

### Dimension 4: Consistency

Cross-check against related requirements and the codebase:
- Does it conflict with existing features?
- Does it duplicate existing functionality?
- Does it align with the current data model?
- Do stories contradict each other? (for multi-story specs, compare every pair)
- Are dependencies between stories identified?
- Does it agree with every file it depends on (Dependency Resolution §4): same fields, states,
  roles, limits, messages, terminology? A drift or contradiction with a dependency is rated here.

**Rate:** `✅ Consistent` / `⚠️ Potential Conflict` / `❌ Inconsistent`

### Dimension 5: Feasibility

Assess technical risk:
- Does the requirement touch multiple system layers (frontend + backend + DB)?
- Are there known constraints (auth, roles, performance) not addressed?
- Are integrations (APIs, external services, background jobs) implied but not specified?
- Are there dependencies on unbuilt or unstable components?
- Is any file this spec depends on Missing, Unresolved or Unreadable (Dependency Resolution)?
  Missing dependency → at most ⚠️ Risky for the ACs that rely on it.

**Rate:** `✅ Feasible` / `⚠️ Risky` / `❌ Infeasible`

### Dimension 6: Risk

Classify overall risk:
- **🔴 High**: Auth/permissions, data integrity, financial/legal impact, complex integrations
- **🟡 Medium**: Core user workflows, data validation, error handling
- **🟢 Low**: UI cosmetics, informational pages, non-critical features

**Rate:** `🔴 High` / `🟡 Medium` / `🟢 Low`

---

## Full Review Template

Write to `{story-folder}/US-{id}-review.md` — i.e.
`Testing/Requirements/[SPEC-{spec-name}/]US-{id}-{name}/US-{id}-review.md`:

```markdown
# Requirement Review — {Story Name}
**Date**: {YYYY-MM-DD}
**Source**: {work item URL | docx path | spec path + section | "inline text"}
**Requirement file**: {REQ-*.md path in this folder, or the referenced repo file}
**Depends on**: {comma-separated resolved paths of the files this story relies on | "none"}
**Reviewer**: Claude Code QC Agent

---

## Summary

| Dimension | Rating | Issues Found |
|-----------|--------|--------------|
| Completeness | ✅ Complete / ⚠️ Partial / ❌ Incomplete | N |
| Clarity | ✅ Clear / ⚠️ Needs Clarification / ❌ Ambiguous | N |
| Testability | ✅ Testable / ⚠️ Partial / ❌ Not Testable | N |
| Consistency | ✅ Consistent / ⚠️ Conflict / ❌ Inconsistent | N |
| Feasibility | ✅ Feasible / ⚠️ Risky / ❌ Infeasible | N |
| Risk Level | 🔴 High / 🟡 Medium / 🟢 Low | — |

**Overall Readiness**: ✅ Ready for Testing / ⚠️ Needs Revision / ❌ Blocked

---

## Shared spec context
{multi-story specs only: one short note referencing the shared sections reviewed once — or omit}

## Dependency Check
{omit when the story depends on nothing}

| Dependency | Referenced from | Resolved path | Status | This story relies on | Result |
|---|---|---|---|---|---|
| {name as written in the spec} | {AC / section} | {path or "—"} | Found · Reviewed (`SPEC-…/`) · Reused existing review · Missing · Unreadable · Skipped | {fields / rules / states taken from it} | ✅ Consistent / ⚠️ Gap / ❌ Conflict — {one line} |

## Requirement Text

{original requirement for THIS story}

---

## Issues Found

| # | Story/Req | Issue Type | Severity | Description | Suggestion |
|---|-----------|------------|----------|-------------|------------|
| 1 | {Story ID} | {Type} | High/Med/Low | {Description} | {Suggestion} |

---

## Findings

### Missing Information
{numbered list of gaps, or "None"}

### Ambiguities
{numbered list — quote the ambiguous text, explain why, suggest clarification}

### Testability Issues
{numbered list of criteria that cannot be verified as written}

### Conflicts / Inconsistencies
{list of conflicts with other requirements, other stories in the same spec, or code}

### Technical Risks
{list of identified technical risks}

### Missing Test Scenarios
- [ ] Scenario description (edge cases, error flows, concurrent users, etc.)

---

## Clarification Questions for Product/Dev

Questions that must be answered before testing can begin:

1. {specific question}
2. {specific question}

---

## Recommended Acceptance Criteria

{Rewritten or supplemented Given/When/Then criteria that are clear and testable}

**Scenario 1: Happy Path**
- Given {precondition}
- When {action}
- Then {observable outcome}

**Scenario 2: Error/Validation Case**
- Given {precondition}
- When {invalid action}
- Then {error message or behavior}

**Scenario 3: Edge Case - {description}**
- Given {boundary condition}
- When {action}
- Then {expected behavior}

---

## Test Coverage Scope

Based on this review, testing should cover:

| Area | Priority | Notes |
|------|----------|-------|
| {UI component/flow} | P1/P2/P3 | {why} |
| {API endpoint} | P1/P2/P3 | {why} |
| {Integration point} | P1/P2/P3 | {why} |

---

## Verdict

**✅ Ready for Test Planning** / **⚠️ Needs Clarification** / **❌ Not Testable**

{One sentence summary of next steps}
```

---

## Update the learning file (mandatory before the final message)

Per the `<project_learning_file>` protocol, write to `Testing/project-learning.md`:

- Under `### Requirements Review Model (skill 2) → #### Knowledge`: where this project's
  specs/stories live and how they are named, story-boundary patterns seen, and the
  business rules and domain terms learned from the requirement — one tagged line each, in
  plain words with the story ID as source, e.g.
  `- [module: KPI] [type: rule] A KPI's yearly value is entered per year and cannot exceed its target. (source: US-1031475 AC-2)`.
- Under `#### Questions and Answers`: every question the user answered this run.
- Project-wide facts (modules, roles, environments, glossary) → also `## Project Knowledge`;
  update the `## Index` row for every module touched; link `[similar: …]` modules that share rules.
- Never copy requirement text verbatim, never write code identifiers.

## Final message to the user

Report: source type resolved · number of stories found (and the split, if >1) ·
dependencies: {N} files found — which were reviewed fully (their `SPEC-…/` folders), which
reused an existing review, which are Missing / Unreadable / Skipped, and the count of
cross-spec conflicts ·
the spec folder `Testing/Requirements/SPEC-{spec-name}/` (spec-file input) ·
per-story folder paths + verdicts · summary file path (multi-story) · that the
`REQ-*.md` files are ready as input for the `3-generate-manual-test-cases` skill · and
`**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}`.

---

## Critical Rules

1. Write output only to `Testing/Requirements/` and `Testing/project-learning.md`.
2. Search the learning file (Index + tag grep) before asking the user anything; never load
   the whole file when a grep answers the question.
3. Record every user answer and every learned system rule in the learning file, in plain
   English, tagged; never secrets, never code identifiers, never verbatim requirement text.
4. The spec always wins over the learning file; fix the learning entry on conflict.
5. Never guess a story, a source, or a scope — ask.
6. Never rate a spec in isolation when it depends on other files: resolve, read and check every
   dependency first (Dependency Resolution); an unresolved dependency is reported, never
   assumed satisfied. Dependency files are read-only.
