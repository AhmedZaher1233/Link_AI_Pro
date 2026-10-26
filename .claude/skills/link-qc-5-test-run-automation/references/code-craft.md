# Code craft — page objects, locators, specs, the shared config, timeouts and diagnostics

Loaded by `SKILL.md` at **Writing Automation Code** (from `<pom_mandatory>`, `<shared_config>`,
`<spec_writing>`, `<wait_policy>`; `<first_run>` and `<second_run>` use §9 and §13). It says HOW generated code is
written; the governance (POM boundaries, evidence, gates, traceability) stays in `SKILL.md` and its
references and is never relaxed here.

**[M] = mandatory** — a Checkpoint A / B item (`references/compliance-checkpoints.md` §2) and,
where one exists, a validator rule. **[R] = recommended** — semantic review notes a departure
with its reason; it never blocks. Every section is tagged.

---

## 1. Page-object authoring [M]

Standard Playwright POM practice applies (readonly locator fields named for what the element is, one
intent-named method per action, navigation returning the next page object). Project rules on top:

- **One shared loader / readiness wait on a base class** (`BasePage.waitForLoaderHidden()`,
  `BasePage.gotoAppPath(path)`), inherited by every page. Readiness is an OBSERVABLE condition
  (§10), never `networkidle`, never a timer.
- **Assertion methods live on the page object** (`expectSavedToast()`, `expectRowCount(n)`) and
  contain the `expect` — a deliberate departure (§15) that keeps every locator out of the spec
  (`<pom_mandatory>`). Keep it.
- **One class per logical screen**, not per URL; a screen with more than ~15 locators is split into
  components (§2). No page object provisions data through an API — that is `prerequest/` or a fixture (§6).
- **Match the project's existing style first** (file naming, constructor shape, how `page` is held).
  These rules fill gaps; they never trigger a rewrite of a working convention.
- **[M] One page class per screen across the WHOLE automation root — never a twin.** A class is created
  only from an `<automation_inventory>` `create` row whose candidates are all rejected with a reason; a
  twin is a Checkpoint A failure (validator `pom-duplicate-page`, run with `--inventory`).

## 2. Component objects [M]

A reusable widget (modal, data table, navbar, date picker, notification) is a **component object**
under `pages/components/`: its constructor takes a **scoping `Locator`** (the container), not `Page`,
so the same class serves every screen it appears on
(`readonly orders = new DataTable(this.page.getByTestId('orders-table'))`). Overlays that render at the
document root (Angular Material / CDK select panels, autocomplete, dialogs, menus) are resolved at page
level by role; only their trigger is scoped to the container.

## 3. Locator strategy [M]

Order of preference, every level scoped to a container when one exists:

1. **Source-confirmed `data-testid`** (`<selector_resolution>` — from the implementation files,
   never from memory). This stays first: it is the project's test contract.
2. **Role + accessible name**.
3. **Label / placeholder** for form controls.
4. **Visible text** for static content only — never for anything that translates unless the locale
   table drives it.
5. **Stable CSS** as the last resort, with the reason on the line above: an `id`, a `name`
   attribute, a semantic class the source shows is stable.

Never: `_ngcontent-*`, `_nghost-*`, `ng-reflect-*` (change every build), generated Material class
chains (`.mat-mdc-form-field-infix > …`), `nth-child` paths, XPath by position.

**EN/AR:** an accessible-name locator on translated text goes through the spec's locale/label
constant table; a `data-testid` needs none.

## 4. Positional selectors [M — validator `positional-unscoped`]

`first()`, `last()`, `nth(i)` are allowed only when the chain is **scoped** — a
`filter({ hasText | has })` segment, or a named container (`getByRole('table', { name })`,
`getByTestId(…)`) narrowed by a further `getBy*` — or when a comment on the line above states
why the POSITION is the requirement ("the grid lists newest first; TC-014 verifies the newest").
An unscoped `rows.first()` says nothing about which row the TC means and breaks on the next
insert. The validator warns on the unscoped form and honours the justification comment or a
`qa-allow: positional-unscoped — … (TC-…)` pragma (limit 14: scoping is judged on the receiver
chain; a locator scoped by an earlier assignment needs the comment).

## 5. Spec structure [M]

