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
diagnosing anything anew. Then ONE preflight call answers the rest — never a process listing, a memory probe, a
hand-made URL check or a trial browser launch of your own:
```text
node .claude/skills/link-qc-5-test-run-automation/scripts/run-stage.mjs preflight --run-file {run_file} --cwd {automation_root} --env-id {env_id} --probe-url {E1 URL}
```
It returns `verdict` (`ready` · `restricted` · `blocked`) with its reason, `environment {status, ms}` (one bounded GET, no
credentials), `lease`, `capacity {ceiling, source, free, used, availableMb, admissibleNow}`, `workers {start, max, why}`,
`coordination`, `display`, `playwright {cli, version}` and `config {shared, source}` (detail:
`artifacts/progress/preflight.json`). `blocked` with an unreachable / 5xx environment → **ENVIRONMENT_BLOCKED** (name the
dependency; action for ops — NOT a code defect); any other `blocked` (no Playwright CLI, no safe coordination, insufficient
capacity, a lease held elsewhere) → BLOCKED with that reason. `restricted` runs, and its reasons go into the run-start
message (exclusive execution, headless, no free slot or no admissible worker right now — the stage then waits, bounded by
`--max-wait`, never forced). Do not execute on `blocked`. Every environment fact learned or fixed in this gate is written
back as a plain-English `[type: env]` line under `## Automation Tricks`.

**The browser must be visible.** `{headed}` is true by default; the runner decides it (`display` in the preflight and every
stage payload): no graphical desktop or CI → headless for the run, said in the chat at once and listed under Deviations —
never silently headless when the user expects to watch. A Chrome that will not start surfaces in the first stage as an
`environment_failure` with its output in `artifacts/diagnostics/`.

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
report failed/not-run with no verdict. The dispatcher already runs the pool in batches and halves its workers on
such a crash (`<parallel_readiness>`); classify any `0xC0000142` cascade explicitly as environmental. Only if it
recurs, slice by hand (`--groups` / `--tcs`; a slice never cuts through a serial group or a unit) with
`--extra workers=1` for the rest of the run and record the count that worked in the learning file. The capacity
ledger (`<capacity_and_lease>`) already keeps every command inside the Auto ceiling and the host's free memory, so
this is the exception, not the routine.
</environment_gate>

<capacity_and_lease>
**Capacity, host pressure and the environment lease — enforced by `run-stage.mjs`, never by you.**
- **The ledger (default on).** Every command reserves its full `--workers` in the machine-wide capacity ledger
  (`scripts/capacity.mjs`, `{QA_CAPACITY_DIR | ~/.link-ai-pro/capacity}/ledger.json`) BEFORE it is spawned —
  through `scripts/ledger-exec.mjs`, which registers its own process at once — and releases them only when its
  whole process tree is confirmed gone on a FRESH process table — browsers included, also one that outlived its
  command (detached, re-parented, its parent ended): it holds the slots until it ends or run-stage stops it (only
  what the table shows with its recorded identity); a stale heartbeat or a missing table never releases a slot. The ceiling is AUTO
  (`<run_plan>`: host memory / CPU, headed demand, bounded by `config.json machineMaxWorkers`); every run on the
  machine shares ONE recorded value that a run may lower but never raise while anything else runs. A command is
  lowered to it — and further when the host's free memory / CPU after a reserve admits fewer — never raised, each
  lowering in the payload's `ledger.lowered[]`. Runs of other stories, projects or skill 9 on this machine share
  the same ledger: a command that cannot be admitted waits up to `--max-wait` (10 min), then its TCs — and the
  rest of the stage — are `NOT_RUN` `not started: admission timeout ({reason})` / `not started: host pressure`.
