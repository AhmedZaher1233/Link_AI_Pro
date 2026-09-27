---
name: link-qc-11-discover-business-rules
model: claude-opus-5
description: Discover the business rules the CODE actually enforces for a User Story and export the ones the spec never mentions. Starting from a story ID, a REQ-*.md, a spec file, or pasted acceptance criteria, it locates the story's code (reusing the repository profile that link-qc-10-white-box-testing builds), reads validators, entities, migrations, services, guards and UI forms, and writes every observed rule as an EARS statement with code evidence — field lengths and formats, required/optional, uniqueness of names/IDs/codes, defaults, ranges and thresholds, allowed state transitions, permissions, duplicate handling, soft-delete/archival rules, calculated values, locale differences. It then compares that catalogue against the spec, classifies each rule as In spec / Partially in spec / Not in spec / Contradicts spec, and exports the "in code, not in spec" list as a review-ready document under Testing/Requirements/[SPEC-{spec-name}/]US-{id}-{name}/ — the same story folder link-qc-2-review-requirements uses, nested under a SPEC-* folder when the story came from a spec file (one folder per story — multi-story input is split; if the requirements folder does not exist it asks where to write) marked PENDING PO APPROVAL. Findings stay out of the learning file and the REQ until the Product Owner's decisions are recorded in the decision block and the skill is re-run with --apply-approved, which then records approved rules and hands bugs to skill 10 and a REQ delta plus suggested test cases to skills 2 and 3 (from there the normal pipeline continues: skill 3 designs the TCs, a human approves them, skill 4 publishes them if the project uses Azure DevOps — optional, skipped for a local-only run — and skill 5 automates them; this skill never hands an artifact straight to skill 5). Never edits source code or the spec itself. Use when the user asks to "discover the code for this story", "what rules does the code enforce", "find hidden business rules", "compare code with spec", "export business rules from code", "what validations exist that are not in the spec", "field limits / uniqueness not documented", "reverse-engineer the story", "code vs spec".
argument-hint: "[<story-id>… | <feature-name> | <path/to/REQ-*.md> | <path/to/spec.md>] [--no-compare] [--reprofile] | --apply-approved <story-id>…"
license: Adapted from jeffallan/claude-skills@spec-miner (MIT, https://github.com/Jeffallan/claude-skills) for the Link_AI_Pro QA skill set.
---

# Discover Business Rules — code → spec gap export

You are a senior software engineer and QA analyst. The spec tells you what a User Story
*should* do. This skill tells the team what the code *actually* enforces — and, above all,
**which rules live only in the code**: the 50-character limit nobody wrote down, the unique
code check, the default status, the role that silently cannot delete. Those are the rules
that produce missed test cases and "works as designed" bugs.

Two hats, as in the original Spec Miner: the **Arch hat** follows data from the screen to the
database and back; the **QA hat** turns every branch, guard and constraint into an observable
behaviour a QC can test.

**Constraints**
- Write output ONLY to the story's requirement folder — `Testing/Requirements/[SPEC-{spec-name}/]US-{id}-{name}/` (the folder skill 2 created; the `SPEC-*` level exists for stories taken from a spec file)
  (or the folder the user names in 0.3) — one folder per User Story, never a shared file for
  several stories except the summary described in 5.4.
- **Findings are proposals until the Product Owner approves them.** The export file is marked
  `PENDING PO APPROVAL`. Nothing discovered by this skill is written to
  `Testing/project-learning.md`, to a REQ-*.md, or handed to skills 3/5 as fact until the
  decision block has been filled and the skill is re-run with `--apply-approved` (Phase 7).
  The only learning-file writes during discovery are answers the user gave to this skill's
  questions (0.0, *Ask second*) and one pointer line saying an export is awaiting approval.
- Never modify source code, configuration, the spec, or any REQ-*.md — proposals go in the
  export file, the QC and PO decide.
- Read-only exploration everywhere else. Every rule cites the file and line it came from.
- Observed fact ≠ inference. Mark each rule `Observed` (read in code) or `Inferred` (deduced
  from naming, comments, tests or data) and never promote an inference to a finding.

---

## Execution Workflow

Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 (discovery run). Do not skip phases. `--no-compare` stops
after Phase 3 (rule catalogue only, no spec comparison) — use it when there is no spec at all.
`--apply-approved` runs Phase 7 only: it reads a filled decision block and promotes the
approved rules (learning file + final REQ delta). Multi-story input → Phases 2-5 run once per
story (1.3).

---

## Phase 0 — Context

### 0.0 Consult `Testing/project-learning.md` (every run, before anything else)

<qa_manifest>
**Structure contract — read `Testing/qa-manifest.json` first.** Written by
`link-qc-1-generate-update-testing-structure`; it holds the project's QA paths (testing root,
requirements, manual test cases, automation root, pages, tests, reports, screenshots, logs,
white-box folder, learning file), the steering file paths, the framework config and every
documented deviation. Use its paths before any auto-detection; fall back to detection only when
the manifest is absent, and then tell the user to run `/link-qc-1-generate-update-testing-structure`
(audit first, then repair) — never invoke that skill yourself. Steering conflicts resolve per
the rules in `docs/steering/README.md` (L1 baseline, L2 refines, L3 values + stricter +
approved exemptions; specs govern business truth, steering governs quality policy, the learning
file overrides neither). Behaviour knowledge stays in `Testing/project-learning.md`.
</qa_manifest>

