# Changelog

All notable changes to the Link_AI_Pro skill suite. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); consumer projects pick a change up on
their next `/sync-skills`, so every entry under *Unreleased* is a release once it is pushed to `main`.

## [Unreleased]

### Skill 5 2.0.0 — Auto workers, dispatch by default, active stall protection, run-protection reconcile

**Implemented, not runtime-tested.** No harness, script, syntax check, Playwright run, browser or benchmark was executed
for this entry; harness expectations the new defaults change were updated statically. No consumer project, installation,
hook or permission rule was touched.

- **link-qc-5-test-run-automation** (still `2.0.0` — unreleased)
  - **Auto worker ceiling** — `capacity.mjs` `autoCeiling` / `resolveCeiling`: min((total memory − reserve) ÷ 1536 MB,
    (cores − reserve) ÷ 1.5) for headed workers, within [1, upper]; `upper` = `config.json machineMaxWorkers` (now an
    upper bound, `"auto"` accepted) else `AUTO_MAX` 8; unusable readings → `AUTO_FALLBACK` 2 with the reason. One shared
    value recorded in the ledger (`ceiling`): a run may lower it, never raise it while anything runs. Session holds and
    probes use it unchanged. `QA_MAX_WORKERS` / manifest / `--workers` still only lower.
  - **Scheduler `auto` (default)** — `run-stage.mjs` dispatches on an OK readiness payload whose new dependency
    fingerprint (`parallel-plan.mjs readinessFingerprint`: code via impact.mjs, TC hashes, TEST-DATA, learning file, run
    plan, environment) matches, re-plans in-process when it does not, and otherwise runs SERIALLY (workers 1,
    `scheduler.fallback`). Explicit `groups` (legacy) and `dispatch` (strict) unchanged. `parallel-plan.mjs --out` writes
    BLOCKED payloads too; `--env-id` added.
  - **Pool batches + adaptive ramp** — the conflict-free pool runs as successive batches (max(4 × workers, 8) TCs, never
    a split unit, reserved / released per batch); `dispatch.mjs createRamp` measures windows by summed monotonic batch
    wall time, accumulates short batches, restarts on another worker count, decreases on environment-wide throttling
    (scoped throttling only blocks an increase), can trial straight to a remembered validated count (`ramp.json`,
    performance history only) and exposes `validated()`. Run-alone / barrier units are marked `global` in the timeline;
    `run-data.mjs verify` 25b now checks they overlapped nothing, checks isolation / burn-in workers under dispatch too,
    and expects workers 1 under the serial fallback.
  - **Active stall protection** — `watchdog.mjs`: fixed deadlines from the step start, open steps as a stack, meaningful
    progress only (helper flag or a rising n/m counter), bounded `admission-wait` / new `rate-wait` budgets
    (`rule: wait-budget`), `--silence-mode` default `active`. `run-stage.mjs`: `--timeouts-mode` default `active`,
    silence default 55 s, `--grace` from `watchdog_grace`. Templates: `timeouts.ts` `stall.silence` 55 s, `diagnostics`
    30 s, `operations` entries may be `{ deadline, silence, reason }`, sanity checks (≤ 60 s single operations, silence +
    grace ≤ 115 s); `steps.ts` `report(note, { done, total } | { milestone })` with `meaningful`, quiet clock on meaningful
    progress / nested steps only, bounded diagnostics, `{ operation }` step option; `rate-limit.ts` `rate-wait`
    heartbeats; `admission.ts` `budget_ms`.
  - **Run-protection reconcile** — `config-inventory.mjs reconcile [--apply]`: effective settings with precise statuses,
    targeted idempotent fixes with a backup in `artifacts/reconcile/{stamp}/`, conflicts never overwritten; `check.mjs`
    item 43 gains `tool:protections` (ED-17 in the register; required units A 64 / B 78).
  - **Visible workers** — headed by default; CI / no desktop → headless, reported (`display`); `status.json` + one log
    line whenever the active worker → TC map changes; a workers line in every stage message.
  - **Telemetry opt-in** (`--telemetry`), reusing the ledger sampler; summaries carry `host` minima / peaks, read by
    `run-data.mjs` concurrency.
  - **Leaner instructions** — SKILL.md rewritten (≈ 150 lines; no harness column, workers never asked, the fresh-session
    line names `run-data.mjs handoff`), INPUT.txt (`VERSION 2.0.0`, harness list removed), references updated at each
    rule's home (`run-plan-and-config.md`, `execution.md`, `code-craft.md` §8-9, `final-run.md`,
    `compliance-checkpoints.md`, `structured-returns.md`, `run-report.md` §3, `rule-registry.md` R13 / R15 / R26 + R38,
    `schemas/script-payloads.md`, `intake.md`).
  - Harnesses updated statically: run-stage (legacy cases pinned to `--scheduler groups`, cases 23 / 31 / 32 / 35, new
    40), watchdog (case 3 inverted, new 13-15), dispatch (new 14), capacity (case 2 rewritten, 19 / 21 bounded at 2),
    check (unit counts, item 43 units), config-inventory (new 8). Golden files unchanged.
- **link-qc-1-generate-update-testing-structure** — `scanExecutionLimits` mirrors the Auto formula (`CAPACITY_AUTO_MAX`,
  `CAPACITY_FALLBACK_CEILING`, `CAPACITY_WORKER_DEMAND`, `capacityAutoCeiling`), reports a `QA_LEDGER` saved at user
  level; the `Execution limits` row WARNs for exclusive / saved-ledger-off / fallback; selftest case 15 updated;
  `toolchain.md`, `validation-contract.md`, `testing-layout.md`.
- **link-qc-9-retesting** — `automation-rerun.md`: the retest call (no readiness payload) runs serially under skill 5's
  default scheduler; ceilings for one worker.
- **Repo** — `CLAUDE.md`, `README.md`.

### Skill 5 2.0.0 — step efficiency (batched checkpoint records, opt-in readiness shadow, concise return, no forced model) and the remaining worker-capacity gaps

All 23 self-test harnesses pass (exit 0) and so does run-stage's ledger-enabled variant (`QA_LEDGER_SELFTEST=on`, 38/38),
run one after another on an otherwise idle machine on 2026-10-26. No consumer project, live benchmark or real Playwright run was executed; no
installation was synced. Nothing below raises a limit, changes a hook or a permission rule, or activates a deferred
experiment.

