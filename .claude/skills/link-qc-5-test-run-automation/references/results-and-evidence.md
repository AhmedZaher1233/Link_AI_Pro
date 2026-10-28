# Results, evidence and the progress log — where every run artifact goes

Loaded by `SKILL.md` at **Reviewing Requirements & Test Cases**: the phase number, the three roots, the
folder whitelist and the evidence contract every spec is written against. `references/run-report.md`
(the report shapes, the renderer, the run-file schema) is loaded only at **Preparing Final Report**.

<result_organization>
**All run artifacts are organized per User Story, with immutable phase history —
inside the structure's `reports/` folder, mirroring the TC folder's `SPEC-*` parent.**

`references/run-report.md` owns the folder contract (§3), both markdown shapes, the run-file schema
and the renderer's gates — load it at **Preparing Final Report**; what the earlier activities need
from it (the roots, the phase number, the whitelist, the evidence rules) is restated in this block.

- Result root: `{results_root}` = `{automation_root}/reports/{spec_level}{user_story_name}/` —
  the TC folder's exact leaf, resolved once, immutable for the run.
- **Every invocation for the same User Story is a NEW phase.** `N` = 1 + the highest phase found in
  `{results_root}/.runs/phase-*.json`, in legacy `phase-*.json|html` at the top level of
  `{results_root}`, and in every existing `{legacy_results_root}`. Resolve N once at profile
  time, create `.runs/phase-{N}.json` (`status: planning`), write only to `{results_root}`.
  **NEVER overwrite, edit or delete a previous phase's artifacts — in any folder.** An invocation
  that stops before execution still finalizes a short phase (run file with its final status, a
  `## Phase N` section whose Outcome says why, a run-history row of `—`); the next takes N+1.

Inside `{results_root}` (full tree: run-report.md §3): `TEST-RUN-REPORT-{feature}.md` (header + `## Run
history` + one `## Phase N` per run, appended) · `BUG-REPORT-{feature}.md` · the rendered
`TEST-RUN-REPORT-{feature}.html` · `automation-inventory.md` · `coverage/` (three CSVs, replaced) ·
`.runs/phase-{N}.json` (all machine data of a phase, immutable once final — skill 9's retest of the latest
phase excepted) · `artifacts/` (`stages/`, `progress/`, `test-output/` — one folder per command). A story
without a `SPEC-*` parent is flat; an old `US-{id}/` leaf is legacy, read-only history.

