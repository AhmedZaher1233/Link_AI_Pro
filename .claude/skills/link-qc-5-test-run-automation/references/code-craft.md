# Code craft — page objects, locators, specs, the shared config, timeouts and diagnostics

Loaded by `SKILL.md` from `<pom_mandatory>`, `<shared_config>`, `<spec_writing>`, `<wait_policy>`
and `<first_run>`. It says HOW generated code is written; the governance (POM boundaries,
evidence, gates, traceability) stays in `SKILL.md` and is never relaxed here.

**[M] = mandatory** — a Checkpoint A / B item (`references/compliance-checkpoints.md` §2) and,
where one exists, a validator rule. **[R] = recommended** — semantic review notes a departure
with its reason; it never blocks. Every section is tagged.

---

## 1. Page-object authoring [M]

- **Locators are `readonly` fields set in the constructor**, one per element the TCs touch,
  named for what the element IS (`saveButton`, `statusBadge`), never for how it is found.
- **Methods express intent, one action each**: `submitOrder()`, `filterByStatus(status)`,
  `expectStatus(status)` — not `clickButton()`, `fillField()`. A composite flow the TCs repeat
  (`applyFilterMode(mode, value?)`) is one method that calls the atomic ones.
- **Navigation returns the next page object**: `async login(user): Promise<DashboardPage>`. A
  spec never constructs the destination page itself after a navigation it did not start.
- **One shared loader / readiness wait on a base class** (`BasePage.waitForLoaderHidden()`,
  `BasePage.gotoAppPath(path)`), inherited by every page. Readiness is an OBSERVABLE condition
  (§10), never `networkidle`, never a timer.
- **Assertion methods live on the page object** (`expectSavedToast()`, `expectRowCount(n)`) and
  contain the `expect`. This is a deliberate departure from the community "assertions only in
  tests" advice: it is what keeps every locator out of the spec (`<pom_mandatory>`). Keep it.
- **Focused responsibility**: one class per logical screen, not per URL; a screen with more than
  ~15 locators is split into components (§2). No page object provisions data through an API — that
  is `prerequest/` or a fixture (§6).
- **Match the project's existing style first** (file naming, constructor shape, how `page` is
  held). These rules fill gaps; they never trigger a rewrite of a working convention.
- **[M] One page class per screen across the WHOLE automation root — never a twin.** Before a
  page object is written, `<automation_inventory>` scans every class under `{automation_root}`
  (any folder, whatever skill or agent wrote it) and records one decision row per screen in
  `{reports_folder}/automation-inventory.md`: `reuse {class}` / `extend {class} (+methods)` /
  `create {class}`, naming every candidate the matching surfaced (same normalized name, same
  route, two or more identical locators) with the reason it was accepted or rejected. A class
  is created only from a `create` row whose candidates are all rejected with a reason; a second
  `OrderPage`, a `4-ListingPage.ts` beside `ListingPage.ts`, or a new class on a route another
  class already opens is a Checkpoint A failure (validator `pom-duplicate-page`, run with
  `--inventory`). The decision is recorded in the learning file `## Automation Tricks` so the
  next run reuses it.

## 2. Component objects [M]

A reusable widget (modal, data table, navbar, date picker, notification) is a **component
object** under `pages/components/`: its constructor takes a **scoping `Locator`** (the
container), not `Page`, so the same class serves every screen the widget appears on:

```ts
export class DataTable {
  constructor(private readonly root: Locator) {}
  row(text: string) { return this.root.getByRole('row').filter({ hasText: text }); }
  async expectRowCount(n: number) { await expect(this.root.getByRole('row')).toHaveCount(n); }
}
// on a page: readonly orders = new DataTable(this.page.getByTestId('orders-table'));
```

Angular Material / CDK overlays (select panels, autocomplete, dialogs, menus) render OUTSIDE the
component's container, at the document root. A component object for such a widget scopes its
trigger to the container and resolves the overlay at page level by role
(`page.getByRole('listbox')`, `page.getByRole('option', { name })`, `page.getByRole('dialog')`).

## 3. Locator strategy [M]

