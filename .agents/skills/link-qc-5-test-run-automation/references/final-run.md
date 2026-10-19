# The final run, the merge and the reports — PHASE 4

Loaded by `SKILL.md` at **Running Final Verification**; steps 2-4 of `<second_run>` are **Preparing
Final Report** (with `references/run-report.md`). For "read my comments" alone, only step 4's
reviewer-comments bullet and the render apply.

## PHASE 4 — SECOND RUN (FINAL REPORT)

<second_run>
1. **Clean full re-run** of the spec — same staged order (`<staged_execution>`:
   smoke → gate → positive → negative), each stage ONE `run-stage.mjs --run final` call and one
   stage message labelled "final run" (`<live_progress>`).
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
     reuse an id (ids continue across this skill and the manual CLI run, 5b, which may also resolve a
     bug of this skill by a passing retest); update the header's `Bugs` count line. Unverified-assumption failures are
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
