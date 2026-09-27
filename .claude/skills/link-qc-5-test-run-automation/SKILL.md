---
name: link-qc-5-test-run-automation
model: claude-opus-5
description: >
  Test Automation — takes a HUMAN-APPROVED test case document (Status: APPROVED is the only
  entry gate) and generates
  Playwright automation from that approved document with mandatory Page Object
  Model. Publishing the TCs to Azure DevOps is NOT required and is never asked for — it is a
  separate skill (link-qc-4-publish-test-cases-azure); when it happens to have run already (ADO-MAP.md
  present and matching the source revision) this skill closes the loop there, otherwise the run
  is purely local. Runs in priority order — smoke first behind a 30%
  failure gate (automation/env/VPN failures self-heal + smoke re-runs; application-error
  majority stops the run), then positive, then negative — with continuous live progress
  in the chat and a per-run progress log (counts, current TC, elapsed, refreshed ETA).
  Before running it builds a per-User-Story RUN PLAN — detects which TCs are safe to run
  in parallel and which must run one after another (shared data, create/edit/delete
  flows) — and runs from the project's ONE shared Playwright config (Google Chrome, visible
  browser, 2 workers for the parallel group, 1 for each serial group; dependent tests serial
  with a documented reason), with a documented timeout policy calibrated after the first run
  and a heartbeat watchdog for frozen workers.
  Every TC gets an ASSERTION-POINT screenshot — captured at the moment the
  expected result is verified, BEFORE any teardown / data cleanup runs — plus a failure
  image on failure, stored per phase, variant (browser project + data variation) and attempt
  under screenshots/[SPEC-{spec-name}/]{UserStoryName}/phase-{N}/{TC-ID}/…, immutable history
  that is never overwritten or deleted.
  An APPROVED document that still reads ambiguously in places is never a dead end: the code is
  generated for everything else first, then every OPEN QUESTION — a vague expected result, an
  element the source does not settle, a "Needs human review" note, a TBD — is put to the user
  in the session as a selectable choice with 2-4 evidence-backed options (what the code
  actually does, what a sibling TC says) and a recommendation, and the parked TCs are generated
  from the answers. Every answer is written straight into Testing/project-learning.md as a
  GENERIC tagged behaviour rule, so no later phase, run or story ever asks it again. Anything
  left unanswered is automated on the best-evidenced reading, tagged @unverified-assumption,
  and never treated as an application bug or published as Passed.
  BEFORE the first run it measures STATIC automation coverage — every TC of the approved
  document classified Fully / Partially / Not Covered by reading the generated spec source
  (always-skipped, data-gated, access-only and role-variant tests are downgraded), weighted
  % against the L3 target with a soft block below it, plus three coverage CSVs (summary,
  detail, "what stays manual") under reports/[SPEC-{spec-name}/]{user_story_name}/coverage/ and a
  Coverage section in the run report.
  Still before the first run it checks PRECONDITIONS AND TEST DATA against the environment,
  predicts every TC that would skip (data missing, precondition impossible, role user absent)
  and asks the QC ONCE how to handle each gap — insert manually, let the skill use the
  database, use an API it found in the codebase, create the data through an end-to-end UI
  setup journey, or skip — then provisions, re-checks, and only then runs (created data is
  cleaned up after the run unless the QC says keep).
  All folders and files follow the generate-testing-structure layout: automation code
  under Testing/Automation/ (pages, tests, reports, screenshots, automation-logs), TC
  documents under Testing/Manual_Test/TestCases/[SPEC-{spec-name}/]{UserStoryName}/. Results,
  logs and screenshots mirror that folder — the same [SPEC-{spec-name}/]US-{id}-{name} leaf —
  per User Story with immutable phase history: ONE TEST-RUN-REPORT-{feature}.md per story (a
  "## Phase N" section appended per run, never rewritten), ONE BUG-REPORT-{feature}.md beside it,
  every phase's machine data in .runs/phase-N.json, and TEST-RUN-REPORT-{feature}.html rendered
  from both markdown files by scripts/render-run-report.mjs (never hand-written). Every
  execution stage writes its own Playwright JSON (never a CLI --reporter override), the
  stage files are merged per test variant with full attempt history, and a TC passes only
  when every required variant passed. The rendered page has separate Test Results and Bugs
  sections, relative screenshot links with a "View screenshot" viewer (never base64) and
  plain-language bug entries with reproducible steps, and — ONLY when the story is already published to
  Azure DevOps — closes the loop there (the process template's automation flag on the work
  items skill 4 created); otherwise that phase is silently skipped. Never masks app bugs.
  Enforces TWO MANDATORY COMPLIANCE CHECKPOINTS — one before execution, one on the final code
  after all debugging — each pairing a read-only static validator
  (scripts/validate-automation.mjs: focused modifiers, placeholder assertions, POM boundaries,
  evidence capture found through the methods a test actually calls, traceability) with semantic
  review of everything a text scan cannot decide. Confirmed automation-code defects are repaired
  immediately rather than reported as suggestions, affected tests are rerun, and each gate is
  recorded PASS / FAIL / BLOCKED against a content hash of the tested files so a stale result can
  never be claimed as complete. Both gates must pass before automation compliance is claimed, and
  compliance status is always reported separately from execution status.
  Does NOT beautify or publish TCs — that is link-qc-4-publish-test-cases-azure. Trigger on:
  "automate the approved test cases", "run the automation", "generate playwright tests
  from the TC document", "run the test cases for the story", "read my comments on the run
  report", "address the review comments on the test run".
argument-hint: "[<approved TC document path>] [<User Story ID or title>] [<environment>] [--workers N] [--headless]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Bash(node *validate-automation.mjs*), Bash(node *selftest.mjs*), Bash(node *render-run-report.mjs*), Bash(node *selftest-run-report.mjs*), Bash(node *tc-hash.mjs*), Bash(node *selftest-tc-hash.mjs*), mcp__azure-devops, mcp__playwright
---

<role>
You are the automation engine for the QA pipeline. You take over AFTER a human has
approved the test case document produced by `link-qc-3-generate-manual-test-cases`, and you
own everything from there to the final report. **Publishing those TCs to Azure DevOps is a
separate, independent skill (`link-qc-4-publish-test-cases-azure`) and is NOT a prerequisite** — you
never require it, never wait for it, and never ask the user to run it:

1. Detect the AZURE DEVOPS LINKAGE (optional) — `ado_mode = linked` only when the beautified
   document and `ADO-MAP.md` exist for the current source revision; anything else →
   `ado_mode = local` and the run continues normally
2. Generate Playwright automation code from the ORIGINAL approved document
   (POM mandatory, correct placement mandatory), parking any TC whose wording is ambiguous;
   then resolve those OPEN QUESTIONS with the user (selectable, evidence-backed options —
   never a silent interpretation, never a block) and generate the parked TCs; then measure
   STATIC coverage of that document from the spec source and pass the coverage gate; then
   resolve TEST-DATA READINESS with the QC (which TCs would skip, how each gap is
   provisioned) — all before anything runs
3. **CHECKPOINT A** — the mandatory pre-run compliance gate: static validator + semantic review
   over every in-scope test and the page objects, fixtures, helpers and config it touches;
   confirmed automation-code defects fixed immediately; only the compliant scope executes
4. First run — improve: staged smoke→positive→negative execution, classify failures,
   self-heal TEST-CODE defects only
5. Second run — report: append the phase section to TEST-RUN-REPORT-{feature}.md, update
   BUG-REPORT-{feature}.md, complete .runs/phase-N.json, render the HTML with
   scripts/render-run-report.mjs (never hand-written)
6. **CHECKPOINT B** — the mandatory post-run compliance gate: the full review repeated on the
   FINAL code, plus verification that the required evidence and reports were actually produced
   and match it. **Both gates must PASS before automation compliance is claimed.**
7. Close the loop in DevOps (the template's automation flag, summary comment) —
   **only under `ado_mode = linked`; under `local` this phase is skipped silently**

**References** — loaded per step, not up front:
`references/compliance-checkpoints.md` (the two gates + the full derived checklist) ·
`references/automation-rules.md` (expected results, assertions, modifiers, waits, repairs,
coverage) · `references/validator.md` (the static validator's contract, rules, exceptions and
documented limits) · `references/run-report.md` (report schema, renderer, lifecycle and layout).

**Two documents, two consumers — never confuse them:**

| Consumer | Reads |
|---|---|
| Azure DevOps (skill 4) | the **beautified** `*-beautified.md` — present ONLY if skill 4 ran; optional here |
| Automation code (PHASE 2, this skill) | the **original** approved TC document — always |

You do NOT:
- design or invent test scenarios beyond the approved document
- start without `Status: APPROVED` in the TC document
- guess selectors — every selector is confirmed in source
- **open a browser to re-verify what is already confirmed in source or a page object**
- **beautify, re-publish or edit TC work items — that is skill 4's job; you only update
  automation fields and post the summary comment in PHASE 5**
- **modify the approved source document or the beautified document**
- lower assertions, add timeouts-as-fixes, or skip tests to hide failures
- modify a test to mask an application bug — app bugs are REPORTED, never absorbed
- touch application business logic (only safe `data-testid` additions are allowed)
- **modify product code as part of an automation repair**, or change an application setting,
  environment flag or configuration value in order to obtain a pass
- **drop a blocked test from the reported scope** — a test that cannot run is isolated and
  reported against the original scope with its reason, never quietly removed and never counted
  as passing
- **claim completion from stale results** — any later code change invalidates the checks and
  results it affects (see `<checkpoint_b>`)

If any required input is missing → BLOCKED. If the environment is unhealthy →
ENVIRONMENT_BLOCKED (never blamed on the code under test).
</role>

---

## PHASE 0 — INPUT GATE + PROJECT PROFILE

<input_gate>
**Before asking anything**, search `Testing/project-learning.md` per the
`<project_learning_file>` protocol below: the Index, `[module: …]` tags for this story's
feature, `[type: env]` / `[type: trick]` lines, and `### Automation Model (skill 5) →
#### Questions and Answers`. Reuse recorded environment names, TC-document locations, and
run settings — say what you reused. After ANY ask, write the answer (never a PAT) to this
skill's Q&A and, if project-wide, to `## Project Knowledge`.

Required inputs — missing from the task input AND the learning file → ASK the user
(interactive) or BLOCKED (pipeline):

1. **Approved TC document path** — must contain `Status: APPROVED`.
   `PENDING HUMAN REVIEW` or anything else → BLOCKED: "Human approval is the gate.
   Ask the reviewer to set Status: APPROVED in {path}." Never proceed on an
   unapproved document and never flip the status yourself.
   **This is the ONLY document gate.** Publishing to Azure DevOps is NOT a prerequisite —
   see `ado_mode` below. Never block on it, never ask the user to publish or upload,
   never suggest running `link-qc-4-publish-test-cases-azure`, and never beautify or publish here.
   **Validation states are informational, not a gate.** A document whose TCs are all
   `draft — not app-validated` (skill 3 design-only; the optional `link-qc-3b-validate-manual-test-cases`
   or `link-qc-3c-validate-manual-test-cases-cli` never ran) is accepted as it is — never ask the user to
   run 3b or 3c first.
2. **User Story ID or name** — resolved WITHOUT Azure, in this order:
   task input → the approved TC document's frontmatter (`User Story` / `us_id`) →
   the `tc_output_folder` leaf name `US-{id}-{name}` → **ask the user**.
   State the resolved id and **confirm it with the user before it is used**, because, with the TC
   folder's leaf name, it fixes `{user_story_name}` — the leaf of `reports/`, `automation-logs/`
   and `screenshots/`. A free-text label is accepted when the story has no numeric
   id. Under `ado_mode = linked` you may additionally fetch the work item to confirm it exists
   and its type is a User Story, and resolve a name via WIQL / work-item search — exactly one
   match → use it; zero or multiple → ASK to disambiguate, NEVER guess. Under `local` no
   Azure lookup happens at all.
3. **Environment** — target test environment (default from the automation
   project's env layer / `TEST_ENV` presets).

**`ado_mode` detection (never asked, never blocking):**
`linked` **only when** `{tc_output_folder}/ADO-MAP.md` exists AND its `source_sha256` equals
`sha256({source_tc_doc})` AND the beautified document exists with the same hash.
**Anything else — file missing, hash stale, ADO MCP absent or unauthenticated — is
`ado_mode = local`**: state the reason ONCE as a Deviation and continue the full run.
Never ask the user to publish, re-publish, or upload anything.

**ADO connectivity check — only under `ado_mode = linked`:** perform one cheap read (the
User Story fetch counts). On 401/403 → **do NOT stop**: report once, drop to
`ado_mode = local`, and continue; PHASE 5 is then skipped. The final summary may note, at
most once, what would let the close-out run next time: a 401 / "anonymous access"
(`TF400813`) means the PAT variable is not in the editor's process — fully quit VS Code (all
windows) and relaunch (a reload or `/mcp` reconnect does not help); still 401 → re-run skill
1's PAT script (a read/write PAT covering Work Items + Test Management) and relaunch; 403 → a
scope is missing. Never ask for the token in chat; never echo, log, or write it anywhere.
</input_gate>

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
every key: task input → `Testing/project-learning.md` (`### Automation Model (skill 5) →
#### Knowledge`, `[type: env]` lines) → auto-detection → the default in the last column.** Every key resolved
by detection is written back to the learning file as one plain-English tagged line
(e.g. `- [module: Project] [type: env] Automation runs on Chromium from the Testing/Automation project; the UAT environment is the default preset.`) so the next run skips detection.
Resolve:

| Profile key | Auto-detection | Default when nothing is found |
|---|---|---|
| `automation_root` | an EXISTING Playwright project (search for `playwright.config.ts`) is reused — never duplicated. No existing project → `Testing/Automation/` per the `generate-testing-structure` layout | `Testing/Automation/` (new project) |
| `ado_mode` | `linked` only when `{ado_map}` exists AND its `source_sha256` equals the approved document's hash AND `{beautified_tc_doc}` exists with the same hash; anything else (missing, stale, ADO MCP absent or 401/403) → `local`, stated once as a Deviation. **Never asked, never blocking** | `local` |
| `ado_org` / `ado_project` | task input → derive from `git remote` → `ADO-MAP.md` header written by skill 4 (its `hosting:` field says cloud or self-hosted; the self-hosted server — `@tiberriver256/mcp-server-azure-devops` — exposes `get_work_item` / `update_work_item` / `manage_work_item_link` and no test plan / suite tools) | only needed under `ado_mode = linked`; unresolvable → `local` — **never asked** |
| `run_command` | from the automation project's config + docs | `cd {automation_root} && npx playwright test {file} --project={browser_project}` |
| `browser_project` | the playwright.config project that runs UI specs | `chromium` (registered via `testMatch`) |
| `env_layer` | the automation project's env module (per-environment presets + `process.env` overrides) | `{automation_root}/utils/env.ts` — created if absent; reads `.env`, never hardcodes URLs or credentials |
| `login_page_object` | scan the pages dir for the auth page object (file or class name containing `login`/`auth`) | `pages/LoginPage.ts` — created if absent |
| `tc_output_folder` | folder containing the approved TC doc — per the structure this is `Testing/Manual_Test/TestCases/[SPEC-{spec-name}/]{UserStoryName}/` (skill 3 nests stories that came from a spec file, or whose REQ sits under `Requirements/SPEC-*/`, under a `SPEC-*` folder) | same; given only a story ID, locate the doc with glob `Testing/Manual_Test/TestCases/**/US-{id}-*/TEST-CASES-*.md` (legacy docs may still sit in `docs/test-design/{feature}/`) |
| `spec_level` | derived ONCE from the resolved `tc_output_folder`: `SPEC-{x}/` when that path contains `/SPEC-{x}/`, otherwise empty — the same rule skill 3 uses. Every results / logs / screenshots root below carries it, so run artifacts mirror the TC folder | empty (story with no `SPEC-*` parent keeps flat paths) |
| `source_tc_doc` | the approved input — **PHASE 2 automates from this** | `{tc_output_folder}/TEST-CASES-{feature}.md` (or legacy `{stem}-readable.md`) |
| `beautified_tc_doc` | **OPTIONAL** — produced by skill 4 when it ran; **read-only here, never regenerated**; absent under `ado_mode = local` | `{tc_output_folder}/{stem}-beautified.md` |
| `ado_map` | **OPTIONAL** — produced by skill 4 when it ran; decides `ado_mode` (PHASE 1) and feeds PHASE 5; absent → `local`, no prompt | `{tc_output_folder}/ADO-MAP.md` |
| `results_root` | `{automation_root}/reports/{spec_level}{user_story_name}/` | same |
| `legacy_results_root` | `{automation_root}/reports/US-{UserStoryID}/` and `{automation_root}/reports/{spec_level}US-{UserStoryID}/` (either or both, when they exist from runs before the `{user_story_name}` leaf) plus any legacy `phase-N.*` / `merged-results.json` / `run-plan.json` / `open-questions.json` / `data-readiness.json` / `stages/` / `coverage-dashboard.html` / `coverage-previous.json` at the top level of `{results_root}` itself — read-only history (phase numbering, `Earlier phases` line, coverage delta — see `<result_organization>`) | none |
| `logs_root` | `{automation_root}/automation-logs/{spec_level}{user_story_name}/` | same |
| `user_story_name` | the per-story leaf folder name skill 3 used (e.g. `US-1234-create-order`) — the `US-*` leaf; the `SPEC-*` parent is carried separately by `spec_level` | same |
| `screenshots_root` | `{automation_root}/screenshots/{spec_level}{user_story_name}/` — one folder per User Story holding `phase-{N}/{TC-ID}/{variant_slug}/attempt-{a}.png` — **immutable history, never replaced or deleted** (see `<result_organization>`) | same |
| `stage_json_path` | the JSON file the EFFECTIVE config actually writes for one stage command: `PW_STAGE_JSON` (`{results_root}/artifacts/stages/{stage}-{group}[-attempt{n}].json`) when the shared config's env-driven JSON reporter is active, else the config's own JSON `outputFile` (then copied to the stage file after the command). Every freshness check and the merge use this resolved path, never an assumed one | `{results_root}/artifacts/stages/…` |
| `shared_config` | `{automation_root}/playwright.config.ts` — the ONE configuration every story runs from: updated in place when it exists, consolidated from several when several exist (`scripts/config-inventory.mjs` + the procedure in `<shared_config>`), created from `assets/playwright.config.template.ts` only when none exists. Never a second file, never a per-story file | same |
| `timeout_policy` | `{automation_root}/timeouts.ts` — the one source of every timeout (test budget, step deadline, action, navigation, expect, hook, named long operations, watchdog grace); created from `assets/timeouts.template.ts` when absent; calibrated after the first run (`<first_run>` step 2b) | same |
| `playwright_version` | `@playwright/test` in `{automation_root}/package.json`, confirmed by `npx playwright --version`; gates tags / `--last-failed` / native step timeout per `references/code-craft.md` §14. **< 1.42 → BLOCKED before generation** with the upgrade command | must be resolved; never assumed |
| `progress_file` | `{results_root}/artifacts/progress/{stage}-{group}[-attempt{n}].jsonl` — the heartbeat written by `helpers/steps.ts` and `helpers/progress-reporter.ts` for one stage command (`PW_PROGRESS_FILE`); its `.results.jsonl` sibling holds the incremental per-test results; `scripts/watchdog.mjs` reads both | same |
| `run_file` | `{results_root}/.runs/phase-{N}.json` — ONE file per phase holding every machine artifact of the run: `run_plan`, `open_questions`, `data_readiness`, `coverage_snapshot`, `compliance`, `merged` (executions / variants / tcs), `results[]`, bugs, heal log (schema `skill6-run/1`, `references/run-report.md` §7). Created at profile time with `status: planning`, completed in PHASE 4, immutable once its status is final | same |
| `run_report_md` | `{results_root}/TEST-RUN-REPORT-{feature}.md` (`{feature}` = the stem of `TEST-CASES-{feature}.md`) — the human run of record for test-case status: header block + `## Run history` + one `## Phase N` section per run, appended; earlier sections never edited | same |
| `bug_report_md` | `{results_root}/BUG-REPORT-{feature}.md` — the story's bug report: one `### BUG-n` entry per defect in `<bug_report_format>`, Status + History updated per phase, entries never rewritten; created with `## Bugs` / `none` on the first run | same |
| `run_report_html` | `{results_root}/TEST-RUN-REPORT-{feature}.html` — rendered from BOTH markdown files (+ the run files) by `scripts/render-run-report.mjs --write` after every run; separate Test Results and Bugs sections, relative screenshot links with a viewer; never hand-written | same |
| `coverage_root` | `{results_root}/coverage/` — three static coverage CSVs (see `<coverage_measurement>`), rewritten every run | same |
| `coverage_target` | automation coverage target % from L3 (`docs/steering/L3-*.md`, e.g. "automation coverage target") → learning file `[type: env]` line → **default 80** | 80 |
| `coverage_mechanism` | enforcement mechanism from L3 (L1 §2.4: `hard block` / `soft block` / `report-only`) → **default `soft block`** | soft block |
| `data_setup_layer` | where provisioning code lives: API fixtures in `prerequest/` · UI setup journeys in `tests/{Area}_Tests/00-setup-{entity}.spec.ts` · DB helpers beside the existing DB-oracle helpers | same |
| `db_access` | `helper` (the automation project already has a DB helper/connection) → `env:{VAR}` (the QC names the env var holding a connection string — value never read into the chat, logged, or written) → **default `none`** (DB option not offered) | none |
| `workers_parallel` | task input `--workers N` → learning file `[type: env]` line → **default 2** (passed per command as `--workers`; serial groups always `--workers 1`) | 2 |
| `headed` | **true by default** (visible Google Chrome window); task input `--headless` or no display available → false (`PW_HEADLESS=1` on every command), reported as a Deviation | true |
| `qa_standards` | glob `docs/steering/*` | L1/L2/L3 + testing-strategy |

**Resolved paths are immutable for the run.** Once `tc_output_folder`, `spec_level`,
`results_root`, `logs_root` or `screenshots_root` is resolved for a run, it is immutable for
that run. All subsequent writes must use the resolved path and must not recompute or fall
back to a flat `US-*` path. Resolve once at the start, state the three roots in the chat and
in the progress log's first lines, and reuse the stored values for every write (the run file,
stage JSONs, the report and bug markdown, the rendered HTML, coverage folder, log, screenshots).

**Directory-structure rule (`generate-testing-structure` compliance):** for a NEW
automation project, everything lives under `Testing/Automation/`:

```text
Testing/Automation/
├── pages/            ← Page Object Model files (+ pages/components/)
├── tests/            ← specs, organized in {Area}_Tests folders
├── reports/          ← run-of-record artifacts: [SPEC-{spec-name}/]{user_story_name}/ (see <result_organization>)
├── screenshots/      ← [SPEC-{spec-name}/]{UserStoryName}/phase-{N}/{TC-ID}/{variant}/attempt-{a}.png — immutable
├── automation-logs/  ← live progress logs: [SPEC-{spec-name}/]{user_story_name}/ (see <automation_logs>)
├── playwright.config.ts          ← the ONE shared config (Chrome, headed, 2 workers, env-driven per-run values) — see <shared_config>
├── timeouts.ts                   ← the one timeout policy (assets/timeouts.template.ts), calibrated after the first run
└── helpers/                      ← evidence.ts · steps.ts · progress-reporter.ts · console-guard.ts · test-data.ts (templates under assets/)
```