Order of preference, every level scoped to a container when one exists:

1. **Source-confirmed `data-testid`** (`<selector_resolution>` — from the implementation files,
   never from memory). This stays first: it is the project's test contract.
2. **Role + accessible name**: `getByRole('button', { name: 'Save' })`, `getByRole('row', { name })`.
   The default for Angular Material, which exposes correct ARIA roles.
3. **Label / placeholder** for form controls: `getByLabel('Email')`.
4. **Visible text** for static content only: `getByText('No results')` — never for anything
   that translates unless the locale table drives it.
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
- **Tags via the details object** on Playwright ≥ 1.42:
  `test('[TC-014] Validate that …', { tag: ['@positive', '@smoke', '@run:parallel'] }, async …)`.
  Below 1.42 the tags stay in the title. The `[TC-ID]` prefix stays in the title on every version
  (the validator reads it there).
- **`expect.soft` only for INDEPENDENT checks of one expected result** (three labels on one
  confirmation screen), never across steps and never to keep going past a failed precondition.
  The last assertion of the Assert step stays a hard `expect`, and the evidence call still sits
  right before it.
- **Constants from one source** (`<pom_mandatory>`), **no helpers in specs**, **titles carry the
  `[TC-ID]`**, **suites carry the requirement ID** — unchanged.

## 6. Fixtures and `prerequest/` — how they coexist [R; M once a fixture layer exists]

- `prerequest/*PreRequest.ts` stays the **provisioning function layer**: create / find-or-create
  / delete through the API, idempotent, no UI.