<project_learning_file>
**Project Learning File protocol — shared by skills 1-11, 3b and 3c (read first, ask second, write back).**

`Testing/project-learning.md` is the plain-English knowledge base for ALL QA skills
(created by `link-qc-1-generate-update-testing-structure`). This skill's section is
`### Rule Discovery Model (skill 11)`. If `Testing/` exists but the file does not, create it
with the skeleton defined in skill 1, section 2. If the file exists but this skill's section
is missing, add the section (`#### Knowledge`, `#### Questions and Answers`) without touching
anything else.

*Read first — targeted search, never the whole file:*
1. Read only the `## Index` block at the top (one row per module: pages, similar modules, sections).
2. From the story (title, feature, page names) pick the module / page / element names to look
   for; add the `Similar to` modules the Index lists for them.
3. Grep for those tags — `\[module: X\]`, `\[page: Y\]`, `\[similar: .*X` — plus
   `\[type: rule\]` in `## Project Knowledge`, in `### White-Box Model (skill 10)` and in this
   skill's section. Rules skill 10 already recorded are a head start, not a substitute for
   reading the code.
4. Before asking the user anything, grep this skill's `#### Questions and Answers` for the
   question's keywords.
5. Load a whole section only if it is under ~40 lines and the grep found nothing. A file
   under 80 lines may be read whole.

*Ask second:* anything still missing (not in the file, the task input, CLAUDE.md, or the
requirement sources) → ask the user in ONE combined message and WAIT. Never re-ask what the
file answers; state what you are reusing so the user can override it. Secrets are NEVER
written to the file.

*Write back — two stages, because findings need Product Owner approval first:*

**During a discovery run (Phases 0-6) write ONLY:**
- Every answered question → one tagged line under this skill's `#### Questions and Answers`:
  `- [module: X] [type: qa] **Q (skill 11, {YYYY-MM-DD}):** … — **A:** …`. Project-wide
  answers (e.g. where output files live) are ALSO added to `## Project Knowledge`.
- One pointer line per story under this skill's `#### Knowledge`:
  `- [module: X] [type: status] US-{id}: {N} undocumented rules exported {YYYY-MM-DD}, awaiting PO approval (see the story's requirement folder).`
- **Nothing else.** No rule, limit, message, default or permission discovered in the code goes
  into the learning file, however certain it looks — unapproved findings would otherwise be
  treated as facts by skills 3 and 5.

