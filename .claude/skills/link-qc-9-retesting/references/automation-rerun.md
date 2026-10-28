# Automation route — re-run an automated TC from skill 5's code (steps 2, 3, 4)

Loaded by SKILL.md steps 2-4. Contract §7. Skill 5 owns the automation, the runner and the report
contract; skill 9 only **calls** its scripts by path and never copies, imports or edits them:

```text
.claude/skills/link-qc-5-test-run-automation/scripts/impact.mjs              is the TC automated, which spec
.claude/skills/link-qc-5-test-run-automation/scripts/run-stage.mjs           the only way a Playwright command runs
.claude/skills/link-qc-5-test-run-automation/scripts/render-run-report.mjs   the only way the page is made (report-update.md §4)
```

Skill 5's folder absent → the run is BLOCKED for every route: the environment lease and the worker ceiling are
skill 5's `capacity.mjs` (coordination.md). Read a skill 5 reference only when a
rule below points to it (`../link-qc-5-test-run-automation/references/…`), once.

## 1. Route decision — is the TC automated?

1. **Roots** — `Testing/qa-manifest.json` first, then skill 5's profile rules (`intake.md`
   `<project_profile>`): `automation_root` (the project holding `playwright.config.ts`, else
   `Testing/Automation/`), `results_root` = `{automation_root}/reports/[SPEC-*/]{US-leaf}/`,
   `screenshots_root` = `{automation_root}/screenshots/[SPEC-*/]{US-leaf}/`. Never guessed: an
   unresolved root → the story's bugs are `Skipped (results root not found)`.
2. **Latest phase** — N = the highest `## Phase N` of `TEST-RUN-REPORT-{feature}.md`; run file
   `{results_root}/.runs/phase-{N}.json`. Its `status` must be final (`complete`,
   `stopped-smoke-gate`, `environment-blocked`, `blocked`); `planning` / `ready` / `running` →
   **BLOCKED** "a skill 5 / 5b run of this story is in progress — retest after it finishes". No phase
   at all → contract §7 (ask skill 5 to establish one).
3. **TCs of the bug** — its `TC-ID` field plus any TC the latest phase's `### Bugs` table lists for
   the same bug id.
4. **Fingerprint** — `node .claude/skills/link-qc-5-test-run-automation/scripts/impact.mjs
   fingerprint --root {automation_root} --tcs {TC,…}` → per TC the test(s) carrying `[TC-ID]` in
   their title (`tests[].file`, `title`); the warning "not carried by any test" = not automated.
   The `file` values are the `--spec` list of §3.
5. **Automation route** ⇔ a test carries the TC **and** the run file's `framework` is not
   `manual-cli` **and** `run_plan.groups[]` (after `run_plan_adjustments[]`) holds the TC.
   Otherwise the playwright-cli route, with its reason recorded: `not automated` · `latest phase is
   a manual run (skill 5b)` · `in no run-plan group`.

## 2. Readiness — checked before the combined ask, never asked about

- The runner exists: `{automation_root}/node_modules/@playwright/test/cli.js` (or
  `node_modules/playwright/cli.js`), or the learning file records the project's own run command
  (then `--cmd`). Missing → every automation-route bug is `NOT_RUN (automation runner not installed
  in {automation_root} — install its dependencies there)`; nothing is installed by this skill.
- `timeouts.ts` is readable (the ceilings of §3); the shared config's JSON reporter honours
  `PW_STAGE_JSON` (otherwise pass `--stage-json-source` with the config's own JSON output file).
- **Environment** — the automation selects its environment the project's way (the learning file's
  `[type: env]` lines, the environment file the project already uses); skill 9 never writes a
  credential, an environment file or a configuration value. Of skill 5's `<environment_gate>`
  (`execution.md`) only the environment part applies (base URL answers, services healthy, a headed
  window opens — else `PW_HEADLESS=1` and a Deviation); never Checkpoint A, coverage or readiness.
- The environment differs from phase N's `**Environment:**` bullet → it is part of the ONE combined
  ask ("phase N ran on {env}; retest on {env'}?") — a retest on another environment would mix two
  environments in one phase; "yes" adds a Deviation line naming both.

## 3. Run — one `run-stage.mjs` call per stage

- **Stage of each TC** = the `stage` of its latest attempt in the run file
  (`results[].variants[].attempts[]`), else its tags (`@smoke` → smoke, `@negative` → negative,
  otherwise positive). Order: `setup` (only for a TC of a `serial:{gap}` group: `--stage setup
  --groups setup:{gap}`) → smoke → positive → negative; a stage without retest TCs is not called.