- **One `step()` per manual TC step**, titled with the manual step's wording, from
  `helpers/steps.ts` (§9 — the wrapper owns the deadline). `test.step` directly is acceptable
  in a legacy spec; new and updated specs use the wrapper. Checkpoint A runs the validator with
  `--require-steps` for those specs (rule `step-missing`, limit 13: a step inside a page-object
  method does not count for the spec).
- **Arrange → Act → `captureEvidence` → Assert → teardown.** `captureEvidence(page, testInfo)`
  is a TOP-LEVEL statement of the test body immediately before the Assert step — never inside a
  `step()` callback (the scanner would report it as conditional) and never after cleanup.
- **Tags via the details object** (`{ tag: ['@positive', '@smoke', '@run:parallel'] }`); the `[TC-ID]`
  prefix stays in the title on every version (the validator reads it there).
- **`expect.soft` only for INDEPENDENT checks of one expected result**, never across steps or past a
  failed precondition; the last assertion of the Assert step stays a hard `expect`, with the evidence
  call right before it.
- **Constants from one source** (`<pom_mandatory>`), **no helpers in specs**, **titles carry the
  `[TC-ID]`**, **suites carry the requirement ID** — unchanged.

## 6. Fixtures and `prerequest/` — how they coexist [R; M once a fixture layer exists]

- `prerequest/*PreRequest.ts` stays the **provisioning function layer**: create / find-or-create
  / delete through the API, idempotent, no UI.
- `fixtures/test.ts` (`test.extend`) MAY **wrap** those functions for guaranteed teardown, per-worker
  scope or lazy creation — the fixture calls the `prerequest` function, `use()`s the record, then deletes
  it (after the evidence image). A spec using it imports `test` / `expect` from `../../fixtures/test`
  (on the spec whitelist). Fixture bodies drive the UI only through page objects.
- **Which one?** Setup with no teardown and no lifecycle → a `prerequest` call in `beforeAll`.
  Setup that must be undone even on failure, or that several tests share per worker → a fixture
  wrapping the same `prerequest` function. Never both for the same data.
- Record the project's choice under `automation.layers.fixtures` in `Testing/qa-manifest.json`
  so the validator and the reviewer look in the right folder.
- **The admission contract [M once `helpers/admission.ts` exists — validator `admission-contract`].**
  `helpers/admission.ts` (`assets/admission.template.ts`, always installed, inert without `PW_ADMISSION_FILE`)
  holds two automatic fixtures: `workerAdmission` (worker scope, no dependencies) and `unitAdmission` (test
  scope). Playwright sets a fixture up before another only when the other DEPENDS on it, so: the project's
  fixtures file extends `helpers/admission`'s `test` (and specs import `test` / `expect` from it); every
  side-effecting worker fixture lists `workerAdmission`; every side-effecting test fixture (login, data
  creation, a `prerequest/` wrapper) lists `unitAdmission`; every side-effecting `beforeAll` takes
  `workerAdmission` as a parameter. Then no new unit of work starts its side effects while the runner says
  "wait" (host pressure, a scoped rate-limit cool-down); running units always finish. A worker not admitted within
  the bound throws `AdmissionRefusedError` instead of handing `workerAdmission` over, so its dependent worker
  fixtures and `beforeAll` hooks never run; the runner reports those tests `NOT_RUN — not started: admission
  timeout (…)`, never FAIL. A unit that breaks the
  contract is run as one indivisible unit per command (U4, `<parallel_readiness>`) — never a silent risk.

## 7. Unique test data [M]

Every record a test CREATES carries an identifier from `helpers/test-data.ts`:
`uniqueName(prefix)` → `{prefix}-p{phase}-w{parallelIndex}-r{retry}[-e{repeat}]-{4 random}`.
Two workers, a retry, a `--repeat-each` variant and a re-run of the same phase therefore never
collide, and cleanup selects by `runPrefix(prefix)` (`{prefix}-p{phase}-`). Commands that run side by side
(dispatch) get their own lane (`PW_LANE`, set per command by `run-stage.mjs`): `uniqueName()` / `uniqueCode()`
add `-l{lane}` after the phase, so two concurrent commands never collide either — `runPrefix` is unchanged. A fixed literal
(`'Order Alpha'`) is allowed only for data the TC READS and PHASE 2.6 provisioned. Teardown
deletes by the same prefix; a post-stage orphan sweep by prefix (through the `prerequest/` delete
functions) runs whenever a teardown timed out (`cleanup_incomplete`, §9).

