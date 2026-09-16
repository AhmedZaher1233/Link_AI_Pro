# Deliverables, revision mode and the human gate — load at the delivery phase (workflow step 10)

## 1. Pre-write guard — check the target BEFORE writing anything

**Folder check first (hard stop):** `{tc_output_folder}` is the value resolved and stated at
intake — immutable for the run (SKILL.md invariant 9b). If the story's `REQ-*.md` path contains
`/SPEC-{x}/` and `{tc_output_folder}` does not contain `/SPEC-{x}/` → **STOP, do not write**: fix
the folder (re-derive `spec_level`, re-state the path) and only then continue. Never "fix" it by
writing to a flat `US-*` folder, and never reuse a same-story folder at another level (see
`entry-cases.md` §3 directory-structure rule).

For every story, read `{tc_output_folder}/TEST-CASES-{feature}.md` (and the folder) before the
first write:

| Target state | What you do |
|---|---|
| Nothing there | Write all three deliverables normally (TC markdown, test-data file, HTML page). |
| `Status: APPROVED` | **STOP — do not write.** Report: the document is human-approved and `5-publish-test-cases-azure` may already have published it, so regenerating it changes the source revision `ADO-MAP.md` was built from. Offer three routes: `--revision` (patch only the TCs the reviewer names), Case 1 (ingest the approved set as the baseline and produce an updated set the reviewer re-approves), or an explicit "overwrite it" instruction from the user. Proceed only on that explicit instruction, and then say in the final message that skill 5 must be re-run with `--republish`. |
| `Status: PENDING HUMAN REVIEW` | Do not silently overwrite. Say what exists (TC count, date) and offer the Case 1 route; on the user's go-ahead, regenerate. In `--revision` mode, patch it in place as usual. |
| Markdown present, HTML missing or unrecognizable | Keep the markdown authority, regenerate the HTML, and say so. Never delete an existing HTML page — overwrite it from the markdown. |
| Markdown present, `TEST-DATA-{feature}.md` missing | Derive and write the test-data file from the markdown (§2b), and say so. |

The test-data file **follows the TC document**: it is (re)generated whenever the TC document is
written, patched row-by-row in `--revision`, and never written in `--audit`. It carries no
approval status of its own — the TC document's `Status:` governs both.

`--audit` never reaches this step as a writer: it reports the table above plus the planned TC
count, the coverage score, the Case 1 dispositions, the planned data-item counts and every file
that WOULD change, and writes nothing at all — not even the learning file.

## 2. `TEST-CASES-{feature}.md` — the source of truth

Write to `{tc_output_folder}` (one folder per User Story — create it if missing). Header block:

The markdown (and `TEST-DATA-{feature}.md`) is **always English** — skills 5 and 6 parse it. The
`Review page language:` line below is new and informational only (not parsed downstream); adding
it is safe, renaming any frozen field is not.

```markdown
# Test Cases — {feature}
**Status:** PENDING HUMAN REVIEW
**Review page language:** {English | Arabic} — see TC-REVIEW-{feature}.html
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

## 2b. `TEST-DATA-{feature}.md` — the story's test data, in plain English

One file per story, in the same `{tc_output_folder}`, built from the data-item list collected
during design (`tc-design.md` "Test-data collection") and the statuses set by the MCP pass. It
is **derived from the TC document** — every item traces to TC-IDs, and the TC document never
depends on it. Written in every mode that writes the TC document (fresh design, Case 1, Case 2,
each story of a multi-story run). Skill 6 reads it as the starting inventory of its
test-data readiness gate, so the four status words and the five way names are frozen.

**Audience: QC / QA and PO.** Short sentences. Simple words. No locator names, API endpoint
paths, database table or column names, code / class / function names, implementation details,
passwords or tokens. Entities, screens, roles, values and flows are named in plain words.

```markdown
# Test Data — {feature}
**Story:** US-{id} · **TC document:** TEST-CASES-{feature}.md ({YYYY-MM-DD}) · **Environment:** {env checked | "not checked"}
**Data items:** {N} — ready {n} · missing {n} · impossible {n} · unknown {n}
**Accounts needed:** {N} roles — {n} confirmed · {n} unknown

## 1. Accounts
| Role | Username | Status | Used by TCs | Note |
|---|---|---|---|---|
| {role} | {exact username, no password} | READY / MISSING / IMPOSSIBLE / UNKNOWN | TC-… | {e.g. "used for login in every TC", "no user with this role in any environment"} |

