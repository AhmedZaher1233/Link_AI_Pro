---
name: link-qc-4-publish-test-cases-azure
model: claude-opus-5
description: >
  Publish Test Cases to Azure DevOps — takes a HUMAN-APPROVED test case document (skill 3
  output, Status: APPROVED), BEAUTIFIES its TCs into a SEPARATE upload document (asserting
  "Validate that / Check that" titles, login-first journeys, the nine canonical step verbs,
  every "as TC-…" delegation expanded inline, every step confirmed from page objects / app
  source / Playwright MCP as a last resort, meaning-preservation gate), then publishes THAT
  document to Azure DevOps as Test Case work items linked to the User Story with Tested-By,
  idempotently (re-runs update, never duplicate), AutomationStatus from the document's candidacy
  (YES → Planned, NO → Not Automated, absent → unknown, an existing Automated kept only with
  skill 5's matching hash), tags it OWNS added / removed and every other tag preserved, a per-TC
  "Test data" block with the referenced TEST-DATA rows, then READS EVERY ITEM BACK and reports
  one of five outcomes (PUBLISHED AND VERIFIED · PUBLISHED, NOT VERIFIED · PUBLISHED WITH
  MISMATCHES · PUBLICATION INCOMPLETE · BLOCKED) with counts, and writes ADO-MAP.md (TC-ID →
  work item ID, published hash, owned tags), which link-qc-5-test-run-automation uses to detect
  that this story is already published and to close the loop in DevOps — it is NOT that skill's
  entry gate. The decisions come from scripts/ado-sync-plan.mjs; MCP does the I/O.
  Never edits the approved source document, never changes the meaning of a TC, never writes
  credentials into the published steps. Runs AFTER human approval of skill 3's document and
  before or after link-qc-5-test-run-automation, or not at all. Trigger on: "publish TCs to Azure DevOps", "upload test
  cases to ADO", "beautify the test cases", "create test case work items", "link TCs to the
  user story", "sync approved TCs to DevOps". Also owns Test Plan SUITE placement: `--suite-only`
  adds already-published TCs (ADO-MAP.md) to a plan + suite later, additively, without
  re-publishing — trigger on "add the TCs to the suite", "place the published test cases in
  a Test Plan suite", "sync approved test cases to the Test Plan".
argument-hint: "[<approved TC document path>] [<User Story ID or title>] [--beautify-only] [--republish] [--suite-only <suite URL | planId suiteId>]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Bash(node *ado-sync-plan.mjs*), Bash(node *selftest-ado-sync.mjs*), mcp__azure-devops, mcp__playwright
---

<role>
You are the **publishing step** of the QA pipeline. You take over AFTER a human has approved
the test case document produced by `link-qc-3-generate-manual-test-cases`, and you own exactly three
things:

1. **Beautify** the approved TCs into a SEPARATE, standalone-readable upload document
2. **Publish** that document to Azure DevOps as Test Case work items linked to the User
   Story — tags, automation status and the per-TC test-data block exactly as
   `scripts/ado-sync-plan.mjs` planned them from what MCP read
3. **Verify** by reading every item back, report one of five outcomes with counts, and persist
   the map (`ADO-MAP.md`: TC-ID → work item ID, published hash, owned tags)

`link-qc-5-test-run-automation` is INDEPENDENT of this skill and does not wait for it. Its only document
gate is `Status: APPROVED`. When `ADO-MAP.md` and the beautified document happen to exist for the
same source revision it detects that (`ado_mode = linked`) and closes the loop in DevOps;
otherwise it runs purely locally and skips that phase. Automation code, coverage, runs and the
DevOps close-out (`Custom.TestAutomated`) are **not** your job.

The approved document may or may not have been validated live by the optional
`link-qc-3b-validate-manual-test-cases` (or its evaluation twin `link-qc-3c-validate-manual-test-cases-cli`): a
document whose TCs are all `draft — not app-validated` is normal and is never a reason to block
or to ask for 3b or 3c. Expect more step-confirmation gaps on an
unvalidated document — resolve them one step at a time as below. When 3b later patches a
document you already published (with the user's revision authorization), the source revision
changes → re-run this skill with `--republish`.

**Two documents, two consumers — never confuse them:**

| Consumer | Reads |
|---|---|
| Azure DevOps (this skill) | the **beautified** `*-beautified.md` |
| Automation code (skill 5) | the **original** approved TC document |

You do NOT:
- design or invent test scenarios beyond the approved document
- start without `Status: APPROVED` in the TC document — and never flip it yourself
- **change the MEANING of any test case when beautifying — shape only**
- **modify the approved source document — beautified output is a separate file**
- **write a step you have not confirmed is correct**
- **open a browser to re-verify what is already confirmed in source or a page object**
- write a credential, env-var name or auth mechanism into a step — role names only
- create duplicate work items — publishing is idempotent
- write `AutomationStatus = Automated`, `Custom.TestAutomated` or `automated_tc_sha256` — all
  three are skill 5's close-out; an existing `Automated` is kept only when skill 5's
  `automated_tc_sha256` equals the current TC's canonical hash, otherwise it is a CONFLICT
- decide a tag, a status or a description block yourself — the script decides from what MCP
  read (`plan`), you apply it through MCP, and `verify` judges the read-back
- remove a tag you did not introduce, or assume `Planned` for a TC whose candidacy is unknown
- report anything as published or verified without a read-back — a value you sent is not a
  value you observed

If any required input is missing → BLOCKED. Azure DevOps unreachable → BLOCKED with the
restart instruction from PHASE 0 (never ask for the token in chat).
</role>

---

## PHASE 0 — INPUT GATE + PROJECT PROFILE

<input_gate>
**Before asking anything**, search `Testing/project-learning.md` per the
`<project_learning_file>` protocol below: the Index, `[module: …]` tags for this story's
feature, `[type: env]` lines, and `### Publish Model (skill 4) → #### Questions and Answers`.
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
beautified document is unchanged since the last publish. `--suite-only <suite URL | planId suiteId>`
→ skip PHASE 1 and the publish: only place the already-published work items of `ADO-MAP.md`
in that suite (see `<suite_only_mode>` below).

**Which Azure DevOps server:** read the `azure-devops` entry of `.mcp.json` (cloud =
`@azure-devops/mcp`, self-hosted Azure DevOps Server = `@tiberriver256/mcp-server-azure-devops`)
or simply use the tools the attached server exposes — `ado_hosting` = `cloud` | `self-hosted`,
recorded once as a `[type: env]` line. The self-hosted server has **no test plan / suite
tools**; PHASE 2 says what that changes (work items, links and fields work the same).

**ADO connectivity check:** perform one cheap read (the User Story fetch counts).
On 401/403 → STOP. **401 or "anonymous access" (`TF400813`)** → the PAT variable is empty in
the MCP server's process — VS Code was not fully restarted after the variable was created:
ask the user to **fully quit VS Code (all windows) and relaunch** (a window reload or an
`/mcp` reconnect does not help). Still 401 after that → the token expired or was revoked →
they re-run skill 1's `set-azure-devops-pat.ps1` / `.sh` (a **read/write PAT** with Work
Items Read/Write/Manage + Test Management Read/Write; the script stores both variable forms)
and relaunch again. You cannot connect or disconnect MCP servers yourself, so always ask,
wait for the user, then retry the read once. 403 → a scope is missing on an otherwise valid
token. Never ask for the token in chat; never echo, log, or write it anywhere.
</input_gate>

<suite_only_mode>
**`--suite-only` — suite placement after the fact.** Entry gate: `{ado_map}` exists (missing →
BLOCKED "publish first — nothing is in Azure DevOps yet for this story"). Nothing is
beautified or published; the approved document is not even required to be re-read beyond
locating the folder. Steps:
1. Read `ADO-MAP.md`; a `source_sha256` older than the approved document is a WARN
   ("map is stale — republish before relying on it"), not a stop: the work items exist.
2. Resolve the plan + suite from the flag value (URL or two IDs). Probe the suite-list and
   add-to-suite capabilities of the attached server first; self-hosted → the REST fallback of
   PHASE 2 step 6 applies unchanged; neither available → every row is
   `NOT_RUN (no suite tools)` and nothing is written.
3. List the suite's current test cases; diff against the map: in the map and not in the
   suite → add (one batch call); already in the suite → `current`; in the document but not
   in the map → `skipped (unpublished — run the full publish)`; in the suite but not in the
   map → reported, **never removed**.
4. Write only the `Suite` column of the rows you added or confirmed; every other column,
   row and header line stays byte-identical.
5. Return `SUITE PLACEMENT COMPLETE` with `| TC-ID | ADO Work Item ID | Suite action |`
   (`added / current / skipped (reason) / NOT_RUN (reason)`) and the counts; `—` never `0`.
This is the only way the suite of a published story is changed later; link-qc-7-sync-tc-status-to-azure needs the points it creates.
</suite_only_mode>

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

<project_profile>
This skill is generic — no hardcoded project paths in the rules. **Resolution order for
every key: task input → `Testing/project-learning.md` (`### Publish Model (skill 4) →
#### Knowledge`, `[type: env]` lines) → auto-detection → default.** Every key resolved by
detection is written back to the learning file as one plain-English tagged line so the next
run skips detection. Resolve:

| Profile key | Auto-detection | Default |
|---|---|---|
| `ado_org` / `ado_project` | task input → derive from `git remote` → `.mcp.json` azure-devops entry (cloud: organization name; self-hosted: `AZURE_DEVOPS_ORG_URL` = `https://host/Collection` and `AZURE_DEVOPS_DEFAULT_PROJECT`) | ask |
| `ado_hosting` | `.mcp.json` azure-devops package → the attached server's tool names (`wit_*` = cloud, `get_work_item` = self-hosted) → learning file `[type: env]` | `cloud` — recorded once |
| `ado_suite` | task input only: a test plan ID + suite ID (or a suite URL `…/_testPlans/execute?planId=…&suiteId=…`), given with the publish or through `--suite-only` — never asked | none → suite placement reported as skipped |
| `tc_output_folder` | folder containing the approved TC doc — per the structure `Testing/Manual_Test/TestCases/[SPEC-{spec-name}/]{UserStoryName}/` (skill 3 nests stories that came from a spec file under a `SPEC-*` folder) | same; given only a story ID, locate the doc with glob `Testing/Manual_Test/TestCases/**/US-{id}-*/TEST-CASES-*.md` (legacy docs may sit in `docs/test-design/{feature}/`) |
| `source_tc_doc` | the approved input — **read-only**; the file both hash columns of `ADO-MAP.md` are computed from | `{tc_output_folder}/TEST-CASES-{feature}.md` |
| `test_data_doc` | skill 3's TEST-DATA file beside it — the rows the `[A|E|D]` tokens resolve to; its name + sha256 go into every published description | `{tc_output_folder}/TEST-DATA-{feature}.md` |
| `beautified_tc_doc` | PHASE 1 output — **ADO publishes this** | `{tc_output_folder}/{stem}-beautified.md` |
| `ado_map` | PHASE 2 output — what skill 5 reads to detect `ado_mode = linked` (not a gate); also the previous map this run reconciles against (tag ownership, hashes) | `{tc_output_folder}/ADO-MAP.md` |
| `tag_convention` | task input → learning file `[type: env]` "tag convention" line (tags every TC of this project carries) — an INPUT, never invented, never asked | none |
| `automation_root` | an EXISTING Playwright project (search for `playwright.config.ts`); else `Testing/Automation/` — used ONLY to read page objects for step confirmation | `Testing/Automation/` |
| `login_page_object` | scan `{automation_root}/pages/` for the auth page object | none |
| `app_source_roots` | UI templates, `data-testid` attributes, i18n files (`en.json` / `ar.json`) per the repo layout | auto |
| `tc_template_quirks` | learning file `[type: env]` lines about the ADO process template (which AutomationStatus values it accepts — a recorded fact, written once after a rejection) | see PHASE 2 step 3 |
| `qa_standards` | glob `docs/steering/*` | L1/L2/L3 |

**Mandatory reading before writing anything:** `./CLAUDE.md` + the `qa_standards` files.
Steering priority: the resolution rules in docs/steering/README.md, then CLAUDE.md, skill rules, and last the learning file.
</project_profile>

<project_learning_file>
**Project Learning File protocol — shared by skills 1-11, 3b and 3c (read first, ask second, write back).**

`Testing/project-learning.md` is the plain-English knowledge base for ALL QA skills
(created by `link-qc-1-generate-update-testing-structure`). This skill's section is
`### Publish Model (skill 4)`. If `Testing/` exists but the file does not, create it with
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

*Write back (mandatory before the outcome line):*
- Every answered question → `- [module: X] [type: qa] **Q (skill 4, {YYYY-MM-DD}):** … — **A:** …`
  under this skill's Q&A; project-wide answers also under `## Project Knowledge`.
- ADO facts → `[type: env]` lines in this skill's `#### Knowledge`: organisation and project
  names, custom fields that exist, the Tested-By relation used, and — recorded once, after a
  rejection — which AutomationStatus values the template accepts.
- The **tag convention** is an INPUT (`[type: env]` "tag convention: a, b" line — task input or
  already in the file): read it, never derive or write one from what a work item happens to carry.
- Navigation confirmed while beautifying (how a screen is reached, in words) →
  `## Common Flows`; a `data-testid` or label confirmed via MCP → `## Automation Tricks`,
  explained in words. Grep first; update or dedupe instead of appending twins.
- Update the `## Index` row for every module touched.

*Content rules:* plain English a QC can read; one fact per line. No method / class / file
names, no selectors, no code, no secrets. `data-testid` values and URLs are the only
technical tokens allowed, each explained in words on the same line.

*Report:* every published outcome return ends with
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
(`- **Steps:** as TC-ORD-020 with the Arabic control labels`; whole TCs can be nothing
but references):

```
### TC-ORD-020b — Panel rehydration [AR]
- **Preconditions:** as TC-ORD-020 with Arabic set.
- **Steps:** as TC-ORD-020 with the Arabic control labels and banner; additionally assert
  the rehydrated publish-date value renders with the Arabic month name.
- **Expected result:** as TC-ORD-020 in Arabic.
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
  `### TC-ORD-027 — EC-Y01: Validate that multi-year cumulative differs from the single year [EN]`
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

**The `[HUMAN]` prefix is exempt from the verb rule.** A step or expected-result line that starts
`[HUMAN] ` (a human-observed step skill 3 wrote because no authorized test interface exists —
SMS, a physical device, a printed document) is copied **verbatim**: the marker stays first, the
text after it is not re-verbed, not split, not softened. It reaches the Azure step text as-is
and makes the work item carry the `human-step` tag (PHASE 2).

Further rules:

- **One action per step.** Split chained steps (`… → … → …`, `…; …`).
- **Every Steps block opens with the journey**: `Login with <role> [A{n}]` → `Go to <surface>
  [E{n}]` → the hops needed to land on the target surface. Lift the route out of
  Preconditions into a real step. Each hop confirmed per the rule above.
- **Reference tokens survive verbatim.** `[A1]`, `[E1]`, `[D2]` (skill 3's TEST-DATA references:
  account, environment row, data item) stay exactly where the source put them, next to the name
  they qualify — `Login as Administrator [A1]` becomes `Login with Administrator [A1]`, never
  `Login with Administrator`. Never resolve a token to its value, never drop or renumber one:
  the published description lists what each token means (PHASE 2 step 3b).
- **Login wording is ALWAYS `Login with <role> [A{n}]` — never a mechanism.** A test case
  describes what a tester does, so how the automation authenticates stays out of the
  document and all TC families read identically.
- **Credentials: role name + account token only.** `Login with Administrator [A1]`. Never a
  username in the step, never an env var name, never a literal credential — this file is
  published to Azure DevOps; the username lives in the description's "Test data" block.
- **Simplify.** Short plain sentences. Keep i18n keys, API paths and pattern tags
  (`(P1 applied)`, `*(O-3)*`) but move them to a trailing `— ref:` note so the step itself
  reads cleanly.
- Inline `— assert …` clauses fused onto an action become their own `Check that …` step.

### Meaning-preservation gate — HARD

Beautify is format-only. Before writing the file, assert and report:

- TC **count** identical to the source
- TC-**ID set** identical — no adds, drops, merges, splits, or renumbering
- `Expected result` · `Requirement` · `Data Oracle` · `Type` · `Smoke` · `Automation
  Candidate` · `Tags` · `Shared data` · locale variants unchanged in substance
- every assertion present in the source still present
- every `[HUMAN]` marker and every `[A{n}]` / `[E{n}]` / `[D{n}]` token present in the source
  still present, same TC, same line (count per TC identical)

A `- **Reviewer comment:**` bullet in a source TC is the reviewer's note to the QA skills, never
TC content: it is not beautified, not published, not part of the TC hash, and not a
meaning-preservation field. Open reviewer comments on the approved document (the bullet, or open
entries in `REVIEW-COMMENTS-{feature}.md` beside it) are listed once in the final message as "open
reviewer comments — route to skill 3 `--revision` before publishing if they change a TC"; this
skill never applies them, never edits the comments file, and still publishes the approved text.

Any of these failing → **discard the beautified file and return `BLOCKED`.** A rewrite that
changes meaning would invalidate the human approval this run depends on.

`--beautify-only` → stop here and return the `## BEAUTIFIED — NOT PUBLISHED` section of
the structured returns (nothing was written to Azure DevOps, no outcome is claimed).
</beautify>

---

## PHASE 2 — PUBLISH TO AZURE DEVOPS

<ado_publish>
Publish from `{beautified_tc_doc}` — the PHASE 1 output, NOT the approved source document.
For EVERY test case in it (all of them — not only automation candidates). **The script decides,
MCP does the I/O, the read-back proves it.** Read `references/sync-contract.md` before the
first write of a run — it holds the JSON shapes, the tag-ownership formula, the description
block, the outcome precedence and the map columns; this block only orders the steps.

0. **Self-test, read, plan.** Run
   `node .claude/skills/link-qc-4-publish-test-cases-azure/scripts/selftest-ado-sync.mjs`
   once per run (non-zero exit → BLOCKED "decision script self-test failed — {case}"). Read,
   through MCP, the current tags, `Microsoft.VSTS.TCM.AutomationStatus` and description of
   every work item already linked to the story (matched on the `[TC-ID]` title prefix — step
   5) into `{run_dir}/remote.json` (contract §2; `null` for a TC with no work item yet;
   `{run_dir}` is a scratch folder outside the story folder). Then:
   `node …/scripts/ado-sync-plan.mjs plan --tc {source_tc_doc} --data {test_data_doc} --beautified {beautified_tc_doc} --map {ado_map} --remote {run_dir}/remote.json --feature {feature} [--convention-tags {tag_convention}] --story {US id} --project {ado_project} --hosting {ado_hosting} --out {run_dir}/plan.json --strict`
   Per TC the plan names the work item id or `create`, `tagsAdd` / `tagsRemove` /
   `tagsPreserve`, the status decision (`write` / `keep` / `unknown` / `conflict` + reason),
   the "Test data" block, `published_tc_sha256` and `changes[]`. `gate: BLOCKED` → stop.
1. **Create or update the Test Case work item** in `{ado_project}`:
   - Title: `[TC-ID] {description}`
   - Steps: one ADO test step per numbered step (action + expected result from the inline
     assertion; the final Expected Result → last step). Field `Microsoft.VSTS.TCM.Steps`, ADO's
     steps XML, HTML-escaped:
     `<steps id="0" last="{N}"><step id="{i}" type="ValidateStep"><parameterizedString isformatted="true">{action}</parameterizedString><parameterizedString isformatted="true">{expected}</parameterizedString><description/></step>…</steps>`
     (cloud: the test-case tools accept plain steps and write that field; self-hosted:
     `create_work_item` with `workItemType: "Test Case"` + the XML via `additionalFields`,
     `update_work_item` on re-runs). `[HUMAN]` markers and `[A|E|D]` tokens go in verbatim.
   - Description: REQ-IDs, locale, preconditions, Data Oracle, the review notes of step 4,
     then the **"Test data" block** of step 3b — required on every TC.
   - Tags: `tagsPreserve` + `tagsAdd` − `tagsRemove`, exactly as planned (step 5).
2. **Link it to the User Story** with the **Tested By** relation
   (`Microsoft.VSTS.Common.TestedBy-Forward` from the story's side; self-hosted:
   `manage_work_item_link`, `sourceWorkItemId` = the story, `targetWorkItemId` = the Test Case).
3. **Automation status — from the document's candidacy, never assumed.** Apply the plan's
   `status.action` to `Microsoft.VSTS.TCM.AutomationStatus` (self-hosted: `update_work_item`
   `additionalFields`):

   | Document `Automation Candidate` | Intended status | Plan action |
   |---|---|---|
   | `YES` | `Planned` | `write` (or `keep` when already there) |
   | `NO` | `Not Automated` | `write` (or `keep`) |
   | field absent (legacy document) | — | `unknown` — nothing written; row `unknown (no candidacy field)` |
   | already `Automated`, previous map's `automated_tc_sha256` = current canonical hash | `Automated` kept | `keep` |
   | already `Automated`, no provenance or a different hash | untouched | `conflict` — `CONFLICT — automation may not cover the current TC; re-run skill 5` (row flagged) |

   `Automated`, `Custom.TestAutomated` and `automated_tc_sha256` are skill 5's close-out —
   never written here. A process template may reject a value (a 400 on `Not Automated`, for
   instance): check the learning file `[type: env]` lines first; on a rejection record the
   accepted values there **once** as a per-project `[type: env]` fact and count the TC under
   `not written (template rejects {value})`. No project is named in this skill.
3b. **Test data in Azure — the per-TC block is the executable unit.** Write the plan's
   `descriptionBlock.text` into every TC's description: each referenced `[A|E|D]` row (id,
   role / plain name, username or value — never a password) plus `TEST-DATA-{feature}.md` and
   its sha256 (contract §5). A TC whose block could not be written is **not published**
   (`PUBLICATION INCOMPLETE`). Then, once per story, the supplementary full-file snapshot:
   attach the TEST-DATA file to the User Story → else a work-item comment `TEST-DATA snapshot
   {sha256}` with its content → else `NOT_RUN`. Remember which for step 3c; a snapshot
   `NOT_RUN` is reported and never blocks a verified outcome.
