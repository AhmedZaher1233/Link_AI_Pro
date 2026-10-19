# The run plan and the ONE shared Playwright config

Loaded by `SKILL.md` at **Writing Automation Code**: the shared-config procedure runs at profile time,
before any spec is written, and the run plan is built before the specs. Every block keeps its tag.

<run_plan>
**Build the RUN PLAN for this User Story BEFORE writing specs — it decides what runs in
parallel and what runs one after another, to minimise total run time without letting TCs
corrupt each other's data.**

Input: every automation-candidate TC in the approved document. Output:
the `run_plan` object of `{run_file}` (`.runs/phase-{N}.json`, written at PHASE 2.6 and updated at
run start) + a short summary in
the chat and in the progress log.

**Classification — first matching rule wins:**

| Signal | Result |
|---|---|
| TC field `Data effect: read-only` | **parallel** |
| TC field `Data effect: creates / modifies / deletes` | **serial**; group = the `Shared data` value, else the entity named in the steps |
| TC field `Shared data: {name}` present on two or more TCs | all of them **serial** in the same group `{name}` |
| No fields → the steps or preconditions contain a mutating action (*create, add, new, edit, update, save, delete, remove, approve, reject, submit, upload, import, change status, assign*) or a precondition that depends on data another TC creates | **serial**; group = the entity / fixture named in Preconditions or Data Oracle (fall back to the screen name) |
| The TC signs in with an account that only allows one session, or switches the application language for the whole session | **serial** in that account's / locale's group |
| PHASE 2.6 created this TC's data (api / ui journey / db) | **serial** in the group named after the gap (`serial:{gap}`), scheduled after that gap's setup group; its teardown runs after the group |
| The TC IS a PHASE 2.6 UI setup journey (`00-setup-{entity}.spec.ts`) | its own **setup group** `setup:{entity}`, **serial**, runs FIRST — before smoke |
| Everything else (open, view, search, filter, sort, paginate, check a label or message, validate a field, export) | **parallel** |
| Cannot decide | **serial** (fail safe) — record the reason |

Locale variants (`TC-01` and `TC-01b`) always share the classification of their base TC.
Decisions driven by the TC fields are marked `field`; the rest `inferred`.

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
      "tcs": ["TC-010", "TC-011", "TC-011b"], "reason": "all edit the same order's line items" }
  ],
  "decisions": [
    { "tc": "TC-010", "mode": "serial", "source": "inferred", "why": "step 4 saves a new line item" },
    { "tc": "TC-001", "mode": "parallel", "source": "field", "why": "Data effect: read-only" }
  ],
  "estimate": { "serial_only_s": 0, "planned_s": 0 }
}
```

**How the plan reaches the tests:**
- Every test title carries, in addition to `@smoke` / `@positive` / `@negative`, exactly one
  run tag: `@run:parallel` or `@run:serial-{group}` (kebab-case group name).
- Each serial group is its own `test.describe('{group}', …)` block with
  `test.describe.configure({ mode: 'serial' })` and its reason in a comment on the line above;
  parallel TCs need no `configure` call under the shared config's `fullyParallel: true` (an
  existing `{ mode: 'parallel' }` line is harmless). Nothing else about the spec changes
  (`<pom_mandatory>` still rules).
- Execution order inside every stage is defined in `<staged_execution>`: parallel group first
  with `--workers={workers_parallel}`, then each serial group with `--workers=1`. **A serial
  describe orders its own tests; it does not exclude other groups** — two serial describes, or a
  serial describe and the parallel group, WOULD run side by side on two workers in one command.
  The per-group command is therefore what isolates shared data, and `--workers=1` on a serial
  group is the documented override of the shared config's 2 workers (recorded in the group's
  `reason`).
- Report `serial_only_s` (sum of average TC durations) vs `planned_s` (parallel group ÷
  workers + serial groups in sequence) in the run-start message, and let the progress log refresh
  both once real timings exist (`run-stage.mjs` status lines, `<live_progress>`).
- Read `Testing/project-learning.md` `[type: env]` / `[type: trick]` lines first — a serial
  group discovered in an earlier run for the same module is reused; after the run, record new
  groups and the worker count that ran cleanly as plain-English tagged lines.
</run_plan>

<shared_config>
**ONE shared `playwright.config.ts` for every story — updated, consolidated or created; never a
per-story file.** The full setting contract (Chrome channel, headed, 2 workers, `fullyParallel`,
`forbidOnly`, `retries: 0`, env-driven `outputDir` / `globalTimeout` / `headless`, trace and video
retention, viewport / locale / timezone, the timeout keys) is `references/code-craft.md` §8-9;
the skeleton for a project with no config is `assets/playwright.config.template.ts`; the timeout
policy it imports is `assets/timeouts.template.ts` → `{automation_root}/timeouts.ts`.

**Procedure — run at profile time, before any spec is written:**

1. **Inventory.** `node .claude/skills/link-qc-5-test-run-automation/scripts/config-inventory.mjs --root .
   --pretty` lists every `playwright*.config.*`, every reference to each (package.json scripts, CI
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
4. **Update in place.** Bring the shared file to the §8 contract without discarding a valid
   project setting: add `channel: 'chrome'` to the UI project (keep its NAME — it is part of every
   evidence path), set `workers: Number(process.env.PW_WORKERS ?? 2)`, `fullyParallel: true`,
   `forbidOnly: !!process.env.CI`, `retries: 0`, `headless` from `PW_HEADLESS`, `outputDir` from
   `PW_OUTPUT_DIR`, `globalTimeout` from `PW_GLOBAL_TIMEOUT`, every timeout from `timeouts.ts`,
   `trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'`, viewport / `deviceScaleFactor` /
   `locale` / `timezoneId`. **Reporters: ADD what this skill requires, never replace what the
   project configures.** Ensure the list contains `['line']` (it feeds the progress log through `run-stage.mjs`),
   `['json', { outputFile: process.env.PW_STAGE_JSON ?? 'artifacts/stages/unnamed.json' }]`
   and `['./helpers/progress-reporter.ts']` (the incremental results the watchdog relies on).
   The `json` reporter writes ONE file PER STAGE COMMAND because every stage / run-group command
   sets `PW_STAGE_JSON={results_root}/artifacts/stages/{stage}-{group}[-attempt{n}].json`, so
   separate commands never overwrite each other's results. **Every other reporter the project
   already configures is preserved and runs alongside** — the built-in `html` reporter, a JUnit
   reporter for CI, a custom one. Never delete or disable one to "clean up" the config. If the
   config already declares its own JSON reporter, `{stage_json_path}` is THAT file: copy it to
   the stage file right after each command rather than adding a second one. A setting that
   already differs from the contract for a stated project reason (a recorded `[type: env]` line,
   a comment in the file) is kept and listed as a Deviation, not overwritten.
