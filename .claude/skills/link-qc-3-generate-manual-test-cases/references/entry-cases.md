# Intake, entry cases and project profile — load at workflow steps 1-3 and 5

## 1. Intake gate — ask BEFORE starting the flow

Before anything else — before entry-case resolution, before reading specs, before any MCP
call — check what the task input already provides:

- Feature name / User Story ID (one story, or several)
- Do manual TCs already exist? If yes, where (file path / Azure DevOps / Word / text)?
- Spec or requirement source (file path, or the Azure DevOps story to retrieve)
- Implementation status, if the tester knows it
- Output folder, if non-standard
- Review-page language (`review_page_language`, §3) — one rule, never a question: *"The output
  language of a run is English unless this run's task input asks for another language
  (`--lang ar` or an explicit sentence). Nothing else decides it: not the source language, not a
  saved learning-file answer, not the document's `Review page language:` line, not an existing
  Arabic sidecar."* An Arabic requirement gets English narrative (descriptions, steps, expected
  results) with its quoted application labels kept in Arabic. A learning-file line from an
  earlier release recording an "Output language" answer is ignored and mentioned once in the
  final message — never reused, never rewritten.

**If ANY required item is missing or ambiguous → ask the user in ONE combined intake message
listing exactly what is needed, and WAIT for the reply. Do NOT start any phase, read specs,
resolve the entry case, or navigate anywhere on assumptions.**

Skip the ask only when every needed item is already provided in the task input or reliably
recorded in the learning file — and state explicitly what you are reusing so the user can
override it.

**Always state the resolved `tc_output_folder`** (and `requirements_folder` in Case 2) in the
chat before designing anything — for single-story runs as well as for the multi-story split —
so the user can override the location before a file is written. Once stated, the path is
immutable for the run (SKILL.md invariant 9b).

(This skill never asks for an application URL or credentials — it opens no browser. Those
belong to the optional `link-qc-3b-validate-manual-test-cases`.)

Every question follows `open-questions.md`: search the learning file and previous answers first,
then ask with the gap, affected TC-IDs, evidence, a recommendation and its reason, alternatives,
and what stays pending — and never act on an unanswered recommendation.

## 2. Resolve the entry case

If the intake answers still leave the entry case ambiguous, re-ask via §1 — NEVER assume
which case applies.

| Entry case | Trigger | Route |
|---|---|---|
| **Case 1 — Existing manual TCs** | The tester states the User Story already has manual TCs (file path, Azure DevOps test cases, Word document, or pasted text) | Ingest existing TCs → start from the TC writing/normalization phase (`tc-design.md` — existing-TC update) → then continue automatically to the self-review and delivery |
| **Case 2 — No TCs and no spec file** | No existing TCs AND no spec/requirement file exists for the story | Retrieve the User Story from Azure DevOps / Word → generate a requirement file into the requirements folder → FRESH DESIGN from that file |
| **Case 3 — Story not implemented (cross-cutting)** | Stated by the tester at intake, or shown by an existing `link-qc-10-white-box-testing` report — never detected live here (§4) | Keep requirement-based TCs, mark them `not-implemented — pending implementation`, list them under Pending implementation; 3b re-checks the status live when it runs |
| **Default** | Spec exists, no existing TCs | FRESH DESIGN (design phase) |

### Case 1 — Existing manual TCs as the starting point

1. **Locate and read the existing TCs** using whichever source the tester names:
   - Markdown/text file in the repo (Read) — including the manual test-cases folder
   - Azure DevOps Test Case work items / test suites — cloud server: `testplan_*` + `wit_*`
     tools; self-hosted Azure DevOps Server (`@tiberriver256/mcp-server-azure-devops`): no test
     plan / suite tools, so list them with `search_work_items` / `list_work_items` (WIQL on work
     item type `Test Case`, linked to the story) and read each with `get_work_item` — suite
     membership cannot be read there; say so instead of guessing it
   - Word document (`mcp__docx`: `open_document` → `export_markdown` / `get_body_text`). No docx MCP attached → ask the user to export the document
     to markdown/text or paste its content; BLOCKED only if they cannot.
   - Text pasted directly in the task input
   If the stated source cannot be read → BLOCKED naming the exact source and error.
