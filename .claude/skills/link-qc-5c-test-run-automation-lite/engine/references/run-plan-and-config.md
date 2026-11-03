# The run plan and the ONE shared Playwright config

Loaded by `SKILL.md` at **Writing Automation Code**.

<run_plan>
**Build the RUN PLAN before writing specs.** Parallelism changes duration, never a TC's status (a FAIL beside other
tests is re-run alone; grouping never skips a test because another failed). Output: `{run_file}.run_plan` (written at
PHASE 2.6, updated at run start) + a short summary in the chat and the progress log. **First match wins:**

| Signal | Result |
|---|---|
| The TC IS a PHASE 2.6 UI setup journey (`00-setup-{entity}.spec.ts`) | **setup group** `setup:{entity}`, serial, FIRST (before smoke) |
| PHASE 2.6 created this TC's data | **serial** in `serial:{gap}`, after that gap's setup group; teardown after the group |
| A `[type: env]` line records parallel interference for the TC / screen | **serial** in the group the line names |
| `Shared data: {name}` on two or more TCs | all **serial** in group `{name}` |
| A true chain (a later TC needs data an earlier one created) | **serial** chain group — the only kind with a `mode: 'serial'` describe |
| Wrong credentials / counts toward an account lockout | **serial** `account:{A-ID}`, LAST in its stage; a known lockout duration = cool-down before that account's next sign-in (re-run included) |
| Single-session account, or switches the application language | **serial** in that account's / locale's group |
| **Own data** — creates only its own `uniqueName()` records, or changes / deletes only records it created | **parallel** — unless another parallel TC asserts on a collection that record joins (count, sort, "latest", export, search) → **serial** in the entity's group |
| `Data effect: creates / modifies / deletes`, or a mutating action (*create, add, new, edit, update, save, delete, remove, approve, reject, submit, upload, import, change status, assign*) on records it did not create, or a precondition on data another TC creates | **serial**; group = the `Shared data` value, else the entity / fixture named in steps, Preconditions or Data Oracle, else the screen |
| `Data effect: read-only`, or anything else | **parallel** |
| Cannot decide | **serial** (fail safe), reason recorded |

A rate-limited TC stays in its group (paced). Locale variants share the base TC's class. Decisions driven by TC fields
are `field`, the rest `inferred`. **Machine ceiling — Auto, never asked** (`capacity.mjs`;
`machineMaxWorkers` in the capacity dir's `config.json`, absent → 8; `--workers`, `QA_MAX_WORKERS`,
`execution.maxWorkers` only LOWER it).

**Rate limits — known before the run, never asked** (`[type: env]` lines → application source, cited `file:line` →
TEST-DATA notes → earlier runs), one `rate_limits[]` entry each (fields: maintainers §1; `pace` = limit − 1 per
window unless learned); unknown → detection only. A learned limit → a `[type: env]` line + `run_plan_adjustments[]`
(changes only `PW_RATE_LIMITS`, never code); advertised `RateLimit-*` headers are paced from the first request; group
ceilings include the pacing floor ⌈calls ÷ pace⌉ × window (`run-stage.mjs --ceilings auto --timeouts {timeout_policy}`).

**Required variants per TC:** every project the story runs (`projects[]`) × every data variation of the spec; locale
variants are separate TCs. `variant_slug` = `{project}--{data-variation-slug}--r{repeat}` (`r0`
unless `repeatEach`); a missing required variant = `INCOMPLETE`, never `PASS`. **Test titles** carry the TC id(s) in
brackets and the locale / role / variation as a bracketed tag — `[lang: ar]`, `[role: manager]`, `[variation: …]` (or
the `— variation …` suffix) — so `impact.mjs select` can decide branch-level impact. Shapes of `run_plan` and the
append-only `run_plan_adjustments[]` (applied by `run-stage.mjs` before its first command): maintainers §1.