- **Low memory never forces execution and never switches coordination off.** A host whose total memory / cores can
  never hold one worker of the stage's kind beside its reserve → the stage is BLOCKED before any side effect (`insufficient
  capacity`); a host short only right now → commands wait for admission (bounded), in every mode — exclusive execution
  admits on the host's memory too.
- **Host pressure.** A 2 s sampler (memory below the reserve, CPU ≥ 90 % for 30 s, event-loop lag) publishes
  `paused` to the stage's admission file (`artifacts/progress/admission.json`) within a second: no new command
  is spawned and — in projects with `helpers/admission.ts` — no new test starts its side effects; running tests
  always finish. Admissions resume after 60 s of recovery. Each episode is in `pressure.episodes[]`.
- **The environment lease.** Acquired at intake (`intake.md`), passed as `--env-id {env_id}`; exclusive per
  OVERLAPPING environment — another run's lease that shares a host name or resolved address holds it, whatever the
  ids (two stories listing different subsets or aliases of one application never run side by side). A run whose lease
  is not held (another run took it, or it was never acquired) starts nothing — every TC `NOT_RUN` `not started:
  environment lease ({reason})`, outcome `BLOCKED`. With the lease the rate-limit book is shared per environment
  GROUP across runs — overlapping identities (another id, a shared name or address) pace against ONE book (the lease's
  `bookId`), so a server deadline learned under one id holds every later run of the same application. Without `--env-id` the payload warns that the environment is not coordinated.
- **Ledger off is never "uncoordinated"** (`--no-ledger`, `QA_LEDGER=off` — the rollback switch — or no
  process listing on this machine; the payload's `ledger.mode` says `exclusive` and why): every command then
  runs under an EXCLUSIVE reservation in the same ledger file — it waits until no other Playwright command
  (another run, the playwright-cli browsers of skills 3c / 5b / 9, a probe) is live on the machine, and nothing else
  starts while it runs; its workers stay at or below the ceiling. Ownership stays on: the command runs under
  `ledger-exec.mjs` and its reservation is released only when a fresh table confirms its tree ended. When no table
  can be read the finished command stays HELD (`ledger.reservations[].confirmed: none`, a warning naming its token)
  and the next command waits — `not started: admission timeout (exclusive execution: … could not be confirmed
  stopped …)` — until a table confirms it; never launched beside it. Host-pressure admission and dispatch are off,
  so the stage runs SERIALLY (scheduler `auto` → `serial`; an explicit `--scheduler dispatch` is refused). A coordination directory that is not writable, or an unreadable `ledger.json`,
  starts nothing: outcome `BLOCKED` "no safe coordination". `node .claude/skills/link-qc-5-test-run-automation/scripts/capacity.mjs
  status` shows the ledger; a crashed run's leftovers are resolved by the next sweep on a table, `node … run-stage.mjs
  reclaim` (run by the user) ends only orphaned trees the ledger recorded, and — only as the user's last resort, after
  confirming none of its processes or browsers is open — `capacity.mjs release --token {t} --force` frees one entry no
  table can confirm. You never run these yourself, and a wait is never "fixed" by a forced release.
- **What it means for the run's acceptance:** a required TC left `NOT_RUN` by an admission timeout, host
  pressure, a deferral, the lease or missing coordination makes the run NOT ACCEPTED (`<run_acceptance>`) until
  it runs.
</capacity_and_lease>

<live_progress>
**Progress is reported per finished stage, never on a timer.** During a long stage the user's live
view is the progress log (`<automation_logs>` — `scripts/run-stage.mjs` appends to it while the tests
run); the chat hears from you when a stage finishes, when something needs the user, or when a run
stops.

**Labels:** `SKILL.md` *Progress and messages* (the report keeps `## Phase {N}` — the renderer and skills
5b / 7-9 parse it).

**Chat messages — exactly these:**
1. **Run start** — one message, in the same turn that launches the first stage: the TC counts per stage, the
   paced services of `rate_limits[]`, the readiness line (`<parallel_readiness>`: units, pool, run-alone count, the
   payload's `conflicts_brief[]` one-liners, or why the run is serial), the preflight line (ceiling with its basis,
   `workers.start` ramping within it, headed or why not, the lease, any `restricted` reason), the initial timeout values,
   the progress-log path to tail (`Get-Content -Wait <path>` on Windows) and — only when this conversation already
   holds earlier work — the one fresh-session line (`SKILL.md` *Progress and messages*).
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
(parallel interference, moved to serial), 1 confirmed"; the rate-limit line like "Rate limit: POST
/api/session refused 3× (Retry-After 30 s) → service:login cool-down 30 s before serial:orders (scoped: workers
unchanged)" — workers drop only after environment-wide refusals ("cool-down 30 s, parallel-b workers 2 → 1").
The payload's `update` also carries, when they apply, the `Deferred:`, `Temporary unavailability:`,
`Interference causes:` and `Host pressure:` lines — post them as written.
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

