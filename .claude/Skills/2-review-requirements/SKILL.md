---
name: 2-review-requirements
model: claude-opus-5
description: Review requirements, user stories, and acceptance criteria for testability, completeness, clarity, consistency, feasibility, and risk. Accepts EVERY input type — an Azure DevOps User Story (via Azure DevOps MCP), a Word document (via Word MCP), directly pasted text, a small spec file, or a big spec file containing multiple user stories. A multi-story spec is SPLIT: each user story is reviewed separately and its output lands in its own folder under Testing/Requirements/{US-id-name}/ (per the 1-generate-update-testing-structure layout), holding both the extracted structured requirement file (REQ-*.md) and the review file, plus a top-level SPEC-REVIEW-SUMMARY.md for cross-story findings. Use whenever the user asks to review requirements, review a spec or spec.md, analyze user stories, check acceptance criteria, assess testability, find gaps in specs, or evaluate any PRD/feature document for QA readiness. Trigger on phrases like "review this spec", "review this story", "check requirements", "is this testable", "requirements analysis", "acceptance criteria review", "QA this spec", "QA this story", "review-user-story".
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
| **Azure DevOps User Story** (ID like `1031475` / `US-1031475`, or exact title) | Fetch via the Azure DevOps MCP (`wit_work_item` / `search_workitem`): title, description, acceptance criteria, linked items. Title given → resolve to exactly one ID; zero or multiple matches → ask the user (show candidates), never guess |
| **Word document** (`.docx` path or reference) | Read via the Word MCP if configured; if no Word MCP is available, ask the user to export to markdown/text or paste the content |
| **Direct text** (requirement/PRD pasted inline) | Use the provided content directly |
| **Small spec file** (one user story) | Read the file directly |
| **Big spec file** (multiple user stories) | Read the file, then SPLIT per story — see Multi-Story Splitting below |

| Argument | Action |
|----------|--------|
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

## Multi-Story Splitting — big specs

Before reviewing, detect how many user stories the input contains:

- Boundary signals: `## User Story N` / `### User Story N (Priority Pn)` headings,
  distinct `US-\d+` IDs, `### Story:` blocks, or clearly separated requirement sections
  each with their own role/action/ACs.
- **Report the count found to the user before reviewing** (e.g. "This spec contains 4
  user stories — producing 4 separate reviews").

Then:

- **More than 1 story** → run the FULL review process PER STORY. Each story gets its own
  output folder and files (layout below). Shared/global spec sections (overview, glossary,
  common constraints) are reviewed once and referenced in each story's review under a
  short **"Shared spec context"** note — never duplicated in full.
- **Exactly 1 story** → one folder, same layout.
- **Cross-story consistency** (Dimension 4) still compares the stories against each other.
  A cross-story finding (conflict, duplication, dependency) is recorded in EVERY affected
  story's review AND in the top-level summary:
  `Testing/Requirements/SPEC-REVIEW-SUMMARY.md` — spec source, list of stories reviewed,
  per-story verdicts, cross-story conflicts/dependencies, and the folder path per story.
  Regenerate this summary per reviewed spec; name it
  `SPEC-REVIEW-SUMMARY-{spec-name}.md` when more than one spec has been reviewed.

---

## Output Location — `1-generate-update-testing-structure` layout

All output goes under `Testing/Requirements/`, **one folder per user story**:

```text
Testing/Requirements/
  US-1031475-initiative-yearly-values/
    REQ-1031475-initiative-yearly-values.md    ← structured requirement (extracted/converted)
    US-1031475-review.md                       ← the full review
  US-1031476-.../
    REQ-...
    US-1031476-review.md
  SPEC-REVIEW-SUMMARY.md                        ← only for multi-story specs
```

Rules:

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
   requirement state) — but never touches other stories' folders.

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

**Rate:** `✅ Consistent` / `⚠️ Potential Conflict` / `❌ Inconsistent`

### Dimension 5: Feasibility

Assess technical risk:
- Does the requirement touch multiple system layers (frontend + backend + DB)?
- Are there known constraints (auth, roles, performance) not addressed?
- Are integrations (APIs, external services, background jobs) implied but not specified?
- Are there dependencies on unbuilt or unstable components?

**Rate:** `✅ Feasible` / `⚠️ Risky` / `❌ Infeasible`

### Dimension 6: Risk

Classify overall risk:
- **🔴 High**: Auth/permissions, data integrity, financial/legal impact, complex integrations
- **🟡 Medium**: Core user workflows, data validation, error handling
- **🟢 Low**: UI cosmetics, informational pages, non-critical features

**Rate:** `🔴 High` / `🟡 Medium` / `🟢 Low`

---

## Full Review Template

Write to `Testing/Requirements/{US-{id}-{name}}/US-{id}-review.md`:

```markdown
# Requirement Review — {Story Name}
**Date**: {YYYY-MM-DD}
**Source**: {work item URL | docx path | spec path + section | "inline text"}
**Requirement file**: {REQ-*.md path in this folder, or the referenced repo file}
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

## Final message to the user

Report: source type resolved · number of stories found (and the split, if >1) ·
per-story folder paths + verdicts · summary file path (multi-story) · and that the
`REQ-*.md` files are ready as input for the `3-generate-manual-test-cases` skill.