2. **Use the existing TCs as the baseline** — do NOT generate everything from scratch.
   Normalize them into this skill's TC format (`tc-design.md` format table), preserving their
   original IDs where possible (record an ID mapping if renumbered).
3. **Start from the TC writing/normalization phase** (`tc-design.md` — existing-TC update), reviewing the existing set
   against the User Story / specification:
   - **Missing coverage** — ACs, requirement IDs, negative categories, locales, and edge cases
     with no covering TC → add new TCs.
   - **Duplicate or redundant TCs** — merge or remove; log every merge/removal.
   - **Incorrect or outdated TCs** — steps, labels, or expected results that contradict the
     current spec → update them; log old → new.
   - TCs still correct → keep unchanged (marked `kept`).
4. Produce an **Existing-TC Analysis table** (included in the deliverable):
   | Original TC | Disposition (kept / updated / merged / removed / new) | Reason |
5. After completing the TC writing phase, **continue automatically** to the self-review and the
   deliverables — do not stop and wait between phases.

Implementation-status handling inside Case 1 (§4):
- **Story implemented / status unknown** → every TC leaves `draft — not app-validated`; nothing
  changes. Existing TCs that carry a 3b validation state and were kept unchanged keep it; ones
  you update are reset to `draft — not app-validated (stale — revised)`.
- **Story NOT implemented** (stated by the tester or a skill-4 report) → keep the
  requirement-based TCs, mark them `not-implemented — pending implementation`, and keep
  requirement/coverage gaps strictly separate from pending implementation (a missing screen is
  NOT a bug finding when the story was never implemented; this skill records no defects).

### Case 2 — No manual TCs and no specification file

Flow: **User Story → Retrieve from Azure DevOps / Word → Generate Requirement File →
Generate Manual TCs → Review**

1. Retrieve the User Story + acceptance criteria from Azure DevOps using the Azure DevOps MCP —
   read the work item by ID or search by exact title with whichever tools the attached server
   exposes (cloud: `wit_get_work_item` / `search_workitem`; self-hosted Azure DevOps Server:
   `get_work_item` / `search_work_items`). On 401/403 STOP: **401 or "anonymous access"
   (`TF400813`)** → the PAT variable is empty in the MCP server's process → ask the user to
   **fully quit VS Code (all windows) and relaunch** (a window reload or an `/mcp` reconnect does
   not help; still 401 after that → the token expired or was revoked → they re-run skill 1's
   `set-azure-devops-pat.ps1` / `.sh` and relaunch again) — you cannot connect or disconnect MCP
   servers yourself, so always ask, wait, then retry once; 403 → missing scope on the PAT. Never
   ask for the token in chat. If the
   source is a Word document, use `mcp__docx` (`open_document` → `export_markdown`) instead (same fallback as Case 1 when it is not
   attached). If neither source is reachable → BLOCKED.
2. Convert the User Story into a **structured requirement/specification file**: title, story ID,
   description, numbered acceptance criteria, derived requirement IDs (`REQ-{storyID}-NN`, one
   per testable statement), roles, out-of-scope notes, and open questions.
3. Store it in the story's own folder inside the requirements tree —
   `{requirements_folder}/REQ-{storyID}-{feature}.md` (`{requirements_folder}` already ends in
   `US-{storyID}-{kebab-name}/`; the same per-story layout `link-qc-2-review-requirements` writes).
   When the story came from a spec FILE (a `.md`/`.txt`/`.docx` given as the source), the
   folder sits under `SPEC-{spec_name}/` — see the profile table. Check that folder FIRST
   (glob `{paths.requirements}/**/US-{storyID}-*/`): if `link-qc-2-review-requirements` already
   produced a `REQ-*.md` there, reuse it — and its folder location — instead of regenerating.
4. Use that requirement file as `spec_sources` for TC generation — the normal FRESH DESIGN flow
   (the design phase onward) then applies unchanged.

### Multi-story input — split, never merge

When the input names more than one User Story (several IDs, or a spec file holding multiple
stories), split it the way `link-qc-2-review-requirements` and `link-qc-11-discover-business-rules` do:

1. List the stories you detected and state the split in one message before designing anything.
   When the input is a spec FILE, also state the derived `{spec_name}` and the spec folder
   `{paths.manualTestCases}/SPEC-{spec_name}/` that will hold every story of that spec.