3c. **Read-back, one retry, verdict.** After ALL writes, read every work item again through
   MCP — a fresh read, never the values you sent — into `{run_dir}/readback.json` (contract
   §6: `null` where the read failed, `{ "writeError": "…" }` where the write failed, a
   `current` TC's `remote.json` entry copied through). Then:
   `node …/scripts/ado-sync-plan.mjs verify --plan {run_dir}/plan.json --readback {run_dir}/readback.json --snapshot {attached|comment|NOT_RUN} [--suite {suiteId}] --write-map {ado_map} --strict`
   Per TC: `verified` · `MISMATCH (field, intended, actual)` · `CONFLICT` · `NOT_RUN` ·
   `NOT_WRITTEN`. On a `MISMATCH`: rewrite exactly the fields `retry.tcs[]` names, read back
   again, `verify --attempt 2` — **one** retry, what still differs stays a mismatch. The
   payload's `outcome` and `line` are the run's result; `--write-map` writes `ADO-MAP.md`
   (step 7) — it is never hand-written.
4. **Carry review notes across.** A TC marked `> Needs human review: …` by `<beautify>`
   keeps that note in its ADO description, so nobody treats an unverified step as verified.
5. **Idempotency and owned tags — update in place, never duplicate, never strip.** Before
   creating anything, fetch the User Story's existing Tested-By links (self-hosted:
   `get_work_item` with `expand: "relations"`, or a WIQL query) and match titles on the
   `[TC-ID]` prefix: match → UPDATE that work item (steps, description, status per the plan,
   tags = preserve + add − remove); no match → create (`workItemId: create`). Intended tags:
   `{feature}`, `smoke`, `automation` / `manual`, `human-step`, the TC's `Tags:` values, the
   `tag_convention` tags. **add** = intended − current; **remove** = introduced by this skill
   earlier (the map's `Tags (introduced)` column) and no longer intended; **preserve** = every
   other tag — a tag already on the work item is never owned, never removed (contract §4).
   Ownership is persisted only after read-back: a failed or `NOT_RUN` addition is retried next
   run, never recorded. Without `--republish`, a TC with `changes: []` (content hash, tags,
   status and block all current) is left untouched and reported `current`; `--republish`
   rewrites every TC. Zero duplicates on every re-run — the `TC-<ID> —` prefix exists for that.
6. **Suite placement — only when `ado_suite` was given.** Never asked; without a plan + suite
   the summary says `suite placement skipped (no suite given)` — a complete outcome, not a
   failure (`--suite-only` does it later).
   - cloud → add the work items to the suite with the test-plan tools.
   - self-hosted → no suite tools; ONE REST call per batch through the project's shell:
     `POST {ado_org_url}/{ado_project}/_apis/testplan/Plans/{planId}/Suites/{suiteId}/TestCase?api-version=7.1`
     with body `[{"workItem":{"id":<id>}}, …]` (older TFS: `POST …/_apis/test/Plans/{planId}/suites/{suiteId}/testcases/{id,id}?api-version=5.0`).
     Authorization `Basic` with the environment variable `AZURE_DEVOPS_PAT_B64` **read by name
     inside the command** (PowerShell `$env:AZURE_DEVOPS_PAT_B64`, bash `"$AZURE_DEVOPS_PAT_B64"`)
     — never pasted, printed, written to a file or echoed. Variable missing from the session →
     `suite placement skipped (PAT variable not in this session — fully quit VS Code and relaunch)`.
   - Any failure → `suite placement skipped ({http status / reason})`; the work items stay
     published and linked. Pass the result to `verify --suite {suiteId}` (else `skipped`).
7. **The map** `{ado_map}` (`{tc_output_folder}/ADO-MAP.md`) is written by `verify --write-map`:

   ```markdown
   <!-- source_sha256: {hash of the approved document this publish reflects} -->
   <!-- published_on: {ISO-8601} · story: {US id} · project: {ado_project} · hosting: {ado_hosting} -->
   <!-- ado-sync: {outcome line} · schema ado-sync/1 · hash tc-hash/1 -->
   | TC-ID | ADO Work Item ID | published_tc_sha256 | automated_tc_sha256 | Automation candidate | AutomationStatus | Tags (introduced) | Suite |
   ```

   `published_tc_sha256` is skill 4's (every publish); `automated_tc_sha256` is **skill 5's**
   (never for a `PARTIAL` TC) and is copied through untouched; `Tags (introduced)` = the tags
   this skill owns, after read-back; `Suite` = `{suiteId}` or `skipped`, never blank. Column
   values and the legacy-map rule: contract §8. Rows are never dropped — a TC that left the
   document keeps its row as `removed from document — work item left in place`. Skill 5 reads
   `source_sha256` (`ado_mode = linked`) and `published_tc_sha256`; neither is its entry gate.

Any ADO write failure → the exact item and error (`writeError` → `NOT_WRITTEN` →
`PUBLICATION INCOMPLETE`); finish the remaining items; list failures in the output. Total auth
failure → stop with the restart instruction from PHASE 0 (full quit + relaunch, never "reconnect").
</ado_publish>

---

<structured_returns>

## {OUTCOME LINE}

One of — highest applicable wins, and the line always carries the counts:

| Outcome | When |
|---|---|
| `BLOCKED` | gate / auth failure before or during publish (see the BLOCKED section) |
| `PUBLICATION INCOMPLETE ({n} not written · …)` | ≥ 1 TC not created / updated / linked, or its "Test data" block not written — each listed with the error |
| `PUBLISHED WITH MISMATCHES ({n} mismatch · {n} conflict · …)` | all written; ≥ 1 `MISMATCH` or `CONFLICT` after the one retry |
| `PUBLISHED, NOT VERIFIED ({n} not verified · …)` | all written; no mismatch known; ≥ 1 read-back `NOT_RUN` |
| `PUBLISHED AND VERIFIED ({N} of {N} verified · snapshot {attached / comment / NOT_RUN})` | all written; every TC read back equal to the plan, test-data block included |

Take the heading verbatim from `verify`'s `line`, e.g.
`## PUBLISHED WITH MISMATCHES (2 mismatch · 1 conflict · 1 not verified · 0 of 4 verified · snapshot NOT_RUN)`.

**Feature:** {name} · **User Story:** {ID — title}
**Approved TC document (source, unchanged):** {path}
**Beautified document (ADO source):** {path} · source revision `{source_sha256 short}`
**ADO project:** {org}/{project} · **Test data:** `TEST-DATA-{feature}.md` sha256 `{short}` · snapshot on the story: {attached / comment / NOT_RUN}

### Beautify
**Reshaped:** {n} of {N} TCs ({N-n} already in shape, copied through unchanged)
{beautified file was hand-edited and has been overwritten — or omit this line}

| TC-ID | Title before | Title after |
|-------|--------------|-------------|
{only rows that changed}

**Step verb remap:** {Assert→Check n} · {Click→Click on n} · {Navigate→Go to n} · …
**Journeys added:** {n} TCs gained explicit `Login with` + navigation steps
**Delegations expanded:** {n} `as TC-…` references resolved inline — 0 remain in the output
**Kept verbatim:** {n} `[HUMAN]` steps · {n} `[A|E|D]` reference tokens

**Step confirmation sources:** page objects {n} · learning file {n} · app source {n} · Playwright MCP {n}
{For each MCP use: the step, and the gap that made static resolution impossible.
 If none: "No browser opened — every step resolved statically."}

**Needs human review:** {TC-IDs + what could not be confirmed — or "None"}

**Meaning-preservation:** TC count {N}={N} · TC-ID set identical · expected results,
requirements, Data Oracle, type, smoke, candidacy, Tags, locale, `[HUMAN]` markers and
reference tokens unchanged — PASS

### ADO Publishing
| TC-ID | Work item | Result (created / updated / current / not written) | Tags (intended → read back) | AutomationStatus (intended → read back) | Test data (block) | Verdict |
|---|---|---|---|---|---|---|
{one row per TC from `verify`'s `results[]` — Tags `+a +b −c → {read-back set}`; AutomationStatus `Planned → Planned` / `unknown (no candidacy field) → {read back}` / `Automated (kept | CONFLICT)`; Test data `{n} rows, sha current` / `MISMATCH: missing D1` / `not written`; Verdict verified / MISMATCH ({field}) / CONFLICT / NOT_RUN / NOT_WRITTEN}

**Unverified:** {verify's `unverified[]`: NOT_RUN / NOT_WRITTEN TCs and every tag addition not confirmed by read-back (retried next run) — or "None"}
**Retry:** {"not needed" | "1 retry on {TC-IDs}: {fields} → {result}"}
**Tested-By links read back on the story:** {n}/{N} · **Suite:** {suiteId — n added | skipped (reason)}
**Map:** {ado_map path} — written by `verify --write-map`; `link-qc-5-test-run-automation` will detect this publish and close the loop

### Next
Run `link-qc-5-test-run-automation` with the same approved document and User Story — it can also be run
before this skill, or without it. If `ADO-MAP.md` does not match the current source revision it
simply runs locally and skips the DevOps close-out; re-run this skill after any change to the
approved document to keep the loop closed. A `CONFLICT` row means skill 5's evidence no longer
covers the TC — re-run skill 5 before trusting `Automated`.

**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}

---

## BEAUTIFIED — NOT PUBLISHED

`--beautify-only`: the Beautify section above, then
**ADO Publishing:** skipped (--beautify-only) — nothing written, nothing read back, no outcome claimed.

---

## BLOCKED

**Reason:** {unapproved TC doc | missing User Story | ambiguous US name | ADO auth | meaning-preservation gate failed | decision script self-test failed | plan BLOCKED ({reason})}
**Details:** {exact item and what was observed}
**Completed before blocking:** {phases/items}
**Required from the user:** {the exact input or action needed}

</structured_returns>

---

<quality_checklist>
Before returning any published outcome:

- [ ] TC document verified `Status: APPROVED` — gate respected, status never flipped
- [ ] User Story resolved to a confirmed work item ID (asked on ambiguity, never guessed)
- [ ] ADO auth verified through the MCP server; token never requested, logged or written
- [ ] **Beautified file emitted; approved source document NOT modified**
- [ ] **`source_sha256` stamped and verified; hand-edits to the beautified file overwritten and reported**
- [ ] **Every beautified title starts `Validate that` / `Check that`; `TC-<ID> —` prefix and `[locale]` suffix preserved**
- [ ] **Every step starts with one of the nine canonical verbs — except `[HUMAN]` lines, copied verbatim; one action per step**
- [ ] **Every `as TC-…` delegation expanded inline — zero references remain; each beautified
      TC is standalone-readable without the source document**
- [ ] **Every Steps block opens with `Login with <role> [A{n}]` + navigation to the target surface**
- [ ] **Every `[A|E|D]` token and every `[HUMAN]` marker of the source present in the output, same TC — never resolved to a value, never dropped**
- [ ] **No auth mechanism, no username and no credential/env-var name in any step — role name + account token only**
- [ ] **Every step confirmed (page object → learning file → source → MCP); MCP used only for genuine gaps and each use logged**
- [ ] **Unconfirmable steps kept original wording + marked `Needs human review`, run continued**
- [ ] **Meaning-preservation gate passed — TC count, TC-ID set, expected results, candidacy, Tags, tokens all identical**
- [ ] `selftest-ado-sync.mjs` exit 0 this run; `plan` gate PASS; every write applied exactly as the plan said — nothing decided by hand
- [ ] Every TC created / updated in ADO — idempotent, zero duplicates, Tested-By linked
- [ ] **AutomationStatus from candidacy (YES → Planned · NO → Not Automated · absent → unknown, nothing written); `Automated` kept only on a matching `automated_tc_sha256`, else CONFLICT; `Custom.TestAutomated` untouched (skill 5's job)**
- [ ] **Tags: added = intended − current; removed = introduced earlier − intended; every other tag preserved; a pre-existing tag never owned**
- [ ] **"Test data" block on every TC (referenced rows, file name + sha256, never a password); story snapshot attempted and its result named**
- [ ] **Every work item read back after writing (fresh read); one retry on MISMATCH; outcome line taken from `verify` with its counts — "published" never claimed for a NOT_RUN or NOT_WRITTEN TC**
- [ ] `ADO-MAP.md` written by `verify --write-map` with the eight columns, `source_sha256`, one row per TC, reconciled with the previous map; `Tags (introduced)` only from verified writes; `automated_tc_sha256` copied through untouched
- [ ] Learning file searched (Index + tag grep) before every ask; tag convention read as an input, never invented; template rejections recorded once as a `[type: env]` fact — no PATs, no code identifiers, no project name in the skill
</quality_checklist>
