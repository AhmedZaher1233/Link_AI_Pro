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
- **The manual CLI run shares this folder.** `link-qc-5b-test-run-manual-cli` writes the same report
  set into the same story folder with the same phase counter: a phase it wrote counts for `N`, is named
  by `Previous phase`, is never rewritten and is recognisable by its `Run command` bullet (`manual run —
  playwright-cli … (skill 5b)`) and the run file's `framework: "manual-cli"` (no `coverage_snapshot`, so
  the coverage delta skips it). Its screenshots sit in the same tree under `manual-cli--none--r{repeat}`
  variants, with an AI TC's `reply.md` beside the image. `BUG-{n}` numbering continues across both skills.
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