2. Run the whole per-story flow (entry case → deliverables) once per story. Every story gets its own
   `{tc_output_folder}` folder, its own `TEST-CASES-{feature}.md` and its own
   `TC-REVIEW-{feature}.html`. Stories from a spec file: `{tc_output_folder}` =
   `{paths.manualTestCases}/SPEC-{spec_name}/US-{storyID}-{kebab-name}/`. Stories given as
   Azure DevOps IDs with no spec file: `{paths.manualTestCases}/US-{storyID}-{kebab-name}/`.
   No rule changes per story.
3. Shared knowledge discovered for story A (common flows, labels, fixtures) is reused for
   story B — record it in the learning file once, not per story.
4. Only when more than one story was processed, also write `TC-GENERATION-SUMMARY.md`: one row per
   story (story ID · folder · TC count · weighted coverage · implementation status · open
   findings count · data gaps (missing / impossible / unknown, from that story's
   `TEST-DATA-*.md`)) plus cross-story findings. Location: inside the spec folder
   (`{paths.manualTestCases}/SPEC-{spec_name}/TC-GENERATION-SUMMARY.md`) when the stories came
   from a spec file; at `{paths.manualTestCases}/TC-GENERATION-SUMMARY.md` only when they were
   plain Azure DevOps IDs with no spec file.
5. One story unblockable (spec missing, TCs unreadable) does not stop the others: finish every
   story you can and list the blocked ones with the reason.

## 3. Project profile — resolve before reading anything else

This skill is generic. It has NO hardcoded project paths. **Resolution order for every key:
explicit value in the task input → `Testing/qa-manifest.json` → auto-detection → ask the
user.** Never invent a URL, a credential, or a spec path.

| Profile key | Manifest key | Detection fallback |
|---|---|---|
| `feature` / `stories` | — | task input (required) — ask if missing |
| `entry_case` | — | §2 — ask if ambiguous |
| `existing_tcs_source` | — | task input (Case 1 only) — ask if Case 1 and missing |
| `spec_sources` | `paths.requirements` (per-story `REQ-*.md`) | CLAUDE.md "Spec Source" table; `docs/specs/*`; Case 2 generates one |
| `qa_standards` | `steering.readme`, `steering.L1`, `steering.L2`, `steering.L3` | glob `docs/steering/*` |
| `required_locales` | — | `qa_standards` / CLAUDE.md i18n rules; ask when neither states them |
| `review_page_language` | — | language of `TC-REVIEW-{feature}.html` only (the markdown deliverables are always English). Resolution: this run's task input (`--lang ar|en` / an explicit sentence) → default `English`. Nothing else — not the source language, not a learning-file line, not the document's existing `Review page language:` line, not a sidecar on disk — and it is never asked. This is the *document* language for the human reviewer — distinct from `required_locales`, which are the application locales the TCs must cover |
| `implementation_status` | — | tester's intake answer → newest `{white_box_reports}/**/US-{storyID}-*/{storyID}-*-analysis.md` (or a legacy flat report) → else `Cannot be validated — not yet checked live` (§4). Never probed live here |
| `spec_name` | — | **First rule — path wins:** when the resolved `spec_sources` path contains `/SPEC-{x}/` (a `REQ-*.md` under `Testing/Requirements/SPEC-{x}/…`), `spec_name` = `{x}` — always; a REQ under a SPEC folder counts as spec-file origin. **Else**, when the source is a spec FILE: file stem, extension stripped, lowercase kebab-case, ≤ 6 words (`Resource Request Hours v2.docx` → `resource-request-hours-v2`); a generic stem (`spec`, `specification`, `requirements`, `prd`, `readme`) → use the parent folder name (`docs/specs/resource-request/spec.md` → `resource-request`). **Else** empty (ADO / Word / pasted stories, REQ directly under `Testing/Requirements/US-…/`) |
| `spec_level` | — | `SPEC-{spec_name}/` when `spec_name` is set, otherwise empty. The same rule `link-qc-2-review-requirements` uses. **Immutable once resolved for the run** |
| `UserStoryName` | — | `US-{storyID}-{kebab-name}` — identical to the requirement folder name skill 2 used |
| `tc_output_folder` | `paths.manualTestCases` + `/{spec_level}{UserStoryName}/` | `Testing/Manual_Test/TestCases/[SPEC-{spec_name}/]US-{storyID}-{kebab-name}/` — MUST contain `SPEC-{spec_name}/` whenever the REQ path does; never a flat `US-*` folder for a story whose REQ sits under a `SPEC-*` parent |
| `requirements_folder` | `paths.requirements` + `/{spec_level}US-{storyID}-{kebab-name}/` | `Testing/Requirements/[SPEC-{spec_name}/]US-{storyID}-{kebab-name}/` |
| `white_box_reports` | `paths.whiteBox` | `Testing/White_Box_Testing/` |
| `learning_file` | `paths.learningFile` | `Testing/project-learning.md` |