5. **Create** from `assets/playwright.config.template.ts` + `assets/timeouts.template.ts` only
   when no config exists at all; register the project's `testDir` / `testMatch`.
6. **Helpers.** Copy `assets/steps.template.ts`, `progress-reporter.template.ts`,
   `console-guard.template.ts`, `test-data.template.ts` into `helpers/` when the project has no
   equivalent (match an existing equivalent instead of duplicating it); add the `.gitignore`
   lines of `references/code-craft.md` §12. `helpers/test-data.ts` carries the per-ID maps of
   `<normalization>` — `environments` keyed by E-ID and `accounts` keyed by A-ID, each entry
   reading `{ID}_URL` / `{ID}_USER` / `{ID}_PASSWORD` at run time with no default — fill one entry
   per row the story's TEST-DATA file has; an existing env layer keyed by role is extended with the
   ID-keyed entries, never replaced. Everything touched goes in the Placement Manifest.
7. **Version gate.** Resolve `playwright_version` (`<project_profile>`); < 1.42 → BLOCKED with
   the upgrade command; otherwise record the feature gates (tags object, `--last-failed`, native
   step timeout) for `<spec_writing>` and the Timeout policy section.

**Per-run values reach the config only through environment variables set on each command**
(`PW_STAGE_JSON`, `PW_PROGRESS_FILE`, `PW_OUTPUT_DIR`, `PW_GLOBAL_TIMEOUT`, `PW_HEADLESS`,
`PW_WORKERS` / `--workers`, `PW_PHASE`, `PW_STAGE_ATTEMPT`). The file is not rewritten per story,
so the compliance `scopeDigest` (which hashes the config AND its one-hop relative imports such as
`timeouts.ts`) stays stable across stories and changes exactly when the policy changes.

**Nothing may override or discard the required stage JSON.** Do not pass `--reporter=…` on the
CLI: Playwright's `--reporter` **replaces** the whole configured list and silently drops the
stage file (the per-stage freshness gate in `<live_progress>` catches this, and stops the run).
The same applies to a config change that removes the JSON or the progress reporter. Do not pass
`--config` either: the shared file is the default, and a stray `--config` is how a retired
per-story file comes back. `{run_report_html}` is this skill's own designed report, built from
`{run_file}.merged` — additional to, not a replacement for, whatever HTML report the project
already produces.

**Acceptance — in the consumer project, every time this block changes the config (NOT_RUN when
it cannot run):** the smoke stage runs through the shared file, and a one-off probe spec
`tests/_probe/watchdog-probe.spec.ts` (one `step()` with a 5 s deadline around a 60 s action)
shows: the structured step error names the TC and the step; `attempt-1-failed.png` is written by
the `afterEach` hook; teardown completed; the next test in the same worker started only after
it; no orphaned Chrome process; the incremental results line is present. The probe is deleted
afterwards and the result recorded under `Probe:` in the Timeout policy section.
</shared_config>
