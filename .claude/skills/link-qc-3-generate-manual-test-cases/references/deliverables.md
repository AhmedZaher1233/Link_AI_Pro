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
| Nothing there | Write all deliverables normally (TC markdown, test-data file, rendered page, Arabic sidecar under `--lang ar`). |
| `Status: APPROVED` | **STOP — do not write.** Report: the document is human-approved and `link-qc-4-publish-test-cases-azure` may already have published it, so regenerating it changes the source revision `ADO-MAP.md` was built from. Offer three routes: `--revision` (patch only the TCs the reviewer names), Case 1 (ingest the approved set as the baseline and produce an updated set the reviewer re-approves), or an explicit "overwrite it" instruction from the user. Proceed only on that explicit instruction, and then say in the final message that skill 4 must be re-run with `--republish` **if an `ADO-MAP.md` exists** for this document. |
| `Status: PENDING HUMAN REVIEW` | Do not silently overwrite. Say what exists (TC count, date, whether 3b already validated it — the `MCP validation:` stamp) and offer the Case 1 route; on the user's go-ahead, regenerate. In `--revision` mode, patch it in place as usual. |
| Markdown present, HTML missing, unrecognizable or hand-edited | Keep the markdown authority and re-render (`html-page.md` §1). A hand-edited page is refused by the renderer until `--force` — tell the user what will be lost first. Never delete an existing page. |
| Markdown present, `TEST-DATA-{feature}.md` missing | Derive and write the test-data file from the markdown (§2b), and say so. |
| Markdown in the **legacy shape** (no `Scope` / `Generated` / `Stage` / frozen anchors — the renderer's `compatibility[]` lists them) | It still renders and is still patchable. Do **not** rewrite it into the new shape on its own; add the new lines and sections only when you are already regenerating or patching that document for another reason, and say so in the final message. |

The test-data file **follows the TC document**: it is (re)generated whenever the TC document is
written, patched row-by-row in `--revision`, and never written in `--audit`. It carries no
approval status of its own — the TC document's `Status:` governs both.

`--audit` never reaches this step as a writer: it reports the table above plus the planned TC
count, the coverage score, the Case 1 dispositions, the planned data-item counts and every file
that WOULD change, and writes nothing at all — not even the learning file.

## 2. `TEST-CASES-{feature}.md` — the source of truth

Write to `{tc_output_folder}` (one folder per User Story — create it if missing). The markdown
(and `TEST-DATA-{feature}.md`) is **always English** — skills 4, 5 and 3b and the renderer parse
it. Header block (every line present; an empty optional value is `—`, never blank):

```markdown
# Test Cases — {feature}
**Status:** PENDING HUMAN REVIEW
**Scope:** {one sentence — what this story's TCs cover; the page's subtitle}
**Generated:** {YYYY-MM-DD}
**Review page language:** {English | Arabic} — see TC-REVIEW-{feature}.html   ← a RECORD of what this run rendered, rewritten every run; it never decides a later run's language
**Entry case:** {fresh design | existing-TC update | story retrieved from Azure DevOps/Word}
**Implementation status:** {Implemented | Partially implemented | Not implemented | Cannot be validated} — {tester's answer {date} | skill-4 report {path} | not yet checked live}
**Requirement IDs covered:** {list}
**Total test cases:** {N} ({happy}/{edge}/{negative}, per locale)
**Run-stage mapping:** happy-path + edge-case → @positive · rejection/guard assertions → @negative
**Patterns applied / skipped:** {list with reasons}
**MCP validation:** 0 validated / 0 enhanced / 0 inferred / 0 discrepancy / {n} not-implemented / {N-n} draft — not app-validated (optional: link-qc-3b-validate-manual-test-cases)
**App validation progress:** 0/{N} TCs observed live (0%)
**Smoke TCs:** {N}
**Automation candidates:** {N of total}
**Requirement coverage (weighted):** {x}% — Full {n} / Partial {n} / None {n} of {ACs} acceptance criteria
**Manual-only scenarios:** {N} (High {h} · Medium {m} · Low {l})
**Tag convention:** {tags every TC of this project carries, from a learning-file [type: env] "tag convention" line | —}
```

Every header count must equal what the tables below say — the renderer recomputes them and
reports a `MISMATCH` otherwise (fix the header, re-render). `Tag convention` is informational
(skill 4 reads it; the renderer does not count it).

Then the **frozen level-2 anchors, in this order** (`html-page.md` §3): `## Summary` (table: ID,
Type, Locale, Requirement, Stage, Smoke, Automation Candidate, Data effect, Shared data, Tags,
Validation, Description) → `## Test Cases` (one `### {TC-ID} — {Description}` block per TC in
the frozen shape from `tc-design.md`) → `## Existing-TC Analysis` (Case 1 only) →
`## Enhancement Log` (table header only, plus one line "empty until link-qc-3b-validate-manual-test-cases
runs") → `## Traceability Matrix` → `## Negative Coverage` → `## Standards Alignment` →
`## Requirement Coverage Score` (per AC) → `## Manual-Only Scenarios` (category + priority) →
`## Potential Bugs` (heading + "none — written only by link-qc-3b-validate-manual-test-cases") →
`## Open Questions` (every `Q-{n}` in the `open-questions.md` shape, or "none") → `## Open
Findings for the Human Reviewer` with the five `###` buckets: Requirement / coverage gaps ·
Application defects (discrepancies) — "none — not app-validated" · Pending implementation ·
Environment blockers · Unclear requirements (one line per open `Q-{n}`).

## 2b. `TEST-DATA-{feature}.md` — the story's test data, in plain English

One file per story, in the same `{tc_output_folder}`, built from the data-item list collected
during design (`tc-design.md` "Test-data collection"). Statuses come from the **learning file
only** — this skill checks nothing live. The two files are **written together**: every row
traces to TC-IDs, and the TC document references this file for every environment URL, account
and shared dataset (`[E{n}]` / `[A{n}]` / `[D{n}]` — name + token, resolved per ID, never by role
and never "E1 = the URL"). Written in every mode that writes the TC document (fresh design,
Case 1, Case 2, each story of a multi-story run). Skill 5 reads it as the starting inventory of
its test-data readiness gate (environment entries keyed by E-ID, accounts by A-ID), 3b / 3c patch
it with live statuses and fill an `unknown` E-row `Value` they asked for, and skill 4 copies the
rows a TC references into that TC's published "Test data" block — so the four status words, the
five way names and the three ID prefixes are frozen.

**Audience: QC / QA and PO.** Short sentences. Simple words. No locator names, API endpoint
paths, database table or column names, code / class / function names, implementation details,
passwords or tokens. Entities, screens, roles, values and flows are named in plain words.

```markdown
# Test Data — {feature}
**Story:** US-{id} · **TC document:** TEST-CASES-{feature}.md ({YYYY-MM-DD}) · **Environment:** not checked
**Data items:** {N} — ready {n} · missing 0 · impossible {n} · unknown {n}
**Accounts needed:** {N} accounts — {n} confirmed · {n} unknown
**Environment rows:** {N} — {n} ready · {n} unknown

## 0. Environment
| ID | What | Value | Status |
|---|---|---|---|
| E1 | application base URL | {https://{host} from a learning-file [type: env] line, or "unknown — asked by 3b/3c"} | READY / UNKNOWN |
| E2 | {e.g. mail sandbox (reads OTP / notification mail)} | {…} | {…} |

## 1. Accounts
| ID | Role | Username | Status | Used by TCs | Note |
|---|---|---|---|---|---|
| A1 | {e.g. Administrator} | {username from the learning file, e.g. admin.user, or "unknown"; no password} | READY / UNKNOWN | TC-… | {e.g. "used for login in most TCs", "no account recorded for this role"} |

## 2. Test data at a glance
| # | Data item (plain name) | Must look like | Used by TCs | Status | Best way to get it |
|---|---|---|---|---|---|
| D1 | {e.g. an approved order with 12 line items} | {state, count, key values} | TC-… | READY | — |
| D2 | {…} | {…} | TC-… | UNKNOWN | e2e scenario (TC-…) — to check |
| D3 | {…} | {…} | TC-… | IMPOSSIBLE | see Problems #1 |

## 3. Data item details
### D1 — {plain name}
- **What it is:** {one sentence}
- **Exact values needed:** {field → value, counts, identifiers — the Data Oracle values}
- **Used by:** TC-…, TC-…
- **Where I checked:** {learning file line | not checked}
- **Status:** {READY | IMPOSSIBLE | UNKNOWN} — {one-line reason}
- **Shared with other TCs:** {no | yes — TC-… and TC-… use the same data item}
  {Only when one TC really depends on another's result, add: "TC-B needs the record TC-A creates, so TC-A runs first."}

## 4. Problems — data that cannot be created or is unclear
| # | Data item | Problem | Why | What the QC / PO must decide |
|---|---|---|---|---|
| 1 | D3 | {e.g. needs a nightly job to reach the "Expired" state} | {plain reason} | {e.g. accept a manual wait, or ask dev for a way to expire it} |

## 5. How to prepare the missing data
### D2 — {plain name}  (recommended: e2e scenario)
| Way | How, in plain words | Cleanup after | Availability |
|---|---|---|---|
| e2e scenario | Run TC-{id} (it creates this record), or the common flow "{name}": login as {role} [A{n}] → open {screen} → create {entity} with {values} → check it appears in {list} | delete it through {screen} | available |
| api | Create it through the project's API test-data seeding | delete it the same way | available — confirmed by {learning file | dev team} · OR · to be confirmed |
| db | Insert the record directly in the database (QC needs access) | delete the record | available — confirmed · OR · to be confirmed |
| set directly | {Admin settings → {section} → set {value}} | reset the value | available (settings only) |
| manual | QC creates it by hand following the e2e steps, then re-checks | QC decides | always available |

## 6. Open questions for the QC / PO
1. {Q-{n} — which item, what is unclear, what answer unblocks it}
```

Filling rules:

| Rule | Detail |
|---|---|
| **Items** | One per distinct data need across all TCs' `Preconditions`, `Data Oracle`, `Shared data` and roles, de-duplicated, each mapped to its TC-IDs. Every item has ≥1 TC; every data-asserting TC has ≥1 item. |
| **Environment rows** | `E1` is always the application base URL; one further row per service the TCs reach out of the browser (mail sandbox, SMS test provider, admin portal…) — only rows some TC references (`[E{n}]`). `Value` from a learning-file `[type: env]` line → `READY`; otherwise `unknown — asked by 3b/3c` → `UNKNOWN`. Never a credential in a value. |
| **Accounts** | One row per account (`A{n}`), never per role — a role with two accounts has two rows. Username from the learning file or `unknown`; `Used by TCs` lists every TC that references `[A{n}]`. Every row is referenced by ≥1 TC (self-review check 14). |
| **References** | Every `[E{n}]` / `[A{n}]` / `[D{n}]` token in the TC document resolves to a row here (check 12); no TC carries an environment value, a username or a shared item's identifier as a literal (the renderer warns `data-literal` / `data-ref-unresolved`). |
| **Status** | `READY` = confirmed to exist by a learning-file `[type: data]` / `[type: env]` line. `IMPOSSIBLE` = cannot be created with any available or allowed way. `UNKNOWN` = everything else (not checked — this skill never checks live; story not implemented; spec silent on the value). **`MISSING` is never written by this skill** — it means "checked and absent", which only 3b or skill 5 can establish. |
| **Best way / §5** | `e2e scenario` preferred when a UI flow exists · `api` only when API seeding is already available or explicitly confirmed · `db` only when DB seeding is confirmed AND the QC has access · `set directly` only for settings · `manual` otherwise. Unconfirmed `api` / `db` → written as `to be confirmed`, never recommended, never counted as an available way. |
| **Shared data** | "Shared" means the TCs use the same data item. State execution order only when one TC depends on another TC's result. |
| **Not implemented story** | Items still listed; status `UNKNOWN`; note "pending implementation". |
| **Environment** | Always `not checked` from this skill; 3b replaces it with `{env} checked {date}`. |
| **Counts** | Header counts equal the table rows (self-review check 14). |

## 3. Update `{learning_file}`

Per `learning-file.md` "Write": new design knowledge, data items the file did not know as
`UNKNOWN` are **not** written (only confirmed facts are); this run's **confirmed** user answers →
`### Manual TC Model (skill 3) → #### Questions and Answers` with `(confirmed by user {date})`;
project-wide facts → `## Project Knowledge`; `[similar: …]` links and the `## Index` row updated.
Deduplicate by grepping the tags first; update contradicted entries; keep it simple English with
no code identifiers, never a credential, never an unanswered recommendation.

## 4. `TC-REVIEW-{feature}.html` — rendered, never written by hand

Follow `references/html-page.md`. In short: write the markdown and the test-data file first, then
run the renderer in dry-run to read its payload; fix any `MISMATCH` in the header lines and any
`BLOCKED` error in the markdown; clear every `data-literal` / `data-ref-unresolved` /
`narrative-not-english` warning in the markdown (a `(intentional input)` mark where the literal
is deliberate); then `--write`.

**Language.** *"The output language of a run is English unless this run's task input asks for
another language (`--lang ar` or an explicit sentence). Nothing else decides it: not the source
language, not a saved learning-file answer, not the document's `Review page language:` line, not
an existing Arabic sidecar."* The page is therefore English unless this run passed `--lang ar`;
the `Review page language:` header line is rewritten to what this run rendered. An Arabic
sidecar already on disk stays untouched and is used only under `--lang ar` — the final message
mentions it once ("an Arabic sidecar exists — pass `--lang ar` to render it"). Narrative is
English; quoted application labels stay in the application's language (the renderer's
`narrative-not-english` check ignores quoted strings).

Arabic (`--lang ar`): `--lang ar --write-skeleton` → fill only the `null` / `stale` `ar` values in
`TC-REVIEW-STRINGS-{feature}.ar.json` (faithful translation, IDs / reference tokens / dates /
display labels unchanged) → `--lang ar --write`; `arabicComplete: false` → the page is a
**preview**, say so and list the outstanding keys. Never open the template to fill it, never edit
the rendered page, never present a `BLOCKED` render as delivered.

## 5. Final message to the user

Tell the reviewer, explicitly:

1. Open `TC-REVIEW-{feature}.html` for the fast visual review — say which language the page is
   in and how that was decided (this run's `--lang` / explicit sentence, else the English
   default — nothing else), whether it is complete or an Arabic **preview** (outstanding strings
   named), and, once, that an Arabic sidecar exists and `--lang ar` renders it (when one is on
   disk and this run rendered English); the markdown is the source of truth and is always
   English. `TEST-DATA-{feature}.md` lists, in plain English, the data every TC needs, whether it
   is known to exist, and how to create what is missing; every URL, account and shared dataset in
   the TCs is a reference to it (`[E1]`, `[A1]`, `[D2]`), so the TCs carry no literal URL or
   username. Name the TCs with `[HUMAN]` steps and the interface each lacks. Also name the
   resolved `{tc_output_folder}` and mention any stray same-story folder found at another level
   (never touched).
2. **Every TC is `draft — not app-validated`** (or `not-implemented — pending implementation`
   where the story is not built) — designed from the requirement, not yet seen in the
   application; App validation progress is `0/{N}`. The requirement coverage score is
   design-based and unaffected by that. **Optional next step, before or after approval:**
   `/link-qc-3b-validate-manual-test-cases {tc_output_folder}/TEST-CASES-{feature}.md` (needs Playwright
   MCP, the app URL and credentials) walks the TCs live, sets their states, records potential
   bugs and updates the test data in place. You may approve without it — skills 4 and 5 accept
   an unvalidated document and skill 5 re-verifies readiness itself.
3. Open questions: repeat every `Q-{n}` with the recommended answer and what stays pending until
   it is answered; nothing was assumed.
4. Test data: name the counts (`{n} impossible · {n} unknown`) and point at the Problems table.
   Ask the reviewer to fix or accept each gap before approval — skill 5 starts from this file
   and validates the `UNKNOWN` items before anything runs; a way marked "to be confirmed" needs
   a dev / project answer first.
5. To approve: edit `TEST-CASES-{feature}.md` — adjust any **Automation Candidate** markings
   (a `[HUMAN]` step does not force NO), optionally set **Data effect** / **Shared data** on TCs
   that change data or share records (this steers which TCs skill 5 runs in parallel vs one
   after another) and **Tags** on TCs that need one in Azure DevOps, then change `Status:` to
   `APPROVED`.
6. To request changes: type in the comment box of any TC, potential bug or question on the page
   (or the general box), click **Save comments** and save `REVIEW-COMMENTS-{feature}.md` beside
   the page (or **Copy for chat** and paste it), then say "read my comments" or re-run this skill
   with `--revision`. Corrections typed straight into the chat by TC-ID work too. A TC 3b had
   validated is then reset to draft and needs `3b --scope <ids>`.
7. Approval unlocks `link-qc-4-publish-test-cases-azure` (beautify + publish to Azure DevOps, writes
   `ADO-MAP.md`) **and** `link-qc-5-test-run-automation` independently — publishing is optional and is
   not skill 5's gate. Neither accepts a document that is not `Status: APPROVED`, and
   `not-implemented` TCs should not be automated until the story ships.
8. Multi-story run: point at `TC-GENERATION-SUMMARY.md` and note that each story is approved
   separately.

---

## `--revision` mode

Input is human feedback referencing TC-IDs, from any of: the **open entries** of
`REVIEW-COMMENTS-{feature}.md` beside the TC document (saved from the review page), the same text
pasted in chat, `- **Reviewer comment:**` lines in the TC document, or a corrected file. "read my
comments" (or "apply the reviewer comments") with no other instruction means a `--revision` run
over the open entries.

- **Read the comments first.** Load `REVIEW-COMMENTS-{feature}.md` when it exists (dry-run the
  renderer: `payload.comments` lists every entry, its id and status) and read each open entry and
  each `Reviewer comment` line. An entry on `General` or on a PB / Q is feedback like any other;
  an entry on an id no longer in the document (`unknownIds[]`) is reported, never guessed.
- Apply each correction exactly; touch ONLY the referenced TCs.
- **Close the loop in the comments file** (`html-page.md` §7b): for each entry you handled change
  only its `- **Status:**` to `applied {date}` (changed as asked), `answered {date}` (no change
  needed, or the answer is a fact) or `declined {date}` (conflicts with the requirement — say
  why), add `- **Response:** {one plain sentence}`, and recompute the `**Comments:**` header. An
  unclear entry becomes a `Q-{n}` and stays `open`. Never edit the reviewer's text or delete an
  entry. Remove a `Reviewer comment` line from a TC only when the reviewer asks; otherwise leave it
  (it never affects skills 4 / 5). Re-render after the file is updated, so the page shows the
  answers as history.
- **Validation states.** A TC whose Preconditions, Steps or Expected Result you change is reset
  to `Validation: draft — not app-validated (stale — revised)` whatever state 3b had given it;
  its enhancement-log rows stay and get `superseded` appended to the `Run` column (history is
  kept, never deleted); its `<!-- tc-evidence -->` stamp is removed. TCs you did not touch keep
  their state and stamp. Recompute `MCP validation` and `App validation progress`, and name the
  reset TC-IDs in the final message as the set for `link-qc-3b-validate-manual-test-cases --scope <ids>`
  (`link-qc-3c-validate-manual-test-cases-cli` takes no scope — it re-walks every TC, the reset ones included).
- **Patch, do not regenerate.** In the markdown, edit only the affected TC sections and
  summary-table rows, and recompute the header counts (totals, validation breakdown, automation
  candidates, requirement coverage score, manual-only count). In `TEST-DATA-{feature}.md`, patch
  only the items whose TC-IDs, values or ways changed (add / remove the TC-ID, update the row,
  drop an item no TC uses any more) and recompute its header counts. Then **re-render the page**
  (`html-page.md`) — never patch the HTML by hand; under `--lang ar`, `--write-skeleton` first so
  unchanged translations survive and only the changed strings need a new `ar`. The page is
  English unless this run passes `--lang ar` (§4 language rule — the markdown's
  `Review page language:` line never decides it); rewrite that line to what this run rendered.
  A revision that adds an environment URL, an account or a shared dataset adds the row to
  `TEST-DATA` and references it — never a literal.
- Keep status `PENDING HUMAN REVIEW`. If the document was `APPROVED`, patching it means the
  source revision changed — say in the final message that skill 4 needs `--republish` when an
  `ADO-MAP.md` exists.
- Include a **Corrections Applied** table: | Feedback item | TC-ID(s) | Fix applied |
- Add any newly confirmed knowledge to `{learning_file}`.
- Ambiguous feedback → an open question in the `open-questions.md` shape; do not guess intent.
- Do NOT change unreferenced test cases.

---

## Structured returns

```markdown
## TEST CASES READY FOR HUMAN REVIEW

**Feature:** {name}
**Entry case:** {fresh design | existing-TC update | retrieved from Azure DevOps/Word}
**Implementation status:** {Implemented | Partially implemented | Not implemented | Cannot be validated} — {tester's answer | skill-4 report | not yet checked live}
**Deliverables:** {tc_output_folder}/TEST-CASES-{feature}.md · {tc_output_folder}/TEST-DATA-{feature}.md · {tc_output_folder}/TC-REVIEW-{feature}.html {· TC-REVIEW-STRINGS-{feature}.ar.json}
**Review page language:** {English | Arabic} — {flag | default} {· PREVIEW — {n} strings outstanding} {· Arabic sidecar on disk — pass --lang ar to render it}
**Render:** gate {PASS | MISMATCH fixed → PASS} · compatibility {none | list} · warnings cleared {data-literal 0 · data-ref-unresolved 0 · narrative-not-english 0}
**References:** {n} environment rows · {n} accounts · {n} data items — every token resolved
**Human steps:** {n} TCs with a [HUMAN] step ({TC-IDs} — interface lacking: {mail sandbox | SMS test provider | …}) | none
{Case 2: **Requirement file generated:** {requirements_folder}/REQ-{storyID}-{feature}.md}
{Multi-story: **Stories processed:** {N} — spec folder: {manual test-cases root}/SPEC-{spec_name}/ (spec-file input) — summary: {manual test-cases root}/[SPEC-{spec_name}/]TC-GENERATION-SUMMARY.md}
**Status:** PENDING HUMAN REVIEW
**Totals:** {N} TCs ({breakdown}) · {N} automation candidates
**Requirement coverage:** {x}% weighted — Full {n} / Partial {n} / None {n} of {ACs} ACs (design-based)
**App validation progress:** 0/{N} — not app-validated (optional: link-qc-3b-validate-manual-test-cases)
**Manual-only scenarios:** {N} (High {h} · Medium {m} · Low {l})
**Test data:** {N} items — ready {n} · impossible {n} · unknown {n} · {n} problems for the QC / PO
**Open questions:** {N} — {Q-ids with the recommended answer, or "none"}
{Case 1: **Existing-TC analysis:** {kept}/{updated}/{merged}/{removed}/{new}}
**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}
**Open findings for the reviewer:** {gaps / pending-implementation / unclear, or "None"}
**Next step:** {the approval instructions from §5, incl. the optional 3b line}
```

```markdown
## TEST CASES REVISED

**Revision cycle:** {N}
**Corrections Applied:** {table}
**Not addressed:** {item + reason, or "None"}
**Validation states reset:** {TC-IDs now draft (stale — revised), or "none"} → re-validate with 3b --scope
**Files patched:** markdown {TC-IDs + header counts recomputed} · test-data file {items patched + counts recomputed | "untouched"} · page re-rendered {gate}
**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}
```

```markdown
## TEST CASE AUDIT (no files written)

**Feature / stories:** {list}
**Entry case:** {resolved case} · **Implementation status:** {status — source}
**Existing deliverables:** {path — Status / TC count / date / 3b stamp, or "none"}
**Would write:** {files} · **Would overwrite:** {files, or "nothing"}
**Planned coverage:** {N} TCs ({breakdown}) · {x}% weighted over {ACs} ACs
**Planned test data:** {N} items — {n} already known READY from the learning file · {n} unknown
{Case 1: **Planned dispositions:** {kept}/{updated}/{merged}/{removed}/{new}}
**Blockers to a real run:** {list, or "none"}
**Learning file:** not touched (audit)
```

---

## Quality checklist — before returning TEST CASES READY FOR HUMAN REVIEW

- [ ] Intake gate passed — all missing inputs asked in ONE message in the open-question shape and answered before the flow started; nothing assumed; no unanswered recommendation acted on
- [ ] Entry case resolved first (existing TCs / no spec / default) — asked, not assumed; multi-story input split per story
- [ ] Manifest read first; deliverables written to the per-story folder `{tc_output_folder}` (no fallback locations)
- [ ] `{tc_output_folder}` contains `SPEC-{spec_name}/` whenever the REQ path does; resolved once, stated in chat, unchanged for the whole run; a same-story folder at another level reported as stray, never written to
- [ ] Review page language is English unless this run's task input asked for Arabic (`--lang ar` / explicit sentence) — never from the source language, a saved answer, the existing header line or a sidecar on disk; markdown and test-data file are English (quoted application labels excepted); IDs, paths and `Status` keywords are Latin; an Arabic page has `lang="ar"` + `dir="rtl"`; the header line `Review page language:` records what this run rendered
- [ ] No environment URL / host, username or shared-dataset identifier as a literal in any TC — references only (`[E{n}]` / `[A{n}]` / `[D{n}]`, name + token), every token resolving to its own `TEST-DATA` row; intentional inputs and expected outputs inline, a deliberate collision marked `(intentional input)`; renderer warnings `data-literal` / `data-ref-unresolved` / `narrative-not-english` cleared
- [ ] Every requirement-defined out-of-browser outcome has a complete TC; interfaces resolved task input → learning file / other TEST-DATA files → one question (answer written as `[type: env]`); `[HUMAN]` only where no authorized interface exists, never as a reason to drop a TC or to mark `Automation Candidate: NO`
- [ ] `Tags:` present on every TC (`—` when none); `**Tag convention:**` header line present
- [ ] Pre-write guard run: no approved document overwritten without an explicit instruction; skill 4 `--republish` note given when it was and an `ADO-MAP.md` exists; a legacy-shape document not rewritten wholesale on its own
- [ ] Writes confined to `{tc_output_folder}`, `{requirements_folder}` and `{learning_file}` — no spec, steering, source, ADO-MAP or automation file touched
- [ ] Case 1: existing TCs read from their stated source; every original TC accounted for once in the Existing-TC Analysis table; set NOT regenerated from scratch
- [ ] Case 2: User Story retrieved via Azure DevOps MCP (or docx MCP / exported text); structured requirement file written to `{requirements_folder}` and used as the spec source
- [ ] No browser opened, no URL or credential asked — implementation status taken from the tester / a skill-4 report, else `Cannot be validated — not yet checked live`, with its source in the header
- [ ] Every TC carries `Validation: draft — not app-validated` (or `not-implemented — pending implementation` per the static status); no other state written by this skill; on `--revision` untouched TCs keep their 3b state and changed ones are reset with `(stale — revised)`
- [ ] Gaps / pending-implementation / unclear items kept in separate buckets; no application defect recorded here
- [ ] Project profile fully resolved — no invented paths
- [ ] Learning file searched first (Index + tag grep, not the whole file); known and `[similar:]` knowledge reused (similar-module knowledge only as a confirmed recommendation), not re-asked
- [ ] All spec/steering sources read; all REQ-IDs verified verbatim
- [ ] Every open question written under `## Open Questions` in the required shape with a `Q-{n}` id, a recommendation and its pending set; repeated in the final message
- [ ] Coverage minimums met; all L1 §4 negative categories represented or justified N/A
- [ ] Every TC has one entry per required locale, confirming language + direction first; a secondary-locale label not recorded in the learning file is written as the English label + "(Arabic label: to be captured live)", never guessed
- [ ] Data Oracle cited for every data-asserting TC
- [ ] Every step has the 4 handoff fields; TCs read as complete user journeys; no selectors, code or passwords in deliverables
- [ ] Run-stage mapping stated in the header AND per TC in the `Stage` column
- [ ] Self-review tables completed and included; own findings fixed in place
- [ ] Requirement coverage score computed per AC (Fully / Partially / Not Covered, weighted %) from the requirement and the designed TCs only — validation states never affect it; in the markdown header + tables and as the gauge in the page; no AC left at 0.0 without a fix or an Open Finding
- [ ] Manual-only scenarios table present: every `Automation Candidate = NO` TC has a category and a priority
- [ ] Automation Candidate marked on every TC with the heuristics applied
- [ ] Smoke marked deliberately on every TC (small critical set, ≥1 per screen) — never defaulted to YES
- [ ] Header block complete (`Scope`, `Generated`, `App validation progress: 0/N`, …) and every header count equal to the tables; frozen anchors present in order; `## Potential Bugs` and `## Enhancement Log` present and empty
- [ ] Learning file updated: confirmed answers under Manual TC Model Q&A with `(confirmed by user {date})`, new tagged knowledge added, Index row updated, duplicates removed, contradicted entries corrected, no credentials, code identifiers or unanswered recommendations written
- [ ] `TEST-DATA-{feature}.md` written next to the TC document (§2b): `## 0. Environment` (E1 = base URL, one row per referenced service), `## 1. Accounts` with the `ID` column (one row per account), every Preconditions / Data Oracle / Shared data sentence and every role maps to a row with TC-IDs and every E / A row is referenced by ≥ 1 TC; plain English only
- [ ] Test-data statuses from the learning file only: `READY` confirmed there, `IMPOSSIBLE` only after the ways were considered, everything else `UNKNOWN` (never `MISSING` from this skill); `Environment: not checked`; header counts equal the table rows
- [ ] Every `IMPOSSIBLE` / `UNKNOWN` item has a way in §5 or a row in the Problems table; `api` / `db` shown as available only when confirmed by the learning file or the user, otherwise "to be confirmed" and never recommended
- [ ] Page produced by `scripts/render-tc-review.mjs` with `gate: PASS` (or `MISMATCH` fixed and re-rendered); never hand-written or hand-edited; Arabic complete, or explicitly delivered as a preview with the outstanding keys named
- [ ] `node scripts/selftest.mjs` passes in this skill folder (run after any renderer / template change; mirror case 0 passes or reports `skipped`)
- [ ] Final message includes the explicit approval instructions, the optional 3b next step, the open questions, the test-data gap counts, and "5 and 6 independently"
