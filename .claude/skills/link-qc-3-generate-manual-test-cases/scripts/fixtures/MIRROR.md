# MIRROR — fixtures

Every file under `scripts/fixtures/` is a byte-identical copy in the three mirror skill folders:

- `link-qc-3-generate-manual-test-cases/scripts/fixtures/`
- `link-qc-3b-validate-manual-test-cases/scripts/fixtures/`
- `link-qc-3c-validate-manual-test-cases-cli/scripts/fixtures/`

JSON and HTML golden files cannot carry a MIRROR banner, so they are listed here instead. Edit a
fixture in one folder, copy it to the others, then run `node scripts/selftest.mjs --pretty` in
any folder — case 0 sha256-compares every mirrored path against every sibling present and fails
on any drift (a sibling that is not installed is simply not compared).

| Path | What it is |
|---|---|
| `sample/TEST-CASES-kpi-filter.md` | new-shape document: 5 TCs across all six validation states, evidence stamps, `[A1]` / `[E1]` / `[D{n}]` data references, a `Tags` column + field (`uat, regression` on TC-KPI-01), one `[HUMAN]` step (TC-KPI-04), `## Potential Bugs`, `## Open Questions`, five findings buckets |
| `sample/TEST-DATA-kpi-filter.md` | its test-data file (`## 0. Environment` E1, `## 1. Accounts` A1 with the `ID` column, 3 items: 2 READY, 1 UNKNOWN; 1 problem) |
| `sample/TC-REVIEW-STRINGS-kpi-filter.ar.json` | complete Arabic sidecar for the sample (every key translated) |
| `legacy/TEST-CASES-legacy-login.md` | pre-change shape: no `Scope` / `Generated` / `Stage` / anchors / stamps / PB section, `###` self-review tables, `LOGIN-01:` heading style, `APPROVED` |
| `golden/TC-REVIEW-kpi-filter.en.html` | expected English page for the sample — byte-for-byte |
| `golden/TC-REVIEW-kpi-filter.ar.html` | expected Arabic page for the sample — byte-for-byte, `arabicComplete: true` |
| `golden/TC-REVIEW-legacy-login.en.html` | expected page for the legacy document, rendered with `compatibility[]` findings |

Regenerate a golden only after a deliberate template or renderer change, from the same folder:

```bash
node scripts/render-tc-review.mjs --tc scripts/fixtures/sample/TEST-CASES-kpi-filter.md --write --force --out scripts/fixtures/golden/TC-REVIEW-kpi-filter.en.html
node scripts/render-tc-review.mjs --tc scripts/fixtures/sample/TEST-CASES-kpi-filter.md --lang ar --write --force --out scripts/fixtures/golden/TC-REVIEW-kpi-filter.ar.html
node scripts/render-tc-review.mjs --tc scripts/fixtures/legacy/TEST-CASES-legacy-login.md --write --force --out scripts/fixtures/golden/TC-REVIEW-legacy-login.en.html
```

Broken-input cases (unknown enum, broken row, secret literal, orphan TCs, header mismatch, zero
ACs, stale strings), the run-metadata case (a `by 3c … , tool cli` header, `tool` /
`outcome-check` stamp keys, a `screenshot` pb-meta key), the data-literal / data-reference cases,
the language-precedence cases (L1–L4), the human-step / Tags case and the reviewer-comments case
(a `REVIEW-COMMENTS-kpi-filter.md` written into a temporary copy) are produced by `selftest.mjs`
as in-memory mutations of the sample, so they need no files here. The sample folder deliberately
holds no comments file, so the goldens show the empty comment boxes.

The goldens are rendered through two templates: `assets/tc-review.template.html` (the body
partial) and `assets/report-shell.template.html` (the shared report shell, also in skill 5). A
change to either one changes every golden; regenerate the three here and skill 5's run-report
golden (`link-qc-5-test-run-automation/scripts/fixtures/run-report/README.md`).
