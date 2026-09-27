<!-- MIRROR — byte-identical copies live in the sibling skill folders
     (link-qc-3-generate-manual-test-cases ↔ link-qc-3b-validate-manual-test-cases ↔ link-qc-3c-validate-manual-test-cases-cli,
     each under references/). Edit all three; scripts/selftest.mjs case 0 sha256-compares every mirrored file. -->
# The review page — `TC-REVIEW-{feature}.html` is RENDERED, never hand-written

Load at the delivery step of skill 3 and at the write-back step of skill 3b or 3c.

**Never hand-write this page. Run the script.** `scripts/render-tc-review.mjs` turns
`TEST-CASES-{feature}.md` (+ `TEST-DATA-{feature}.md`, + the Arabic strings sidecar, + the reviewer's
`REVIEW-COMMENTS-{feature}.md`) into the page from `assets/tc-review.template.html` (the body partial)
inside `assets/report-shell.template.html`, the one general report page shared byte-for-byte with
skill 5's run report. It recomputes every number from the tables, refuses to
invent one, marks what it cannot supply with `—`, and stamps the page with a provenance comment
(source / data / strings / comments sha256 + a self-hash) so a hand-edited page is detected. Same inputs →
same bytes, so a render is always safe to repeat.

## 1. Commands

```bash
# dry run — parse, compute, validate; prints the JSON payload, writes nothing
node .claude/skills/{this skill}/scripts/render-tc-review.mjs --tc {tc_output_folder}/TEST-CASES-{feature}.md --pretty
# English page
node … --tc {path} --write [--out {tc_output_folder}/TC-REVIEW-{feature}.html]
# Arabic page — step 1: derive / merge the strings skeleton
node … --tc {path} --lang ar --write-skeleton
# step 2 (Claude): fill only the `ar` values that are null or stale in TC-REVIEW-STRINGS-{feature}.ar.json
# step 3: render
node … --tc {path} --lang ar --write
# after a deliberate re-render over a page a human edited (the payload said `refused.reason: hand-edited`)
node … --tc {path} --write --force
```

`--data`, `--strings` and `--comments` override the defaults (`TEST-DATA-{feature}.md`,
`TC-REVIEW-STRINGS-{feature}.ar.json` and `REVIEW-COMMENTS-{feature}.md` next to the TC document). `--emit-keys` lists the derived
translation keys. `--strict` maps the gate to an exit code for CI (PASS 0 · MISMATCH 1 ·
BLOCKED 2 · NOT_RUN 3); without it the script always exits 0 and the result is the payload.

Read the payload, never the HTML: `gate`, `gateReason`, `counts`, `mismatches[]`,
`compatibility[]`, `warnings[]`, `errors[]`, `strings.missing[]`, `arabicComplete`, `comments`, `writes[]`.

## 2. Gate — what each verdict means for the skill

| Gate | Cause | What you do |
|---|---|---|
| `PASS` | header consistent, vocabulary valid, (Arabic) every key translated | deliver the page |
| `MISMATCH` | a header line disagrees with the tables (`mismatches[]`), and/or Arabic keys are missing or stale | the page IS written (with a warning strip / preview banner). **Fix the header lines in the markdown** (skill 3) or the counts you patched (3b), re-render. An Arabic page with `arabicComplete: false` is a **preview** — say so; never call it the Arabic deliverable |
| `BLOCKED` | something would make the page wrong: out-of-vocabulary `Type` / `Validation` / test-data status, a table row with the wrong cell count, a TC without `Type` / `Steps` / `Expected Result`, a password-shaped literal in a step or in a reviewer comment, a placeholder the model cannot fill, a hand-edited page without `--force` | nothing is written. Fix the markdown (`errors[]` names the line) and re-render. Never bypass by writing HTML yourself |
| `NOT_RUN` | no `--tc`, or the file does not exist | fix the path |

`readOnly: true` in the payload means nothing was written (dry run, or a refused write).