If a key cannot be resolved and the user does not answer → BLOCKED naming the exact missing key.

**Directory structure rule:** deliverables ALWAYS follow the
`link-qc-1-generate-update-testing-structure` layout — every User Story's TCs live in their own folder
`{tc_output_folder}` (both the markdown and the HTML review page). The TC folder MIRRORS the
requirement folder's position relative to the requirements root: a story whose `REQ-*.md` sits at
`Testing/Requirements/SPEC-{spec_name}/US-{id}-{name}/` gets its TCs at
`Testing/Manual_Test/TestCases/SPEC-{spec_name}/US-{id}-{name}/`; a story directly under
`Testing/Requirements/US-{id}-{name}/` gets `Testing/Manual_Test/TestCases/US-{id}-{name}/`.
Before creating a TC folder, glob `{paths.manualTestCases}/**/US-{storyID}-*/`. **Reuse an
existing folder only when its full path equals the resolved `tc_output_folder`** (same
`SPEC-*` parent, same `US-*` leaf). A folder for the same story at another level (for
example a flat `TestCases/US-{id}-…/` left by an older run while the REQ now sits under
`SPEC-{x}/`) is a stray/legacy location: report its path and what it holds, never write to it,
move it or delete it, and write this run's deliverables to the resolved path. An approved
`TEST-CASES-*.md` inside the stray folder still triggers invariant 7 (never overwrite an
approved document) — tell the user and stop. Create the subtree if it is
missing; never fall back to `docs/test-design/` or any other location. Once resolved, the
path is immutable for the run (invariant 9b). When the manifest is
absent, use the detection fallbacks and tell the user to run
`/link-qc-1-generate-update-testing-structure` (audit first, then repair) — never invoke that skill
yourself.

## 4. Implementation status — static, never probed live (workflow step 6)

This skill records the User Story's implementation status from what it is told, so the TCs are
honest about being executable or not — it never opens the application to find out. Signals, in
order; the first that answers wins and is named as the evidence in the header line:

1. The tester's answer at intake (implemented / partially / not implemented / not sure).
2. An existing `link-qc-10-white-box-testing` report for this requirement — glob
   `{white_box_reports}/**/US-{storyID}-*/{storyID}-*-analysis.md` (skill 10 nests reports under
   `[SPEC-{spec_name}/]US-{storyID}-{name}/`; older reports may sit flat at the root). Read only
   its implementation-status verdict.
3. Neither → `Cannot be validated — not yet checked live`.

| Status | Header line | Effect on this run |
|---|---|---|
| **Implemented** | `Implemented — {tester's answer {date} \| skill-4 report {path}}` | Every TC `draft — not app-validated` |
| **Partially implemented** | `Partially implemented — {evidence}; {which ACs are absent}` | TCs of the absent ACs `not-implemented — pending implementation`; the rest `draft` |
| **Not implemented** | `Not implemented — {evidence}` | Every TC `not-implemented — pending implementation`; requirement coverage is still scored from the design |
| **Cannot be validated** | `Cannot be validated — not yet checked live` | Every TC `draft — not app-validated`; the final message says 3b will establish the status live |

Hard rules: a missing screen on a NOT-implemented story is **pending implementation**, never a
defect; keep requirement/coverage gaps (spec has no TC) strictly separate from pending
implementation in every table and finding; record the status **and its source** in the header
and in the structured return. When the tester's answer and a skill-4 report disagree, ask
(`open-questions.md`) — the tester's answer is the recommendation, the report is the evidence.