- **Top-level whitelist.** The story folder holds exactly `TEST-RUN-REPORT-{feature}.md`,
  `BUG-REPORT-{feature}.md`, `TEST-RUN-REPORT-{feature}.html`, `automation-inventory.md`,
  `coverage/`, `.runs/`, `artifacts/`, plus the reviewer's optional `REVIEW-COMMENTS-{feature}.md`
  (saved from the page by the reviewer; the skill never creates it and only sets each handled
  entry's Status and Response). Nothing else is ever created there. Machine data of a run goes into
  `.runs/phase-{N}.json` (+ its gate records `.runs/phase-{N}.checkpoint-{A|B}.json`); run scratch, the
  report set's drafts and the checkpoint snapshots under `artifacts/`; an investigation probe never here at
  all (`<scratch_investigation>`).
- **The manual CLI run (5b) shares this folder** with the same phase counter and `BUG-{n}` sequence; its
  phases are ordinary earlier phases here, never rewritten (run-report.md §3).
- **Legacy locations are first-class, read-only history.** Projects set up before this layout keep
  their `reports/[SPEC-*/]US-{id}/` folders, top-level `phase-N.json` / `phase-N.html`,
  `merged-results.json`, `run-plan.json`, `open-questions.json`, `data-readiness.json`,
  `stages/`, `coverage/coverage-dashboard.html` and `coverage-previous.json` exactly where they
  are. The skill never moves, renames, deletes or rewrites them, and no script does. The first run
  under the new layout says so once in the chat (where the earlier phases are, which number the new one
  takes), names them on the report header's `Earlier phases` line
  and in `{run_file}.previous_phase`, and reads a legacy `coverage-previous.json` only as the
  fallback for the coverage delta (stating which one it compared against). Legacy
  `automation-logs/…/US-{id}/` and `screenshots/` leaves are left untouched and mentioned once.
- At finalization: complete the run file, append the `## Phase N` section, update the bug file,
  render (`<second_run>` step 4). The phase number appears in the run file (`"phase": N`), as the
  `## Phase N — date` heading and a run-history row, in the rendered page, in the ADO summary
  comment and in the final chat summary — it must be immediately clear which result belongs to
  which execution.

**Screenshots — every TC, every variant, every attempt (as far as the run's screenshot choice owes them — `all` by
default, see the evidence contract); one folder per User Story; IMMUTABLE:**

Path: `{screenshots_root}/phase-{N}/{TC-ID}/{variant_slug}/attempt-{a}.png` (the ASSERTION-POINT image, full
page, pass or fail) and `attempt-{a}-failed.png` (the failing step), plus `phase-{N}/variants.json` (slug →
title path, project, spec file). A second-locale variant is its own TC; earlier phases are never touched.

**API / DB records (3.0)** sit beside the image path: `attempt-{a}.record.json` (the assertion-point record of an
`api` / `db` / `api+db` / `hybrid` test) and `attempt-{a}-failed.record.json` (a failed attempt without one) —
schema `skill5-record/1`, redacted, sealed, never overwritten (`code-craft.md` §18). A backend TC has records and no
image; a hybrid TC has both. The project of a backend TC is `backend`, so its slug reads `backend--…--r0`.

`variant_slug` = `{project}--{data-variation-slug}--r{repeat}` — `project` =
`testInfo.project.name`; `data-variation-slug` = kebab-case of the variation label in the test
title (`none` when the test has no variation); `r{repeat}` = `testInfo.repeatEachIndex` (`r0`
normally). `{a}` counts every execution of that variant in this phase, starting at 1 and numbered
in the order the commands started — the first run, an isolation check, a smoke retry, a re-queue,
the re-run, each burn-in repeat and Playwright retries (`testInfo.retry`). A burn-in repeat's image
lands under the `r{repeat}` its `repeatEachIndex` gives; the merge still credits it to the required
variant as an attempt, never as an extra variant (`<second_run>` step 2). Which image belongs to which attempt is decided
by the attempt's own test span (TC, project, repeat, retry, worker), never by the folder alone; the stored path form, the
pairing and the ambiguous / missing cases: `references/schemas/paths-and-evidence.md` §1, §4-§5.

**Evidence contract — screenshot at the ASSERTION POINT, never at test end.**
A screenshot taken after the test finishes is taken after `afterEach`/`afterAll` teardown
has already deleted or reset the test data, so it shows an empty list, a "not found" page,
or the pre-test state — evidence that contradicts the PASS it is attached to. This contract
exists so no module ever inherits that defect:

- The assertion-point image is taken for **every executed test** by one shared evidence helper
  (`helpers/evidence.ts` → `captureEvidence(page, testInfo)`, or the project's equivalent). It writes the
  image under EACH `[TC-ID]` of the title, **never to an existing path** (it increments `{a}`), and
  records the slug in `variants.json`. The spec calls it **inside the test body at the assertion point**
  — immediately before the (last) `expect(...)` of the Assert step, while the state the TC verifies is
  on screen. One call per test; a TC that verifies several screens captures the last one.
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
- **The run's screenshot choice** (`{run_file}.delivery.screenshots`, `intake.md` item 4) reaches every command as
  `PW_SCREENSHOTS` (`run-stage.mjs`; absent → `all`), and the helper — never the spec — honours it:
  `all` → everything above; `failed` → `captureEvidence` writes nothing (no image, no `evidence` heartbeat) and the
  `afterEach` failure handling still writes `attempt-{a}.png` (the current screen) and `attempt-{a}-failed.png` for a
  failing attempt; `none` → neither writes an image. Records (`attempt-{a}.record.json`) are written whatever the
  choice. The spec code is the same under every choice (`captureEvidence` stays at the assertion point, item 40), so
  a later run can choose `all` without a code change. An EXISTING project helper that does not read `PW_SCREENSHOTS`
  gains that one guard when the run chose `failed` or `none` (like the heartbeat line below); until it does, it simply
  writes every image — more evidence than the choice owes, never less.
- Specs only call the helper — no `page.screenshot(...)` in a spec body, ever.
- **The helper writes an `evidence` heartbeat** (`{ at, worker, tc, event: 'evidence', path }` to
  `PW_PROGRESS_FILE`, through `helpers/steps.ts`'s `heartbeat()`) for every image it writes, and the console
  guard's `report()` — the first statement of `afterEach` — writes `teardown`: Checkpoint B proves from
  them that every PASS test's image was taken BEFORE its teardown started (compliance item 16b). An existing
  project helper gains that one line; without it item 16b stays `unresolved`.
- **Evidence sanity check (first run and re-run):** for every PASS that has an image (under `failed` / `none` a PASS
  has none — there is nothing to check, and item 19 records exactly that), confirm the image shows
  the state named in the TC's Expected Result (record present, message visible, value shown)
  and not a cleaned-up screen. A PASS whose image shows post-cleanup state is classified
  `evidence_failure` (a test-code defect: the call sits after teardown or after navigation)
  and is self-healed by moving the call to the assertion point — it never counts as an
  `app_bug` and never ships in the phase report uncorrected.
- **Evidence is immutable history, like the phase reports.** Nothing under `{screenshots_root}`
  is ever overwritten or deleted — not stale TC-IDs, not earlier attempts, not earlier phases.
  Evidence referenced by an earlier attempt or by an earlier `{run_report_html}` must stay exactly
  where that report points. Each phase writes only into its own `phase-{N}/` folder; the page links
  images by relative path, so nothing under `screenshots/` is ever moved.
- Every attempt's exact image path is stored in `{run_file}.merged`
  (`variants[].attempts[].evidence_screenshot` / `failure_screenshot`), in `{run_file}.results[]`
  (`evidence_screenshot` = the status-of-record attempt — the latest by command start time over the
  phase) and, as a relative link, in the Evidence cell of the report's Results table. A TC that was
  not re-run keeps its first-run image as its evidence; the parallel attempt of an isolation-checked
  TC stays linked in its attempt history.
- Records follow the same rule: `evidence_record` / `failure_record` beside `evidence_screenshot` /
  `failure_screenshot` in the run file, a relative `attempt-{a}.record.json` link in the Evidence cell (rendered as
  "View record", never as an image).
- A TC that was NOT_RUN or SKIPPED has no image; the report says so plainly. Under `screenshots: failed` a passing
  TC has none either, under `none` no TC has one — the `### Run` bullet `Delivery` says which choice the run made.
- **Report format.** Under `delivery.report: md` the story folder gets no new `TEST-RUN-REPORT-{feature}.html` — the
  markdown files are the deliverable (the renderer's gate still checks them at finalize and publish); a page an
  earlier phase rendered stays as it was and no longer shows the latest phase (the publish payload names it
  `stalePage`).

**Immutable vs replaced:** finalized run files, earlier Markdown phase sections, screenshots
and progress logs are immutable (the one exception: skill 9's retest updates the LATEST phase's
section and run file in place — `run-report.md` §3; it adds images, never replaces one). Render HTML again from Markdown; replace only coverage CSVs
and artifacts scratch. Legacy files remain read-only.
</result_organization>

<automation_logs>
**Dedicated log tree — one progress log per run, history never overwritten.**

Path: `{automation_root}/automation-logs/{spec_level}{user_story_name}/run-progress-{YYYY-MM-DD-HHmm}.log` —
the same leaf as `reports/` and `screenshots/`.

- Create `{logs_root}/run-progress-{YYYY-MM-DD-HHmm}.log`
  (`automation-logs/{spec_level}{user_story_name}/`) at the very start of the run and tell the
  user the path immediately, so they can tail it live (`Get-Content -Wait <path>` on Windows).
  Its first lines record the resolved `results_root`, `logs_root`, `screenshots_root` and the
  run start time.
- One NEW file per run. Never append to or overwrite a previous run's log. A legacy flat
  `automation-logs/US-{id}/` folder is left as is.
</automation_logs>
