# The re-run, the merge and the reports — PHASE 4

Loaded at **Re-running Fixed & Impacted Tests** — or at a smoke-gate stop, where step 1 does not apply; steps 2-4 of `<second_run>` are
**Preparing Final Report** (with `references/run-report.md`).

## PHASE 4 — TARGETED RE-RUN (FINAL REPORT)

<second_run>
1. **Targeted re-run** — only the TCs the first run's result can no longer stand for. One phase,
   one `## Phase {N}` section, one report: the re-run's attempts are merged into the first run's
   (step 2); every TC that is not re-run keeps its first-run attempt.
   1. **Select** on the healed code:
      ```text
      node .claude/skills/link-qc-5-test-run-automation/scripts/impact.mjs select --root {automation_root} --spec {spec files}
        --progress {results_root}/artifacts/progress --run-file {run_file}
      ```
      The **re-run set** = `stale[]` (code the TC's latest attempt ran on changed since — `{tc,
      changed[], last}`; `unknown[]` tests are always stale and `expanded[]` adds every TC that
      shares a test with a selected one — a `[TC-01][TC-02]` title) ∪ `no_verdict[]` (NOT_RUN after a stop, interrupted, `rate_limited`) ∪
      every TC classified `environment_failure`, once `<environment_gate>` passes again ∪ the setup
      group of every re-run `serial:{gap}` TC (its data was deleted after the group — run `--run
      rerun --stage setup --groups setup:{gap}` first) ∪ the predecessors of every re-run chain follower.
      **`app_bug` failures are not re-run unless stale** — the isolation check already confirmed
      them alone (user decision, 2026-10-19). You may ADD a TC with a written reason (`rerun.reason:
      added`), never remove one the selection named. `outside_scope[]` (another story's spec that
      imports a changed part) is listed under `### Deviations` and not run; `fresh_by_member_only[]`
      is not re-run — Checkpoint B reviews it. `never_run[]` TCs keep their NOT_RUN reason (a
      smoke-gate stop, a Checkpoint A block, a data skip) — add one only when that reason is gone.
   2. **Refresh Checkpoint A's applicable checks on the changed files** (`compliance-checkpoints.md`
      §4a) before anything runs.
   3. **Re-run** each stage that has TCs in the set, in staged order (setup → smoke → gate →
      positive → negative), ONE `run-stage.mjs --run rerun` call per stage and one stage message
      labelled "re-run" (`<live_progress>`):
      `--run rerun --stage {S} --stage-tcs {…} --tcs {the set's TCs of S} --burn-in {the healed TCs of S}` with the
      same `--units` file as the first run — the call re-plans it itself when the heal changed the code (`scheduler.replanned`).
      The healed TCs run as burn-in (their own command per group, workers 1, `--repeat-each=3`,
      ceiling × 3; **any failing repeat = FAIL** — the heal is not confirmed, a flaky test is a
      defect). The isolation check runs inside every re-run call as in the first run.
   4. **Empty set** → no call. State "Re-run not needed — no code changed after the first run and
      every TC has a verdict" in the chat, the `### Run` bullet `- **Re-run:** not needed — …` and
      `{run_file}.impact`.
   5. **Automation failures still open** → heal iteration 2 → select again (only what became stale
      since re-run 1, plus any new `no_verdict[]`) → re-run 2. **Maximum 2 heal iterations** in the
      phase; whatever still fails for test-code reasons after that is reported as-is.
   6. **A smoke-gate STOP in the re-run** (`<staged_execution>` step 2, phase-wide) keeps every
      fresh first-run result as it is; only the stale TCs the stop prevented become `NOT_RUN` with
      `not started: smoke gate failed (re-run)`.