## 8. The shared configuration [M]

One `playwright.config.ts` in `{automation_root}` for every story (`<shared_config>` owns the
consolidation procedure; `assets/playwright.config.template.ts` is the skeleton for a project
with none). Contract:

| Setting | Value |
|---|---|
| browser | project `chromium` with `channel: 'chrome'` — the project NAME stays stable: it is part of every evidence path |
| `headless` | `false` unless `PW_HEADLESS=1` — set by the runner only for `--headless`, CI or no graphical desktop (reported); every worker is its own Playwright-launched browser with a temporary profile, never a persistent / personal one |
| `workers` | decided per command by the runner (`PW_WORKERS` / `--workers`): the Auto ceiling, the dispatcher's ramp, admission; 1 whenever independence is not proven (`<parallel_readiness>`) |
| `fullyParallel` | `true`; only a true chain also gets a `mode: 'serial'` describe |
| `forbidOnly` | `!!process.env.CI` |
| `retries` | `0` — failures are classified and healed, never retried away |
| `timeout` / `expect.timeout` / `actionTimeout` / `navigationTimeout` / `globalTimeout` | from `timeouts.ts` (§9); `globalTimeout` from `PW_GLOBAL_TIMEOUT` |
| `outputDir` | `process.env.PW_OUTPUT_DIR ?? 'test-results'` |
| reporters | the project's own list + `['line']` + `['json', { outputFile: process.env.PW_STAGE_JSON ?? … }]` + `['./helpers/progress-reporter.ts']` — additive, never replaced, never `--reporter` on the CLI |
| `screenshot` / `trace` / `video` | `'only-on-failure'` / `'retain-on-failure'` / `PW_VIDEO ? 'retain-on-failure' : 'off'` — video only while investigating a freeze |
| `viewport` / `deviceScaleFactor` | `1440×900` / `1` |
| `locale` / `timezoneId` | from the env layer (`PW_LOCALE`, `PW_TZ`), defaults `en-US` / `UTC`; an `ar` project with `locale: 'ar-SA'` ONLY when the application reads the browser locale |
| `testMatch` / `baseURL` / env handling | the project's own; registering a new spec is part of PHASE 2 |

Per-run values reach the config only through environment variables set on each stage command
(`PW_STAGE_JSON`, `PW_PROGRESS_FILE`, `PW_OUTPUT_DIR`, `PW_GLOBAL_TIMEOUT`, `PW_HEADLESS`,
`PW_WORKERS`, `PW_PHASE`, `PW_STAGE_ATTEMPT`, `PW_RATE_LIMIT_FILE`, `PW_RATE_LIMIT_STATE`,
`PW_RATE_LIMITS`, and for the helpers `PW_ADMISSION_FILE`, `PW_UNIT_SCOPES`, `PW_UNIT_MAP`, `PW_LANE`,
`PW_CANCEL_FILE`, `PW_DIAGNOSTICS_DIR`, `PW_ENV_ID`). `PW_RATE_LIMIT_STATE` is the environment's SHARED
book in the coordination directory (`rate-limits/{bookId}.json` — one per group of overlapping environment identities)
when the run holds an environment lease —
no run deletes another run's state or lock. Nothing is rewritten per story, so the compliance
`scopeDigest` stays stable across stories; the digest DOES include the config's one-hop relative
imports (`timeouts.ts`, the env module) so editing the policy invalidates a recorded gate.

## 9. Timeout policy [M]

**Two different things:** the TC budget (Playwright `timeout`, includes fixtures + `beforeEach`;
teardown gets a separate budget of the same size) and the per-step deadline (`step()`,
`helpers/steps.ts`). A long TC has a large budget; a stuck step still fails within its own
deadline instead of eating that budget. `test.default ≥ 2 × step.default` is asserted by
`timeouts.ts` itself.

**Initial values** (`assets/timeouts.template.ts`, copied to `{automation_root}/timeouts.ts`):

