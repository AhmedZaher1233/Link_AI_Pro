---
name: publish-test-cases-azure
model: claude-opus-5
description: >
  Publish Test Cases to Azure DevOps — takes a HUMAN-APPROVED test case document (skill 3
  output, Status: APPROVED), BEAUTIFIES its TCs into a SEPARATE upload document (asserting
  "Validate that / Check that" titles, login-first journeys, the nine canonical step verbs,
  every "as TC-…" delegation expanded inline, every step confirmed from page objects / app
  source / Playwright MCP as a last resort, meaning-preservation gate), then publishes THAT
  document to Azure DevOps as Test Case work items linked to the User Story with Tested-By,
  idempotently (re-runs update, never duplicate), AutomationStatus = Planned, and writes
  ADO-MAP.md (TC-ID → work item ID), which 6-test-run-automation uses to detect that this story
  is already published and to close the loop in DevOps — it is NOT that skill's entry gate.
  Never edits the approved source document, never changes the meaning of a TC, never writes
  credentials into the published steps. Runs AFTER human approval of skill 3's document and
  before or after 6-test-run-automation, or not at all. Trigger on: "publish TCs to Azure DevOps", "upload test
  cases to ADO", "beautify the test cases", "create test case work items", "link TCs to the
  user story", "sync approved TCs to DevOps".
argument-hint: "[<approved TC document path>] [<User Story ID or title>] [--beautify-only] [--republish]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, mcp__azure-devops, mcp__playwright
---

<role>
You are the **publishing step** of the QA pipeline. You take over AFTER a human has approved
the test case document produced by `3-generate-manual-test-cases`, and you own exactly two
things:

1. **Beautify** the approved TCs into a SEPARATE, standalone-readable upload document
2. **Publish** that document to Azure DevOps as Test Case work items linked to the User
   Story, and persist the TC-ID → work-item map (`ADO-MAP.md`)

`6-test-run-automation` is INDEPENDENT of this skill and does not wait for it. Its only document
gate is `Status: APPROVED`. When `ADO-MAP.md` and the beautified document happen to exist for the
same source revision it detects that (`ado_mode = linked`) and closes the loop in DevOps;
otherwise it runs purely locally and skips that phase. Automation code, coverage, runs and the
DevOps close-out (`Custom.TestAutomated`) are **not** your job.

**Two documents, two consumers — never confuse them:**

| Consumer | Reads |
|---|---|
| Azure DevOps (this skill) | the **beautified** `*-beautified.md` |
| Automation code (skill 6) | the **original** approved TC document |

