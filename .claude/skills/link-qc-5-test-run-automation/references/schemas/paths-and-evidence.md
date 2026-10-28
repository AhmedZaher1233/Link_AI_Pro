# Paths, discovery, roots, repeats and evidence — the one contract

Loaded only when a path, a discovery result or an evidence link needs explaining (the scripts apply it; no routine
activity loads it). Every other file links here instead of restating it.

## 1. Path forms

- **Stored form** (run file `results_root`, `screenshots_root`, `logs_root`, `progress_log`, every `evidence_*` /
  `failure_*` path, every `merged.*` path): POSIX, **relative to the automation root**, no `./`, no trailing slash —
  e.g. `reports/SPEC-x/US-12-orders`, `screenshots/SPEC-x/US-12-orders/phase-2/TC-01/chromium--none--r0/attempt-1.png`.
- **Accepted on input** (and normalised): the stored form, a **project-relative** form whose leading segments are the
  automation root's own trailing segments (`Testing/Automation/screenshots/…`), and an **absolute** path. `run-data.mjs`
  (`canonicalPath`) and `run-stage.mjs` (`canonicalRel`, kept in step) apply the same rule; `merge --write` stores the
  canonical form and names every value it normalised (`paths-normalized`).
- **Report links** are relative to the report's folder (`{results_root}`), computed from the stored form — never written by
  hand.
- Summaries (`artifacts/progress/*.summary.json`) hold `stageJson` / `progressFile` / `watchdogFile` relative to
  `{results_root}`.

## 2. The roots

| Root | Stored as | Holds |
|---|---|---|
| automation root | (the base) | the one shared config, `timeouts.ts`, `helpers/`, `pages/`, `tests/`, `node_modules` or a parent's |
| `results_root` | `reports/{spec_level}{user_story_name}` | the report set, `.runs/`, `artifacts/` (progress, stages, checks, drafts, diagnostics, test-output, reconcile) |
| `screenshots_root` | `screenshots/{spec_level}{user_story_name}` | `phase-{N}/{TC-ID}/{variant}/attempt-{a}.png` — immutable |
| `logs_root` | `automation-logs/{spec_level}{user_story_name}` | the live progress log |

`run-data.mjs locate` derives the automation root from a run file: explicit `--automation-root` → the folder
`results_root` is relative to when it holds a `playwright.config.*` → the folder above the `/reports/` segment.

## 3. Discovery — the project's own tools and config (`scripts/project-env.mjs`)

- **Excluded from every project walk**: dependency / generated output (`node_modules`, `test-results`,
  `playwright-report`, `dist`, `build`, `coverage`, `reports`, `screenshots`, `automation-logs`, `.playwright-cli`) and
  agent / skill installations (`.claude`, `.agents`, `.codex`, `.cursor`, `.windsurf`, `.github/skills`, the manifest's
  `paths.skillsDir`, any folder holding a `SKILL.md`, and `fixtures` / `examples` below a skill). A synced skill's test
  fixtures are never the project's config.
- **Playwright CLI** (`run-stage.mjs`, `scratch.mjs`, `preflight`): `--cli <path>` (relative to `--cwd`, then the project
  root; a missing explicit path is an error, never replaced) → Node's resolution of `@playwright/test`, then `playwright`,
  from the automation root (hoisted / workspace / symlinked installs) → every `node_modules` up to the drive root. Not
  found → the stage is `SPAWN_FAILED` with the locations tried; `--cmd` runs a project command instead.
- **TypeScript / ESLint** (`check.mjs`): the same resolution (`--tsc` / `--eslint` override).
- **The shared config** (`config-inventory.mjs` `shared`, `sharedSource`): explicit (`--config`, task input) →
  `qa-manifest.json` `framework.configFile` → `playwright.config.*` in the automation root → the `--config` / `-c` of a
  `playwright test` package script (automation root, then project root) → `playwright.config.*` at the project root. A
  candidate must import `@playwright/test` and export a config. Several equal candidates → `ambiguous[]` and no `shared` —
  a human names it; a file is never chosen by order and never moved.
