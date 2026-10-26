# The run plan and the ONE shared Playwright config

Loaded by `SKILL.md` at **Writing Automation Code**: the shared-config procedure runs at profile time,
before any spec is written, and the run plan is built before the specs. Every block keeps its tag.

<run_plan>
**Build the RUN PLAN for this User Story BEFORE writing specs — it decides what runs in
parallel and what runs one after another, to minimise total run time without letting TCs
corrupt each other's data.**

**The guarantee — parallelism may change how long a run takes, never a TC's status.** A FAIL
produced beside other tests is not a verdict until the TC ran alone (the isolation check,
`<live_progress>`); a result taken while the application refused requests is not a verdict
(`rate_limited`); grouping never skips a test because another one failed (a serial describe exists
only around a true chain).

Input: every automation-candidate TC in the approved document. Output:
the `run_plan` object of `{run_file}` (`.runs/phase-{N}.json`, written at PHASE 2.6 and updated at
run start) + a short summary in
the chat and in the progress log.

**Classification — first matching rule wins:**

| Signal | Result |
|---|---|
| The TC IS a PHASE 2.6 UI setup journey (`00-setup-{entity}.spec.ts`) | its own **setup group** `setup:{entity}`, **serial**, runs FIRST — before smoke |
| PHASE 2.6 created this TC's data (api / ui journey / db) | **serial** in the group named after the gap (`serial:{gap}`), scheduled after that gap's setup group; its teardown runs after the group |
| A learning-file `[type: env]` line records parallel interference for this TC or its screen (written by an earlier isolation check) | **serial** in the group the line names |
| TC field `Shared data: {name}` present on two or more TCs | all of them **serial** in the same group `{name}` |
| A true chain — a later TC needs data an earlier one created | **serial** chain group, the only kind that gets a `mode: 'serial'` describe (below) |
| The TC submits wrong credentials or otherwise counts toward an account lockout | **serial** group `account:{A-ID}`, scheduled LAST in its stage; a known lockout duration is a cool-down before the next command that signs in with that account (the re-run included) |
| The TC signs in with an account that only allows one session, or switches the application language for the whole session | **serial** in that account's / locale's group |
| **Own data** — the TC creates only its own `uniqueName()` records, or changes / deletes only records it created (`Data effect: creates / modifies / deletes`, or a mutating action in the steps, on its own records) | **parallel** — unless another parallel TC asserts on a collection that record joins (a count, a total, an empty state, a sort, pagination, "latest", an export, a search that could match it) → **serial** in the entity's group |
| `Data effect: creates / modifies / deletes` — or, with no fields, a mutating action (*create, add, new, edit, update, save, delete, remove, approve, reject, submit, upload, import, change status, assign*) — on records the TC did not create, or a precondition that depends on data another TC creates | **serial**; group = the `Shared data` value, else the entity / fixture named in the steps, Preconditions or Data Oracle (fall back to the screen name) |
| TC field `Data effect: read-only`, or everything else (open, view, search, filter, sort, paginate, check a label or message, validate a field, export) | **parallel** |
| Cannot decide | **serial** (fail safe) — record the reason |

A TC that calls a rate-limited service (`rate_limits[]` below) **stays in its group** — the limit
is paced, not serialised. The isolation check is the safety net behind every parallel decision.
Locale variants (`TC-01` and `TC-01b`) always share the classification of their base TC.
Decisions driven by the TC fields are marked `field`; the rest `inferred`.

