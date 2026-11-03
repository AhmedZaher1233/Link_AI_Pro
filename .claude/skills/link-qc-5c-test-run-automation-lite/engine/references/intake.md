# Intake — inputs, project profile, learning file

Loaded by `SKILL.md` at **Reviewing Requirements & Test Cases** (PHASE 0). Every block keeps its tag. Script
arguments: `references/schemas/README.md`; the model never reads a script's source in a run.

<input_gate>
**Before asking anything** search `Testing/project-learning.md` per `<project_learning_file>`; reuse recorded
environments, TC locations and run settings, saying what was reused. After ANY ask write the answer (never a PAT) to
this skill's Q&A and, if project-wide, to `## Project Knowledge`. Missing from both → ASK (interactive) or BLOCKED
(pipeline):
1. **TC document path** — skill 3's `TEST-CASES-{feature}.md`. Grep ONLY its `Status:` line(s) here (read in full
   ONCE at Writing Automation Code, reused while `{run_file}.source_sha256` holds). `APPROVED` → proceed. Anything
   else (`PENDING HUMAN REVIEW`, other value, no line, differing lines) → **ask ONCE**, before any other question and
   before anything is written, naming the value: **A) Approve now** — set `Status: APPROVED` (that line only),
   proceed, the final message says so. **B) Run without approval** — document untouched; the report's `Source
   document` line, the phase's `### Deviations` and the final message carry `Status: {value} — run without approval
   (user decision, {date})`. **C) Stop** → BLOCKED naming the value. Recommend A when the user says the review is
   done, else B. `--approve` = A, `--unapproved` = B (never re-asked); pipeline with neither → BLOCKED naming both
   flags. Per run only, never in the learning file; never flip a status silently, to another value, or on a
   non-skill-3 document (frozen fields missing → BLOCKED). **The ONLY document gate** — ADO publishing is no
   prerequisite (never block, ask to publish, suggest skill 4, beautify or publish here); validation states are
   informational — never ask to run 3b / 3c first.
2. **User Story ID or name** — WITHOUT Azure: task input → TC frontmatter (`User Story` / `us_id`) → the
   `tc_output_folder` leaf `US-{id}-{name}` → ask. State it and **confirm with the user before use** (it fixes
   `{user_story_name}`); a free-text label is accepted;
   `linked` only, a WIQL / search lookup: one match → use, else ASK, never guess.
3. **Environment** — the target test environment (default: the project's env layer / `TEST_ENV` presets).
4. **Delivery — asked at the start of EVERY run** (never read from or written to the learning file): ONE message, the
   run's first question (with the approval question when asked), before anything is written. **Report:** **A) HTML
   page + markdown** (recommended) or **B) Markdown only** (`TEST-RUN-REPORT-{feature}.md` +
   `BUG-REPORT-{feature}.md`; the renderer's gate still runs, no page).
   **Screenshots:** **A) Every TC** (recommended; the assertion-point image of every attempt + the failure image of a
   failing one), **B) Failed TCs only** (a failing attempt: the screen at the failure + its failure image; a passing
   one: none), **C) None** (Evidence `—`, no bug image). API / DB records are always written.
   `--report html|md` / `--screenshots all|failed|none` answer in advance (never re-asked); pipeline without them =
   **html + all**. Record as the run file is created — `{run_file}.delivery { report, screenshots, source: asked |
   flag | default, decided_at }`, read by the scripts. Changes what is produced, never a verdict.

**Environment lease — right after the environment and `{run_file}` are resolved, BEFORE any readiness probe, data
preparation or test touches the environment** (`<capacity_and_lease>`; one skill-5 / skill-9 run per environment):
```text
node .claude/skills/link-qc-5-test-run-automation/scripts/capacity.mjs lease acquire --env {E1 URL}[,{every backend host of TEST-DATA ## 0. Environment}] --test-data {TEST-DATA md} --run-file {run_file}
```
Record `lease.envId` / `members[]` in `{run_file}.environment_lease { env_id, members, run_id, acquired_at }`; pass
`--env-id {env_id}` to every `run-stage.mjs` call. Held by another run → say so once, wait (`--wait {ms}`, bounded) or
stop (BLOCKED naming the holder), never run beside it. Released only at close-out (`<second_run>` step 4), never
between activities, never by a question or long model work.
**Fresh-session line** (never blocking / a question / repeated): with earlier work in this conversation, the run's
first message says once that a fresh session for the next run is faster.
**`ado_mode`** (never asked, never blocking): `linked` only when `{tc_output_folder}/ADO-MAP.md` exists AND its
`source_sha256` equals `sha256({source_tc_doc})` AND the beautified document exists with the same hash; else `local`,
the reason stated ONCE as a Deviation, full run. `linked`: one cheap ADO read; an Azure
MCP failure (`CONNECT_TIMEOUT`, `TF400813`, 401, 403) never stops the run — report once, drop to `local` (PHASE 5
skipped), the matching ONE fix of `azure-mcp-troubleshooting.md` first in the final summary; never ask for the token,
never REST.
**Preflight — the LAST step of intake** (after the lease, the profile and the run file):
```text
node .claude/skills/link-qc-5-test-run-automation/scripts/run-stage.mjs preflight --run-file {run_file} --env-id {env_id} --probe-url {E1 URL}
```
No `--cwd` — the automation root is derived from the run file. `verdict: blocked` whose `reason` starts with
`config location` = the shared Playwright config, its `testDir`, `outputDir`, a reporter output path or
`PW_SCREENSHOTS_ROOT` resolves outside the automation root → ONE question offering
`node .claude/skills/link-qc-5-test-run-automation/scripts/config-inventory.mjs reconcile --root {project} --results-root {results_root} --apply --move-config`;
nothing is generated (no code, no run) before it is answered. Any other `blocked` reason → BLOCKED /
ENVIRONMENT_BLOCKED as before. **After a BLOCKED phase** the next phase starts from `run-data.mjs handoff --run-file
{run_file}` in a FRESH session: the orchestrator writes the fresh-session line and stops — never phase 2 here.
Detail: references/maintainers/intake.md §1
</input_gate>

<qa_manifest>
**Read `Testing/qa-manifest.json` first** (skill 1's contract); its paths precede any auto-detection. Absent
→ detect, then tell the user to run `/link-qc-1-generate-update-testing-structure` — never invoke it yourself. Steering
conflicts resolve per `docs/steering/README.md` (specs = business truth, steering = quality policy, the learning file
overrides neither).
</qa_manifest>

<project_profile>
No hardcoded paths. **Per key: task input → learning file (`#### Knowledge`, `[type: env]`) → auto-detection →
default**; detected keys are written back as `[type: env]` lines. Roots are resolved ONCE.
- `automation_root`: `qa-manifest.json` `paths.automationRoot`, else the folder of the `shared` config
  `config-inventory.mjs` resolves (`ambiguous[]` → ask, never pick); an EXISTING Playwright project is reused, never
  duplicated; new → `Testing/Automation/` · `browser_project` default `chromium` · `ado_mode`: `<input_gate>`,
  default `local` · `ado_org` / `ado_project`: never asked.
- `tc_output_folder`: the approved doc's folder `Testing/Manual_Test/TestCases/[SPEC-{spec-name}/]{UserStoryName}/` ·
  `spec_level`: ONCE from it — `SPEC-{x}/` when the path contains `/SPEC-{x}/`, else empty · `user_story_name`: skill
  3's `US-*` leaf · `source_tc_doc`: `{tc_output_folder}/TEST-CASES-{feature}.md` · `beautified_tc_doc` / `ado_map`:
  skill 4's, OPTIONAL, read-only.
- `results_root` / `logs_root` / `screenshots_root`: `reports/` / `automation-logs/` / `screenshots/` +
  `{spec_level}{user_story_name}/`, stored RELATIVE to the automation root, mirroring the TC folder leaf;
  screenshots are immutable history; older `US-{id}/` leaves are legacy.
- `shared_config`: `config-inventory.mjs` `shared` — the ONE config every story runs from (`<shared_config>`), never a
  second or per-story file, MUST be inside the automation root (preflight checks it); default
  `{automation_root}/playwright.config.ts` · `env_layer` `{automation_root}/utils/env.ts` (reads `.env`; never
  hardcoded URLs / credentials) · `login_page_object` default `pages/LoginPage.ts` · `timeout_policy`
  `{automation_root}/timeouts.ts` · `playwright_version`: `@playwright/test` in `package.json`, confirmed by `npx
  playwright --version` — **< 1.42 → BLOCKED before generation** with the upgrade command.
- `run_file`: `{results_root}/.runs/phase-{N}.json`, ONE per phase, created now with `status: planning`, immutable
  once final · `run_report_md` / `bug_report_md` / `run_report_html`: `{results_root}/TEST-RUN-REPORT-{feature}.md`
  (appended per phase) / `BUG-REPORT-{feature}.md` / `.html` by `render-run-report.mjs --write`, never hand-written,
  none under `delivery.report: md` ·
  `coverage_target` **80** · `coverage_mechanism` **`soft block`** (L3 → `[type: env]` → default).
- `data_setup_layer`: `prerequest/` (API) · `tests/{Area}_Tests/00-setup-{entity}.spec.ts` (UI) · beside the DB-oracle
  helpers (DB) · `db_access`: `helper` → `env:{VAR}` (value never read or written) → `none`.
- `workers_parallel`: legacy `--scheduler groups` only (2); a normal run never sizes workers (Auto ceiling + ramp;
  `--workers N`, `QA_MAX_WORKERS`, `execution.maxWorkers` only LOWER it; serial groups, isolation check and burn-in
  always `--workers 1`) · `headed` **true** (`--headless` / no display → `PW_HEADLESS=1`, a Deviation) ·
  `qa_standards` glob `docs/steering/*`.

Every root / path in the run file is POSIX, relative to `{automation_root}`; `tc_output_folder`, `spec_level` and the
three roots are immutable for the run (stated in the chat and the progress log's first lines; never a flat `US-*`
fallback). `[API]` / `[DB]` lines → load `api-db.md` now (`<backend_layers>` §2). Before any code read `./CLAUDE.md` +
`qa_standards` (steering → CLAUDE.md → skill rules → learning file).
Detail: references/maintainers/intake.md §3
</project_profile>

<project_learning_file>
**Read first, ask second, write back** (shared by skills 1-11, 3b, 3c). `Testing/project-learning.md` (skill 1's
skeleton when absent); this skill's section `### Automation Model (skill 5)` (rename an older `(skill 6)` heading in
place); it also owns most of `## Automation Tricks`.
*Read first — targeted, never whole:* the `## Index` block → Grep the story's `[module: X]` / `[page: Y]` /
`[element: Z]` / `[similar: …]` tags and `[type: trick | env | qa | data]`, matching lines only → before any question
Grep `#### Questions and Answers` → a whole section only under ~40 lines when the grep found nothing. *Ask second:* what is still missing → ONE combined message, WAIT; never re-ask what the file
answers; state what is reused. PATs / credentials NEVER written to the file.
*Write back (mandatory before AUTOMATION COMPLETE):* every answered question → `- [module: X] [type: qa] **Q (skill 5,
{YYYY-MM-DD}):** … — **A:** …` under `#### Questions and Answers` (project-wide also under `## Project Knowledge`);
every new automation fact → one `[type: trick]` / `[type: env]` line (grep first, update / dedupe, never twins); every
fixture kept or found → a `[type: data]` line under `## Test Data` (plain name, entity, state, count, identifiers,
environment, stamped values, how created, date, kept); every QC consent / keep decision → `[type: qa]`; not-creatable
evidence → `[type: env]`; pages sharing a pattern → `[similar: …]` on both; update the `## Index` row of every module
touched; entries the live run contradicts → corrected (the approved TC document and steering always win).
*Content:* plain English, one fact per line; no code, selectors, variables, file / method names, stack traces or
secrets — `data-testid` values and URLs are the only technical tokens, each explained.
*Report:* `AUTOMATION COMPLETE` ends with `**Learning file:** read {sections/tags} · updated {N added / M updated}`.
Detail: references/maintainers/intake.md §4
</project_learning_file>