**Warnings the skill must clear before delivery** (they never change the gate, so a legacy
document still renders): `data-literal` (a TEST-DATA environment host / value or account username
repeated in a TC text — reference it as `[E{n}]` / `[A{n}]` or end the line with `(intentional
input)`), `data-ref-unresolved` (a `[A/E/D{n}]` token with no TEST-DATA row), and
`narrative-not-english` (a TC or the Scope line whose narrative is Arabic script on an English
page — quoted application labels never count). `review-lang-header-stale` means the `Review page
language:` line records a different language than this run rendered: rewrite the line, it is a
record, never an input.

## 3. Parsing contract — what the renderer reads from `TEST-CASES-{feature}.md`

The markdown is parsed by **heading and field name**, never by position. Frozen anchors (level-2
headings, this order): `## Summary` · `## Test Cases` · `## Existing-TC Analysis` (Case 1) ·
`## Enhancement Log` · `## Traceability Matrix` · `## Negative Coverage` · `## Standards
Alignment` · `## Requirement Coverage Score` · `## Manual-Only Scenarios` · `## Potential Bugs` ·
`## Open Questions` · `## Open Findings for the Human Reviewer` (with `###` buckets: requirement
gaps · application defects · pending implementation · environment blockers · unclear
requirements).

| Element | Shape the renderer expects |
|---|---|
| Title | `# Test Cases — {feature}` |
| Header lines | `**Key:** value`, one per line, before the first `##`. Compared with the tables: `Total test cases`, `Smoke TCs`, `Automation candidates`, `MCP validation` (six numbers in the frozen order), `Manual-only scenarios`, `Requirement coverage (weighted)`, `App validation progress`. Also read: `Status`, `Scope`, `Generated`, `Entry case`, `Implementation status`, `Requirement IDs covered`, `Review page language`, and the validator stamp inside `MCP validation` (`— by 3b on {date}, env {name}, scope {mode}[, re-run {n}]`; skill 3c writes `— by 3c on … , tool cli`). The payload reports it as `document.stamp` (`by`, `date`, `env`, `scope`, `rerun`, `tool`) and the page says "validated by 3b on" or "validated by 3c on" accordingly |
| Summary table | columns by name: `ID`, `Type`, `Locale`, `Requirement`, `Stage`, `Smoke`, `Automation Candidate`, `Data effect`, `Shared data`, `Tags` (optional), `Validation`, `Description` |
| TC section | `### {TC-ID} — {Description}` then one `- **{Field}:** value` bullet per field; `Preconditions` and `Steps` as 2-space-indented ordered sub-lists; the optional `Tags` field (comma list or `—`) after `Shared data`; a step, precondition or expected result starting with `[HUMAN]` is a human step; `[A{n}]` / `[E{n}]` / `[D{n}]` tokens reference TEST-DATA rows; an optional `<!-- tc-evidence … -->` comment right after the block (`validated-on`, `env`, `build`, `scope`, `content-sha256`, `req-sha256`, `open-questions`, `checked-in-run` — one `key: value` per line; the run-metadata keys `tool` (`mcp` / `cli`; absent = written by 3b before 3c existed) and `outcome-check` are parsed into `document.evidence[]` and never rendered) |
| Enhancement log | `TC-ID · Validation · What changed · Why (what the app showed)` + optional `Run` |
| Coverage tables | traceability and coverage-score rows: `AC · REQ-ID · TC-IDs · Status · Missing`; statuses `Fully Covered` / `Partially Covered` / `Not Covered` |
| Manual-only | `Category · TC-ID · Scenario · Why manual · Priority` (High / Medium / Low) |
| Potential bug | `### PB-{n} — {title}` + `Test case`, `Steps to reproduce` (sub-list or `1. … 2. …` inline), `Expected result`, `Actual result` + `<!-- pb-meta: first-seen: …; last-checked: …; env: …; build: …; status: open \| resolved {date} \| not-checked-this-run[; screenshot: {path}] -->` (`screenshot` is metadata → `document.potentialBugs[]`, never rendered) |
| Open question | `### Q-{n} — {title}` + `Affected TCs`, `Gap`, `Why it matters`, `Evidence`, `Recommended`, `Alternatives`, `Pending`, `Status` |
| Reviewer comment (optional) | `- **Reviewer comment:** {text}` in a TC, PB or Q block, written by the reviewer. Shown in that item's comment box; never translated, never a design field (skills 4 / 5 ignore it, and it is not in the TC hash). Its lifecycle lives in the comments file (§7b) |
| Empty optional value | `—` (never blank, never omitted) |