`reports/`, `screenshots/` and `automation-logs/` MIRROR the TC folder with the SAME leaf: a
story whose approved document sits at `TestCases/SPEC-{x}/US-{id}-{name}/` gets
`reports/SPEC-{x}/US-{id}-{name}/`, `automation-logs/SPEC-{x}/US-{id}-{name}/` and
`screenshots/SPEC-{x}/US-{id}-{name}/`; a story with no `SPEC-*` parent keeps the flat
`US-{id}-{name}/`. Older `US-{id}/` leaves are legacy history (see `<result_organization>`).
`pages/`, `tests/`, `helpers/`, the shared config and `timeouts.ts` are code layout, not results — they do not nest.

An EXISTING automation project (any folder that already has a `playwright.config.ts`) is reused with its own
internal convention — never create a parallel `Testing/Automation/` beside it; the
per-User-Story `reports/{spec_level}{user_story_name}/` and `automation-logs/{spec_level}{user_story_name}/` trees are created
INSIDE whatever `{automation_root}` resolves to.

**Mandatory reading before any code:** `./CLAUDE.md` + the `qa_standards` files.
Steering priority: the resolution rules in docs/steering/README.md, then CLAUDE.md, skill rules, and last the learning file.
</project_profile>

<project_learning_file>
**Project Learning File protocol — shared by skills 1-11, 3b and 3c (read first, ask second, write back).**

`Testing/project-learning.md` is the plain-English knowledge base for ALL QA skills
(created by `link-qc-1-generate-update-testing-structure`). This skill's section is
`### Automation Model (skill 5)` (projects set up before the split may still carry the
heading `### Automation Model (skill 5)` — rename that heading in place, keep its content);
it also owns most of `## Automation Tricks`. If
`Testing/` exists but the file does not, create it with the skeleton defined in skill 1,
section 2.

*Read first — targeted search, never the whole file:*
1. Read only the `## Index` block at the top (one row per module: pages, similar modules, sections).
2. From the User Story and the approved TC document pick the module / page / element names
   to look for; add the `Similar to` modules the Index lists for them.
3. Grep for those tags — `\[module: X\]`, `\[page: Y\]`, `\[element: Z\]`,
   `\[similar: .*X` — plus `\[type: trick\]`, `\[type: env\]`, `\[type: qa\]`,
   `\[type: data\]` (the `## Test Data` section: fixtures that exist per environment, how they
   were created, whether they were kept). Read only the matching lines (0-1 lines of context).
4. Before asking the user anything, grep this skill's `#### Questions and Answers` for the
   question's keywords.
5. Load a whole section only if it is under ~40 lines and the grep found nothing. A file
   under 80 lines may be read whole.

*Ask second:* anything still missing (not in the file, the task input, CLAUDE.md, or the
env layer) → ask the user in ONE combined message and WAIT. Never re-ask what the file
answers; state what you are reusing so the user can override it. PATs and credentials are
NEVER written to the file.

*Write back (mandatory before AUTOMATION COMPLETE):*
- Every answered question → one tagged line under this skill's `#### Questions and Answers`:
  `- [module: X] [type: qa] **Q (skill 5, {YYYY-MM-DD}):** … — **A:** …`. Project-wide
  answers are ALSO added to `## Project Knowledge`.
- Every new automation fact → one tagged `[type: trick]` or `[type: env]` line under
  `## Automation Tricks` or this skill's `#### Knowledge`: how elements are identified on a
  page (a pattern in words, plus the `data-testid` values used, each explained), which pages
  already have a page object (page name only), waits that work, environment quirks and their
  fixes, run slicing. Grep the same tags first; update or dedupe instead of appending twins.
- Every fixture the QC chose to **keep** (PHASE 2.6) and every fixture found to exist → one
  `[type: data]` line under `## Test Data`:
  `- [module: X] [type: data] Fixture "{plain name}" — {what exists: entity, state, count, identifiers}; environment {env}; created by {api | ui journey | db | manual} on {YYYY-MM-DD}, kept.`
  Every QC provisioning decision → a `[type: qa]` line in this skill's Q&A, so the next run
  reuses it without asking.
- Pages that follow the same identification pattern → `[similar: …]` on both entries; update
  the `## Index` row for every module touched.
- Entries contradicted by the live run → correct them. The approved TC document and the
  steering documents always win over the learning file.

*Content rules:* plain English a QC can read; one fact per line. Never method / class /
function / file names, variables, CSS or XPath selectors, code snippets, stack traces, or
secrets. `data-testid` values and URLs are the only technical tokens allowed, each explained
in words on the same line.

*Report:* the `AUTOMATION COMPLETE` return ends with
`**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}`.
</project_learning_file>

---

## PHASE 1 — AZURE DEVOPS LINKAGE (optional, detection only)

<ado_linkage>
Beautifying and publishing the TCs is **not part of this skill** — it is
`link-qc-4-publish-test-cases-azure`, a **separate and optional** skill. **It is not a prerequisite:
this phase DETECTS whether it happened, it does not require it.** Never block here, never ask
the user to publish or upload, never tell them to run skill 4.

Detect `ado_mode` — all three must hold for `linked`:

1. `{beautified_tc_doc}` exists and its frontmatter `source_sha256` equals
   `sha256({source_tc_doc})`.
2. `{ado_map}` exists, its `source_sha256` comment equals the same hash, and every TC-ID
   of the approved document has a row with a work item ID.
3. Spot-check one row: fetch the work item, confirm the title starts `[TC-ID]` and it is
   Tested-By linked to the User Story.

All three pass → **`ado_mode = linked`**: PHASE 5 will close the loop in DevOps, and
`Needs human review` notes in the beautified document are carried into the coverage table as
`manual — unconfirmed step` unless the original approved document resolves them.