- `fixtures/test.ts` (`test.extend`) MAY **wrap** those functions to give a TC guaranteed teardown
  (the `use()` callback's tail runs even when the test fails or times out), per-worker scope for
  expensive setup, and lazy creation:

  ```ts
  export const test = base.extend<{ draftOrder: Order }>({
    draftOrder: async ({ request }, use) => {
      const order = await createDraftOrder(request, uniqueName('order'));   // prerequest function
      await use(order);
      await deleteOrder(request, order.id);                                  // runs after the evidence image
    },
  });
  export { expect } from '@playwright/test';
  ```

  A spec that uses it imports `test` / `expect` from `../../fixtures/test` instead of
  `@playwright/test`; that import is on the spec whitelist. Fixture bodies drive the UI only
  through page objects (a fixture that logs in calls `LoginPage.login`, never `page.fill`).
- **Which one?** Setup with no teardown and no lifecycle → a `prerequest` call in `beforeAll`.
  Setup that must be undone even on failure, or that several tests share per worker → a fixture
  wrapping the same `prerequest` function. Never both for the same data.
- Record the project's choice under `automation.layers.fixtures` in `Testing/qa-manifest.json`
  so the validator and the reviewer look in the right folder.

## 7. Unique test data [M]

Every record a test CREATES carries an identifier from `helpers/test-data.ts`:
`uniqueName(prefix)` → `{prefix}-p{phase}-w{parallelIndex}-r{retry}[-e{repeat}]-{4 random}`.
Two workers, a retry, a `--repeat-each` variant and a re-run of the same phase therefore never
collide, and cleanup selects by `runPrefix(prefix)` (`{prefix}-p{phase}-`). A fixed literal
(`'Order Alpha'`) is allowed only for data the TC READS and PHASE 2.6 provisioned. Teardown
deletes by the same prefix; a post-stage orphan sweep by prefix (through the `prerequest/` delete
functions) runs whenever a teardown timed out (`cleanup_incomplete`, §9).

## 8. The shared configuration [M]

One `playwright.config.ts` in `{automation_root}` for every story (`<shared_config>` owns the
consolidation procedure; `assets/playwright.config.template.ts` is the skeleton for a project
with none). Contract:

| Setting | Value | Why |
|---|---|---|
| browser | project `chromium` with `channel: 'chrome'` (Google Chrome) | the user's default; the project NAME stays stable because it is part of every evidence path |
| `headless` | `false` unless `PW_HEADLESS=1` | visible run by default; the environment gate sets the env var when no display exists |
| `workers` | `2` (`PW_WORKERS` / `--workers` per command) | the parallel group runs ×2; a serial run-plan group runs as its own command with `--workers 1` — the documented override |
| `fullyParallel` | `true` | any test may take any worker; dependent tests are serial by describe `mode` AND by command |
| `forbidOnly` | `!!process.env.CI` | belt and braces beside the validator's `focus-only` |
| `retries` | `0` | failures are classified and healed, never retried away |
| `timeout` / `expect.timeout` / `actionTimeout` / `navigationTimeout` / `globalTimeout` | from `timeouts.ts` (§9); `globalTimeout` from `PW_GLOBAL_TIMEOUT` | one source of truth |
| `outputDir` | `process.env.PW_OUTPUT_DIR ?? 'test-results'` | the skill sets `{results_root}/artifacts/test-output` per command |
| reporters | the project's own list + `['line']` + `['json', { outputFile: process.env.PW_STAGE_JSON ?? … }]` + `['./helpers/progress-reporter.ts']` | additive, never replaced; never `--reporter` on the CLI |
| `screenshot` / `trace` / `video` | `'only-on-failure'` / `'retain-on-failure'` / `PW_VIDEO ? 'retain-on-failure' : 'off'` | trace survives `retries: 0`; video only while investigating a freeze |
| `viewport` / `deviceScaleFactor` | `1440×900` / `1` | evidence images comparable across machines |
| `locale` / `timezoneId` | from the env layer (`PW_LOCALE`, `PW_TZ`), defaults `en-US` / `UTC` | date-dependent TCs are deterministic; an `ar` project with `locale: 'ar-SA'` ONLY when the application reads the browser locale — otherwise the page object's language switch, and locale variants stay separate TCs |
| `testMatch` / `baseURL` / env handling | the project's own | registration of a new spec is still part of PHASE 2 |

Per-run values reach the config only through environment variables set on each stage command
(`PW_STAGE_JSON`, `PW_PROGRESS_FILE`, `PW_OUTPUT_DIR`, `PW_GLOBAL_TIMEOUT`, `PW_HEADLESS`,
`PW_WORKERS`, `PW_PHASE`, `PW_STAGE_ATTEMPT`). Nothing is rewritten per story, so the compliance
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
| `operations.*` | per key | named overrides for KNOWN long operations, each with its reason beside it |
| `watchdog_grace` | 60 s | time allowed after a step deadline for Playwright's own timeout and teardown to act |

These are recommended VALUES; that they exist, are documented in the run report's Timeout policy
section and are imported from `timeouts.ts` (never inline) is mandatory. The skill states the
values it chose, the project facts that shaped them (known long operations from the learning
file, TC durations from earlier phases) and, when the installed Playwright is below 1.50, that step
deadlines are helper-enforced only.

**The `step()` wrapper** (`assets/steps.template.ts`): races the body against its own deadline
timer on every supported version and, on ≥ 1.50, also arms the native `test.step({ timeout })`.
On timeout it records `end: timeout` in the heartbeat, throws a `StepTimeoutError` carrying
`[TC-ID] step "…" elapsed N s, expected: …`, swallows the late rejection of the still-pending body,
and lets Playwright close the page (aborting the pending driver call) and run `afterEach` +
fixture / `prerequest` teardown in their own budget; the worker takes its next test only after
that teardown returns. Teardown that itself times out marks the TC `cleanup_incomplete` with the
data prefix (§7) and triggers the post-stage orphan sweep. Inside a long operation the body calls
`report('rows loaded 40/100')`: a `progress` heartbeat that resets the watchdog clock.

**Calibration after the first run** (`<first_run>`): list every timeout and watchdog event with
TC-ID, step, elapsed, expected condition and the trace / screenshot path. A value may RISE only
when that evidence shows the operation legitimately completing after the deadline; a broken
locator, a failed operation or a frozen step is healed, never re-timed; retries are never added
to absorb a timeout. Every change goes to `timeouts.ts` with its reason, to the Heal Log
(category `timeout_failure`, column 7 = the evidence path) and to the report's Timeout policy
section. A timeout on the first run alone never establishes the required duration.

**Watchdog** (`scripts/watchdog.mjs`, `<live_progress>`): the outer ceiling is `PW_GLOBAL_TIMEOUT`
per command; the freeze decision reads the heartbeat only — an open step past ITS OWN deadline +
grace with no progress record, no newer worker record and no newer result means Playwright's
timeout could not act and the worker is hung. Console silence and an unchanged stage JSON never
count. On a stop, `helpers/progress-reporter.ts`'s incremental results file preserves every
finished test; interrupted and never-started TCs are named as such.

## 10. Waits [M — validator `wait-network-idle`]

- **Never `networkidle` as readiness** (`waitForLoadState('networkidle')`,
  `{ waitUntil: 'networkidle' }`): it never settles on pages that poll or stream and settles too
  early on lazy pages. Wait for the application's own signal — the loader hidden
  (`BasePage.waitForLoaderHidden()`), the response that carries the data (`waitForResponse`), a
  web-first assertion on the element the step needs.
- **A visible loader never extends a deadline.** The loader wait is itself bounded by the step
  deadline; a loader that outlives it is the timeout the step reports, with "loader still visible"
  as the observed condition.
- Fixed waits and timers: `<wait_policy>` unchanged (justified backoff / debounce only, in every
  layer). Bounded polling (`expect.poll`, `toPass({ timeout })`) uses `TIMEOUTS.*`.

## 11. Diagnostics [M capture · R fail]

- `helpers/console-guard.ts` (`assets/console-guard.template.ts`) is attached in `beforeEach` and
  reported in `afterEach` (both on the hook whitelist): `console.error` and `pageerror` entries
  are collected, filtered by the allow-list (`Testing/qa-manifest.json` →
  `automation.consoleAllowList`, regular expressions; defaults: favicon, ResizeObserver loop),
  attached as `console-errors.txt` and annotated. **An unexpected entry never fails the TC by
  itself**; the skill lists it under Deviations as a potential defect for the human to classify.
  Making it fail the TC is a project decision recorded in the learning file.
- Trace and video retention per §8; the trace of every failed attempt is the first thing the heal
  loop opens (`npx playwright show-trace`).

## 12. `.gitignore` [M]

The automation root's `.gitignore` contains: `node_modules/`, `test-results/`,
`playwright-report/`, `**/artifacts/`, `.auth/`, `.env`, `.env.*`, `!.env.example`. It NEVER
contains `reports/`, `screenshots/`, `automation-logs/` or `.runs/` — those are the maintained run
history and the evidence. Missing lines are added; existing project lines are kept.

## 13. Stability verification [M in the heal loop]

- After every heal, run the healed tests with `--repeat-each 3` before recording the repair
  (Heal Log column 8 names the burn-in).
- A failure that appears only with `workers ≥ 2` is reproduced with `--workers 1`: passing there
  means shared data or state — fix the data (§7) or the run plan, never the assertion.
- A failure that appears only after another test is reproduced with `--last-failed` (≥ 1.44) or
  the explicit failing pair in one `--grep`: order dependence is a leaked state, fixed in the
  fixture / teardown.
- A failure that appears only headless or only headed is recorded as such in the learning file
  (`[type: env]`).

## 14. Playwright version gate [M]

Read `@playwright/test` from `{automation_root}/package.json` and confirm with
`npx playwright --version` at profile time; record it in the run file and the Timeout policy
section.

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
| `storageState` / a setup project for auth | login per test through `{login_page_object}` | the login flow is itself under test in most stories; no `.auth/` state to leak between roles |
| role-first locators | source-confirmed `data-testid` first, then role | the project's test contract is in its source; role is the fallback, not the default |
| one command per run | one command per run-plan GROUP and stage | serial describes do not exclude each other across workers; command ordering is what isolates shared data |
| `retries: 2` in CI | `retries: 0` | a flaky test is a defect to classify, not a number to absorb |

A future reader who "fixes" one of these to match a blog post breaks a rule that another part of
the skill relies on. Change them only on an explicit user instruction, and update the row here.