## 2. Test data at a glance
| # | Data item (plain name) | Must look like | Used by TCs | Status | Best way to get it |
|---|---|---|---|---|---|
| D1 | {e.g. an approved KPI with 12 monthly values} | {state, count, key values} | TC-… | READY | — |
| D2 | {…} | {…} | TC-… | MISSING | e2e scenario (TC-…) |
| D3 | {…} | {…} | TC-… | IMPOSSIBLE | see Problems #1 |
| D4 | {…} | {…} | TC-… | UNKNOWN | to check — see §5 |

## 3. Data item details
### D1 — {plain name}
- **What it is:** {one sentence}
- **Exact values needed:** {field → value, counts, identifiers — the Data Oracle values}
- **Used by:** TC-…, TC-…
- **Where I checked:** {learning file line | listing screen "{screen name}" seen live | not checked}
- **Status:** {READY | MISSING | IMPOSSIBLE | UNKNOWN} — {one-line reason}
- **Shared with other TCs:** {no | yes — TC-… and TC-… use the same data item}
  {Only when one TC really depends on another's result, add: "TC-B needs the record TC-A creates, so TC-A runs first."}

## 4. Problems — data that cannot be created or is unclear
| # | Data item | Problem | Why | What the QC / PO must decide |
|---|---|---|---|---|
| 1 | D3 | {e.g. needs a nightly job to reach the "Expired" state} | {plain reason} | {e.g. accept a manual wait, or ask dev for a way to expire it} |
{Typical problems: only a background job produces the state · external system owns the data ·
 no user with the role exists anywhere · the spec does not say the value · the app has no screen
 to reach the state · two TCs need the same record in different states.}

## 5. How to prepare the missing data
### D2 — {plain name}  (recommended: e2e scenario)
| Way | How, in plain words | Cleanup after | Availability |
|---|---|---|---|
| e2e scenario | Run TC-{id} (it creates this record), or the common flow "{name}": login as {username} → open {screen} → create {entity} with {values} → check it appears in {list} | delete it through {screen} | available |
| api | Create it through the project's API test-data seeding | delete it the same way | available — confirmed by {learning file | dev team} · OR · to be confirmed |
| db | Insert the record directly in the database (QC needs access) | delete the record | available — confirmed · OR · to be confirmed |
| set directly | {Admin settings → {section} → set {value}} | reset the value | available (settings only) |
| manual | QC creates it by hand following the e2e steps, then re-checks | QC decides | always available |
{One block per MISSING item, and per UNKNOWN item when a way is already known. IMPOSSIBLE items
 appear only in §4. Keep only the rows that apply; a "to be confirmed" way is never the
 recommended one.}

## 6. Open questions for the QC / PO
1. {question — which item, what is unclear, what answer unblocks it}
```

Filling rules:

| Rule | Detail |
|---|---|
| **Items** | One per distinct data need across all TCs' `Preconditions`, `Data Oracle`, `Shared data` and roles, de-duplicated, each mapped to its TC-IDs. Every item has ≥1 TC; every data-asserting TC has ≥1 item. |
| **Status** | `READY` = confirmed to exist (learning-file `[type: data]` / `[type: env]` line, or seen live on a listing screen). `MISSING` = required, checked, not found. `IMPOSSIBLE` = cannot be created with any available or allowed way. `UNKNOWN` = not enough information (not checked, screen unreachable, no Playwright MCP, story not implemented, spec silent on the value). **Never `MISSING` because it was not checked.** |
| **Best way / §5** | `e2e scenario` preferred when a UI flow exists · `api` only when API seeding is already available or explicitly confirmed · `db` only when DB seeding is confirmed AND the QC has access · `set directly` only for settings · `manual` otherwise. Unconfirmed `api` / `db` → written as `to be confirmed`, never recommended, never counted as an available way. |
| **Shared data** | "Shared" means the TCs use the same data item. State execution order only when one TC depends on another TC's result. |
| **Not implemented story** | Items still listed; status `UNKNOWN`; note "pending implementation". |
| **No Playwright MCP** | Statuses come from the learning file only; everything else `UNKNOWN`; the header says "Environment: not checked". |
| **Counts** | Header counts equal the table rows (self-review check 14). |
| **Learning file** | Items confirmed `READY` during the MCP pass that the learning file did not know → one `[type: data]` line under `## Test Data` (§3). Statuses `MISSING` / `IMPOSSIBLE` / `UNKNOWN` are NOT written to the learning file — skill 6 records the final outcome. |

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

- **Language** (`review_page_language`, resolved at intake): fill `{{lang}}` / `{{dir}}` on the
  `<html>` tag — `en` / `ltr` for English, `ar` / `rtl` for Arabic. When Arabic: every heading,
  label, badge text, caption, column header, tile label, step text, expected result and finding
  is rendered in Arabic as a **faithful translation** of the English markdown — same meaning,
  same order, nothing added or dropped (translation is the one allowed transformation of the
  "never rewords" rule). TC-IDs, REQ-IDs, AC numbers, usernames, URLs, dates, file names and the
  `Status` keyword stay Latin, each wrapped in the template's `<span class="ltr">…</span>`.
  Application display labels quoted in steps keep the exact text captured live (already
  per-locale). Whole-page direction comes from `{{dir}}`; use `dir="ltr"` / `dir="rtl"` islands
  only for mixed-direction snippets inside a cell. The header shows the page language.
- **Header**: feature name, status banner (PENDING HUMAN REVIEW), date, REQ-IDs, entry case, and
  the implementation status (prominent when not fully implemented).
- **Summary tiles**: total TCs, by type, by locale, automation candidates, validation breakdown
  (validated / enhanced / inferred / discrepancy / not-implemented / draft), and a **test-data
  tile** (`{N} items · ready / missing / impossible / unknown`) whose numbers equal the
  `TEST-DATA-{feature}.md` header. Tile numbers must always match the cards and tables below.
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
- **Test data** section: the "at a glance" table from `TEST-DATA-{feature}.md` §2 (item ·
  must look like · TCs · status badge · best way) followed by its Problems table (§4). Status
  badges: `READY` green, `MISSING` amber, `IMPOSSIBLE` red, `UNKNOWN` grey. Rows copied from the
  test-data file — never reworded. The section points the reviewer at the file for §3/§5 detail.
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
- Wide tables scroll inside their own container; the page never scrolls horizontally — in both
  directions. An Arabic page mirrors correctly because the template uses logical CSS properties;
  never add physical `left` / `right` values per run.
- No password, token, selector or code identifier appears anywhere on the page.

## 5. Final message to the user

Tell the reviewer, explicitly:

1. Open `TC-REVIEW-{feature}.html` for the fast visual review — say which language the page is
   in and how that was decided (task input / reused from the learning file / asked / default);
   the markdown is the source of truth and is always English. `TEST-DATA-{feature}.md` lists,
   in plain English, the data every TC needs, whether it exists, and how to create what is
   missing. Also name the resolved `{tc_output_folder}` and mention any stray same-story folder
   found at another level (never touched).
2. `inferred` TCs were confirmed from prior knowledge, not directly observed — review those with
   extra care. `not-implemented` TCs are requirement-based and pending implementation — they are
   not evidence of application defects. `draft — not app-validated` TCs were never seen live —
   say why (app unreachable, or no Playwright MCP server attached).
3. Test data: name the counts (`{n} missing · {n} impossible · {n} unknown`) and point at the
   Problems table. Ask the reviewer to fix or accept each gap before approval — skill 6 starts
   from this file and validates the `MISSING` / `UNKNOWN` items before anything runs; a way
   marked "to be confirmed" needs a dev / project answer first.
4. To approve: edit `TEST-CASES-{feature}.md` — adjust any **Automation Candidate** markings,
   optionally set **Data effect** / **Shared data** on TCs that change data or share records
   (this steers which TCs skill 6 runs in parallel vs one after another), then change `Status:`
   to `APPROVED`.
5. To request changes: reply with corrections (reference TC-IDs) → re-run this skill with
   `--revision`.
6. Approval unlocks `5-publish-test-cases-azure` (beautify + publish to Azure DevOps, writes
   `ADO-MAP.md`) and only then `6-test-run-automation`. Neither accepts a document that is not
   `Status: APPROVED`, and `not-implemented` TCs should not be automated until the story ships.
7. Multi-story run: point at `TC-GENERATION-SUMMARY.md` and note that each story is approved
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
  coverage gauge and the "What stays manual" table so the page stays internally consistent. In
  `TEST-DATA-{feature}.md`, patch only the items whose TC-IDs, values or ways changed (add /
  remove the TC-ID, update the row, drop an item no TC uses any more) and recompute its header
  counts and the HTML test-data section. Do NOT rewrite any file wholesale. If the existing HTML
  is missing or structurally unrecognizable, regenerate it fully and say so. The HTML keeps the
  language recorded in the markdown's `Review page language:` line (or `--lang` when the user
  changes it — then update that line too).
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
**Deliverables:** {tc_output_folder}/TEST-CASES-{feature}.md · {tc_output_folder}/TEST-DATA-{feature}.md · {tc_output_folder}/TC-REVIEW-{feature}.html
**Review page language:** {English | Arabic} — {task input | reused from learning file | asked | default}
{Case 2: **Requirement file generated:** {requirements_folder}/REQ-{storyID}-{feature}.md}
{Multi-story: **Stories processed:** {N} — spec folder: {manual test-cases root}/SPEC-{spec_name}/ (spec-file input) — summary: {manual test-cases root}/[SPEC-{spec_name}/]TC-GENERATION-SUMMARY.md}
**Status:** PENDING HUMAN REVIEW
**Totals:** {N} TCs ({breakdown}) · {N} automation candidates
**Requirement coverage:** {x}% weighted — Full {n} / Partial {n} / None {n} of {ACs} ACs
**Manual-only scenarios:** {N} (High {h} · Medium {m} · Low {l})
**Test data:** {N} items — ready {n} · missing {n} · impossible {n} · unknown {n} · {n} problems for the QC / PO
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
**Files patched:** markdown {TC-IDs + header counts recomputed} · test-data file {items patched + counts recomputed | "untouched"} · HTML {cards updated + tiles recomputed}
**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}
```

```markdown
## TEST CASE AUDIT (no files written)