| Key | Initial | Applies to |
|---|---|---|
| `test.default` / `test.long` | 90 s / 180 s | the TC budget; `long` via `test.setTimeout(TIMEOUTS.test.long)` with the operation named in a comment |
| `expect` | 10 s | web-first assertion retry |
| `action` / `navigation` | 15 s / 30 s | one click / fill · one goto / waitForURL |
| `hook` | 60 s | `beforeAll` / `afterAll` / provisioning fixtures (`test.setTimeout` inside the hook) |
| `step.default` / `step.long` | 30 s / 120 s | the per-step deadline |
| `operations.*` | per key | THE exception mechanism: a named KNOWN long operation — a number (its deadline) or `{ deadline, silence, reason }` (a legitimately silent server-side job); used as `step(title, body, { operation: 'name' })`; the reason beside it is mandatory |
| `watchdog_grace` | 60 s | time allowed after a step deadline for Playwright's own timeout and teardown to act |
| `rate_limit.max_start_wait` / `rate_limit.in_step_wait` | per the template | the longest start-of-test slot reservation (outside every step; the test budget is extended by the wait with `testInfo.setTimeout`) · the longest `rateLimitSlot()` wait inside a step (fits the step deadline) |
| `rate_limit.cooldown` / `rate_limit.cooldown_max` | per the template | `run-stage.mjs --cooldown` (the base of a self-chosen backoff after a refusal WITHOUT a server deadline) · `--cooldown-max` (its cap). A server deadline (`Retry-After`, `RateLimit-Reset`) is never shortened or capped |
| `stall.silence` | 55 s | the stall detector in `step()` (diagnostics + a `stall` heartbeat) and the watchdog's silence rule (ACTIVE): 55 s + 60 s grace + ≤ 5 s polling = stopped within 120 s of the last meaningful progress |
| `diagnostics` | 30 s | the whole stall-diagnostics capture, bounded on its own and never charged to the step |
| `admission.max_wait` | 600 s | the longest a new test or unit waits in the admission fixtures before it is `not started: admission timeout (…)` |

