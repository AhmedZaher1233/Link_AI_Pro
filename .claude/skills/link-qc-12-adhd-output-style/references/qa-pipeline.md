# QA pipeline overlay — detail and worked examples

Companion to `../SKILL.md` section "QA pipeline overlay (Link_AI_Pro skills 1-7)". Read when
`/i-have-adhd` is active and one of the QA skills is running. Nothing here changes a skill; it
changes only how the CHAT around the skill reads.

## 1. The pipeline and where humans stop it

| Order | Skill | Writes (never reshaped) | Human gate (becomes the first line) |
|---|---|---|---|
| 1 | `1-generate-update-testing-structure` | `Testing/` layout, `project-learning.md` | none — report only |
| 2 | `2-review-requirements` | `Testing/Requirements/[SPEC-*/]US-{id}-{name}/REQ-*.md`, Full Review Template | Intake gate: one open question at a time, after `project-learning.md` was consulted |
| 7 | `7-discover-business-rules` | export doc `PENDING PO APPROVAL` in the story folder | PO fills the decision block -> re-run `--apply-approved` |
| 3 | `3-generate-manual-test-cases` | `Testing/Manual_Test/TestCases/[SPEC-*/]US-*/TEST-CASES*.md`, `TEST-DATA*.md`, HTML review page | Reviewer opens the HTML page, then sets `Status: APPROVED` in the .md |
| 4 | `4-white-box-testing` | project profile, Implementation Analysis report | none — report only |
| 5 | `5-publish-test-cases-azure` | beautified upload doc, `ADO-MAP.md`, ADO Test Case work items | Entry: `Status: APPROVED` present |
| 6 | `6-test-run-automation` | Playwright specs + POM, run plan, progress log, screenshots, bug drafts, AUTOMATION COMPLETE report | Entry: `Status: APPROVED` (ADO publishing optional) · Checkpoint A compliance gate · PHASE 2.6 test-data readiness · 30% smoke failure gate · Checkpoint B compliance gate |

Rule: the gate is the message's first line, with the path. The skill's own report follows,
complete.

## 2. Turn opener — one line, always

```
Skill {n} · {Phase x of y} ({phase name}) · {US-id story name}[ · story a of b] · {one progress fact}
```

Examples:

- `Skill 2 · Dependency check · US-4410 Leave balance · 2 of 3 dependency REQs resolved`
- `Skill 3 · Phase 4 of 5 (live validation) · US-1234 Yearly leave · story 2 of 4 · 11/18 TCs validated`
- `Skill 6 · PHASE 3 first run · US-1234 Yearly leave · smoke 9/9 passed, positive 6/14`

## 3. Gate messages — before / after

### Skill 3 review page ready

Before:
> I have finished designing the test cases for the yearly leave story. There are 27 test cases
> covering smoke, positive and negative paths in both English and Arabic. I validated 24 of them
> against the live app and 3 are pending implementation. I also generated an HTML review page.
> Let me know if you would like me to proceed with publishing.

After:
```
Open Testing/Manual_Test/TestCases/SPEC-leave/US-1234-yearly-leave/TEST-CASES-US-1234.html,
review, then set "Status: APPROVED" in TEST-CASES-US-1234.md.

Skill 3 · done · US-1234 Yearly leave · 27 TCs (9 smoke / 11 positive / 7 negative), 24 validated live, 3 pending implementation.
Full list is in the .md; the 3 pending ones: TC-YLVL-021, -022, -026 (carry-over rules not deployed yet).

Next after approval: /5-publish-test-cases-azure on that document (about 10 minutes for 27 TCs).
```

### Skill 6 stops on an unresolved compliance item

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

Note: a missing or stale `ADO-MAP.md` is **not** a blocker — skill 6 simply runs locally and
skips the DevOps close-out. Never tell the user to run skill 5 first.

### Skill 6 30% smoke failure gate

```
Decide: stop the run (4 of 9 smoke TCs failed, all four are application errors on the leave-balance
endpoint — 500 after submit) or continue to positive/negative anyway.

Skill 6 · PHASE 3 smoke gate · US-1234 Yearly leave · 9/9 run, 4 failed, 44% > 30%
Failure classes: application 4 · automation 0 · environment 0
Failed: TC-YLVL-001, -003, -005, -008 (same endpoint). Screenshots: screenshots/SPEC-leave/YearlyLeave/phase-1/…
```

### Skill 7 export ready

```
Open Testing/Requirements/SPEC-leave/US-1234-yearly-leave/BUSINESS-RULES-US-1234.md, fill the
decision block (Approve / Reject / Defer per rule), then re-run /7-discover-business-rules --apply-approved.

Skill 7 · Phase 6 report · US-1234 Yearly leave · 31 rules found: 19 in spec, 4 partial, 7 not in spec, 1 contradicts
Act on first — the contradiction: BR-017 code allows 45 days carry-over, REQ-1234-R7 says 30 (src/leave/rules.ts:88).
Not in spec (top 3 of 7): BR-021 max 3 pending requests · BR-024 name unique per department · BR-029 soft delete only. All 7 are in the export.
```

## 4. Progress lines (skill 6 live progress, skill 3/4/7 discovery)

One line per refresh, fixed field order, no prose between refreshes:

```
Smoke 4/9 · TC-YLVL-012 running · 03:10 elapsed · ETA 04:00 · 0 failed
Positive 6/14 · TC-YLVL-031 running · 09:42 elapsed · ETA 11:30 · 1 failed (automation, self-healed)
```

Discovery:

```
Validated 7/18 TCs · 2 pending implementation · 0 blocked
Traced 5/8 entry points · 3 validators, 2 migrations read
```

The per-run progress log file keeps the skill's full format; the chat shows the line.

## 5. Lists — grouping keys per skill

| Skill | Group by | Show | Always state |
|---|---|---|---|
| 2 | Missing / Ambiguous / Untestable / Conflict / Risk | top item per group | total per group, all in REQ review |
| 3 | smoke / positive / negative (then locale) | pending-implementation and blocked TCs first | total TCs, path to .md and .html |
| 4 | Gap / Bug / Repro | bugs first, ranked by severity | total, path to report |
| 5 | created / updated / unchanged / failed | failed first | counts, ADO-MAP path |
| 6 | application / automation / environment | application failures first | passed/failed/skipped, run of record path |
| 7 | Contradicts / Not in spec / Partial / In spec | contradictions first | totals, export path |

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
- Skill 3: ~1 min per TC designed + ~1 min per TC validated live.
- Skill 5: ~20 s per TC published; re-run on an unchanged document: under 1 min.
- Skill 6 generation: ~2 min per TC; runs: read the ETA from the progress line, do not guess.

Adjust from the actual elapsed time as soon as one is available; the reader trusts the number.
