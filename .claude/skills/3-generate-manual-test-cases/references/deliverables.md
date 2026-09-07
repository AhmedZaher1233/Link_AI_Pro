# Deliverables, revision mode and the human gate — load at the delivery phase (workflow step 10)

## 1. Pre-write guard — check the target BEFORE writing anything

For every story, read `{tc_output_folder}/TEST-CASES-{feature}.md` (and the folder) before the
first write:

| Target state | What you do |
|---|---|
| Nothing there | Write both deliverables normally. |
| `Status: APPROVED` | **STOP — do not write.** Report: the document is human-approved and `5-publish-test-cases-azure` may already have published it, so regenerating it changes the source revision `ADO-MAP.md` was built from. Offer three routes: `--revision` (patch only the TCs the reviewer names), Case 1 (ingest the approved set as the baseline and produce an updated set the reviewer re-approves), or an explicit "overwrite it" instruction from the user. Proceed only on that explicit instruction, and then say in the final message that skill 5 must be re-run with `--republish`. |
| `Status: PENDING HUMAN REVIEW` | Do not silently overwrite. Say what exists (TC count, date) and offer the Case 1 route; on the user's go-ahead, regenerate. In `--revision` mode, patch it in place as usual. |
| Markdown present, HTML missing or unrecognizable | Keep the markdown authority, regenerate the HTML, and say so. Never delete an existing HTML page — overwrite it from the markdown. |

`--audit` never reaches this step as a writer: it reports the table above plus the planned TC
count, the coverage score, the Case 1 dispositions and every file that WOULD change, and writes
nothing at all — not even the learning file.

## 2. `TEST-CASES-{feature}.md` — the source of truth

Write to `{tc_output_folder}` (one folder per User Story — create it if missing). Header block:

```markdown
# Test Cases — {feature}
**Status:** PENDING HUMAN REVIEW
**Entry case:** {fresh design | existing-TC update | story retrieved from Azure DevOps/Word}
**Implementation status:** {Implemented | Partially implemented | Not implemented | Cannot be validated} — {evidence}
**Requirement IDs covered:** {list}
**Total test cases:** {N} ({happy}/{edge}/{negative}, per locale)
**Run-stage mapping:** happy-path + edge-case → @positive · rejection/guard assertions → @negative
**Patterns applied / skipped:** {list with reasons}
**MCP validation:** {N validated} / {N enhanced} / {N inferred} / {N discrepancy} / {N not-implemented} / {N draft}
**Smoke TCs:** {N}
**Automation candidates:** {N of total}
**Requirement coverage (weighted):** {x}% — Full {n} / Partial {n} / None {n} of {ACs} acceptance criteria
**Manual-only scenarios:** {N} (High {h} · Medium {m} · Low {l})
```

Then, in order: summary table (ID, Type, Locale, Requirement, Smoke, Automation Candidate, Data
effect, Shared data, Validation, Description) → full TC details (format from `tc-design.md`) →
Existing-TC Analysis table (Case 1 only) → enhancement log → self-review tables (traceability
matrix, negative coverage, standards alignment, **requirement coverage score** per AC,
**manual-only scenarios** with category + priority) → Open Findings for the Human Reviewer (with
gaps, defects, and pending-implementation items in separate subsections).

## 3. Update `{learning_file}`

Per `learning-file.md` "Write": new common flows, UI knowledge, test data, locale differences →
tagged lines in the shared sections; this run's user answers →
`### Manual TC Model (skill 3) → #### Questions and Answers`; project-wide facts →
`## Project Knowledge`; `[similar: …]` links and the `## Index` row updated. Deduplicate by
grepping the tags first; update contradicted entries; keep it simple English with no code
identifiers and never a credential.

## 4. `TC-REVIEW-{feature}.html` — the designed review page

