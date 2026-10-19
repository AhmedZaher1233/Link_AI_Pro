# QA pipeline overlay — detail and worked examples

Companion to `../SKILL.md` section "QA pipeline overlay (Link_AI_Pro skills 1-11, 3b, 3c and 5b)". Read when
`/link-qc-12-adhd-output-style` is active and one of the QA skills is running. Nothing here changes a skill; it
changes only how the CHAT around the skill reads.

## 1. The pipeline and where humans stop it

| Order | Skill | Writes (never reshaped) | Human gate (becomes the first line) |
|---|---|---|---|
| 1 | `link-qc-1-generate-update-testing-structure` | `Testing/` layout, `project-learning.md` | none — report only |
| 2 | `link-qc-2-review-requirements` | `Testing/Requirements/[SPEC-*/]US-{id}-{name}/REQ-*.md`, Full Review Template | Intake gate: one open question at a time, after `project-learning.md` was consulted |
| 3 | `link-qc-3-generate-manual-test-cases` | `Testing/Manual_Test/TestCases/[SPEC-*/]US-*/TEST-CASES*.md` (every TC `draft — not app-validated`; URLs / accounts / shared data as `[E1]` / `[A1]` / `[D2]` tokens; `[HUMAN]` steps where no test interface exists; optional `Tags:`), `TEST-DATA*.md` (§0 Environment, §1 Accounts, data items), rendered HTML review page (English unless `--lang ar`) | Reviewer opens the HTML page, answers the open questions, then sets `Status: APPROVED` in the .md. The one extra ask: an out-of-browser interface (mail sandbox / SMS provider) only when nothing recorded answers it |
| 3b | `link-qc-3b-validate-manual-test-cases` (optional, before or after approval) | the same three files patched in place (validation states, corrected steps, Potential Bugs, test-data statuses) | none — not a gate. Scope choice (FULL / SHARED / CUSTOM) is the one question; an APPROVED document is read-only until the reviewer authorizes the revision, and goes back to `PENDING HUMAN REVIEW` only if something changed |
| 3c | `link-qc-3c-validate-manual-test-cases-cli` (optional, evaluation twin of 3b through playwright-cli) | the same files patched in place, plus `evidence/` screenshots for potential bugs | none — not a gate, and NO scope gate: every TC is walked on every run (no scope choice, no cross-validator choice — 3b evidence is re-validated). Its only asks: attended login (one "done" per role), the data-changes yes/no, the revision authorization on an APPROVED document, and — after the walk, only when evidence could not decide — one batched list of data items with a recommended way each. Not installed CLI → BLOCKED with `/sync-skills --tools` |
| 4 | `link-qc-4-publish-test-cases-azure` | beautified upload doc, `ADO-MAP.md`, ADO Test Case work items (tokens and `[HUMAN]` kept verbatim, tags = feature + smoke + automation/manual + human-step + the TC's `Tags:`), one outcome line of five | Entry: `Status: APPROVED` present |
| 5 | `link-qc-5-test-run-automation` | `automation-inventory.md` (page-object reuse / extend / create decisions) before any code, Playwright specs + POM, run plan, progress log, screenshots, bug drafts, AUTOMATION COMPLETE report (`partial (human step: n)` for `[HUMAN]` TCs) | Entry: `Status: APPROVED` proceeds; otherwise ONE question — approve now (the skill sets it) / run without approval (recorded) / stop (ADO publishing optional) · Checkpoint A compliance gate (an undecided duplicate page object blocks it) · Preparing Test Data (readiness) · 30% smoke failure gate · Checkpoint B compliance gate |
| 5b | `link-qc-5b-test-run-manual-cli` (optional, manual twin of 5 through playwright-cli — no MCP, never installs, never a password) | the SAME report set as 5 into the SAME story folder `Testing/Automation/reports/[SPEC-*/]{story}/` — `TEST-RUN-REPORT-*.md` + rendered `.html`, `BUG-REPORT-*.md`, `.runs/phase-N.json` (one phase counter and one `BUG-{n}` sequence shared with 5) — plus assertion-point screenshots and, for every AI chatbot TC (`AI Oracle` field), `reply.md` beside the screenshot; never the TC document except its `Status:` line on "approve now" (a design problem → skill 3 `--revision`) | Entry: the same approval rule as 5 — `APPROVED` proceeds, otherwise approve now / run without approval / stop (independent of 4 and 5; 5b gates nothing) · attended login (one "done" per role) or secret names · the data-changes yes/no · 30% smoke gate — application-error majority stops the run, NO heal · `PARTIAL — human step pending` for `[HUMAN]` TCs · `ai_rubric_failure` when a reply misses its rubric |
| 6 | `link-qc-6-ui-testing` (beside the chain, per screen, any time) | `Testing/UI-Testing/Reports/UI-Visual-QA-<page>.md` + evidence crops, `Learning-UI.md`, `Coverage-Index.md` | none — not a gate. One combined ask before the browser opens (languages, role, credentials, environment); Open Questions answered by the product owner become bugs or rules |
| 7 | `link-qc-7-sync-tc-status-to-azure` (optional) | one Azure test run with the latest phase's outcomes; no local file | none — not a gate. NOT_RUN when the attached server has no test-plan tools is a complete outcome |
| 8 | `link-qc-8-sync-bugs-azure` (optional) | `ADO-BUG-MAP.md` beside `ADO-MAP.md`, Azure Bug items, BUG-REPORT Status/History (Azure → md only) | Direction gate: ONE question (md → Azure / Azure → md / both) unless `--direction`; missing bug fields asked as one list; evidence attachments verified by read-back or reported pending (never a question) |
| 9 | `link-qc-9-retesting` (optional) | automated TCs re-run from skill 5's automation (run-stage.mjs), the rest through playwright-cli — never the Playwright MCP; the LATEST run-report phase updated in place (TC rows, totals, pass rate, run file, re-rendered page), BUG-REPORT Status/History (+ new entries), retest evidence, ledger; Azure close / reopen, THEN the evidence upload | Pre-flight ask before anything executes (environment, data changes; for playwright-cli bugs URL, login method per role, language switch); `resolved` only after a positive observation; page delivered at gate PASS |
| 10 | `link-qc-10-white-box-testing` | project profile, Implementation Analysis report | none — report only |
| 11 | `link-qc-11-discover-business-rules` | export doc `PENDING PO APPROVAL` in the story folder | PO fills the decision block -> re-run `--apply-approved` |

Rule: the gate is the message's first line, with the path. The skill's own report follows,
complete.

### 1a. Five facts that stay short in chat (SKILL.md section C2)

- **Reference tokens** — say `[A1]`, `[E1]`, `[D2]`, never the value behind them. Missing row →
  one gate line: `Add row E2 (mail sandbox) to TEST-DATA-{feature}.md, then re-run skill 3 --revision.`
- **`[HUMAN]` steps** — one count per message: `2 TCs stop at a [HUMAN] step — needs a human run.`
  Never "skipped", never "N/A". 3b / 3c: `draft (human step pending)`. Skill 5: `partial (human step: n)`, 5b: `PARTIAL — human step pending` — never PASS.
- **English default** — the page / review is English unless this run passed `--lang ar`. No
  language question, no "saved preference". If a sidecar exists: `Arabic sidecar exists — pass --lang ar to render it.`
- **Automation inventory** — `Inventory: {screens} screens — {reuse} reuse, {extend} extend, {create} create (automation-inventory.md).`
  An undecided duplicate: `Decide TC page for /orders: reuse OrdersPage or create — add the row to automation-inventory.md.`
- **Publish outcome** — copy the one line: `PUBLISHED AND VERIFIED (14 verified)` · `PUBLISHED, NOT VERIFIED (2 not verified)` ·
  `PUBLISHED WITH MISMATCHES (2 mismatch · 1 conflict)` · `PUBLICATION INCOMPLETE (1 not created)` · `BLOCKED`. Never "all items published".

## 2. Turn opener — one line, always

```
Skill {n} · {Phase x of y} ({phase name}) · {US-id story name}[ · story a of b] · {one progress fact}
```

Skill 5 fills the phase slot with its activity name (`Running Smoke Tests (first run)`,
`Running Smoke Tests (re-run)`, `Re-running Fixed & Impacted Tests`, `Preparing Test Data`, …) — never `PHASE n`.

Examples:

- `Skill 2 · Dependency check · US-4410 Leave balance · 2 of 3 dependency REQs resolved`
- `Skill 3 · Phase 2 of 4 (TC design) · US-1234 Yearly leave · story 2 of 4 · 18 TCs drafted`
- `Skill 3b · Phase 3 of 4 (live walk) · US-1234 Yearly leave · scope FULL · 11/18 observed`
- `Skill 3c · Phase 3 of 4 (live walk) · US-1234 Yearly leave · all 18 TCs · tool cli · 11/18 observed`
- `Skill 5 · Running Positive Tests (first run) · US-1234 Yearly leave · smoke 9/9 passed, positive 12/14 passed`
- `Skill 5b · Phase 3 of 4 (smoke) · US-1234 Yearly leave · 4/9 run · 0 failed · tool cli`
- `link-qc-6-ui-testing · Step 2C Pass 2 of 6 (computed styles) · Dashboard EN · Tier 1 · 1,847 elements measured`
- `link-qc-6-ui-testing · Step 2D (states) · Dashboard AR · no design → heuristic · 7/11 states driven`

## 3. Gate messages — before / after

### Skill 3 review page ready

Before:
> I have finished designing the test cases for the yearly leave story. There are 27 test cases
> covering smoke, positive and negative paths in both English and Arabic. None of them has been
> checked against the application yet, and there are two questions I could not settle from the
> requirement. I also generated an HTML review page. Let me know if you would like me to proceed.

After:
```
Open Testing/Manual_Test/TestCases/SPEC-leave/US-1234-yearly-leave/TC-REVIEW-yearly-leave.html,
answer Q-1 and Q-2 (recommended answers inside), then set "Status: APPROVED" in TEST-CASES-yearly-leave.md.

Skill 3 · done · US-1234 Yearly leave · 27 TCs (9 smoke / 11 positive / 7 negative), coverage 91.7% (design), all draft — not app-validated, 3 pending implementation.
The 3 pending ones: TC-ORD-021, -022, -026 (carry-over rules not deployed yet — tester's answer).

Optional before approval: /link-qc-3b-validate-manual-test-cases on that document (about 1 min per flow + 1 per TC walked).
Next after approval: /link-qc-5-test-run-automation (and /link-qc-4-publish-test-cases-azure if you publish — optional).
```

### Skill 3b scope gate

```
Choose the scope: FULL (recommended) · SHARED-FLOWS-ONLY · CUSTOM <TC-IDs>.

Skill 3b · scope gate · US-1234 Yearly leave · 24 executable TCs (3 pending implementation) · 3 common flows · risk: 9 smoke, 7 negative, 4 data-changing, 2 roles
FULL: 3 flows + 24 tails, about 27 min. SHARED: 3 flows, about 4 min — leaves 24 TCs "inferred" at best, including all 9 smoke TCs.
Recommended FULL because the set spans two roles and carries 9 smoke TCs.
```

### Skill 3b done — approved document changed

```
Re-review Testing/Manual_Test/TestCases/SPEC-leave/US-1234-yearly-leave/TC-REVIEW-yearly-leave.html and set "Status: APPROVED" again in the .md (it was changed with your authorization, so it is PENDING HUMAN REVIEW now). ADO-MAP.md exists → also re-run /link-qc-4-publish-test-cases-azure --republish.

Skill 3b · done · US-1234 Yearly leave · scope FULL · 22 validated / 2 enhanced / 0 inferred / 1 discrepancy / 3 not-implemented / 1 draft · progress 25/27
Potential bugs: PB-1 open (TC-ORD-014, balance rounds to whole days). Test data: unknown 3 → 0, missing 0 → 1 (D4 — see Problems).
Needs a human run: TC-ORD-030 (OTP from the test phone [A2] — no SMS test provider on UAT). Page: English (no --lang ar).
```

### Skill 3c — CLI missing / attended login / plan line (no scope gate)

```
Run /sync-skills --tools (installs playwright-cli and its browser), then re-run /link-qc-3c-validate-manual-test-cases-cli.

Skill 3c · BLOCKED · US-1234 Yearly leave · playwright-cli not installed · 3b still works without it
```

```
Log in as hr-manager in the browser window that just opened, then reply "done".

Skill 3c · Phase 2 of 4 (login) · US-1234 Yearly leave · role 2 of 2 · attended login
```

```
Nothing to answer — the walk starts now.

Skill 3c · plan · US-1234 Yearly leave · walking all 18 executable TCs · 3 common flows once · 11 carry 3b evidence (9 current, 2 stale) — all re-validated · tool cli
```

### Skill 5 stops on an unresolved compliance item

Before:
> Uh oh, the pre-run compliance review found some issues in the generated tests, and there are
> also a couple of things I could not verify statically, so I have listed them below for you...

After:
```
Two tests need a decision from you — everything else is fixed and ready to run.

TC-014, TC-019: the document says "the total updates", the code rounds to 2 decimals.
Which is right?

## Compliance gates
**Checkpoint A:** BLOCKED — 2 open items (above) · 6 code defects found and repaired
**Checkpoint B:** scheduled after the run
```
(Confirmed automation-code defects are repaired by the skill, never handed back as a to-do list.
Only an unresolved business decision reaches the user. Keep the gate record whole below the ask.)

Note: a missing or stale `ADO-MAP.md` is **not** a blocker — skill 5 simply runs locally and
skips the DevOps close-out. Never tell the user to run skill 4 first.

### Skill 5 30% smoke failure gate

```
Decide: stop the run (4 of 9 smoke TCs failed, all four are application errors on the leave-balance
endpoint — 500 after submit) or continue to positive/negative anyway.

Skill 5 · Running Smoke Tests (first run) · smoke gate · US-1234 Yearly leave · 9/9 run, 4 failed, 44% > 30%
Failure classes: application 4 · automation 0 · environment 0
Failed: TC-ORD-001, -003, -005, -008 (same endpoint). Screenshots: screenshots/SPEC-leave/YearlyLeave/phase-1/…
```

### Skill 5b smoke gate — stopped, no heal

```
Smoke stopped: 4 of 9 failed, application-error majority — no heal in 5b; fix the leave-balance endpoint (500 after submit), then re-run /link-qc-5b-test-run-manual-cli.

Skill 5b · Phase 3 smoke gate · US-1234 Yearly leave · 9/9 run, 4 failed, 44% > 30% · tool cli
Failed: TC-ORD-001, -003, -005, -008 (same endpoint). Report: reports/SPEC-leave/US-1234-yearly-leave/TEST-RUN-REPORT-yearly-leave.html (phase 4, beside skill 5's phases 1-3)
```

### Skill 5b — an AI Oracle rubric the reply text cannot settle

```
Answer Q-3 (rubric-ambiguous): TC-BOT-004 "Must contain: the remaining balance" — the assistant answered "18 days left" in 3 of 3 repeats; the rubric does not say whether a number without the word "balance" counts. Recommended: count it (intent met). Reply yes / no.

Skill 5b · Phase 3 of 4 (positive) · US-2210 Leave assistant · 12/16 run · 1 ai_rubric_failure (TC-BOT-002, language) · 1 rubric question · tool cli
Replies stored verbatim: screenshots/SPEC-leave/LeaveAssistant/phase-4/TC-BOT-004/manual-cli--none--r1..r3/reply.md
```

### Skill 11 export ready

```
Open Testing/Requirements/SPEC-leave/US-1234-yearly-leave/BUSINESS-RULES-US-1234.md, fill the
decision block (Approve / Reject / Defer per rule), then re-run /link-qc-11-discover-business-rules --apply-approved.

Skill 11 · Phase 6 report · US-1234 Yearly leave · 31 rules found: 19 in spec, 4 partial, 7 not in spec, 1 contradicts
Act on first — the contradiction: BR-017 code allows 45 days carry-over, REQ-1234-R7 says 30 (src/leave/rules.ts:88).
Not in spec (top 3 of 7): BR-021 max 3 pending requests · BR-024 name unique per department · BR-029 soft delete only. All 7 are in the export.
```

### link-qc-6-ui-testing — pre-flight ask, then report ready

The one ask, before the browser opens (everything in one message, nothing asked later):

```
Reply with: languages to test (EN / AR / both) · which the Figma frame covers · role to audit as · environment (QA / staging) — credentials only if the repo has no test-credential mechanism (none found).

link-qc-6-ui-testing · Step 1 pre-flight · Dashboard · design: Figma (MCP attached) · implementation: live URL
```

Before:
> I have completed the visual audit of the dashboard in both languages. I found quite a few
> discrepancies, mostly around colours and spacing, and I also noticed the Arabic version has
> some RTL issues. The report is written and includes annotated screenshots for every bug...

After:
```
Open Testing/UI-Testing/Reports/UI-Visual-QA-dashboard.md; answer Q01–Q03 (measured values inside) so they become bugs or confirmed rules.

link-qc-6-ui-testing · done · Dashboard EN + AR · EN Tier 1 match 78 % 🔧 Needs Fixes · AR heuristic ⚠️ Pass with Minor Fixes
Bugs: Severity 2 → 1 (AR chevrons not mirrored) · Severity 3 → 6 · Severity 4 → 4 (all 11 in the report, evidence/dashboard_en, dashboard_ar)
Coverage: 12/12 regions · 9/11 states (error, session-timeout not reachable) · 5 widths · rows 10 of 45 scanned.

Optional: a second round measures how complete this one was (about 10 min).
```

## 4. Progress lines (skill 5 stage messages, skill 5b manual CLI run, skill 3b live validation, skill 10/11 discovery, link-qc-6-ui-testing measurement)

Skill 5 posts nothing per refresh: one message per finished stage, its `update` lines kept as they
are (first line = the stage result, then failures / not run, the isolation check, the rate-limit
line, blockers, the smoke gate or the phase-wide line), the activity name as the label. A re-run
message states its subset first and the phase totals last:

```
Smoke tests completed (first run): 12 passed, 2 failed, 0 skipped, 0 not run — 14 TCs, 03:10.
Failed: TC-ORD-003, TC-ORD-009.
Isolation check: 3 TCs re-run alone: 1 passed alone (parallel interference: TC-ORD-005), 2 failed again (confirmed: TC-ORD-003, TC-ORD-009).
Blockers: none.
Smoke gate: 14.3% failed (limit 30%) — Positive tests may continue.
```

The others print one line per refresh, fixed field order, no prose between refreshes.

Skill 5b (manual CLI run) — one line per TC, `· tool cli` appended, never "self-healed":

```
Smoke 4/9 · TC-ORD-012 running · 03:10 elapsed · ETA 04:00 · 0 failed · tool cli
```

Live validation (skill 3b) and discovery (skills 10/11):

```
Validated 7/18 · flows 2/3 · 2 pending implementation · 1 stale · 0 blocked
Traced 5/8 entry points · 3 validators, 2 migrations read
Regions 8/12 · states 6/11 · widths 3/5 · bugs so far 7 (S2 1 · S3 4 · S4 2)
```

The per-run progress log file keeps the skill's full format; the chat shows the line.

## 5. Lists — grouping keys per skill

| Skill | Group by | Show | Always state |
|---|---|---|---|
| 2 | Missing / Ambiguous / Untestable / Conflict / Risk | top item per group | total per group, all in REQ review |
| 3 | smoke / positive / negative (then locale) | pending-implementation TCs and open questions first | total TCs, coverage %, path to .md and .html, "3b optional" |
| 3b | validated / enhanced / inferred / discrepancy / not-implemented / draft | potential bugs and discrepancies first, then what stayed unvalidated, then data changes left behind | scope chosen, six counts, progress x/N, PB ids, data changes made / cleaned / kept / left, items prepared (kept / removed, the way each used, stamped values substituted), not-creatable items with their evidence, Status outcome |
| 3c | same as 3b | same as 3b, then data changes left behind | same as 3b, plus tool cli, the TC-IDs that carried 3b evidence (all re-validated), data changes made / cleaned / kept / left, items prepared (kept / removed, the way each used, stamped values substituted), not-creatable items with their evidence, ways decided / undecided, sessions closed |
| 4 (publish) | verified / mismatch / conflict / not verified / not written | not written and mismatches first | the one outcome line with its counts, ADO-MAP path |
| 5 (automation) | reuse / extend / create (inventory), then full / partial (human step) / manual | undecided duplicate candidates first, then partial TCs | inventory counts, coverage counts, run of record path |
| 5 (run) | application / automation / environment (incl. rate limited) | application failures first, then parallel interference, then rate-limited TCs | passed/failed/skipped, re-run count (impacted / no verdict / not needed), results of record path |
| 5b | application / assistant-rubric / environment / human step | application failures first, then `ai_rubric_failure`, then `PARTIAL` TCs, then test data (prepared items with stamped values, not-creatable skips with evidence, records kept / cleaned up) | PASS / FAIL / INCOMPLETE / SKIP / NOT_RUN / PARTIAL counts, repeats per AI TC, readiness decisions (ready / prepared api·ui·db / skipped data_missing·not creatable·QC declined), run of record path (same folder as 5) |
| 11 | Contradicts / Not in spec / Partial / In spec | contradictions first | totals, export path |
| link-qc-6-ui-testing | Severity 2 / 3 / 4 (then language, then mode: design comparison / heuristic) | Severity 2 first, then Open Questions | bug count per severity, match score or quality verdict, QA verdict, report path, tier used |

## 6. What is NOT allowed under this overlay

- Shortening, reordering or dropping any section of a file a skill writes.
- Removing rows from `ADO-MAP.md`, TC tables, EARS catalogues or bug reports because of "cap to 5".
- Setting `Status: APPROVED`, filling a PO decision block, or answering an intake-gate question on
  the reader's behalf (skills 5 / 5b set `APPROVED` only after the reader answered *approve now*).
- Skipping the skill's mandatory learning-file update because it looks like a "recap".
- Presenting an environment failure (VPN, DNS, expired login) as a product bug.
- Replacing a gate line with "Shall I continue?".

## 7. Time estimates that work here

Point them at what the reader waits for, in minutes:

- Skill 2 single story: 5–10 min; spec with 4 stories: 20–30 min.
- Skill 3: ~1 min per TC designed (no environment needed).
- Skill 3b: FULL ~1 min per common flow + ~1 min per TC tail walked; SHARED ~1 min per flow only.
- Skill 3c: same as 3b plus ~1 min per attended login; the comparison protocol runs both and reports the measured times.
- Skill 4: ~20 s per TC published; re-run on an unchanged document: under 1 min.
- Skill 5 generation: ~2 min per TC; runs: read the ETA from the progress log (or the last stage message), do not guess.
- Skill 5b: ~1 min per TC + ~1 min per attended login + repeats × AI TCs (each repeat waits for one more reply); then read the ETA from the progress line.
- link-qc-6-ui-testing: ~10 min per screen and language at Tier 1–3 (live URL), plus ~5 min for the state and width sweep; screenshot-only inputs ~15 min; the second round ~10 min.

Adjust from the actual elapsed time as soon as one is available; the reader trusts the number.

## Azure sync progress and grouping
Status line: link-qc-8 · azure-to-md · 8/10 mapped bugs read · 2 retest candidates.
Group link-qc-7 as Test Plan results; link-qc-8 as bug creation + state synchronization (report the direction that ran); link-qc-9 as observed retesting (route per bug: automation re-run / playwright-cli; report the pass rate before → after). Preserve the complete per-item result table and separate conflicts, failed writes and NOT_RUN.
Timing: estimate link-qc-7 and link-qc-8 from item count and observed MCP latency; link-qc-9 from the re-run TCs' durations in the latest phase (automation) and reproduction steps × language passes (playwright-cli). Unknown timings stay unknown; never invent durations.
