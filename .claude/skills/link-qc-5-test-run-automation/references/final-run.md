# The re-run, the merge and the reports — PHASE 4

Loaded at **Re-running Fixed & Impacted Tests** — or at a smoke-gate stop, where step 1 does not apply; steps 2-4 of `<second_run>` are
**Preparing Final Report** (`references/run-report.md` only for a renderer MISMATCH / BLOCKED, reviewer comments or a
smoke-gate stop — the scripts write what it specifies).

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
2. **Merge every attempt of the phase** — done by `run-data.mjs merge` inside `finalize`, never by hand. One execution =
   one result of one stage JSON (first run, smoke retries, isolation checks, re-run, burn-in); the merge key is (TC,
   required-variant slug); attempts ordered by command start time, the latest is the variant's status (a burn-in fails on
   any failing repeat); a required variant missing beside a PASS → `INCOMPLETE`, never PASS; `rate_limited` stays
   INCOMPLETE; a `[HUMAN]`-step TC whose automated part passed is `PARTIAL — human step pending`; totals count TCs. The
   exact rules and the run-file shapes are `references/run-report.md` §7; repeats, burn-in attempts and how each attempt's
   evidence is paired with its own test are `references/schemas/paths-and-evidence.md` §4-§5. What you check: the
   payload's warnings (`evidence-ambiguous`, `req-id-conflict`, `paths-normalized`, `unplanned-tc`) — each is a fact to
   resolve, never to paper over.

3. **Your judgements — one validated file, never a hand edit of the run file.** Write `{results_root}/artifacts/
   judgements-phase-{N}.json` and pass it to `finalize --judgements` (or `run-data.mjs judge --run-file {draft run file}
   --judgements … --write`): each FAIL's `classification` (the `<first_run>` catalogue), `root_cause`, `severity`,
   `assumption`; every `parallel_checks[]` `cause` / `resolution`; every watchdog / timeout event's classification; the
   complete `heal_log[]` (the nine columns of `automation-rules.md` §5), `deviations[]`, `skips[]`,
   `unverified_assumptions[]` and `bugs[]` (`req_id` filled from the result row). The set is validated as a whole —
   unknown TC, a value outside its vocabulary, a FAIL left unclassified, a duplicate or contradictory entry → rejected,
   nothing written; fix it and pass it again. The merge keeps these fields on every later merge. Shape:
   `references/schemas/script-payloads.md` *Inputs*.

4. **The phase section, the bug file and the page — DRAFTS, published only after Checkpoint B** (`<publication>`):
   - the draft `TEST-RUN-REPORT-{feature}.md` is WRITTEN BY THE SCRIPT (`run-data.mjs report --write`, inside
     `finalize`): header lines, ONE run-history row, and the `## Phase {N}` section in the frozen order — Run (your extra
     bullets such as `Run command` or a `Reviewer comment` are kept), Stages + smoke gate, Run plan, Coverage, Results,
     and the sub-sections rendered from your judgements (Unverified assumptions, Bugs, Heal log, Skips, Open questions,
     Test-data readiness, retained / in-doubt records, Deviations). **Earlier phase sections are never touched.** Never
     paste fragments or rebuild a table by hand or by a script of your own.
   - the draft `BUG-REPORT-{feature}.md`: after `run-data.mjs draft-init` (or a first `finalize`, which creates the drafts)
     write one `### BUG-n` entry in `<bug_report_format>` per NEW `app_bug` of this phase (`Found in phase: N`, `Status:
     open`, the failure image as a relative link — under `delivery.screenshots: none` there is none: the `Screenshot` field
     reads `none captured (screenshots: none this run)`); for every existing bug whose TC ran, a History line and its Status — the
     rules of run-report.md §5 (`resolved (phase N)` only after a passing retest; ids continue across this skill and 5b).
     `finalize` refuses while a bug of `bugs[]` has no entry, keeps the narratives as written and recomputes only the
     `**Latest phase:**` and `**Bugs:**` header lines. No bug yet → it writes the file with `## Bugs` / `none`. Never
     entered: unverified-assumption failures, `rate_limited` TCs, parallel interference (a `### Deviations` bullet).
   - **Reviewer comments** (`REVIEW-COMMENTS-{feature}.md` beside the report, or pasted in chat): read every open entry
     (`General`, `BUG-{n}`, `phase-{N}`) and every `- **Reviewer comment:**` bullet (bug file, a phase's `### Run`); handle
     each per run-report.md §9b — act under this skill's rules (a run request is a new phase, a question gets an answer,
     "not a bug" is weighed against the requirement, a TC change is `answered` with the route to skill 3 `--revision`),
     then set only its Status + one-line Response. A comment never changes a bug's Status. "read my comments" alone runs
     this bullet and the render.
   - The HTML is never hand-written; act on the renderer's payload (run-report.md §2), never on the HTML. Under
     `delivery.report: md` no page is written at all — the renderer's payload is still the check.