**Plan → tests:** every title carries, besides `@smoke` / `@positive` / `@negative`, exactly one run tag —
`@run:parallel` or `@run:serial-{group}` (kebab-case). A serial group = its tag + its own `--workers=1` command; stage
order (`<staged_execution>`): parallel group first, then each serial group. `test.describe.configure({ mode: 'serial' })`
ONLY around a true chain (dependency commented above); a follower skipped by a failed predecessor is `NOT_RUN`,
Classification `not started: depends on {TC} (failed)`, and the re-run takes the predecessors with it. Moving a TC =
changing its `@run:` tag only (no re-run) + a `move` adjustment; seeding stays find-or-create. Report `serial_only_s`
vs `planned_s` at run start.
Detail: references/maintainers/run-plan-and-config.md §1
</run_plan>

<parallel_readiness>
**Read-only, every run — what lets tests run side by side.** Once, after `<run_plan>`, before Checkpoint A; its file is
`--units` on every stage call:
```text
node .claude/skills/link-qc-5-test-run-automation/scripts/parallel-plan.mjs --root {automation_root} --spec {this story's spec files} --tc {source_tc_doc} --data {TEST-DATA md} --learning Testing/project-learning.md --run-file {run_file} --env-id {env_id} --out {results_root}/artifacts/parallel-plan.json [--compare]
```
`run-stage.mjs` (scheduler `auto`) DISPATCHES only on an `OK` payload whose `inputs.fingerprint` still matches (else
it re-plans in the same call); a missing / BLOCKED / unrefreshable payload, the ledger off or setup journeys → SERIAL
(workers 1, `scheduler.fallback`); never multi-worker without proof. It derives, with evidence, the
claims and conflicts of every TC, hook and fixture, a class per TC (`parallel-ready` ·
`restricted` · `ordered` · `barrier` · `run-alone` · `not-scheduled`) and never-split units (U1-U4); unknown effects
run alone. **Shared server state is a barrier:** a destructive reset or a SERVER clock change anywhere in the import
closure runs alone. Never change the application or provision per-worker instances to win parallelism.
- **Dispatch:** the conflict-free pool runs in BATCHES (one multi-worker command per max(4 × workers, 8) TCs, never a
  split unit); every other unit is its own child, never two conflicting units at once, a run-alone unit beside nothing
  (25b). RAMP: start at min(2, Auto ceiling); window = max(3, workers) tests and 60 s batch wall time; one +1 trial
  after a healthy window, kept only with ≥ 10 % more throughput per wall minute, else reverted and held; −1 on
  interference, environment-wide throttling or a slower p95; halved on a browser crash; never above the ceiling or
  what admission allows. Record the payload in `{run_file}.parallel_readiness`.
- **Candidate concurrency 1:** `candidateConcurrency` 1 in the payload (or the user lowered workers to 1) →
  every stage runs as ONE `playwright test` process per run-plan group with `--workers=1` — no per-TC processes;
  per-TC processes only for units that run side by side or for an isolation check. The stage message's Workers line
  then reads `serial — readiness: candidate concurrency 1 — one process per group`.
- **`unlockSuggestions[]`** go to the human in the run-start message as findings — never applied automatically.
- **Schedulers:** `--scheduler groups` runs the hand-built `<run_plan>` (legacy); `--scheduler dispatch`
  refuses (BLOCKED) instead of falling back; neither in a normal run. **Shadow** (`--parallel-shadow` → `--compare`):
  `candidatePlan` differences recorded in `{run_file}.parallel_readiness` as findings, never applied.
Detail: references/maintainers/run-plan-and-config.md §2
</parallel_readiness>

<shared_config>
**ONE shared `playwright.config.ts` for every story — updated, consolidated or created; never per-story.** It lives IN
the automation root; `testDir`, `outputDir`, every reporter output and `PW_SCREENSHOTS_ROOT` resolve under it.
Contract `code-craft.md` §8-9; templates under `assets/`. At profile time, before any spec:
1. **Inventory** — `node .claude/skills/link-qc-5-test-run-automation/scripts/config-inventory.mjs --root . [--config {path the user named}]`
   finds the ONE `shared` config, every reference and merge-blocking settings. `ambiguous[]` → ONE question which
   (pipeline → BLOCKED); never pick by order, never move a config to satisfy discovery. `none` → 5; `single` → 4;
   `multiple` → 2-3. A config outside the automation root → 
   `node .claude/skills/link-qc-5-test-run-automation/scripts/config-inventory.mjs reconcile --root {project} --results-root {results_root} --apply --move-config`
   (backup `artifacts/reconcile/`; preflight offers it).
