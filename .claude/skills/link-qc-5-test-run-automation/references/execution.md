# Running the tests — environment gate, stage-based progress, staged execution, the first run

Loaded by `SKILL.md` at **Running Smoke Tests (first run)** — PHASE 3. The re-run
(`<second_run>`, `final-run.md`) reuses `<live_progress>` and `<staged_execution>` from here.

## PHASE 3 — FIRST RUN (IMPROVE)

<environment_gate>
**Checkpoint A gate first:** `<checkpoint_a>` must be recorded for this scope, and only the
scope whose applicable pre-run checks passed may execute. Tests left BLOCKED are isolated and
reported against the original scope — the run continues for everything independent of them.
**Coverage gate second:** the PHASE 2.5 verdict must be `PASS`, `report-only`, or a recorded
user override — otherwise do not execute (see `<coverage_measurement>`).
**Readiness gate third:** the PHASE 2.6 verdict must be `READY` or `READY-WITH-SKIPS` — every
predicted skip carries a QC decision or the pipeline default (see `<data_readiness>`). Test
data is NOT re-checked here as a whole-run condition; it was settled per requirement in 2.6.

Before executing: grep `Testing/project-learning.md` for `[type: env]` lines first — known
environment quirks, VPN/proxy notes, slicing thresholds and past fixes are applied before
diagnosing anything anew. Then confirm the app/base URL responds and required services are
healthy. Any check fails → **ENVIRONMENT_BLOCKED**
(name the unhealthy dependency; action for ops/human — NOT a code defect).
Do not execute. Every environment
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
Before the first run confirm, and add when missing (noted in the Placement Manifest): the shared
config's `screenshot: 'only-on-failure'` + `trace: 'retain-on-failure'` (code-craft §8),
`helpers/progress-reporter.ts` in its reporter list and `helpers/steps.ts` (both copied from `assets/`),
and the evidence helper called at every test's assertion point (`<result_organization>`) with
`{screenshots_root}/phase-{N}/` writable. Never delete anything under `{screenshots_root}`.

**Long runs exhaust Windows resources.** A large headed suite accumulates browser processes (more
workers make it worse) until a worker dies with `worker process exited unexpectedly (code=3221225794)` —
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

**Labels:** `SKILL.md` *Progress and messages* (the report keeps `## Phase {N}` — the renderer and skills
5b / 7-9 parse it).

**Chat messages — exactly these:**
1. **Run start** — one message, in the same turn that launches the first stage: the run plan (groups,
   TC counts, workers, the paced services of `rate_limits[]`, planned vs serial-only estimate), the
   initial timeout values and the
   progress-log path to tail (`Get-Content -Wait <path>` on Windows).
2. **After Smoke** — the payload's `update` (counts, failures, blockers, the smoke-gate line, the
   isolation-check line and the rate-limit line when they apply), plus the gate decision when the
   gate asks for classification (`<staged_execution>` step 2). Setup journeys are reported inside it.
3. **After Positive** — `update` (this stage + "Phase so far"), plus any confirmed issue or blocker.
4. **After Negative** — `update` (this stage + the "Phase totals": Passed / Failed / Incomplete /
   Skipped / Not run, the evidence folder), plus defects (their classification where already known,
   otherwise "to be classified"), blockers and compliance status (Checkpoint A recorded; Checkpoint B
   on the final code).

Cumulative counts are **phase-wide**: every stage summary of the phase ordered by start time, the
latest attempt per TC. A re-run message gives the re-run subset and the phase totals — "Positive
tests completed (re-run): 3 re-run → 3 passed. Phase totals: 27 passed, 3 failed of 30." The
isolation-check line reads like "Isolation check: 2 failed beside other tests → 1 passed alone
(parallel interference, moved to serial), 1 confirmed"; the rate-limit line like "Rate limits:
login refused 3× (Retry-After 30 s) → cool-down 30 s, workers 2 → 1 for the rest of the stage".
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
tool call. A smoke retry, a re-queue and the isolation check report inside their stage's message
(`--label`); the re-run has its own stage messages, labelled "re-run".