These are recommended VALUES; that they exist, are recorded in `{run_file}.timeouts` (summarised on the
return's `Timeouts:` line) and are imported from `timeouts.ts` (never inline) is mandatory. The skill states the
values it chose, the project facts that shaped them (known long operations from the learning
file, TC durations from earlier phases) and, when the installed Playwright is below 1.50, that step
deadlines are helper-enforced only.

**The `step()` wrapper** (`assets/steps.template.ts`) owns the step deadline (also the native
`test.step({ timeout })` on ≥ 1.50) and writes the heartbeat; a step timeout throws a
`StepTimeoutError` naming the TC, the step, the elapsed time and the expected condition. Teardown that
itself times out marks the TC `cleanup_incomplete` with the data prefix (§7) and triggers the post-stage
orphan sweep. The deadline is FIXED from the step's start — nothing extends it. Inside a long operation the body
reports MEANINGFUL progress — `report('rows', { done: 40, total: 100 })` or `report('uploaded', { milestone:
'upload' })` (a legacy `report('rows loaded 40/100')` counts while its counter rises): only a rising counter or a new
milestone resets the SILENCE clock; changed text, a timestamp or the same poll again never does.

**Calibration** after the first run is `<first_run>` step 2b (evidence only, never a global bump, never a
retry). **The watchdog** is `<live_progress>` — it runs inside `run-stage.mjs`, never polled.

**Smart timeouts.** `actionTimeout` / `navigationTimeout` are FINITE in every project and preset the skill
runs — `0` means "no limit" to Playwright and is how a single click waited out a 25-minute budget;
`timeouts.ts` throws on it and `config-inventory.mjs reconcile` (item 43, `tool:protections`) FAILs any config,
preset or project override that leaves them unlimited. **The bounds:** a missing or unclickable locator fails within
max(action, expect) ≤ 60 s; a step without meaningful progress is stopped within 120 s of its last meaningful
progress (`stall.silence` 55 s + `watchdog_grace` 60 s + ≤ 5 s polling); `timeouts.ts` asserts both. A step whose
deadline is longer than its silence limit must report meaningful progress: the stall detector writes diagnostics
(screenshot, ARIA snapshot where the version has it, in-flight requests, the last heartbeat records —
`PW_DIAGNOSTICS_DIR`, bounded by `TIMEOUTS.diagnostics`) and one `stall` heartbeat classified `ui_blocked` /
`app_slow` / `no_activity`; the watchdog's **silence rule** then stops it (ACTIVE by default — `--timeouts-mode
shadow` is the rollback that only reports). Admission waits and server-directed rate-limit waits are bounded by their
own budgets (`admission.max_wait`, `rate_limit.*`), never read as a UI stall, and stopped only past their budget +
grace. **Exceptions** are explicit and justified: a named `operations` entry (deadline, and silence for a
legitimately silent job) with its reason, or a calibration record `{key, reason, evidence, progress reporting}` in
`{run_file}.timeouts.adjusted[]` (an `// exception: <reason>` comment on the `timeouts.ts` line documents it there) —
never a raised default, never an automatic extension, never a retry. Step deadlines of 10 minutes or more are listed
in `timeouts_shadow.long_deadlines`.

**Upgrading an existing project** (`<shared_config>` step 5b, every run): the project's `timeouts.ts`, config, presets
and helpers are RECONCILED, never replaced — missing keys and helpers come from the templates, an unlimited budget,
`retries > 0` or a forced local headless is rewritten in place, the project's values, comments, paths, fixtures and
approved exceptions stay; every original is backed up first. A value above a bound without an exception, an
unfamiliar shape, an env file or a persistent browser profile is a conflict reported with file:line — the protection
is not active and item 43 FAILs until it is resolved.

**Rate-limit waits never hold a step open.** The start-of-test reservation happens before any step opens
(in `unitAdmission` when the project has `helpers/admission.ts`, else in the network guard's `beforeEach`),
bounded by `TIMEOUTS.rate_limit.max_start_wait`; a slot the server's deadline puts out of reach DEFERS the test
(skipped before any side effect, annotation `rate-limit-deferred` → `not started: deferred until {T}`, re-queued
by the runner when T falls inside the stage). A mid-test `rateLimitSlot()` wait sits inside its step, bounded
by `TIMEOUTS.rate_limit.in_step_wait`, past which the helper throws `RateLimitWaitError` "wait budget exhausted
(server deadline {T})" → INCOMPLETE `interrupted: wait budget exhausted (…)` — never `rate_limited` by itself.
Buckets (service / account / endpoint / environment) are booked together under one lock in the shared book;
a server deadline is never shortened; a self-chosen backoff uses full jitter; recovery resumes at half pace
and steps back up while nothing is refused; waits end at once on the runner's cancel flag. No other pacing
sleep exists in any layer.

## 10. Waits [M — validator `wait-network-idle`]

The policy is `automation-rules.md` §4. Craft points on top:
- **Never `networkidle` as readiness** — wait for the application's own signal: the loader hidden
  (`BasePage.waitForLoaderHidden()`), the response that carries the data, a web-first assertion on the
  element the step needs.
- **A visible loader never extends a deadline**: a loader that outlives the step deadline is the timeout
  the step reports ("loader still visible").
- Bounded polling (`expect.poll`, `toPass({ timeout })`) uses `TIMEOUTS.*`. Rate-limit pacing is never a
  wait you write (§9).

## 11. Diagnostics [M capture · R fail]

- `helpers/console-guard.ts` (`assets/console-guard.template.ts`) is attached in `beforeEach` and
  reported in `afterEach` (both on the hook whitelist): `console.error` and `pageerror` entries
  are collected, filtered by the allow-list (`Testing/qa-manifest.json` →
  `automation.consoleAllowList`, regular expressions; defaults: favicon, ResizeObserver loop),
  attached as `console-errors.txt` and annotated. **An unexpected entry never fails the TC by
  itself**; the skill lists it under Deviations as a potential defect for the human to classify.
  Making it fail the TC is a project decision recorded in the learning file.
- `helpers/network-guard.ts` (`assets/network-guard.template.ts`, always installed) sits beside it
  in the same hooks: `net = await attachNetworkGuard(page, testInfo)` in `beforeEach`, `await
  net.report(testInfo)` in `afterEach`. For the application's own origins only (`BASE_URL` + every
  `E{n}_URL`; origin + pathname, never the query) it records 429 and 503 + `Retry-After` responses
  and the first `RateLimit-*` / `X-RateLimit-*` policy header per path to `PW_RATE_LIMIT_FILE` and
  a `rate-limit` annotation, and reserves the test's start-of-test rate-limit slots. **It never
  fails a test** — the isolation check decides what a refusal means (`rate_limited`).
  Its records (`PW_RATE_LIMIT_FILE`, origin + path template, never a query, body or header value other than
  the limit numbers) name the step that was open, the request id and the account: `refused` (429, or 403 /
  503 WITH rate-limit headers showing no quota left — throttling), `unavailable` (503 + `Retry-After`
  without them — temporary unavailability: the failure keeps its outcome and is classified normally),
  `server-error` (other 5xx — evidence for the interference cause), `policy` (advertised limits, paced from
  the first request) and `network-error`. A TC whose expected result IS a refusal (a lockout, a limit under
  test) carries the annotation `expects-refusal`; its refusal is never read as `rate_limited`.
- The console guard's `report()` is the FIRST statement of `afterEach`: it writes the `teardown` heartbeat
  (the assertion-point image must precede it — compliance item 16b) and a `console-report` heartbeat with
  its counts (item 46b — proof the guard reported for every executed test).
- Trace and video retention per §8; the trace of a failed attempt is the first thing the heal loop
  opens; a live look beyond it is `<scratch_investigation>`.

## 12. `.gitignore` [M]

The automation root's `.gitignore` contains: `node_modules/`, `test-results/`,
`playwright-report/`, `**/artifacts/`, `.auth/`, `.env`, `.env.*`, `!.env.example`. It NEVER
contains `reports/`, `screenshots/`, `automation-logs/` or `.runs/` — those are the maintained run
history and the evidence. Missing lines are added; existing project lines are kept.

## 13. Stability verification [M in the heal loop]

- Every healed test is confirmed by the re-run's **burn-in** (`<second_run>` step 1.3); a failure seen
  only with `workers ≥ 2` by the automatic isolation check (`<live_progress>`) — fix the data (§7) or the
  run plan, never the assertion.
- A failure that appears only after another test is reproduced through `run-stage.mjs --tcs {the pair}`
  (`--extra last-failed` on ≥ 1.44, an explicit pair below that): order dependence is a leaked state,
  fixed in the fixture / teardown.
- A failure that appears only headless or only headed is recorded in the learning file (`[type: env]`).

## 14. Playwright version gate [M]

Read `@playwright/test` from `{automation_root}/package.json` and confirm with
`npx playwright --version` at profile time; record it in the run file (`timeouts.playwright_version`) and on the
return's `Timeouts:` line.

| Installed | Behaviour |
|---|---|
| < 1.42 | **BLOCKED before generation**: `npm i -D @playwright/test@latest && npx playwright install chrome`. No degraded mode — details-object tags and the `step()` contract are not expressible |
| 1.42 – 1.43 | full behaviour except `--last-failed`; order-related triage (§13) uses an explicit `--grep` list |
| 1.44 – 1.49 | full behaviour; step deadlines enforced by the `step()` timer only (no native `test.step({ timeout })`) — recorded once as an info Deviation |
| ≥ 1.50 | full behaviour, native step timeout armed as well |

Nothing mandatory is ever silently skipped: a feature the version lacks is named in the
Deviations with the version that provides it.

## 15. Deliberate departures from community practice — keep them

| Community advice | This skill | Why |
|---|---|---|
| assertions only in tests, never in page objects | `expectX()` methods on the page object | keeps every locator out of the spec; the validator credits assertions reached through called methods |
| `storageState` / a setup project for auth | login per test through `{login_page_object}` (user decision, 2026-10-19), the logins paced by the network guard's start-of-test reservation | the login flow is itself under test in most stories; no `.auth/` state to leak between roles; a rate-limited login is paced, not shared |
| role-first locators | source-confirmed `data-testid` first, then role | the project's test contract is in its source; role is the fallback, not the default |
| one command per run | one command per run-plan GROUP and stage | serial describes do not exclude each other across workers; command ordering is what isolates shared data |
| `retries: 2` in CI | `retries: 0` | a flaky test is a defect to classify, not a number to absorb |

A future reader who "fixes" one of these to match a blog post breaks a rule that another part of
the skill relies on. Change them only on an explicit user instruction, and update the row here.
