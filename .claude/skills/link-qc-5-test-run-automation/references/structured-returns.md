# The structured returns and the final quality checklist

Loaded by `SKILL.md` at **Preparing Final Report**, before writing any return: work
`<quality_checklist>` first, then write exactly one of the returns — a short summary that links the published
report set instead of repeating it.

<run_acceptance>
**Run-level acceptance — separate from every TC's status, decided by `run-data.mjs acceptance`.** A TC's
status of record keeps the protected rule (the alone run decides; every attempt stays in the history). The
RUN is `ACCEPTED` only when ALL of these hold:
1. both checkpoints PASS at the current snapshot (`.runs/phase-{N}.checkpoint-{A|B}.json`) and no reported
   result is stale;
2. no unresolved `possible_product_concurrency_defect` interference — resolved means `parallel_checks[].
   resolution` names an evidenced test-side cause (a learned conflict) or a filed bug (`bug: BUG-{n}`);
3. no unexplained first-attempt regression — a first-attempt FAIL that passed alone with cause `unexplained`
   (or none) and no resolution;
4. no required TC is `NOT_RUN` / `INCOMPLETE` because of an admission timeout, host pressure, a deferred wait,
   the environment lease or missing coordination (`no safe coordination`);
5. the smoke gate produced a verdict (not `NO VERDICT`) whenever the phase had smoke TCs;
6. (3.0, API / DB) no required TC is `NOT_RUN` for a reason the run must fix (`mapping unresolved`, `db unavailable`,
   `config missing`, `layer unknown`) or `INCOMPLETE` `evidence_invalid`; no TC the tester consented to was refused its
   data change; no data change of the run is still in doubt. A TC the tester did NOT consent to is reported, never a
   reason.

Otherwise the run is `NOT ACCEPTED — {reasons}`: the return is `## BLOCKED` with the acceptance record —
never `AUTOMATION COMPLETE`, however green the suite. The pre-gate verdict written into the draft run file is
conditional on Checkpoint B; the verdict of the return is the final call after publication
(`<publication>` step 5). The report's `- **Acceptance:**` Run bullet shows it.
</run_acceptance>

<structured_returns>
**The return is a SUMMARY that points to the report, never a copy of it.** Everything the published report set
already holds — the run plan, the timeout table, open questions, test-data readiness, coverage tables, the Heal Log,
the per-TC results, the compliance tables, the Placement Manifest (shown in the Writing Automation Code message) — is
linked, not repeated. What the return must never drop: the outcome and the acceptance verdict, every TC that did not
pass (FAIL, INCOMPLETE, SKIP, NOT_RUN, `PARTIAL — human step pending`) with its reason, every deviation, every open
quality issue, and every decision or action the user owes. A section with nothing in it is ONE line (`none`), never
omitted. Activity names and stage labels stay exactly as the progress messages used them.

## AUTOMATION COMPLETE

**Precondition — not negotiable** (SKILL.md *Returns*): both checkpoints PASS for the final delivered
scope at the current snapshot (their gate-record files say so), no applicable check `unresolved`, no reported
result stale, the report set published by `run-data.mjs publish`, and the run `ACCEPTED` (`<run_acceptance>`)
— otherwise return **`## BLOCKED`** with the gate records and the acceptance record, however green the run.
A passing suite is not a passed gate.