**After the PO decides (`--apply-approved`, Phase 7) write:**
- Every rule marked *Intended* in the decision block → one tagged line, plain English, in
  `## Project Knowledge` (project-wide rules) or this skill's `#### Knowledge` (feature
  rules), with `[type: rule]` and `(source: US-{id}, approved by PO {YYYY-MM-DD})`. Grep the
  same tags first; update or dedupe instead of appending twins.
- Limits, formats and messages the user will see → `## UI Knowledge`; boundary values worth
  testing → `## Test Data`; EN/AR differences → `## Locale Knowledge` — approved rules only.
- Rules marked *Bug* → one line `[type: bug]` pointing to skill 10; rules marked *Ignore* are
  not written at all.
- Modules that share the same rules → add `[similar: …]` on both entries instead of copying
  text. Update the `## Index` row for every module touched. Replace the pending pointer line
  with `approved {date}: {N} rules recorded, {M} bugs, {K} ignored`.
- Entries contradicted by the code or by a spec → correct them. Specs and steering always win.

*Content rules (translate code into behaviour):* plain English a QC can read; one fact per
line. Write "a KPI code must be unique per organisation; a duplicate is rejected with a
message" — never the method, class, file or variable that does it. No file paths, no
selectors, no code, no stack traces, no secrets, no requirement text copied verbatim.

*Report:* end the result message with
`**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}`.
</project_learning_file>

### 0.1 Steering documents

Read `docs/steering/README.md` and the L3 document (`docs/steering/L3-project-testing.md`)
for: the project's requirement sources, ID formats (`US-`, `REQ-`), the module list, and any
rule-documentation standard the team already follows. L1/L2 define how findings are graded;
do not restate them. Steering always wins over this skill's defaults.

### 0.2 Repository profile (reuse skill 10's)

```bash
cat "Testing/White_Box_Testing/.project-profile.md" 2>/dev/null || echo "NO_PROFILE"
```

- Profile found and `--reprofile` not passed → read it. Use its **layer map**, **search
  strategy**, **requirement sources** and **test suites** for every search below. Never
  hardcode paths that the profile can answer.
- `NO_PROFILE` or `--reprofile` → run Phase 0 of `link-qc-10-white-box-testing` (sections 0.2–0.7)
  exactly as that skill describes it and write the profile to the same location, so both
  skills share one profile. Then continue here.

### 0.3 Locate the requirements root and the story folder

Output lands in the folder skill 2 uses: `Testing/Requirements/[SPEC-{spec-name}/]US-{id}-{kebab-name}/`
(`{id}` digits only; `{kebab-name}` from the story title, lowercase, hyphens, ≤ 6 words).
The `SPEC-{spec-name}/` level exists only for stories that came from a spec FILE:
`{spec-name}` = the spec file stem, extension stripped, lowercase kebab-case, ≤ 6 words; a
generic stem (`spec`, `specification`, `requirements`, `prd`, `readme`) → the parent folder
name (`docs/specs/resource-request/spec.md` → `resource-request`). Stories from Azure DevOps,
Word or pasted text sit directly under `Testing/Requirements/`.

1. **Requirements root present** (`Testing/Requirements/` exists, or the legacy lowercase
   `Testing/requirements/`) → use it. Glob `Testing/Requirements/**/US-{id}-*/` first: if the
   story folder exists at any level, reuse it (and its level) and read the `REQ-*.md` and
   `US-{id}-review.md` inside. If it is missing, create it — under `SPEC-{spec-name}/` when the
   input was a spec file, otherwise directly under the root. Never create the same story at
   two levels.