**The machine ceiling bounds every command — Auto, never asked.** `capacity.mjs` computes it from the host's TOTAL
memory / CPU and the headed per-worker demand (the same value for every run on the machine), bounded by
`machineMaxWorkers` in `{QA_CAPACITY_DIR | ~/.link-ai-pro/capacity}/config.json` when a human set one (absent /
`"auto"` → 8, a safety bound — not the worker count chosen); unusable readings → 2, with the reason. `--workers`,
`QA_MAX_WORKERS` and `qa-manifest.json` `execution.maxWorkers` only LOWER it; current load (memory / CPU after
everything committed, host pressure, other runs' reservations) is decided at every launch and recorded. The worker
count actually used is the dispatcher's ramp (`<parallel_readiness>`); `workers_parallel` is only the legacy
`--scheduler groups` value. `node .claude/skills/link-qc-5-test-run-automation/scripts/capacity.mjs status` shows it.

**Rate limits — known before the run, never asked.** Sources, in order: learning-file `[type:
env]` lines → the application's source code, read-only (rate-limiter / throttle / lockout
configuration, cited `file:line`) → TEST-DATA environment notes → limits learned in earlier runs.
Each known limit is one `rate_limits[]` entry: `service`, `match` (method + path, e.g. `"POST
/api/auth/login"`), `limit`, `window_s`, `scope` (`machine` | `account` | `global`), `calls_per_tc`,
`at` (`start` — sign-in at the start of the test, reserved by the network guard before any step
opens — | `step` — a mid-test call through `rateLimitSlot()`), `pace` (limit − 1 per window unless a
learned value says otherwise) and `source`. An unknown limit → detection only: the network guard
records refusals and `run-stage.mjs` reacts (`<live_progress>`). A limit learned during a run is
written back as a plain `[type: env]` line (no new tag key) and appended to
`run_plan_adjustments[]` (the stage payload's `proposals[]` carries the ready entry); learning a limit changes
only the run plan (`PW_RATE_LIMITS`), never code, so it never makes a TC stale. A limit the application
ADVERTISES (`RateLimit-*` / `X-RateLimit-*` on any response, successful ones included) is paced from the first
request even before it is written back. **Group ceilings include the pacing floor** ⌈calls ÷ pace⌉ × window for
each limited service the group calls — `run-stage.mjs --ceilings auto --timeouts {timeout_policy}` computes them
with the documented arithmetic (`<live_progress>`).

**Required variants per TC.** The plan also records, for every TC, the set of test variants that
MUST pass for the TC to count as passed: every Playwright project the story runs (`projects[]` —
normally just `{browser_project}`) × every data variation the spec defines for that TC
(parameterised tests whose titles carry a variation label, e.g. `— variation A`; `none` when the
test has no variation). Locale variants `TC-01` / `TC-01b` are separate TCs, not variations. The
`variant_slug` is `{project}--{data-variation-slug}--r{repeat}` (`r0` unless `repeatEach` is used).
`<second_run>` compares the executed variants against this list — a TC with a required variant
missing is `INCOMPLETE`, never `PASS`.

**`{run_file}.run_plan` shape:**

```json
{
  "user_story": "US-1234", "generated": "ISO-8601",
  "headed": true, "workers_parallel": 2,
  "projects": ["chromium"],
  "required_variants": {
    "TC-001": ["chromium--none--r0"],
    "TC-007": ["chromium--variation-a--r0", "chromium--variation-b--r0"]
  },
  "setup_groups": [
    { "name": "setup:order-items", "mode": "serial", "workers": 1, "spec": "tests/Orders_Tests/00-setup-order-items.spec.ts",
      "provides": "an order with line items", "decision": "ui", "cleanup": "delete", "source": "qc" }
  ],
  "groups": [
    { "name": "parallel", "mode": "parallel", "workers": 2, "tcs": ["TC-001", "TC-001b", "TC-004"] },
    { "name": "serial:order-items", "mode": "serial", "workers": 1,
      "tcs": ["TC-010", "TC-011", "TC-011b"], "reason": "all edit the same order's line items" },
    { "name": "account:A1", "mode": "serial", "workers": 1, "tcs": ["TC-020"],
      "reason": "submits a wrong password for A1 — counts toward the account lockout (5 min, from the source); runs last in its stage, cool-down before the next command signing in with A1" }
  ],
  "rate_limits": [
    { "service": "login", "match": "POST /api/auth/login", "limit": 10, "window_s": 60, "scope": "machine",
      "calls_per_tc": 1, "at": "start", "pace": 9, "source": "the application's rate-limiter configuration (file:line)" }
  ],
  "decisions": [
    { "tc": "TC-010", "mode": "serial", "source": "inferred", "why": "step 4 saves a new line item" },
    { "tc": "TC-001", "mode": "parallel", "source": "field", "why": "Data effect: read-only" }
  ],
  "estimate": { "serial_only_s": 0, "planned_s": 0 }
}
```

`{run_file}.run_plan_adjustments[]` (top level of the run file, **append-only**) records every
change made after the plan was written, and `run-stage.mjs` applies them before its first
command: `{ "at": "ISO-8601", "stage": "positive", "kind": "move | rate-limit | workers", "tc" |
"service" | "group": "…", "from": "…", "to": "…", "reason": "…", "evidence": "…" }`.

**How the plan reaches the tests:**
- Every test title carries, in addition to `@smoke` / `@positive` / `@negative`, exactly one
  run tag: `@run:parallel` or `@run:serial-{group}` (kebab-case group name — `serial:order-items`
  → `@run:serial-order-items`, `account:A1` → `@run:serial-account-a1`).
- **A serial group is its `@run:serial-{group}` tag plus its own `--workers=1` command** — that is
  what isolates it under `--scheduler groups` (dispatch serialises from the readiness claims). `--workers=1` is the documented override
  (recorded in the group's `reason`). Execution order inside every stage is defined in
  `<staged_execution>`: parallel group first with `--workers={workers_parallel}`, then each serial
  group with `--workers=1`.
- **`test.describe.configure({ mode: 'serial' })` is written ONLY around a true chain** (a later
  TC needs data an earlier one created), with the dependency in a comment on the line above. Every
  other serial group has no serial describe, so a failure never skips the rest of the group. A
  chain follower skipped by a failed predecessor is reported `NOT_RUN`, Classification `not
  started: depends on {TC} (failed)` (`run-stage.mjs` detects it), and the re-run takes the
  predecessors with it. Parallel TCs need no `configure` call under the shared config's
  `fullyParallel: true` (an existing `{ mode: 'parallel' }` line is harmless). Nothing else about
  the spec changes (`<pom_mandatory>` still rules).
- **Moving a TC to another group** (an isolation check found interference, a learning line forces
  serial) = changing its `@run:` tag only — tags are outside the code fingerprint, so the move
  causes no re-run — plus a `run_plan_adjustments[]` `move` entry. Seeding stays find-or-create (a
  worker restart runs `beforeAll` again).
- Report `serial_only_s` (sum of average TC durations) vs `planned_s` (parallel group ÷
  workers + serial groups in sequence) in the run-start message, and let the progress log refresh
  both once real timings exist (`run-stage.mjs` status lines, `<live_progress>`).
- Read `Testing/project-learning.md` `[type: env]` / `[type: trick]` lines first — a serial
  group discovered in an earlier run for the same module is reused; after the run, record new
  groups, interference the isolation check found, learned rate limits and the worker count that
  ran cleanly as plain-English tagged lines.
</run_plan>

<parallel_readiness>
**The parallel readiness check — read-only, every run: it is what lets tests run side by side.** Run once, after
`<run_plan>` and before Checkpoint A; pass its file as `--units` on every stage call:
```text
node .claude/skills/link-qc-5-test-run-automation/scripts/parallel-plan.mjs --root {automation_root} --spec {this story's spec files} --tc {source_tc_doc} --data {TEST-DATA md} --learning Testing/project-learning.md --run-file {run_file} --env-id {env_id} --out {results_root}/artifacts/parallel-plan.json [--compare]
```
`run-stage.mjs` (scheduler `auto`, the default) DISPATCHES a stage only on an `OK` payload whose `inputs.fingerprint` —
the code of the specs and everything they reach (helpers, page objects, fixtures, config, timeouts), the TC hashes,
TEST-DATA, the learning file, the run plan and the environment — still matches; a changed part is re-planned in the
same call (`scheduler.replanned`). A missing, BLOCKED or unrefreshable payload, the ledger off or setup journeys run
SERIALLY (workers 1, `scheduler.fallback` names why) — never multi-worker without proof of independence; a remembered
worker count is never that proof. No re-run of this command is needed after a heal: the stage call re-plans itself.
It derives, with evidence, the **claims** of every TC and of every hook / fixture of its execution unit
(records it reads / writes, aggregate reads — counts, sorts, "latest", empty states, exports, searches —,
setup / teardown writes, account and session state, background effects such as audit entries or
notifications, global settings, learned conflicts), the conflicts between them, a class per TC
(`parallel-ready` · `restricted` · `ordered` · `barrier` · `run-alone` · `not-scheduled`) and the **execution
units** that are never split: U1 a single test · U2 a serial chain · U3 a describe whose `beforeAll` /
worker fixture shares state · U4 anything it cannot classify with evidence or that breaks the admission
contract (code-craft §6) — run as one indivisible unit per command. Unique record names prove only that two
tests do not write the SAME record; unknown effects are run alone, never guessed independent.

- **Dispatch.** The conflict-free pool runs in BATCHES (one multi-worker command per batch of max(4 × workers, 8)
  TCs, never a split unit, reserved and released per batch); every restricted / ordered / barrier / run-alone unit runs
  as its own child, never two conflicting units at once and a run-alone unit beside nothing (25b checks both). The
  pool's workers follow the RAMP, which adapts between batches: start at min(2, the Auto ceiling); a window = at least
  max(3, workers) tests and 60 s of batch WALL time (start-up and clean-up included; short batches accumulate); one +1
  trial after a healthy window — straight to the worker count this environment last validated (`ramp.json`,
  performance history only) — kept only with ≥ 10 % more throughput per wall minute, else reverted and held; −1 on
  unexplained interference, environment-wide throttling or a slower p95; halved on a browser crash; scoped throttling
  only blocks an increase (it is paced in its own scope). Never above the Auto ceiling or what admission allows now.
  Record the payload's counts, units and conflicts in `{run_file}.parallel_readiness`. A FAIL beside other tests is
  still re-run alone; the status of record never depends on the scheduler.
- **Explicit schedulers.** `--scheduler groups` runs the hand-built `<run_plan>` (the legacy rollback, multi-worker
  groups as planned); `--scheduler dispatch` refuses (BLOCKED) instead of falling back. Neither is used by a normal run.
- **Shadow experiment (opt-in — `--parallel-shadow`).** The same command WITH `--compare` adds `candidatePlan` and its
  comparison with the hand plan; record the differences in `{run_file}.parallel_readiness` as findings for the human,
  never an automatic change.
</parallel_readiness>

<shared_config>
**ONE shared `playwright.config.ts` for every story — updated, consolidated or created; never a
per-story file.** The full setting contract (Chrome channel, headed, runner-decided workers, `fullyParallel`,
`forbidOnly`, `retries: 0`, env-driven `outputDir` / `globalTimeout` / `headless`, trace and video
retention, viewport / locale / timezone, the timeout keys) is `references/code-craft.md` §8-9;
the skeleton for a project with no config is `assets/playwright.config.template.ts`; the timeout
policy it imports is `assets/timeouts.template.ts` → `{automation_root}/timeouts.ts`.

**Procedure — run at profile time, before any spec is written:**

1. **Inventory.** `node .claude/skills/link-qc-5-test-run-automation/scripts/config-inventory.mjs --root .`
   lists every `playwright*.config.*`, every reference to each (package.json scripts, CI
   files, docs, other configs, code — a mention in a comment or a code fence counts) and the
   settings that block a merge. `verdict: none` → step 5. `single` → step 4. `multiple` → 2-3.
2. **Reference scan + mergeability, per extra config.** A config is a merge candidate only when
   its effective behaviour can be reproduced in the shared file with identical results: a
   `projects[]` entry (another browser / locale / device), an env-driven `use` value, or a reporter
   entry. A config that sets `globalSetup` / `globalTeardown`, another `testDir`, a `webServer`, a
   custom reporter with per-file options, `storageState` or a snapshot path — or any setting you
   cannot reproduce with identical behaviour — is **kept, not merged**, and reported under
   `Configurations not merged` with the blocking setting and what a human would have to decide.
   Never guess a merge.
3. **Merge, rewrite, verify, THEN remove.** Write the candidate's settings into the shared file
   (its `projects[]` / `use` overrides become named entries with a comment naming the source
   file). Rewrite EVERY reference the inventory found — package scripts (`--config X` →
   `--project=… --grep …` or plain), CI steps, docs, imports. Run the smoke stage once through the
   shared file. Re-run the inventory: only a file it now lists under `deletable[]` (zero remaining
   references, no blocking setting) may be deleted, each listed in the Placement Manifest as
   `removed (consolidated from <file>)`. A file with a remaining reference or a blocking setting
   stays, and the report says why. Leftover `playwright.us-*.config.ts` from earlier skill
   versions follow the same path — they are never deleted on sight.
4. **Update in place.** Bring the shared file to the code-craft §8 contract without discarding a valid
   project setting (the UI project keeps its NAME — it is part of every evidence path). **Reporters:
   ADD `['line']`, the env-driven `json` reporter and `['./helpers/progress-reporter.ts']`; never replace,
   delete or disable a reporter the project configures.** If the config already declares its own JSON
   reporter, `{stage_json_path}` is THAT file (`run-stage.mjs --stage-json-source`). A setting that already
   differs from the contract for a stated project reason (a recorded `[type: env]` line, a comment in the
   file) is kept and listed as a Deviation, not overwritten.
5. **Create** from `assets/playwright.config.template.ts` + `assets/timeouts.template.ts` only
   when no config exists at all; register the project's `testDir` / `testMatch`.
5b. **Reconcile the run protections — every run, before the inventory of page objects; no question for a routine
   setting.** `node .claude/skills/link-qc-5-test-run-automation/scripts/config-inventory.mjs reconcile --root . --automation-root {automation_root} --results-root {results_root} --run-file {run_file} --apply`
   resolves the EFFECTIVE settings (presets, project overrides, inherited Playwright defaults, timeouts.ts, helpers, env
   files, the environment) and fixes only the supported shapes — finite action / navigation budgets, the active-stall
   keys of `timeouts.ts`, `retries: 0`, a forced local headless, an absent helper — after backing every original up
   to `{results_root}/artifacts/reconcile/{stamp}/` (+ `summary.md`, before → after). An approved exception (an
   `operations` entry, an `// exception: <reason>` comment, a `timeouts.adjusted[]` record) and an explicit worker
   maximum are kept. Every `conflicts[]` entry (an unfamiliar shape, an env file, an environment variable, a persistent
   browser profile) is reported to the user with its file:line and exact reason — never overwritten, and its protection
   is NOT active: Checkpoint A item 43 (`tool:protections`) FAILs until it is resolved. One line in the Writing
   Automation Code message: `Run protections: {n} changed, {m} conflict(s) — {summary.md}`.
6. **Helpers.** Copy `assets/steps.template.ts`, `progress-reporter.template.ts`,
   `console-guard.template.ts`, `test-data.template.ts` into `helpers/` when the project has no
   equivalent (match an existing equivalent instead of duplicating it). **`network-guard.template.ts`
   → `helpers/network-guard.ts`, `rate-limit.template.ts` → `helpers/rate-limit.ts` and
   `admission.template.ts` → `helpers/admission.ts` are always installed** (each a no-op without its
   environment variables); in an existing project PHASE 2 adds them, the guard hooks in every spec of the
   story, `TIMEOUTS.rate_limit { max_start_wait, in_step_wait, cooldown, cooldown_max }`, `TIMEOUTS.stall {
   silence }` and `TIMEOUTS.admission { max_wait }` in `timeouts.ts` BEFORE the first run (behaviour: code-craft
   §6, §9, §11), and makes the project's fixtures file extend `helpers/admission`'s `test`. Add the
   `.gitignore` lines of code-craft §12. `helpers/test-data.ts` carries the per-ID maps of
   `<normalization>` (`environments` by E-ID, `accounts` by A-ID, reading `{ID}_URL` / `{ID}_USER` /
   `{ID}_PASSWORD` at run time, no default) — one entry per row of the story's TEST-DATA file; an
   existing env layer keyed by role is extended with the ID-keyed entries, never replaced. Everything
   touched goes in the Placement Manifest.
7. **Version gate** — code-craft §14 (< 1.42 → BLOCKED with the upgrade command; feature gates recorded).

**Per-run values reach the config only through the environment variables `run-stage.mjs` sets**
(code-craft §8) — the file is never rewritten per story, so the `scopeDigest` changes exactly when the
policy changes. **Never `--reporter`** (it replaces the configured list and drops the stage JSON — the
freshness gate stops the run) and **never `--config`** (how a retired per-story file comes back) on a run
command; `scripts/scratch.mjs`'s overlay is an investigation, not a run (`<scratch_investigation>`).
`{run_report_html}` is additional to whatever HTML report the project already produces.

**Acceptance — in the consumer project, every time this block changes the config (NOT_RUN when
it cannot run):** the smoke stage runs through the shared file, and a one-off probe spec
`tests/_probe/watchdog-probe.spec.ts` (one `step()` with a 5 s deadline around a 60 s action)
shows: the structured step error names the TC and the step; `attempt-1-failed.png` is written by
the `afterEach` hook; teardown completed; the next test in the same worker started only after
it; no orphaned Chrome process; the incremental results line is present. The probe is deleted
afterwards and the result recorded in `{run_file}.timeouts.probe` (and on the return's `Timeouts:` line).
</shared_config>
