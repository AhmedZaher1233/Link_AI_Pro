# The structured returns and the final quality checklist (rules)

Loaded at **Preparing Final Report**: work `<quality_checklist>` first, then write exactly one return. Detail: `maintainers/structured-returns.md`.

<run_acceptance>
**Run-level acceptance — separate from every TC's status, decided by `run-data.mjs acceptance`.** `ACCEPTED` only when ALL hold: 1. both checkpoints PASS at the current snapshot and `{run_file}.impact.final_check.outcome: FRESH` (written by `check.mjs freshnessCheck`); 2. no unresolved `possible_product_concurrency_defect` interference (`parallel_checks[].resolution` = an evidenced test-side cause or `bug: BUG-{n}`); 3. no unexplained first-attempt regression (a first-attempt FAIL that passed alone with cause `unexplained` / none and no resolution); 4. no required TC `NOT_RUN` / `INCOMPLETE` because of an admission timeout, host pressure, a deferred wait, the lease or missing coordination; 5. the smoke gate produced a verdict (not `NO VERDICT`) whenever the phase had smoke TCs; 6. (API / DB) no required TC `NOT_RUN` for `mapping unresolved` / `db unavailable` / `config missing` / `layer unknown`, none `INCOMPLETE` `evidence_invalid`, no consented data change refused or in doubt (an unconsented TC is reported, never a reason).
Otherwise `NOT ACCEPTED — {reasons}` and the return is `## BLOCKED` with the acceptance record — never `AUTOMATION COMPLETE`, however green the suite. The pre-gate verdict is conditional on Checkpoint B; the return's verdict is the final call after publication (`<publication>` step 2). The report's `- **Acceptance:**` Run bullet shows it.
</run_acceptance>

<structured_returns>
**The return is a SUMMARY that points to the report, never a copy.** Everything the published set holds is linked, not repeated. Never dropped: outcome + acceptance verdict, every TC that did not pass (FAIL, INCOMPLETE, SKIP, NOT_RUN, `PARTIAL — human step pending`) with its reason, every deviation (incl. `evidence_relocated`), every open quality issue, every decision or action the user owes. An empty section is ONE line (`none`), never omitted. Activity names and stage labels stay as the progress messages used them. Links list the summary log FIRST, then the progress log.

## AUTOMATION COMPLETE

**Precondition:** both checkpoints PASS at the current snapshot (gate-record files), no applicable check `unresolved`, no stale result, the set published by `run-data.mjs publish`, the run `ACCEPTED` — otherwise `## BLOCKED`, however green the run.