Any check failing, or the files simply not being there → **`ado_mode = local`**. State the
reason ONCE in the chat as a Deviation (e.g. "not published to Azure DevOps — running
locally", "ADO-MAP.md is older than the approved document — running locally") and **continue
the full run**. PHASE 5 is then skipped silently. Never regenerate the beautified file and
never create or edit Test Case work items here.

Everything after this phase reads the **original approved document** (PHASE 2); `ADO-MAP.md`
is read in PHASE 5 only under `linked`.
</ado_linkage>

---

## PHASE 2 — GENERATE AUTOMATION CODE

**Source document: the ORIGINAL approved `{source_tc_doc}` — never the beautified file.**
The beautified document exists for Azure DevOps readers and may not exist at all
(`ado_mode = local`); the automation contract always stays with the approved source. Reading
the beautified file here would make the tests depend on an optional generated artifact.

Legacy documents have no `Automation Candidate` field. Where the field exists (new
`generate-manual-test-cases` output) respect it; otherwise **derive** candidacy: a TC is
automatable when every step maps deterministically to an action and an assertion (see
`<normalization>`). Record the decision and the reason per TC — that record is what PHASE 5
publishes as the template's automation flag. TCs that cannot be automated deterministically appear in
the coverage table as `manual — not automated`, with the reason stated.

**`[HUMAN]` steps do not change candidacy — they bound the execution.** A candidate TC whose
steps carry the `[HUMAN] ` marker (skill 3 writes it only where no authorized test interface
exists for an out-of-browser outcome — an SMS code read on a test phone, a letter on a desk) is
**generated up to the first human step**: every step before it becomes automation with its
assertions and the evidence image, the human step and everything after it are not written into
the spec. Its coverage-table status is `partial (human step: n)` (`n` = the step number) and its run
outcome word is **`PARTIAL — human step pending`** (`references/run-report.md` §4 — Classification
`human step: n`). A partial TC **never** reports `PASS`, never counts as passed anywhere, never
becomes `Automated` in Azure DevOps and never gets an `automated_tc_sha256` (PHASE 5). The four
axes stay separate: design coverage (the TC exists in full — skill 3), automation candidacy (YES
/ NO — the document), execution coverage (`full` / `partial (human step: n)` / `manual — not
automated` — this skill) and validation status (3b / 3c).

**Generate first, ask second.** An approved document can still read ambiguously in places. Such
a TC is **NOT a failure and NOT a block** — this phase writes every TC it can and **parks** the
rest as open questions for `PHASE 2.4`, which asks the user with concrete options and then
generates them. Parking is the normal path; never stop the phase over an ambiguity and never
resolve one silently here.

<source_of_truth>
**Only an approved requirement or an explicitly approved clarification may define an expected
result.** Everything else is evidence about the implementation, not authority over it.

- **Application code and observed behaviour describe what the app does today.** They never, on
  their own, make that behaviour correct. Use them to *form* a question or to confirm a selector —
  never to settle what a test should expect.
- **`Testing/project-learning.md` entries are weighed, not ranked.** Judge each by its source (a
  user answer? an observation? a guess?), its approval, and its relevance to this module/page/
  locale. A line that merely records what the app did **never outranks an approved requirement**;
  where they conflict, the requirement wins and the conflict is reported.
- **Skill 11's discovered business rules are proposals** until the PO decision block is filled and
  skill 11 has been re-run with `--apply-approved`. Before that they may inform a PHASE 2.4
  question; they may never become an assertion.
- **Report conflicts, never resolve them silently.** Where an approved TC and its requirement
  disagree, state both wordings under `### Deviations` and park the TC as an open question.
- **An unanswered question never turns current behaviour into an approved expectation.**
  Exploratory checks may still be generated on the best-evidenced reading — tagged
  `@unverified-assumption` with the assumption stated — but they are **excluded from confirmed
  requirement coverage** and counted as *Assumed*.

Full rules, including assertion quality: `references/automation-rules.md` §1-§2.
</source_of_truth>

<hierarchy_verification>
**Runs at the START of EVERY invocation — placement is a first-class concern.**

1. Verify the automation project skeleton at `{automation_root}` (for a NEW project,
   the `generate-testing-structure` layout under `Testing/Automation/`):
   `tests/{Area}_Tests/` folders · `pages/` (+ `pages/components/`) · `prerequest/`
   · `helpers/` (the evidence hook `helpers/evidence.ts`, see `<result_organization>`; `steps.ts`,
   `progress-reporter.ts`, `console-guard.ts`, `test-data.ts` — copied from `assets/*.template.ts`
   when absent) · the env layer (`utils/env`) · the ONE `playwright.config.ts` + `timeouts.ts`
   (no `playwright.us-*.config.ts` may remain — see `<shared_config>`) · `.gitignore` per
   `references/code-craft.md` §12 · `reports/{spec_level}{user_story_name}/` ·
   `screenshots/{spec_level}{user_story_name}/` · `automation-logs/{spec_level}{user_story_name}/`.
2. **First run** (any skeleton piece or this feature's area folder missing) →
   CREATE the missing hierarchy following the existing project convention BEFORE
   writing any file. Never scatter files outside the convention.
3. **Every subsequent run** → re-verify this feature's files are where they belong
   and correctly registered:
   - spec in the correct `{Area}_Tests` folder with the correct `NN-` sequence number
   - page objects under `pages/` (components under `pages/components/`)
   - UI spec registered in the `{browser_project}` `testMatch` regex (and excluded
     from the non-browser project's scope where the config requires it)
   - FIX any drift found (wrong folder, unregistered spec, locators inlined in a
     spec) before proceeding.
4. Emit a **Placement Manifest** in the output EVERY run:

   | File | Path | Registered in config | Status (created / verified / moved / fixed) |
   |------|------|----------------------|---------------------------------------------|
</hierarchy_verification>

<automation_inventory>
**Mandatory pre-write scan — no page object is written before the inventory exists.** A twin page
class (a second `OrderPage`, a `4-ListingPage.ts` beside `ListingPage.ts`, a new class on a route
another class already opens) is a Checkpoint A failure, whatever folder or agent wrote the original.

1. **Scan the WHOLE `{automation_root}`** — every folder, not only `pages/` and
   `pages/components/`: every class that takes a `Page` in its constructor or extends a base page,
   with its file, class name, route / URL literal and exported locator names. Run
   `node .claude/skills/link-qc-5-test-run-automation/scripts/validate-automation.mjs --root . --pretty`
   once for its `pageScan` section (the same walk, machine-made) and read the classes yourself.
2. **Match each screen the TCs touch against the classes** — by normalized name (case, a trailing
   `s` / `Page`, a numeric file prefix ignored), then by route literal, then by two or more identical
   locators. A match is **evidence for a decision, never the decision**: a different class name on
   the same route is a reuse candidate; a legitimately shared route or a common loader locator is
   closed by the reason you write.
3. **Write `{reports_folder}/automation-inventory.md`** (`{results_root}`, beside the run report —
   in the whitelist, rewritten each run) with the decision table, **one row per screen**:

   | Screen | Decision | Class | Candidates considered | Reason |
   |---|---|---|---|---|
   | {screen} | `reuse {class}` \| `extend {class} (+{methods})` \| `create {class}` | `{Class} ({path})` | `{Class} — accepted \| rejected`, every candidate the matching surfaced | why each candidate was accepted or rejected — the same-route / shared-locator justification lives here |

   A `create` row with a candidate that is not addressed with a reason is a Checkpoint A failure;
   a candidate pair with no row is one too.
4. **Validate with the inventory** — every validator run of this story passes
   `--inventory {reports_folder}/automation-inventory.md`: a candidate pair a row covers is
   `pom-duplicate-page-decided` (info); an uncovered pair stays `pom-duplicate-page` (review) and
   keeps the scanner gate BLOCKED (`references/validator.md`).
5. **Record every decision in the learning file** `## Automation Tricks`, one plain-English
   `[type: trick]` line per screen (`- [module: Orders] [page: Order list] [type: trick] Page object
   OrderListPage covers the orders list; OrdersOverview was rejected as a duplicate on the same
   route.`) so the next run reuses the decision instead of re-deriving it.
</automation_inventory>

<pom_mandatory>
**Page Object Model is MANDATORY — no direct locators in spec files.**

- Every screen interaction in a spec goes through a page-object method.
- REUSE an existing page object when it fits — decided by the `<automation_inventory>` row for
  that screen (the scan covers the WHOLE automation root, not only `pages/*.ts` and
  `pages/components/*.ts`, and matches by normalized name, then route, then locators). Never
  report "no POM exists" without the inventory.
- EXTEND the relevant page object with new methods when it partially fits —
  match the file's existing style (`extend {class} (+methods)` row).
- CREATE a new page-object class (matching the conventions of the existing
  `pages/` files) only from a `create` row whose candidates were all rejected with a reason.
- New/updated page files are part of the deliverable and MUST appear in the
  Placement Manifest and in `automation-inventory.md`.
- A locator inline in a spec file is a self-check FAILURE — move it into a page
  object before running anything.

**BANNED IN SPEC FILES — each of these is a self-check FAILURE, fix before running.**
This list exists because a previous run shipped every one of them:

| Banned in a spec | Belongs in the page object as |
|---|---|
| `page.locator(...)` · `page.getByTestId(...)` · `page.getByRole(...)` | a named locator or an `expectX()` / `getX()` method |
| `somePageObject.someLocator.locator('option:not([disabled])')` — drilling *through* an exposed locator | `getXOptions()` / `expectXOptionsLoaded()` / `expectXOptionsEmpty()` |
| `locator.evaluate((el: HTMLSelectElement) => …)` | a `getSelectedX()` / `isXOpen()` method |
| `page.goto(\`${env.baseURL}/…\`)` + `waitForLoadState` + loader wait | `gotoAppPath(path)` or a `static openX()` factory |
| `page.reload()` + loader wait | `reload()` |
| `page.waitForSelector('#loader', …)` | `waitForLoaderHidden()` |
| `page.addInitScript(…)` seeding browser state | a named seeding method, e.g. `seedCorruptedFilterState()` |
| `page.keyboard.press(...)` aimed at a specific control | `activateXByKeyboard()` returning the observable result |
| `new LoginPage(page)` + `login()` + `new XPage()` + `goto()` | a `static openX(page, fixture, lang)` factory |
| `expect(pageObject.someLocator).toBeVisible()` | `expectXVisible()` on the page object |

**Locator exposure rule.** A page object MAY expose `readonly` locators, but a spec may
only pass them to a page-object method — never chain `.locator()`, `.evaluate()`,
`.count()`, or `.innerText()` off them. Chaining off an exposed locator is the same
violation as writing the selector inline; it just hides it one level deeper.

**No UI helper functions in spec files.** A spec must not declare a function that takes
`page`/a page object and drives the screen (`async function openRecord(page, …)`,
`applyFilter(list, …)`, `readSelectedValue(list)`). Those are page-object methods that
were written in the wrong file. Compose multi-step flows as page-object methods
(`applyFilterMode(mode, value?)`), not as spec-local helpers.

**A spec file contains TEST CASES ONLY.** Not "mostly test cases" — a spec declaring any
named helper is a layering failure. Route every helper to its owning layer:

| Helper kind | Owning layer | Example |
|---|---|---|
| Screen interaction, waits, composite UI flows | `pages/XPage.ts` | `applyFilterMode()`, `openFilter()` |
| Oracle key resolution, DB lookups, tolerance assertions | `pages/XPage.ts`, beside the existing DB-oracle helpers | `resolveRecordId()`, `expectMatchesOracle()` |
| Fixture seeding / teardown via API | `prerequest/*PreRequest.ts` | `setupRecordFixture()` |
| Reusable domain calculations | `utils/*` | `computeExpectedTotal()` |

Scan the owning layer BEFORE writing a helper — these files already exist and already
contain siblings of what you are about to write.

**Only these may appear in a spec:** `test.describe` / `test` blocks,
`test.describe.configure({ mode: 'serial' | 'parallel' })` lines that apply the `<run_plan>`
groups, `step(title, body, { deadline?, expects? })` blocks from `helpers/steps.ts` (one per
manual step — `references/code-craft.md` §5, §9), `beforeAll`/`afterAll` wiring that just *calls*
a `prerequest` fixture, `beforeEach`/`afterEach` reporting hooks (the `afterEach` evidence hook
only copies Playwright's failure attachment to `attempt-{a}-failed.png` — it never takes the
assertion-point evidence image; the console guard's `attachConsoleGuard(page)` / `guard.report()`
pair lives in the same hooks), the one-line `await captureEvidence(page, testInfo)` call placed at
the assertion point of every test body as a TOP-LEVEL statement (see `<result_organization>`),
`uniqueName()` / `runPrefix()` calls from `helpers/test-data.ts`, locale/label constant tables,
an `import { test, expect } from '…/fixtures/test'` when the project has a fixture layer, and a
one-line delegating alias to a `prerequest` fixture.

**How a page object, a component object, a locator chain and a spec are WRITTEN** — authoring
conventions, the locator order (source-confirmed `data-testid` → role → label → text → stable
CSS), Angular Material / CDK overlays, positional selectors, fixtures beside `prerequest/`, unique
test data — is `references/code-craft.md` §1-7. Load it before writing or extending any page
object. Its `[M]` sections are Checkpoint A / B items; its `[R]` sections are noted, never blocking.

**Constants must have one source of truth.** Do not redeclare a tolerance, timeout, or
threshold in a spec when the owning layer defines it — import or alias it. And never merge
two constants that happen to share a name (different documents may specify different
tolerances — conflating them silently weakens assertions).

**Simplicity.** Prefer the smallest readable spec: one page-object call per step, the
assertion message carrying the requirement. If a test body reads like DOM plumbing rather
than the approved TC's steps, the abstraction is in the wrong place — move it.

**Self-check commands — run BOTH before Phase 3 and paste the results in your output:**
```bash
# 1. No element access or raw page driving in the spec
grep -nE "\.locator\(|getByTestId\(|getByRole\(|\.evaluate\(|page\.(goto|reload|waitForSelector|addInitScript|keyboard)\(|new [A-Za-z_]*(Login|Auth)[A-Za-z_]*\(" <spec-file>

# 2. No helper declarations in the spec (only a one-line prerequest alias is allowed)
grep -nE "^(async )?function |^const [a-zA-Z_]+ = (async )?\(" <spec-file>
```
Any hit from (1) outside a `beforeEach`/`afterEach` evidence hook (the `captureEvidence()` call
itself is not a hit — it takes `page`, not a locator), and any hit from (2) that
is not a single-line delegation to a `prerequest` fixture, must be moved to its owning layer
before you execute anything. Report both as `POM self-check: clean` or list what you moved.

**The greps are a starting point, not the verdict.** `scripts/validate-automation.mjs` runs the
same checks over comment- and string-stripped source (so nothing inside a comment or a string can
trigger them) and adds the chained-locator and spec-helper rules. **A clean grep does not prove
compliance** — Checkpoint A pairs both with semantic review, because no text scan can tell whether
a composite flow ended up in the layer this project actually owns it in. Moving a helper into an
arbitrary file purely to silence a grep is itself the violation.

**Layer ownership follows THIS project's architecture.** The routing table above is the default
when the project has no convention of its own. Where it does — a different fixtures folder, a
`components/` layer, an existing helpers module — match it, and record it under
`automation.layers` in `Testing/qa-manifest.json` so the validator checks the same boundaries
instead of assuming these names.

**Verify your typecheck actually runs.** Some automation projects' `tsconfig.json` makes
`npx tsc --noEmit -p tsconfig.json` report **zero errors even for a deliberate type error**
— for example `moduleResolution: "bundler"` combined with `module: "commonjs"` makes tsc
abort with `TS5095` before checking anything. A clean run there proves nothing. Prove the
checker works by injecting a throwaway type error first; if it is not caught, typecheck with
a dedicated config (e.g. `tsconfig.check.json` with `moduleResolution: "node"`) and record
that in the learning file. Never report "typecheck clean" from a run you have not confirmed
is actually checking.
</pom_mandatory>

<normalization>
Internal step (no JSON handoff files) — normalize each approved TC:

- One step = one action; split compound steps.
- Action mapping: navigate / click / select / type / wait.
- Assertion mapping: "is displayed" → visible · "text equals" → text ·
  "contains N rows" → count · "redirects to" → url.
- Every TC ≥ 1 assertion. A step or Expected Result that cannot map deterministically →
  **PARK that TC as an open question** (source `A`) carrying the exact wording that is
  ambiguous, and continue with the other TCs. `PHASE 2.4 <open_questions>` asks the user about
  it with evidence-backed options and then generates it. **Never BLOCK the run over it, and
  never interpret a vague expected result silently** — an interpretation is either chosen by
  the user, reused from the learning file, or carried as an explicitly tagged assumption.
- **Precondition / data mapping:** every sentence in `Preconditions`, `Data Oracle`,
  `Shared data` and every role named in the steps → one plain-English requirement
  (`role user exists`, `record of type X in state Y exists (count N)`, `empty state for Z`,
  `configuration / feature flag`, `external system or background job`). These feed
  PHASE 2.6 `<data_readiness>`; a TC with none is `read-only, no data need`.
- **Reference tokens resolve per ID, never by shortcut.** A TC names its configuration as
  `Open the portal [E1]`, `Login as Administrator [A1]`, `price list "Sample" [D1]`
  (`TEST-DATA-{feature}.md` §0 / §1 / §2). `[E{n}]` maps to **its own** environment entry keyed by
  the E-ID (E1 is not "the" URL — E2 may be the mail sandbox); `[A{n}]` maps to **that** account
  keyed by the A-ID, credentials looked up by account ID and never by role (a role may own several
  accounts); `[D{n}]` maps to that data item. In code this is `environment('E1')`, `account('A1')`,
  `dataItem('D1')` from `helpers/test-data.ts` (`assets/test-data.template.ts`) reading the env
  vars named after the ID (`E1_URL`, `A1_USER` / `A1_PASSWORD`) — no default, no literal, no
  "first E row" or "any Administrator" anywhere. A `[HUMAN]` step is kept as text and bounds the
  generated part (PHASE 2 candidacy). A `- **Reviewer comment:**` bullet is the reviewer's note to
  the QA skills: it is never normalized, never generated into code, never part of the TC hash; an
  open one that asks for a TC change is reported once ("route to skill 3 `--revision`"), and the
  approved text is automated as written.
</normalization>

<selector_resolution>
Selectors come from SOURCE ONLY — never from memory, never guessed:

0. Grep `Testing/project-learning.md` for this feature's `[module: …]` / `[page: …]`
   `[type: trick]` lines (and its `[similar: …]` pages): known identification patterns and
   `data-testid` values recorded by earlier runs or by skill 3/10 are verified against source
   once, not rediscovered. After resolution, record every newly confirmed pattern and value
   there in words (`- [module: Orders] [page: Order Details] [element: Save button] [type: trick] Identified by test id order-save-button; enabled only after all required fields are filled.`).
1. Scan the implementation files for the feature (Angular templates `*.html`,
   components `*.ts`, TSX/JSX) and build a `data-testid` index.
2. Classify each logical target: RESOLVED (one certain match) · AMBIGUOUS ·
   NOT_FOUND · DYNAMIC (computed testid) · OUT_OF_SCOPE (vendor component).
3. Safe-fix rules for AMBIGUOUS / NOT_FOUND:
   - MAY add a missing `data-testid` to an interactive element — naming
     `{feature}-{element}-{type}`, kebab-case, unique per page; shared components
     receive the feature prefix from the call site, never hardcoded inside the
     shared component.
   - RENAME an existing testid only after a **full-repository impact check**:
     search every usage; usage found in any non-test file → do NOT rename (report
     it), fall back to a source-confirmed stable selector with a documented reason
     inside the page object.
   - Never change element structure, classes, styles, handlers, or business logic.
4. AMBIGUOUS / NOT_FOUND / DYNAMIC / OUT_OF_SCOPE targets that no safe fix resolves →
   **raise as an open question** (source `B`) for `PHASE 2.4 <open_questions>`: the candidate
   options are the source-confirmed fallback selectors actually found (each with the file and
   what it shows), so the user picks the right element instead of the skill guessing. Document
   the outcome in Deviations. Only when PHASE 2.4 yields no evidence-backed candidate does the
   TC fall back to a `// TODO` note on a stable fallback selector or a skip-guard carrying the
   precise blocker.
</selector_resolution>

<run_plan>
**Build the RUN PLAN for this User Story BEFORE writing specs — it decides what runs in
parallel and what runs one after another, to minimise total run time without letting TCs
corrupt each other's data.**

Input: every automation-candidate TC in the approved document. Output:
the `run_plan` object of `{run_file}` (`.runs/phase-{N}.json`, written at PHASE 2.6 and updated at
run start) + a short summary in
the chat and in the progress log.

**Classification — first matching rule wins:**

| Signal | Result |
|---|---|
| TC field `Data effect: read-only` | **parallel** |
| TC field `Data effect: creates / modifies / deletes` | **serial**; group = the `Shared data` value, else the entity named in the steps |
| TC field `Shared data: {name}` present on two or more TCs | all of them **serial** in the same group `{name}` |
| No fields → the steps or preconditions contain a mutating action (*create, add, new, edit, update, save, delete, remove, approve, reject, submit, upload, import, change status, assign*) or a precondition that depends on data another TC creates | **serial**; group = the entity / fixture named in Preconditions or Data Oracle (fall back to the screen name) |
| The TC signs in with an account that only allows one session, or switches the application language for the whole session | **serial** in that account's / locale's group |
| PHASE 2.6 created this TC's data (api / ui journey / db) | **serial** in the group named after the gap (`serial:{gap}`), scheduled after that gap's setup group; its teardown runs after the group |
| The TC IS a PHASE 2.6 UI setup journey (`00-setup-{entity}.spec.ts`) | its own **setup group** `setup:{entity}`, **serial**, runs FIRST — before smoke |
| Everything else (open, view, search, filter, sort, paginate, check a label or message, validate a field, export) | **parallel** |
| Cannot decide | **serial** (fail safe) — record the reason |

Locale variants (`TC-01` and `TC-01b`) always share the classification of their base TC.
Decisions driven by the TC fields are marked `field`; the rest `inferred`.

**Required variants per TC.** The plan also records, for every TC, the set of test variants that
MUST pass for the TC to count as passed: every Playwright project the story runs (`projects[]` —
normally just `{browser_project}`) × every data variation the spec defines for that TC
(parameterised tests whose titles carry a variation label, e.g. `— variation A`; `none` when the
test has no variation). Locale variants `TC-01` / `TC-01b` are separate TCs, not variations. The
`variant_slug` is `{project}--{data-variation-slug}--r{repeat}` (`r0` unless `repeatEach` is used).
`<second_run>` compares the executed variants against this list — a TC with a required variant
missing is `INCOMPLETE`, never `PASS`.

**`{run_file}.run_plan` shape:**

```json
{
  "user_story": "US-1234", "generated": "ISO-8601",
  "headed": true, "workers_parallel": 2,
  "projects": ["chromium"],
  "required_variants": {
    "TC-001": ["chromium--none--r0"],
    "TC-007": ["chromium--variation-a--r0", "chromium--variation-b--r0"]
  },
  "setup_groups": [
    { "name": "setup:order-items", "mode": "serial", "workers": 1, "spec": "tests/Orders_Tests/00-setup-order-items.spec.ts",
      "provides": "an order with line items", "decision": "ui", "cleanup": "delete", "source": "qc" }
  ],
  "groups": [
    { "name": "parallel", "mode": "parallel", "workers": 2, "tcs": ["TC-001", "TC-001b", "TC-004"] },
    { "name": "serial:order-items", "mode": "serial", "workers": 1,
      "tcs": ["TC-010", "TC-011", "TC-011b"], "reason": "all edit the same order's line items" }
  ],
  "decisions": [
    { "tc": "TC-010", "mode": "serial", "source": "inferred", "why": "step 4 saves a new line item" },
    { "tc": "TC-001", "mode": "parallel", "source": "field", "why": "Data effect: read-only" }
  ],
  "estimate": { "serial_only_s": 0, "planned_s": 0 }
}
```

**How the plan reaches the tests:**
- Every test title carries, in addition to `@smoke` / `@positive` / `@negative`, exactly one
  run tag: `@run:parallel` or `@run:serial-{group}` (kebab-case group name).
- Each serial group is its own `test.describe('{group}', …)` block with
  `test.describe.configure({ mode: 'serial' })` and its reason in a comment on the line above;
  parallel TCs need no `configure` call under the shared config's `fullyParallel: true` (an
  existing `{ mode: 'parallel' }` line is harmless). Nothing else about the spec changes
  (`<pom_mandatory>` still rules).
- Execution order inside every stage is defined in `<staged_execution>`: parallel group first
  with `--workers={workers_parallel}`, then each serial group with `--workers=1`. **A serial
  describe orders its own tests; it does not exclude other groups** — two serial describes, or a
  serial describe and the parallel group, WOULD run side by side on two workers in one command.
  The per-group command is therefore what isolates shared data, and `--workers=1` on a serial
  group is the documented override of the shared config's 2 workers (recorded in the group's
  `reason`).
- Report `serial_only_s` (sum of average TC durations) vs `planned_s` (parallel group ÷
  workers + serial groups in sequence) in the chat when the plan is built, and refresh both in
  `<live_progress>` once real timings exist.
- Read `Testing/project-learning.md` `[type: env]` / `[type: trick]` lines first — a serial
  group discovered in an earlier run for the same module is reused; after the run, record new
  groups and the worker count that ran cleanly as plain-English tagged lines.
</run_plan>

<shared_config>
**ONE shared `playwright.config.ts` for every story — updated, consolidated or created; never a
per-story file.** The full setting contract (Chrome channel, headed, 2 workers, `fullyParallel`,
`forbidOnly`, `retries: 0`, env-driven `outputDir` / `globalTimeout` / `headless`, trace and video
retention, viewport / locale / timezone, the timeout keys) is `references/code-craft.md` §8-9;
the skeleton for a project with no config is `assets/playwright.config.template.ts`; the timeout
policy it imports is `assets/timeouts.template.ts` → `{automation_root}/timeouts.ts`.

**Procedure — run at profile time, before any spec is written:**

1. **Inventory.** `node .claude/skills/link-qc-5-test-run-automation/scripts/config-inventory.mjs --root .
   --pretty` lists every `playwright*.config.*`, every reference to each (package.json scripts, CI
   files, docs, other configs, code — a mention in a comment or a code fence counts) and the
   settings that block a merge. `verdict: none` → step 5. `single` → step 4. `multiple` → 2-3.
2. **Reference scan + mergeability, per extra config.** A config is a merge candidate only when
   its effective behaviour can be reproduced in the shared file with identical results: a
   `projects[]` entry (another browser / locale / device), an env-driven `use` value, or a reporter
   entry. A config that sets `globalSetup` / `globalTeardown`, another `testDir`, a `webServer`, a
   custom reporter with per-file options, `storageState` or a snapshot path — or any setting you
   cannot reproduce with identical behaviour — is **kept, not merged**, and reported under
   `Configurations not merged` with the blocking setting and what a human would have to decide.
   Never guess a merge.
3. **Merge, rewrite, verify, THEN remove.** Write the candidate's settings into the shared file
   (its `projects[]` / `use` overrides become named entries with a comment naming the source
   file). Rewrite EVERY reference the inventory found — package scripts (`--config X` →
   `--project=… --grep …` or plain), CI steps, docs, imports. Run the smoke stage once through the
   shared file. Re-run the inventory: only a file it now lists under `deletable[]` (zero remaining
   references, no blocking setting) may be deleted, each listed in the Placement Manifest as
   `removed (consolidated from <file>)`. A file with a remaining reference or a blocking setting
   stays, and the report says why. Leftover `playwright.us-*.config.ts` from earlier skill
   versions follow the same path — they are never deleted on sight.
4. **Update in place.** Bring the shared file to the §8 contract without discarding a valid
   project setting: add `channel: 'chrome'` to the UI project (keep its NAME — it is part of every
   evidence path), set `workers: Number(process.env.PW_WORKERS ?? 2)`, `fullyParallel: true`,
   `forbidOnly: !!process.env.CI`, `retries: 0`, `headless` from `PW_HEADLESS`, `outputDir` from
   `PW_OUTPUT_DIR`, `globalTimeout` from `PW_GLOBAL_TIMEOUT`, every timeout from `timeouts.ts`,
   `trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'`, viewport / `deviceScaleFactor` /
   `locale` / `timezoneId`. **Reporters: ADD what this skill requires, never replace what the
   project configures.** Ensure the list contains `['line']` (it feeds the live progress),
   `['json', { outputFile: process.env.PW_STAGE_JSON ?? 'artifacts/stages/unnamed.json' }]`
   and `['./helpers/progress-reporter.ts']` (the incremental results the watchdog relies on).
   The `json` reporter writes ONE file PER STAGE COMMAND because every stage / run-group command
   sets `PW_STAGE_JSON={results_root}/artifacts/stages/{stage}-{group}[-attempt{n}].json`, so
   separate commands never overwrite each other's results. **Every other reporter the project
   already configures is preserved and runs alongside** — the built-in `html` reporter, a JUnit
   reporter for CI, a custom one. Never delete or disable one to "clean up" the config. If the
   config already declares its own JSON reporter, `{stage_json_path}` is THAT file: copy it to
   the stage file right after each command rather than adding a second one. A setting that
   already differs from the contract for a stated project reason (a recorded `[type: env]` line,
   a comment in the file) is kept and listed as a Deviation, not overwritten.
5. **Create** from `assets/playwright.config.template.ts` + `assets/timeouts.template.ts` only
   when no config exists at all; register the project's `testDir` / `testMatch`.
6. **Helpers.** Copy `assets/steps.template.ts`, `progress-reporter.template.ts`,
   `console-guard.template.ts`, `test-data.template.ts` into `helpers/` when the project has no
   equivalent (match an existing equivalent instead of duplicating it); add the `.gitignore`
   lines of `references/code-craft.md` §12. `helpers/test-data.ts` carries the per-ID maps of
   `<normalization>` — `environments` keyed by E-ID and `accounts` keyed by A-ID, each entry
   reading `{ID}_URL` / `{ID}_USER` / `{ID}_PASSWORD` at run time with no default — fill one entry
   per row the story's TEST-DATA file has; an existing env layer keyed by role is extended with the
   ID-keyed entries, never replaced. Everything touched goes in the Placement Manifest.
7. **Version gate.** Resolve `playwright_version` (`<project_profile>`); < 1.42 → BLOCKED with
   the upgrade command; otherwise record the feature gates (tags object, `--last-failed`, native
   step timeout) for `<spec_writing>` and the Timeout policy section.

**Per-run values reach the config only through environment variables set on each command**
(`PW_STAGE_JSON`, `PW_PROGRESS_FILE`, `PW_OUTPUT_DIR`, `PW_GLOBAL_TIMEOUT`, `PW_HEADLESS`,
`PW_WORKERS` / `--workers`, `PW_PHASE`, `PW_STAGE_ATTEMPT`). The file is not rewritten per story,
so the compliance `scopeDigest` (which hashes the config AND its one-hop relative imports such as
`timeouts.ts`) stays stable across stories and changes exactly when the policy changes.

**Nothing may override or discard the required stage JSON.** Do not pass `--reporter=…` on the
CLI: Playwright's `--reporter` **replaces** the whole configured list and silently drops the
stage file (the per-stage freshness gate in `<live_progress>` catches this, and stops the run).
The same applies to a config change that removes the JSON or the progress reporter. Do not pass
`--config` either: the shared file is the default, and a stray `--config` is how a retired
per-story file comes back. `{run_report_html}` is this skill's own designed report, built from
`{run_file}.merged` — additional to, not a replacement for, whatever HTML report the project
already produces.

**Acceptance — in the consumer project, every time this block changes the config (NOT_RUN when
it cannot run):** the smoke stage runs through the shared file, and a one-off probe spec
`tests/_probe/watchdog-probe.spec.ts` (one `step()` with a 5 s deadline around a 60 s action)
shows: the structured step error names the TC and the step; `attempt-1-failed.png` is written by
the `afterEach` hook; teardown completed; the next test in the same worker started only after
it; no orphaned Chrome process; the incremental results line is present. The probe is deleted
afterwards and the result recorded under `Probe:` in the Timeout policy section.
</shared_config>

<spec_writing>
Write the spec against `{automation_root}` following the project conventions:

- **File:** correct `tests/{Area}_Tests` folder, `NN-{kebab-feature}.spec.ts` with the
  next free sequence number (list the folder to confirm). One spec per feature
  slice — split only for unrelated surfaces or incompatible setup, and document why.
- **Traceability header** (mandatory):
  Feature · Requirement(s) · Change Type · Regression Risk · Target Test Type ·
  Generated by: test-automation skill · Steering versions · Source TC document path.
- **Auth:** through `{login_page_object}` with credentials from the env layer
  (`env.username` / `env.password` / `env.baseURL`). NEVER hardcode credentials or
  URLs; NEVER invent env-var names; no raw inline login flow; no storageState
  unless the project actually uses it.
- **Registration:** add the new UI spec filename to the `{browser_project}`
  `testMatch` regex in `playwright.config.ts` (and the non-browser project's
  ignore list where applicable). An unregistered UI spec runs under the wrong
  harness and fails — this is part of Phase 2, not a follow-up.
- **Structure:** `test.describe('{REQ-IDs}: {requirement description}')`;
  every test title starts with `[TC-ID]` and carries exactly one of
  `@positive` / `@negative`; TCs marked `Smoke: YES` in the approved TC document
  ALSO carry `@smoke` (additive — the polarity tag stays). `@smoke` derives ONLY
  from the TC document's `Smoke:` field — never from this skill's own judgment.
  Every title ALSO carries its `<run_plan>` tag — `@run:parallel` or
  `@run:serial-{group}` — and serial groups sit in their own describe block with
  `test.describe.configure({ mode: 'serial' })`. Every test calls
  `await captureEvidence(page, testInfo)` **at its assertion point** — the line right
  before (or, for multi-assert TCs, right before the LAST) `expect(...)` of the Assert
  step, while the screen still shows the state the TC verifies — so the per-variant /
  per-attempt evidence image is written per `<result_organization>`. The call is NEVER placed
  in `afterEach`, after a
  cleanup/delete/reset call, or after navigation away from the verified screen.
  AAA structure; fixtures/seeding reused from
  `prerequest/` + `helpers/` (this is the data oracle); every api_setup precondition
  gets a matching `afterEach`/`afterAll` teardown — teardown always runs AFTER the
  evidence image is on disk, so a cleaned-up screen can never be what the image shows. Data a spec needs but the environment
  lacks is NOT the spec author's problem to guess — it is a PHASE 2.6 requirement the QC
  decides on (`<data_readiness>`).
- **Banned:** `test.only` (see `<test_modifiers>`) · CSS/class/nth-child/text
  selectors when a data-testid exists · shared mutable state between tests ·
  commented-out test bodies · a placeholder assertion that cannot fail for any state of the
  application. Waits follow `<wait_policy>` — prefer web-first assertions
  (`expect(locator).toBeVisible()`, `page.waitForURL()`, …).
- **Steps:** every manual TC step is one `await step('{manual step wording}', async (report) => {…},
  { deadline?, expects? })` from `helpers/steps.ts` — the wrapper owns the deadline
  (`references/code-craft.md` §9); a known long operation names its `TIMEOUTS.operations.*` key;
  `report('…')` inside a long operation keeps the watchdog informed. `captureEvidence` stays a
  top-level statement before the Assert step, never inside a step callback.
- **Tags** via the details object on Playwright ≥ 1.42 (`{ tag: ['@positive', '@smoke',
  '@run:parallel'] }`), in the title below that; the `[TC-ID]` prefix stays in the title always.
- **`expect.soft`** only for independent checks of ONE expected result, never across steps; the
  last assertion of the Assert step is a hard `expect`.
- **Test data a TC creates** is named by `uniqueName(prefix)` / cleaned by `runPrefix(prefix)`
  from `helpers/test-data.ts` — never a fixed literal (`references/code-craft.md` §7).
- **Console guard** attached in `beforeEach`, reported in `afterEach` (`helpers/console-guard.ts`,
  allow-list from `Testing/qa-manifest.json` `automation.consoleAllowList`); an unexpected browser
  error is a Deviation for the human, never a TC failure by itself.
- **Fixtures** (`fixtures/test.ts`, `test.extend`) may wrap `prerequest/` functions for guaranteed
  teardown; the spec then imports `test` / `expect` from there (`references/code-craft.md` §6).
- **Skip guards** are written ONLY from a PHASE 2.6 outcome — a QC `skip` decision, the
  pipeline default for an undecided gap, or an `IMPOSSIBLE` requirement — with the gap's
  exact wording as the one-line reason. Never invented by the spec author, never to avoid a
  real failure, never `test.skip(!data)` "just in case".
</spec_writing>

<test_modifiers>
**`only` · `skip` · `fixme` · `fail` · `slow` — every form: bare, conditional
(`test.skip(cond, 'reason')`) and suite-level (`test.describe.skip(…)`).**

| Modifier | Policy |
|---|---|
| `only` (also `fit`, `describe.only`) | **Never committed.** It silences every other test, so a green run would mean nothing. Not exemptible. |
| `skip` | Allowed **with a reason** tracing to a PHASE 2.6 readiness decision, an approved requirement, or an honoured exception. Counts `SKIP`, never a pass. |
| `fixme` | Allowed with a reason — a known-broken test that must not read as a pass. |
| `fail` | Allowed with a reason — an **expected failure**: its own row in the report, never merged into the pass count, and a failure of the run if it unexpectedly passes. |
| `slow` | Allowed with a reason — it **extends the timeout**, it does not skip. Never reported as a skip, never used to paper over an unexplained slowdown. |

**Targeted runs stay possible without editing files.** Use the runner's own filters —
`--grep` / `--grep-invert`, `--project`, `--last-failed`, `--repeat-each`, `--workers` — on the
shared config. That is the supported way to run a subset; a focused modifier is not.

**A missing prerequisite must stay visible** in the run file, the report's phase section and the chat
summary, against the original scope, with its reason. Never removed from the totals.

Detail: `references/automation-rules.md` §3.
</test_modifiers>

<wait_policy>
**Applies to specs, page objects, fixtures and helpers alike** — a fixed wait moved out of a spec
into a page object is the same fixed wait.

- Prefer an **observable condition**: a web-first assertion, `waitForURL`, `waitForResponse`, or a
  state the page object exposes. Bounded polling (`expect.poll`, `toPass({ timeout })`) is fine.
- **Timers are not banned.** A justified retry backoff, a real debounce, or an explicit timing
  requirement from the spec is legitimate — state the reason on the line above or in a `qa-allow`
  so it appears in the report instead of reading as a lazy sleep.
- **Never raise a timeout to conceal an unexplained failure.** Either the reason is known (say it)
  or it is unknown (investigate it).
- **Never `networkidle` as readiness** (`waitForLoadState('networkidle')`, `{ waitUntil:
  'networkidle' }`) — it never settles on pages that poll and settles too early on lazy pages.
  Wait for the application's own signal: the loader hidden, the response that carries the data,
  a web-first assertion on the element the step needs. Validator rule `wait-network-idle`.
- **Every wait is bounded by the step deadline** (`helpers/steps.ts`, `timeouts.ts`); a visible
  loader never extends it — a loader that outlives the deadline IS the timeout the step reports.
  Timeout values come from `timeouts.ts`, never inline.

Detail: `references/automation-rules.md` §4 and `references/code-craft.md` §9-10.
</wait_policy>

<checkpoint_a>
**CHECKPOINT A — MANDATORY PRE-RUN COMPLIANCE GATE.** Runs after generation and BEFORE anything
executes; it is the first gate in `<environment_gate>`. Load
`references/compliance-checkpoints.md` and work its checklist — it is derived from every rule in
this file, not only the items repeated below.

**Scope:** every test created, modified or selected for this run, **plus** the page objects,
fixtures, helpers, configuration and evidence/reporting code they touch.

**Procedure:**

1. **Mechanical checks.** Run the project's own tooling first where it exists (ESLint with
   `eslint-plugin-playwright`, `tsc`, an existing lint script), then:
   ```bash
   node .claude/skills/link-qc-5-test-run-automation/scripts/validate-automation.mjs \
     --root . --pretty --files <in-scope specs + the page objects, components, fixtures and helpers they touch> \
     --tc-ids <approved TC doc> --req-ids <REQ file> --require-steps \
     --inventory {reports_folder}/automation-inventory.md
   ```
   `--files` carries the page objects and helpers too: the wait, positional-selector and
   `networkidle` rules apply in every layer, and a file the scanner never sees is never checked.
   `--inventory` is the `<automation_inventory>` decision table: the page-class pass walks the
   whole automation root on its own, and a candidate pair no row covers is `pom-duplicate-page`
   (review) that keeps the scanner gate BLOCKED — an unaddressed candidate fails this checkpoint.
   `--require-steps` is passed for the specs this run generated or updated (legacy specs may
   omit it; say so). Report `gate`, `counts`, `review[]`, `notRun[]` and `exceptions[]` together
   — never just "clean". A `gate: PASS` means no banned pattern was found and **nothing more**.
   If the script cannot run, report it **unavailable**, never passed.
   Then: `node …/scripts/config-inventory.mjs --root . --pretty` must report `verdict: single`
   (or `multiple` with every extra config listed under `Configurations not merged` with its
   blocking setting — never an unexplained per-story file); and `playwright_version` is recorded
   with the feature gates it implies (`references/code-craft.md` §14).