2. **Mergeability** — a candidate only when reproducible with identical results (a `projects[]` entry, an env-driven
   `use` value, a reporter entry); anything else → **kept, not merged**, under `Configurations not merged` with the
   blocking setting. Never guess a merge.
3. **Merge, rewrite, verify, THEN remove** — rewrite EVERY reference; smoke stage once through the shared file; re-run
   the inventory — only a file now in `deletable[]` may be deleted (Placement Manifest: `removed (consolidated from
   <file>)`).
4. **Update in place** to the §8 contract without discarding a valid project setting (the UI project keeps its NAME);
   reporters: ADD `['line']`, the env-driven `json` reporter and `['./helpers/progress-reporter.ts']`, never replace /
   delete / disable one; a setting that differs for a stated reason stays, as a Deviation.
5. **Create** from the templates only when no config exists; register `testDir` / `testMatch`.
5b. **Reconcile the run protections — every run, before the page-object inventory, no question for a routine setting:**
   `node .claude/skills/link-qc-5-test-run-automation/scripts/config-inventory.mjs reconcile --root . --automation-root {automation_root} --results-root {results_root} --run-file {run_file} --apply`
   fixes only supported shapes of the EFFECTIVE settings, idempotently, originals backed up to
   `{results_root}/artifacts/reconcile/{stamp}/` (+ `summary.md`); approved exceptions, secrets / env files, custom
   fixtures and an explicit worker maximum are never touched; `conflicts[]` are reported with file:line, never
   overwritten (protection NOT active); `unresolved` = nothing inserted; item 43 (`tool:protections`) FAILs on a
   disabled protection, `unresolved` on an unresolved one. Message line: `Run protections: {n} changed, {m}
   conflict(s) — {summary.md}`. `reconcile --apply` also installs `helpers/evidence.ts`
   from `assets/evidence.template.ts` (exactly one `evidence` heartbeat per attempt, none for the failure image).
6. **Helpers** — `steps`, `progress-reporter`, `console-guard`, `test-data` templates → `helpers/` when no equivalent
   exists; ALWAYS installed: `network-guard`, `rate-limit`, `admission`, `record`, `redact`, `data-ledger`,
   `api-record`, `db-record`; `db.ts`, `tests/_cleanup/data-ledger.cleanup.api.spec.ts`, the `backend` project and
   `TIMEOUTS.api.request` / `TIMEOUTS.db.query` only for a `[DB]` / data-changing document. An
   existing project also gets the guard hooks in every spec, the `TIMEOUTS.rate_limit` / `stall` / `admission` keys
   of code-craft §9 BEFORE the first run, `test.extend` via `helpers/admission` and the `.gitignore` lines of §12.
   `helpers/test-data.ts` holds the `<normalization>` maps (a role-keyed env layer is extended, never replaced).
   Everything touched → Placement Manifest.
7. **Version gate** — code-craft §14 (< 1.42 → BLOCKED with the upgrade command).

Per-run values reach the config only through the environment variables `run-stage.mjs` sets. `run-stage.mjs` passes
`--config` to Playwright itself; the model never writes `--config`, `--cwd` or `cd`, and never `--reporter`. **Acceptance — whenever this block changes the config
(NOT_RUN when it cannot run):** the smoke stage through the shared file + the one-off probe
`tests/_probe/watchdog-probe.spec.ts` (one `step()`, 5 s deadline around a 60 s action; proofs: maintainers §3);
probe deleted, result in `{run_file}.timeouts.probe` + the return's `Timeouts:` line.
Detail: references/maintainers/run-plan-and-config.md §3
</shared_config>