</second_run>

<publication>
**Drafts → freeze → review → gate → publish — ONE command, `run-data.mjs finalize`, called twice.** The phase's report
set exists as drafts until Checkpoint B passed on exactly those bytes; nothing a reader sees ever claims a B verdict the
gate did not give. A per-phase lock (`artifacts/checks/finalize-phase-{N}.lock`) keeps two finalizers apart; it is never
broken while its owner lives.
1. **Draft, number, write, freeze** (exit 4 `AWAITING_REVIEW` is the expected outcome):
   ```text
   node .claude/skills/link-qc-5-test-run-automation/scripts/run-data.mjs finalize --results-root {results_root} --phase {N} --feature {feature} --root . --files {final in-scope files} --tc {source_tc_doc} --data {TEST-DATA md} --req {REQ files} --inventory {reports_folder}/automation-inventory.md --require-steps --judgements {results_root}/artifacts/judgements-phase-{N}.json [--member-reviews {json}] [--lint]
   ```
   In order, stopping at the first failure: `draft-init` (only when the drafts are absent) → `merge --write` → `judge`
   → the results-freshness check into the draft run file → the pre-gate acceptance → `report --write` → the bug-file
   header → the draft page (the renderer gate must PASS; a MISMATCH / BLOCKED stops with its `mismatches[]`) → Checkpoint B
   (`check.mjs checkpoint --checkpoint B`: snapshot = the freeze, mechanical, runtime) → `AWAITING_REVIEW` with
   `semantic-B.template.json`. The renderer's harness still runs once per installed skill version (`check.mjs harness
   --name selftest-run-report.mjs`, cached); a failing harness → the markdown is delivered, the page is not.
2. **Review → gate → publish:**
   ```text
   node .claude/skills/link-qc-5-test-run-automation/scripts/run-data.mjs finalize {the same arguments} --review {results_root}/artifacts/checks/{snapshotId}/semantic-B.json
   ```
   On the FROZEN drafts only — nothing is regenerated; any change since the freeze (a draft, the code, the freshness) →
   BLOCKED, re-freeze with step 1. The validated batch → gate B → only on PASS `publish`: the drafts covered by THAT gate
   (its snapshot, its frozen hashes) promoted byte for byte, the page rendered from them + the gate record and reproduced
   byte for byte, rollback on any mismatch → the final acceptance (`<run_acceptance>`). Exit 0 `PUBLISHED`; anything else
   publishes nothing. A hand-edited published page is never overwritten (`publish --force` only after telling the user
   what will be lost).
   **Markdown only** (`{run_file}.delivery.report: md`, `intake.md` item 4): both calls still run the renderer's gate
   on the drafts (a MISMATCH / BLOCKED stops exactly as above), but no draft page is written or frozen and `publish`
   writes no page (`page: null`, `reportFormat: md`); the deliverable is the markdown. An earlier phase's page is left
   untouched (`stalePage` in the payload) — say once in the final message that it does not show this phase.
3. **Close-out** — the Azure DevOps close-out under `linked` (after B PASS), the learning write-back, then
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
`playwright.config.ts` must set `screenshot: 'only-on-failure'` for one to be captured. Under the run's
`screenshots: none` choice the field reads `none captured (screenshots: none this run)`.
</bug_report_format>