- **Effective settings** (`reconcile`): the shared config plus every config module it imports (relative imports that
  define configuration, transitively); a setting is judged — and edited — in the file that holds it; an expression or a
  config package that cannot be read is `unresolved`: nothing is inserted and the protection is not reported active.

## 4. Repeats, retries and attempts

- A variant's slug is `{project}--{variation}--r{repeat}`; `repeat` is `testInfo.repeatEachIndex` (`r0` without
  `--repeat-each`). A **required** `r{n}` exists only when the run plan sets `repeatEach`.
- **Burn-in** (`--repeat-each=3`, workers 1) repeats are **attempts of the required variant** (numbered in command start
  order), never extra variants — even when their evidence folder says `r1` / `r2`; any failing repeat makes the burn-in FAIL.
- An **attempt** = one execution of a variant (first run, smoke retry, isolation, re-run, burn-in repeat, Playwright retry);
  the variant's final status is its latest attempt by command start time.

## 5. Evidence and its pairing

- Image: `{screenshots_root}/phase-{N}/{TC-ID}/{variant}/attempt-{a}.png` at the assertion point; `attempt-{a}-failed.png`
  for a failed attempt; API / DB record `attempt-{a}.record.json` beside it. The evidence helper numbers `{a}` per folder.
- Which attempts owe an image is the run's screenshot choice (`{run_file}.delivery.screenshots`, passed to every command
  as `PW_SCREENSHOTS`): `all` (default) every executed attempt · `failed` only a FAIL attempt (its failure-time screen +
  `-failed.png`) · `none` no image. Records are always owed. An attempt the choice owes nothing is never an
  `evidence_issue` (`run-data.mjs imageOwed`).
- Every capture writes an `evidence` heartbeat `{ at, worker, tc, event: 'evidence', path, kind? }` inside its test's span
  (`test-start` … `test-end`, which carry `worker`, `retry`, `project` and — newer progress reporters — `repeat`).
- **Pairing** (`run-data.mjs pairSpan`): an execution of the stage JSON is paired with ONE heartbeat span by identity —
  the command, the TC, the project, the repeat, the retry and the worker slot (`parallelIndex`); only within that
  identity: the span nearest the result's `startTime` (uniquely, within 5 s), else the span whose evidence sits in this
  identity's folder, else — in a single-worker command — the earliest unpaired span. The evidence is the span's own
  `evidence` event (the TC's folder first). Ambiguity → `evidence_issue` on the attempt and an `evidence-ambiguous`
  warning; nothing found → `null` — check 18 then FAILs naming the attempt. A command without any evidence heartbeat
  (older helpers) falls back to the folder of the same identity (`…/{variant}/attempt-{n}.png`, `n` = that identity's
  execution order). Never a guess, never another test's image.
- A freshness-failed command contributes no result and no evidence (its heartbeats are kept for diagnostics only).

## 6. Requirement ids

`results[].req_id` = the ids every available source agrees on — the run file's existing value, the coverage snapshot's
`requirements[].assertedBy`, the approved TC document's `Requirement` field. Sources that disagree leave
`req_id_conflict` on the row and check 31 `unresolved` — never "the first source wins". No source → check 31 FAIL.

## 7. Live output and diagnostics

- Live progress log (`{logs_root}/…`): one line per command start / end, per test start (`▶ w{n} TC`), per test end
  (`✓` / `✗` / `–` with the first error line), per wait (`⏸`), and the status line on change.
- `artifacts/diagnostics/phase-{N}/{command}/playwright-output.log`: the full Playwright output of that command (stack
  traces, console), plus the stall diagnostics beside it.
- `artifacts/progress/status.json` (`skill5-status/1`): active commands, per-worker `{ command, unit, worker, tc,
  startedAt }`, `done` counts, `waiting { reason, since }`, written on change only.
- Every line of every output is credential-filtered (`[line withheld: it looks like a credential]`).
