# Running the tests — environment gate, stage-based progress, staged execution, the first run

Loaded by `SKILL.md` at **Running Smoke Tests (first run)** — PHASE 3. The final run
(`<second_run>`, `final-run.md`) reuses `<live_progress>` and `<staged_execution>` from here.

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

<live_progress>
**Progress is reported per finished stage, never on a timer.** During a long stage the user's live
view is the progress log (`<automation_logs>` — `scripts/run-stage.mjs` appends to it while the tests
run); the chat hears from you when a stage finishes, when something needs the user, or when a run
stops.

**Activity names — the only progress labels the user sees** are the activities of `SKILL.md`'s
workflow table (Reviewing Requirements & Test Cases … Preparing Final Report; the test stages as
"Running Smoke Tests (first run)" / "(final run)"). Internal phase ids stay in the files, the scripts
and the run file; never show "Phase N" or "PHASE 2.6" as a label. A run is "run {N}" in prose; its
report section keeps the name `## Phase {N}` (the renderer and skills 5b / 7-9 parse it).

**Chat messages — exactly these:**
1. **Run start** — one message, in the same turn that launches the first stage: the run plan (groups,
   TC counts, workers, planned vs serial-only estimate), the initial timeout values and the
   progress-log path to tail (`Get-Content -Wait <path>` on Windows).
2. **After Smoke** — the payload's `update` (counts, failures, blockers, the smoke-gate line), plus the
   gate decision when the gate asks for classification (`<staged_execution>` step 2). Setup journeys
   are reported inside it.
3. **After Positive** — `update` (cumulative: Smoke + Positive + combined), plus any confirmed issue
   or blocker.
4. **After Negative** — `update` (the run's cumulative totals: Passed / Failed / Skipped / Not run,
   the evidence folder), plus defects (their classification where already known, otherwise "to be
   classified"), blockers and compliance status (Checkpoint A recorded; Checkpoint B on the final code).
5. **At once, on an exceptional condition** — a watchdog stop, an outer-ceiling stop, a freshness
   failure, ENVIRONMENT_BLOCKED or a smoke-gate stop: the reason and every TC left NOT_RUN /
   INCOMPLETE with its reason.
6. A question the workflow already asks (approval, open questions, coverage override, test-data
   consent, keep / clean-up) — it names its activity.
7. The structured return.

Nothing else: no message on a timer, per test, per poll or only to announce a new activity, and never
a turn of its own for progress. That holds outside test execution too — generating files,
classifying results, writing reports and updating Azure DevOps produce no counting messages. An
activity transition is one progress-log line, appended in the same turn as that activity's first
tool call. A re-run (heal cycle, re-queue, burn-in) reports inside its stage's message, labelled
(`--label`).

**The progress log.** Execution entries are written by `run-stage.mjs`: the start, stop and end of
every command, every line-reporter line, and every 30 s a status line with the activity · run group
(`parallel` / `serial:{group}`) · mode + workers (`parallel ×2, headed`) · TCs done / passed / failed
/ skipped / not run · current TC-ID(s) · stage progress % · elapsed · estimated remaining (once ≥ 3
TCs have timing data: average TC duration × TCs left ÷ the group's workers, plus the queued groups;
the serial-only figure beside it) · the watchdog verdict. Activity entries you append carry the time,
the activity and its status.

**Playwright execution mechanics — every test command of a run goes through `scripts/run-stage.mjs`:**
- **One call per stage of a run** — `setup` · `smoke` · `positive` · `negative`, each with
  `--run first | final` — started as ONE **background** command; wait for its completion notice. Never
  poll it and never read the log while it runs. Where the session cannot receive a completion notice
  (pipeline mode), run each group as its own foreground call (`--groups`) with a tool timeout above
  that group's ceiling.
  ```text
  node .claude/skills/link-qc-5-test-run-automation/scripts/run-stage.mjs --run-file {run_file} --stage {stage} --run first|final
    --stage-tcs {the approved document's TCs of this stage} --ceilings {group}={ms},… --grace {TIMEOUTS.watchdog_grace}
    --log {progress_log} --project {browser_project} --cwd {automation_root} --spec {this story's spec files}
    [--groups …] [--tcs …] [--extra repeat-each=3|last-failed|workers=1] [--label "…"] [--headless]
    [--cmd "{run_command}"] [--stage-json-source {the config's own JSON outputFile}]
  ```
  By default it runs the project's own `node_modules/@playwright/test/cli.js` without a shell (the
  regex reaches Playwright intact on every platform); `--cmd` only when `{run_command}` is not plain
  Playwright.
