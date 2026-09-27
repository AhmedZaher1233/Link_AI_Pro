# Testing layout — the `Testing/` root

Load when the run may create folders (new project, Mode B/C) or when the audit reports a
layout FAIL/WARN and you need to explain it.

## Canonical structure

```text
Testing/
├── project-learning.md      ← shared knowledge base (assets/project-learning.template.md)
├── qa-manifest.json         ← machine-readable structure contract (assets/qa-manifest.template.json)
├── Requirements/
├── Manual_Test/
│   └── TestCases/
├── Automation/
│   ├── pages/
│   ├── tests/
│   ├── reports/
│   ├── screenshots/
│   └── automation-logs/
├── White_Box_Testing/
└── UI-Testing/
```

Create empty folders only. Never author requirements, test cases, page objects, tests or
white-box plans during setup. A short `README.md` per top-level folder is allowed when the
project has no conventions yet.

## What each folder is for (and who writes into it)

| Folder | Purpose | Written by |
|---|---|---|
| `Requirements/` | one folder per User Story: `US-{id}-{kebab-name}/` holding `REQ-{id}-{name}.md`, `US-{id}-review.md`, `US-{id}-code-rules.md`. Stories extracted from a spec FILE are grouped under a parent folder `SPEC-{spec-name}/` (spec file stem, kebab-case) that also holds `SPEC-REVIEW-SUMMARY.md` / `CODE-RULES-SUMMARY.md` for multi-story specs; ADO / Word / pasted stories sit directly under `Requirements/`. Both `SPEC-*/` and `US-*/` children are valid — never flag them as deviations | skills 2, 11 |
| `Manual_Test/TestCases/` | one folder per User Story: `TEST-CASES-{feature}.md` (source of truth), `TEST-DATA-{feature}.md`, `TC-REVIEW-{feature}.html` (rendered), `TC-REVIEW-STRINGS-{feature}.ar.json` (Arabic pages only), `REVIEW-COMMENTS-{feature}.md` (optional, the reviewer's comments saved from the review page), `TEST-CASES-{feature}-beautified.md`, `ADO-MAP.md`, `ADO-BUG-MAP.md` (source-qualified bug identities; never in reports), `evidence/` (3c bug screenshots), `comparison/` (3b-vs-3c evaluation copies). Mirrors `Requirements/`: stories from a spec file live under `SPEC-{spec-name}/US-{id}-{kebab-name}/` (with `TC-GENERATION-SUMMARY.md` inside the spec folder); others directly under `TestCases/US-{id}-{kebab-name}/` | skills 3, 3b, 3c, 4; link-qc-8 TC mapping, link-qc-8–6 bug mapping |
| `Automation/pages/` | Page Object Model files (`+ pages/components/`) | skill 5 |
| `Automation/tests/` | Playwright specs in `{Area}_Tests/` folders | skill 5 |
| `Automation/reports/` | `[SPEC-{spec-name}/]US-{id}-{kebab-name}/` holding `TEST-RUN-REPORT-{feature}.md` (test-case status, one section per phase) + `BUG-REPORT-{feature}.md` (bugs) + `TEST-RUN-REPORT-{feature}.html` (both rendered into one page), `.runs/phase-N.json` (immutable per phase), `coverage/` (3 CSVs), `artifacts/` (scratch), and the reviewer's optional `REVIEW-COMMENTS-{feature}.md` (comments saved from the page). Mirrors the story's `Manual_Test/TestCases/` position with the same leaf. Older `US-{id}/` leaves and top-level `phase-N.*` / `merged-results.json` are legacy, read-only — never flag them; link-qc-8 appends bug History, link-qc-9 updates observed bug Status/History | skill 5; link-qc-8, link-qc-9 |
| `Automation/screenshots/` | `[SPEC-{spec-name}/]{UserStoryName}/phase-{N}/{TC-ID}/{variant}/attempt-{a}.png` (+ `attempt-{a}-failed.png`), immutable history — never replaced or deleted. Same `SPEC-*` mirroring; both children valid | skill 5 |
| `Automation/automation-logs/` | `[SPEC-{spec-name}/]US-{id}-{name}/run-progress-{stamp}.log`, never overwritten. Same `SPEC-*` mirroring; both children valid | skill 5 |
| `White_Box_Testing/` | `.project-profile.md` at the root (shared with skill 11); reports nested per story `[SPEC-{spec-name}/]US-{id}-{kebab-name}/{ID}-{Feature}-analysis.md`, mirroring `Requirements/`. Both `SPEC-*/` and `US-*/` children are valid — never flag them as deviations; older flat reports at the root are legacy, read-only | skills 10, 11 |
| `UI-Testing/` | per screen, not per story: `Expected-UI/<page-slug>_<lang>.png` + `_sources.md` (approved design images), `Actual-UI/<page-slug>_<lang>.png` (+ `_segments/`, `_history/` for earlier captures), `Reports/UI-Visual-QA-<page-slug>.md` + `Reports/evidence/<page-slug>_<lang>/bugNN_*.png`, `Learning-UI.md` (confirmed UI rules), `Coverage-Index.md` (which screens were ever audited). A project whose bug reports live elsewhere keeps that convention — the report states where it was written | link-qc-6-ui-testing |

## Existing structure rules

* An existing Playwright project (any folder with `playwright.config.*`) is **reused** as the
  automation root — never create a parallel `Testing/Automation/`. Record the actual path in the
  manifest (`paths.automationRoot`) and as a deviation if it is not canonical.
* Legacy lowercase names under `Testing/` are valid structure: extend in place, record the
  deviation.
* Relocations (root-level `automation/`, `pages/`, `tests/`, `reports/`, `screenshots/` living
  elsewhere) happen only in Mode C with a confirmed move plan.

## Playwright configuration expectations (checked, created only when required)

* TypeScript; tests under the `tests` path and page objects under the `pages` path recorded in
  the manifest.
* Screenshots on failure (`screenshot: 'only-on-failure'`); `trace: 'retain-on-failure'` (skill 5
  runs with `retries: 0`, so `on-first-retry` would never fire); video off unless `PW_VIDEO` is
  set while a freeze is investigated.
* **Reporters are additive.** Whatever the project configures — Playwright's own `html`
  reporter into `reports/`, a JUnit reporter for CI, a custom one — is kept. Skill 5 *adds*
  the `line` and `json` reporters it needs (the `json` one writes the per-stage results file
  it merges into the run file for the rendered story report) to that list and never replaces it. The one hard
  rule: nothing may override or discard that stage JSON — in particular, never pass
  `--reporter` on the CLI, because Playwright's `--reporter` replaces the whole configured
  list.
* **One shared `playwright.config.ts`, never a per-story file.** Skill 5 updates it in place
  (Google Chrome `channel: 'chrome'`, headed, `workers: 2`, `fullyParallel: true`, `forbidOnly` on
  CI, `retries: 0`, every timeout from a sibling `timeouts.ts`), consolidates several configs
  into it only when their behaviour is reproducible and their references are rewritten (an
  unmergeable one is kept and reported), and creates it from its template only when none exists.
  Per-run values arrive as environment variables set on each command (`PW_STAGE_JSON`,
  `PW_PROGRESS_FILE`, `PW_OUTPUT_DIR`, `PW_GLOBAL_TIMEOUT`, `PW_HEADLESS`, `PW_WORKERS`,
  `PW_PHASE`, `PW_STAGE_ATTEMPT`); skill 5 adds a `helpers/progress-reporter.ts` entry to the
  reporter list beside the project's own. Skill 1 only checks the file exists and keeps these
  facts out of the base skeleton; the contract lives in skill 5's `references/code-craft.md` §8-9.
* Optional `automation.layers` block in the manifest (`pages`, `fixtures`, `helpers`, `utils`,
  `specGlob`) when the project's layer names differ from the defaults — skill 5's validator
  reads it so Page Object Model checks follow the project's real architecture.
* No application URLs or credentials in the config — environment variables or the project's
  env layer only.
* Before modifying an existing `playwright.config.ts`, read it and preserve every valid
  project setting; change only what the manifest paths require.

## Spec-driven chain this layout serves

`Steering (docs/steering) → Requirements (skill 2) → Rules in code (skill 11) → Manual TCs
(skill 3, design only) → Live validation (skill 3b through Playwright MCP, or its evaluation twin 3c through playwright-cli — optional, same files patched in place) →
White-box audit (skill 10) → human sets APPROVED → Publish to Azure DevOps (skill 4, optional) →
Automation (skill 5) → Reports / Screenshots`. Beside the chain, per screen and at any point:
`Visual UI audit (link-qc-6-ui-testing, Playwright MCP + optional Figma MCP) → UI-Testing/`. Every skill reads
`project-learning.md` before asking and writes back after learning; every skill reads
`qa-manifest.json` for paths first.

After publishing / automation, the optional Azure loop link-qc-7…link-qc-9 records outcomes on the Test Plan, syncs defects both ways (direction gate) and retests them live; skill 4 --suite-only places published TCs in a suite. It gates nothing; its bug map lives in TestCases. UI bug Status/History are maintained by link-qc-8/link-qc-9 under the same producer-format restrictions.