**The progress log — concise; the detail beside it** (`references/schemas/paths-and-evidence.md` §7). `run-stage.mjs`
writes the execution entries: each command's start / stop / end and a pointer to its full output
(`artifacts/diagnostics/phase-{N}/{command}/playwright-output.log`), one line per test start (`▶ w{n} TC`), per test end
(`✓` / `✗` / `–` with its first error line) and per wait (`⏸` admission, rate limit, deferral; capacity in `status.json`),
and a 30 s status line with counts, current TC, elapsed, the estimate and the watchdog verdict; you append the activity
entries (time · activity · status). Read the diagnostics file only to diagnose a failure — never the whole log to count.

**Playwright execution mechanics — every test command of a run goes through `scripts/run-stage.mjs`:**
- **One call per stage of a pass** — `setup` · `smoke` · `positive` · `negative`, each with
  `--run first | rerun` (`--run final` is refused — the re-run is `--run rerun --tcs …`) — started as ONE
  **background** command; wait for its completion notice. Never poll it and never read the log while
  it runs. Where the session cannot receive a completion notice (pipeline mode), run each group as its
  own foreground call (`--groups`) with a tool timeout above that group's ceiling + `--cooldown-max` +
  the isolation commands' ceilings (a burn-in command's ceiling is × 3).
  ```text
  node .claude/skills/link-qc-5-test-run-automation/scripts/run-stage.mjs --run-file {run_file} --stage {stage} --run first|rerun
    --stage-tcs {the approved document's TCs of this stage} --ceilings auto --timeouts {timeout_policy}
    --log {progress_log} --project {browser_project}[,{backend_project}] --cwd {automation_root} --spec {this story's spec files} --env-id {env_id}
    --units {results_root}/artifacts/parallel-plan.json
    [--groups …] [--tcs …] [--burn-in {healed TCs}] [--extra repeat-each=N|last-failed|workers=N]
    [--cooldown {TIMEOUTS.rate_limit.cooldown}] [--cooldown-max {TIMEOUTS.rate_limit.cooldown_max}]
    [--label "…"] [--headless] [--cmd "{run_command}"] [--stage-json-source {the config's own JSON outputFile}]
  ```
  The plain command shape keeps the permission check fast: one `node` call — no `cd`, no pipe, no
  environment prefix, no `--pretty`. No worker count, scheduler, grace or timeout mode is passed: the Auto ceiling,
  the ramp, `TIMEOUTS.watchdog_grace` and the active silence rule are the defaults. `--burn-in` runs those tests in
  their own command per group (workers 1, `--repeat-each=3`, ceiling × 3; any failing repeat = FAIL). Pass
  `--cooldown` / `--cooldown-max` from `timeouts.ts`. `--cmd` only when `{run_command}` is not plain Playwright.
  `--headless` only on the user's request (CI and a machine without a desktop switch to headless by themselves,
  reported). `--ceilings {group}={ms},…` by hand is still accepted.
- **What the script does per command** (never by hand): dispatch (`<parallel_readiness>`) or, without proof of
  independence, the run-plan groups of the stage in plan order, each ×1 (a group without TCs of the stage is
  skipped and logged), `run_plan_adjustments[]` applied first; ONE lookahead `--grep` per command,
  `--grep-invert @smoke` for positive / negative, the next free attempt, the `PW_*` environment
  (code-craft §8), the code fingerprint at call start and end (a test changed during the call is
  stale) and the line output teed into the progress log with credential-looking lines withheld.
  `--reporter`, `--config` and `--retries` are refused before anything starts.