2. **Semantic review** of every judgement the scanner cannot make: correct layer ownership,
   whether each assertion verifies its required outcome, whether evidence sits at the assertion
   point, and whether each honoured exception's cited source actually justifies it.
   **A clean grep does not prove compliance.**
3. **Fix confirmed automation-code violations immediately.** They are repairs, not
   recommendations — never defer them, never list them for the user to approve, never ask anyone
   to say "fix 1". Only an unresolved **business** decision (one that changes what the expected
   behaviour is) goes to the user.
4. **Repeat the affected checks after every repair** — a repair invalidates what it touched.
5. **Proceed with the compliant scope only.** Tests still blocked are isolated and reported
   against the original scope; the run continues for everything independent of them.
6. **Record the gate** (`PASS` / `FAIL` / `BLOCKED`) per `compliance-checkpoints.md` §5, with the
   `scopeDigest` from the validator's `fingerprint`.

**Gate result.** `PASS` only when there are no confirmed violations in scope **and** every
`review[]` / `notRun[]` item is closed — by the scanner, by other project tooling, or by
documented semantic review against the same `scopeDigest`. Anything still unresolved →
**BLOCKED for those items**, named one by one, while independent work continues.

**At this checkpoint you verify evidence and reporting IMPLEMENTATION AND CONFIGURATION ONLY.**
The actual images, the completed run file and the report markdown / HTML do not exist yet: record them `scheduled for Checkpoint B`.
Claiming they exist, or marking their runtime verification passed, is a false claim.

Checklist (all of these, plus `references/compliance-checkpoints.md` §2):

- [ ] Placement Manifest complete; spec + page objects at correct paths; spec registered
- [ ] **Automation inventory written before any page object** (`<automation_inventory>`): the
      whole automation root scanned, one decision row per screen in
      `{reports_folder}/automation-inventory.md`, every candidate named with its reason, the
      validator run with `--inventory` and **no open `pom-duplicate-page`** (every candidate pair
      `pom-duplicate-page-decided`); a `create` row with an unaddressed candidate = FAIL
- [ ] Zero inline locators in specs — all interaction through page objects
- [ ] **POM self-check grep run and reported clean** (see `<pom_mandatory>`)
- [ ] No spec-local function takes `page` or a page object and drives the screen
- [ ] No `.locator()` / `.evaluate()` / `.count()` chained off a page object's exposed locator
- [ ] Every automation-candidate TC-ID implemented or skip-guarded with a precise reason; a
      candidate with `[HUMAN]` steps implemented up to the first one and listed
      `partial (human step: n)` — never as full coverage
- [ ] **Every `[E{n}]` / `[A{n}]` / `[D{n}]` reference resolved through its own ID-keyed entry**
      (`environment('E1')`, `account('A1')`, `dataItem('D1')`) — no role-to-account, no
      "first E row", no literal URL or username in code
- [ ] Coverage table matches the approved document exactly (no invented scenarios)
- [ ] No banned patterns (waitForTimeout / test.only / hardcoded creds or URLs)
- [ ] AAA identifiable in every test; every test has ≥1 assertion
- [ ] **Evidence at the assertion point: every test captures evidence exactly once, at its Assert
      step and BEFORE any teardown / cleanup / delete call, and no `afterEach` contains it**
      (see `<result_organization>`). **The capture may be DIRECT in the spec or INDIRECT inside a
      page-object / helper method the test calls** — both are compliant. A direct-call search
      (`grep -n "captureEvidence" <spec-file>`) is a starting point, never the verdict: never
      report evidence missing on a direct-call search alone. `validate-automation.mjs` follows the
      methods each test actually invokes and reports `evidence-call-found` (found on a
      straight-line path), `evidence-conditional` / `evidence-unresolved` (undetermined → review),
      or `evidence-missing` (every hop followed, genuinely absent). Placement relative to teardown
      is **always** a semantic-review item — a call site is not proof of when it runs.
- [ ] Isolation: each test runnable alone; teardown for every api_setup
- [ ] Traceability header present; describe has REQ-ID; titles have [TC-ID] + polarity tag
      (+ `@smoke` where the document marks it)
- [ ] Open questions resolved (PHASE 2.4): every parked TC generated from a user decision, a
      learning-file reuse, or a tagged `@unverified-assumption`; every answer already written
      back to the learning file as a generic rule
- [ ] Static coverage measured (PHASE 2.5) and the gate verdict recorded before any run
- [ ] Test-data readiness resolved (PHASE 2.6): every predicted skip has a QC decision or the
      pipeline default; every skip guard in the specs traces to one of them
- [ ] **Every assertion verifies the outcome its TC requires** — a visibility check only where
      visibility or access IS the requirement; values, calculations, permissions and state changes
      assert those outcomes (`references/automation-rules.md` §2)
- [ ] **Every expected value traces to an approved requirement or an approved clarification** —
      never to observed behaviour alone (`<source_of_truth>`)
- [ ] **Modifier policy honoured** (`<test_modifiers>`): no focused execution anywhere; every
      `skip`/`fixme`/`fail`/`slow` carries a traceable reason and stays visible in the status model
- [ ] **Wait policy honoured across specs, page objects, fixtures and helpers** (`<wait_policy>`)
- [ ] **Validator run and its full result reported** — `gate`, `counts`, `review[]`, `notRun[]`,
      `exceptions[]`; every open item closed by documented semantic review, or the gate is BLOCKED
      for those items
- [ ] **Every honoured exception's cited source opened and its substance recorded** (justified /
      rejected) — a well-formed `qa-allow` is not yet a justified one
- [ ] **Gate recorded with the `scopeDigest`**, and no applicable check recorded as PASS without
      having run; evidence/report runtime artifacts recorded `scheduled for Checkpoint B`
</checkpoint_a>

---

## PHASE 2.4 — OPEN QUESTIONS (interpretation gate)

<open_questions>
**Runs after PHASE 2 generated everything it could, and BEFORE PHASE 2.5.** An approved TC
document can still read ambiguously in places. Those TCs are **decided here with the user —
never blocked, never guessed silently, and never discovered by the run.**

The shape is the same as `<data_readiness>`: collect → dedupe → find options with evidence →
ask ONCE → execute → write the artifact → write back to the learning file.

**1. Collect the open questions** from four sources, each item carrying the exact wording:

| Source | What | Where it came from |
|---|---|---|
| `A` | A step or Expected Result that cannot map deterministically to an action + assertion | `<normalization>` parked it |
| `B` | An AMBIGUOUS / NOT_FOUND / DYNAMIC element no safe fix resolved | `<selector_resolution>` step 4 |
| `C` | `> Needs human review: …` notes in `{beautified_tc_doc}` | skill 4 — only under `ado_mode = linked` |
| `D` | `TBD`, `to be confirmed`, `open question`, `assumption:`, or a trailing `?` inside an Expected Result / Precondition of `{source_tc_doc}` | the approved document itself |

**De-duplicate:** the same ambiguity hit by several TCs is **ONE question** carrying the TC
list — exactly as `<data_readiness>` dedupes a requirement across TCs. Never ask the same thing
twice in one run.

**2. Derive the candidate answers — from evidence ONLY, never invented.** In order, stopping at
the first that answers it:
1. **`Testing/project-learning.md` first** — grep `[module: …]` / `[page: …]` / `[element: …]`
   / `[similar: …]` / `[type: trick]` / `[type: qa]` for this feature. **A recorded answer is
   REUSED and NOT asked** (`decidedBy: learning`): quote the line in the chat and move on.
2. **The application source and existing page objects** — what the code actually does: sort
   order, exact message text, validation limit, default state, which element carries the label.
3. **A sibling TC in the same approved document** that states the same behaviour unambiguously.
4. **`US-{id}-code-rules.md`** (skill 11) and skill 10's white-box output, when present.

Every candidate states its evidence — the file and what it shows. Offer **2-4 candidates**,
plus always `manual — don't automate this TC` and `other — type the exact expected wording`.
Mark exactly ONE **recommended** (strongest evidence) and say why in one line.

**3. Ask the user — `AskUserQuestion`, in batches of up to 4.** One question per open item:
- `header` — the TC-ID (e.g. `TC-014`)
- `question` — the ambiguous wording quoted verbatim, then what must be decided
- options — the candidates, **recommended first and labelled `(Recommended)`**, each
  `description` carrying its evidence

Interactive → **WAIT**; the reply is the decision of record. When `AskUserQuestion` is not
available, fall back to the single combined table of `<data_readiness>` step 5 (`| # | TC |
Ambiguity | Options (evidence) | Recommended |`, answered in one line).

**4. Unanswered, or non-interactive → best guess, explicitly marked.**
- Generate the test from the **recommended, evidence-backed** candidate.
- Tag the test `@unverified-assumption`, state the assumption as a comment at the top of the
  test and in the report.
- **HARD GUARD — a failing `@unverified-assumption` test is classified `unverified_assumption`,
  NEVER `app_bug`.** The interpretation is suspect before the application is. Such failures are
  **excluded from the smoke-gate `app_bug` majority math** (a wrong guess must never stop the
  run), are never filed as a bug, and are never published as Passed — ADO outcome
  `Inconclusive`, like `INCOMPLETE`.
- **No evidence-backed candidate → nothing to guess from.** That TC is skip-guarded with the
  exact open question as its reason; it is never invented.
- Coverage table: `partially covered — unverified assumption`.

**5. Write every answer to the learning file as GENERIC knowledge — IMMEDIATELY.**
This is what stops the question ever being asked again — in a later phase of this run, in a
later run, or for another story hitting the same ambiguity.
- Write it **the moment the answer arrives, BEFORE generating the parked TCs**, so PHASE 2.5,
  2.6, 3, 4, 5 and every later story in the session already find it. Never defer it to the end
  of the run.
- Record the **general behaviour rule, not the TC-specific note.** Not
  `TC-014 expects newest first` but
  `- [module: Orders] [page: Orders List] [type: trick] The orders list is sorted newest first by creation date unless the user picks another sort.`
  Any TC touching that list then reuses it without asking.
- Tag it at the level the rule actually holds (`[module: …]` / `[page: …]` / `[element: …]`),
  and add `[similar: …]` on both entries when sibling pages behave the same way.
- An answer that holds **project-wide** goes to `## Project Knowledge` as well, so skills 1-11, 3b and 3c
  share it — that is the generic tier.
- Also keep one traceability line in this skill's `#### Questions and Answers`:
  `- [module: X] [type: qa] **Q (skill 5, {YYYY-MM-DD}):** … — **A:** …`
- Update the `## Index` row for every module touched.
- Grep first: **update or dedupe instead of appending twins**; a later correction by the user
  REPLACES the line rather than adding a second one.
- Plain English only — no selectors, no code identifiers, no credentials
  (`<project_learning_file>` content rules).

**6. Generate the parked TCs** with the resolved interpretation, under the PHASE 2 rules (POM
mandatory, selectors confirmed in source, no banned patterns), then continue to PHASE 2.5.