**The progress log.** `run-stage.mjs` writes the execution entries (each command's start / stop / end,
the line output, a 30 s status line with counts, current TC, elapsed, the estimate and the watchdog
verdict); you append the activity entries (time · activity · status).

**Playwright execution mechanics — every test command of a run goes through `scripts/run-stage.mjs`:**
- **One call per stage of a pass** — `setup` · `smoke` · `positive` · `negative`, each with
  `--run first | rerun` (`--run final` is refused — the re-run is `--run rerun --tcs …`) — started as ONE
  **background** command; wait for its completion notice. Never poll it and never read the log while
  it runs. Where the session cannot receive a completion notice (pipeline mode), run each group as its
  own foreground call (`--groups`) with a tool timeout above that group's ceiling + `--cooldown-max` +
  the isolation commands' ceilings (a burn-in command's ceiling is × 3).
  ```text
  node .claude/skills/link-qc-5-test-run-automation/scripts/run-stage.mjs --run-file {run_file} --stage {stage} --run first|rerun
    --stage-tcs {the approved document's TCs of this stage} --ceilings {group}={ms},… --grace {TIMEOUTS.watchdog_grace}
    --log {progress_log} --project {browser_project} --cwd {automation_root} --spec {this story's spec files}
    [--groups …] [--tcs …] [--burn-in {healed TCs}] [--extra repeat-each=N|last-failed|workers=N]
    [--cooldown {TIMEOUTS.rate_limit.cooldown}] [--cooldown-max {TIMEOUTS.rate_limit.cooldown_max}]
    [--label "…"] [--headless] [--cmd "{run_command}"] [--stage-json-source {the config's own JSON outputFile}]
  ```
  `--burn-in` runs those tests in their own command per group (workers 1, `--repeat-each=3`, ceiling
  × 3; any failing repeat = FAIL). Pass `--cooldown` / `--cooldown-max` from `timeouts.ts`. `--cmd` only
  when `{run_command}` is not plain Playwright.
- **What the script does per command** (never by hand): the run-plan groups of the stage in plan order
  (parallel ×`{workers_parallel}`, then each serial group ×1; a group without TCs of the stage is
  skipped and logged), `run_plan_adjustments[]` applied first; ONE lookahead `--grep` per command,
  `--grep-invert @smoke` for positive / negative, the next free attempt, the `PW_*` environment
  (code-craft §8), the code fingerprint at call start and end (a test changed during the call is
  stale) and the line output teed into the progress log with credential-looking lines withheld.
  `--reporter`, `--config` and `--retries` are refused before anything starts.
- **Watchdog — inside the script, never by you.** You compute each group's outer ceiling and pass it in
  `--ceilings`: (Σ test budgets of the group ÷ its workers) + hook budgets + one teardown budget, × 1.2,
  + the pacing floor ⌈calls ÷ pace⌉ × window per limited service the group calls (`<run_plan>`; values
  from `timeouts.ts`). The script scales it when it lowers workers or adds a cool-down, kills a command
  Playwright did not stop by ceiling + margin (`STOPPED_CEILING`), and stops a command only on a
  `watchdog.mjs` `FROZEN` verdict — an open step past its OWN deadline + grace with no progress, no
  newer worker record and no newer result; console silence or an unchanged stage JSON never count
  (`STOPPED_FROZEN`). On a stop: `completed[]` keeps every real status, `interrupted[]` are `INCOMPLETE`
  (`collateral` for other workers' in-flight tests), `not_started[]` are `NOT_RUN`; `requeue[]` lists
  them — `no_verdict[]` for `impact.mjs select`, run again ONCE after the heal in the re-run (or in a
  smoke retry `--tcs {requeue}` when the gate needs them). The event is `timeout_failure`, never
  `app_bug`, and goes to the Heal Log and the Timeout policy section with the trace path.
  `flags.watchdogTrusted: false` → freeze stops were disabled; every stop is recorded `unresolved`.
- **Isolation check — automatic, inside every call (first run and re-run), never by you.** It is a
  classification step, not a retry: `retries` stays `0`, and the parallel attempt stays in the
  history and the report.
  - *Trigger:* a TC that **FAILED** in a command with workers > 1, or a FAIL with a refusal (429, 503
    + `Retry-After`) inside its failing step. A TC that passed while it saw an expected 429 stays PASS.
    It runs alone (workers 1, its own attempt) after the stage's commands and the cool-down; an isolation
    command's ceiling = group ceiling × max(1, k·w ÷ n) (k TCs alone, w the group's workers, n its TCs).
  - *Outcomes:* alone PASS → **PASS, recorded as parallel interference** (below); alone FAIL →
    confirmed, classified as usual (`<first_run>` step 2); alone FAIL with a refusal inside the
    failing step's time window, or a `RateLimitWaitError` → **`rate_limited`** (mechanical, no
    model judgement): Status `INCOMPLETE`, no verdict, never FAIL, never a bug, never healed, in the
    re-run set.
  - *Parallel interference* (not a classification): the TC is PASS + a `### Deviations` bullet for
    the human (shared-data interference or a possible application concurrency defect) + a
    `parallel_checks[]` entry; it leaves the parallel group for the rest of the run (`@run:` tag
    change + a `run_plan_adjustments[]` move, `<run_plan>`) and a learning-file `[type: env]` line is
    written. **False-PASS guard:** the tests that overlapped it in time (from the heartbeat) are run
    alone too.
  - *Breaker:* more than max(3, 30 % of the tests that ran beside others) failed → no isolation
    check; the payload flags it and you classify (environment / smoke-gate logic).