Start from `assets/tc-review.template.html` (next to this skill's SKILL.md): it carries the
skeleton and the whole inline `<style>` block, with the same design tokens as
`6-test-run-automation/assets/coverage-dashboard.css` so both stages read the same way. Fill its
placeholders — never restyle it per run.

A single **self-contained** HTML file in the same per-story folder `{tc_output_folder}`: all CSS
inline, no external requests, light/dark aware via `prefers-color-scheme`, built so a human can
review the whole set in minutes. Generate it FROM the markdown you just wrote — the markdown is
the single source of truth; the page never adds, rewords, or reorders content.

- **Header**: feature name, status banner (PENDING HUMAN REVIEW), date, REQ-IDs, entry case, and
  the implementation status (prominent when not fully implemented).
- **Summary tiles**: total TCs, by type, by locale, automation candidates, validation breakdown
  (validated / enhanced / inferred / discrepancy / not-implemented / draft). Tile numbers must
  always match the cards below.
- **Requirement coverage tile**: a CSS `conic-gradient` gauge (no chart library) driven by two
  custom properties — `--p` = Fully Covered share of ACs, `--q` = Fully + Partially share — with
  the weighted % in the centre and Full / Partial / None chips (green / amber / grey) beside it;
  under it one stacked bar per AC (three segments, widths = share of that AC's checks: happy /
  negative categories / locales present) so the reviewer sees *where* depth is missing. Numbers
  come from the self-review item 4 table only.
- **Traceability matrix** table (AC ↔ REQ-ID ↔ TC-IDs, gaps highlighted).
- **What stays manual** section: the self-review item 5 table (Category · TC-ID · Scenario · Why
  manual · Priority), rows colour-coded by priority (High red / Medium amber / Low grey),
  grouped by category, never collapsed.
- **Existing-TC Analysis** section (Case 1 only): disposition per original TC.
- **One collapsible card per TC** (`<details>`): ID + description in the summary row with
  colour-coded badges — type, locale, **smoke badge** (so the reviewer can flip smoke markings at
  review time), **automation-candidate badge**, **validation badge** (green validated / blue
  enhanced / purple inferred / amber discrepancy / orange not-implemented / grey draft).
  `inferred` and `discrepancy` cards carry a short caption telling the reviewer to check them
  with extra care; `not-implemented` cards carry a "Pending Implementation" caption. A small
  **run badge** shows `Data effect` / `Shared data` when set (so the reviewer can see which TCs
  will run in parallel vs one after another). Inside: preconditions, numbered steps with inline
  assertions, expected result, data oracle, Data effect / Shared data (or "let automation
  infer"), and a "Reviewer notes" placeholder box.
- **Enhancement log** section (what the live app changed and why).
- **Discrepancies & open findings** section, visually prominent (never collapsed), with
  requirement gaps, application defects, and pending-implementation items clearly separated.
- Wide tables scroll inside their own container; the page never scrolls horizontally.
  Right-to-left content renders correctly (`dir="rtl"` on RTL-only content).
- No password, token, selector or code identifier appears anywhere on the page.

## 5. Final message to the user

Tell the reviewer, explicitly:

1. Open `TC-REVIEW-{feature}.html` for the fast visual review; the markdown is the source of
   truth.
2. `inferred` TCs were confirmed from prior knowledge, not directly observed — review those with
   extra care. `not-implemented` TCs are requirement-based and pending implementation — they are
   not evidence of application defects. `draft — not app-validated` TCs were never seen live —
   say why (app unreachable, or no Playwright MCP server attached).
3. To approve: edit `TEST-CASES-{feature}.md` — adjust any **Automation Candidate** markings,
   optionally set **Data effect** / **Shared data** on TCs that change data or share records
   (this steers which TCs skill 6 runs in parallel vs one after another), then change `Status:`
   to `APPROVED`.
4. To request changes: reply with corrections (reference TC-IDs) → re-run this skill with
   `--revision`.
5. Approval unlocks `5-publish-test-cases-azure` (beautify + publish to Azure DevOps, writes
   `ADO-MAP.md`) and only then `6-test-run-automation`. Neither accepts a document that is not
   `Status: APPROVED`, and `not-implemented` TCs should not be automated until the story ships.
6. Multi-story run: point at `TC-GENERATION-SUMMARY.md` and note that each story is approved
   separately.

---

## `--revision` mode

Input is human feedback referencing TC-IDs (or a corrected file).

- Apply each correction exactly; touch ONLY the referenced TCs.
- If a correction changes steps that were MCP-validated, re-validate just those steps against
  the live app (re-ask for URL/credentials only if the session lost them).
- **Patch, do not regenerate.** In the markdown, edit only the affected TC sections and
  summary-table rows, and recompute the header counts (totals, validation breakdown, automation
  candidates, requirement coverage score, manual-only count). In the HTML, update only the
  affected TC cards AND always recompute the summary tiles, validation breakdown, the requirement
  coverage gauge and the "What stays manual" table so the page stays internally consistent. Do
  NOT rewrite either file wholesale. If the existing HTML is missing or structurally
  unrecognizable, regenerate it fully and say so.
- Keep status `PENDING HUMAN REVIEW`. If the document was `APPROVED`, patching it means the
  source revision changed — say in the final message that skill 5 needs `--republish`.
- Include a **Corrections Applied** table: | Feedback item | TC-ID(s) | Fix applied |
- Add any newly discovered knowledge to `{learning_file}`.
- Ambiguous feedback → BLOCKED with the specific ambiguity. Do not guess intent.
- Do NOT change unreferenced test cases.

---

## Structured returns

```markdown
## TEST CASES READY FOR HUMAN REVIEW

**Feature:** {name}
**Entry case:** {fresh design | existing-TC update | retrieved from Azure DevOps/Word}
**Implementation status:** {Implemented | Partially implemented | Not implemented | Cannot be validated}
**Deliverables:** {tc_output_folder}/TEST-CASES-{feature}.md · {tc_output_folder}/TC-REVIEW-{feature}.html
{Case 2: **Requirement file generated:** {requirements_folder}/REQ-{storyID}-{feature}.md}
{Multi-story: **Stories processed:** {N} — spec folder: {manual test-cases root}/SPEC-{spec_name}/ (spec-file input) — summary: {manual test-cases root}/[SPEC-{spec_name}/]TC-GENERATION-SUMMARY.md}
**Status:** PENDING HUMAN REVIEW
**Totals:** {N} TCs ({breakdown}) · {N} automation candidates
**Requirement coverage:** {x}% weighted — Full {n} / Partial {n} / None {n} of {ACs} ACs
**Manual-only scenarios:** {N} (High {h} · Medium {m} · Low {l})
**MCP validation:** {validated}/{enhanced}/{inferred}/{discrepancy}/{not-implemented}/{draft}
{Case 1: **Existing-TC analysis:** {kept}/{updated}/{merged}/{removed}/{new}}
**Common flows validated:** {list}
**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}
**Open findings for the reviewer:** {gaps / defects / pending-implementation, or "None"}
**Next step:** {the approval instructions from §5}
```

```markdown
## TEST CASES REVISED

**Revision cycle:** {N}
**Corrections Applied:** {table}
**Not addressed:** {item + reason, or "None"}
**Files patched:** markdown {TC-IDs + header counts recomputed} · HTML {cards updated + tiles recomputed}
**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}
```

```markdown
## TEST CASE AUDIT (no files written)

**Feature / stories:** {list}
**Entry case:** {resolved case} · **Implementation status:** {status — evidence}
**Existing deliverables:** {path — Status / TC count / date, or "none"}
**Would write:** {files} · **Would overwrite:** {files, or "nothing"}
**Planned coverage:** {N} TCs ({breakdown}) · {x}% weighted over {ACs} ACs
{Case 1: **Planned dispositions:** {kept}/{updated}/{merged}/{removed}/{new}}
**Blockers to a real run:** {list, or "none"}
**Learning file:** not touched (audit)
```

---

## Quality checklist — before returning TEST CASES READY FOR HUMAN REVIEW

- [ ] Intake gate passed — all missing inputs asked in ONE message and answered before the flow started; nothing assumed
- [ ] Entry case resolved first (existing TCs / no spec / default) — asked, not assumed; multi-story input split per story
- [ ] Manifest read first; deliverables written to the per-story folder `{tc_output_folder}` (no fallback locations)
- [ ] Pre-write guard run: no approved document overwritten without an explicit instruction; skill 5 `--republish` note given when it was
- [ ] Writes confined to `{tc_output_folder}`, `{requirements_folder}` and `{learning_file}` — no spec, steering, source, ADO-MAP or automation file touched
- [ ] Case 1: existing TCs read from their stated source; every original TC accounted for once in the Existing-TC Analysis table; set NOT regenerated from scratch
- [ ] Case 2: User Story retrieved via Azure DevOps MCP (or Word MCP / exported text); structured requirement file written to `{requirements_folder}` and used as the spec source
- [ ] Playwright MCP availability probed BEFORE the credentials ask; absent → whole run `Cannot be validated`, all TCs `draft — not app-validated`, reported
- [ ] Implementation status determined BEFORE any TC-level validation; evidence recorded
- [ ] No not-implemented functionality marked validated, enhanced, or as a defect; gaps / defects / pending-implementation kept in separate lists
- [ ] Project profile fully resolved — no invented URLs, credentials, or paths
- [ ] Learning file searched first (Index + tag grep, not the whole file); known and `[similar:]` knowledge reused, not re-asked or re-discovered
- [ ] User asked for URL + credentials per role in ONE message, and answers received before any MCP navigation
- [ ] All spec/steering sources read; all REQ-IDs verified verbatim
- [ ] Draft designed from specs FIRST; discovery plan (common flows / gaps) built before any MCP navigation
- [ ] Common flows validated once; per-TC replay limited to unique tails; snapshots limited to once per new screen
- [ ] No TC marked `validated` whose unique tail was not observed; `inferred` used honestly
- [ ] Secondary-locale labels for every referenced element captured live — none guessed; full secondary-locale walks done where `mcp-pass.md` §4 requires them
- [ ] Every TC carries a Validation state; every enhancement is in the log
- [ ] Discrepancies recorded as findings — never designed around
- [ ] Coverage minimums met; all L1 §4 negative categories represented or justified N/A
- [ ] Every TC has one entry per required locale, confirming language + direction first
- [ ] Data Oracle cited for every data-asserting TC
- [ ] Every step has the 4 handoff fields; TCs read as complete user journeys; no selectors, code or passwords in deliverables
- [ ] Run-stage mapping stated in the header (happy-path + edge-case → @positive; rejection/guard → @negative)
- [ ] Self-review tables completed and included; own findings fixed in place
- [ ] Requirement coverage score computed per AC (Fully / Partially / Not Covered, weighted %) — in the markdown header + tables and as the gauge in the HTML; no AC left at 0.0 without a fix or an Open Finding
- [ ] Manual-only scenarios table present: every `Automation Candidate = NO` TC has a category and a priority; shown in the markdown and in the HTML "What stays manual" section
- [ ] Automation Candidate marked on every TC with the heuristics applied
- [ ] Smoke marked deliberately on every TC (small critical set, ≥1 per screen) — never defaulted to YES
- [ ] Learning file updated: user answers under Manual TC Model Q&A, new tagged knowledge added, Index row updated, duplicates removed, contradicted entries corrected, no credentials or code identifiers written
- [ ] Both deliverables written from `assets/tc-review.template.html`; HTML is self-contained, badge-coded (incl. inferred + not-implemented), light/dark aware, tiles match cards
- [ ] Final message includes the explicit approval instructions and the 5 → 6 order
