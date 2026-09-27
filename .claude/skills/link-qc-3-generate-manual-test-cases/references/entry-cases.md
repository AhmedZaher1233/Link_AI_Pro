# Intake, entry cases and project profile — load at workflow steps 1-3 and 5

## 1. Intake gate — ask BEFORE starting the flow

Before anything else — before entry-case resolution, before reading specs, before any MCP
call — check what the task input already provides:

- Feature name / User Story ID (one story, or several)
- Do manual TCs already exist? If yes, where (file path / Azure DevOps / Word / text)?
- Spec or requirement source (file path, or the Azure DevOps story to retrieve)
- Implementation status, if the tester knows it
- Output folder, if non-standard
- Review-page language (`review_page_language`, §3) — resolved in this order, first hit wins:
  explicit task choice (`--lang ar|en`, "output in Arabic") → the saved learning-file
  preference (applies to an English `REQ-*.md` too) → **asked only when the spec/story is
  written in Arabic** (requirement body / ACs mainly in Arabic script; IDs, paths and code
  tokens ignored) → English. Detection needs the spec read, so when the question is still open
  at intake it joins the step-6 combined ask — never a separate message. Question wording:
  > "The requirement is written in Arabic. Which language do you want the review output in —
  > Arabic or English? (Requirement files / TC markdown always stay English for the next skills.)"

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

(The URL/credentials ask happens later, after the specs are read and the
Playwright MCP probe has run — this gate covers only the information needed to START the flow.)

## 2. Resolve the entry case

If the intake answers still leave the entry case ambiguous, re-ask via §1 — NEVER assume
which case applies.

| Entry case | Trigger | Route |
|---|---|---|
| **Case 1 — Existing manual TCs** | The tester states the User Story already has manual TCs (file path, Azure DevOps test cases, Word document, or pasted text) | Ingest existing TCs → start from the TC writing/normalization phase (`tc-design.md` — existing-TC update) → then continue automatically to validation + review |
| **Case 2 — No TCs and no spec file** | No existing TCs AND no spec/requirement file exists for the story | Retrieve the User Story from Azure DevOps / Word → generate a requirement file into the requirements folder → FRESH DESIGN from that file |
| **Case 3 — Story not implemented (cross-cutting)** | Detected by the implementation-status gate, regardless of Case 1/2 | Keep requirement-based TCs, but do NOT treat them as executable validation — see `mcp-pass.md` §1 |
| **Default** | Spec exists, no existing TCs | FRESH DESIGN (design phase) |

### Case 1 — Existing manual TCs as the starting point

1. **Locate and read the existing TCs** using whichever source the tester names:
   - Markdown/text file in the repo (Read) — including the manual test-cases folder
   - Azure DevOps Test Case work items / test suites (`mcp__azure-devops` testplan + wit tools)
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
5. After completing the TC writing phase, **continue automatically** to the MCP validation
   pass (gated by its §1) and the self-review — do not stop and wait between
   phases.

Implementation-status handling inside Case 1:
- **Story implemented** → validate normally via the MCP pass.
- **Story NOT implemented** → do NOT treat the TCs as executable validation of the current
  application. Keep the requirement-based TCs, mark them
  `not-implemented — pending implementation`, and keep requirement/coverage gaps strictly
  separate from application defects (a missing screen is NOT a bug finding when the story was
  never implemented).

### Case 2 — No manual TCs and no specification file

Flow: **User Story → Retrieve from Azure DevOps / Word → Generate Requirement File →
Generate Manual TCs → Review**

1. Retrieve the User Story + acceptance criteria from Azure DevOps using the Azure DevOps MCP
   (`wit_work_item` / `search_workitem`). On 401/403 STOP: 401 → the Azure DevOps MCP server
   holds a rejected or stale token → ask the user to **reconnect the Azure DevOps MCP server**
   (`/mcp` → azure-devops → reconnect; if the PAT expired they renew it first where the server
   reads it from) — you cannot connect or disconnect MCP servers yourself, so always ask, wait,
   then retry once; 403 → missing scope on the PAT. Never ask for the token in chat. If the
   source is a Word document, use `mcp__docx` (`open_document` → `export_markdown`) instead (same fallback as Case 1 when it is not
   attached). If neither source is reachable → BLOCKED.