- **link-qc-5-test-run-automation** (still `2.0.0` — unreleased)
  - **Batched checkpoint records** — `check.mjs record --batch <results.json>` records every semantic result of a
    checkpoint in ONE call. The whole batch is validated first (the single-record rules per entry, no stale snapshot id,
    no second (check, unit) inside the batch or against a recorded result — duplicate or contradictory —, the snapshot
    still re-hashes to itself); any failure rejects the batch and nothing is written; otherwise one atomic replace of
    `results.jsonl`. Single-record mode is unchanged. `compliance-checkpoints.md` step 6 (A) and step 1 (B) use it.
    `selftest-check.mjs` case 19: the gate is identical for one-by-one and batched records; every rejection writes
    nothing. Calls per checkpoint pass on the harness fixture: A 40 → 4 (37 semantic results), B 38 → 5 (34).
  - **The parallel readiness shadow is opt-in** — `parallel-plan.mjs` emits `mode: readiness` by default (claims,
    units, conflicts, pool, readiness — what dispatch needs); `--compare` (mode `shadow`) adds the candidate plan and its
    comparison with the hand plan. A default `groups` run no longer runs the check, records `parallel_readiness` or
    reports it; `--scheduler dispatch` still requires it on every stage, and `run-stage.mjs` now refuses a `--units`
    payload of another schema, one with `outcome: BLOCKED` or without a conflict list. A deliberate shadow experiment is
    `--parallel-shadow` (argument hint, INPUT.txt).
  - **Concise final return** — `structured-returns.md`: the `AUTOMATION COMPLETE` return is a summary (outcome,
    acceptance and gate verdicts, results of record, the three coverage figures, a `Timeouts:` line) plus `Needs
    attention` (failures, every TC that did not pass with its reason, deviations, open quality issues), `Links` (report,
    bug report, evidence, run file, gate records) and `Your decision / action`; the run plan, timeout table, coverage
    tables, Heal Log and compliance tables are linked, not repeated. `BLOCKED` names each open gate item and what would
    close it. Activity names unchanged (skill 12's labels). The timeout record lives in `{run_file}.timeouts`; pointers in
    code-craft, execution, run-plan-and-config, run-report and INPUT.txt updated; the Placement Manifest is shown in the
    Writing Automation Code message.
  - **No forced model** — `model: claude-opus-5` removed from the front matter: skill 5 runs on the model selected for
    the session. CLAUDE.md now says never to set it on skill 5. The other skills' `model:` lines are unchanged.
  - **Reservations are held until every owned process has stopped (fallback included)** — in BOTH modes a command runs
    under `ledger-exec.mjs` and its reservation is released only on a FRESH process table that shows nothing it owns
    alive (`capacity.mjs releaseConfirmed`). Ownership: recorded processes (pid + start), the token on a command line or
    in the environment (`QA_LEDGER_TOKEN`, read from `/proc` on Linux), browser profile markers, children of a recorded
    process that has ENDED (a Windows orphan keeps its dead parent's pid; a parent pid reused by another process fathers
    only children born before the reuse) and their trees. A survivor the table shows with its recorded identity is
    stopped; a child that cannot be birth-ordered holds the slots but is never stopped. No table → the slots stay held
    (`confirmed: none`) and the next command waits with "could not be confirmed stopped"; a waiting reserve confirms it
    as soon as a table can be read; `capacity.mjs release --token <t> --force` is the user-run escape. Exclusive
    commands, probes (`scratch.mjs`) and named session holds are never freed by a PID check. In ledger mode, tracking and
    release no longer use a cached table. `selftest-capacity.mjs` 20 (deterministic tables) and 22 (real processes:
    cancellation, orphaned, reclaimed — only the run's own; a look-alike survives); `selftest-run-stage.mjs` 38 (a
    browser that outlives its command, a failed listing).
  - **Ledger-enabled verification** — `QA_LEDGER_SELFTEST=on` failed 11 of 37 cases because worker counts followed this
    machine's free memory. Fixed: harness seam `QA_CAPACITY_HOST_FIXTURE` (fixed memory / CPU readings for the ledger's
    decisions) and a fixed process table for cases 1-32; cases 33-38 keep the real listing; case 33 now proves the
    scarce-memory lowering deterministically; case 35 proves the 2-worker pool consumes ONE reservation and the reserved
    slots never exceed the ceiling; case 35's ledger-off check sets `QA_LEDGER=off` itself; an explicit telemetry fixture
    wins over the ledger's table. The watchdog timing cases (3, 4, 26, 31) assume an idle machine — they flaked only while
    other harnesses ran beside them.
  - **Adversarial review fixes (three coordination gaps).**
    - *Overlapping environments* — `environmentIdentity` also returns the group's identity `tokens` (every name and
      resolved address); `acquireLease` refuses a request whose tokens meet another run's lease, whatever the ids (a story
      listing `app` and one listing `app` + `api` on the same address used to get two independent leases and two rate-limit
      books). A reclaimable overlapping lease is taken over with `cleanup_incomplete`; a lease written before tokens is
      compared by its member names. `selftest-capacity.mjs` 23.
    - *A refused worker ran its setup* — `workerAdmission` (`assets/admission.template.ts`) now THROWS
      `AdmissionRefusedError` on a timeout / stop instead of handing itself over, so no dependent worker fixture or
      `beforeAll` (seeding, shared login) runs; the next worker under the same published state is refused at once
      (`{PW_ADMISSION_FILE}.refused`, cleared at every call). `run-stage.mjs` maps the error — and a serial follower of it —
      to `NOT_RUN — not started: admission timeout (…)`, never FAIL. `selftest-run-stage.mjs` 27.
    - *Dispatch bypassed the isolation check* — a command now counts as "beside others" when it had workers > 1 OR its run
      overlapped another command of the call (dispatch's single-worker unit children), and the false-PASS guard re-checks
      overlapping passes in every command running at the time, each under its own command's group. `groups` runs are
      unchanged (their commands never overlap). `selftest-run-stage.mjs` 39 (two single-worker units with interference),
      35 (a restricted unit run beside another is now isolated).
  - **Release verification round (root causes of the intermittent harness failures, found with evidence).**
    - *Lock release left an ownerless lock (root cause of the stalls and `FRESHNESS_FAILED`).* Measured with the new
      opt-in `QA_CAPACITY_TRACE={file}` (JSONL of every lock / command-start / ceiling-stop / freshness event): the
      recursive delete of `ledger.lock` failed with **EPERM** while a contender had `owner.json` open (Windows keeps the
      file "delete pending" and refuses the folder); the error was swallowed, the folder stayed without an owner, every
      contender waited it out as "a creator still writing" (30 s), `ledger-exec.mjs` could not register, Playwright never
      started and the command's 20 s ceiling stopped it — every failing case in 6 traced attempts had this chain. Fix: a
      release renames the folder away (retried) and, when Windows refuses, renames `owner.json` to `released-*.json`; a
      marked folder is broken at once; tombstones swept by age; the owner file also carries `nonce`.
      `assets/rate-limit.template.ts` uses the same convention for the book lock. Stress (6 processes × 150 cycles):
      giveups 42 / 36 → 1 / 0, wall time 68 / 39 s → 18 s, no lost update before or after. `selftest-capacity.mjs` 26.
    - *Three CLIs did nothing on an 8.3 / symlinked path.* `watchdog.mjs`, `config-inventory.mjs` and
      `validate-automation.mjs` compared a `file://` string built from `argv[1]` with `import.meta.url`; started through
      `C:\Users\NAME~1\…` they exited 0 with no output (run-stage case 4 under an isolated TEMP). They now compare
      `realpathSync.native` like run-stage / capacity / check.
    - *Lease takeover needs more than a dead owner.* `decideLease` also keeps the lease while any process the dead owner
      started AFTER taking it lives (a shell, a playwright-cli daemon and its browser — none in the ledger), birth-ordered
      and PID-reuse guarded; a child older than the lease (an MCP server) is not the run's. `selftest-capacity.mjs` 24.
    - *Overlapping identities share one rate-limit book.* The ledger's `books` registry maps identity tokens to a book; a
      lease's `bookId` is the oldest book its tokens meet; a request bridging two books merges them (latest `notBefore`,
      every slot, the highest refusal count, the stricter advertisement, the later recovery — never a shorter deadline);
      `validateLease` returns the `bookId` and `run-stage.mjs` points `PW_RATE_LIMIT_STATE` at it. `selftest-capacity.mjs`
      25, `selftest-run-stage.mjs` 37.
    - *Real-Playwright admission test* — new `selftest-admission.mjs` (5 cases) + `fixtures/admission/`: throw-away
      projects from the real templates on a LOCAL Playwright runner (`QA_PLAYWRIGHT_DIR`, a resolvable install or the npm
      npx cache — never installed; NOT_RUN, exit 3, without one). Worker refused by timeout or cancellation: no seeding,
      shared login, per-test login, `beforeAll` or body; every test `NOT_RUN — not started: admission timeout (…)` through
      run-stage's own parser (`classifyTest`, newly exported). A unit refusal skips only its own login and body.
  - Harness counts: run-stage 39, capacity 26, check 19, admission 5 (new; parallel-plan 13 and scratch 14 unchanged).
    No golden file changed.