- **Command** (one per stage, the retest TCs of that stage only):

  ```text
  node .claude/skills/link-qc-5-test-run-automation/scripts/run-stage.mjs
    --run-file {results_root}/.runs/phase-{N}.json --stage {stage} --run rerun
    --stage-tcs {retest TCs of this stage} --tcs {the same}
    --spec {files from §1.4} --ceilings {group}={ms},… --grace {TIMEOUTS.watchdog_grace}
    --log {automation_root}/automation-logs/[SPEC-*/]{US-leaf}/run-progress-{stamp}.log
    --project {the browser project of phase N} --cwd {automation_root} --label "retest — skill 9"
    --env-id {envId of this run's lease — coordination.md §2} --screenshot-policy all
    [--cooldown {TIMEOUTS.rate_limit.cooldown}] [--cooldown-max {TIMEOUTS.rate_limit.cooldown_max}]
    [--headless] [--cmd "{run command}"] [--stage-json-source {path}]
  ```

  Ceilings are computed exactly as skill 5's watchdog layer 1 (`execution.md` `<live_progress>`),
  over the retest TCs of each group only — compute them for ONE worker: without a readiness payload skill 5's
  default scheduler (`auto`) runs the retest SERIALLY (`scheduler.used: serial`), which suits a handful of retests;
  the active silence rule and the Auto ceiling apply as in skill 5. Never `--burn-in`, `--extra`, `--reporter`,
  `--config`, `--retries` or `--scheduler`. `--screenshot-policy all` always — the retest's images are the evidence the
  close / reopen uploads, whatever screenshot choice phase N's own run made (its `delivery.screenshots`).
- **One background call per stage**; wait for its completion notice — never poll it, never read the
  log while it runs (pipeline mode: one foreground call per `--groups`, with a tool timeout above
  the ceiling + `--cooldown-max`). After each call, one chat message: the payload's `update`
  (labelled "retest").
- `artifacts/` is **never emptied** by this skill: run-stage takes the next free `-attempt{n}` per
  command, so phase N's earlier files stay. The isolation check runs inside the call — a FAIL beside
  other tests is re-run alone before it counts, a refused request is `rate_limited` (no verdict).
- Payload outcome `BLOCKED` (also `environment lease` / `no safe coordination`) / `SPAWN_FAILED` /
  `FRESHNESS_FAILED` → every TC of that call is unobserved (`NOT_RUN` with the payload reason) and its bug
  keeps its Status; never re-tried through playwright-cli. A TC `NOT_RUN` `not started: admission timeout` ·
  `host pressure` · `no safe coordination` (the machine's worker ceiling, coordination.md §3) is unobserved too.
- Without `--env-id` (an older call) run-stage still runs, with the warning "no --env-id" — that call was not
  coordinated with other runs on the environment; this skill always passes it.

## 4. Verdict per bug

Read the call's summary (`{results_root}/artifacts/progress/rerun-{stage}-{seq}.summary.json`:
statuses of the latest attempt, failures with their step and message, isolation outcomes) and,
for a failure, the stage JSON's error text. Classify a failure with skill 5's `<first_run>`
catalogue (`execution.md`), read once when the first failure appears.

| Re-run result of the TC, every required variant (`run_plan.required_variants`) | Bug | TC row (report-update.md) |
|---|---|---|
| PASS in every required variant | fixed → `resolved (phase N)` | → `PASS` |
| FAIL whose failing step / assertion is the bug's own (its `Evidence` assertion, or its `Actual` on the same step) — `app_bug` | still failing → `open` (reopen in Azure when terminal) | → `FAIL · app_bug` |
| the bug's own step passed in every required variant, a LATER step failed as `app_bug` | fixed → `resolved (phase N)`; the new failure is an incidental bug (SKILL.md step 8) | → `FAIL · app_bug` |
| a failure BEFORE the bug's step as `app_bug` | unobserved (the bug's step was not reached) — Status unchanged; the new failure is an incidental bug | → `FAIL · app_bug` |
| `selector_failure` · `timeout_failure` · `evidence_failure` · `environment_failure` · a failing `@unverified-assumption` test · `INCOMPLETE` (`rate_limited`, interrupted, a missing variant) · `NOT_RUN` | unobserved — Status unchanged | unchanged; reported "for skill 5: {classification} at {step}" |

`PARTIAL — human step pending` stays PARTIAL; a bug behind the `[HUMAN]` step is unobserved.
Skill 9 never edits a spec, a page object, a helper, `timeouts.ts` or the config — not to make a
retest run, not to make it pass.

**Data changes:** a TC whose `Data effect` writes data runs only after the run's explicit "yes"
(combined ask); "no" → that TC's bug is `NOT_RUN (data changes not authorized)`.

## 5. Evidence for the report and for Azure

Per required variant, from the summary / the attempt records: the latest attempt's
`attempt-{a}.png` (the assertion-point image, always) and `attempt-{a}-failed.png` (on FAIL), under
`{screenshots_root}/phase-{N}/{TC-ID}/{variant}/`. These paths go into the Results row
(report-update.md §1), the bug's History line, and the Azure upload (SKILL.md step 7: name
`BUG-{n}-{TC-ID}-phase-{N}-retest-{variant}-{file}`). The progress log, stage JSONs, progress files
and summaries stay under `artifacts/` and `automation-logs/` where run-stage wrote them.
