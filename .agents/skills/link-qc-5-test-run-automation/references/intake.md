# Intake — inputs, project profile, learning file

Loaded by `SKILL.md` at **Reviewing Requirements & Test Cases** (PHASE 0). Every block keeps its tag;
`SKILL.md`'s block index says which file holds each block.

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

1. **TC document path** — skill 3's `TEST-CASES-{feature}.md`. Read its `Status:` line:
   - `APPROVED` → proceed.
   - anything else (`PENDING HUMAN REVIEW`, another value, no line) → **ask ONCE**, before any
     other question and before anything is written, with the value found and three choices:
     **A) Approve now** — you set `Status: APPROVED` in the document (that line only — no other
     byte of the TC document, `TEST-DATA`, the review page or the sidecar changes) and proceed;
     the final message says the status was set this run on the user's instruction.
     **B) Run without approval** — the document stays exactly as it is; proceed; the report's
     `Source document` header line and the phase's `### Deviations` carry
     `Status: {value} — run without approval (user decision, {date})`, and so does the final
     message. Skill 4's own gate is untouched (an unapproved document still cannot be published).
     **C) Stop** → BLOCKED, naming the value found.
     Recommend A when the user says the review is done, otherwise B. `--approve` answers A and
     `--unapproved` answers B in advance (never re-asked); a pipeline run with neither is BLOCKED
     and names both flags. The choice holds for this run only — never written to the learning
     file, never reused on a later run. Never flip a status silently, never to any value other
     than `APPROVED`, and never when the document is not a skill-3 TC document (frozen fields
     missing → BLOCKED, never repaired).
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
User Story fetch counts). **Azure MCP failure (`CONNECT_TIMEOUT`, `TF400813`, 401, 403)** →
**do NOT stop**: stop the Azure calls, report once, drop to `ado_mode = local`, and continue;
PHASE 5 is then skipped. Run the diagnostic in
[references/azure-mcp-troubleshooting.md](references/azure-mcp-troubleshooting.md) and give
the user the ONE fix for the matching row as the first line of the final summary (at most
once, as what would let the close-out run next time). When the fix is "Set or replace the
PAT", list its 7 steps with the command filled in with this project's path (a read/write PAT
covering Work Items + Test Management). Never ask for the token; never use REST as a fallback.
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
- Every fixture kept after the run (PHASE 2.6 — the default) and every fixture found to exist →
  one `[type: data]` line under `## Test Data`:
  `- [module: X] [type: data] Fixture "{plain name}" — {what exists: entity, state, count, identifiers}; environment {env}; stamped values: {field = value}; created through {the automation project's … helper | the … setup journey | the application's … endpoint | the database} on {YYYY-MM-DD}, kept.`
  Every QC consent and keep / clean-up decision → a `[type: qa]` line in this skill's Q&A, so the
  next run reuses it without asking; not-creatable evidence and "the screen is not the rule"
  facts → `[type: env]` lines.
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