- **link-qc-3c-validate-manual-test-cases-cli** / **link-qc-5b-test-run-manual-cli** — every playwright-cli session takes
  one hold under the machine's Playwright worker ceiling BEFORE its `open` (skill 5's `capacity.mjs hold acquire
  --session {-s= name}`, called by path; `hold track` after the open; `hold release --wait` after the close, released only
  when a process table shows the session's daemon and browser ended). At the ceiling after 10 min: 3c BLOCKED, 5b the
  account's remaining TCs `NOT_RUN — not started: admission timeout (machine at its worker ceiling)`. Skill 5 not installed
  → BLOCKED. `allowed-tools` gains `Bash(node *capacity.mjs*)`; INPUT.txt lists skill 5 as a prerequisite.
- **link-qc-9-retesting** — the same session holds (`--session`, `hold track`, confirmed `hold release`) in
  `references/coordination.md`; the lease is unchanged.
- **Session holds** (`capacity.mjs`) — one per session name: acquiring it again reuses it (never counted twice), a hold
  whose owner is gone is adopted, another live owner's session is refused; an abandoned hold stays held while its session
  runs; a hold whose owner lives but whose session closed without a release is freed after 2 min (15 min when never seen —
  the acquire → open window). Holds without `--session` keep the old behaviour. `selftest-capacity.mjs` 21.
- **Repo** — `CLAUDE.md` (scripts, conventions, hard rules, pre-commit list incl. the ledger-enabled variant), `README.md`.

### Skill 5 2.0.0 — cross-skill completion: skill 9 coordination, skill 1 execution limits, skill 3 data semantics, the rollback hard cap, the parity register

All 23 self-test harnesses were run and pass (the fixes they forced are listed below); no consumer project, live
benchmark or real Playwright run was executed — Phase 0b and the live acceptance stay with the user. Nothing below
activates a deferred experiment or the pending permission allow rules (B17).