`TEST-DATA-{feature}.md`: the header counts, the `## 0. Environment` table (`ID · What · Value ·
Status`, rows `E{n}`), the `## 1. Accounts` table (`ID · Role · Username · Status · Used by TCs ·
Note`, rows `A{n}`), the `## 2. Test data at a glance` table (`# · Data item · Must look like ·
Used by TCs · Status · Best way to get it`, rows `D{n}`) and the `## 4. Problems` table. A
TEST-DATA without the Environment table or without the Accounts `ID` column renders with
`compatibility[]` findings and its tokens stay unresolved.

## 4. Derived numbers — the page shows these, never the header's

| Number on the page | Computed from |
|---|---|
| Test cases, happy / edge / negative, per locale | the TC set = **union** of summary rows and `###` sections (an orphan on either side is rendered and badged `orphan`, never dropped) |
| Smoke, automation candidates | `Smoke: YES`, `Automation Candidate: YES` per TC |
| Validated / enhanced / inferred / discrepancy / not-impl / draft | the `Validation` value per TC (`draft — … (stale — …)` counts as draft and is badged `stale`) |
| **App validation progress** `{observed}/{N} ({pct}%)` | observed = `validated` + `enhanced` + `discrepancy`, not stale. Excludes `inferred`, `not-implemented`, `draft`. Not a pass rate |
| **Requirement coverage** gauge, Full / Partial / None chips, per-AC depth bars | the `## Requirement Coverage Score` table only (`weighted = (full + 0.5 × partial) / ACs`). Per-AC bar segments = TCs the row cites, split into happy (non-negative types) / negative / distinct locales. Zero ACs → `—`, never `0%`. **Independent of validation states** — the caption on the page says so |
| Test data `{items} · ready / missing / impossible / unknown` | the at-a-glance table rows; no file → `—` |
| Potential bugs `open / not checked / resolved` | `pb-meta` status; *current* = open + not checked (resolved is history) |
| — (not on the page) | run metadata: the header stamp's `by` / `tool`, each stamp's `tool` / `outcome-check`, each PB's `screenshot`. They reach the payload only (`document.stamp`, `document.evidence[]`, `document.potentialBugs[]`) so a comparison between validators stays traceable without changing the page |
| Manual-only counts | the manual-only table rows and their Priority |
| Human steps tile `{TCs} ({steps})`, `human step n` badge, purple step marker | every `[HUMAN]`-prefixed step / precondition / expected result (`counts.humanSteps`, `counts.humanTcs`, `document.humanTcs[]`); shown only when at least one exists |
| Tags chips on a TC card | the `Tags` field / column (`document.tags`); never a translation key, never counted |
| — (not on the page) | `counts.dataRefs` (`total` / `resolved` / `unresolved` / `literals`, `null` without TEST-DATA), `document.reviewLangHeader` (the header's recorded value) and `document.langSource` (`flag` / `default`) |

## 4b. Language — one rule

The page language is `--lang` when given, else English. The document's `Review page language:`
line, a saved learning-file answer, the source language and an existing Arabic sidecar never
decide it; the line is a **record** of what the last render produced and the skill rewrites it
after every render. With `lang=en` the renderer checks that the *narrative* (descriptions, steps,
expected results, Scope) is English — quoted application labels (`"…"`, `«…»`) are ignored — and
reports `narrative-not-english` per TC. The sidecar is read only under `--lang ar`.

## 5. Compatibility — legacy documents render

Strictness applies to what a skill writes, not to what it reads. A document written before the
contract was frozen may lack `Scope`, `Generated`, `Stage`, `App validation progress`, the frozen
anchors (its tables may sit under `###` inside a `## Self-review`), evidence stamps, `## Potential
Bugs` or `## Open Questions`. Each accommodation is listed in `compatibility[]` and the page still
renders; nothing is written back to the markdown (the source is read-only to the script in every
mode). Only a renamed or missing **frozen field inside a TC** blocks, because it breaks skills 4
and 5 too. **Neither skill rewrites an old document into the new shape on its own**: add the new
header lines and sections only when you are already rewriting that document for another reason,
and say so in the final message.

## 6. Arabic hand-off — the strings sidecar

Fixed chrome (headings, badge words, column headers, tile labels, captions, footer) ships inside
the script in both languages. Per-story content is translated once and **persisted** in
`TC-REVIEW-STRINGS-{feature}.ar.json` in the story folder (skills 4 and 5 ignore it). Keys are
derived mechanically (`tc.{TC-ID}.step.{n}`, `tc.{TC-ID}.expected`, `coverage.{n}.ac`,
`data.{Dn}.name`, `pb.{PB-id}.actual`, `q.{Q-id}.gap`, `finding.{bucket}.{n}`, …); values with no
lowercase word (IDs, dates, TC lists, `COVERED`) are never keys and stay Latin.

Each entry stores both `en` and `ar`. `--write-skeleton` **merges, never resets**: an entry whose
`en` still matches keeps its `ar`; a new key appears with `ar: null`; a key whose English changed
becomes `stale: true` with the old `ar` and `en_previous` kept (correct, do not retype); a key the
markdown no longer produces is kept with `orphan: true` and reported. Fill only `null` and `stale`
entries — a faithful translation of the English: same meaning, same order, nothing added or
dropped. IDs, usernames, URLs, dates, file names, the `Status` keyword and application display
labels captured live stay exactly as they are.

A page rendered while any key is missing or stale is a **preview**: the payload says
`arabicComplete: false`, `strings.missing[]` names the keys, the page carries a preview banner and
each fallback string is marked `.untranslated`. Deliver it only as "preview — {n} strings
outstanding", never as the Arabic deliverable, and never record the story as delivered in Arabic
until a render returns `arabicComplete: true`.

## 7. Provenance and hand edits

Line 2 of every rendered page is `<!-- render-tc-review v… · source=… · data=… · strings=… ·
comments=… · lang=… · page=… -->` (a v1.0 line without `comments=` still verifies). `page=` is the sha256 of the page with that value blanked. On `--write` the
script recomputes the existing page's self-hash: a mismatch means a human edited the HTML, and the
write is refused (`gate: BLOCKED`, `refused.reason: hand-edited`) until `--force` is given — tell
the user what will be lost first. A page with no provenance comment (hand-written by an older
skill run) is replaced with a `legacy-page-replaced` warning. Typing a comment in the page never
changes the page file (the text lives in the browser, then in the comments file), so the self-hash
stays valid and a re-render needs no `--force`.

## 7b. Reviewer comments — `REVIEW-COMMENTS-{feature}.md`

**How the reviewer comments.** Every TC card, potential bug and open question on the page has a
comment box, and the page has one general box. Drafts are kept in the reviewer's browser, keyed by
page, feature, source revision and comments-file revision, so they never leak between stories.
**Save comments** writes `REVIEW-COMMENTS-{feature}.md`: the browser asks where, and the reviewer
saves it beside the page (a browser without a save dialog downloads it instead). **Copy for chat**
copies the same text to paste into the chat. The reviewer may instead type a
`- **Reviewer comment:**` line in the markdown (§3). Either way the reviewer then says "read my
comments".

**File shape.** The page writes it; a skill edits only what the rules below allow.

```markdown
# Review comments — {feature}
**Page:** TC-REVIEW-{feature}.html
**Source:** TEST-CASES-{feature}.md
**Source revision:** {first 12 of the source sha256}
**Reviewer:** {name | —}
**Saved:** {YYYY-MM-DD HH:mm}
**Comments:** {open} open · {handled} handled of {total}

## General
{text}
- **Status:** open

## TC-KPI-01
{text — may span lines}
- **Status:** open

## TC-KPI-01 (2)
{a later comment on the same item}
- **Status:** applied 2026-09-27
- **Response:** {what the skill did}
```

**How a skill handles a comment.** Skills 3 `--revision`, 3b and 3c read the open entries at
intake. Act on each under the skill's own rules. Then change only that entry's `- **Status:**`
value to `applied {date}`, `answered {date}` or `declined {date}`, add `- **Response:** {one plain
sentence}` under it, and recompute the `**Comments:**` header. Never edit or delete the heading or
the reviewer's text, never reorder or drop an entry, and never add a comment of your own. A comment
asking for a change the skill may not make (a design field in 3b / 3c, an approved document without
authorization) is `answered` with the route (`skill 3 --revision`), never applied silently. An
unclear comment becomes an open question (`open-questions.md`) and stays `open`. The same rules
apply to comment text pasted in chat. Only a confirmed answer reaches the learning file.

**What the renderer does.** It reads the file beside the source (or `--comments`) and attaches each
`## {id}` entry to the item with that id (`General` to the general box). Open entries are pre-filled
in their box with an `open comment` badge. Handled entries show as read-only history with the
response. An id that is not on the page is listed under "Comments on items no longer on this page",
never dropped. Payload: `comments` (`file`, `open`, `handled`, `items[]`, `unknownIds[]`, `notes[]`,
`stale`) and `hashes.comments`. Warnings: `comment-unknown-id`; `comments-stale-revision` (entries
shown with a "written on an earlier revision" badge); `comments-page-mismatch` (saved from another
page, so ignored); `comment-status-unknown` (treated as open); `comments-header-count`;
`comments-file-missing` (only for an explicit `--comments`). A password-shaped literal in a comment
BLOCKs. Comment text is never translated, never a sidecar key and never counted as narrative.

## 8. Templates — the body partial and the report shell

Two passes. `assets/tc-review.template.html` is the **body partial**, holding this page's sections
only. The renderer renders it, then renders `assets/report-shell.template.html`, the **one general
report page**, around it. The shell owns the document, the one stylesheet (tokens, light / dark,
RTL resets), the one script (theme toggle, screenshot viewer, filter bars, reviewer comments), the
header, meta line, banners, tiles, the general comment box and the footer. The renderer feeds it
data only: `meta_items`, `banners`, `tiles`, `footer` and the JSON island. The shell and the
renderer's "report-shell kit" block (between its BEGIN / END markers) are byte-identical with skill
5's run report; self-test case 27 compares them when skill 5 is installed. Body partials use only
the shell's class vocabulary (`card`, `card-id`, `card-body`, `item-card`, `item-head`, `chip c-*`,
`seg seg-*`, `stamp`, `shot`, `sub-head`, `filter-bar`, `comment-box`). A new component is added to
the shell once, for every page. Placeholders are `{{snake_case_key}}` (HTML-escaped) and `{{{key}}}`
for content the renderer already escaped (translated text, comment boxes), with comment block
markers (`<!-- {{#each list}} -->` … `<!-- {{/each}} -->`, `{{#if flag}}`, `{{#unless flag}}`). Never
write placeholder syntax inside a template's own comments. A placeholder the model cannot fill is left
in the output and BLOCKs the render, so a template edit is always caught. After any template or
renderer change run `node scripts/selftest.mjs --pretty` (golden EN / AR / legacy pages, the merge
rule, the false-PASS guards, exit codes, the data-literal / data-reference cases, the language
precedence cases, the human-step / Tags case, the reviewer-comments case, the one-shell case and
the mirror cases must all pass) and regenerate the goldens only for a deliberate change (see
`scripts/fixtures/MIRROR.md`). The renderer, its harness, its fixtures, both templates and this file
are mirrored in three skill folders (3, 3b, 3c); copy after every edit. The shell also goes to skill 5.
