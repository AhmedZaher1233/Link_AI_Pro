<!-- MIRROR — byte-identical copies live in the sibling skill folders
     (link-qc-3-generate-manual-test-cases ↔ link-qc-3b-validate-manual-test-cases ↔ link-qc-3c-validate-manual-test-cases-cli, each under references/). Edit all three;
     scripts/selftest.mjs case 0 sha256-compares every mirrored file. -->
# Project learning file — skills 3, 3b and 3c — load at the learning-file step

The shared read-first / ask-second / write-back protocol, the tag vocabulary and the file
skeleton are defined ONCE, in
`../link-qc-1-generate-update-testing-structure/references/project-learning-protocol.md`
(template: `../link-qc-1-generate-update-testing-structure/assets/project-learning.template.md`).
Read that file when it is present — it is authoritative. This page holds only what is specific
to the three TC skills, plus the short fallback below for a project that synced one of them alone.

`{learning_file}` is the plain-English knowledge base shared by ALL QA skills (1-11, 3b and 3c): what
the system does (modules, rules, roles), how to reach screens, common flows, UI behaviour, test
data, EN/AR differences, automation tricks, and answered questions — separated per model. It
exists to progressively eliminate rediscovery and re-asking across stories.

**Sections — each skill writes only its own:**

| Skill | Section | Records |
|---|---|---|
| `link-qc-3-generate-manual-test-cases` | `### Manual TC Model (skill 3)` | design-time answers (spec source, review-page language, implementation status as stated), design knowledge |
| `link-qc-3b-validate-manual-test-cases` | `### Validation Model (skill 3b)` | base URL per environment (`[type: env]`, never a credential), common flows walked live (name + date), screens confirmed locale-independent, build/version location, live answers |
| `link-qc-3c-validate-manual-test-cases-cli` | `### CLI Validation Model (skill 3c)` | the same facts observed through playwright-cli, plus the login method used per environment (attended / secrets file — names only, never a value); the cross-validator answers |

All three carry `#### Knowledge` and `#### Questions and Answers`. Shared facts (flows, labels, test
data, locale differences, tricks) go to the shared sections, not to a model section.

## Read (before any work, before any question)

- Read only the `## Index` block; from the story title, feature and page names pick the module /
  page / element names to look for, plus the `Similar to` modules the Index lists for them.
- Grep those tags — `\[module: X\]`, `\[page: Y\]`, `\[element: Z\]`, `\[similar: .*X` — and,
  for a live pass, `\[type: trick\]` and `\[type: env\]`. Read only the matching lines (0-1 lines
  of context).
- Before asking the user anything, grep `#### Questions and Answers` of **both** model sections
  for the question's keywords (e.g. `base URL`, `role`, `environment`, `implemented`) and the
  shared `[type: env]` lines — then follow `open-questions.md` §1.
- Review-page language: grep `output language` and `لغة` under `## Project Knowledge` and the
  skill 2 / skill 3 Q&A. A saved answer settles `review_page_language` without asking — even
  when the `REQ-*.md` you were given is English (skill 2 always writes REQ files in English).
- Load a whole section only if it is under ~40 lines and the grep found nothing. A file under
  80 lines may be read whole.
- Anything already answered is NOT re-asked and NOT re-discovered live. State what you are
  reusing so the user can override. Trust it unless live observation or the spec contradicts it —
  then update the entry. A `[similar: …]` module's entries count as a **recommendation requiring
  confirmation** for its look-alikes (`open-questions.md` §1), not as a fact.

## Write (before delivering — mandatory, not optional; skipped entirely in `--audit`)

- Every question the user answered this run → one tagged line under this skill's
  `#### Questions and Answers`:
  `- [module: X] [type: qa] **Q (skill 3 | skill 3b | skill 3c, {YYYY-MM-DD}):** … — **A:** … (confirmed by user {date})`.
  Project-wide answers (base URL per environment, roles, module names, implementation status,
  review-page language) are ALSO added to `## Project Knowledge`. **Credentials are NEVER
  written.** An unanswered recommendation is never written.
- The review-page language answer is project-wide: write it under `## Project Knowledge` AND
  under the skill's Q&A as
  `- [module: project] [type: qa] **Q (skill 3, {YYYY-MM-DD}):** Output language for Arabic requirements — **A:** Arabic`
  (update the existing line if skill 2 already wrote one and the user changed the answer).
  The learning file itself is always English.
- Every new fact → one tagged line in the matching shared section (`## Common Flows`,
  `## UI Knowledge`, `## Test Data`, `## Locale Knowledge`, `## Automation Tricks`) or this
  skill's `#### Knowledge`. Grep the same tags first; update or dedupe instead of appending twins.
- Test data: an item confirmed `READY` live that the file did not know → one `[type: data]` line
  under `## Test Data` (`Fixture "{plain name}" — {what exists}; environment {env}; seen live on
  {date}`). `MISSING` / `IMPOSSIBLE` / `UNKNOWN` statuses are NOT written here — skill 5 records
  the final outcome.
- A module / page / element that behaves like an existing one → add `[similar: …]` on both
  entries instead of copying text; update the `## Index` row for every module touched.
- Update any entry contradicted by live observation or by the spec — never leave conflicting or
  duplicate entries. Specs and steering always win.
- Store learned KNOWLEDGE in your own words, not requirement text. "To open KPI Details: open
  the strategy → open the objective → select the KPI" belongs here, and so does "A KPI cannot be
  closed while it has open initiatives (source: US-1234 AC-3)". Never paste "The system shall …"
  sentences verbatim.
- Plain English only: never method / class / function / file names, variables, CSS or XPath
  selectors, code snippets, or stack traces. Element identifiers observed incidentally MAY go
  under `## Automation Tricks`, each explained in words on the same line (they help skill 5).
  They must NEVER appear in the TC deliverables.

## Fallback — skill 1 not present in this project

File missing → create it with this skeleton and keep the language simple; it is a knowledge
base, NOT another specification:

```markdown
# Project Learning — {project name}

## Index
| Module | Pages | Similar to | Sections that mention it |
|---|---|---|---|

## Project Knowledge
## Common Flows
## UI Knowledge
## Test Data
## Locale Knowledge
## Automation Tricks

## Model Notes
### Setup Model (skill 1)
### Requirements Review Model (skill 2)
### Manual TC Model (skill 3)
### Validation Model (skill 3b)
### CLI Validation Model (skill 3c)
### Publish Model (skill 4)
### Automation Model (skill 5)
### White-Box Model (skill 10)
### Rule Discovery Model (skill 11)
```

Each `### … Model` subsection carries `#### Knowledge` and `#### Questions and Answers`.
A legacy `.planning/project-learning.md` is merged into the matching sections of the new file
and then no longer used. Then tell the user to run `/link-qc-1-generate-update-testing-structure`
(audit first, then repair) so the foundation is created properly.