- **link-qc-5-test-run-automation** (still `2.0.0` — unreleased)
  - **Rollback hard cap** — `QA_LEDGER=off` / `--no-ledger` and a failed process listing no longer launch
    uncoordinated: every command takes an EXCLUSIVE, PID-judged reservation in the same ledger file (one Playwright
    command at a time on the machine, workers ≤ the ceiling; no pressure admission, tree tracking or dispatch); an
    unwritable coordination directory or unreadable ledger → `BLOCKED` "no safe coordination", TCs `not started: no
    safe coordination (…)` (counted by run acceptance). Rolling back only the dispatcher is `--scheduler groups`.
    `scratch.mjs` probes now hold one slot under the ceiling (`--max-wait`, `--capacity-dir`; refused `capacity` /
    `no-coordination`). `capacity.mjs`: exclusive reservations, PID-judged entries (pruned in every reserve and by a
    tableless sweep), session holds (`hold acquire | release`) and lease validation by run file.
  - **B18 / B22 expected-difference register** — new `references/expected-differences.md`: every one of the 54
    checks marked `identical` (20) or `differs: ED-n` (34) against the 1.2.0 checklist, 16 EDs (3 protocol-wide), all
    stricter or equal, status PROPOSED — awaiting review; `selftest-check.mjs` case 18 ties it to `CHECKS`.
  - **Defects the harnesses found and fixed** — the dispatcher dropped a unit whose reservation was refused and then
    waited 10 min (`dispatch.mjs` `requeue`, case 13); `run-stage.mjs` passed no ledger to its commands under
    `--scheduler dispatch` / the ledger (`ctx.ledger`); a DNS lookup that never settles hung the identity resolver
    (un-`unref`'d timeout); `parallel-plan.mjs` read "the" in "Check the total" as a collection and claimed an edit of
    a token-named record only on its collection (now also `rec:D{n}` — a reader of `[D3]` is kept apart from the TC
    that edits `[D3]`); `run-data.mjs` acceptance now counts `no safe coordination`.
  - Harness counts: run-stage 37 (36 rollback hard cap, 37 skill 9's call shapes beside skill 5), run-report 36
    (skill 9's in-place update of a 1.x and a 2.0 run file), capacity 19, check 18, scratch 14, parallel-plan 13,
    dispatch 13. No golden file changed.
- **link-qc-5b-test-run-manual-cli** — `selftest-run-report.mjs` mirror (case 36); renderer and goldens unchanged.
- **link-qc-9-retesting** — takes its OWN environment lease before anything touches the environment
  (`capacity.mjs lease acquire --run-id skill9-… --run-file {phase-N}`; held by a skill 5 run or another retest →
  BLOCKED naming it), passes `--env-id` to every `run-stage.mjs` call, holds one capacity slot per open playwright-cli
  browser, releases both at the end; skill 5 absent → BLOCKED (was: fall back to playwright-cli). New
  `references/coordination.md`; `allowed-tools` gains `Bash(node *capacity.mjs*)`; `report-update.md` covers 2.0 run
  files (gate records never edited, the amended page rendered without `--gate`). Older call shapes without
  `--env-id` still run (with run-stage's warning).
- **link-qc-1-generate-update-testing-structure** — rows `Execution limits` (machine ceiling, its source, lower-only
  overrides, `QA_LEDGER=off` = exclusive) and `Coordination directory` (writable, ledger readable — FAIL otherwise:
  skills 5 / 9 would refuse to launch); `scanExecutionLimits` in `lib.mjs` (read-only; never writes `config.json`,
  never raises a limit); `preflight.executionLimits`; setup guidance in `references/toolchain.md`, the optional
  manifest key `execution.maxWorkers` in `testing-layout.md`; selftest case 15. Separate from B17.
- **link-qc-3-generate-manual-test-cases** — `Data effect` (one value, the strongest; `creates` = only its own
  records) and `Shared data` (state shared, the same words in each TC, `(depends on TC-x)`) redefined to match the
  parallel planner, with a worked table (`tc-design.md` "Data effect and Shared data"), `deliverables.md` and
  self-review check 14. Vocabulary unchanged: no renderer, golden or TC-hash change; existing approved documents are
  not rewritten (both fields are in the TC hash — editing them later is a design change). 3b / 3c / 5b only use
  "`Data effect` ≠ read-only = data-changing" — unchanged.
- **link-qc-12-adhd-output-style** — verified, unchanged: the eight activity names and run-stage's labels are
  byte-identical to 1.2.0.
- **Repo** — `CLAUDE.md`, `README.md`.

### Skill 5 2.0.0: performance optimisation — Phases 1-3 of the plan (Revision 3.1)

Written before the cross-skill completion above; its harnesses have since been run (see there). Experiments that need separate approval (reduced isolation / burn-in, session reuse, parallel reviewer
subagents, model routing, subagent delegation, `context: fork`, repair batching, locator preflight) are NOT
implemented; persistent permission allow rules are an open decision; the dispatcher, the ramp, the silence rule
and incremental Checkpoint B ship opt-in / in shadow.

- **link-qc-5-test-run-automation** — `metadata.version: "2.0.0"` (MAJOR: stricter gate semantics — gate-record
  files decide both checkpoints, missing / stale / contradictory / duplicate results block; a run must be ACCEPTED;
  a smoke stage with no PASS / FAIL is NO VERDICT and blocks the first run's positive / negative; the report set is
  published only after Checkpoint B; `rate_limited` narrowed to the failing step's own throttled request).
  - **Capacity and coordination (B21)** — new `scripts/capacity.mjs` + `scripts/ledger-exec.mjs`: the machine
    ceiling (`{QA_CAPACITY_DIR | ~/.link-ai-pro/capacity}/config.json`, default 2, lower-only overrides), the atomic
    capacity ledger (owner-file lock, two-phase spawn with self-registration, descendant / browser-profile tracking,
    release only when the tree is gone, sweep, user-run `reclaim`), committed-demand admission, the pressure monitor,
    and the environment lease (canonical host identity with alias / CNAME / shared-address grouping; acquired at
    intake, released at close-out). `run-stage.mjs` runs every command inside it (default on; `--no-ledger` /
    `QA_LEDGER=off` — exclusive execution, see the completion entry above), lowers a group to the ceiling and to what free memory / CPU admit, holds new commands and —
    through the new admission file — new tests back under host pressure, refuses to start without the lease
    (`--env-id`) and shares the rate-limit book per environment. Harness `selftest-capacity.mjs` (17).
  - **Compliance (A4, A14, A15, B18, B22, B7 shadow, B20)** — new `scripts/check.mjs`: `snapshot`, `run` (type
    check + validator + config inventory + optional typed lint in ONE call within the compliance limit, compact
    output, the timeouts report), `record`, `gate` (the result protocol, N/A predicates, the never-N/A list, re-hash
    voiding, gate records `.runs/phase-N.checkpoint-{A|B}.json`), `carry` (incremental B — shadow only), `harness`
    (a harness pass reused per exact key). The checklist splits items 16, 25, 46 and 48 into code (a) and runtime
    (b) halves. Harness `selftest-check.mjs` (17).
  - **Deterministic report data and publication (A6, A7, B22, run-level acceptance)** — new `scripts/run-data.mjs`
    (`merge`, `report` / `readiness` fragments, `handoff`, `verify` — the runtime checks —, `acceptance`,
    `draft-init`, `publish`) and `scripts/coverage.mjs`; drafts → freeze → Checkpoint B → publish byte for byte
    (`<publication>`), run acceptance (`<run_acceptance>`). Harnesses `selftest-run-data.mjs` (10),
    `selftest-coverage.mjs` (6).
  - **Parallel readiness and dispatch (B1 shadow, B2, B3, B5)** — new `scripts/parallel-plan.mjs` (claims, units
    U1-U4, conflicts, classes, a candidate plan compared with the hand plan — shadow) and `scripts/dispatch.mjs`
    (scheduler + ramp); `run-stage.mjs --scheduler dispatch --units …` (opt-in, refused without the ledger; smoke is
    the W0 preflight). `impact.mjs reverse` + `closureOf()`. Harnesses `selftest-parallel-plan.mjs` (12),
    `selftest-dispatch.mjs` (12), `selftest-impact.mjs` 40 → 44.
  - **Rate limits (B4) and failure preservation (B23)** — server deadlines never shortened or capped, a deadline
    beyond `--max-wait` defers the TC (`not started: deferred until …`), a mid-step wait budget below the deadline is
    `interrupted: wait budget exhausted (…)`, 503 + `Retry-After` without rate-limit headers is temporary
    unavailability, refusals cool down only their scope (workers drop only for environment-wide refusals);
    interference keeps the first failure and gets a cause from evidence. `selftest-run-stage.mjs` 23 → 35 (case 16
    now asserts scoped cool-downs; cases 24-35 the new paths).
  - **Smart timeouts (A15, B9 behind a switch), A10, B16a / B16b** — `watchdog.mjs` reads the helpers'
    informational heartbeats and adds the silence rule (shadow by default, `--silence-mode active`); `run-stage.mjs`
    records `timeouts_shadow`, computes `--ceilings auto --timeouts timeouts.ts` and proposes
    `run_plan_adjustments[]`; the smoke gate counts PASS + FAIL only; smoke retries count toward the 2 heal
    iterations.
  - **Validator (A3, A9, B8)** — `--summary` / `--out`, `--page-scan`, six staged review rules
    (`constant-redeclared`, `empty-catch`, `timeout-literal`, `console-guard-missing`, `network-guard-missing`,
    `admission-contract`), `RULE_CHECKS`; `selftest.mjs` 18 → 26.
  - **Templates** — new `assets/admission.template.ts` (always installed); `rate-limit`, `network-guard`, `steps`
    (stall detector), `console-guard` (`teardown` / `console-report` heartbeats), `test-data` (`PW_LANE`,
    `currentAccount()`), `timeouts` (`stall.silence`, `admission.max_wait`, finite action / navigation),
    `progress-reporter` (annotations), `playwright.config` (new environment variables).
  - **Instructions (A1, A2, A5, A8)** — the fresh-session line, plain script command shapes, the first-draft card,
    `references/rule-registry.md` (one home per rule, checked by `selftest-references.mjs` case 4) and
    `references/schemas/script-payloads.md`; new blocks `<capacity_and_lease>`, `<parallel_readiness>`,
    `<publication>`, `<run_acceptance>`; SKILL.md workflow, rules, scripts table and `allowed-tools`; INPUT.txt.
  - Renderer (`render-run-report.mjs`, mirrored in 5b): `--base` (drafts), `--gate` (gate hash in the provenance),
    `NO VERDICT` smoke word — backward compatible, no golden regenerated; `selftest-run-report.mjs` 32 → 35.
- **link-qc-5b-test-run-manual-cli** — the byte-identical renderer and harness mirror updated with skill 5's.
- **Repo** — CLAUDE.md (scripts, harness count 17 → 23, checklists), README (skill 5 section, harness list).

### Skill 5 1.2.0: performance baseline instrumentation (Phase 0 of the optimisation plan)

Measurement only — nothing a run does, decides or reports changes.

- **link-qc-5-test-run-automation** — `metadata.version: "1.2.0"` (MINOR: new script, new summary field, new flags).
  - New `scripts/profile-run.mjs`: measures a finished run for a performance baseline. From a Claude Code transcript
    (optional labelled `--windows`, e.g. skill-5 work vs side work): API calls, cache reads / writes, uncached input,
    output, context per call and its segments (start size, growth per call), full-prefix cache writes, tool calls by
    category, approval paths with p50 / p90, and the model / tool / background-wait / user-wait time split (active time
    = wall span − waits for the user). From a story's `artifacts/progress`: Playwright time, executions per TC, workers
    and average concurrency, hung and login steps, telemetry peaks. Read-only; aggregates only — no transcript text,
    command, path, step title or note is ever printed. Harness `selftest-profile-run.mjs` (7 cases, hand-computed
    fixture values, a no-leak check).
  - `run-stage.mjs`: every stage summary carries `telemetry` (`skill5-telemetry/1`) — host memory / CPU and event-loop
    lag every `--telemetry-interval` (2 s), the running command's process tree (count, working set) every
    `--tree-interval` (30 s), per command. **Observe only**: no decision, gate, command or report reads it;
    `--no-telemetry` switches it off. `selftest-run-stage.mjs` case 23 proves identical statuses, counts and
    Playwright command lines with and without it, and checks the cycle-safe process-tree walk.
  - Docs: SKILL.md Scripts table, execution.md (`<live_progress>` payload / summary), run-report.md §3.
- **Repo** — CLAUDE.md (script list, run-stage telemetry, the profiler, seventeen harnesses), README (script / reference
  counts, harness list).

### Skill 5 1.1.0, skill 1: five defects found in the skill 5 review fixed at the root

Each fix has a regression test that fails on the old code and passes on the new.

- **link-qc-5-test-run-automation** — `metadata.version: "1.1.0"` (MINOR: new payload fields, new harness).
  - `run-stage.mjs`: Playwright wipes its outputDir before every command, and every command shared
    `artifacts/test-output/` — the next group, the isolation check or the next stage deleted the traces and failure
    screenshots the heal still needed (and `failures[].screenshot` pointed at deleted files). Every command now gets
    its own `artifacts/test-output/phase-{N}/{stage}-{group}[-attempt{n}]/` (payload `groups[].outputDir`; the
    attempt number also counts these folders, so none is reused); `pruneOutput` removes earlier phases' folders and the
    old flat layout at each call and keeps the phase's newest 100 (`output_pruned[]`, a warning when this phase is
    trimmed); `--extra last-failed` gets the previous command's `.last-run.json` seeded (Playwright reads it before
    wiping). `selftest-run-stage.mjs` case 22; the fake Playwright now wipes its outputDir and writes per-test
    failure files and `.last-run.json` like the real one. Docs: run-report.md §3, results-and-evidence.md, INPUT.txt,
    the config template's `PW_OUTPUT_DIR` comment.
  - Heal Log: execution.md's timeout calibration said "column 7 = the evidence path", but column 7 is the
    Approved-requirement reference (automation-rules.md §5). It now names the columns: Reason = the evidence path,
    Approved-requirement reference `n/a — no expected value changed`. Every other Heal Log reference checked
    (run-report.md, structured-returns.md, the fixture report and run file, the timeouts template) — consistent.
  - Smoke-gate STOP: it needs `<bug_report_format>` and the report contract, which loaded only at Workflow rows 7-8,
    after the stop. Workflow row 5 now loads `final-run.md` + row 8's references only at a smoke-gate stop, and the STOP (and
    the honest stop after two smoke retries) says to load them; final-run.md's header notes that step 1 does not
    apply there. Normal runs load nothing earlier.
  - `scripts/selftest-references.mjs` (new, 3 cases): Heal Log columns cited by name and matching §5, the smoke-gate
    STOP's needs loaded by the stopping activity, the block index against the blocks.
  - Token cost: the wording added for these fixes is offset by trims in the passages it touched (duplicated label,
    slicing and "read my comments" wording, a shorter SKILL.md intro): SKILL.md 13.7 → 13.6 KB; a full run's
    mandatory loads 265,195 → 265,194 B (net ≈ −3 tokens).
- **link-qc-1-generate-update-testing-structure** — `sync-qa-skills.mjs`: a repeated `--only` kept only the last
  skill (`parseArgs` keeps the last value; its shape is mirrored in skill 5's scan-lib, so it stays) — `only` now
  comes from `lib.mjs` `argValues()` (every repeated value, a comma list too; a single `--only` unchanged); the
  `summary` keyed `MISSING-IN-SOURCE` as `missing_in-source` (only the first dash replaced) — now `syncSummary()`
  (`missing_in_source`). `selftest.mjs` case 14; `references/skills-sync.md` (repeat `--only`, the summary keys).
- **Docs**: CLAUDE.md (run-stage outputDir, the references harness, sixteen harnesses, skill 1 case 14), README
  (version, harness list), skill 5 `INPUT.txt`.

### Skill 5 1.0.0: scratch investigation runner, skill versions in /sync-skills, lighter references

Skill 5 had no way to look at the live application during a heal without running a whole stage, no
version a consumer project could see, and references that re-explained standard Playwright and restated
the same rule in several files. It now has a probe runner that reuses the project's own Playwright, a
semantic version that `/sync-skills` reports, and about 18 % less instruction text over a full run with
every gate kept.

- **link-qc-5-test-run-automation** — `metadata.version: "1.0.0"` (first versioned release).
  - `scripts/scratch.mjs` (new): `run` executes ONE probe from `{automation_root}/test-results/qa-scratch/`
    with the consumer's own `@playwright/test` through a generated overlay `scratch.config.ts` over the shared
    config (1 worker, no retries, list + json reporter, trace + screenshot on, no globalSetup, one project);
    run-stage variables removed; refuses a probe outside the folder or one with `captureEvidence`, its own
    screenshot, `storageState`, file writes, `process.env`, a printed credential or a TC id, and refuses while
    a stage's progress file is fresh; credential filtering, a write outside `test-results/` → `violation`;
    payload `kind: investigation`, `officialResult: false`. `clean` removes the folder. Checked by hand against
    a real `@playwright/test` 1.63 (overlay loads, project globalSetup / reporter skipped, a browser probe runs).
  - `scripts/selftest-scratch.mjs` + `fixtures/scratch/` (new, 13 cases) — refusals, overlay, environment,
    secrets, payload, timeout kill, write guard, clean, and the probe being invisible to
    `validate-automation.mjs`, `impact.mjs` and `config-inventory.mjs`.
  - `references/scratch-investigation.md` (new, `<scratch_investigation>`): when (source + trace cannot
    decide), how, and the limits; loaded only at an AMBIGUOUS selector or an unexplained failure. Wired into
    `<selector_resolution>`, `<first_run>` step 3, the run-stage rule of SKILL.md, `allowed-tools`, and
    Checkpoint B / `<quality_checklist>` through new compliance item 50 (no probe left or cited).
  - Token optimization (no gate removed; every `<tag>`, § and step number kept): generic Playwright
    explanations removed; one home per rule with pointers elsewhere — compliance-checkpoints old §3 / §4
    became pointers to §3a / §4a, `<quality_checklist>` one line per check naming its home, validator.md no
    longer mirrors `RULES` / `LIMITS` (the payload carries them), execution.md no longer narrates
    `run-stage.mjs` internals, final-run.md field lists instead of JSON examples, run-report.md renderer
    internals shortened. SKILL.md 15.3 → 13.7 KB; SKILL.md + mandatory references over a full run 322 → 265 KB
    (≈ 79.7k → 65.7k tokens, chars ÷ 4). Pointer fixes: final-run "§6" → §7 (run-file schema), "§4" → §4a,
    intake's broken troubleshooting link and the no-op legacy-heading note (`(skill 6)` → `(skill 5)`),
    execution's "readiness gate second" → third.
- **link-qc-1-generate-update-testing-structure** — skill versions: `lib.mjs` `skillVersion` (front-matter
  `metadata.version`), `compareSemver`, `versionStatus`, `scanSuite().versions`; `sync-qa-skills.mjs` reports
  `versions[]` (installed / source / status; `installedAfter` on `--apply`, `installedBefore` across a self
  re-run); `validate-setup.mjs` lists installed versions in `QA Skills` and WARNs `Skills current` when one is
  behind; `selftest.mjs` case 13; `references/skills-sync.md`, `validation-contract.md`, `output-format.md`.
- **commands/sync-skills.md** — the report table gains the version column and the outdated-skills line.
- **Docs**: CLAUDE.md (layout, skill versions and bump rule, scratch runner, validator wording, fifteen
  harnesses), README (skill 5: references, scratch investigation, version; Keeping projects up to date:
  versions; Contributing: bump rule; harness list), skill 5 `INPUT.txt`.

### Skill 9: retest through the automation or playwright-cli, update the run report in place, attach evidence after the close

A retest replayed a bug's steps through the Playwright MCP and was not allowed to touch the run report, so a
fixed bug never changed a TC's status or the story's pass rate (user decisions, 2026-10-19: an automated TC is
re-run from skill 5's automation code; every other bug is retested through playwright-cli; the Playwright MCP
is no longer used by skill 9; the LATEST run-report phase is updated in place; the evidence is uploaded to the
Azure bug after it is closed or reopened).

- **link-qc-9-retesting**
  - `SKILL.md` / `INPUT.txt` rewritten: one route per bug (automation re-run · playwright-cli), the probe and
    the ONE combined ask cover only what the chosen routes need, the Azure order is state transition → read
    back → evidence upload → read back, the summary gains the route, the TC row before → after, the pass rate
    before → after and the page gate. `allowed-tools`: skill 5's `run-stage.mjs` / `impact.mjs` /
    `render-run-report.mjs`, the two `playwright-cli` forms, `mcp__azure-devops` and the two attachment tools;
    `mcp__playwright` removed.
  - New `references/automation-rerun.md`: route decision (`impact.mjs fingerprint` + the latest phase's run
    plan), runner readiness, one background `run-stage.mjs --run rerun` call per stage against
    `.runs/phase-N.json`, the verdict table (a test-code / environment / rate-limit failure is no verdict and
    goes to skill 5; skill 9 never edits automation code), evidence.
  - New `references/browser-cli.md`: the playwright-cli route adapted from 5b (full TC when it has a row in the
    latest phase, else the bug's own steps; sessions `qa9-…`, attended / secret-name login, step → command map,
    evidence under `retest-cli--{lang}--r1`, hygiene).
  - New `references/report-update.md`: the in-place update of the latest phase (Results rows, a
    `{Stage} (retest — skill 9)` row, Total, Outcome, Bugs table, Retest bullet, Deviations, header, run-history
    row), the matching `.runs/phase-N.json` edits (`retests[]` append-only), the bug report, and the render
    (dry run to gate PASS with no mismatch, then `--write`). Verified on skill 5's run-report fixture: gate PASS,
    no mismatches, pass count 2 → 3 of 5.
- **link-qc-7 / 8 / 9** — `references/qc-contract.md` (mirror, three identical hashes): §6 retest evidence name
  `BUG-{n}-{TC-ID}-phase-{N}-retest-{variant}-{file}` and the state-then-upload order; §7 rewritten (routes, no
  Playwright MCP, the in-place latest-phase rule replaces "no run JSON or historical phase edits").
- **link-qc-5-test-run-automation** — `references/run-report.md` §3 / §4 / §5 / §7, `results-and-evidence.md`
  and the `SKILL.md` history rule document the one exception: skill 9 updates the LATEST phase in place. No
  script, template or golden changed.
- **link-qc-5b-test-run-manual-cli** — `SKILL.md`, `references/run-report-manual.md` and `execution-rules.md`
  name the same exception.
- **link-qc-1-generate-update-testing-structure** — playwright-cli and the browser secrets file now serve skills
  3c, 5b and 9 (`preflight.mjs` warns when skill 9 is installed without the CLI; row texts in
  `validate-setup.mjs`, hints in `sync-qa-skills.mjs`, comments in `lib.mjs` and the secrets scripts,
  `SKILL.md`, `INPUT.txt`, `toolchain.md`, `mcp-setup.md`, `validation-contract.md`, `skills-sync.md`,
  `output-format.md`, `run-modes.md`, `testing-layout.md`).
- **link-qc-12-adhd-output-style** — the skill 9 row, grouping, timing and status example.
- **Docs**: README (layout line, pipeline box, `### 9 — retesting`, MCP table, playwright-cli scope, Azure loop
  line), CLAUDE.md (layout, secrets / `--tools` scope, skill 9 `allowed-tools` convention, a hard rule, the Azure
  loop MCP rule and the producer-documents exception).

### Skill 5: targeted re-run instead of the clean full re-run; parallelism that never changes a status

The final run re-ran every TC, so a 30-TC story ran at least twice, and side-by-side tests could turn a
correct TC red when the application rate-limits a service (user decisions, 2026-10-19: re-run only what a
fix touched; app-bug failures keep their first-run result; no storageState — every test keeps logging in
through the UI and login is paced instead; rate limits are detected and learned, never asked; the second
pass is called "re-run").

- **link-qc-5-test-run-automation**
  - New `scripts/impact.mjs` + `selftest-impact.mjs` + `fixtures/impact/` (a mini POM project): a per-TC
    code fingerprint (test call, hooks, spec / describe remainders, page-object members reached —
    class-aware, by-name fallback across the import closure, never a name guess —, closure-module
    remainders, re-exports, tsconfig `paths`, `timeouts.ts` per key, config / Playwright version / data
    files / setup journeys; `@run:` tags, comments, whitespace and a describe's `mode` never count;
    anything dynamic = always stale) and `select` (stale / fresh / no verdict / never run / shared-test
    closure / outside scope). Read-only and fail-safe.
  - `<second_run>` (`references/final-run.md`) is now the **re-run**: after the heal, only the stale TCs
    and the TCs without a verdict run again (`run-stage.mjs --run rerun`, healed TCs with `--burn-in`),
    their attempts merge into the same phase (latest attempt by start time wins), everything else keeps
    its first-run result, "Re-run not needed" when nothing changed; Checkpoint B gains the per-TC
    results-freshness check (`stale: []`) instead of "any result older than the last change → BLOCKED".
    Activity 7 is "Re-running Fixed & Impacted Tests"; stage labels "(first run)" / "(re-run)".
  - `run-stage.mjs`: `--run first|rerun` (`final` refused with a hint); attempt numbers per command;
    `--burn-in` (workers 1, `--repeat-each=3`, ceiling × 3, any failing repeat = FAIL); the automatic
    **isolation check** (a FAIL beside other tests, or with a refused request inside its failing step, is
    re-run alone after a `Retry-After` cool-down — `--cooldown` / `--cooldown-max`; pass alone = parallel
    interference and the overlapping tests are re-checked alone; refused again = INCOMPLETE `rate_limited`;
    mass-failure breaker); refusals slow the rest of the stage (cool-down, half the workers, scaled
    ceiling); `run_plan_adjustments[]` applied; serial-chain followers NOT_RUN "depends on"; phase-wide
    cumulative counts and smoke gate (by start time, fail % over TCs with a verdict); per-call code
    fingerprints in every summary; `PW_RATE_LIMIT_FILE` / `PW_RATE_LIMIT_STATE` / `PW_RATE_LIMITS`.
    `selftest-run-stage.mjs` 13 → 21 cases; the fake Playwright nests describes, repeats, runs side by
    side and writes 429 records.
  - New assets `network-guard.template.ts` (records 429 / 503 + Retry-After and policy headers for the
    application's own origins; reserves start-of-test slots before any step opens) and
    `rate-limit.template.ts` (cross-worker sliding window from `PW_RATE_LIMITS`; `rateLimitSlot` for a
    mid-test call); `timeouts.template.ts` gains `rate_limit {max_start_wait, in_step_wait, cooldown,
    cooldown_max}`; the config template documents the new env vars and chain-only serial describes.
  - Run plan (`references/run-plan-and-config.md`): the guarantee "parallelism never changes a status";
    own-data TCs may run parallel; lockout TCs in an `account:{A-ID}` lane; `rate_limits[]`; serial
    describe only for a true chain. Prose in sync: SKILL.md, INPUT.txt, references `execution`,
    `code-generation`, `code-craft`, `compliance-checkpoints`, `structured-returns`, `run-report`,
    `automation-rules`, `azure-devops`, `intake`, `results-and-evidence`, `test-data-readiness`.
  - Renderer: `rate_limited` in the classification catalogue and the sort order; INCOMPLETE rows accept
    `rate_limited` / `interrupted: …` / `cleanup_incomplete` and the documented `interrupted:` /
    `not started:` reasons no longer warn; `selftest-run-report.mjs` case 32; goldens regenerated (sort
    order only).
- **link-qc-5b-test-run-manual-cli**: byte-identical copies of the renderer, its harness, the template and
  the run-report goldens; the manual-run golden regenerated (sort order only). No behaviour change.
- **link-qc-12-adhd-output-style**: re-run label and example, isolation-check line, "results of record".
- **Docs**: README (skill 5 parallelism and targeted re-run, harness list); CLAUDE.md (layout, scripts,
  impact.mjs, hard rules, keep-in-step list, fourteen harnesses).

### Skill 5: lighter instructions, stage-based progress, activity names

Skill 5 carried a 2,848-line `SKILL.md` (~56k tokens) on every turn and polled its test runs from
the model. It now loads ~14 KB up front, reads each activity's reference once, runs every stage as
one monitored script call, and reports once per finished stage with activity names (user decision,
2026-10-16). No rule, gate or checkpoint changed; the `## Phase N` run counter of the report is
unchanged.

- **link-qc-5-test-run-automation**
  - `SKILL.md` is now a ~180-line orchestrator: the role, the rules that hold in every activity,
    the workflow (activity · internal step · what · which reference to load), a block index, the
    scripts, modes and returns. Every block moved byte for byte into one reference per activity
    and kept its `<tag>`, so every pointer still resolves: `intake.md`, `results-and-evidence.md`,
    `azure-devops.md` (loaded only when `ADO-MAP.md` exists), `code-generation.md`,
    `run-plan-and-config.md`, `open-questions.md` (only when a TC was parked), `coverage.md`,
    `test-data-readiness.md` + `test-data-preparation.md` (the twelve principles, byte-identical
    with 3b / 3c / 5b — only when an item is missing), `execution.md`, `final-run.md`,
    `structured-returns.md` (end only). `<checkpoint_a>` / `<checkpoint_b>` moved verbatim into
    `compliance-checkpoints.md` §3a / §4a (one self-reference re-pointed). `run-report.md` now loads
    only at the final report. Each reference is loaded once.
  - Duplicates removed: `<source_of_truth>`, `<test_modifiers>`, `<wait_policy>` and the coverage
    "three numbers" section are short forms pointing to `automation-rules.md` §1-§4 / §6; the few
    sentences that existed only in SKILL.md moved there first.
  - Description cut from ~6,300 to ~800 characters, trigger phrases first (two added: "write
    Playwright automation for the user story", "execute the automated tests"); the old one was
    truncated in the skill listing before its triggers.
  - New `scripts/run-stage.mjs`: runs ONE stage (every run-plan group in plan order, one command per
    group from the project's `cli.js`, no shell), sets the `PW_*` environment and the next free
    `-attempt{n}`, builds ONE lookahead `--grep` with tag-end guards (the "do repeated `--grep` flags
    AND?" check is gone), refuses `--reporter` / `--config` / `--retries`, runs `watchdog.mjs` every
    few seconds on a stage-filtered group file, kills the process tree only on `FROZEN` — or past
    `PW_GLOBAL_TIMEOUT` + margin as a new outer-ceiling stop —, applies the freshness gate, writes a
    tailable progress log (line output, 30 s status lines, credential-looking lines withheld) and
    returns one compact payload + a stage summary with the ready, cumulative stage message.
    `selftest-run-stage.mjs` + `fixtures/run-stage/` (a fake Playwright that misbehaves on purpose):
    13 cases.
  - `<live_progress>` rewritten: one message at run start, one per finished stage (Smoke; Positive
    and Negative cumulative), immediate messages for a stop or blocker; nothing on a timer, per
    poll or per activity change; labels are activity names (Reviewing Requirements & Test Cases …
    Preparing Final Report, "first run" / "final run"), never "Phase N". `<staged_execution>`,
    `<first_run>` steps 0 / 1 / 4 and `<second_run>` step 1 run through the script; `artifacts/progress/`
    is emptied with `artifacts/stages/` at phase start. Structured returns: "Final run — Results",
    "Run number", "Activities completed"; two checklist items follow the new execution.
  - `watchdog.mjs`: a test covering several TCs that is in flight at a freeze is now reported
    interrupted for each TC (was "not started"); `--stop-reason` names a non-freeze stop in the
    reasons (the outer-ceiling kill). `selftest-watchdog.mjs` cases 11-12; golden unchanged.
  - `references/run-report.md` §3 (`*.plan.json`, `*.summary.json`, the watchdog file on a ceiling
    stop, the attempt rule), §4 (ceiling-stop reasons), §7 (`watchdog_events[].action`);
    `automation-rules.md`, `code-craft.md` §9, `INPUT.txt` (progress you see, artifacts, harness counts).
- **link-qc-12-adhd-output-style**: skill 5's progress is per stage with activity names (§E,
  `qa-pipeline.md` §2 opener, §4, examples).
- **link-qc-5b-test-run-manual-cli**: `run-plan.md` §3 no longer calls its per-TC line "skill 5's shape".
- **Docs**: README (skill 5 layout and progress, the runner, self-test list); CLAUDE.md (layout,
  scripts, the runner exception, keep-in-step locations, twelve-principles location, thirteen
  harnesses, the hard rule).

### Test runners (5, 5b) and live validators (3b, 3c) prepare missing test data instead of skipping

Shared, word for word in the four skills: the **twelve preparation principles** and the **consent
by way** table (discover before skipping in the order learning file → automation helpers → the
application's source code → UI journey → DB helper → manual; the skill prepares the item itself; a
UI journey needs no question, an existing helper runs under the run's data-changes "yes", an
endpoint read from the source code and a database write each need an explicit "yes" asked once
after discovery; temporary seed in the scratch folder, never new code in the repository;
dedicated, right-sized fixtures; verified on the oracle before use; system-stamped values read
back and routed to skill 3; the real rule checked, not just the screen; `NOT CREATABLE` with
evidence instead of "data missing"; a permission refusal stops the step; no secrets anywhere;
keep or clean up asked once after the run, default keep).

- **link-qc-5b-test-run-manual-cli**
  - Invariant 10 and workflow steps 6 / 6b / 11: missing data is prepared, not skipped; skips only
    as `data_missing` (no way found), `not creatable` (evidence) or `QC declined`.
  - New `references/test-data-preparation.md` (principles, inventory of record, the five statuses
    incl. `NOT CREATABLE`, the nine preparation steps, the two questions, readiness decisions,
    learning-file lines, worked example with four MISSING items and no "data missing" outcome).
  - `intake.md` §3 (consent and keep / clean-up rows), `execution-rules.md` §3-§5 and §7,
    `run-report-manual.md` (`Data preparation` Run bullet, the nine-column readiness table, the
    stamped-value Deviation shape, `data_readiness` now written to the run file), `run-plan.md`,
    `learning-file.md` (prepared fixtures, not-creatable evidence, consent answers),
    `ai-response-rules.md`, `INPUT.txt`.
  - `self-review.md`: fourteen checks (no `data_missing` where a way existed; every prepared item
    verified before its dependents; no seed left in the repository; no credential in any output);
    hard-check failures now consistently `app_bug`.
  - Harness: the manual-run fixture gains a `prepared (api)` item with a stamped value, a
    `skip — not creatable` TC and a stamped-value Deviation; golden regenerated;
    `selftest-manual-run.mjs` asserts the readiness counts.
- **link-qc-5-test-run-automation**
  - PHASE 2.6 rewritten: helpers found through the manifest paths and a generic search; the
    application's source code searched for create endpoints (skill 10's profile first); the QC
    asked only for an endpoint from the source / a DB write and for gaps with no way; UI journeys
    and existing helpers prepared without asking; non-interactive default prepares the automatic
    ways; temporary seed (kept as a fixture only on request); dedicated right-sized fixtures;
    seed-once kept; verify before use; stamped values propagated through the test-data layer;
    rule-level verification; `NOT CREATABLE` distinct from `IMPOSSIBLE`; refusals stop and ask;
    keep by default, clean-up asked once after the run; `data_readiness` keys aligned with the
    fixture (`gaps` / `predicted_skips`) plus `identifiers` / `stamped_values` / `verified_on`.
  - `references/run-report.md` §4 readiness row (nine columns, decision vocabulary, counted by the
    renderer) and §7 run-file shape; checklist items, the `data_missing` failure-table row, the
    learning-file line, the final-message block and summary row; `INPUT.txt`.
  - `scripts/render-run-report.mjs`: the readiness table's `Decision` column is parsed into
    per-phase counts (`document.phases[].readiness`), shown as a `Decisions:` line, legacy bare
    words still accepted, `unknown-readiness-decision` warning; a bare `all ready` body renders
    as the verdict. Fixture and golden updated; harness case 29. Mirrored to 5b.
- **link-qc-3c-validate-manual-test-cases-cli**
  - Invariant 18 rewritten to the consent model; workflow step 4b (consent ask), steps 8 / 9 / 11;
    READ-ONLY / COMPARISON lines; Permissions (temporary seed through the normal permission flow).
  - `references/test-data-resolution.md` rewritten: principles + consent table (`SHARED-3B-3C`
    blocks), `api` available through an existing helper or an endpoint in the source (pending the
    user's yes), the nine-step preparation run for every way, delivered statuses (kept → `READY`,
    removed → `MISSING` with a recreate note, `NOT CREATABLE` with evidence), one post-walk ask
    (keep / clean-up + undecided items), return lines, worked example with TEST-DATA rows and TC
    stamps.
  - `walk-rules.md` §3a / §6 / §6a, `discovery-plan.md`, `intake.md` §3, `patch-rules.md` §3 / §6
    / §7 / §8, `self-review.md` check 12, `cli-vs-mcp-comparison.md` (both runs switched off),
    `tc-format-contract.md` (stamp key `data`), `INPUT.txt`.
- **link-qc-3b-validate-manual-test-cases**
  - Full data-changes model (user decision, 2026-10-13): new invariants 16 (data changes) and 17
    (test data), `mcp-pass.md` §3a, the data-changes question in `intake.md` §3.
  - New `references/test-data-resolution.md` — 3c's file with the Playwright MCP wording in the
    tool sections and the `SHARED-3B-3C` blocks byte-identical; preparation only for items whose
    dependents are inside the chosen scope (`scope-gate.md` §1 item 8, §4); workflow steps 7c
    (consent ask), 8b (preparation), 9, 11; `patch-rules.md` §3 / §6 / §7 / §8 (`Data changes`
    and extended `Test data` return lines, `Data plan` audit line); `self-review.md` check 11;
    `tc-format-contract.md`; `INPUT.txt`.
- **Mirrored across 3 / 3b / 3c** (`validation-states.md`, `learning-file.md`, `html-page.md`):
  draft reasons `data missing — D{n}` / `data not creatable — D{n}`, the `data:` stamp key, the
  prepared-fixture and not-creatable learning lines, the fifth test-data status.
- **link-qc-3-generate-manual-test-cases** (shared renderer and TEST-DATA contract)
  - `scripts/render-tc-review.mjs`: `NOT CREATABLE` accepted as the fifth TEST-DATA status,
    counted (`counts.testData.notCreatable`), badged `d-not-creatable`; the data header note shows
    five counts (EN + AR); sample fixture gains a `NOT CREATABLE` item and a Problems row; goldens
    regenerated; harness case 29 (31 cases incl. 0 and 27). `assets/report-shell.template.html`
    gains the badge rule (mirrored five ways: 3, 3b, 3c, 5, 5b).
  - `references/deliverables.md` / `tc-design.md`: five status words, `NOT CREATABLE` never written
    by skill 3, "3b / 3c" as live checkers.
- **link-qc-12-adhd-output-style** overlay rows for 3b, 3c and 5b.
- **Docs**: README sections for 3b, 3c, 5 and 5b; CLAUDE.md (the principles as a hard rule, the
  3b/3c shared-block rule, reference and harness counts, the changelog convention in *Git*).
