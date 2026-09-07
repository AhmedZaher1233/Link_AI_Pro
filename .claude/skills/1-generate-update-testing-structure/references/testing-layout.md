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
└── White_Box_Testing/
```

Create empty folders only. Never author requirements, test cases, page objects, tests or
white-box plans during setup. A short `README.md` per top-level folder is allowed when the
project has no conventions yet.

## What each folder is for (and who writes into it)

| Folder | Purpose | Written by |
|---|---|---|
| `Requirements/` | one folder per User Story: `US-{id}-{kebab-name}/` holding `REQ-{id}-{name}.md`, `US-{id}-review.md`, `US-{id}-code-rules.md`; `SPEC-REVIEW-SUMMARY.md` / `CODE-RULES-SUMMARY.md` for multi-story specs | skills 2, 7 |
| `Manual_Test/TestCases/` | one folder per User Story: `TEST-CASES-{feature}.md` (source of truth), `TC-REVIEW-{feature}.html`, `TEST-CASES-{feature}-beautified.md`, `ADO-MAP.md` | skills 3, 5 |
| `Automation/pages/` | Page Object Model files (`+ pages/components/`) | skill 6 |
| `Automation/tests/` | Playwright specs in `{Area}_Tests/` folders | skill 6 |
| `Automation/reports/` | `US-{id}/phase-N.json` + `.html` (immutable history), `run-plan.json`, `data-readiness.json`, `coverage/` | skill 6 |
| `Automation/screenshots/` | `{UserStoryName}/{TC-ID}.png` (+ `-failed.png`), replaced each run | skill 6 |
| `Automation/automation-logs/` | `US-{id}/run-progress-{stamp}.log`, never overwritten | skill 6 |
| `White_Box_Testing/` | `{ID}-{Feature}-analysis.md`, `.project-profile.md` (shared with skill 7) | skills 4, 7 |

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
* HTML reporter to `reports/`; screenshots on failure to `screenshots/`; trace on first retry;
  video only if the project wants it.
* Base config free of story-specific settings (`headless`, `workers`, reporters) — skill 6
  generates `playwright.us-{id}.config.ts` per story that extends it.
* No application URLs or credentials in the config — environment variables or the project's
  env layer only.
* Before modifying an existing `playwright.config.ts`, read it and preserve every valid
  project setting; change only what the manifest paths require.

## Spec-driven chain this layout serves

`Steering (docs/steering) → Requirements (skill 2) → Rules in code (skill 7) → Manual TCs
(skill 3) → White-box audit (skill 4) → Publish to Azure DevOps (skill 5) → Automation
(skill 6) → Reports / Screenshots`. Every skill reads `project-learning.md` before asking and
writes back after learning; every skill reads `qa-manifest.json` for paths first.