**{Feature} · {User Story ID — title} · Phase {N}** — **Acceptance:** ACCEPTED · **Checkpoint A:** PASS · **Checkpoint B:** PASS (gate records `.runs/phase-{N}.checkpoint-{A|B}.json`)
**TC document:** {path} · Status {APPROVED | APPROVED — set this run on the user's instruction | {value} — run without approval (user decision, {date})} · **Environment:** {env} · **Azure DevOps:** {`linked` — close-out {done | what failed} | `local` — {reason}}
**Results of record:** {passed} passed · {failed} failed · {incomplete} incomplete · {skipped} skipped · {not_run} not run · {partial} partial — of {N} TCs · smoke gate {passed | healed-then-passed ({n} cycles)} · re-run {n} TCs ({i} impacted · {v} no verdict), {b} burn-in — or "not needed" · results fresh (`final_check: FRESH`)
**Coverage (three separate figures):** requirement outcome Full {n} · Partial {n} · Missing {n} · Assumed {n} of {N} · TC automation {x}% (target {t}% — {PASS | user override | report-only}) · execution pass rate {p}%
**Timeouts:** test {s} · step {s} · action {s} · navigation {s} · expect {s} — {n} calibrated ({key from → to — evidence}, or `none`) · {n} watchdog stops · probe {PASS | NOT_RUN — reason}

### Needs attention
- **Failures:** {BUG-{n} · TC-ID · one-line title — application defect, in the bug report} — or `none`
- **Not passed:** {TC-ID — INCOMPLETE / SKIP / NOT_RUN / PARTIAL — the reason as the report states it} — or `none`
- **Deviations:** {one line each, as in the report's `### Deviations`} — or `none`
- **Quality issues left open:** {unverified assumptions · unresolved timeouts · isolation findings · readiness skips routed to skill 3 · configurations not merged · capacity events} — or `none`

### Links
- **Run report:** {run_report_html} (markdown {run_report_md}, `## Phase {N}`) — markdown only: {run_report_md}, no page by the run's choice · **Bug report:** {bug_report_md} — {n} new · {n} retested · {n} resolved
- **Evidence:** {screenshots_root}/phase-{N}/ ({N} images — screenshots: every TC | failed TCs only | none) · stage results {results_root}/artifacts/stages/ · run file {run_file} · summary log {logs_root}/run-summary-{stamp}.log · progress log {logs_root}/run-progress-{stamp}.log
- **Also:** coverage {coverage_root} · inventory {reports_folder}/automation-inventory.md · gate records {results_root}/.runs/

### Your decision / action
{numbered list — exactly what the user must decide or do (an `@unverified-assumption` answer, a bug to triage, a configuration to merge, a revision for skill 3, a lease left for the user) — or "None."}

**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}

---

## ENVIRONMENT_BLOCKED

**Reason:** {specific unhealthy service/dependency + evidence}
**Environment:** {env}
**Action required:** ops / human — not a code defect. Activities completed before the block: {list}
**Report:** {run_report_html — the short phase section} · **Logs:** summary {path} · progress {path} · **Learning file:** read … · updated …

---

## BLOCKED

**Reason:** {unapproved TC doc (user chose *stop*, or pipeline without `--approve` / `--unapproved`) | missing User Story | ambiguous US name | missing profile key | unresolved test-data precondition | lease held by another run | preflight `config location` question unanswered | **compliance gate not PASS** (A or B `FAIL`/`BLOCKED`, an applicable check `unresolved`, or `impact.final_check` STALE) | **run NOT ACCEPTED** (`<run_acceptance>`)}
*(Never blocked for Azure DevOps — ADO problems degrade to `ado_mode = local`. Never blocked for an ambiguous TC step or an unresolved element — those become open questions, then tagged assumptions or skip-guarded TCs. An unresolved compliance item blocks only the affected scope.)*
**Details:** {exact item and what was observed}
**Gates and acceptance:** Checkpoint A {PASS | FAIL | BLOCKED} · Checkpoint B {PASS | FAIL | BLOCKED | not reached} · Acceptance {ACCEPTED | NOT ACCEPTED — reasons | not decided} — then every open item, one per line: `{check} {unit} — {FAIL | unresolved | missing | stale} — what would close it`
**Execution status (kept separate):** {Results of record line as above, every TC that did not pass with its reason}
**Completed before blocking:** {activities}
**Links:** {run report (or "not produced — {why}") · gate records · run file · summary log · progress log}
**Required from the user:** {the exact input or action — or "nothing: the open items are mine to verify"}
**Next phase:** start in a FRESH session from `node .claude/skills/link-qc-5-test-run-automation/scripts/run-data.mjs handoff --run-file {run_file}` — write this line and STOP; the next phase never runs in this context.
**Learning file:** read {sections/tags} · updated {…}
</structured_returns>

---

<quality_checklist>
Before AUTOMATION COMPLETE confirm every line against its home block; a line that does not hold → `## BLOCKED` for the affected scope.

**Gates and honesty**
- [ ] Checkpoint A PASS for the executed scope, Checkpoint B PASS for the FINAL scope, both at the current `scopeDigest`; violations fixed at once (`<checkpoint_a>`, `<checkpoint_b>`)
- [ ] Validator result reported in full; a scanner PASS never presented as proof; no applicable check PASS or `N/A` without having run; runtime artifacts never claimed at A (compliance §1, §5); every honoured exception's source opened (item 39)
- [ ] `{run_file}.impact.final_check` written by `check.mjs freshnessCheck`, `outcome: FRESH`; `fresh_by_member_only[]` reviewed (`<checkpoint_b>` step 4)
- [ ] Blocked tests reported against the ORIGINAL scope; compliance apart from execution; three coverage figures separate
- [ ] No product code or application setting changed, no error suppressed, no assertion lowered, no skip or timeout added to hide a failure (`<first_run>`); no scratch probe left or cited (item 50)
- [ ] Both gates decided by `check.mjs gate`; the set DRAFTED, frozen, checked, then published by `run-data.mjs finalize`; the run `ACCEPTED` (`<run_acceptance>`, `<publication>`)
- [ ] Every Playwright command inside the capacity ledger, under the lease acquired at intake and released at close-out; every lowering, deferral and admission timeout reported (`<capacity_and_lease>`)

**Intake and code**
- [ ] Approval per `<input_gate>`; User Story id confirmed before any folder was named; `ado_mode` stated, never blocked for Azure; roots per `<project_profile>` / `<result_organization>`, stated once and never changed
- [ ] `run-stage.mjs preflight` ran at the END of intake (before any code) and before the first run; a `config location` block answered before anything was generated (`<environment_gate>`)
- [ ] Generated from the ORIGINAL approved document; Placement Manifest emitted, spec registered; POM enforced; no open `pom-duplicate-page`; every selector confirmed in source; TEST-DATA by its own ID; `[HUMAN]` TCs `PARTIAL — human step pending`, never PASS
- [ ] Code-craft [M] items (40-49); every timeout from `timeouts.ts`, raised only on evidence as `{key, from, to, reason, evidence}`; ONE shared `playwright.config.ts`; the evidence helper installed from `assets/evidence.template.ts` (one `evidence` heartbeat per attempt)
- [ ] Open questions, static coverage, test-data readiness and the run plan (one `@run:` tag per TC) settled before the first run

**Run**
- [ ] Every Playwright command through `run-stage.mjs` as a delegated background call — no `--cwd`, no `--reporter` / `--config` from you, never polled; every stage JSON fresh; serial = ONE process per group with `--workers=1` when `candidateConcurrency` was 1 (`<live_progress>`)
- [ ] Watchdog stops only on `FROZEN` or past ceiling, event `timeout_failure`; stage order setup → smoke → gate → positive → negative; smoke gate over PASS + FAIL only; NO VERDICT never started positive / negative; on a gate stop the report set still completed (`<staged_execution>`)
- [ ] One chat message per finished stage plus immediate stop / blocker messages; activity transitions through `run-stage.mjs activity`, never by hand (`<automation_logs>`)
- [ ] Isolation check per `<live_progress>`: alone-PASS = PASS + Deviation + tag move + cause + resolution; `rate_limited` INCOMPLETE, never FAIL / bug / heal
- [ ] Every failure classified; only test-code defects healed (≤ 2 iterations, smoke retries included); Heal Log with `cause_class`; burn-in only for `timing` / `flaky` / `race` heals (`--burn-in auto`)
- [ ] Re-run chosen by `impact.mjs select` with `impact_level` per TC — or "Re-run not needed" (`<second_run>` step 1); `@smoke` tags only from the TC document's `Smoke:` field

**Evidence and report**
- [ ] Delivery choice recorded in `{run_file}.delivery`; every image it owes at the `<result_organization>` path, recorded in the run file; nothing under `screenshots/` overwritten or deleted (an `evidence_relocated` move by `finalize` listed under Deviations); evidence sanity check done
- [ ] `{run_file}.merged` per `<second_run>` step 2 — latest attempt = status of record, PASS only when every required variant passed; no earlier phase rewritten
- [ ] Run file finalized, `## Phase {N}` appended, renderer gate PASS; page only under `delivery.report: html`; bug file per `<bug_report_format>`, `resolved (phase N)` only after a passing retest
- [ ] Azure close-out only under `linked`; Deviations honest; learning file updated with tagged plain-English lines — no secrets (`<project_learning_file>`)
</quality_checklist>