2. Convert the User Story into a **structured requirement/specification file**: title, story ID,
   description, numbered acceptance criteria, derived requirement IDs (`REQ-{storyID}-NN`, one
   per testable statement), roles, out-of-scope notes, and open questions.
3. Store it in the story's own folder inside the requirements tree —
   `{requirements_folder}/REQ-{storyID}-{feature}.md` (`{requirements_folder}` already ends in
   `US-{storyID}-{kebab-name}/`; the same per-story layout `2-review-requirements` writes).
   When the story came from a spec FILE (a `.md`/`.txt`/`.docx` given as the source), the
   folder sits under `SPEC-{spec_name}/` — see the profile table. Check that folder FIRST
   (glob `{paths.requirements}/**/US-{storyID}-*/`): if `2-review-requirements` already
   produced a `REQ-*.md` there, reuse it — and its folder location — instead of regenerating.
4. Use that requirement file as `spec_sources` for TC generation — the normal FRESH DESIGN flow
   (the design phase onward) then applies unchanged.

### Multi-story input — split, never merge

When the input names more than one User Story (several IDs, or a spec file holding multiple
stories), split it the way `2-review-requirements` and `7-discover-business-rules` do:

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
| `review_page_language` | — | language of `TC-REVIEW-{feature}.html` only (the markdown deliverables are always English). Resolution: task input `--lang ar|en` / explicit sentence → learning file (grep `output language`, `لغة` under `## Project Knowledge` and the skill Q&A; a saved Arabic preference applies even when the REQ is English) → **ask only when the source is Arabic** (in the combined ask) → default `English`. This is the *document* language for the human reviewer — distinct from `required_locales`, which are the application locales the TCs must cover |
| `app_base_url` | — | **NEVER auto-detected — learning file (`[type: env]`) or ask the user** |
| `credentials_per_role` | — | **NEVER auto-detected, NEVER stored — always ask (unless given in the task input)** |
| `spec_name` | — | **First rule — path wins:** when the resolved `spec_sources` path contains `/SPEC-{x}/` (a `REQ-*.md` under `Testing/Requirements/SPEC-{x}/…`), `spec_name` = `{x}` — always; a REQ under a SPEC folder counts as spec-file origin. **Else**, when the source is a spec FILE: file stem, extension stripped, lowercase kebab-case, ≤ 6 words (`Resource Request Hours v2.docx` → `resource-request-hours-v2`); a generic stem (`spec`, `specification`, `requirements`, `prd`, `readme`) → use the parent folder name (`docs/specs/resource-request/spec.md` → `resource-request`). **Else** empty (ADO / Word / pasted stories, REQ directly under `Testing/Requirements/US-…/`) |
| `spec_level` | — | `SPEC-{spec_name}/` when `spec_name` is set, otherwise empty. The same rule `2-review-requirements` uses. **Immutable once resolved for the run** |
| `UserStoryName` | — | `US-{storyID}-{kebab-name}` — identical to the requirement folder name skill 2 used |
| `tc_output_folder` | `paths.manualTestCases` + `/{spec_level}{UserStoryName}/` | `Testing/Manual_Test/TestCases/[SPEC-{spec_name}/]US-{storyID}-{kebab-name}/` — MUST contain `SPEC-{spec_name}/` whenever the REQ path does; never a flat `US-*` folder for a story whose REQ sits under a `SPEC-*` parent |
| `requirements_folder` | `paths.requirements` + `/{spec_level}US-{storyID}-{kebab-name}/` | `Testing/Requirements/[SPEC-{spec_name}/]US-{storyID}-{kebab-name}/` |
| `white_box_reports` | `paths.whiteBox` | `Testing/White_Box_Testing/` |
| `learning_file` | `paths.learningFile` | `Testing/project-learning.md` |

If a key cannot be resolved and the user does not answer → BLOCKED naming the exact missing key.

**Directory structure rule:** deliverables ALWAYS follow the
`1-generate-update-testing-structure` layout — every User Story's TCs live in their own folder
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
`/1-generate-update-testing-structure` (audit first, then repair) — never invoke that skill
yourself.