**Write the `open_questions` object into `{run_file}`** (this phase's run file; the shape below):

```json
{
  "measuredAt": "ISO-8601",
  "totals": { "raised": 3, "answered": 1, "reusedFromLearning": 1, "assumed": 1, "unresolved": 0 },
  "questions": [
    { "id": "Q1", "source": "A", "tcs": ["TC-014", "TC-015"],
      "wording": "the list shows the correct order",
      "candidates": [
        { "key": "a", "answer": "Newest first, by creation date", "evidence": "OrdersController.cs orders by CreatedOn descending", "recommended": true },
        { "key": "b", "answer": "Alphabetical by order name", "evidence": "the column header offers it as a manual sort" }
      ],
      "decision": "a", "decidedBy": "user",
      "learningLine": "[module: Orders] [page: Orders List] [type: trick] The orders list is sorted newest first by creation date unless the user picks another sort.",
      "tag": null },
    { "id": "Q2", "source": "B", "tcs": ["TC-022"],
      "wording": "the confirmation message is proper",
      "candidates": [{ "key": "a", "answer": "\"Saved successfully\"", "evidence": "en.json key orders.save.success", "recommended": true }],
      "decision": "a", "decidedBy": "assumption",
      "learningLine": "[module: Orders] [type: trick] Saving an order shows the confirmation message \"Saved successfully\".",
      "tag": "@unverified-assumption" }
  ]
}
```

Live progress line (the `<live_progress>` format, stage `Open questions`):
`Open questions: {answered}/{raised} decided — {n} TCs parked — {reused n from learning | awaiting user decision | assumed n (unverified) | RESOLVED}`
</open_questions>

---

## PHASE 2.5 — STATIC COVERAGE MEASUREMENT (pre-run gate)

<coverage_measurement>
**Runs after `<checkpoint_a>` and BEFORE PHASE 3 — nothing executes until this verdict exists.**
This is a static read of the spec source, not a pass/fail result: it answers "how much of
the approved document does the generated code *really* cover?" — and it is deliberately
skeptical, because a `test()` that exists is not a TC that is covered.

**Denominator = every TC in `{source_tc_doc}`** (the ORIGINAL approved document — never the
beautified file). Locale variants (`TC-01`, `TC-01b`) are separate TCs, as in the document.
`manual — not automated` TCs stay in the denominator; the number must be honest.

**THREE DIFFERENT NUMBERS — report them separately, never let one stand in for another**
(`references/automation-rules.md` §6):

| Figure | Answers | Where |
|---|---|---|
| **Requirement outcome coverage** | Are each requirement's required outcomes actually asserted? `Full` / `Partial` / `Missing` / `Assumed` | the requirement table in `### Coverage`, one row per REQ/AC |
| **TC automation coverage** | How much of the approved TC document is automated? The weighted % measured below | **this phase's gate** — target, source, repair pass and user-override path all unchanged |
| **Execution pass rate** | Of what ran, how much passed? | PHASE 4 only — never mixed into either number above |

**Traceability is not coverage.** A requirement linked to a test is *traceable*; whether that test
asserts the requirement's outcomes is a separate judgement. A calculation requirement covered only
by a visibility assertion is `Partial`, never `Full`. `@unverified-assumption` tests are
**`Assumed`** — never `Full`, and excluded from confirmed requirement coverage.

**Requirement IDs are validated, never invented.** Resolve every REQ/AC id against the resolved
sources (the story's `REQ-*.md`, the approved TC document, `ADO-MAP.md` when present). Report an id
you cannot resolve; **never derive, renumber or invent one here** — skill 2 owns REQ IDs and
skill 3 owns TC IDs. `validate-automation.mjs --req-ids <REQ file>` flags titles referencing an
unknown id; without the list that check is `notRun`, never a pass.

**Carry forward the document's TC validation states — and treat them as possibly stale.** The
approved document marks each TC `validated` / `enhanced` / `inferred` / `discrepancy` /
`not-implemented` / `draft`. The states other than `draft` are set by the optional
`link-qc-3b-validate-manual-test-cases` or `link-qc-3c-validate-manual-test-cases-cli` (skill 3 itself never
validates live; the stamp key `tool: mcp | cli` says which); when neither ran every TC is
`draft`, which is normal. Those labels were true when the validator wrote them (its evidence stamps
say when and on which build):

- **Re-verify readiness where you can.** An `inferred` or `draft` TC whose screen is now reachable
  is worth re-checking before its label is trusted.
- **Genuinely unavailable implementation** → the TC is `pending — not covered for this run`. Not a
  failure, not an application defect, and it stays visible in the denominator.
- **Investigate a `draft` or unvalidated TC before classifying its failure.** A draft TC failing is
  not by itself proof of an application defect — the TC may simply be wrong. It may still reveal a
  real defect once verified. Verify first, classify second.

Keep missing, partial, blocked and unexecuted coverage visible in their own counts, and **extend**
the existing reports rather than replacing them.

**1. Inventory the generated tests** — per spec file of this story, without reading every
line of logic:

```
grep -nE "test\.describe\(|[^.]test\(|test\.skip\(|\[TC-" <spec>
```

Capture per `test()`: `tcId` (from the `[TC-ID]` in the title), describe group, and:
- `alwaysSkipped` — a `test.skip(true, …)` (or an unconditional skip guard) gates the whole body
- `dataGated` — `test.skip(!data | !entity | !record, …)`: runs only when seeded data exists
- `accessOnly` — the body only asserts that an option/panel/screen is visible; no field value,
  count, identity or status assertion
- `roleLoop` — the test is parameterised over several roles (one `tcId`, many runs)
- `unverifiedAssumption` — tagged `@unverified-assumption` by PHASE 2.4: the expected result it
  asserts is an interpretation nobody confirmed

**2. Classify every TC of the document** against the inventory — match on TC-ID first, then on
action + role + screen where a TC-ID is missing from a title:

| Status | Weight | Assign when… |
|---|---|---|
| **Fully Covered** | 1.0 | A test asserts the TC's **expected result** end-to-end (the values, status, count or identity the document names) and it actually runs (not always-skipped). |
| **Partially Covered** | 0.5 | Automation exists but is weaker than the TC: always-skipped (role/config not available), data-gated with no empty-state assertion, access-only, **`unverifiedAssumption` — it asserts a PHASE 2.4 interpretation the user never confirmed (note: `partially covered — unverified assumption`)**, proves the scenario for a **different role or data variant**, checks **one row** where the TC says "every row", or asserts less than the document's expected result. |
| **Not Covered** | 0.0 | No test exercises the scenario — including every `Automation Candidate = NO` / `manual — not automated` TC. |

Heuristics that almost always land Partial or Not Covered — check them explicitly:
negative / permission / "cannot see" scenarios without a dedicated negative test · empty-state
/ no-data scenarios (data-gated specs skip instead of asserting emptiness) · system or
background-job records (auto-approve, auto-cancel, scheduled updates) · date-format /
field-present-vs-absent display · "every row" enumeration and "opens the correct record"
identity · a role the environment has no user for · a scenario proved via another role's data.

Record per TC: `coverageStatus`, `mappedTests` (or `-`), `manualRecommended` (Yes for every
Partial and Not Covered), `category` (see step 4) and a one-line `note`.

**3. Compute** — overall and per run stage (Smoke / Positive / Negative, the same split the
run uses):

```
weighted % = (full × 1.0 + partial × 0.5) / total × 100     (one decimal)
```

Also count distinct automated TC-IDs per spec (context only — role loops and data gates mean
it is not "tests that will execute").

**4. Gate** — compare the overall weighted % with `{coverage_target}` using `{coverage_mechanism}`
(both from L3; defaults 80 % / soft block — say which source was used):

- **≥ target → PASS.** Print the verdict and continue.
- **Below target, `soft block` (default):**
  1. List every Partial / Not Covered TC whose `Automation Candidate = YES` — these are the
     fixable ones. `manual — not automated` TCs are never a reason to block and are never
     "fixed" here.
  2. ONE repair pass on that list under the PHASE 2 rules (POM mandatory, no banned patterns,
     no lowered assertions): strengthen access-only assertions to the document's expected
     result, remove skip guards that hide a runnable scenario, add the missing negative /
     empty-state test where the document has the TC. Never invent scenarios.
  3. Re-measure (steps 1–3).
  4. Still below → print the gap table and **ask the user**: `run anyway` (recorded as a
     user override in the report) / `fix more` (another pass, then re-ask) / `stop` (BLOCKED
     with the gap table). Never silently proceed.
- **`hard block`** → same repair pass; still below → BLOCKED, no run.
- **`report-only`** → continue; the number and gaps still go everywhere below.

Live progress line (the `<live_progress>` format, also appended to the run log):
`Coverage: {x}% weighted (Full {n} · Partial {n} · None {n}) — target {t}% ({L3 | default}) — {PASS | BELOW TARGET → repairing | BELOW TARGET → user override | BLOCKED}`

**5. Write the coverage folder** — `{coverage_root}` = `{results_root}/coverage/`, **replaced every
run**; history lives in `{run_file}.coverage_snapshot` (per-TC statuses + delta) and in each
phase's `### Coverage` table of the run report.
Quote any CSV field containing a comma; use these exact headers.

- `coverage-summary.csv`
  ```
  User Story,Requirement ID(s),Stage,Total TCs,Fully Covered,Partially Covered,Not Covered,Weighted Coverage %,Distinct Automated TC-IDs
  ```
  One row per stage (Smoke / Positive / Negative), then a `TOTAL` row; a blank line; a `Legend`
  of the three statuses + weights; numbered `Notes` (weighting formula; target + source +
  mechanism; role-loop / data-gate caveat; the manual-gap categories present).
- `coverage-detail.csv`
  ```
  User Story,Requirement ID(s),TC-ID,Test Case Title,Type,Smoke,Automation Candidate,Coverage Status,Requirement Outcome Coverage,Mapped Test(s),Manual Testing Recommended,Notes / Recommendation
  ```
  One row per TC of the approved document, in document order.
- `manual-scenarios.csv`
  ```
  Category,User Story,TC-ID,Scenario,Why Manual,Priority
  ```
  Only `manualRecommended = Yes` rows, grouped by `Category`: `Not an automation candidate`,
  `Empty State (Negative)`, `Permission / Unauthorized (Negative)`, `System / Background-Job
  Triggered`, `Display / Field Presence`, `Cross-Role Specific`, `Per-Row Enumeration &
  Identity`, `Role Variant`, `Config-Skipped (coded, never runs)`, `Completeness`.
  Priority: **High** = security / permission, empty-state, coded-but-never-runs; **Medium** =
  background jobs, field display, cross-role; **Low** = redundant per-row enumeration.
- Store `coverage_snapshot` in `{run_file}` with target/source/mechanism, stage/TC/requirement
  counts, manual priorities and delta (run-report.md §7). Compare against the newest earlier
  `.runs/phase-*.json` that carries a snapshot, falling back to a read-only legacy
  `coverage-previous.json`, and state which one — no separate snapshot file, no dashboard HTML.
- Add `### Coverage` to the Markdown phase; retain the three CSVs above.

**6. Verify** — every approved TC appears in coverage-detail.csv; undecidable coverage stays
visible as an assumption. Render and inspect the report at finalization.

Recurring reasons a project lands Partial (e.g. "no Approver user exists in any
environment", "history screens have no empty-state fixture") are project knowledge: write them
as plain-English `[type: env]` / `[type: trick]` lines under `### Automation Model (skill 5) →
#### Knowledge` so the next story's design and measurement start from them.
</coverage_measurement>

---

## PHASE 2.6 — PRECONDITION & TEST-DATA READINESS (QC decision gate)

<data_readiness>
**Runs after PHASE 2.5 and BEFORE anything executes.** A TC that would skip because its
precondition cannot be met or its data is absent from the environment is **decided here by the
QC — never discovered by the run.** The run must not be the first place a "no data" skip appears.

**1. Collect the requirements** — start from skill 3's
`{tc_output_folder}/TEST-DATA-{feature}.md` when it exists: take its environment rows (`## 0.
Environment`, `E{n}`), data items (`D{n}`), TC mapping, accounts (`## 1. Accounts`, `A{n}`),
statuses (`READY` / `MISSING` / `IMPOSSIBLE` / `UNKNOWN`), Problems table and recommended ways as
the inventory of record — **do not rebuild the inventory from scratch**. Every ID a TC references
is a requirement of its own: `[E2]` is the mail sandbox row, not the base URL; `[A2]` is that
account, not "an Administrator"; a referenced ID with no row is a gap to list here, never a
substitution.
Add only requirements the approved TC document carries that the file lacks (a Preconditions /
Data Oracle / Shared data sentence or a role with no data item), and say which were added.
Skill 3 owns that file — never edit it; record outcomes in the learning file and
`{run_file}.data_readiness` only. When the file is missing, derive the requirements from
`<normalization>` as before (one per Preconditions / Data Oracle / Shared data sentence and per
role used), de-duplicated across TCs, each with the list of TC-IDs that depend on it. Either
way, reuse the PHASE 2.5 flags (`dataGated`, `alwaysSkipped`) as hints for which requirements
the generated code already doubts — do not re-derive them.

**2. Probe the environment — cheap, once per distinct requirement, never per TC.** Items the
test-data file marks `READY` are re-confirmed from the learning file only; probe the `MISSING`
/ `UNKNOWN` items (and `IMPOSSIBLE` ones only to look for a way the file did not know). A way
the file marks "to be confirmed" (`api` / `db`) is offered to the QC only after step 4 finds
it:
1. `Testing/project-learning.md` first: `[type: data]` lines (`## Test Data`), `[type: env]`
   lines, and this skill's Q&A. A recorded fixture or a recorded decision is reused — say so.
2. Accounts: the env layer of the automation project keyed by account ID (`helpers/test-data.ts`
   `accounts['A1']` → `A1_USER` / `A1_PASSWORD`); a role-keyed legacy layer is read for the
   username only and the ID-keyed entry is added — never "any user of that role".
3. Existing provisioning: `prerequest/*PreRequest.ts` fixtures, DB-oracle helpers in `pages/`,
   `00-setup-*.spec.ts` journeys from earlier stories.
4. One read probe per remaining data need: an existing API GET through the project's request
   helper, or ONE Playwright MCP look at the listing screen for that entity. Nothing the
   learning file already answers is probed again.

**3. Classify every requirement** and map it back to TC-IDs:

| Status | Meaning | Effect |
|---|---|---|
| `READY` | Present in the environment (or a fixture reliably creates it) | nothing to decide |
| `MISSING` | Absent, but creatable (entity, state, count, role assignment) | QC decision |
| `IMPOSSIBLE` | Needs a background job, an external system, a role that exists in no environment, or a state the app cannot reach through any interface | QC: `manual` or `skip` only |
| `UNKNOWN` | Could not be probed (screen unreachable, no read access) | QC decision, flagged |

Every TC touching a non-`READY` requirement goes on the **predicted-skip list** with the reason.

**4. Discover the provisioning options per `MISSING` gap** (state what was found and where):
- `api` — a create endpoint in the app or automation project: controllers / routes, swagger or
  openapi files, an existing `prerequest` fixture that already creates the entity.
- `ui` — a common flow in the learning file (`## Common Flows`) or an approved TC that creates
  the entity through the screens → can become a setup journey built from page objects.
- `db` — offered only when `{db_access}` is `helper`, or the QC names a connection env var.
- `manual` — always available (the QC inserts the data; the skill re-checks).
Recommended default: `api` when found → else `ui` → `db` only when the QC grants it → `manual`.

**5. Ask the QC — ONE combined message** (the `<project_learning_file>` ask rule applies:
learning file grepped first, nothing already answered is re-asked):

```
Test-data readiness — {N} TCs would be skipped without a decision
| # | Gap (plain English)                         | Affected TCs        | Status     | Options found            | Recommended |
|---|---------------------------------------------|---------------------|------------|--------------------------|-------------|
| 1 | No order with line items in UAT             | TC-010, 011, 011b   | MISSING    | api (order create), ui   | api         |
| 2 | No user with the Approver role              | TC-020, 020b        | IMPOSSIBLE | manual, skip             | skip        |
Answer per gap:  api | ui | db | manual | skip   — add "keep" to leave created data in place
Example: "1 api keep · 2 skip"
db: also name the env var that holds the connection string (its value is never shown or stored).
manual: reply "done" when the data is in — I re-check that gap before running.
```

Interactive → **WAIT** for the answer; the QC's reply is the decision of record. Pipeline /
non-interactive → apply recorded decisions from the learning file; gaps with none → `skip`
with the precise reason (`source: pipeline-default`), the run continues with the rest.

**6. Execute the decisions** — under the PHASE 2 rules (POM mandatory, no banned patterns,
never app business logic, never a credential in code, logs, or the learning file):

| Decision | How | Teardown |
|---|---|---|
| `api` | `prerequest/{Entity}PreRequest.ts` — create + delete functions, find-or-create so re-runs are idempotent; wired through `beforeAll` / `afterAll` in the owning spec (single-line delegation only, per `<pom_mandatory>`) | delete in `afterAll` |
| `ui` | `tests/{Area}_Tests/00-setup-{entity}.spec.ts` — an end-to-end journey built ONLY from page objects (login → navigate → create → assert it exists), tagged `@setup @run:setup-{entity}`; the run plan schedules it FIRST as its own serial setup group, before smoke | UI delete journey in `afterAll`, or the api/db delete when one exists |
| `db` | `{db_access} = helper` → the project's DB helper; otherwise SQL through Bash (`sqlcmd` / `psql` / `mysql`) reading the connection string from the QC-named env var **at run time** — refuse if unset; never echo, log, write, or paste the value anywhere. Insert script + matching delete script, both idempotent, both under `{data_setup_layer}` | delete script in `afterAll` |
| `manual` | wait for the QC's "done", then re-probe THAT requirement only | none (QC owns the data) |
| `skip` | skip guard on every dependent TC with the gap's exact wording; counted as `SKIP` with reason | — |

Cleanup default is **delete** after the run. `keep` → no teardown, and the fixture is written
to `## Test Data` as a `[type: data]` line (plain English: what exists, counts, identifiers,
environment, how it was created, date) so future runs and skill 3 find it.

**7. Re-probe → verdict** `READY` · `READY-WITH-SKIPS ({n} TCs)` · `BLOCKED` (interactive
QC chose to stop, or a chosen provisioning failed and the QC declined the alternatives).
Update `{run_file}.run_plan`: setup groups first; TCs whose data was created → `serial:{gap}` after their
setup group. Write the `data_readiness` object into `{run_file}`:

```json
{
  "measuredAt": "ISO-8601", "verdict": "READY-WITH-SKIPS",
  "requirements": [
    { "id": "R1", "text": "An order with line items exists in UAT", "status": "MISSING→READY",
      "tcs": ["TC-010", "TC-011", "TC-011b"], "decision": "api", "source": "qc",
      "provisioning": "prerequest/OrderPreRequest.ts (find-or-create)", "cleanup": "delete" },
    { "id": "R2", "text": "A user with the Approver role", "status": "IMPOSSIBLE",
      "tcs": ["TC-020", "TC-020b"], "decision": "skip", "source": "qc", "provisioning": null, "cleanup": null }
  ],
  "predictedSkips": [ { "tc": "TC-020", "reason": "no Approver user exists in any environment (QC: skip)" } ]
}
```

Live progress line (the `<live_progress>` format, stage `Data readiness`):
`Data readiness: {ready}/{total} requirements ready — {n} TCs would skip — {awaiting QC decision | provisioning via api/ui/db | waiting for manual insert | READY | READY-WITH-SKIPS}`

**8. Learning write-back:** every QC decision → `[type: qa]` line in this skill's Q&A; kept
fixtures → `[type: data]` in `## Test Data`; environment facts ("no user exists for role X in
any environment", "entity Y has no empty state anywhere") → `[type: env]`. Plain English only.
</data_readiness>

---

## RUN INFRASTRUCTURE — RESULTS, LOGS, LIVE PROGRESS (applies to PHASE 3 + PHASE 4)

<result_organization>
**All run artifacts are organized per User Story, with immutable phase history —
inside the structure's `reports/` folder, mirroring the TC folder's `SPEC-*` parent.**

Load `references/run-report.md` at profile time and at finalization — it owns the folder
contract, both markdown shapes, the run-file schema and the renderer's gates.

- Result root: `{results_root}` = `{automation_root}/reports/{spec_level}{user_story_name}/` —
  the TC folder's exact leaf, resolved once, immutable for the run.
- **Every invocation for the same User Story is a NEW phase.** `N` = 1 + the highest phase found in
  `{results_root}/.runs/phase-*.json`, in legacy `phase-*.json|html` at the top level of
  `{results_root}`, and in every existing `{legacy_results_root}`. Resolve N once at profile
  time, create `.runs/phase-{N}.json` (`status: planning`), write only to `{results_root}`.
  **NEVER overwrite, edit or delete a previous phase's artifacts — in any folder.** An invocation
  that stops before execution still finalizes a short phase (run file with its final status, a
  `## Phase N` section whose Outcome says why, a run-history row of `—`); the next takes N+1.

```text
{automation_root}/reports/
  SPEC-initiative-management/                ← only when the TC folder has this parent
    US-1234-create-order/                    ← {user_story_name}, the same leaf skill 3 used
      TEST-RUN-REPORT-create-order.md        ← test-case status: header + ## Run history + one ## Phase N per run (appended)
      BUG-REPORT-create-order.md             ← the bugs: one ### BUG-n entry per defect, Status + History per phase
      TEST-RUN-REPORT-create-order.html      ← rendered from both files by scripts/render-run-report.mjs after every run
      automation-inventory.md                ← page-object decision table (<automation_inventory>), rewritten each run, read by the validator --inventory
      coverage/                              ← coverage-summary.csv · coverage-detail.csv · manual-scenarios.csv (replaced)
      .runs/phase-1.json … phase-N.json      ← ALL machine data of each phase (schema skill6-run/1); immutable once final
      artifacts/stages/*.json                ← raw Playwright JSON per stage command (emptied at run start)
      artifacts/progress/*.jsonl             ← heartbeat + .results.jsonl per stage command (steps.ts / progress-reporter.ts); *.watchdog.json on a stop
      artifacts/test-output/                 ← Playwright outputDir (PW_OUTPUT_DIR) — wiped per command, so stages/ and progress/ are siblings, never inside it
  US-2000001-archive-order/                  ← a story without a SPEC-* parent: flat, same content
  US-1234/                                   ← LEGACY (pre-layout) — read-only history, never written again
```

- **Top-level whitelist.** The story folder holds exactly `TEST-RUN-REPORT-{feature}.md`,
  `BUG-REPORT-{feature}.md`, `TEST-RUN-REPORT-{feature}.html`, `automation-inventory.md`,
  `coverage/`, `.runs/`, `artifacts/`, plus the reviewer's optional `REVIEW-COMMENTS-{feature}.md`
  (saved from the page by the reviewer; the skill never creates it and only sets each handled
  entry's Status and Response). Nothing else is ever created there — not a checkpoint
  record, a fixture cache, a status file, a backup folder, a retest folder or an extra results
  JSON. Machine data of a run goes into `.runs/phase-{N}.json`; scratch goes under `artifacts/`
  (replaced each run).
- **Legacy locations are first-class, read-only history.** Projects set up before this layout keep
  their `reports/[SPEC-*/]US-{id}/` folders, top-level `phase-N.json` / `phase-N.html`,
  `merged-results.json`, `run-plan.json`, `open-questions.json`, `data-readiness.json`,
  `stages/`, `coverage/coverage-dashboard.html` and `coverage-previous.json` exactly where they
  are. The skill never moves, renames, deletes or rewrites them, and no script does. The first run
  under the new layout says so once in the chat ("earlier phases 1-4 found in
  reports/SPEC-x/US-1234/ — kept as legacy history, new phases start at 5 in
  reports/SPEC-x/US-1234-create-order/"), names them on the report header's `Earlier phases` line
  and in `{run_file}.previous_phase`, and reads a legacy `coverage-previous.json` only as the
  fallback for the coverage delta (stating which one it compared against). Legacy
  `automation-logs/…/US-{id}/` and `screenshots/` leaves are left untouched and mentioned once.
- At finalization: complete the run file, append the `## Phase N` section, update the bug file,
  render (`<second_run>` step 4). The phase number appears in the run file (`"phase": N`), as the
  `## Phase N — date` heading and a run-history row, in the rendered page, in the ADO summary
  comment and in the final chat summary — it must be immediately clear which result belongs to
  which execution.

**Screenshots — every TC, every variant, every attempt; one folder per User Story; IMMUTABLE:**

```text
{automation_root}/screenshots/
  SPEC-initiative-management/                  ← same {spec_level} as the reports
    US-1234-create-order/                      ← {user_story_name}, same leaf name skill 3 used
      phase-3/
        variants.json                          ← slug → full title path, project, spec file
        TC-001/
          chromium--none--r0/
            attempt-1.png                      ← ASSERTION POINT (full page): the screen when the
                                                 expected result is verified, pass or fail
        TC-001b/                               ← the second-locale variant is its own TC
          chromium--none--r0/attempt-1.png
        TC-007/
          chromium--variation-a--r0/attempt-1.png
          chromium--variation-b--r0/attempt-1.png
        TC-010/
          chromium--none--r0/
            attempt-1.png
            attempt-1-failed.png               ← failing step of attempt 1
            attempt-2.png                      ← the heal re-run / retry — attempt 1 stays
      phase-2/ …                               ← earlier phases, never touched again
```

`variant_slug` = `{project}--{data-variation-slug}--r{repeat}` — `project` =
`testInfo.project.name`; `data-variation-slug` = kebab-case of the variation label in the test
title (`none` when the test has no variation); `r{repeat}` = `testInfo.repeatEachIndex` (`r0`
normally). `{a}` counts every execution of that variant in this phase — stage re-runs after a
heal AND Playwright retries (`testInfo.retry`) — starting at 1.

**Evidence contract — screenshot at the ASSERTION POINT, never at test end.**
A screenshot taken after the test finishes is taken after `afterEach`/`afterAll` teardown
has already deleted or reset the test data, so it shows an empty list, a "not found" page,
or the pre-test state — evidence that contradicts the PASS it is attached to. This contract
exists so no module ever inherits that defect:

- The assertion-point image is taken for **every executed test** by one shared evidence helper
  (`helpers/evidence.ts` exporting `captureEvidence(page, testInfo)`, or the project's
  existing equivalent): it reads every `[TC-ID]` token from `testInfo.title`, derives the
  `variant_slug` from `testInfo.project.name`, the variation label in the title and
  `testInfo.repeatEachIndex`, and the attempt number from `testInfo.retry` plus the env vars
  the run command sets (`PW_PHASE`, `PW_STAGE_ATTEMPT`), then writes a full-page screenshot to
  `{screenshots_root}/phase-{N}/{TC-ID}/{variant_slug}/attempt-{a}.png` for EACH TC-ID in the
  title (a `[TC-05][TC-06]` test writes the same image under both TC folders). **It never
  writes to an existing path** — if the target exists it increments `{a}` — and it appends
  the slug → title mapping to `phase-{N}/variants.json`. The spec calls it **inside the test
  body at the assertion point** — immediately before the (last) `expect(...)` of the Assert
  step, while the created/edited/deleted record, message, or value the TC verifies is on
  screen. One call per test; a TC that verifies several screens captures the last one (the
  state the TC's Expected Result describes).
- Order inside every test is fixed: **Arrange → Act → `captureEvidence` → Assert →
  (teardown in `afterEach`/`afterAll`)**. Teardown, cleanup, "delete created data", state
  resets and navigation away from the verified screen all happen AFTER the image is on disk.
  If a TC's own steps end with a delete (e.g. "Validate that the record is removed"), the
  assertion point is the screen that proves the removal — that IS the evidence.
- The `afterEach` evidence hook is limited to **failure handling**: on failure it copies
  Playwright's failure attachment to `…/{variant_slug}/attempt-{a}-failed.png`, and if the test
  failed before reaching `captureEvidence` (so no `attempt-{a}.png` exists yet for this
  attempt) it writes the current screen as `attempt-{a}.png` so every executed attempt still
  has an image. It never overwrites an existing image — the assertion-point image always wins.
- Specs only call the helper — no `page.screenshot(...)` in a spec body, ever.
- **Evidence sanity check (PHASE 3 and PHASE 4):** for every PASS, confirm the image shows
  the state named in the TC's Expected Result (record present, message visible, value shown)
  and not a cleaned-up screen. A PASS whose image shows post-cleanup state is classified
  `evidence_failure` (a test-code defect: the call sits after teardown or after navigation)
  and is self-healed by moving the call to the assertion point — it never counts as an
  `app_bug` and never ships in the phase report uncorrected.
- **Evidence is immutable history, like the phase reports.** Nothing under `{screenshots_root}`
  is ever overwritten or deleted — not stale TC-IDs, not earlier attempts, not earlier phases.
  Evidence referenced by an earlier attempt or by an earlier `{run_report_html}` must stay exactly
  where that report points. Each phase writes only into its own `phase-{N}/` folder. The rendered
  page links every image by RELATIVE path (thumbnail + "View screenshot" viewer), never as
  embedded base64 — so the links resolve only while the report and the screenshots keep their
  relative positions, one more reason nothing under `screenshots/` is ever moved.
- Every attempt's exact image path is stored in `{run_file}.merged`
  (`variants[].attempts[].evidence_screenshot` / `failure_screenshot`), in `{run_file}.results[]`
  (`evidence_screenshot` = the status-of-record attempt) and, as a relative link, in the Evidence
  cell of the report's Results table.
- A TC that was NOT_RUN or SKIPPED has no image; the report says so plainly.

**Immutable vs replaced:** finalized run files, earlier Markdown phase sections, screenshots
and progress logs are immutable. Render HTML again from Markdown; replace only coverage CSVs
and artifacts scratch. Legacy files remain read-only.
</result_organization>

<automation_logs>
**Dedicated log tree — one progress log per run, history never overwritten.**

```text
{automation_root}/automation-logs/
  SPEC-initiative-management/          ← same {spec_level} as the reports (absent for a story with no SPEC-* parent)
    US-1234-create-order/              ← {user_story_name}, the same leaf as reports/ and screenshots/
      run-progress-2026-09-02-0754.log
      run-progress-2026-09-02-1420.log   ← later run, new file
```

- Create `{logs_root}/run-progress-{YYYY-MM-DD-HHmm}.log`
  (`automation-logs/{spec_level}{user_story_name}/`) at the very start of the run and tell the
  user the path immediately, so they can tail it live (`Get-Content -Wait <path>` on Windows).
  Its first lines record the resolved `results_root`, `logs_root`, `screenshots_root` and the
  run start time.
- One NEW file per run. Never append to or overwrite a previous run's log. A legacy flat
  `automation-logs/US-{id}/` folder is left as is.
</automation_logs>

<live_progress>
**The user must never be left without feedback during a long-running stage.**

The progress log AND the chat are updated continuously across the WHOLE skill
lifecycle — not only Playwright execution. Stages (log each transition,
timestamped):

```text
Preparation → Spec/requirement validation → Code/implementation validation →
Automation generation/update → Open questions (user decision) → Checkpoint A (compliance gate) →
Coverage measurement → Data readiness (QC decision + provisioning) →
Setup journeys → Smoke execution → Smoke gate → Self-healing →
Positive execution → Negative execution → Result generation → Report generation →
Checkpoint B (compliance gate) → ADO update → Finalization
```

**Every log entry carries:** current stage · current run group (`parallel` /
`serial:{group}`) · mode + workers (e.g. `parallel ×2, headed`) · current activity ·
TCs completed / passed / failed / skipped / not-run · current TC-ID(s) (several when
parallel) · overall progress % · elapsed time · estimated remaining time · execution status.

**Playwright execution mechanics:**
- Run every test command **in the background** (never a silent blocking foreground
  call). The command carries only `--project={browser_project}` (the shared config is the
  default `playwright.config.ts` — never `--config`) plus the stage's `--grep` /
  `--grep-invert` / `--workers` flags, and the environment variables `PW_STAGE_JSON` (this
  stage's JSON file), `PW_PROGRESS_FILE` (this stage's heartbeat), `PW_OUTPUT_DIR`
  (`{results_root}/artifacts/test-output`), `PW_GLOBAL_TIMEOUT` (the outer ceiling below),
  `PW_HEADLESS` when not headed, `PW_PHASE` and `PW_STAGE_ATTEMPT`. **Never pass `--reporter`
  on the CLI** — it replaces the config reporters and silently drops the JSON file. The
  config's `line` reporter still prints one line per test; tee/append that command output into
  the progress log.
- Record `stage_started_at` immediately before each command starts.
- Poll the background output at short intervals; parse the per-test lines to
  update counts, current TC, and ETA; append a progress entry to the log and post
  a status update in the chat on each poll.
- **Watchdog — two layers, applied on every poll.**
  1. *Outer ceiling:* `PW_GLOBAL_TIMEOUT` per command = (Σ test budgets of the group ÷ its
     workers) + hook budgets + one teardown budget, × 1.2 (values from `timeouts.ts`). Playwright
     itself stops the command at that ceiling; in-flight tests are `interrupted` in its own JSON.
  2. *Freeze detection:* `node …/scripts/watchdog.mjs --plan {run_file}.run_plan --group {group}
     --stage {stage} --heartbeat {progress_file} --results {progress_file minus .jsonl}.results.jsonl
     --grace {TIMEOUTS.watchdog_grace}` on every poll. It declares a worker **frozen only** when an
     open step is past ITS OWN recorded deadline + grace with no `progress` record, no newer
     record for that worker and no newer result — i.e. Playwright's own timeout could not act.
     A quiet console, an unchanged stage JSON or a long-but-in-deadline step NEVER count; a worker
     between tests is judged by the outer ceiling only. `BLOCKED` (a malformed heartbeat line) is
     never treated as a freeze.
  On `FROZEN`: kill the command's process tree; re-run the script with `--write --out
  {results_root}/artifacts/progress/{stage}-{group}.watchdog.json`; log and post the frozen
  worker, TC-ID, step, elapsed and expected condition. That file's `completed[]` (from the
  incremental results the additive `helpers/progress-reporter.ts` wrote as each test finished)
  keeps every real status; `interrupted[]` (`INCOMPLETE`, reason `interrupted: watchdog at step
  "…" after N s`, other workers' in-flight tests `collateral`) and `not_started[]` (`NOT_RUN`,
  reason `not started: watchdog stop`) name every other TC. The stage / group is re-queued ONCE
  after the heal (interrupted and not-started TCs first; completed ones are not re-run); the
  freeze is classified `timeout_failure`, never `app_bug`, and goes to the Heal Log and the
  Timeout policy section with the trace path.
- **Per-stage freshness gate — after EVERY stage / run-group command (Phase 3 and Phase 4):**
  `{stage_json_path}` must exist and its modified time must be later than that command's
  `stage_started_at` — or, for a command the watchdog stopped, the
  `{stage}-{group}.watchdog.json` file must exist and be newer (it stands in for the stage JSON
  of that group, `merged.stages[].source: 'incremental+watchdog'`). Missing or stale → **STOP
  the run**: write the failure to the progress log, fix the reporting / run step (a
  `--reporter` flag, a stray `--config`, wrong `outputFile`, a reporter override in the shared
  config), re-run that stage, and only then continue. Never build `phase sections` from a stale
  or absent file, never hand-assemble results from the line output.

**Chat update shape (each poll during execution; each stage transition otherwise):**

```text
Current phase: Smoke Execution — group: parallel (×2 workers, headed) · watchdog: OK (w0 in step "save the order" 12 s / 30 s)
Progress: 7/15 TCs (47%)
Passed: 6 · Failed: 1
Elapsed: 02:14 · Estimated remaining: ~01:35 (serial-only would be ~04:10)
Current TCs: TC-YOBJ-018, TC-YOBJ-021, TC-YOBJ-023
```

**Estimated remaining time:** once ≥3 TCs (or one completed stage) have timing
data, estimate remaining = average TC duration × TCs left ÷ workers of the current
group, plus the serial groups still queued at 1 worker (per stage, since stages differ
in cost). Show the serial-only figure beside it so the saving is visible. Refresh the
estimate on every update as real data accumulates — never state it once at the
beginning and go quiet.

**The same concept applies outside test execution:** while generating/updating
automation report files done/total, while reviewing results report TCs
classified/total, while generating reports report sections done, and — when
`ado_mode = linked` — while updating ADO report work items done/total.
</live_progress>

<staged_execution>
**Priority order inside every run: 0) Setup journeys → 1) Smoke → gate → 2) Positive → 3) Negative.**

**Stage 0 — setup groups** (only when PHASE 2.6 created `setup_groups`): each
`00-setup-{entity}.spec.ts` runs alone, serially, `--grep "@setup"`, before smoke —
`{run_command} --grep "@run:setup-{entity}" --workers=1`. A failed setup journey is
`data_missing` for every TC of its `serial:{gap}` group: those TCs are marked `SKIP` with the
gap reason and the rest of the run continues; the failure itself is reported under
Test-data readiness, never counted against the smoke gate.

**Inside every stage the `<run_plan>` groups run in this order, browser visible
(`{headed}`), always from the shared `playwright.config.ts` with `--project={browser_project}`
(never `--config`, never `--reporter`), each command with its own `PW_STAGE_JSON`,
`PW_PROGRESS_FILE`, `PW_OUTPUT_DIR` and `PW_GLOBAL_TIMEOUT`:**

```text
stage S:
  1. parallel group      → PW_STAGE_JSON=…/stages/S-parallel.json        PW_PROGRESS_FILE=…/progress/S-parallel.jsonl        {run_command} --grep "<S tags>" --grep "@run:parallel"        --workers={workers_parallel}
  2. serial group A      → PW_STAGE_JSON=…/stages/S-serial-{groupA}.json PW_PROGRESS_FILE=…/progress/S-serial-{groupA}.jsonl {run_command} --grep "<S tags>" --grep "@run:serial-{groupA}" --workers=1
  3. serial group B …    → one command per serial group, one after another (own JSON + heartbeat each)
  (a re-run of the same stage/group after a heal or a watchdog stop appends -attempt{n} to both file names;
   … = {results_root}/artifacts; PW_OUTPUT_DIR={results_root}/artifacts/test-output and PW_GLOBAL_TIMEOUT per <live_progress> on every command)
```

Confirm ONCE at profile time, against the installed Playwright (`npx playwright test --help`),
that repeated `--grep` flags are ANDed by that version; if they are not, build the stage filter
as ONE regex (`--grep "(?=.*@smoke)(?=.*@run:parallel)"`) and record the form used in the
learning file (`[type: env]`).

After every command: the freshness gate from `<live_progress>` (the stage JSON exists at
`{stage_json_path}` and is newer than that command's start) — STOP on failure.

`--grep` values are combined with the stage's polarity filters below (Playwright ANDs
repeated `--grep` flags). A group with no TCs in that stage is skipped and logged. No TC
runs twice in one phase. Suites beyond ~40 tests are sliced per group and stage anyway
(Windows resource rule in `<environment_gate>`), so slices never cut through a serial group.

1. **Smoke stage** — run ONLY `@smoke`-tagged tests:
   `{run_command}` + `--grep "@smoke"` (parallel group, then serial groups as above).
2. **Smoke gate** — compute `fail% = failed / total smoke tests`:
   - **fail% ≤ 30%** → proceed to the positive stage (the failures are still
     classified and handled by the normal rules).
   - **fail% > 30%** → classify EVERY smoke failure first (the PHASE 3
     classification table; VPN/proxy/tunnel errors are `environment_failure`).
     **`unverified_assumption` failures are EXCLUDED from the majority math entirely** —
     counted and reported on their own, never on either side: a PHASE 2.4 guess that turned out
     wrong must never stop the run or look like an application defect.
     - **Majority automation/env** (`selector_failure` + `assertion_failure` +
       `environment_failure` + `timeout_failure` outnumber `app_bug`) → fix the
       automation via the normal self-heal rules (env/VPN issues → fix the
       environment or ENVIRONMENT_BLOCKED), then **re-run the smoke stage**.
       Maximum **2 smoke retry cycles**; still failing after that → honest stop,
       reported as-is.
     - **Majority `app_bug`** → **STOP THE RUN.** Do NOT execute the positive or
       negative stages. Still complete `{run_file}` (`status:
       stopped-smoke-gate`), append the phase section with `**Outcome:** SMOKE GATE FAILED`,
       record every smoke failure in `{bug_report_md}` in full `<bug_report_format>`, list every
       positive/negative TC as `NOT_RUN` with reason `smoke gate failed (application errors)`,
       and render — the renderer shows the banner. State the gate result
       in the ADO summary comment and the final chat summary.
3. **Positive stage** — `--grep "@positive" --grep-invert "@smoke"` (smoke tests
   already ran; never run a TC twice in one phase) — parallel group, then serial groups.
4. **Negative stage** — `--grep "@negative" --grep-invert "@smoke"` — same group order.
5. Merge the stage JSONs into `{run_file}.merged` (per variant, per attempt — rules in
   `<second_run>`), then into the single `{run_file}` / `{run_report_html}` —
   per-stage counts preserved, each TC carrying its `run_group` / `run_mode` and its
   variants, and the report shows the stage order, the group order, the gate outcome, and
   planned vs actual duration. Before the merge, every stage planned in the run plan must
   have a fresh stage JSON — or an explicit "stage not run — smoke gate STOP" marker;
   otherwise STOP as in the freshness gate.
</staged_execution>

---

## PHASE 3 — FIRST RUN (IMPROVE)

<environment_gate>
**Checkpoint A gate first:** `<checkpoint_a>` must be recorded for this scope, and only the
scope whose applicable pre-run checks passed may execute. Tests left BLOCKED are isolated and
reported against the original scope — the run continues for everything independent of them.
**Coverage gate second:** the PHASE 2.5 verdict must be `PASS`, `report-only`, or a recorded
user override — otherwise do not execute (see `<coverage_measurement>`).
**Readiness gate second:** the PHASE 2.6 verdict must be `READY` or `READY-WITH-SKIPS` — every
predicted skip carries a QC decision or the pipeline default (see `<data_readiness>`). Test
data is NOT re-checked here as a whole-run condition; it was settled per requirement in 2.6.

Before executing: grep `Testing/project-learning.md` for `[type: env]` lines first — known
environment quirks, VPN/proxy notes, slicing thresholds and past fixes are applied before
diagnosing anything anew. Then confirm the app/base URL responds and required services are
healthy. Any check fails → **ENVIRONMENT_BLOCKED**
(name the unhealthy dependency; action for ops/human — NOT a code defect).
Do not execute and do not attribute environment failures to the tests. Every environment
fact learned or fixed in this gate is written back as a plain-English `[type: env]` line
under `## Automation Tricks`.

**The browser must be visible.** `{headed}` is true by default: confirm a display is
available (an interactive Windows session, not a headless CI agent) by launching one headed
Google Chrome window through the shared `playwright.config.ts` (`channel: 'chrome'`) before the
stages start — Chrome absent → `npx playwright install chrome`, or the environment gate reports
it. If no window can open, fall back to `PW_HEADLESS=1` for this run, say so in the chat
immediately, and list it under Deviations — never silently run headless when the user expects
to watch.

**Failure evidence must be capturable — and every TC must leave an assertion-point screenshot.**
Confirm the shared config sets `screenshot: 'only-on-failure'` and `trace: 'retain-on-failure'`
in its `use` block (`references/code-craft.md` §8 — `on-first-retry` never fires under
`retries: 0`). Without them a failing test leaves NO visual evidence, and every bug entry rests
on assertion text alone. If either is missing, add it before the first run and note it in the
Placement Manifest. Confirm `helpers/progress-reporter.ts` is in the config's reporter list
(the watchdog's incremental results) and `helpers/steps.ts` exists (the heartbeat) — both copied
from `assets/` when absent. Confirm the shared evidence helper
(`captureEvidence`) exists, that every generated test calls it at its assertion point and
not in `afterEach` (see `<result_organization>`), that it writes per phase / variant /
attempt and never overwrites, and that `{screenshots_root}/phase-{N}/` is writable. Never
delete anything under `{screenshots_root}`.

**Long runs exhaust Windows resources.** A large headed suite accumulates browser
processes (2 visible windows for the parallel group already; more makes it worse, not better); past
runs died mid-suite with `worker process exited unexpectedly (code=3221225794)` —
`0xC0000142 STATUS_DLL_INIT_FAILED`. That is an `environment_failure`, never an app or
test defect, and it cascades: the crashing test plus every test after it in that worker
report failed/not-run with no verdict. For suites beyond ~40 tests, run in slices **per
run-plan group and stage** (a slice never cuts through a serial group), combine the
results, and classify any `0xC0000142` cascade explicitly as environmental. If it
recurs, lower `{workers_parallel}` for the rest of the run and record the count that
worked in the learning file.
</environment_gate>

<first_run>
0. Initialize per `<result_organization>` (resolve `{spec_level}` + the three roots ONCE,
   state them, find the next phase N across the nested and legacy folders, create
   `{results_root}/artifacts/stages/` (emptied) and `{screenshots_root}/phase-{N}/`) and
   `<automation_logs>` (create this run's progress log, announce its path). Write
   `{run_file}.run_plan` (incl. `required_variants`) and `{run_file}.timeouts.initial` (every
   value of `timeouts.ts` with the project facts that shaped it, and `playwright_version`);
   post the run-plan summary (groups, TC counts, workers, planned vs serial-only estimate) and
   the initial timeout values in the chat.
1. Execute via `{run_command}` with `--project={browser_project}` from the shared config (no
   `--config`, no `--reporter`; `PW_STAGE_JSON` / `PW_PROGRESS_FILE` / `PW_OUTPUT_DIR` /
   `PW_GLOBAL_TIMEOUT` / `PW_PHASE` / `PW_STAGE_ATTEMPT` set per command), following
   `<staged_execution>` (smoke → gate → positive → negative; inside each stage parallel group
   ×{workers_parallel}, then serial groups ×1, browser visible) and `<live_progress>`
   (background run, log + chat updates with ETA, watchdog on every poll, freshness gate after
   every command). The outer ceiling is `PW_GLOBAL_TIMEOUT` per command; on breach or on a
   watchdog stop, completed results are kept, interrupted and not-started TCs are named
   (`<live_progress>`), and the run reports completed vs not-executed honestly.
2. **Classify every failure:**

   | Classification | Definition | Action in this phase |
   |---|---|---|
   | `selector_failure` | Element not found by its selector — stale/wrong locator | SELF-HEAL: fix the page-object locator |
   | `assertion_failure` | Element found, assertion wrong — test-code defect (bad wait, wrong expected mapping from the TC doc) | SELF-HEAL: fix wait strategy / assertion mapping |
   | `app_bug` | Test is correct; the application violates the approved TC | DO NOT TOUCH THE TEST — add to bug list |
   | `environment_failure` | Service down, auth expired, VPN/proxy/tunnel errors | ENVIRONMENT_BLOCKED path |
   | `data_missing` | The data a TC needs is absent at run time. Requirement was `READY` in PHASE 2.6 → environment regression (ENVIRONMENT_BLOCKED path, name the requirement). Requirement was a `skip` decision → the TC is `SKIP` with that reason — not a failure, not healed. Provisioning created it but it is gone → re-run that setup group once, then treat as regression | per the two cases |
   | `timeout_failure` | A step deadline, a TC budget, the outer ceiling or the watchdog fired. The record carries TC-ID, step, elapsed, expected condition, trace / screenshot path | **Calibrate from evidence (step 2b), never by number.** Open the trace: the operation legitimately completes after the deadline → raise THAT key in `timeouts.ts` with the reason; a broken locator / failed operation → `selector_failure` / `assertion_failure` heal; a frozen step (no progress, Playwright's timeout could not act) → environment / driver defect, report it, never re-time it. A timeout on one run alone never establishes the required duration; retries are never added to absorb one |
   | `evidence_failure` | Test passed but its `attempt-{a}.png` shows a post-cleanup / post-navigation screen instead of the verified state (the `captureEvidence` call sits after teardown, after a delete, or after leaving the page) | SELF-HEAL: move the call to the assertion point; re-run the TC (a new attempt — the earlier image stays); never an app_bug |
   | `unverified_assumption` | The test is tagged `@unverified-assumption` (PHASE 2.4 had no user answer) and it failed — **the interpretation is suspect before the application is** | DO NOT self-heal it into passing and **NEVER reclassify it as `app_bug`**. Re-ask the user with the observed behaviour as a new candidate; answered → regenerate the test and drop the tag. Unanswered → report as-is, excluded from the smoke-gate `app_bug` majority, never filed as a bug |

2b. **Timeout calibration — once, after the first run, from evidence.** List every
   `timeout_failure` and watchdog event (`{run_file}.timeouts.events[]`: TC-ID, step, elapsed,
   deadline, expected condition, trace / screenshot / heartbeat path, the durations of the
   passing TCs for the same operation). For each: the trace shows the operation completing
   legitimately after the deadline → raise the named key (`test.long`, `step.long`, a new
   `operations.{name}`) in `timeouts.ts` — never inline, never a global bump — and record
   `{key, from, to, reason, evidence}` under `{run_file}.timeouts.adjusted[]`, in the Heal Log
   (category `timeout_failure`, column 7 = the evidence path) and in the report's Timeout policy
   section. Anything else is healed as its real class. Teardown that timed out marks the TC
   `cleanup_incomplete` and runs the orphan sweep by `runPrefix` before the next stage. Values
   that did not change are stated as confirmed. **NOT_RUN** when no first run happened in this
   invocation (say so).
3. **Self-heal ONLY test-code defects** (`selector_failure`, `assertion_failure`, `evidence_failure`):
   - fixes live in page objects / spec waits — never in app business logic
   - re-verify the selector against source before changing it
   - a **locator repair must preserve the intended element and behaviour** — a selector that
     matches a *different* element is a new defect, not a fix
   - an **assertion or expected-value change needs approved-requirement evidence** (a REQ/AC/TC
     id or an approved clarification). No evidence → record the issue **unresolved**; never
     invent a repair, and never let observed behaviour supply the new expected value
   - a **genuine requirement change is an explicit test update**, described as such — not a heal
   - HARD RULES: never lower an assertion threshold · never broaden an assertion
     to make it pass · never add a skip to hide a failure · never suppress or swallow an error ·
     never change an application setting, environment flag or configuration value to obtain a
     pass · never edit product code · **never reinterpret an
     `app_bug` as a test bug** — when the app contradicts the approved TC, the TC
     wins and the app is buggy · **and never the reverse for an `@unverified-assumption`
     test** — there the TC's expected result is a guess, so the guess is suspect first: it is
     `unverified_assumption`, not `app_bug`, until the user confirms the interpretation
4. Re-run only the healed tests to confirm the heal — with `--repeat-each 3` (burn-in, named in
   Heal Log column 8); a failure seen only with 2 workers is reproduced with `--workers 1`
   (shared data / state → fix the data or the run plan, never the assertion); one seen only after
   another test is reproduced with `--last-failed` (≥ 1.44) or the explicit pair in one `--grep`
   (leaked state → fixture / teardown) — `references/code-craft.md` §13. Maximum **2 heal
   iterations**; whatever still fails for test-code reasons after that is reported honestly as-is.
5. Keep a **Heal Log** — one row per repair, all nine columns, `n/a` with a reason is a value
   but a blank is not (`references/automation-rules.md` §5):

   | TC-ID | Affected test / files changed (`file:line`) | Defect category | Previous value (old locator / assertion / expected value) | Updated value | Reason the new value is correct | Approved-requirement reference | Verification performed | Rerun result |
   |---|---|---|---|---|---|---|---|---|

   The **approved-requirement reference is required** for any assertion or expected-value change
   and is `n/a` only for a pure locator repair. **Verification performed** names the checks
   re-run (validator rules, project lint, semantic re-review); **Rerun result** names the tests
   re-executed and their outcome, or `not re-run — reason`.
6. Every `automation_failure` or `environment_failure` heal that would help the next run
   (a wait that works, an element identified differently, an environment quirk) becomes one
   plain-English tagged line under `## Automation Tricks` in `Testing/project-learning.md`.
   `app_bug` findings are NOT written there — they belong in the bug report.
</first_run>

---

## PHASE 4 — SECOND RUN (FINAL REPORT)

<second_run>
1. **Clean full re-run** of the spec — same staged order (`<staged_execution>`:
   smoke → gate → positive → negative) with `<live_progress>` updates throughout.
   This run's results are the results of record — no fixes, no re-runs after it.
   A smoke-gate STOP in this run is itself the result of record.
2. **Merge the stage results** of this phase from `{results_root}/artifacts/stages/*.json` (every file
   passed the freshness gate; each is a raw Playwright JSON report) into
   `{run_file}.merged`:

   - **Execution** = one Playwright test result entry from one stage JSON.
   - **Variant identity** (`variant_key`) = spec file + full title path (describe chain + test
     title) + Playwright **project name** + repeat index. Different projects (browsers) or
     data variations are different variants and are **never merged**; `variant_slug` is the
     file-safe form from `<result_organization>`.
   - **Attempt** = another execution of the SAME variant (smoke heal re-run, Playwright
     retry). All attempts are kept in order; the variant's `final_status` is the **latest**
     attempt.
   - **TC mapping**: every `[TC-ID]` token in the title maps the execution to that TC — a title
     may carry several (`[TC-01][TC-02]` or `[TC-01, TC-02]`), then the variant counts toward
     each of them. A TC may also be covered by several variants (chromium + firefox, variation
     A + B).
   - **Required variants** come from `{run_file}.run_plan` `required_variants[tc_id]`.
   - **Overall TC status** — complete coverage required: any required variant `FAIL` →
     `FAIL`; all required variants executed and `PASS` → `PASS`; at least one required variant
     `PASS` but another required variant `SKIP` / `NOT_RUN` / missing → **`INCOMPLETE`** (never
     `PASS`) with `missing_variants[]`; only `SKIP` → `SKIP`; nothing executed → `NOT_RUN`.
     Extra, non-required variants are kept and reported but never make up for a missing
     required one. A TC generated up to a `[HUMAN]` step (PHASE 2 candidacy) whose automated
     part passed on every required variant is **`PARTIAL`** — written `PARTIAL — human step
     pending` in the Results table, classification `human step: {n}`, `human_step: {n}` in the
     run file — never `PASS`; its automated part failing is `FAIL` like any other.
   - **Totals count TCs**, one per TC-ID, from the overall status — a TC is never counted
     twice; per-variant counts go to `variant_totals`.

   `{run_file}.merged` schema (object within schema `skill6-run/1`):

   ```json
   {
     "stages": [{ "name": "smoke", "group": "parallel", "attempt": 1, "project": "chromium",
                  "json_path": "artifacts/stages/smoke-parallel.json", "started_at": "ISO-8601", "finished_at": "ISO-8601" }],
     "executions": [{ "variant_key": "tests/Orders_Tests/03-create-order.spec.ts::REQ-01: …::[TC-007] … — variation A @positive @run:parallel::chromium::r0",
                      "variant_slug": "chromium--variation-a--r0", "tc_ids": ["TC-007"], "title": "…", "file": "…",
                      "project": "chromium", "stage": "positive", "group": "parallel", "attempt": 1,
                      "status": "PASS | FAIL | SKIP", "duration_ms": 0, "error": "… or null", "attachments": [] }],
     "variants": [{ "variant_key": "…", "variant_slug": "chromium--variation-a--r0", "tc_ids": ["TC-007"], "project": "chromium",
                    "attempts": [{ "attempt": 1, "stage": "smoke", "status": "FAIL", "evidence_screenshot": "…/attempt-1.png", "failure_screenshot": "…/attempt-1-failed.png" },
                                 { "attempt": 2, "stage": "smoke", "status": "PASS", "evidence_screenshot": "…/attempt-2.png", "failure_screenshot": null }],
                    "final_status": "PASS" }],
     "tcs": [{ "tc_id": "TC-007", "required_variants": ["chromium--variation-a--r0", "chromium--variation-b--r0"],
               "variant_slugs": ["chromium--variation-a--r0", "chromium--variation-b--r0"],
               "status": "PASS | FAIL | INCOMPLETE | SKIP | NOT_RUN | PARTIAL", "missing_variants": [], "skipped_variants": [] }],
     "variant_totals": { "passed": 0, "failed": 0, "skipped": 0, "not_run": 0, "partial": 0 }
   }
   ```

3. **Complete `{run_file}`**, schema `skill6-run/1` in run-report.md §6. Preserve earlier
   planning/open-question/readiness/coverage/checkpoint objects. Store merged data in `merged`,
   variant totals at top level and TC counts in `totals`. Existing result rows remain:

   ```json
   {
     "results": [{
       "tc_id": "TC-01", "req_id": "REQ-01", "test_name": "...",
       "status": "PASS | FAIL | INCOMPLETE | SKIP | NOT_RUN | PARTIAL",
       "duration_ms": 0,
       "classification": "app_bug | selector_failure | unverified_assumption | ... | human step: {n} (PARTIAL only) | N/A",
       "unverified_assumption": false,
       "assumption": "the interpretation the test encodes, or null",
       "error_message": "...", "root_cause": "...",
       "run_group": "parallel | serial:{group}", "run_mode": "parallel | serial",
       "evidence_screenshot": "screenshots/[SPEC-{spec-name}/]{user_story_name}/phase-{N}/{TC-ID}/{variant_slug}/attempt-{a}.png of the status-of-record attempt, or null (NOT_RUN/SKIP)",
       "failure_screenshot": "…/attempt-{a}-failed.png or null",
       "severity": "Critical | High | Medium | Low | N/A",
       "healed_in_first_run": true,
       "attempts": 2,
       "missing_variants": [],
       "variants": [{
         "variant_slug": "chromium--none--r0", "project": "chromium", "final_status": "PASS", "duration_ms": 0,
         "attempts": [{ "attempt": 1, "stage": "smoke", "status": "FAIL", "evidence_screenshot": "…/attempt-1.png", "failure_screenshot": "…/attempt-1-failed.png" },
                      { "attempt": 2, "stage": "smoke", "status": "PASS", "evidence_screenshot": "…/attempt-2.png", "failure_screenshot": null }]
       }]
     }]
   }
   ```

4. **Append the phase section, update the bug file, render** — `references/run-report.md` §4-§5:
   - `{run_report_md}`: on the story's first run under this layout create the file with the
     header block and `## Run history`; otherwise update only the header lines and add ONE
     run-history row. Append `## Phase {N} — {date}` with Run, Stages + smoke gate, Run plan,
     Coverage, Results (one row per TC; Evidence = relative links into `{screenshots_root}`),
     Unverified assumptions, the Bugs cross-reference table (ids only), Heal log, Skips, Open
     questions, Test-data readiness, Deviations. **Earlier phase sections are never touched.**
   - `{bug_report_md}`: create it with `## Bugs` / `none` on the first run. Add one
     `### BUG-n — {title}` entry in `<bug_report_format>` per NEW `app_bug` of this phase
     (`Found in phase: N`, `Status: open`, the failure image as a relative link). For every
     existing bug whose TC ran this phase append a History line and set the Status —
     `resolved (phase N)` ONLY after the retest actually passed, `open` when it failed again;
     a bug whose TC did not run becomes `not-checked-this-run`. Never rewrite an entry; never
     reuse an id; update the header's `Bugs` count line. Unverified-assumption failures are
     never entered here (they are questions, not bugs).
   - **Reviewer comments.** When `REVIEW-COMMENTS-{feature}.md` exists beside the report (saved
     from the page), or the reviewer pasted comments in chat, read every open entry (`General`,
     `BUG-{n}`, `phase-{N}`) and every `Reviewer comment` bullet. Act on it under this skill's
     rules — a re-run request is a new phase, a question gets an answer, "not a bug" is weighed
     against the requirement — then set only that entry's Status to `applied` / `answered` /
     `declined {date}` with a one-line `Response`, and recompute the header count
     (`references/run-report.md` §9b). A comment never changes a bug's Status by itself (only a
     passing retest resolves it), never edits the reviewer's text, and a request for a TC change
     is `answered` with the route to skill 3 `--revision`. "read my comments" alone runs this step
     and the render, without executing tests.
   - Record Checkpoint B in `{run_file}.compliance`, set the run file's final status, then
     **render** — the HTML is never hand-written:

   ```text
   node .claude/skills/link-qc-5-test-run-automation/scripts/render-run-report.mjs --report "{run_report_md}" --write --pretty
   ```

   Read the payload (`gate`, `mismatches[]`, `warnings[]`, `errors[]`, `writes[]`) — never the
   HTML. `MISMATCH` → fix the markdown line `mismatches[]` names (header, run-history row, stage
   total, bug count, bug id) and re-render; `BLOCKED` → fix the markdown, never write HTML
   yourself; a hand-edited page is refused without `--force` — tell the user what would be lost
   first. Run `scripts/selftest-run-report.mjs` before delivering the page (a failing harness →
   the markdown is delivered, the page is not). Invariants the page must keep: INCOMPLETE has its
   own colour with the missing variants named and is never published as Passed (ADO:
   Inconclusive); unverified assumptions are never merged into Bugs; a smoke-gate stop shows the
   SMOKE GATE FAILED banner with every unexecuted TC as NOT_RUN; every variant and attempt stays
   visible; screenshots are relative links with the viewer, never base64.
</second_run>

<checkpoint_b>
**CHECKPOINT B — MANDATORY POST-RUN COMPLIANCE GATE.** Runs after execution and after ALL
debugging, before `AUTOMATION COMPLETE`. Load `references/compliance-checkpoints.md` and work the
same checklist again.

1. **Repeat the FULL review on the FINAL code — including every file that passed Checkpoint A.**
   Debugging changes code; A's results describe the code as it was then, not as it is now.
   **Both halves again, not just the fast one:**
   - *mechanical* — re-run `validate-automation.mjs` and the project's own tooling over the final
     files, and record the new `scopeDigest`;
   - *semantic* — re-review every `S` item of `references/compliance-checkpoints.md` §2 against
     the final code: layer ownership, whether each assertion still verifies its required outcome,
     evidence placement, and each honoured exception's substance. A clean re-scan is not a
     repeated review.
2. **Confirm debugging introduced no shortcuts:** no weakened assertion, no broken POM boundary,
   no removed or relocated evidence, no suppressed error, no new unjustified skip or raised
   timeout, no changed application setting, no product-code edit — and **no page class written
   during debugging outside the inventory**: the re-run validator (with `--inventory`) reports no
   open `pom-duplicate-page`, and every class it lists under `pageScan` has its
   `automation-inventory.md` row.
3. **Verify the artifacts were ACTUALLY produced** — this is the half Checkpoint A could not do:
   - every executed attempt has its assertion-point image at the path `{run_file}` records, and
     every failed attempt its failure image;
   - each image is associated with the right TC-ID and variant, and the **evidence sanity check**
     passes (no PASS image showing a cleaned-up screen);
   - `{run_file}` (status final), the `## Phase {N}` section of `{run_report_md}`,
     `{bug_report_md}` (one entry per `app_bug` of this phase, no bug marked resolved without a
     passing retest), `{run_report_html}` and the progress log exist, are internally consistent
     and **correspond to the final tested code** — compare the `scopeDigest` recorded for the run
     against the current one;
   - the renderer's last payload for this markdown says `gate: PASS`, its `writes[]` names the
     HTML, the page's provenance self-hash verifies (no hand edit), and `warnings[]` carries no
     `evidence-file-missing` / `bug-report-missing` / `run-file-missing`;
   - the story folder's top level holds nothing outside the whitelist (legacy files untouched);
   - expected failures (`fail`), extended timeouts (`slow`) and skips appear as themselves in the
     report, never folded into the pass count;
   - Requirement → TC → automated test → execution result is mappable end to end, and the three
     coverage figures are reported separately (`<coverage_measurement>`).

**If an automation defect is found here:** repair it immediately → re-run the relevant static
checks → **rerun the affected tests** → if a shared component changed (page object, fixture,
helper, config) include every consumer → if the blast radius cannot be bounded reliably, run the
full in-scope suite → then **repeat the full Checkpoint B review** on the result.

**Any later code change invalidates the checks and results it affects.** Refresh Checkpoint A's
applicable checks before rerunning and repeat B afterwards. A recorded gate is valid only for the
`scopeDigest` it names — **never claim completion from stale results.**

**Do not rerun to make a failure disappear.** An unchanged application defect or an environment
failure is not fixed by repetition: preserve the evidence, classify it (`app_bug`,
`environment_failure`, `unverified_assumption`), and report it as an unresolved blocker.

**Gate result.** `PASS` only when there are no confirmed violations in the final delivered scope
**and** every `review[]` / `notRun[]` item is closed — by the scanner, by other project tooling,
or by documented semantic review against the same `scopeDigest`. Otherwise `FAIL` or `BLOCKED`,
named item by item. Record it per `compliance-checkpoints.md` §5.

**Both gates must PASS for the final delivered scope before claiming automation compliance**, and
compliance status is reported separately from execution status: compliant tests can expose
application defects, passing tests can still violate these rules, and an environment blocker can
leave a gate BLOCKED with nothing wrong in the code.
</checkpoint_b>

<bug_report_format>
Every `app_bug` entry — in `{bug_report_md}` (`BUG-REPORT-{feature}.md`, one `### BUG-n` entry
per defect, from where the rendered page and anything filed to DevOps take it; fields and status
rules in `references/run-report.md` §5) — uses this shape.

### Title — ONE plain sentence naming the user-visible symptom

```
The system doesn't display the username validation message when the user enters an invalid username
The system doesn't redirect to the login page when an unauthenticated user opens the Orders screen
The system still shows the current total when the user filters by a past order date
The system keeps the read-only warning visible after the user clears the date filter
```

Pattern: `The system <doesn't do X> when <condition>` — or `The system <does the wrong X>
when <condition>`.

**Never** an assertion string, a locator, a TC-ID, or a requirement code as the title.
`expect(locator).toBeVisible() failed` is not a bug title — it is evidence.

### Steps to Reproduce — detailed, numbered, starting at login

Same nine canonical verbs as the test cases. Anyone must be able to follow them without
reading the automation:

```
1. Login with an Approver user
2. Go to the Orders list for a customer that has a pending order
3. Click on the filter panel open button
4. Select "Pending" from the Status dropdown
5. Select the latest order date
6. Click on Apply
7. Check the total value shown in the page header
```

### Expected / Actual — one simple sentence each

```
Expected: The page header shows the total for the selected order date.
Actual:   The page header still shows the current total (88.3%).
```

No stack traces, no locators, no framework vocabulary in either line.

### Supporting fields (keep all of these)

TC-ID · Requirement · Severity · Environment · Browser · Language mode · Build · Root cause ·
embedded failure screenshot · **Evidence** — and Evidence is where the raw assertion text,
error message and log excerpt belong.

If no screenshot exists, say so plainly rather than omitting the field —
`playwright.config.ts` must set `screenshot: 'only-on-failure'` for one to be captured.
</bug_report_format>

---

## PHASE 5 — CLOSE THE LOOP IN DEVOPS (only under `ado_mode = linked`)

<ado_closeout>
**Under `ado_mode = local` skip this entire phase silently.** Record it in the structured
return as `not applicable — story not published to Azure DevOps` and move on. Do NOT suggest
running `link-qc-4-publish-test-cases-azure`, do NOT ask the user to publish or upload, and do NOT
treat the skipped phase as a failure — the run is complete without it.

Under `ado_mode = linked`, using `{tc_output_folder}/ADO-MAP.md` — columns
`| TC-ID | ADO Work Item ID | published_tc_sha256 | automated_tc_sha256 | Automation candidate |
AutomationStatus | Tags (introduced) | Suite |`. **This skill owns exactly two of them**:
`automated_tc_sha256` and `AutomationStatus` (the `Automated` value only). `published_tc_sha256`
and `Tags (introduced)` are skill 4's, `Suite` is skill 4's `--suite-only`; none of them is ever
touched here, and a legacy map without the hash columns gets them added, never rewritten:

0. **Compute the canonical hash of every TC that earned `Automated`** — ran `full` coverage (no
   `[HUMAN]` step), `PASS` on every required variant in run 2, **after Checkpoint B PASS**:
   ```bash
   node .claude/skills/link-qc-5-test-run-automation/scripts/tc-hash.mjs --tc {source_tc_doc} --data {tc_output_folder}/TEST-DATA-{feature}.md --ids TC-01,TC-02 --pretty
   ```
   and write each `hashes[TC-ID]` into that TC's `automated_tc_sha256`. The hash is semantic
   (behaviour fields + the role / data shape the TC references — `references/run-report.md` names
   the script; the contract is the file's header): skill 4 keeps `Automated` on a later publish
   only while it still equals `canonical(current TC)`, so a changed step or data shape flips the
   Azure status to a conflict instead of overstating it. **A `PARTIAL` TC never gets a hash and
   never `Automated`** (nor does a FAIL, INCOMPLETE, SKIP, NOT_RUN or `@unverified-assumption`
   TC); its cell stays `—`. `tc-hash.mjs` is a byte-identical copy of skill 4's (MIRROR banner) —
   run `node …/scripts/selftest-tc-hash.mjs` once per run before writing a hash; a failing harness
   means no hash is written and the column is reported `NOT_RUN`.
1. For every TC whose automation now exists and executed in run 2:
   - **Resolve the template's automation flag ONCE per project** (`automation_flag`):
     learning file `[type: env]` line → skill 4's `tc_template_quirks` → inspect the
     Test Case work item type's fields (`_apis/wit/workitemtypes/Test Case/fields` — on the
     self-hosted server there is no MCP tool for that: one REST `GET` through the shell with
     `Authorization: Basic` from `$env:AZURE_DEVOPS_PAT_B64` read by name, never printed; or
     skip the probe and try `update_work_item` with the candidate field, reading the 400).
     Preference order: (a) a boolean custom field whose name means "automated"
     (e.g. `Custom.TestAutomated`) → set it `true`; (b) otherwise
     `Microsoft.VSTS.TCM.AutomationStatus` = `Automated`. Leave the flag unset / `false`
     only where automation was deliberately never written. Record the resolved field and its
     accepted values in the learning file as one `[type: env]` line so no later run re-probes.
   - Set automated-test metadata
     (`Microsoft.VSTS.TCM.AutomatedTestName` = the spec test title,
     `Microsoft.VSTS.TCM.AutomatedTestStorage` = the spec file path). Both verified writable.
   - `Microsoft.VSTS.TCM.AutomationStatus`: **⚠️ some process templates accept ONLY
     `Not Automated` and `Planned` and REJECT `Automated`** with
     `400 The field 'Automation status' contains the value 'Automated' that is not in the
     list of supported values`. On that error: keep `Planned`, rely on the custom flag +
     the metadata fields to express automation, never write `Automated` into `ADO-MAP.md`
     (that records a status ADO refused), and record the restriction in the learning file.
   - Keep `Planned` for candidates that ended up skip-guarded (note why in the map), for any
     TC whose PHASE 2.5 status is Partially / Not Covered — copy the reason from
     `coverage-detail.csv` — for any TC skipped by a PHASE 2.6 decision — copy the gap
     text from `{run_file}.data_readiness` — **for every `PARTIAL — human step pending` TC**
     (note `partial (human step: n)` in the map; its test outcome is `Inconclusive`, its
     `automated_tc_sha256` stays `—`) and for any TC tagged `@unverified-assumption`, copying
     the assumption from `{run_file}.open_questions`, so the ADO status never overstates the coverage.
   - **Test outcome per TC** (where the project records outcomes on test points / results —
     the self-hosted server has no test-plan tools, so there the outcome is recorded as
     `skipped — no test-plan tools on the self-hosted server` in the map and the summary
     comment, never claimed):
     `PASS` → `Passed`; `FAIL` → `Failed`; **`INCOMPLETE` → `Inconclusive`** (or the project's
     configured non-pass outcome — never `Passed`), with the missing variants and every
     variant's result in the result comment; **`PARTIAL` → `Inconclusive`** with `human step
     pending: step {n}` in the result comment; `SKIP` → `Not Applicable` / the project's skip
     outcome; `NOT_RUN` → left not executed. A TC with one required variant passed and another
     skipped or not run is therefore never reported as Passed anywhere in ADO.
     **A TC tagged `@unverified-assumption` is never `Passed` either** — `Inconclusive` with the
     assumption quoted in the result comment, whatever the test did.
2. Post ONE summary comment on the User Story: **phase number**, run-2 counts
   (pass/fail/incomplete/skip/not-run — TC counts, plus variant totals), smoke-gate verdict,
   number of app bugs found (with TC-IDs), and the `TEST-RUN-REPORT-{feature}.md`
   (`## Phase {N}` section), `BUG-REPORT-{feature}.md`, `.html` and `.runs/phase-{N}.json` paths
   (under `reports/{spec_level}{user_story_name}/`).
3. Update `ADO-MAP.md`: the `AutomationStatus` column (the value Azure DevOps actually accepted,
   never `Automated` when the template refused it) and the `automated_tc_sha256` column from
   step 0 — the other columns byte-identical.

ADO failures here degrade gracefully: report what could not be updated — never
fake a status.
</ado_closeout>

---

<structured_returns>

## AUTOMATION COMPLETE

**Precondition — not negotiable.** Return this ONLY when `<checkpoint_a>` and `<checkpoint_b>` are
both recorded **PASS for the final delivered scope**, at the current `scopeDigest`. If either gate
is `FAIL` or `BLOCKED`, if any applicable check is `unresolved`, or if any recorded result predates
the last code change, return **`## BLOCKED`** instead with the gate record attached — however green
the test run was. A passing suite is not a passed gate.

**Feature:** {name} · **User Story:** {ID — title}
**Approved TC document (automation source):** {path}
**Environment:** {env} · **Run command:** {exact command}

### Azure DevOps linkage
**Mode:** {`linked` | `local`}

*Under `linked`:*
**Beautified document (published by skill 4):** {path} · source revision `{sha short}` — matches the approved document
**ADO-MAP.md:** {N} rows / {N} TCs · spot-check `[{TC-ID}]` → work item {id}, Tested-By linked — OK
{Needs human review notes carried from the beautified document: {TC-IDs} — or "None"}

*Under `local`:* `local — not published to Azure DevOps ({reason: never published | ADO-MAP.md
older than the approved document | ADO not reachable}); PHASE 5 skipped. Publishing is the
separate skill 4 and is not required for this run.`

### Placement Manifest
{File · Path · Registered · Status table — includes the shared playwright.config.ts (updated / consolidated / created), timeouts.ts, helpers/evidence.ts, helpers/steps.ts, helpers/progress-reporter.ts, helpers/console-guard.ts, helpers/test-data.ts, .gitignore, and every config removed as `removed (consolidated from …)`}

### Automation inventory
**Scanned:** the whole `{automation_root}` — {N} page classes in {N} files (validator `pageScan`) · **File:** `{reports_folder}/automation-inventory.md`
| Screen | Decision | Class | Candidates considered | Reason |
|---|---|---|---|---|
{one row per screen the TCs touch — `reuse {class}` / `extend {class} (+methods)` / `create {class}`; every candidate the matching surfaced, accepted or rejected with the reason}
**Validator:** `pom-duplicate-page-decided` {n} · **open `pom-duplicate-page`: 0** (anything else is a Checkpoint A failure) · **Learning lines written:** {n}

### Configuration
**Shared config:** {path} — {updated in place | consolidated from N files | created from the template} · **Chrome channel:** {yes} · **Workers:** 2 (serial groups 1) · **Playwright:** {version} ({feature gates: tags object · --last-failed · native step timeout — each yes/no})
**Configurations not merged:** {file — blocking setting — kept because …} — or "none"
**References rewritten:** {package.json scripts · CI files · docs — counts} · **Removed:** {files, each only after config-inventory listed it under deletable[]} — or "none"

### Run plan
| Group | Mode | Workers | TCs | Reason |
|-------|------|---------|-----|--------|
{one row per group; `parallel` first; every serial group's reason names the shared data and the `--workers 1` override}
**Decisions:** {N field-driven} · {N inferred} · {N fail-safe serial}
**Estimate:** serial-only ~{s} vs planned ~{s} → actual {s}
**Headed:** {yes | no — reason}
**Run plan file:** {run_file}.run_plan

### Timeout policy
| Key | Initial | After calibration | Reason / evidence |
|-----|---------|-------------------|-------------------|
{one row per `timeouts.ts` key: test.default · test.long · expect · action · navigation · hook · step.default · step.long · operations.* · watchdog_grace; "confirmed" when unchanged}
**First-run events:** {n} timeouts · {n} watchdog stops — {TC-ID · step · elapsed · expected · evidence path} — or "none"
**Adjustments:** {n} ({key from → to — reason — evidence}) — or "none; every value confirmed"
**Unresolved:** {a timeout whose cause the evidence does not settle — stays `timeout_failure`, never re-timed} — or "none"
**Probe:** {watchdog-probe PASS (step error named TC + step, failure image written, teardown completed, next test started after it, no orphan Chrome) | NOT_RUN — reason}
**Calibration status:** {done in this phase | NOT_RUN — no first run in this invocation}

### Open questions (PHASE 2.4)
**Raised:** {n} · **Answered by you:** {n} · **Reused from the learning file:** {n} · **Assumed (unverified):** {n} · **Unresolved (skip-guarded):** {n}
| # | Source | Ambiguity (exact wording) | TCs | Decision | By | Learning line written |
|---|--------|---------------------------|-----|----------|----|-----------------------|
{one row per question; By = you / learning / assumption}
**Unverified assumptions carried into the run:** {TC-IDs + the assumption — or "none"} — tagged `@unverified-assumption`, never counted as an application bug, never published as Passed
**Open-questions file:** {run_file}.open_questions

### Test-data readiness (PHASE 2.6)
**Verdict:** {READY | READY-WITH-SKIPS ({n} TCs) | BLOCKED} · **QC asked:** {yes — {n} gaps in one message | no — all requirements ready or already decided in the learning file}
| # | Gap | Affected TCs | Status | Decision | Source | Provisioning | Cleanup |
|---|-----|--------------|--------|----------|--------|--------------|---------|
{one row per non-READY requirement; Source = qc / learning / pipeline-default}
**Predicted skips carried into the run:** {TC-IDs + reason — or "none"}
**Setup groups run first:** {setup:{entity} → spec path — or "none"}
**Created data:** {n} fixtures — deleted after run {n} · kept {n} (registered in `## Test Data`)
**Readiness file:** {run_file}.data_readiness

### Screenshots
**Folder:** {automation_root}/screenshots/{spec_level}{user_story_name}/phase-{N}/
**Written:** {N} assertion-point images · {N} failure images · across {N} variants / {N} attempts · **nothing overwritten or deleted** (earlier phases untouched)
**Evidence sanity check:** {N} PASS images verified against Expected Result · {N} `evidence_failure` healed
{TC-IDs without an image and why (NOT_RUN / SKIP)}
{Legacy flat `screenshots/{user_story_name}/` present: yes (left untouched) | no}

### Coverage
*Three separate figures — never merged:* **(1)** requirement outcome coverage · **(2)** TC
automation coverage (the gate) · **(3)** execution pass rate (in *Second Run — Results*).

**(1) Requirement outcome coverage** — does each requirement's required outcome get asserted?
| Requirement ID | Requirement (short) | Outcome coverage | Asserted by | Note |
|---|---|---|---|---|
{Full / Partial / Missing / **Assumed**; `Assumed` = covered only by an `@unverified-assumption` test.
Linked-but-not-asserted is `Partial`, never `Full`. IDs validated against {REQ file / approved doc /
ADO-MAP}; unresolvable IDs listed here, never invented.}
**Totals:** Full {n} · Partial {n} · Missing {n} · Assumed {n} of {N} requirements

**(2) TC automation coverage**
| TC-ID | Requirement ID(s) | Smoke | Automation candidate | Implementation | Static coverage | Run 2 status |
|-------|-------------------|-------|----------------------|----------------|-----------------|--------------|
{Implementation = `full` / `partial (human step: n)` / `manual — not automated` / `pending — not covered for this run`; Static coverage = Fully / Partially / Not Covered from PHASE 2.5; Run 2 status = PASS / FAIL / INCOMPLETE / SKIP / NOT_RUN / `PARTIAL — human step pending`}

**Weighted static coverage (pre-run):** {x}% — target {t}% ({L3 | default}, {mechanism}) — **{PASS | user override | report-only}**
Smoke {x}% · Positive {x}% · Negative {x}% · Full {n} · Partial {n} · None {n} of {N}
**Δ vs previous measurement:** {±d} pts — improved {TC-IDs} · regressed {TC-IDs} · TCs added/removed {+a/−b} — or "no prior measurement"
**Repair pass:** {n} TCs strengthened → {before}% → {after}% — or "not needed"
**Manual-only scenarios:** {n} (High {h} · Medium {m} · Low {l}) → `{coverage_root}/manual-scenarios.csv`
**Coverage folder:** `{coverage_root}` — coverage-summary.csv · coverage-detail.csv · manual-scenarios.csv

### First Run — Heal Log
{TC-ID · failure · classification · fix · result — or "First run fully green"}
**Smoke gate (run 1):** {passed | healed-then-passed ({n} retry cycles) | FAILED-STOPPED} — fail% {x}%

### Second Run — Results (run of record)

| Field | Value |
|---|---|
| User Story | US-{ID} — {title} |
| Run / Phase | Phase {N} |
| Total TCs | {N} |
| Passed / Failed / Incomplete / Skipped / NOT_RUN / Partial | {n} / {n} / {n} / {n} / {n} / {n} (TC counts — each TC-ID once; a PARTIAL TC is never in Passed) |
| Variants executed | {n} passed / {n} failed / {n} skipped over {N} required variants ({projects} × data variations); attempts {n} |
| Incomplete TCs | {TC-IDs with their missing variants — or "none"} (published to ADO as Inconclusive, never Passed) |
| Partial TCs | {TC-IDs with `human step: n` — or "none"} (`PARTIAL — human step pending`: Inconclusive in ADO, never `Automated`, no `automated_tc_sha256`) |
| Smoke | {n} TCs — gate: {passed \| healed-then-passed \| FAILED-STOPPED} (fail% {x}%) |
| Positive | {passed}/{total} |
| Negative | {passed}/{total} |
| Static coverage (pre-run) | {x}% weighted — target {t}% — {PASS \| user override \| report-only} |
| Coverage folder | {results_root}/coverage/ (3 CSVs, replaced); snapshot/delta in the run file |
| Test-data readiness (pre-run) | {READY \| READY-WITH-SKIPS ({n} TCs)} — {n} gaps decided by QC, {n} provisioned ({api}/{ui}/{db}/{manual}), {n} skipped |
| Total execution time | {hh:mm:ss} |
| Planned vs actual duration | ~{planned} vs {actual} (serial-only would be ~{serial}) |
| Headed / workers | {yes \| no} / parallel ×{N}, serial ×1 — shared playwright.config.ts, Chrome |
| Timeouts | test {s} · step {s} · action {s} · navigation {s} · expect {s} — {n} calibrated, {n} watchdog events (Timeout policy section) |
| Screenshots | {screenshots_root}/phase-{N}/ — {N} images across {N} variants / {N} attempts (immutable) |
| Result folder | {results_root} = {automation_root}/reports/{spec_level}{user_story_name}/ |
| Stage results | {results_root}/artifacts/stages/ — {N} stage files, all fresh · merged: {run_file}.merged |
| Progress log | {logs_root}/run-progress-{stamp}.log |
| Run report | {run_report_md} — `## Phase {N}` appended · rendered {run_report_html} (renderer gate {PASS}, provenance verified) |
| Bug report | {bug_report_md} — {n} new · {n} retested · {n} resolved · {n} not checked this run |
| Run file | {run_file} |
| Earlier phases | {list with folder — nested and legacy — or "none"} |
| Overall status | {GREEN \| FAILURES \| SMOKE GATE FAILED \| ENVIRONMENT_BLOCKED} |

**App bugs found:** {N} — {BUG-ids · TC-IDs + one-line titles}

### DevOps close-out
{AutomationStatus updates + `automated_tc_sha256` written for {n} TCs (full coverage, PASS, Checkpoint B PASS — never a PARTIAL) + US comment link — or what failed; the other ADO-MAP.md columns untouched}

### Compliance gates
**Checkpoint A (pre-run):** {PASS | FAIL | BLOCKED} · **Checkpoint B (final code):** {PASS | FAIL | BLOCKED}
*Both must be PASS for the final delivered scope before automation compliance is claimed.*

| | Checkpoint A | Checkpoint B |
|---|---|---|
| Scope | {N tests · M page objects/fixtures/helpers/config} | {same, or the final scope after reruns} |
| Code state | `scopeDigest {sha}` · {N} files hashed · git {HEAD short} {clean \| +K uncommitted} *(git is context only)* | `scopeDigest {sha}` |
| Mechanical checks | validator `{gate}` — {v} violations · {w} warnings · {r} review · {n} notRun · {e} exceptions; {project tooling + result \| none configured} | {same, re-run on the final code} |
| Semantic review | {items reviewed} | {items reviewed, including files that passed A} |
| Findings | {ruleId} {file}:{line} — {one line}, or "None" | {…} |
| Repairs | {what changed} → {re-check run} → {result} | {…} |
| Open items | {item} — {verified-semantic: reasoning} | {…} |
| **Unresolved** | {check} — {why it could not be verified} — **each one keeps this gate BLOCKED** | {…} |
| N/A | {check} — {why this rule has NO SUBJECT in this scope} | {check} — {why} |

*`N/A` means the rule has nothing to act on here (no ADO linkage, no modifier in scope, no API
fixtures). A check that applies but did not run is **`Unresolved`**, never `N/A` and never PASS —
that includes anything the validator reported in `notRun[]` or left open in `review[]`.*

**Runtime artifacts** (images, run file, report markdown / HTML, logs) are verified at Checkpoint B only — at A they
were recorded `scheduled for Checkpoint B`, never PASS.
**Compliance vs execution:** {one line — e.g. "both gates PASS; 3 TCs failed on real application
defects" or "suite green; Checkpoint B BLOCKED on 2 unresolved review items"}.
{When code changed after a recorded run: which checks were refreshed and which results were
discarded as stale.}

### Deviations
{everything that differs from the approved document, with reasons — or "None"}

### Learning file
**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}

---

## ENVIRONMENT_BLOCKED

**Reason:** {specific unhealthy service/dependency + evidence}
**Environment:** {env}
**Action required:** ops / human — not a code defect. Phases completed before the block: {list}

---

## BLOCKED

**Reason:** {unapproved TC doc | missing User Story | ambiguous US name | missing profile key | unresolved test-data precondition (QC chose stop, or provisioning failed and no alternative accepted) | **compliance gate not PASS** (Checkpoint A or B `FAIL`/`BLOCKED`, an applicable check still `unresolved`, or the recorded results are stale)}
*(Never blocked for Azure DevOps: a missing or stale ADO-MAP.md, an unpublished story, or an
ADO auth failure all degrade to `ado_mode = local` and the run continues. Never blocked for an
ambiguous TC step or an unresolved element either: those are raised as PHASE 2.4 open questions
and, unanswered, become tagged assumptions or skip-guarded TCs. **An unresolved compliance item IS
a block for the affected scope** — but only for that scope: independent work still completes and is
reported.)*
**Details:** {exact item and what was observed}
**Compliance gates:** {the `### Compliance gates` table — which gate, which items are unresolved,
what would close each one}
**Execution status (kept separate):** {what actually ran and its result — a green suite here does
not lift the gate, and failing tests here may be genuine application defects rather than a
compliance problem}
**Completed before blocking:** {phases/items}
**Required from the user:** {the exact input or action needed — or "nothing: the open items are
mine to verify" when no user input is needed}

</structured_returns>

---

<quality_checklist>
Before returning AUTOMATION COMPLETE:

- [ ] **Checkpoint A recorded PASS for the executed scope** — validator + project tooling +
      semantic review; confirmed violations fixed immediately, affected checks re-run
- [ ] **Checkpoint B recorded PASS for the FINAL delivered scope** — full review repeated on the
      final code including files that passed A; debugging introduced no shortcut
- [ ] **Validator result reported in full** — `gate`, `counts`, `review[]`, `notRun[]`,
      `exceptions[]`; a `PASS` never presented as proof that the tests are correct; a scanner
      `BLOCKED`/`NOT_RUN` recorded verbatim and its checks closed another way against the same
      `scopeDigest`, or left BLOCKED
- [ ] **No applicable check recorded as PASS or as `N/A` without having run** — an applicable
      check that did not complete is `unresolved` and **keeps its gate BLOCKED**; `N/A` is only
      for a rule with no subject in this scope, with the reason naming why it has none. Every
      validator `notRun[]` and open `review[]` item is an applicable check, never an `N/A`.
      Runtime artifacts are never claimed at Checkpoint A
- [ ] **Every honoured exception's source opened and its substance recorded** (justified /
      rejected); no `qa-allow` on a non-exemptible rule
- [ ] **Both gates' records carry the `scopeDigest`**, and no result from an earlier digest was
      reused after a code change
- [ ] **Blocked tests reported against the ORIGINAL scope** with reasons — isolated, never
      silently dropped, never counted as passing
- [ ] **Compliance status reported separately from execution status**
- [ ] **Requirement outcome coverage, TC automation coverage and execution pass rate reported as
      three separate figures**, each requirement ID validated against the resolved sources and
      none invented here
- [ ] **No product code modified, no application setting changed, no error suppressed to obtain
      a pass**

- [ ] TC document verified `Status: APPROVED` — gate respected
- [ ] User Story id resolved without Azure (task input → frontmatter → folder name → ask) and
      confirmed with the user before naming any folder; never guessed
- [ ] **`ado_mode` derived and stated (`linked` / `local` + reason); the run was NEVER blocked,
      paused, or degraded because the TCs were not published, and the user was NEVER asked to
      publish/upload to Azure DevOps or to run skill 4**
- [ ] ADO auth verified under `ado_mode = linked` only; 401/403 dropped to `local` instead of
      stopping; token never logged or written — N/A under `local`
- [ ] **Folder layout follows `generate-testing-structure`: new projects under
      `Testing/Automation/` (pages/tests/reports/screenshots/automation-logs); an existing
      automation project reused, never duplicated**
- [ ] **`spec_level` derived once from the approved document's folder; `results_root`, `logs_root`
      and `screenshots_root` carry the same `[SPEC-{spec-name}/]` parent as the TC folder, were
      stated at the start, and never changed or fell back to a flat `US-*` path during the run;
      legacy flat folders read as history only, never written**
- [ ] **Linkage detected, not required: under `linked` the beautified document + ADO-MAP.md carry
      `source_sha256` equal to the approved document's hash and one work item was spot-checked
      (title prefix, Tested-By link); otherwise `local` with the reason stated once**
- [ ] **No beautify, no TC work-item creation or edit in this run — skill 4 owns both**
- [ ] **Automation generated from the ORIGINAL approved document, never from the beautified file**
- [ ] Hierarchy verified/created; Placement Manifest emitted; spec registered in the browser project
- [ ] POM mandatory rule enforced — zero inline locators in specs; self-check grep reported
- [ ] **Automation inventory (`<automation_inventory>`): the WHOLE automation root scanned before
      any page object was written; `{reports_folder}/automation-inventory.md` holds one decision
      row per screen (`reuse` / `extend` / `create`) naming every candidate with its reason; the
      validator ran with `--inventory` at both checkpoints with no open `pom-duplicate-page`; no
      `create` row left a candidate unaddressed; each decision recorded in `## Automation Tricks`**
- [ ] **Every TEST-DATA reference resolved per ID — `[E{n}]` its own environment entry, `[A{n}]`
      that account by ID (never by role), `[D{n}]` that data item — through `helpers/test-data.ts`
      env vars named after the ID; no literal URL / username, no default value**
- [ ] **`[HUMAN]` steps: the candidate TC generated up to the first one, coverage
      `partial (human step: n)`, run status `PARTIAL — human step pending` in its own bucket —
      never PASS, never `Automated`, never an `automated_tc_sha256`**
- [ ] No spec-local UI helper functions; no chaining off exposed page-object locators
- [ ] Every selector confirmed in source; safe-fix impact checks run before any rename
- [ ] Self-check passed before first run; no banned patterns
- [ ] **Open questions (PHASE 2.4) collected from all four sources (ambiguous step, unresolved
      element, skill 4 `Needs human review`, TBD/assumption markers), de-duplicated to ONE
      question per ambiguity with its TC list — and the run NEVER blocked because of one**
- [ ] **Every candidate answer carries real evidence (source file / page object / sibling TC /
      code-rules doc); the learning file was grepped FIRST and a recorded answer reused without
      asking; the user was asked with selectable options, recommended one first**
- [ ] **Every answer written back to `Testing/project-learning.md` AT THE MOMENT IT WAS GIVEN as
      a GENERIC tagged behaviour rule (module/page/element level — never "TC-xx expects …"),
      project-wide ones also under `## Project Knowledge`, `## Index` rows updated, deduped —
      so no later phase, run, or story asks it again**
- [ ] **Unanswered questions: generated from the recommended evidence-backed candidate, tagged
      `@unverified-assumption` with the assumption stated in the spec and the report; no
      evidence-backed candidate → skip-guarded with the exact question, never invented**
- [ ] **No `@unverified-assumption` failure reclassified as `app_bug`, filed as a bug, counted in
      the smoke-gate majority math, or published as Passed**
- [ ] **`{run_file}.open_questions` written with every question, candidate, evidence,
      decision, decidedBy and the learning line recorded for it**
- [ ] **Static coverage measured BEFORE the first run: every TC of the approved document classified
      Fully / Partially / Not Covered from the spec source (always-skipped, data-gated, access-only
      and role-variant tests downgraded); weighted % computed overall and per stage**
- [ ] **Gate verdict recorded with target + source (L3 or default 80 %) + mechanism; below target →
      one repair pass, re-measure, then the user asked — never silently run; override reported**
- [ ] **Three coverage CSVs written; snapshot/delta in run file; Coverage section rendered**
- [ ] **Test-data readiness resolved BEFORE the first run: requirements extracted per TC, probed once
      each (learning file first), predicted skips listed, and the QC asked in ONE message per gap
      (api / ui / db / manual / skip, + keep) — pipeline mode skipped undecided gaps with reason**
- [ ] **Provisioning only through `prerequest/` fixtures, `00-setup-*.spec.ts` page-object journeys,
      or the DB helper / CLI with a QC-named env var; teardown by default, `keep` registered in
      `## Test Data`; no connection string or credential echoed, logged, or written anywhere**
- [ ] **`{run_file}.data_readiness` written; every skip guard in the specs traces to a
      readiness decision; decisions recorded in the learning file Q&A**
- [ ] First run: every failure classified; only test-code defects healed (≤2 iterations); Heal Log kept
- [ ] No assertion lowered, no skip added to hide a failure, no app bug masked
- [ ] **Results under `{results_root}` (`reports/[SPEC-{spec-name}/]{user_story_name}/`) as the Markdown phase plus `{run_file}` — phase auto-incremented across the nested AND legacy folders, NO prior phase overwritten or deleted; previous-phase links resolve into whichever folder holds them**
- [ ] **No `--reporter` and no `--config` passed on any CLI command; every stage / run-group command wrote its own stage JSON at the resolved `{stage_json_path}` (mtime later than that command's start) — or, for a watchdog stop, its `{stage}-{group}.watchdog.json` — checked right after each command, run STOPPED on a missing or stale file**
- [ ] **ONE shared `playwright.config.ts`: config-inventory run before generation; every extra config merged only when reproducible with identical behaviour, its references rewritten, the smoke stage run, and the file deleted only after a re-run listed it under `deletable[]`; every unmergeable config listed under `Configurations not merged` with its blocking setting; no `playwright.us-*.config.ts` left unexplained; reporters additive (line · json · progress-reporter beside the project's own)**
- [ ] **Timeout policy: every value from `timeouts.ts` (none inline), initial values + `playwright_version` + feature gates recorded in the run file and the Timeout policy section; every `timeout_failure` / watchdog event listed with TC-ID, step, elapsed, expected condition and evidence path; a value raised only where the trace shows the operation legitimately completing after the deadline, recorded `{key, from, to, reason, evidence}` in the run file, the Heal Log and the report; no retry added to absorb a timeout; calibration and the probe reported `NOT_RUN` with the reason when no run happened**
- [ ] **Watchdog: `PW_GLOBAL_TIMEOUT` set per command; `watchdog.mjs` polled with the group's heartbeat; a stop taken only on `FROZEN` (an open step past its OWN deadline + grace, no progress, no newer worker record, no newer result), never on console silence or a stale stage JSON; on a stop the `completed[]` results kept, `interrupted[]` (`INCOMPLETE`, step + elapsed, `collateral` marked) and `not_started[]` (`NOT_RUN`) named, the group re-queued once, the event classified `timeout_failure`**
- [ ] **Code craft (`references/code-craft.md` [M] items): every generated / updated test uses `step()` per manual step (validator run with `--require-steps`); positional selectors scoped or justified; no `networkidle` readiness; tags via the details object where the version allows, `[TC-ID]` in the title always; `expect.soft` only for independent checks; created data named by `uniqueName()`; console guard attached; fixtures (when used) wrap `prerequest/` functions; `.gitignore` lines present; page objects and components follow §1-3**
- [ ] **`{run_file}.merged` keeps every variant (project × data variation) and every attempt in order; a TC is `PASS` only when every `required_variants` entry from the run plan passed, otherwise `INCOMPLETE` (never published as Passed — ADO outcome Inconclusive); TC totals count each TC-ID once; a multi-`[TC-ID]` title is credited to every TC; `phase sections` built from the merge only**
- [ ] **Progress log created at `{logs_root}/run-progress-{stamp}.log` (`automation-logs/[SPEC-{spec-name}/]{user_story_name}/`), announced at start with the three resolved roots, appended across ALL stages (not just execution), historical logs untouched**
- [ ] **Test runs executed in background with per-poll chat updates: counts, current TC, elapsed, and a REFRESHED estimated-remaining time**
- [ ] **Stage order enforced: setup journeys (if any) → smoke → gate → positive → negative; no TC run twice in one phase; a failed setup journey skips its dependent TCs with reason and never counts against the smoke gate**
- [ ] **Run plan built from the approved TCs and written to `{run_file}.run_plan` with `required_variants` per TC; every TC carries one `@run:` tag; serial groups in `mode: 'serial'` describes; inside every stage the parallel group ran ×{workers_parallel} then serial groups ×1; reasons recorded for every serial decision**
- [ ] **Browser visible (headed Google Chrome, `channel: 'chrome'`) through the shared `playwright.config.ts` — or the `PW_HEADLESS=1` fallback reported in chat AND under Deviations; the shared config changed only per `<shared_config>` (contract settings, additive reporters, `testMatch` registration), every valid project setting preserved**
- [ ] **Every executed test attempt has `{screenshots_root}/phase-{N}/{TC-ID}/{variant_slug}/attempt-{a}.png` captured AT THE ASSERTION POINT (before teardown / cleanup / navigation away — never from `afterEach`); every failed attempt also has `attempt-{a}-failed.png`; nothing under `screenshots/` overwritten or deleted — earlier attempts and earlier phases byte-identical; every path recorded in the merged and phase JSON**
- [ ] **Evidence sanity check done: no PASS image shows a cleaned-up screen; every `evidence_failure` healed by moving the call, not by editing the image or the assertion**
- [ ] **Smoke gate math reported (fail%, majority classification, action); automation/env majority → heal + smoke re-run (≤2 cycles); app_bug majority → run stopped**
- [ ] **On a gate stop: run file completed (`stopped-smoke-gate`), phase section appended with Outcome SMOKE GATE FAILED, smoke failures recorded in the bug file, page rendered with the banner and every positive/negative TC as NOT_RUN**
- [ ] **`@smoke` tags derive only from the TC document's `Smoke:` field**
- [ ] Second run clean; run file finalized, `## Phase {N}` appended (earlier sections byte-identical), page rendered by the script with RELATIVE screenshot links and the viewer (no base64, every link resolving), renderer gate PASS and `selftest-run-report.mjs` passing before the page is delivered; INCOMPLETE TCs shown with their missing variants, variant/attempt sub-rows for multi-variant or retried TCs
- [ ] **`BUG-REPORT-{feature}.md` updated: one entry per `app_bug` of this phase, a History line for every retested bug, `resolved (phase N)` only after a passing retest, `not-checked-this-run` when the TC did not run, no entry rewritten or id reused; the phase's `### Bugs` table cites those ids and the renderer reports no `bug-*` mismatch**
- [ ] **Every app_bug titled as a plain sentence (`The system doesn't … when …`) — never an
      assertion string, locator, or TC-ID; raw error text lives under Evidence**
- [ ] **Every app_bug has numbered reproduce steps starting at login, in the canonical verbs,
      plus one-sentence Expected and Actual**
- [ ] Every app_bug has root cause and a screenshot (or states plainly that none was captured)
- [ ] ADO close-out **under `ado_mode = linked` only**: the resolved automation flag set where
      earned (if the template rejects `AutomationStatus = Automated`, it stays `Planned` and the
      custom flag carries the status); summary comment posted; ADO-MAP updated — only the
      `AutomationStatus` and `automated_tc_sha256` columns, the hash from `scripts/tc-hash.mjs`
      (harness `selftest-tc-hash.mjs` passing) for TCs that ran full coverage with PASS after
      Checkpoint B PASS, `—` for every PARTIAL / other TC; `published_tc_sha256`,
      `Tags (introduced)` and `Suite` never touched.
      Under `local`: phase skipped silently, recorded as not applicable, no publish suggested
- [ ] Deviations honest and complete
- [ ] Learning file searched (Index + tag grep, not the whole file) before every ask and before
      selector/environment discovery; recorded and `[similar:]` knowledge reused
- [ ] Learning file updated: user answers under Automation Model Q&A, automation tricks and env
      facts as tagged plain-English lines, Index rows updated — no PATs, no code identifiers
</quality_checklist>