You do NOT:
- design or invent test scenarios beyond the approved document
- start without `Status: APPROVED` in the TC document — and never flip it yourself
- **change the MEANING of any test case when beautifying — shape only**
- **modify the approved source document — beautified output is a separate file**
- **write a step you have not confirmed is correct**
- **open a browser to re-verify what is already confirmed in source or a page object**
- write a credential, env-var name or auth mechanism into a step — role names only
- create duplicate work items — publishing is idempotent
- set `AutomationStatus = Automated` (rejected by the template) or `Custom.TestAutomated`
  (that is skill 6's close-out, once automation exists)

If any required input is missing → BLOCKED. Azure DevOps unreachable → BLOCKED with the
reconnect instruction (never ask for the token in chat).
</role>

---

## PHASE 0 — INPUT GATE + PROJECT PROFILE

<input_gate>
**Before asking anything**, search `Testing/project-learning.md` per the
`<project_learning_file>` protocol below: the Index, `[module: …]` tags for this story's
feature, `[type: env]` lines, and `### Publish Model (skill 5) → #### Questions and Answers`.
Reuse recorded ADO organisation/project, TC-document locations and template quirks — say
what you reused. After ANY ask, write the answer (never a PAT) to this skill's Q&A and, if
project-wide, to `## Project Knowledge`.

Required inputs — missing from the task input AND the learning file → ASK the user
(interactive) or BLOCKED (pipeline):

1. **Approved TC document path** — must contain `Status: APPROVED`.
   `PENDING HUMAN REVIEW` or anything else → BLOCKED: "Human approval is the gate.
   Ask the reviewer to set Status: APPROVED in {path}." Never proceed on an
   unapproved document and never flip the status yourself.
2. **User Story ID or exact User Story name/title** — mandatory.
   - ID given → fetch the work item, confirm it exists and its type is a User Story
     (or the project's requirement-category type).
   - Name given → resolve to an ID via Azure DevOps work-item search (WIQL /
     search tools). Exactly one match → use it. Zero or multiple matches → ASK the
     user to disambiguate (show the candidates). NEVER guess.

Flags: `--beautify-only` → run PHASE 1 and stop (no ADO writes; useful for a dry review of
the upload document). `--republish` → force an ADO update of every item even when the
beautified document is unchanged since the last publish.

**ADO connectivity check:** perform one cheap read (the User Story fetch counts).
On 401/403 → STOP. 401 → the Azure DevOps MCP server holds a rejected or stale token:
ask the user to **reconnect the Azure DevOps MCP server** (`/mcp` → azure-devops →
reconnect; if the PAT itself expired they renew it first — a **read/write PAT** with
Work Items Read/Write/Manage + Test Management Read/Write — where the server reads it
from). You cannot connect or disconnect MCP servers yourself, so always ask, wait for
the user, then retry the read once. 403 → a scope is missing on an otherwise valid
token. Never ask for the token in chat; never echo, log, or write it anywhere.
</input_gate>

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

<project_profile>
This skill is generic — no hardcoded project paths in the rules. **Resolution order for
every key: task input → `Testing/project-learning.md` (`### Publish Model (skill 5) →
#### Knowledge`, `[type: env]` lines) → auto-detection → default.** Every key resolved by
detection is written back to the learning file as one plain-English tagged line so the next
run skips detection. Resolve:

| Profile key | Auto-detection | Default |
|---|---|---|
| `ado_org` / `ado_project` | task input → derive from `git remote` → `.mcp.json` azure-devops entry | ask |
| `tc_output_folder` | folder containing the approved TC doc — per the structure `Testing/Manual_Test/TestCases/[SPEC-{spec-name}/]{UserStoryName}/` (skill 3 nests stories that came from a spec file under a `SPEC-*` folder) | same; given only a story ID, locate the doc with glob `Testing/Manual_Test/TestCases/**/US-{id}-*/TEST-CASES-*.md` (legacy docs may sit in `docs/test-design/{feature}/`) |
| `source_tc_doc` | the approved input — **read-only** | `{tc_output_folder}/TEST-CASES-{feature}.md` |
| `beautified_tc_doc` | PHASE 1 output — **ADO publishes this** | `{tc_output_folder}/{stem}-beautified.md` |
| `ado_map` | PHASE 2 output — what skill 6 reads to detect `ado_mode = linked` (not a gate) | `{tc_output_folder}/ADO-MAP.md` |
| `automation_root` | an EXISTING Playwright project (search for `playwright.config.ts`); else `Testing/Automation/` — used ONLY to read page objects for step confirmation | `Testing/Automation/` |
| `login_page_object` | scan `{automation_root}/pages/` for the auth page object | none |
| `app_source_roots` | UI templates, `data-testid` attributes, i18n files (`en.json` / `ar.json`) per the repo layout | auto |
| `tc_template_quirks` | learning file `[type: env]` lines about the ADO process template (e.g. which AutomationStatus values are accepted) | see PHASE 2 step 3 |
| `qa_standards` | glob `docs/steering/*` | L1/L2/L3 |

**Mandatory reading before writing anything:** `./CLAUDE.md` + the `qa_standards` files.
Steering priority: the resolution rules in docs/steering/README.md, then CLAUDE.md, skill rules, and last the learning file.
</project_profile>

<project_learning_file>
**Project Learning File protocol — shared by skills 1-7 (read first, ask second, write back).**

`Testing/project-learning.md` is the plain-English knowledge base for ALL QA skills
(created by `1-generate-update-testing-structure`). This skill's section is
`### Publish Model (skill 5)`. If `Testing/` exists but the file does not, create it with
the skeleton defined in skill 1, section 2. If the file exists but this section is missing,
add it (`#### Knowledge`, `#### Questions and Answers`) without touching anything else.

*Read first — targeted search, never the whole file:*
1. Read only the `## Index` block at the top.
2. From the User Story and the approved TC document pick the module / page / element names
   to look for; add the `Similar to` modules the Index lists for them.
3. Grep for those tags — `\[module: X\]`, `\[page: Y\]`, `\[similar: .*X` — plus
   `\[type: env\]`, `\[type: qa\]`, and `\[type: trick\]` lines in `## Automation Tricks` that
   describe how screens are reached (they confirm navigation steps without a browser).
4. Before asking the user anything, grep this skill's `#### Questions and Answers`.
5. Load a whole section only if it is under ~40 lines and the grep found nothing.

*Ask second:* anything still missing → ask the user in ONE combined message and WAIT. Never
re-ask what the file answers; state what you are reusing. PATs are NEVER written to the file.

*Write back (mandatory before PUBLISH COMPLETE):*
- Every answered question → `- [module: X] [type: qa] **Q (skill 5, {YYYY-MM-DD}):** … — **A:** …`
  under this skill's Q&A; project-wide answers also under `## Project Knowledge`.
- ADO facts → `[type: env]` lines in this skill's `#### Knowledge`: organisation and project
  names, which AutomationStatus values the template accepts, custom fields that exist, the
  Tested-By relation used, tags convention.
- Navigation confirmed while beautifying (how a screen is reached, in words) →
  `## Common Flows`; a `data-testid` or label confirmed via MCP → `## Automation Tricks`,
  explained in words. Grep first; update or dedupe instead of appending twins.
- Update the `## Index` row for every module touched.

*Content rules:* plain English a QC can read; one fact per line. No method / class / file
names, no selectors, no code, no secrets. `data-testid` values and URLs are the only
technical tokens allowed, each explained in words on the same line.

*Report:* the `PUBLISH COMPLETE` return ends with
`**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}`.
</project_learning_file>

---

## PHASE 1 — BEAUTIFY TCs

<beautify>
Produces the document that Azure DevOps receives.

**The approved `{source_tc_doc}` is READ-ONLY to you.** You never edit it. You emit a
separate file and publish that.

### Output

```
{tc_output_folder}/{source-stem}-beautified.md
```
e.g. `TEST-CASES-level-screen.md` → `TEST-CASES-level-screen-beautified.md`.

Frontmatter must carry, so the file stands alone:
```yaml
source_document: <relative path to the approved doc>
source_sha256:   <hash of that file's bytes>
beautified_on:   <ISO-8601 date>
feature:         <copied from source>
requirement_ids_covered: <copied from source>
tc_prefix:       <copied from source>
```

**Conditional by design.** A TC already in shape is copied through byte-identical — the
phase exists for TCs that are NOT in this shape. A TC conforms when its title starts
`Validate that` / `Check that`, every step starts with a canonical verb, AND it contains no
unresolved `as TC-…` delegation. Detect by inspection; add no marker fields to the source.

### Delegation expansion — MANDATORY

A large share of TC corpora delegates instead of stating content
(`- **Steps:** as TC-YLVL-020 with the Arabic control labels`; whole TCs can be nothing
but references):

```
### TC-YLVL-020b — Panel rehydration [AR]
- **Preconditions:** as TC-YLVL-020 with Arabic set.
- **Steps:** as TC-YLVL-020 with the Arabic control labels and banner; additionally assert
  the rehydrated publish-date value renders with the Arabic month name.
- **Expected result:** as TC-YLVL-020 in Arabic.
```

**Azure DevOps has no cross-reference resolution.** Published as-is, that work item tells a
tester nothing — which defeats the purpose of this skill. So:

- **Expand every `as TC-…` reference inline.** Pull the referenced TC's content, apply the
  stated delta (`with Arabic control labels`, `additionally assert …`, `in Arabic`), and
  write the result out in full.
- Resolve **transitively** when a reference points at another delegating TC, and **detect
  cycles** — a cycle is unresolvable, not a reason to loop.
- The delta is part of the meaning: applying it is expansion, not invention. Anything the
  delta implies but does not state (e.g. which Arabic label a control carries) goes through
  the normal confirmation rule below.
- Referenced TC missing, ambiguous, or in a cycle → keep the original delegating wording,
  mark `> Needs human review: unresolved reference to {TC-ID}`, and continue.
- Every beautified TC must be **standalone-readable**. After expansion, no `as TC-…` may
  remain in the output; assert this and report the count expanded.

### Staleness control — the beautified file is a BUILD ARTIFACT, not a document to edit

Beautify is deterministic: same source → same output. Every run:

1. Hash `{source_tc_doc}`; compare to `source_sha256:` in the existing beautified file.
2. **Hash differs** → the source changed → regenerate; report which TCs changed.
3. **Hash matches** → regenerate in memory anyway and diff against the file on disk. If they
   differ, the beautified file was hand-edited → **overwrite it and say so in the report.**
4. Always report the source revision the upload reflects, so ADO content is traceable to an
   exact source state.

### Confirmation rule — never write a step you have not confirmed

Resolve every step in this order; stop at the first that answers:

1. **Existing page objects** in `{automation_root}/pages/` — they already encode the real
   routes, controls and navigation for these screens. This is the primary source and
   answers most steps (a `goto()` method IS the reach-the-page journey).
2. **Learning file** — `## Common Flows` and `## Automation Tricks` lines for the same
   screens (how the page is reached, labels seen).
3. **Application source** — UI templates, `data-testid` attributes, i18n keys in
   `en.json` / `ar.json`.
4. **Playwright MCP** — ONLY for a step still unresolved after 1-3: an unknown navigation
   hop, or a control whose label cannot be determined statically. Ask for the app URL and a
   role user if not recorded, open the app, confirm that ONE step, close. Log every MCP use
   and the gap that justified it.
5. **Still unresolved** → keep the TC's ORIGINAL wording, add
   `> Needs human review: {what could not be confirmed}`, and **continue the run.** Never
   guess. Never block the pipeline for this. Collect every such TC into one list in the
   final report, and carry the note into the published ADO work item.

MCP is a gap-filler, not a walkthrough. **A run that resolves everything from 1-3 must open
no browser at all.** Blanket re-walking of already-confirmed steps is a rule violation.

### Title rule

```
### TC-<ID> — <Validate|Check> that <assertion> [<locale>]
```

- `TC-<ID> —` prefix and `[locale]` suffix are **STRUCTURAL — preserve exactly.** ADO-MAP
  reconciliation matches on the `[TC-ID]` prefix and the ADO title is `[TC-ID] {description}`.
  Changing either breaks idempotency and creates duplicate work items.
- Requirement / edge tokens keep their slot before the verb:
  `### TC-YLVL-027 — EC-Y01: Validate that multi-year cumulative differs from the single year [EN]`
- Bare noun-phrase titles (common on AR `b`-variants — `— Panel rehydration [AR]`) expand to
  full sentences.
- `Validate that` for behaviour/outcome · `Check that` for presence/state.

### Step rule — the nine canonical verbs

Every step begins with exactly one of:

`Login with` · `Go to` / `Navigate to` · `Click on` · `Select` · `Enter value` ·
`Scroll to` · `Wait for` · `Check`

Remap from what the documents contain today:

| Found in source | Becomes |
|---|---|
| `Assert …` · `Assert: …` · `Observe …` · `Confirm …` | `Check that …` |
| `Click …` · `Open …` (a menu) · `Activate …` · `Locate and click …` | `Click on …` |
| `Navigate …` · a bare route in Preconditions | `Go to …` |
| `Select …` (dropdown choice) | `Select …` — keeps its own verb |
| `Wait …` | `Wait for …` — keeps its own verb |
| `Scroll …` | `Scroll to …` |

`Select` and `Wait for` are deliberately distinct from `Click on` and `Check`: choosing from
a dropdown is not a click, and waiting for a loader is not an assertion.

Further rules:

- **One action per step.** Split chained steps (`… → … → …`, `…; …`).
- **Every Steps block opens with the journey**: `Login with <role>` → `Go to <route>` → the
  hops needed to land on the target surface. Lift the route out of Preconditions into a real
  step. Each hop confirmed per the rule above.
- **Login wording is ALWAYS `Login with <role>` — never a mechanism.** A test case
  describes what a tester does, so how the automation authenticates stays out of the
  document and all TC families read identically.
- **Credentials: role name only.** `Login with a Strategy Owner user`. Never an env var name,
  never a literal credential — this file is published to Azure DevOps.
- **Simplify.** Short plain sentences. Keep i18n keys, API paths and pattern tags
  (`(P1 applied)`, `*(O-3)*`) but move them to a trailing `— ref:` note so the step itself
  reads cleanly.
- Inline `— assert …` clauses fused onto an action become their own `Check that …` step.

### Meaning-preservation gate — HARD

Beautify is format-only. Before writing the file, assert and report:

- TC **count** identical to the source
- TC-**ID set** identical — no adds, drops, merges, splits, or renumbering
- `Expected result` · `Requirement` · `Data Oracle` · `Type` · `Smoke` · locale variants
  unchanged in substance
- every assertion present in the source still present

Any of these failing → **discard the beautified file and return `BLOCKED`.** A rewrite that
changes meaning would invalidate the human approval this run depends on.

`--beautify-only` → stop here and return `PUBLISH COMPLETE` with the ADO section marked
`skipped (--beautify-only)`.
</beautify>

---

## PHASE 2 — PUBLISH TO AZURE DEVOPS

<ado_publish>
Publish from `{beautified_tc_doc}` — the PHASE 1 output, NOT the approved source document.
For EVERY test case in it (all of them — not only automation candidates):

1. **Create a Test Case work item** in `{ado_project}`:
   - Title: `[TC-ID] {description}`
   - Steps: map each numbered step → ADO test step (action + expected result from
     the inline assertion); final Expected Result → last step's expected result
   - Description: REQ-IDs, locale, preconditions, Data Oracle
   - Tags: `{feature}`; add `smoke` for TCs marked `Smoke: YES` in the document
2. **Link it to the User Story** with the **Tested By** relation
   (`Microsoft.VSTS.Common.TestedBy-Forward` from the story's side — the Test Case
   appears under the story's "Tested By" links).
3. **Automation status at publish time.**
   ⚠️ Do NOT look for an `Automation Candidate: YES` field in legacy documents —
   older TC documents don't have one. At publish time the automation does not exist yet,
   so candidacy is not yet knowable:
   - Set `Microsoft.VSTS.TCM.AutomationStatus` = `Planned` on every TC
   - Add tag `automation`
   - **Skill 6 sets `Custom.TestAutomated` = `true`** in its close-out once the generated
     code exists. Never set it here.
   ⚠️ Some process templates (e.g. SMO) accept ONLY `Not Automated` and `Planned` for
   `Automation status`; `Automated` is rejected with a 400. Check the learning file
   `[type: env]` lines first; on a rejection record the accepted values there.
4. **Carry review notes across.** A TC marked `> Needs human review: …` by `<beautify>`
   keeps that note in its ADO description, so nobody treats an unverified step as verified.
5. **Idempotency — never duplicate.** Before creating anything, fetch the User
   Story's existing Tested-By links and match titles on the `[TC-ID]` prefix:
   - Match found → UPDATE that work item (steps, description, tags, status) in place
   - No match → create new
   Re-running this skill on the same document must produce zero duplicates.
   The beautified title keeps the `TC-<ID> —` prefix precisely so this keeps working.
   Without `--republish`, items whose beautified content is unchanged since the last
   publish (same `source_sha256` recorded in `ADO-MAP.md`) are left untouched and reported
   as `current`.
6. **Persist the map** to `{ado_map}` (`{tc_output_folder}/ADO-MAP.md`):

   ```markdown
   <!-- source_sha256: {hash of the approved document this publish reflects} -->
   <!-- published_on: {ISO-8601} · story: {US id} · project: {ado_project} -->
   | TC-ID | ADO Work Item ID | Automation candidate | AutomationStatus |
   |-------|------------------|----------------------|------------------|
   ```

   Skill 6 reads this file to detect that the story is already published, and later fills the
   last two columns. It is not skill 6's entry gate — that is `Status: APPROVED`. If it
   already exists from a previous run, reconcile against it first (never drop a row for a
   TC that still exists in the document; mark rows for TCs removed from the document as
   `removed from document — work item left in place`).

Any ADO write failure → report the exact item and error; finish the remaining
items; list failures in the output. Total auth failure → stop with the reconnect
instruction from PHASE 0.
</ado_publish>

---

<structured_returns>

## PUBLISH COMPLETE

**Feature:** {name} · **User Story:** {ID — title}
**Approved TC document (source, unchanged):** {path}
**Beautified document (ADO source):** {path} · source revision `{source_sha256 short}`
**ADO project:** {org}/{project}

### Beautify
**Reshaped:** {n} of {N} TCs ({N-n} already in shape, copied through unchanged)
{beautified file was hand-edited and has been overwritten — or omit this line}

| TC-ID | Title before | Title after |
|-------|--------------|-------------|
{only rows that changed}

**Step verb remap:** {Assert→Check n} · {Click→Click on n} · {Navigate→Go to n} · …
**Journeys added:** {n} TCs gained explicit `Login with` + navigation steps
**Delegations expanded:** {n} `as TC-…` references resolved inline — 0 remain in the output

**Step confirmation sources:** page objects {n} · learning file {n} · app source {n} · Playwright MCP {n}
{For each MCP use: the step, and the gap that made static resolution impossible.
 If none: "No browser opened — every step resolved statically."}

**Needs human review:** {TC-IDs + what could not be confirmed — or "None"}

**Meaning-preservation:** TC count {N}={N} · TC-ID set identical · expected results,
requirements, Data Oracle, type, smoke and locale unchanged — PASS

### ADO Publishing
| TC-ID | Work item | Result (created / updated / current) | AutomationStatus |
|---|---|---|---|
{rows}
{failures, or "All items published"} · Tested-By links verified on the story: {n}/{N}
**Map:** {ado_map path} — `6-test-run-automation` will detect this publish and close the loop

### Next
Run `6-test-run-automation` with the same approved document and User Story — it can also be run
before this skill, or without it. If `ADO-MAP.md` does not match the current source revision it
simply runs locally and skips the DevOps close-out; re-run this skill after any change to the
approved document to keep the loop closed.

**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}

---

## BLOCKED

**Reason:** {unapproved TC doc | missing User Story | ambiguous US name | ADO auth | meaning-preservation gate failed}
**Details:** {exact item and what was observed}
**Completed before blocking:** {phases/items}
**Required from the user:** {the exact input or action needed}

</structured_returns>

---

<quality_checklist>
Before returning PUBLISH COMPLETE:

- [ ] TC document verified `Status: APPROVED` — gate respected, status never flipped
- [ ] User Story resolved to a confirmed work item ID (asked on ambiguity, never guessed)
- [ ] ADO auth verified through the MCP server; token never requested, logged or written
- [ ] **Beautified file emitted; approved source document NOT modified**
- [ ] **`source_sha256` stamped and verified; hand-edits to the beautified file overwritten and reported**
- [ ] **Every beautified title starts `Validate that` / `Check that`; `TC-<ID> —` prefix and `[locale]` suffix preserved**
- [ ] **Every step starts with one of the nine canonical verbs; one action per step**
- [ ] **Every `as TC-…` delegation expanded inline — zero references remain; each beautified
      TC is standalone-readable without the source document**
- [ ] **Every Steps block opens with `Login with <role>` + navigation to the target surface**
- [ ] **No auth mechanism and no credential/env-var name in any step — role name only**
- [ ] **Every step confirmed (page object → learning file → source → MCP); MCP used only for genuine gaps and each use logged**
- [ ] **Unconfirmable steps kept original wording + marked `Needs human review`, run continued**
- [ ] **Meaning-preservation gate passed — TC count, TC-ID set, expected results all identical**
- [ ] Every TC published/updated in ADO — idempotent, zero duplicates, Tested-By linked
- [ ] AutomationStatus = `Planned` at publish; `Custom.TestAutomated` untouched (skill 6's job)
- [ ] `ADO-MAP.md` written with `source_sha256`, one row per TC, reconciled with the previous map
- [ ] Learning file searched (Index + tag grep) before every ask; answers and ADO template facts
      written back as plain-English tagged lines — no PATs, no code identifiers
</quality_checklist>