**Feature / stories:** {list}
**Entry case:** {resolved case} · **Implementation status:** {status — evidence}
**Existing deliverables:** {path — Status / TC count / date, or "none"}
**Would write:** {files} · **Would overwrite:** {files, or "nothing"}
**Planned coverage:** {N} TCs ({breakdown}) · {x}% weighted over {ACs} ACs
**Planned test data:** {N} items — {n} already known READY from the learning file · {n} to check
{Case 1: **Planned dispositions:** {kept}/{updated}/{merged}/{removed}/{new}}
**Blockers to a real run:** {list, or "none"}
**Learning file:** not touched (audit)
```

---

## Quality checklist — before returning TEST CASES READY FOR HUMAN REVIEW

- [ ] Intake gate passed — all missing inputs asked in ONE message and answered before the flow started; nothing assumed
- [ ] Entry case resolved first (existing TCs / no spec / default) — asked, not assumed; multi-story input split per story
- [ ] Manifest read first; deliverables written to the per-story folder `{tc_output_folder}` (no fallback locations)
- [ ] `{tc_output_folder}` contains `SPEC-{spec_name}/` whenever the REQ path does; resolved once, stated in chat, unchanged for the whole run; a same-story folder at another level reported as stray, never written to
- [ ] Review page language equals the resolved `review_page_language`; markdown and test-data file are English; IDs, paths and `Status` keywords are Latin; an Arabic page has `lang="ar"` + `dir="rtl"` and the header line `Review page language: Arabic`
- [ ] Pre-write guard run: no approved document overwritten without an explicit instruction; skill 5 `--republish` note given when it was
- [ ] Writes confined to `{tc_output_folder}`, `{requirements_folder}` and `{learning_file}` — no spec, steering, source, ADO-MAP or automation file touched
- [ ] Case 1: existing TCs read from their stated source; every original TC accounted for once in the Existing-TC Analysis table; set NOT regenerated from scratch
- [ ] Case 2: User Story retrieved via Azure DevOps MCP (or docx MCP / exported text); structured requirement file written to `{requirements_folder}` and used as the spec source
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
- [ ] `TEST-DATA-{feature}.md` written next to the TC document (§2b): every Preconditions / Data Oracle / Shared data sentence and every role maps to a data item with TC-IDs; plain English only — no locator, endpoint path, table / column name, code identifier or secret
- [ ] Test-data statuses set from evidence only: `READY` confirmed, `MISSING` checked-and-absent, `IMPOSSIBLE` only after the ways were considered, everything unchecked `UNKNOWN` (never `MISSING`); header counts equal the table rows and the HTML tile
- [ ] Every `MISSING` / `IMPOSSIBLE` item has an available way in §5 or a row in the Problems table; `api` / `db` shown as available only when confirmed by the learning file or the user, otherwise "to be confirmed" and never recommended
- [ ] HTML written from `assets/tc-review.template.html`; self-contained, badge-coded (incl. inferred + not-implemented, test-data statuses), light/dark aware, tiles match cards and tables
- [ ] Final message includes the explicit approval instructions, the test-data gap counts, and the 5 → 6 order