- **Per run-plan group of the stage, in plan order** (parallel ×`{workers_parallel}`, then each serial
  group ×1; a group without TCs of the stage is skipped and logged) it runs one command with only
  `--project`, ONE lookahead `--grep` (stage tag + `@run:{group}` with a tag-end guard, + `--tcs`),
  `--grep-invert @smoke` for positive / negative and `--workers` — **never `--reporter`, never
  `--config`** (refused before anything starts, like `--retries`) — and the environment
  `PW_STAGE_JSON`, `PW_PROGRESS_FILE`, `PW_OUTPUT_DIR` (`{results_root}/artifacts/test-output`),
  `PW_GLOBAL_TIMEOUT` (the group's ceiling), `PW_WORKERS`, `PW_PHASE`, `PW_STAGE_ATTEMPT` (the next
  free attempt — a progress file is never reused) and `PW_HEADLESS` when not headed. It records
  `stage_started_at` before each command and tees the `line` reporter's output into the progress log
  (credential-looking lines withheld).
- **Watchdog — two layers, applied inside the script every few seconds, never by you:**
  1. *Outer ceiling:* `PW_GLOBAL_TIMEOUT` per command = (Σ test budgets of the group ÷ its
     workers) + hook budgets + one teardown budget, × 1.2 (values from `timeouts.ts`) — you compute
     it per group and stage and pass it in `--ceilings`. Playwright itself stops the command at that
     ceiling; in-flight tests are `interrupted` in its own JSON. If Playwright has not stopped by
     ceiling + margin (max(60 s, 10 %)), the script kills the process tree and reconstructs the group
     with `watchdog.mjs --stop-reason "outer ceiling stop after N s"` — classified `timeout_failure`
     (`timeouts.events[].kind: ceiling`).
  2. *Freeze detection:* `scripts/watchdog.mjs` on the stage-filtered group file (`{stem}.plan.json`),
     the heartbeat and the incremental results. It declares a worker **frozen only** when an open
     step is past ITS OWN recorded deadline + grace with no `progress` record, no newer record for
     that worker and no newer result — i.e. Playwright's own timeout could not act. A quiet console,
     an unchanged stage JSON or a long-but-in-deadline step NEVER count; a worker between tests is
     judged by the outer ceiling only. `BLOCKED` (a malformed heartbeat line) is never treated as a
     freeze — the payload flags it and only the ceiling applies there. A watchdog that fails the
     script's own sanity check is not trusted: freeze stops are disabled, the payload says so, and
     every stop is recorded `unresolved`.
  On `FROZEN` the script writes `{results_root}/artifacts/progress/{stage}-{group}[-attempt{n}].watchdog.json`
  (`watchdog.mjs --write`), kills the command's process tree, logs the frozen worker, TC-ID, step,
  elapsed and expected condition, and goes on with the next group. That file's `completed[]` (from the
  incremental results the additive `helpers/progress-reporter.ts` wrote as each test finished) keeps
  every real status; `interrupted[]` (`INCOMPLETE`, reason `interrupted: watchdog at step "…" after N
  s`, other workers' in-flight tests `collateral`) and `not_started[]` (`NOT_RUN`, reason `not started:
  watchdog stop`) name every other TC of that group in this stage. The payload's `requeue[]` lists
  them: the stage / group is re-queued ONCE after the heal (`--groups {group} --tcs {requeue}`;
  completed ones are not re-run); the freeze is classified `timeout_failure`, never `app_bug`, and
  goes to the Heal Log and the Timeout policy section with the trace path.
- **Per-stage freshness gate — after EVERY stage / run-group command (first and final run):**
  `{stage_json_path}` must exist and its modified time must be later than that command's
  `stage_started_at` — or, for a command the script stopped, the
  `{stage}-{group}[-attempt{n}].watchdog.json` file must exist and be newer (it stands in for the
  stage JSON of that group, `merged.stages[].source: 'incremental+watchdog'`). The script applies it:
  missing or stale → `FRESHNESS_FAILED`, the stage's later groups NOT_RUN → **STOP the run**: write the
  failure to the progress log, fix the reporting / run step (a `--reporter` flag, a stray `--config`,
  wrong `outputFile`, a reporter override in the shared config), re-run that stage, and only then
  continue. Never build `phase sections` from a stale or absent file, never hand-assemble results
  from the line output. "No tests found" for a planned group is no freshness failure: its TCs are
  NOT_RUN with "no test matched the stage filter" — fix the tags.
- **Reading the payload** (compact; the full record is `summaryFile`): `outcome` (`COMPLETED` ·
  `STOPPED_FROZEN` · `STOPPED_CEILING` · `FRESHNESS_FAILED` · `SPAWN_FAILED` · `BLOCKED`), provisional
  TC `counts`, `failures[]` (TC, title, first error line, screenshot, unverified-assumption flag),
  `notRun[]` with reasons, `smokeGate` (`failPct`, `decision: continue | classify`), `groups[]`,
  `requeue[]`, `blockers[]`, `flags` (`watchdogTrusted`, `watchdogUnreadable`, `windowsDllInitCrash`)
  and `update`. The summary file adds the ready `merged_stages[]`, `watchdog_events[]` and
  `timeout_events[]` for `{run_file}`. Provisional counts are progress, not the result of record —
  statuses of record come from the merge (`<second_run>`).
</live_progress>

<staged_execution>
**Priority order inside every run: 0) Setup journeys → 1) Smoke → gate → 2) Positive → 3) Negative.**
Each stage is ONE `run-stage.mjs` call (`<live_progress>`); the script builds every command below.

**Stage 0 — setup groups** (only when PHASE 2.6 created `setup_groups`): `--stage setup` runs each
`00-setup-{entity}.spec.ts` alone, serially, before smoke — `@setup` and `@run:setup-{entity}` in one
regex, `--workers=1`, the group's `spec` from the run plan. A failed setup journey is
`data_missing` for every TC of its `serial:{gap}` group: those TCs are marked `SKIP` with the
gap reason and the rest of the run continues; the failure itself is reported under
Test-data readiness, never counted against the smoke gate.

**Inside every stage the `<run_plan>` groups run in this order, browser visible
(`{headed}`), always from the shared `playwright.config.ts` with `--project={browser_project}`
(never `--config`, never `--reporter`), each command with its own `PW_STAGE_JSON`,
`PW_PROGRESS_FILE`, `PW_OUTPUT_DIR` and `PW_GLOBAL_TIMEOUT`:**

```text
stage S:
  1. parallel group      → PW_STAGE_JSON=…/stages/S-parallel.json        PW_PROGRESS_FILE=…/progress/S-parallel.jsonl        --grep "(?=.*@S)(?=.*@run:parallel)"        --workers={workers_parallel}
  2. serial group A      → PW_STAGE_JSON=…/stages/S-serial-{groupA}.json PW_PROGRESS_FILE=…/progress/S-serial-{groupA}.jsonl --grep "(?=.*@S)(?=.*@run:serial-{groupA})" --workers=1
  3. serial group B …    → one command per serial group, one after another (own JSON + heartbeat each)
  (a re-run of the same stage/group — a heal, a re-queue after a stop, the final run — gets the next -attempt{n}
   on every file name and PW_STAGE_ATTEMPT={n}; … = {results_root}/artifacts; PW_OUTPUT_DIR={results_root}/artifacts/test-output
   and PW_GLOBAL_TIMEOUT per <live_progress> on every command; every tag in the regex is guarded at its end, so
   @run:serial-order never selects @run:serial-orders)
```

The stage filter is ONE lookahead regex per command, so it never depends on whether the installed
Playwright ANDs repeated `--grep` flags.

After every command: the freshness gate from `<live_progress>` (the stage JSON exists at
`{stage_json_path}` and is newer than that command's start) — STOP on failure.

A group with no TCs in that stage is skipped and logged. No TC runs twice in one phase. Suites
beyond ~40 tests are sliced per group and stage anyway (Windows resource rule in
`<environment_gate>`; `--groups` / `--tcs`), so slices never cut through a serial group.

1. **Smoke stage** — `--stage smoke` runs ONLY `@smoke`-tagged tests (parallel group, then serial
   groups as above); then post its message (`<live_progress>`).
2. **Smoke gate** — compute `fail% = failed / total smoke tests` (the payload's `smokeGate.failPct`
   counts smoke TCs; it says `continue` up to 30 % and `classify` above):
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
3. **Positive stage** — `--stage positive`: `@positive` with `--grep-invert "@smoke"` (smoke tests
   already ran; never run a TC twice in one phase) — parallel group, then serial groups; then its
   cumulative message.
4. **Negative stage** — `--stage negative`: `@negative` with `--grep-invert "@smoke"` — same group
   order; then the run's cumulative message.
5. Merge the stage JSONs into `{run_file}.merged` (per variant, per attempt — rules in
   `<second_run>`), then into the single `{run_file}` / `{run_report_html}` —
   per-stage counts preserved, each TC carrying its `run_group` / `run_mode` and its
   variants, and the report shows the stage order, the group order, the gate outcome, and
   planned vs actual duration. Before the merge, every stage planned in the run plan must
   have a fresh stage JSON — or an explicit "stage not run — smoke gate STOP" marker;
   otherwise STOP as in the freshness gate.
</staged_execution>

<first_run>
0. Initialize per `<result_organization>` (resolve `{spec_level}` + the three roots ONCE,
   state them, find the next phase N across the nested and legacy folders, create
   `{results_root}/artifacts/stages/` and `artifacts/progress/` (both emptied — attempt numbers and
   stage summaries are per phase) and `{screenshots_root}/phase-{N}/`) and
   `<automation_logs>` (create this run's progress log, announce its path). Write
   `{run_file}.run_plan` (incl. `required_variants`) and `{run_file}.timeouts.initial` (every
   value of `timeouts.ts` with the project facts that shaped it, and `playwright_version`);
   post the run-plan summary (groups, TC counts, workers, planned vs serial-only estimate) and
   the initial timeout values in the run-start message (`<live_progress>` message 1).
1. Execute every stage through `scripts/run-stage.mjs --run first` (`<live_progress>`): from the
   shared config with `--project={browser_project}` (no `--config`, no `--reporter`; the script sets
   `PW_STAGE_JSON` / `PW_PROGRESS_FILE` / `PW_OUTPUT_DIR` / `PW_GLOBAL_TIMEOUT` / `PW_PHASE` /
   `PW_STAGE_ATTEMPT` per command), following `<staged_execution>` (smoke → gate → positive →
   negative; inside each stage parallel group ×{workers_parallel}, then serial groups ×1, browser
   visible) — one background call and one message per stage; the watchdog, the outer ceiling and the
   freshness gate run inside the script. On a ceiling or watchdog stop, completed results are kept,
   interrupted and not-started TCs are named (`<live_progress>`), and the run reports completed vs
   not-executed honestly.
2. **Classify every failure:**

   | Classification | Definition | Action in this phase |
   |---|---|---|
   | `selector_failure` | Element not found by its selector — stale/wrong locator | SELF-HEAL: fix the page-object locator |
   | `assertion_failure` | Element found, assertion wrong — test-code defect (bad wait, wrong expected mapping from the TC doc) | SELF-HEAL: fix wait strategy / assertion mapping |
   | `app_bug` | Test is correct; the application violates the approved TC | DO NOT TOUCH THE TEST — add to bug list |
   | `environment_failure` | Service down, auth expired, VPN/proxy/tunnel errors | ENVIRONMENT_BLOCKED path |
   | `data_missing` | The data a TC needs is absent at run time. Requirement was `READY` / `prepared` and verified in PHASE 2.6 → environment regression (ENVIRONMENT_BLOCKED path, name the requirement). Requirement was a `skip — data_missing` / `skip — not creatable` / `skip — QC declined` decision → the TC is `SKIP` with that reason — not a failure, not healed. A preparation created it but it is gone → re-run that setup group once (seed-once still holds: find-or-create), then treat as regression | per the two cases |
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
   (leaked state → fixture / teardown) — `references/code-craft.md` §13. These re-runs go through
   `run-stage.mjs` too (`--tcs {healed TCs, or the pair}`, `--extra repeat-each=3` / `workers=1` / `last-failed`,
   `--label "heal check"`), so every command keeps its stage JSON, watchdog and freshness gate; their
   outcome is reported in the next stage message. Maximum **2 heal
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