**{Feature} · {User Story ID — title} · Phase {N}** — **Acceptance:** ACCEPTED · **Checkpoint A:** PASS · **Checkpoint B:** PASS (gate records `.runs/phase-{N}.checkpoint-{A|B}.json`)
**TC document:** {path} · Status {APPROVED | APPROVED — set this run on the user's instruction | {value} — run without approval (user decision, {date})} · **Environment:** {env} · **Azure DevOps:** {`linked` — close-out {done: {n} TCs Automated, US comment {link} | what failed} | `local` — {reason}; publishing is skill 4, not required}
**Results of record:** {passed} passed · {failed} failed · {incomplete} incomplete · {skipped} skipped · {not_run} not run · {partial} partial — of {N} TCs · smoke gate {passed | healed-then-passed ({n} cycles)} · re-run {n} TCs ({i} impacted · {v} no verdict), {b} burn-in — or "not needed" · results fresh (`stale: []`)
**Coverage (three separate figures):** requirement outcome Full {n} · Partial {n} · Missing {n} · Assumed {n} of {N} · TC automation {x}% (target {t}% — {PASS | user override | report-only}) · execution pass rate {p}%
**Timeouts:** test {s} · step {s} · action {s} · navigation {s} · expect {s} — {n} calibrated ({key from → to — evidence}, or `none`) · {n} watchdog stops · probe {PASS | NOT_RUN — reason} · unlimited action / navigation timeouts {`none` | where} (the full record: `{run_file}.timeouts`)

### Needs attention
- **Failures:** {BUG-{n} · TC-ID · one-line title — application defect, in the bug report} — or `none`
- **Not passed:** {TC-ID — INCOMPLETE / SKIP / NOT_RUN / PARTIAL — the reason as the report states it} — or `none`
- **Deviations:** {one line each, as in the report's `### Deviations`} — or `none`
- **Quality issues left open:** {unverified assumptions carried into the run (TC-IDs) · unresolved timeouts · isolation findings and their cause / resolution · readiness skips and stamped values routed to skill 3 · configurations not merged · capacity: lowered / pressure episodes / deferrals / admission timeouts} — or `none`

### Links
- **Run report:** {run_report_html} (markdown {run_report_md}, `## Phase {N}`) — markdown only: {run_report_md} (`## Phase {N}`), no page by the run's choice · **Bug report:** {bug_report_md} — {n} new · {n} retested · {n} resolved
- **Evidence:** {screenshots_root}/phase-{N}/ ({N} images — screenshots: every TC | failed TCs only | none) · stage results {results_root}/artifacts/stages/ · run file {run_file} · progress log {logs_root}/run-progress-{stamp}.log
- **Also:** coverage {coverage_root} · automation inventory {reports_folder}/automation-inventory.md · gate records {results_root}/.runs/

### Your decision / action
{numbered list — exactly what the user must decide or do (a business answer behind an `@unverified-assumption`, a bug to triage, a configuration to merge by hand, a revision for skill 3, a lease or hold left for the user) — or "None."}

**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}

---

## ENVIRONMENT_BLOCKED

**Reason:** {specific unhealthy service/dependency + evidence}
**Environment:** {env}
**Action required:** ops / human — not a code defect. Activities completed before the block: {list}
**Report:** {run_report_html — the short phase section with the reason} · **Learning file:** read … · updated …

---

## BLOCKED

**Reason:** {unapproved TC doc — user chose *stop*, or pipeline run without `--approve` / `--unapproved` | missing User Story | ambiguous US name | missing profile key | unresolved test-data precondition (QC chose stop, or provisioning failed and no alternative accepted) | environment lease held by another run (QC chose stop) | **compliance gate not PASS** (Checkpoint A or B `FAIL`/`BLOCKED` in its gate-record file, an applicable check still `unresolved`, or a TC reported with a result is stale per `impact.mjs`) | **run NOT ACCEPTED** (`<run_acceptance>` — the reasons, e.g. an unresolved possible concurrency defect, TCs not started by admission, smoke NO VERDICT)}
*(Never blocked for Azure DevOps: a missing or stale ADO-MAP.md, an unpublished story, or an
ADO auth failure all degrade to `ado_mode = local` and the run continues. Never blocked for an
ambiguous TC step or an unresolved element either: those are raised as open questions
and, unanswered, become tagged assumptions or skip-guarded TCs. **An unresolved compliance item IS
a block for the affected scope** — but only for that scope: independent work still completes and is
reported.)*
**Details:** {exact item and what was observed}
**Gates and acceptance:** Checkpoint A {PASS | FAIL | BLOCKED} · Checkpoint B {PASS | FAIL | BLOCKED | not reached} · Acceptance {ACCEPTED | NOT ACCEPTED — reasons | not decided} — then every open item, one line each: `{check} {unit} — {FAIL | unresolved | missing | stale} — what would close it` (the full tables are in the gate records and the report's `### Run`)
**Execution status (kept separate):** {Results of record line as above, every TC that did not pass with its reason — a green suite here does
not lift the gate, and failing tests here may be genuine application defects rather than a
compliance problem}
**Completed before blocking:** {activities/items}
**Links:** {run report (or "not produced — {why}") · gate records · run file · progress log}
**Required from the user:** {the exact input or action needed — or "nothing: the open items are
mine to verify" when no user input is needed}
**Learning file:** read {sections/tags} · updated {…}

</structured_returns>

---

<quality_checklist>
Before returning AUTOMATION COMPLETE, confirm every line against its home block (where the full rule
lives). A line that does not hold → `## BLOCKED` for the affected scope.

**Gates and honesty**
- [ ] Checkpoint A PASS for the executed scope and Checkpoint B PASS for the FINAL delivered scope, both
      at the current `scopeDigest` — confirmed violations fixed at once, affected checks re-run
      (`<checkpoint_a>`, `<checkpoint_b>`)
- [ ] Validator result reported in full (`gate`, `counts`, `review[]`, `notRun[]`, `exceptions[]`); a
      scanner PASS never presented as proof the tests are correct; a scanner BLOCKED / NOT_RUN recorded
      verbatim and closed another way against the same `scopeDigest`, or left BLOCKED (compliance §1)
- [ ] No applicable check recorded PASS or `N/A` without having run — `unresolved` keeps its gate
      BLOCKED; runtime artifacts never claimed at Checkpoint A (compliance §1, §5)
- [ ] Every honoured exception's source opened and its substance recorded; no `qa-allow` on a
      non-exemptible rule (item 39)
- [ ] No reported result stale: `impact.mjs select` on the final code → `stale: []`,
      `fresh_by_member_only[]` reviewed, both in `{run_file}.impact` (`<checkpoint_b>` step 4)
- [ ] Blocked tests reported against the ORIGINAL scope, never dropped or counted as passing; compliance
      reported apart from execution; the three coverage figures separate, no requirement ID invented
      (automation-rules §6)
- [ ] No product code or application setting changed, no error suppressed, no assertion lowered, no skip
      or timeout added to hide a failure, no app bug masked (SKILL role, `<first_run>`)
- [ ] No scratch probe left or cited — `scratch.mjs clean` → `removed` / `absent` (item 50,
      `<scratch_investigation>`)
- [ ] Both gates decided by `check.mjs gate` — gate-record files `.runs/phase-{N}.checkpoint-{A|B}.json`, every
      result for the current snapshot, none missing / stale / contradictory / duplicate; the report set was
      DRAFTED, frozen, checked and then published by `run-data.mjs finalize` / `publish` (byte-identical, page reproduced);
      the run `ACCEPTED` per `<run_acceptance>` (compliance §1, `<publication>`)
- [ ] Every Playwright command ran inside the capacity ledger (or the payload says why it was off), under the
      environment lease acquired at intake and released at close-out; every lowering, pressure episode,
      deferral and admission timeout reported (`<capacity_and_lease>`)

**Intake**
- [ ] Approval per `<input_gate>`: `APPROVED` proceeded, otherwise ONE question or `--approve` /
      `--unapproved`; *approve now* rewrote only the `Status:` line; *run without approval* recorded on
      the `Source document` line, in `### Deviations` and in the final message; never persisted
- [ ] User Story id resolved without Azure and confirmed before any folder was named (`<input_gate>`)
- [ ] `ado_mode` derived and stated; the run never blocked, paused or degraded for Azure, the user never
      asked to publish or to run skill 4; ADO auth only under `linked`, 401 / 403 → `local`, no token
      logged (`<input_gate>`, `<ado_linkage>`)
- [ ] Layout and roots per `<project_profile>` / `<result_organization>`: an existing automation project
      reused, `spec_level` derived once, the three roots stated at the start and never changed or
      flattened to a bare `US-*` path; legacy folders read as history only

**Code**
- [ ] Generated from the ORIGINAL approved document; no beautify, no TC work-item edit (SKILL role)
- [ ] Hierarchy verified, Placement Manifest emitted, spec registered (`<hierarchy_verification>`)
- [ ] POM enforced and its self-check grep reported; no spec-local UI helper, no chaining off exposed
      locators (`<pom_mandatory>`)
- [ ] Automation inventory before any page object; validator with `--inventory` at both checkpoints, no
      open `pom-duplicate-page`; decisions in `## Automation Tricks` (`<automation_inventory>`)
- [ ] Every selector confirmed in source; safe-fix impact checks before any rename
      (`<selector_resolution>`)
- [ ] Every TEST-DATA reference resolved by its own ID through `helpers/test-data.ts` — never by role,
      no literal URL / username, no default value (`<spec_writing>`)
- [ ] `[HUMAN]` TCs generated up to the first human step: coverage `partial (human step: n)`, status
      `PARTIAL — human step pending` — never PASS, `Automated` or an `automated_tc_sha256`
- [ ] Code-craft [M] items (compliance items 40-49); every timeout from `timeouts.ts`, raised only on
      trace evidence and recorded `{key, from, to, reason, evidence}`, no retry absorbing a timeout;
      calibration and probe `NOT_RUN` with the reason when no run happened (code-craft §9,
      `<first_run>` step 2b)
- [ ] ONE shared `playwright.config.ts` per `<shared_config>` (extra configs deleted only from
      `deletable[]`, unmergeable ones listed with the blocking setting, reporters additive); headed
      Chrome, or the `PW_HEADLESS=1` fallback reported in chat AND under Deviations

**Before the first run**
- [ ] Open questions per `<open_questions>`: all four sources, one question per ambiguity, learning file
      first, evidence-backed options with the recommendation first; every answer written back at once as
      a generic rule; unanswered → `@unverified-assumption` or skip-guarded, and such a failure never
      `app_bug`, never in the smoke-gate math, never published as Passed; `{run_file}.open_questions`
- [ ] Static coverage measured, gate verdict recorded with target + source + mechanism; below target →
      one repair pass, re-measure, then the user; three CSVs and the snapshot / delta
      (`<coverage_measurement>`)
- [ ] Test-data readiness resolved per `<data_readiness>` and the twelve principles;
      `{run_file}.data_readiness` written; every skip guard traces to a readiness decision
- [ ] Run plan in `{run_file}.run_plan` with `required_variants` and `rate_limits[]`; one `@run:` tag per
      TC; a serial group isolated by its tag + own `--workers 1` command, `mode: 'serial'` only around a
      true chain; every serial decision has its reason (`<run_plan>`)

**Run**
- [ ] Every Playwright command of the run through `run-stage.mjs` — one background call per stage, never
      polled; no `--reporter` / `--config` on any run command (`scratch.mjs`'s overlay is not a run);
      every command's stage JSON fresh, `FRESHNESS_FAILED` stopped the stage (`<live_progress>`)
- [ ] Watchdog stops only on `FROZEN` or past ceiling + margin; `completed[]` kept, `interrupted[]` /
      `not_started[]` named and run again once, the event `timeout_failure` (`<live_progress>`)
- [ ] Stage order setup → smoke → gate → positive → negative; further executions only as the isolation
      check, a smoke retry, the re-run or the burn-in, each a new attempt (`<staged_execution>`)
- [ ] One chat message per finished stage plus immediate stop / blocker messages, activity names as
      labels; the progress log appended across ALL activities, history untouched (`<live_progress>`,
      `<automation_logs>`)
- [ ] Smoke gate math and action per `<staged_execution>` (PASS + FAIL only; NO VERDICT → positive /
      negative never started); on a gate stop the run file, phase section, bug file and page were still
      completed
- [ ] Isolation check and rate limits per `<live_progress>`: an alone-PASS is PASS + Deviation + tag move
      + `run_plan_adjustments[]` + learning line + a cause from evidence and its resolution; `rate_limited` is
      INCOMPLETE, never FAIL / bug / heal, and only for the failing step's own throttled request refused again
      after the server's deadline; a deferral or an exhausted wait budget is never `rate_limited`; limits
      learned as `[type: env]` lines, never asked, never a code change
- [ ] Every failure classified; only test-code defects healed (≤ 2 iterations per phase, smoke retry cycles
      included); Heal Log kept (automation-rules §5)
- [ ] Every stage dispatched on a fresh OK readiness payload or run serially with the reason (`scheduler.fallback`);
      the Auto ceiling and the ramp's decisions reported; a `--parallel-shadow` run's differences from the hand plan
      reported; unlock suggestions applied only with the QC's consent (`<parallel_readiness>`)
- [ ] Re-run chosen by `impact.mjs select` — or "Re-run not needed" stated (`<second_run>` step 1)
- [ ] `@smoke` tags only from the TC document's `Smoke:` field

**Evidence and report**
- [ ] The delivery question asked at the start (or answered by `--report` / `--screenshots`; pipeline: html + all)
      and recorded in `{run_file}.delivery` (`intake.md` item 4)
- [ ] Every image the screenshot choice owes — `all`: every attempt's assertion-point image and every failed
      attempt's failure image; `failed`: the failed attempts' images; `none`: none — at the
      `<result_organization>` path, recorded in the run file; nothing under `screenshots/` overwritten
      or deleted; evidence sanity check done on every PASS image, every `evidence_failure` healed by moving the call
- [ ] `{run_file}.merged` per `<second_run>` step 2 — every variant and attempt, the latest the status of
      record, PASS only when every `required_variants` entry passed, a multi-`[TC-ID]` title credited
      to each TC; phase auto-incremented, no earlier phase rewritten
- [ ] Run file finalized, `## Phase {N}` appended, renderer gate PASS on the markdown and `selftest-run-report.mjs`
      passing (run-report.md §1-§2); the page written by `render-run-report.mjs` only under `delivery.report: html`
- [ ] Bug file per run-report.md §5 and `<bug_report_format>`: plain-sentence titles, numbered steps from
      login, one-sentence Expected / Actual, root cause + screenshot; `resolved (phase N)` only after a
      passing retest
- [ ] Azure close-out only under `linked`, per `<ado_closeout>`; under `local` skipped silently, no
      publish suggested
- [ ] Deviations honest and complete; learning file grepped before every ask and discovery and updated
      with tagged plain-English lines — no secrets, no code identifiers (`<project_learning_file>`)
</quality_checklist>