2. **Merge every attempt of the phase** into `{run_file}.merged` — computed by `run-data.mjs merge`, never by
   hand (`<publication>` step 1; the rules below are what it implements and what you check). Inputs: every stage JSON under
   `{results_root}/artifacts/stages/` (first run, smoke retries, isolation checks, re-run, burn-in —
   each passed its own command's freshness gate; each a raw Playwright JSON report), every
   `*.watchdog.json` stand-in of a stopped command, and the stage summaries
   (`artifacts/progress/{run}-{stage}-{seq}.summary.json`) for each command's `merged_stages[]`
   entry (`started_at`, `run`, `command`, the code fingerprints):

   - **Execution** = one Playwright test result entry from one stage JSON.
   - **Variant identity** — the merge key is **(TC, required-variant slug)**: a heal that moved a
     test to another describe or group still lands on the same variant. `variant_key` = spec file
     + full title path (describe chain + test title) + Playwright **project name** + repeat index
     is kept for display. Different projects (browsers) or data variations are different variants
     and are **never merged**; `variant_slug` is the file-safe form from `<result_organization>`.
     Burn-in repeats are attempts of the required variant (numbered in order), never extra
     variants — even when their evidence folder carries `r1` / `r2` (the evidence helper reads
     `testInfo.repeatEachIndex`); a required `r{n}` comes only from a `repeatEach` the run plan sets.
   - **Attempt** = another execution of the SAME variant (first run, smoke retry, isolation check,
     re-run, burn-in repeat, re-queue, Playwright retry). All attempts are kept, **ordered by
     command start time** (`merged.stages[].started_at`); the variant's `final_status` is the
     **latest** attempt — for a burn-in command every repeat counts (any failing repeat → FAIL).
     Each attempt carries `run` (`first` | `rerun`), `command` (`normal` | `isolation` |
     `burn-in`), `code_fingerprint`, and a `stage` text that names the pass (`positive`, `positive
     · re-run`, `smoke · isolation`, `positive · burn-in`) — the renderer shows it as written.
   - **Results of record** = the latest attempt per TC over the whole phase, each one fresh
     (`impact.mjs`, `<checkpoint_b>`). A parallel FAIL followed by an isolation PASS is a PASS with
     the parallel attempt kept in the history and the report (`parallel_checks[]`); a TC refused
     by the application's rate limit and still refused alone is `INCOMPLETE`, Classification
     `rate_limited` — no verdict.
   - **TC mapping**: every `[TC-ID]` token in the title maps the execution to that TC — a title
     may carry several (`[TC-01][TC-02]` or `[TC-01, TC-02]`), then the variant counts toward
     each of them. A TC may also be covered by several variants (chromium + firefox, variation
     A + B).
   - **Required variants** come from `{run_file}.run_plan` `required_variants[tc_id]`.
   - **Overall TC status** — complete coverage required: any required variant `FAIL` →
     `FAIL`; all required variants executed and `PASS` → `PASS`; at least one required variant
     `PASS` but another required variant `SKIP` / `NOT_RUN` / missing → **`INCOMPLETE`** (never
     `PASS`) with `missing_variants[]`; a required variant whose latest attempt was refused by
     the rate limit (`rate_limited`) → `INCOMPLETE` too (no verdict, never `FAIL`); only `SKIP` →
     `SKIP`; nothing executed → `NOT_RUN`.
     Extra, non-required variants are kept and reported but never make up for a missing
     required one. A TC generated up to a `[HUMAN]` step (PHASE 2 candidacy) whose automated
     part passed on every required variant is **`PARTIAL`** — written `PARTIAL — human step
     pending` in the Results table, classification `human step: {n}`, `human_step: {n}` in the
     run file — never `PASS`; its automated part failing is `FAIL` like any other.
   - **Totals count TCs**, one per TC-ID, from the overall status — a TC is never counted
     twice; per-variant counts go to `variant_totals`.

   `{run_file}.merged` (within schema `skill6-run/1`, run-report.md §7):
   - `stages[]` — `name, group, attempt, project, run, command, json_path, started_at, finished_at` (ready-made
     in the stage summaries' `merged_stages[]`);
   - `executions[]` — `variant_key, variant_slug, tc_ids[], title, file, project, stage, group, attempt, run,
     command, code_fingerprint, status, duration_ms, error, attachments[]`;
   - `variants[]` — `variant_key, variant_slug, tc_ids[], project, attempts[] { attempt, stage, run, command,
     code_fingerprint, status, evidence_screenshot, failure_screenshot }, final_status`;
   - `tcs[]` — `tc_id, required_variants[], variant_slugs[], status, missing_variants[], skipped_variants[]`;
   - `variant_totals { passed, failed, skipped, not_run, partial }`.

3. **Complete the draft run file** (`artifacts/drafts/phase-{N}/.runs/phase-{N}.json`), schema `skill6-run/1`
   in run-report.md §7. `run-data.mjs merge --write` fills every machine part (`merged`, `results[]` rows,
   `stages`, `totals`, `variant_totals`, `parallel_checks[]` with the interference cause, `rate_limit`,
   `watchdog_events[]`, `timeouts.events[]`, `concurrency`); you fill what only judgement can — each result's
   `classification`, `root_cause`, `severity`, `assumption`, the `heal_log[]`, `deviations[]`, `bugs[]`, every
   `parallel_checks[].resolution` and every event's classification — and the script keeps them on every later
   merge. Preserve earlier
   planning/open-question/readiness/coverage/checkpoint objects. Store merged data in `merged`,
   variant totals at top level and TC counts in `totals` — both from the results of record, one
   per TC. Each `results[]` row is the result of record of one TC:
   - `tc_id`, `req_id`, `test_name`, `status` (PASS · FAIL · INCOMPLETE · SKIP · NOT_RUN · PARTIAL), `duration_ms`;
   - `classification` — the `<first_run>` catalogue or `N/A`; `rate_limited` only with INCOMPLETE,
     `human step: {n}` only with PARTIAL;
   - `unverified_assumption`, `assumption`, `error_message`, `root_cause`, `run_group`, `run_mode`, `severity`,
     `healed_in_first_run`, `attempts`, `missing_variants[]`;
   - `evidence_screenshot` / `failure_screenshot` of the status-of-record attempt (`null` for NOT_RUN / SKIP);
   - `rerun` — `{ reason: impacted | no-verdict | added, changed[] }`, `null` when the result of record is the
     first-run attempt;
   - `variants[]` — each `{ variant_slug, project, final_status, duration_ms, attempts[] }` (attempts as in
     `merged.variants[]`);
   - value domains: `severity` Critical · High · Medium · Low · N/A; `run_group` `parallel` | `serial:{group}`;
     `run_mode` `parallel` | `serial`.

   Four more sections (shapes in `references/run-report.md` §7): `parallel_checks[]` — one entry per
   isolation-check outcome (TC, parallel attempt, alone attempt, `interference | confirmed |
   rate_limited`, the tests that overlapped it and their alone results, the group move);
   `rate_limit{}` — the planned services and what the network guard recorded (refusals, policies,
   cool-downs, adjustments, limits learned); `impact{}` — every `impact.mjs select` call (the re-run
   set with reasons, `outside_scope[]`, the final freshness check with `stale: []` and the
   `fresh_by_member_only[]` review); `run_plan_adjustments[]` — top level, append-only, every move /
   rate-limit / workers change of the phase (`<run_plan>`).

4. **Append the phase section, update the bug file, render — as DRAFTS, published only after Checkpoint B**
   (`<publication>`; contracts `references/run-report.md` §4-§5):
   - the draft `TEST-RUN-REPORT-{feature}.md`: on the story's first run under this layout create the file with the
     header block and `## Run history`; otherwise update only the header lines and add ONE
     run-history row. Append `## Phase {N} — {date}` with Run (incl. the one-line `Re-run`,
     `Isolation checks` and `Rate limits` bullets), Stages + smoke gate (`{Stage} (re-run)` rows;
     the Total row = the results of record), Run plan, Coverage, Results (one row per TC, the
     result of record; Evidence = relative links into `{screenshots_root}`), Unverified
     assumptions, the Bugs cross-reference table (ids only), Heal log, Skips, Open questions,
     Test-data readiness, Deviations (interference with its cause, refusals, deferrals, `outside_scope[]`) —
     every table written from the merged phase: the header lines, the run-history row, the Stages table +
     smoke-gate line, the Results rows, the one-line `### Run` bullets (incl. `- **Acceptance:**`) and the
     readiness table come ready-made from `run-data.mjs report` / `readiness` (`fragments{}`) — paste them; never
     recount. The header's `Compliance` line reads `Checkpoint A {verdict} · Checkpoint B pending — see gate
     record` in the draft. **Earlier phase sections are never touched.**
   - the draft `BUG-REPORT-{feature}.md`: create it with `## Bugs` / `none` on the first run; one `### BUG-n` entry in
     `<bug_report_format>` per NEW `app_bug` of this phase (`Found in phase: N`, `Status: open`, the
     failure image as a relative link); for every existing bug whose TC ran, a History line and its
     Status — the rules of run-report.md §5 (`resolved (phase N)` only after a passing retest, `open` when
     the retest failed again; ids continue across this skill and 5b). Never entered: unverified-assumption failures, `rate_limited`
     TCs, parallel interference (a `### Deviations` bullet).
   - **Reviewer comments** (`REVIEW-COMMENTS-{feature}.md` beside the report, or pasted in chat): read every
     open entry (`General`, `BUG-{n}`, `phase-{N}`) and every `- **Reviewer comment:**` bullet (bug file, a
     phase's `### Run`); handle each per run-report.md §9b — act under this skill's rules (a run request is a new phase,
     a question gets an answer, "not a bug" is weighed against the requirement, a TC change is `answered`
     with the route to skill 3 `--revision`), then set only its Status + one-line Response. A comment
     never changes a bug's Status. "read my comments" alone runs this bullet and the render.
   - Record the results-freshness check in the draft run file's `impact.final_check`, set its final status,
     render the DRAFT page, freeze, run Checkpoint B and publish — `<publication>` steps 2-6. The HTML is never
     hand-written; act on the renderer's payload per run-report.md §2, never on the HTML.
</second_run>

<publication>
**Drafts → freeze → Checkpoint B → publish.** The phase's report set exists as drafts until Checkpoint B
passed on exactly those bytes; nothing a reader sees ever claims a B verdict the gate did not give.
1. **Drafts.** `node .claude/skills/link-qc-5-test-run-automation/scripts/run-data.mjs draft-init --results-root
   {results_root} --phase {N} --feature {feature}` copies the published report, bug file and run files into
   `{results_root}/artifacts/drafts/phase-{N}/` (inside `artifacts/` — the folder whitelist is unchanged). Then
   `run-data.mjs merge --run-file {drafts}/.runs/phase-{N}.json --write`, `run-data.mjs report` and `run-data.mjs
   readiness` on the same draft run file give every number and table (`<second_run>` steps 2-4).
2. **Draft page and pre-gate acceptance.**
   ```text
   node .claude/skills/link-qc-5-test-run-automation/scripts/render-run-report.mjs --report {drafts}/TEST-RUN-REPORT-{feature}.md --bugs {drafts}/BUG-REPORT-{feature}.md --runs {drafts}/.runs --base {results_root} --out {drafts}/TEST-RUN-REPORT-{feature}.html --write
   node .claude/skills/link-qc-5-test-run-automation/scripts/run-data.mjs acceptance --run-file {drafts}/.runs/phase-{N}.json --write
   ```
   `--base` resolves the evidence links against the story folder, so the draft page shows what the published
   one will. The renderer's harness runs once per installed skill version, not before every page:
   `node .claude/skills/link-qc-5-test-run-automation/scripts/check.mjs harness --name selftest-run-report.mjs`
   (a cached pass for the same skill version, scripts, fixtures, Node and platform; anything changed → it runs
   again; a failing harness → the markdown is delivered, the page is not).
3. **Freeze + Checkpoint B** — `compliance-checkpoints.md` §4a: the snapshot hashes the drafts; nothing is
   edited until the gate decides.
4. **Publish — only on gate B `PASS`:**
   ```text
   node .claude/skills/link-qc-5-test-run-automation/scripts/run-data.mjs publish --results-root {results_root} --phase {N} --feature {feature}
   ```
   It refuses unless `.runs/phase-{N}.checkpoint-B.json` says PASS with a matching re-hash and every draft
   still has its frozen hash; then promotes the drafts byte for byte, renders `{run_report_html}` from them +
   the gate record (the provenance hashes the gate record) and proves a dry-run re-render reproduces the page
   byte for byte. `REFUSED` → nothing changed; fix the cause, re-draft, freeze again. A hand-edited page is
   never overwritten without `--force` (tell the user what will be lost first).
5. **Final acceptance** — `node .claude/skills/link-qc-5-test-run-automation/scripts/run-data.mjs acceptance
   --run-file {run_file}` (read-only; the published run file stays byte-identical to its frozen draft) gives the
   run's `ACCEPTED` / `NOT ACCEPTED — {reasons}` for the return (`<run_acceptance>`).
6. **Close-out** — the Azure DevOps close-out under `linked` (after B PASS), the learning write-back, then
   release the environment lease after teardown, clean-up and the background quiet period:
   `node .claude/skills/link-qc-5-test-run-automation/scripts/capacity.mjs lease release --env-id {env_id} --run-file {run_file} [--quiet-ms {ms}]`.
</publication>

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
