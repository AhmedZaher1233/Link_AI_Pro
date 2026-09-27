# QA pipeline overlay — detail and worked examples

Companion to `../SKILL.md` section "QA pipeline overlay (Link_AI_Pro skills 1-11, 3b and 3c)". Read when
`/link-qc-12-adhd-output-style` is active and one of the QA skills is running. Nothing here changes a skill; it
changes only how the CHAT around the skill reads.

## 1. The pipeline and where humans stop it

| Order | Skill | Writes (never reshaped) | Human gate (becomes the first line) |
|---|---|---|---|
| 1 | `link-qc-1-generate-update-testing-structure` | `Testing/` layout, `project-learning.md` | none — report only |
| 2 | `link-qc-2-review-requirements` | `Testing/Requirements/[SPEC-*/]US-{id}-{name}/REQ-*.md`, Full Review Template | Intake gate: one open question at a time, after `project-learning.md` was consulted |
| 3 | `link-qc-3-generate-manual-test-cases` | `Testing/Manual_Test/TestCases/[SPEC-*/]US-*/TEST-CASES*.md` (every TC `draft — not app-validated`; URLs / accounts / shared data as `[E1]` / `[A1]` / `[D2]` tokens; `[HUMAN]` steps where no test interface exists; optional `Tags:`), `TEST-DATA*.md` (§0 Environment, §1 Accounts, data items), rendered HTML review page (English unless `--lang ar`) | Reviewer opens the HTML page, answers the open questions, then sets `Status: APPROVED` in the .md. The one extra ask: an out-of-browser interface (mail sandbox / SMS provider) only when nothing recorded answers it |
| 3b | `link-qc-3b-validate-manual-test-cases` (optional, before or after approval) | the same three files patched in place (validation states, corrected steps, Potential Bugs, test-data statuses) | none — not a gate. Scope choice (FULL / SHARED / CUSTOM) is the one question; an APPROVED document is read-only until the reviewer authorizes the revision, and goes back to `PENDING HUMAN REVIEW` only if something changed |
| 3c | `link-qc-3c-validate-manual-test-cases-cli` (optional, evaluation twin of 3b through playwright-cli) | the same files patched in place, plus `evidence/` screenshots for potential bugs | none — not a gate, and NO scope gate: every TC is walked on every run (no scope choice, no cross-validator choice — 3b evidence is re-validated). Its only asks: attended login (one "done" per role), the data-changes yes/no, and the revision authorization on an APPROVED document. Not installed CLI → BLOCKED with `/sync-skills --tools` |
| 4 | `link-qc-4-publish-test-cases-azure` | beautified upload doc, `ADO-MAP.md`, ADO Test Case work items (tokens and `[HUMAN]` kept verbatim, tags = feature + smoke + automation/manual + human-step + the TC's `Tags:`), one outcome line of five | Entry: `Status: APPROVED` present |
| 5 | `link-qc-5-test-run-automation` | `automation-inventory.md` (page-object reuse / extend / create decisions) before any code, Playwright specs + POM, run plan, progress log, screenshots, bug drafts, AUTOMATION COMPLETE report (`partial (human step: n)` for `[HUMAN]` TCs) | Entry: `Status: APPROVED` (ADO publishing optional) · Checkpoint A compliance gate (an undecided duplicate page object blocks it) · PHASE 2.6 test-data readiness · 30% smoke failure gate · Checkpoint B compliance gate |
| 6 | `link-qc-6-ui-testing` (beside the chain, per screen, any time) | `Testing/UI-Testing/Reports/UI-Visual-QA-<page>.md` + evidence crops, `Learning-UI.md`, `Coverage-Index.md` | none — not a gate. One combined ask before the browser opens (languages, role, credentials, environment); Open Questions answered by the product owner become bugs or rules |
| 7 | `link-qc-7-sync-tc-status-to-azure` (optional) | one Azure test run with the latest phase's outcomes; no local file | none — not a gate. NOT_RUN when the attached server has no test-plan tools is a complete outcome |
| 8 | `link-qc-8-sync-bugs-azure` (optional) | `ADO-BUG-MAP.md` beside `ADO-MAP.md`, Azure Bug items, BUG-REPORT Status/History (Azure → md only) | Direction gate: ONE question (md → Azure / Azure → md / both) unless `--direction`; missing bug fields asked as one list |
| 9 | `link-qc-9-retesting` (optional) | BUG-REPORT Status/History (+ new entries), retest evidence PNGs, ledger; Azure close / reopen | Pre-flight ask before the browser opens (URL, role, environment, data changes, language switch); `resolved` only after a positive observation |
| 10 | `link-qc-10-white-box-testing` | project profile, Implementation Analysis report | none — report only |
| 11 | `link-qc-11-discover-business-rules` | export doc `PENDING PO APPROVAL` in the story folder | PO fills the decision block -> re-run `--apply-approved` |

Rule: the gate is the message's first line, with the path. The skill's own report follows,
complete.

### 1a. Five facts that stay short in chat (SKILL.md section C2)

- **Reference tokens** — say `[A1]`, `[E1]`, `[D2]`, never the value behind them. Missing row →
  one gate line: `Add row E2 (mail sandbox) to TEST-DATA-{feature}.md, then re-run skill 3 --revision.`
- **`[HUMAN]` steps** — one count per message: `2 TCs stop at a [HUMAN] step — needs a human run.`
  Never "skipped", never "N/A". 3b / 3c: `draft (human step pending)`. Skill 5: `partial (human step: n)`, never PASS.
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

Examples:

- `Skill 2 · Dependency check · US-4410 Leave balance · 2 of 3 dependency REQs resolved`
- `Skill 3 · Phase 2 of 4 (TC design) · US-1234 Yearly leave · story 2 of 4 · 18 TCs drafted`
- `Skill 3b · Phase 3 of 4 (live walk) · US-1234 Yearly leave · scope FULL · 11/18 observed`
- `Skill 3c · Phase 3 of 4 (live walk) · US-1234 Yearly leave · all 18 TCs · tool cli · 11/18 observed`
- `Skill 5 · PHASE 3 first run · US-1234 Yearly leave · smoke 9/9 passed, positive 6/14`
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

Skill 5 · PHASE 3 smoke gate · US-1234 Yearly leave · 9/9 run, 4 failed, 44% > 30%
Failure classes: application 4 · automation 0 · environment 0
Failed: TC-ORD-001, -003, -005, -008 (same endpoint). Screenshots: screenshots/SPEC-leave/YearlyLeave/phase-1/…
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

## 4. Progress lines (skill 5 live progress, skill 3b live validation, skill 10/11 discovery, link-qc-6-ui-testing measurement)

One line per refresh, fixed field order, no prose between refreshes:

```
Smoke 4/9 · TC-ORD-012 running · 03:10 elapsed · ETA 04:00 · 0 failed
Positive 6/14 · TC-ORD-031 running · 09:42 elapsed · ETA 11:30 · 1 failed (automation, self-healed)
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
| 3b | validated / enhanced / inferred / discrepancy / not-implemented / draft | potential bugs and discrepancies first, then what stayed unvalidated | scope chosen, six counts, progress x/N, PB ids, Status outcome |
| 3c | same as 3b | same as 3b, then data changes left behind | same as 3b, plus tool cli, the TC-IDs that carried 3b evidence (all re-validated), data changes made / cleaned / left, sessions closed |
| 4 (publish) | verified / mismatch / conflict / not verified / not written | not written and mismatches first | the one outcome line with its counts, ADO-MAP path |
| 5 (automation) | reuse / extend / create (inventory), then full / partial (human step) / manual | undecided duplicate candidates first, then partial TCs | inventory counts, coverage counts, run of record path |
| 6 | application / automation / environment | application failures first | passed/failed/skipped, run of record path |
| 7 | Contradicts / Not in spec / Partial / In spec | contradictions first | totals, export path |
| link-qc-6-ui-testing | Severity 2 / 3 / 4 (then language, then mode: design comparison / heuristic) | Severity 2 first, then Open Questions | bug count per severity, match score or quality verdict, QA verdict, report path, tier used |

## 6. What is NOT allowed under this overlay

- Shortening, reordering or dropping any section of a file a skill writes.
- Removing rows from `ADO-MAP.md`, TC tables, EARS catalogues or bug reports because of "cap to 5".
- Setting `Status: APPROVED`, filling a PO decision block, or answering an intake-gate question on
  the reader's behalf.
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
- Skill 5 generation: ~2 min per TC; runs: read the ETA from the progress line, do not guess.
- link-qc-6-ui-testing: ~10 min per screen and language at Tier 1–3 (live URL), plus ~5 min for the state and width sweep; screenshot-only inputs ~15 min; the second round ~10 min.

Adjust from the actual elapsed time as soon as one is available; the reader trusts the number.

## Azure sync progress and grouping
Status line: link-qc-8 · azure-to-md · 8/10 mapped bugs read · 2 retest candidates.
Group link-qc-7 as Test Plan results; link-qc-8 as bug creation + state synchronization (report the direction that ran); link-qc-9 as observed retesting. Preserve the complete per-item result table and separate conflicts, failed writes and NOT_RUN.
Timing: estimate link-qc-7 and link-qc-8 from item count and observed MCP latency; link-qc-9 from reproduction steps × language passes. Unknown timings stay unknown; never invent durations.