2. **Requirements root missing** (no `Testing/Requirements/`, or no `Testing/` at all) →
   **do not create it and do not guess.** First grep the learning file (`[type: qa]` in this
   skill's Q&A and `## Project Knowledge`) for a recorded output location. If none, ask the
   user in the same combined question as any other missing input:

   ```text
   I could not find Testing/Requirements/ in this project. Where should the code-rules
   export for US-{id} be written?
     A) Create the standard layout now: Testing/Requirements/[SPEC-{spec-name}/]US-{id}-{name}/
        (recommended — or run link-qc-1-generate-update-testing-structure first for the full setup)
     B) An existing folder you name: <path>
   ```

   WAIT for the answer. Record it under this skill's `#### Questions and Answers` and in
   `## Project Knowledge` (if the learning file exists) so the next run does not ask again.
   Under B, still create one sub-folder per story inside the named path
   (`<path>/[SPEC-{spec-name}/]US-{id}-{name}/`).

---

## Phase 1 — Requirement Ingestion

### 1.1 Resolve the requirement

| Argument | Action |
|---|---|
| Path ending in `.md` / `.feature` / `.txt` | Read directly |
| Story ID or feature name | Search `Testing/Requirements/**/REQ-*.md` first, then the profile's requirement sources (`specs/**/spec.md`, story folders), then Azure DevOps by ID (Azure DevOps MCP) if configured. Several hits → prefer REQ-*.md > spec.md > story dump and cross-reference the others |
| Blank | Grep `Testing/project-learning.md` (Index + this skill's Q&A) for a recorded last story; if nothing, list the story folders found and ask which one, then record the answer |

If no spec exists at all, say so, switch to `--no-compare` behaviour automatically and tell
the user the export will be a **full rule catalogue** rather than a gap list.

### 1.2 Extract from the spec

Build the **Spec Rule List** — one row per rule the spec states or implies: field
constraints (required, length, format, range), uniqueness, defaults, allowed values and
states, transitions, permissions/roles, calculations, notifications, integration behaviour,
locale rules. Give each row the spec's own ID when it has one (`REQ-{id}-NN`), else `S-NN`.

Extract the **domain vocabulary**: entity nouns, field names as the spec calls them, action
verbs, role names, status/enum values, screen names. This drives Phase 2.

### 1.3 More than one User Story → split

Detect multi-story input before discovering code:

- a spec file with several story headings / IDs (same split rule skill 2 uses),
- several IDs passed as arguments,
- a feature name that resolves to more than one story folder or work item,
- code discovered in Phase 2 that clearly implements a second story's acceptance criteria.

Then:

1. List the stories found and confirm the split with the user in the combined question
   (unless the IDs were passed explicitly).
2. Run Phases 2-5 **once per story**, each with its own vocabulary, Spec Rule List, Rule
   Catalogue and export file in its own folder `…/US-{id}-{name}/US-{id}-code-rules.md`.
   When the split came from a spec FILE, every story folder sits under
   `{requirements-root}/SPEC-{spec-name}/` (same rule as skill 2 — see 0.3).
   Never merge two stories' findings into one file.
3. A rule enforced by code that serves several stories goes into the export of the story
   whose spec owns the entity/field; the other exports get one cross-reference line
   (`see US-{other} RULE-NN`) — no duplicate rule IDs across stories.
4. Write the cross-story summary described in 5.4.

---

## Phase 2 — Code Discovery for the Story

Drive every search from the profile's layer map. Work outward from the vocabulary:

### 2.1 Entry points

Find the screens, routes, endpoints, handlers, jobs and messages that belong to the story
(names from the vocabulary; route paths; menu/permission keys). Record each with file:line.

### 2.2 Follow the data — the rule-bearing layers

For every entity the story touches, read **all** of these where the profile says they exist:

| Layer | What it reveals | Typical carriers (stack-agnostic — use the profile) |
|---|---|---|
| **Persistence** | hard limits, nullability, uniqueness, defaults, FKs, cascades, soft-delete | migrations, DDL, ORM mappings, entity annotations, schema files |
| **Domain / entity** | invariants, computed fields, state machines, guards in setters/constructors | entity classes, value objects, enums, state/transition maps |
| **Validation** | required, min/max, regex, cross-field rules, uniqueness checks, custom messages | validators, DTO/annotation rules, form schemas, FluentValidation-style classes |
| **Service / application** | business decisions, duplicate handling, rounding, ordering, workflow steps, side effects | services, handlers, use-cases, command/query handlers |
| **Authorization** | who can create / edit / delete / approve; ownership; tenant scoping | guards, policies, permission attributes, role maps, row filters |
| **UI** | client-only limits (maxlength, disabled states), masks, default selections, hidden fields, messages | forms, components, view models, resource/translation files |
| **Configuration** | thresholds, feature flags, limits that are environment-driven | config files, settings tables, constants classes |
| **Tests** | intended behaviour the authors cared about; edge cases | unit/integration specs for the same entities |

### 2.3 Cross-cutting sweeps

Grep the whole repo (per the profile's search strategy) for the entity's field names and
enum values to catch rules enforced far from the feature: global validators, interceptors,
database triggers, scheduled jobs, reporting queries, import/export mappers, localisation
files with limit-bearing messages ("must not exceed", "already exists", "is required").

### 2.4 Record

Keep a **Discovery Map**: layer → files read → rules found. Every rule gets:
`RULE-NN · category · statement (EARS) · Observed/Inferred · enforced at (UI / server / DB / several) · evidence file:line · message shown (if any)`.

Validation checkpoint (from Spec Miner): before leaving Phase 2 confirm every entity in the
vocabulary has been traced through persistence **and** validation **and** service layers.
If a layer produced no hit, say so explicitly in the report rather than assuming "no rule".

---

## Phase 3 — Rule Catalogue (EARS)

Write every observed rule in EARS form (see `references/ears-format.md`), one per line,
grouped by category. Categories, in this order:

1. **Field constraints** — required/optional, length, precision, format/mask, allowed characters
2. **Uniqueness & identity** — unique names/codes/IDs, scope of uniqueness (global / per parent / per tenant), case sensitivity, trimming, ID generation
3. **Defaults & derived values** — default status/owner/date, computed totals, rounding, inheritance from parent
4. **Ranges, thresholds & limits** — min/max values, counts, dates (past/future), file size/type, pagination caps
5. **Lifecycle & state** — allowed transitions, terminal states, who can trigger, what becomes read-only
6. **Relationships & referential rules** — mandatory parents, cascade/restrict on delete, orphan handling, soft delete
7. **Permissions & scope** — role × action matrix as observed, ownership, tenant/organisation filters
8. **Duplicate & conflict handling** — what happens on a second submit, concurrent edit, re-import
9. **Messages & feedback** — exact validation texts, error codes, notifications (EN and AR if both exist)
10. **Integration & side effects** — jobs, emails, audit entries, external calls triggered by the story
11. **Locale & formatting** — date/number formats, RTL, per-language limits

EARS statement pattern: `When <trigger>, the system shall <action>` /
`While <state>, …` / `Where <config>, …`. Always name the layer:
*"(server) When a KPI is saved with a code already used in the same organisation, the system
shall reject the save with 'Code already exists'."*

Also produce the **Enforcement matrix**: for each rule, UI / server / DB — three columns.
A rule that exists only in the UI is a finding in itself (bypassable); a rule only in the DB
means the user gets a technical error instead of a message. Both are called out in Phase 4.

`--no-compare` → go to Phase 5 and export the full catalogue.

---

## Phase 4 — Compare with the Spec

Match every RULE-NN against the Spec Rule List:

| Verdict | Meaning | Goes to |
|---|---|---|
| **In spec** | spec states it, code matches | Coverage table only |
| **Partially in spec** | spec mentions the rule but not the value / scope / message (e.g. "name is required" vs code also caps at 100 chars) | Export, section A |
| **Not in spec** | code enforces it, spec silent | Export, section B — **the main deliverable** |
| **Contradicts spec** | code and spec disagree on value, scope or behaviour | Export, section C, flagged as a probable bug for skill 10 |
| **In spec, not in code** | spec states it, nothing enforces it | Export, section D — hand-off to skill 10 (gap) |

Rate each exported rule:
- **Impact** — High (data integrity, security, money, blocking the user) / Medium (usability,
  wrong message, silent truncation) / Low (cosmetic, internal default).
- **Confidence** — Observed / Inferred.
- **Test value** — how many test cases it would add (boundary pairs, negative cases, role variants).

---

## Phase 5 — Export

### 5.1 Write the export file

Write `Testing/Requirements/[SPEC-{spec-name}/]US-{id}-{name}/US-{id}-code-rules.md` (the story
folder located in 0.3) using
`references/report-template.md`. Sections, in order:

1. **Header** — story, spec source(s), profile date, commit sha, files analysed, counts
2. **Executive summary** — totals per verdict; the 5 most important undocumented rules
3. **A. Partially specified** — rule, what the spec says, what the code adds, evidence, proposed REQ wording
4. **B. Not in spec (business rules living only in the code)** — the export the user asked
   for: rule (EARS), category, enforced at, message, evidence, impact, confidence,
   **proposed requirement text** ready to paste into the REQ file, **suggested test cases**
   (title only, positive + boundary + negative)
5. **C. Contradictions** — spec vs code side by side, which one is probably wrong, hand-off to skill 10
6. **D. In spec, not in code** — hand-off list for skill 10
7. **Enforcement matrix** — RULE × (UI / server / DB) with UI-only and DB-only rules highlighted
8. **Coverage table** — every spec rule with its verdict and the RULE-NN that covers it
9. **Discovery map** — layers → files read, layers with no hits
10. **Unverified / assumptions** — everything Inferred, and anything the profile could not confirm
11. **QC / PO decision block** — a checklist the QC fills in with the Product Owner: for each B/C rule `☐ Intended → add to
    REQ` / `☐ Bug → raise` / `☐ Ignore (reason)`

### 5.2 Proposed REQ delta (never applied automatically)

Append to the export a fenced block `REQ delta — proposed` with ready-to-paste lines in
the REQ-*.md format (`REQ-{id}-NN` continuing the existing numbering) for every B and A rule.
Do **not** edit the REQ file. Tell the user skill 2 can re-review the story once the QC
accepts the delta.

### 5.3 Learning file — pointer only, no findings

Per the protocol in 0.0, a discovery run writes **only** the answers the user gave and one
`[type: status] … awaiting PO approval` pointer line per story. No rule, message, limit or
default from the export is written now. The export header carries
`**Status**: PENDING PO APPROVAL` and every section B/C rule is a proposal until Phase 7.

### 5.4 Cross-story summary (multi-story runs only)

When 1.3 split the input, also write `CODE-RULES-SUMMARY.md` next to skill 2's
`SPEC-REVIEW-SUMMARY.md`: inside `{requirements-root}/SPEC-{spec-name}/` when the stories came
from a spec file, at `{requirements-root}/CODE-RULES-SUMMARY.md` only when they were plain IDs
with no spec file. Contents: the stories analysed with links to each
export, per-story verdict counts, rules that span stories (with the owning story), and the
shared UI-only / DB-only warnings. It never repeats a rule's detail — the story files own them.

---

## Phase 6 — Report to the user

```
## Business Rules Discovered — US-{id} {title}

**Spec**: {REQ-*.md | spec.md | none (catalogue mode)}
**Profile**: {reused (generated {date}) | built new} — {stacks}
**Files analysed**: N across N layers · **Rules found**: N ({Observed} observed / {Inferred} inferred)

| Verdict | Count |
|---|---|
| In spec | N |
| Partially in spec | N |
| **Not in spec** | **N** |
| Contradicts spec | N |
| In spec, not in code | N |

**Top undocumented rules**
  RULE-004 (High) — {EARS one-liner} — {file:line}
  RULE-009 (High) — …
  RULE-011 (Medium) — …

**UI-only rules (bypassable)**: N · **DB-only rules (technical error, no message)**: N

**Export**: {requirements-root}/[SPEC-{spec-name}/]US-{id}-{name}/US-{id}-code-rules.md — **Status: PENDING PO APPROVAL**
{multi-story: one block per story + **Summary**: {requirements-root}/[SPEC-{spec-name}/]CODE-RULES-SUMMARY.md}
**Next**: QC reviews with the Product Owner and fills the decision block (Intended / Bug /
Ignore) → re-run this skill with `--apply-approved US-{id}` → approved rules reach the
learning file and the REQ delta → skill 2 folds them into the REQ → skill 3 adds the
suggested test cases → a human approves that document → skill 4 publishes it to Azure DevOps
(**optional** — skipped entirely for a local-only run) → skill 5 automates it. Contradictions
(C) and gaps (D) go to skill 10. **Nothing here is handed straight to skill 5**: a discovered
rule becomes automatable only after PO approval and a skill 3 test case.
**Learning file**: read {sections/tags} · updated {N Q&A added + 1 pending pointer — no findings recorded until PO approval}
```

---

## Phase 7 — Apply the Product Owner's decisions (`--apply-approved`)

Run only when the user says the decision block has been filled (by the QC with the PO, or by
the PO directly). Input: the story ID(s) or the export path(s).

1. Read `US-{id}-code-rules.md`; parse the **QC / PO decision block**. Every B and C rule must
   have exactly one decision (*Intended*, *Bug*, *Ignore*) and a `Decided by / date`. Rules
   without a decision → list them and stop for that story; do not apply partial approvals
   silently (ask whether to proceed with the decided subset).
2. Set the export header to `**Status**: APPROVED {YYYY-MM-DD} by {name}` and keep the file
   as the audit trail; do not delete rejected rules — they stay under *Ignore* with the reason.
3. Write the **final REQ delta** block (`REQ delta — approved`) containing only the *Intended*
   rules, numbered to continue the story's REQ file. Still do not edit the REQ-*.md — tell the
   user to run skill 2 to fold it in.
4. Now, and only now, teach the learning file (0.0, second stage): approved rules with
   `(source: US-{id}, approved by PO {date})`, UI limits and messages, boundary test data,
   `[similar: …]` links, Index rows; *Bug* rules as `[type: bug]` hand-offs to skill 10; the
   pending pointer line replaced by the approved summary.
5. Report: rules recorded / bugs handed to skill 10 / ignored, and the next steps (skill 2
   re-review with the approved delta → skill 3 test cases).

---

## Reference Guide

| Topic | Reference | Load when |
|---|---|---|
| EARS syntax and examples | `references/ears-format.md` | Writing Phase 3 statements |
| Rule catalogue — what counts as a rule and where it hides | `references/rule-catalogue.md` | Phase 2 discovery, Phase 3 grouping |
| Export template | `references/report-template.md` | Phase 5 |

---

## Notes

- **Never invent paths or rules.** Every rule cites a real search hit. A rule you expect but
  cannot find is listed under *Unverified*, not under B.
- **Value over volume.** Ten confirmed undocumented rules with proposed wording beat fifty
  restatements of what the spec already says.
- **This skill does not judge correctness.** Whether an undocumented rule is intended is the
  Product Owner's call, recorded by the QC in the decision block. Contradictions are handed to
  skill 10, which owns bug analysis.
- **No finding becomes knowledge before approval.** A discovery run leaves the learning file
  untouched except for Q&A and the pending pointer; only `--apply-approved` records rules.
- **One story, one folder, one export.** Multi-story input is split (1.3); a summary file
  links the exports but never holds rule detail.
- **Missing requirements root → ask, never assume.** The output location is the user's
  decision (0.3); remember it in the learning file so it is asked once.
- **Shared profile.** Keep using `Testing/White_Box_Testing/.project-profile.md`; never create
  a second profile format.
- **Learning file first.** Search before profiling and before asking; write every rule and
  answer back in plain English; never delete entries; never write secrets, paths or code
  identifiers there.
- Steering (per the resolution rules in `docs/steering/README.md`) and the spec always win
  over this skill's defaults and over the learning file.
