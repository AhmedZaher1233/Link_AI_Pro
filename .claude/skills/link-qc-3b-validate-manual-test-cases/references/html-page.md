<!-- MIRROR — byte-identical copies live in the sibling skill folders
     (link-qc-3-generate-manual-test-cases ↔ link-qc-3b-validate-manual-test-cases ↔ link-qc-3c-validate-manual-test-cases-cli,
     each under references/). Edit all three; scripts/selftest.mjs case 0 sha256-compares every mirrored file. -->
# The review page — `TC-REVIEW-{feature}.html` is RENDERED, never hand-written

Load at the delivery step of skill 3 and at the write-back step of skill 3b or 3c.

**Never hand-write this page. Run the script.** `scripts/render-tc-review.mjs` turns
`TEST-CASES-{feature}.md` (+ `TEST-DATA-{feature}.md`, + the Arabic strings sidecar) into the page
from `assets/tc-review.template.html`. It recomputes every number from the tables, refuses to
invent one, marks what it cannot supply with `—`, and stamps the page with a provenance comment
(source / data / strings sha256 + a self-hash) so a hand-edited page is detected. Same inputs →
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

`--data` and `--strings` override the defaults (`TEST-DATA-{feature}.md` and
`TC-REVIEW-STRINGS-{feature}.ar.json` next to the TC document). `--emit-keys` lists the derived
translation keys. `--strict` maps the gate to an exit code for CI (PASS 0 · MISMATCH 1 ·
BLOCKED 2 · NOT_RUN 3); without it the script always exits 0 and the result is the payload.

Read the payload, never the HTML: `gate`, `gateReason`, `counts`, `mismatches[]`,
`compatibility[]`, `warnings[]`, `errors[]`, `strings.missing[]`, `arabicComplete`, `writes[]`.

## 2. Gate — what each verdict means for the skill

| Gate | Cause | What you do |
|---|---|---|
| `PASS` | header consistent, vocabulary valid, (Arabic) every key translated | deliver the page |
| `MISMATCH` | a header line disagrees with the tables (`mismatches[]`), and/or Arabic keys are missing or stale | the page IS written (with a warning strip / preview banner). **Fix the header lines in the markdown** (skill 3) or the counts you patched (3b), re-render. An Arabic page with `arabicComplete: false` is a **preview** — say so; never call it the Arabic deliverable |
| `BLOCKED` | something would make the page wrong: out-of-vocabulary `Type` / `Validation` / test-data status, a table row with the wrong cell count, a TC without `Type` / `Steps` / `Expected Result`, a password-shaped literal in a step, a placeholder the model cannot fill, a hand-edited page without `--force` | nothing is written. Fix the markdown (`errors[]` names the line) and re-render. Never bypass by writing HTML yourself |
| `NOT_RUN` | no `--tc`, or the file does not exist | fix the path |

`readOnly: true` in the payload means nothing was written (dry run, or a refused write).

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
| Summary table | columns by name: `ID`, `Type`, `Locale`, `Requirement`, `Stage`, `Smoke`, `Automation Candidate`, `Data effect`, `Shared data`, `Validation`, `Description` |
| TC section | `### {TC-ID} — {Description}` then one `- **{Field}:** value` bullet per field; `Preconditions` and `Steps` as 2-space-indented ordered sub-lists; an optional `<!-- tc-evidence … -->` comment right after the block (`validated-on`, `env`, `build`, `scope`, `content-sha256`, `req-sha256`, `open-questions`, `checked-in-run` — one `key: value` per line; the run-metadata keys `tool` (`mcp` / `cli`; absent = written by 3b before 3c existed) and `outcome-check` are parsed into `document.evidence[]` and never rendered) |
| Enhancement log | `TC-ID · Validation · What changed · Why (what the app showed)` + optional `Run` |
| Coverage tables | traceability and coverage-score rows: `AC · REQ-ID · TC-IDs · Status · Missing`; statuses `Fully Covered` / `Partially Covered` / `Not Covered` |
| Manual-only | `Category · TC-ID · Scenario · Why manual · Priority` (High / Medium / Low) |
| Potential bug | `### PB-{n} — {title}` + `Test case`, `Steps to reproduce` (sub-list or `1. … 2. …` inline), `Expected result`, `Actual result` + `<!-- pb-meta: first-seen: …; last-checked: …; env: …; build: …; status: open \| resolved {date} \| not-checked-this-run[; screenshot: {path}] -->` (`screenshot` is metadata → `document.potentialBugs[]`, never rendered) |
| Open question | `### Q-{n} — {title}` + `Affected TCs`, `Gap`, `Why it matters`, `Evidence`, `Recommended`, `Alternatives`, `Pending`, `Status` |
| Empty optional value | `—` (never blank, never omitted) |

`TEST-DATA-{feature}.md`: the header counts, the `## 2. Test data at a glance` table
(`# · Data item · Must look like · Used by TCs · Status · Best way to get it`) and the
`## 4. Problems` table.

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
lang=… · page=… -->`. `page=` is the sha256 of the page with that value blanked. On `--write` the
script recomputes the existing page's self-hash: a mismatch means a human edited the HTML, and the
write is refused (`gate: BLOCKED`, `refused.reason: hand-edited`) until `--force` is given — tell
the user what will be lost first. A page with no provenance comment (hand-written by an older
skill run) is replaced with a `legacy-page-replaced` warning. Reviewer notes belong in the
markdown, not in the page.

## 8. Template — `assets/tc-review.template.html`

One placeholder scheme (`{{snake_case_key}}`, HTML-escaped; `{{{key}}}` for content the renderer
already escaped and may have wrapped in the `.untranslated` marker) and comment block markers
(`<!-- {{#each list}} -->` … `<!-- {{/each}} -->`, `{{#if flag}}`, `{{#unless flag}}`). The CSS
block is unchanged from the hand-filled era and keeps matching
`link-qc-5-test-run-automation/assets/coverage-dashboard.css`. A placeholder the model cannot fill is left
in the output and BLOCKs the render, so a template edit is always caught. After any template or
renderer change run `node scripts/selftest.mjs --pretty` (golden EN / AR / legacy pages, the merge
rule, the false-PASS guards, exit codes and the mirror case must all pass) and regenerate the
goldens only for a deliberate change (see `scripts/fixtures/MIRROR.md`). The renderer, its harness, its
fixtures and this file are mirrored in three skill folders (3, 3b, 3c) — copy after every edit.