- **Refusals change the rest of the stage, never a status.** After a command whose tests were
  refused by the application's rate limit, the stage's later commands start after the cool-down
  with workers = max(1, ⌊workers ÷ 2⌋) and a scaled ceiling (payload `rateLimit.adjustments[]`).
  Between stages you append the matching `run_plan_adjustments[]` entry (append-only) and write the
  learned limit back as a plain `[type: env]` line. A limit learned this way changes only the run
  plan (`PW_RATE_LIMITS`), never code — it never makes a TC stale.
- **Per-stage freshness gate — after EVERY command, applied by the script.** Each command's stage JSON
  (or, for a stopped command, its `*.watchdog.json`) must be newer than the command's start. Missing or
  stale → `FRESHNESS_FAILED`, the stage's later groups `NOT_RUN` → **STOP the run**: log it, fix the
  reporting (a `--reporter` flag, a stray `--config`, a wrong `outputFile`, a reporter override in the
  shared config), run that stage's call again (same `--run`), then continue. Never build phase sections
  from a stale or absent file, never hand-assemble results from the line output. "No tests found" for
  a planned group is not a freshness failure: its TCs are `NOT_RUN` "no test matched the stage filter"
  — fix the tags.
- **Reading the payload** (compact; the full record is `summaryFile`): `outcome` (`COMPLETED` ·
  `STOPPED_FROZEN` · `STOPPED_CEILING` · `FRESHNESS_FAILED` · `SPAWN_FAILED` · `BLOCKED`), provisional
  TC `counts` (phase-wide), `executed{}` (what this call ran, per TC), `failures[]` (the latest
  attempt's failures: TC, title, first error line, screenshot, unverified-assumption flag),
  `notRun[]` with reasons, `smokeGate` (`failPct`, `decision: continue | classify` — over the smoke
  TCs with a verdict, computed after the isolation check; none → `classify`, "no smoke verdict"),
  `groups[]` (each with `command`: `normal` | `isolation` | `burn-in`), `code{}` (per-TC
  fingerprints at call start and end, `changed_during_call[]`), `isolation {ran, passed_alone,
  failed_alone, rate_limited, overlap_rerun, skipped, cooldown_ms}`, `interference[]`, `rateLimit
  {refused, services[], policies[], cooldowns_ms[], adjustments[]}`, `requeue[]`, `blockers[]`,
  `flags` (`watchdogTrusted`, `watchdogUnreadable`, `windowsDllInitCrash`, the isolation breaker)
  and `update`. The summary file adds the ready `merged_stages[]`, `watchdog_events[]` and
  `timeout_events[]` for `{run_file}`. Provisional counts are progress, not the results of record —
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
Test-data readiness, never counted against the smoke gate. In the re-run, the setup group of every
re-run `serial:{gap}` TC runs again first (`--run rerun --stage setup --groups setup:{gap}`) — its
data was deleted after the group.

Inside every stage the `<run_plan>` groups run parallel first, then each serial group, browser visible,
from the shared `playwright.config.ts` with `--project={browser_project}` — the script builds every
command (`<live_progress>`) and applies the freshness gate after each one. A TC runs once per stage
pass; further executions happen only as the isolation check, a smoke retry, the re-run or the burn-in —
each a new attempt, the earlier kept. Suites beyond ~40 tests are sliced (`<environment_gate>`;
`--groups` / `--tcs`).

1. **Smoke stage** — `--stage smoke` runs ONLY `@smoke`-tagged tests (parallel group, then serial
   groups as above); then post its message (`<live_progress>`).
2. **Smoke gate** — phase-wide, after the isolation check: `fail% = failed / smoke TCs with a
   verdict` (PASS or FAIL of the latest attempt; `rate_limited`, interrupted and NOT_RUN TCs have
   none). The payload's `smokeGate.failPct` says `continue` up to 30 % and `classify` above — and
   `classify` with "no smoke verdict" when no smoke TC has one:
   - **fail% ≤ 30%** → proceed to the positive stage (the failures are still
     classified and handled by the normal rules).
   - **fail% > 30%** → classify EVERY smoke failure first (the PHASE 3
     classification table; VPN/proxy/tunnel errors are `environment_failure`).
     **`unverified_assumption` failures are EXCLUDED from the majority math entirely** —
     counted and reported on their own, never on either side: a PHASE 2.4 guess that turned out
     wrong must never stop the run or look like an application defect.
     - **Majority automation/env** (`selector_failure` + `assertion_failure` +
       `environment_failure` + `timeout_failure` + `rate_limited` outnumber `app_bug`; a
       `rate_limited` TC counts on this environment side) → fix the automation via the normal
       self-heal rules (env/VPN issues → fix the environment or ENVIRONMENT_BLOCKED), then run a
       **smoke retry** of only the stale + failed smoke TCs (stale from `impact.mjs select`):
       `--run first --stage smoke --tcs {…} --label "smoke retry"`. Maximum **2 smoke retry
       cycles**; still failing after that → honest stop, reported as-is (loads as for the STOP below).
     - **Majority `app_bug`** → **STOP THE RUN**: no positive or negative stage. Go straight to
       Preparing Final Report — load `final-run.md` (steps 2-4, `<bug_report_format>`), `run-report.md`
       and `structured-returns.md` now — and still complete `{run_file}` (`status: stopped-smoke-gate`),
       append the phase section (`**Outcome:** SMOKE GATE FAILED`), record every smoke failure in
       `{bug_report_md}` in full `<bug_report_format>`, list every positive/negative TC `NOT_RUN` —
       `smoke gate failed (application errors)` — and render (the page shows the banner). State the gate
       result in the ADO summary comment and the final chat summary. A STOP in the re-run:
       `<second_run>` step 1.6 (fresh first-run results stand).
3. **Positive stage** — `--stage positive`: `@positive` with `--grep-invert "@smoke"` (smoke tests
   already ran in this pass) — parallel group, then serial groups; then its cumulative message.
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
   `{results_root}/artifacts/stages/` and `artifacts/progress/` (both emptied — attempt numbers,
   stage summaries, the `*.ratelimit.jsonl` records and the phase-wide `rate-limit.state.json` are
   per phase) and `{screenshots_root}/phase-{N}/`) and
   `<automation_logs>` (create this run's progress log, announce its path). Write
   `{run_file}.run_plan` (incl. `required_variants` and `rate_limits[]`) and `{run_file}.timeouts.initial` (every
   value of `timeouts.ts` with the project facts that shaped it, and `playwright_version`);
   post the run-plan summary (groups, TC counts, workers, planned vs serial-only estimate) and
   the initial timeout values in the run-start message (`<live_progress>` message 1).
1. Execute every stage through `scripts/run-stage.mjs --run first` — one background call and one
   message per stage, in `<staged_execution>` order (`<live_progress>`). On a ceiling or watchdog stop
   completed results are kept, interrupted and not-started TCs named, and the run reports completed vs
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
   | `evidence_failure` | Test passed but its `attempt-{a}.png` shows a post-cleanup / post-navigation screen instead of the verified state (the `captureEvidence` call sits after teardown, after a delete, or after leaving the page) | SELF-HEAL: move the call to the assertion point; the re-run executes the TC again (a new attempt — the earlier image stays); never an app_bug |
   | `unverified_assumption` | The test is tagged `@unverified-assumption` (PHASE 2.4 had no user answer) and it failed — **the interpretation is suspect before the application is** | DO NOT self-heal it into passing and **NEVER reclassify it as `app_bug`**. Re-ask the user with the observed behaviour as a new candidate; answered → regenerate the test and drop the tag. Unanswered → report as-is, excluded from the smoke-gate `app_bug` majority, never filed as a bug |
   | `rate_limited` | Set by the isolation check, never by you: refused by the application's rate limit (a refusal the network guard recorded inside the failing step, or a `RateLimitWaitError`) and still refused when run alone after the cool-down | Status `INCOMPLETE` — no verdict, never FAIL, never a bug, never healed; in the re-run set; on the environment side of the smoke-gate majority. Record the limit (`rate_limit{}`, a `[type: env]` line) so the run plan paces it next time |

   **Parallel interference is not a classification:** a TC that failed beside other tests and
   passed alone is PASS (the isolation check, `<live_progress>`); its Deviation, `parallel_checks[]`
   entry, group move and learning line are written, and the human decides whether it is shared data
   or an application concurrency defect.

2b. **Timeout calibration — once, after the first run, from evidence.** List every
   `timeout_failure` and watchdog event (`{run_file}.timeouts.events[]`: TC-ID, step, elapsed,
   deadline, expected condition, trace / screenshot / heartbeat path, the durations of the
   passing TCs for the same operation). For each: the trace shows the operation completing
   legitimately after the deadline → raise the named key (`test.long`, `step.long`, a new
   `operations.{name}`) in `timeouts.ts` — never inline, never a global bump — and record
   `{key, from, to, reason, evidence}` under `{run_file}.timeouts.adjusted[]`, in the Heal Log
   (`timeout_failure`; Reason = the evidence path; Approved-requirement reference `n/a — no expected value
   changed`) and in the report's Timeout policy
   section. Anything else is healed as its real class. Teardown that timed out marks the TC
   `cleanup_incomplete` and runs the orphan sweep by `runPrefix` before the next stage. Values
   that did not change are stated as confirmed. **NOT_RUN** when no first run happened in this
   invocation (say so).
3. **Self-heal ONLY test-code defects** (`selector_failure`, `assertion_failure`, `evidence_failure`):
   - diagnose from the retained trace (its command's `outputDir`), the error line and the source; when they cannot decide, one
     `<scratch_investigation>` probe (`references/scratch-investigation.md`) — a diagnosis, never a verdict
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
4. **No separate heal-check call.** Healed tests are confirmed by the re-run with `--burn-in`
   (`<second_run>` step 1); a failure seen beside other tests is reproduced by the automatic isolation
   check; one seen only after another test through `run-stage.mjs --tcs {the pair}` (code-craft §13) —
   never outside `run-stage.mjs`. Maximum **2 heal iterations**; whatever still fails for test-code
   reasons after that is reported honestly as-is.
5. Keep a **Heal Log** — one row per repair, the nine columns of `references/automation-rules.md` §5
   (`n/a` with a reason is a value, a blank is not); the approved-requirement reference is required for
   any assertion or expected-value change.
6. Every `automation_failure` or `environment_failure` heal that would help the next run
   (a wait that works, an element identified differently, an environment quirk) becomes one
   plain-English tagged line under `## Automation Tricks` in `Testing/project-learning.md`.
   `app_bug` findings are NOT written there — they belong in the bug report.
</first_run>