- **Watchdog — inside the script, never by you.** Each group's outer ceiling is (Σ test budgets of the
  group ÷ its workers) + one hook budget + one teardown budget, × 1.2, + the pacing floor ⌈calls ÷ pace⌉ ×
  window per limited service the group calls (`<run_plan>`; values from `timeouts.ts`; a TC whose test names
  `TIMEOUTS.test.long` gets that budget) — `--ceilings auto --timeouts {timeout_policy}` does this arithmetic
  and lists the result in `proposals[]`. The script scales it when it lowers workers or adds a cool-down, kills a command
  Playwright did not stop by ceiling + margin (`STOPPED_CEILING`), and stops a command only on a
  `watchdog.mjs` `FROZEN` verdict — an open step (nested ones included) past its OWN FIXED deadline + grace
  (progress never extends a deadline) while its worker is still in that test; console silence or an unchanged stage
  JSON never count (`STOPPED_FROZEN`). On a stop: `completed[]` keeps every real status, `interrupted[]` are `INCOMPLETE`
  (`collateral` for other workers' in-flight tests), `not_started[]` are `NOT_RUN`; `requeue[]` lists
  them — `no_verdict[]` for `impact.mjs select`, run again ONCE after the heal in the re-run (or in a
  smoke retry `--tcs {requeue}` when the gate needs them). The event is `timeout_failure`, never
  `app_bug`, and goes to the Heal Log and `{run_file}.timeouts.events[]` with the trace path.
  `flags.watchdogTrusted: false` → freeze stops were disabled; every stop is recorded `unresolved`.
  **The silence rule — ACTIVE by default** (code-craft §9): a LONG step (deadline above its silence limit) without
  MEANINGFUL progress past that limit + grace is a `STOPPED_FROZEN` with `rule: silence` — 55 s + 60 s + ≤ 5 s
  polling = within 120 s of its last meaningful progress. An open admission or server-directed rate-limit wait is
  never a UI stall; past its own budget + grace it is `rule: wait-budget`. The summary's `timeouts_shadow` keeps
  `long_deadlines[]` (step deadlines of 10 min or more) and `stalls[]` (the helper's diagnostics, bounded by
  `TIMEOUTS.diagnostics`); `--timeouts-mode shadow` (rollback only) reports instead of stopping (`would_stop[]`).
- **Isolation check — automatic, inside every call (first run and re-run), never by you.** It is a
  classification step, not a retry: `retries` stays `0`, and the parallel attempt stays in the
  history and the report.
  - *Trigger:* a TC that **FAILED** in a command that ran beside others — workers > 1, or a run that overlapped
    another command (dispatch's pool and unit children, even at workers 1) —, or a FAIL whose failing step's OWN
    request was throttled (429, or 403 / 503 with rate-limit headers — matched by the step the guard names,
    by the step's time window for older helpers). A TC that passed while it saw a 429 stays PASS; a TC
    annotated `expects-refusal` is never read as throttled; a 503 + `Retry-After` WITHOUT rate-limit headers
    is temporary unavailability, never throttling — the failure keeps its outcome and is classified normally.
    Candidates without a refusal run alone at once; refused ones after the server's deadline
    (`Retry-After` / `RateLimit-Reset` — never shortened, never capped by `--cooldown-max`; a self-chosen
    backoff without a header uses full jitter). A deadline beyond `--max-wait` DEFERS the TC: `NOT_RUN`
    `not started: deferred until {T}`, never `rate_limited` by itself. An isolation command's ceiling = group
    ceiling × max(1, k·w ÷ n) (k TCs alone, w the group's workers, n its TCs).
  - *Outcomes:* alone PASS → **PASS, recorded as parallel interference** (below); alone FAIL →
    confirmed, classified as usual (`<first_run>` step 2); alone FAIL with its own request refused again
    after the deadline → **`rate_limited`** (mechanical, no model judgement): Status `INCOMPLETE`, no
    verdict, never FAIL, never a bug, never healed, in the re-run set. A mid-step `RateLimitWaitError`
    ("wait budget exhausted (server deadline …)") is `INCOMPLETE` `interrupted: wait budget exhausted (…)`
    and a test the helpers skipped before any side effect is `NOT_RUN` `not started: deferred until …` /
    `not started: admission timeout (…)` — none of them is `rate_limited` or a failure.
  - *Parallel interference* (not a classification): the TC is PASS (the alone run is the status of record)
    + a `### Deviations` bullet + a `parallel_checks[]` entry; it leaves the parallel group for the rest of
    the run (`@run:` tag change + the `run_plan_adjustments[]` move the payload's `proposals[]` carries,
    `<run_plan>`) and a learning-file `[type: env]` line is written. **The first, parallel failure is never
    lost** — it stays in the attempt history — and the payload gives its CAUSE from evidence only
    (`interference[].cause` + `cause_evidence[]`): `test_data_conflict` (claims overlapped — dispatch units) ·
    `possible_product_concurrency_defect` (an HTTP 5xx or browser console errors in the parallel attempt and no
    claimed overlap — a bug candidate for review) · `environment` (temporary unavailability, no response, a
    host-pressure episode) · `unexplained`. You set `parallel_checks[].resolution` (`test-side: {evidence}` or
    `bug: BUG-{n}`); an unresolved `possible_product_concurrency_defect` or `unexplained` one makes the run NOT
    ACCEPTED (`<run_acceptance>`). **False-PASS guard:** the tests that overlapped it in time (from the
    heartbeats of its own command and of every command running at the time) are run alone too.
  - *Breaker:* more than max(3, 30 % of the tests that ran beside others) failed → no isolation
    check; the payload flags it and you classify (environment / smoke-gate logic).
- **Refusals cool down their SCOPE, never a status.** A refusal's scope is the narrowest the evidence allows
  (`service:{name}` for a configured limit — `account:{A-ID}` for an account-scoped one —, else
  `endpoint:{METHOD path}`; payload `rateLimit.scopes[]`). The scope's cool-down is published to the admission
  file, so in projects with `helpers/admission.ts` only the tests that touch it wait; without the helper the
  runner waits for it before the next command — workers unchanged either way. Only environment-wide refusals
  (two configured services, three unconfigured endpoints, or a record the helpers marked environment-wide)
  slow the rest of the stage the old way: cool-down, workers = max(1, ⌊workers ÷ 2⌋), a scaled ceiling
  (`rateLimit.adjustments[]`, scope `environment`). Between stages you append the payload's `proposals[]`
  entries you accept to `run_plan_adjustments[]` (append-only) and write a learned limit back as a plain
  `[type: env]` line. A limit learned this way changes only the run plan (`PW_RATE_LIMITS`), never code — it
  never makes a TC stale.
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
  `notRun[]` with reasons, `smokeGate` (`failPct`, `eligible`, `decision: continue | classify | no_verdict`,
  `verdict: PASS | ABOVE_LIMIT | NO VERDICT` — over the smoke TCs whose latest attempt is PASS or FAIL, computed
  after the isolation check), `deferred[]`, `proposals[]` (ready `run_plan_adjustments[]` entries: moves,
  learned limits, environment-wide worker changes, the auto ceilings), `scheduler` (`used`: dispatch | serial |
  groups, `fallback`, `replanned`), `ledger` (incl. the Auto `ceiling`, `source`, `headed`) / `lease` / `pressure`,
  `dispatch` (when dispatched: units, pool, timeline, `validatedWorkers`), `timeoutsShadow`,
  `groups[]` (each with `command`: `normal` | `isolation` | `burn-in`), `code{}` (per-TC
  fingerprints at call start and end, `changed_during_call[]`), `isolation {ran, passed_alone,
  failed_alone, rate_limited, overlap_rerun, skipped, cooldown_ms}`, `interference[]`, `rateLimit
  {refused, services[], policies[], cooldowns_ms[], adjustments[]}`, `requeue[]`, `blockers[]`,
  `flags` (`watchdogTrusted`, `watchdogUnreadable`, `windowsDllInitCrash`, the isolation breaker)
  and `update`. The summary file adds the ready `merged_stages[]`, `watchdog_events[]` and
  `timeout_events[]` for `{run_file}`, `host` (the ledger sampler's minimum free memory / peak CPU — the one host
  sampler of the call) and `status` (`artifacts/progress/status.json`: the Auto ceiling, the active workers and the
  TCs each is running, rewritten — with one progress-log line — only when that changes; the user's live view of the
  visible browser windows). `telemetry` is opt-in (`--telemetry`, for a performance baseline only; it reuses the
  sampler's readings). Provisional counts are progress, not the results of record — statuses of record come from
  the merge (`<second_run>`).
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

Inside every stage the units are dispatched (pool batches beside the restricted units — `<parallel_readiness>`) or,
without proof of independence, the `<run_plan>` groups run one after another with one worker; browsers visible, from
the shared `playwright.config.ts` with `--project={browser_project}` — the script builds every command
(`<live_progress>`) and applies the freshness gate after each one. Smoke, positive and negative are barriers: a stage
starts only after the previous one ended. A TC runs once per stage pass; further executions happen only as the
isolation check, a smoke retry, the re-run or the burn-in — each a new attempt, the earlier kept.

1. **Smoke stage** — `--stage smoke` runs ONLY `@smoke`-tagged tests (the ramp's first window); then post its
   message (`<live_progress>`).
2. **Smoke gate** — phase-wide, after the isolation check: `fail% = failed / eligible smoke TCs`, eligible =
   the smoke TCs whose latest attempt is PASS or FAIL (SKIP, an expected failure, `rate_limited`, interrupted,
   deferred and NOT_RUN TCs carry no smoke verdict). The payload's `smokeGate` says `continue` up to 30 %,
   `classify` above, and **`no_verdict` (NO VERDICT) when no smoke TC is eligible**:
   - **NO VERDICT** → positive and negative do NOT start (`run-stage.mjs` refuses them while the phase's smoke
     gate has no verdict). Interactive: ONE question — fix the cause (data, environment, admission) and run a
     smoke retry, or stop. Pipeline: stop as for the STOP below, Outcome `INCOMPLETE — smoke gate NO VERDICT`.
     When the eligible results that DO exist already exceed 30 %, the run stops as below.
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
       cycles**, and each one counts as one of the phase's 2 heal iterations (`<first_run>` step 4); still
       failing after that → honest stop, reported as-is (loads as for the STOP below).
     - **Majority `app_bug`** → **STOP THE RUN**: no positive or negative stage. Go straight to
       Preparing Final Report — load `final-run.md` (steps 2-4, `<bug_report_format>`), `run-report.md`
       and `structured-returns.md` now — and still complete `{run_file}` (`status: stopped-smoke-gate`),
       append the phase section (`**Outcome:** SMOKE GATE FAILED`), record every smoke failure in
       `{bug_report_md}` in full `<bug_report_format>`, list every positive/negative TC `NOT_RUN` —
       `smoke gate failed (application errors)` — and render (the page shows the banner) — all through
       `run-data.mjs finalize` (`<publication>`), never by hand. State the gate
       result in the ADO summary comment and the final chat summary. A STOP in the re-run:
       `<second_run>` step 1.6 (fresh first-run results stand).
3. **Positive stage** — `--stage positive`: `@positive` with `--grep-invert "@smoke"` (smoke tests
   already ran in this pass); then its cumulative message.
4. **Negative stage** — `--stage negative`: `@negative` with `--grep-invert "@smoke"` — same
   order; then the run's cumulative message.
5. The merge of the stage JSONs into `{run_file}` and the report is `run-data.mjs finalize` (`<second_run>` steps
   2-4, `<publication>`) — per-stage counts, each TC's `run_group` / `run_mode` and variants, stage and group order, the
   gate outcome and planned vs actual duration come from it. Every stage planned in the run plan must have a fresh stage
   JSON — or an explicit "stage not run — smoke gate STOP" marker; otherwise STOP as in the freshness gate.
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
   | `api_contract_failure` / `db_assertion_failure` (3.0) | An `[API]` status / body assertion or a `[DB]` check failed on a correct test — the `app_bug` of a backend line (`api-db.md` `<backend_results>`); a wrong mapping or expected-value mapping is `assertion_failure` | DO NOT TOUCH THE TEST — add to bug list (the record is the evidence); the helpers' refusals (`data_write_refused`, `redirect_refused`, `evidence_invalid` …) are never bugs and never healed away |
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
   changed`) and on the return's `Timeouts:` line. Anything else is healed as its real class. Teardown that timed out marks the TC
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
   never outside `run-stage.mjs`. Maximum **2 heal iterations per phase — smoke retry cycles included** (a
   smoke retry is a heal iteration; the 2-retry limit of the smoke gate still applies on its own); whatever
   still fails for test-code reasons after that is reported honestly as-is. `run-data.mjs report` counts them
   on the `Re-run` bullet.
5. Keep a **Heal Log** — one row per repair, the nine columns of `references/automation-rules.md` §5
   (`n/a` with a reason is a value, a blank is not); the approved-requirement reference is required for
   any assertion or expected-value change.
6. Every `automation_failure` or `environment_failure` heal that would help the next run
   (a wait that works, an element identified differently, an environment quirk) becomes one
   plain-English tagged line under `## Automation Tricks` in `Testing/project-learning.md`.
   `app_bug` findings are NOT written there — they belong in the bug report.
</first_run>
