# Project learning file — skill 3 specifics — load at workflow step 4

The shared read-first / ask-second / write-back protocol, the tag vocabulary and the file
skeleton are defined ONCE, in
`../1-generate-update-testing-structure/references/project-learning-protocol.md`
(template: `../1-generate-update-testing-structure/assets/project-learning.template.md`).
Read that file when it is present — it is authoritative. This page holds only what is specific
to skill 3, plus the short fallback below for a project that synced skill 3 alone.

`{learning_file}` is the plain-English knowledge base shared by ALL QA skills 1-7: what the
system does (modules, rules, roles), how to reach screens, common flows, UI behaviour, test
data, EN/AR differences, automation tricks, and answered questions — separated per model. It
exists to progressively eliminate rediscovery and re-asking across stories.

**This skill's section:** `### Manual TC Model (skill 3)` with `#### Knowledge` and
`#### Questions and Answers`.

## Read (before any work, before any question)

- Read only the `## Index` block; from the story title, feature and page names pick the module /
  page / element names to look for, plus the `Similar to` modules the Index lists for them.
- Grep those tags — `\[module: X\]`, `\[page: Y\]`, `\[element: Z\]`, `\[similar: .*X` — and,
  for the MCP pass, `\[type: trick\]`. Read only the matching lines (0-1 lines of context).
- Before asking the user anything, grep `#### Questions and Answers` for the question's keywords
  (e.g. `base URL`, `role`, `environment`) and the shared `[type: env]` lines.
- Load a whole section only if it is under ~40 lines and the grep found nothing. A file under
  80 lines may be read whole.
- Anything already answered is NOT re-asked and NOT re-discovered via MCP. State what you are
  reusing so the user can override. Trust it unless live observation or the spec contradicts it —
  then update the entry. A `[similar: …]` module's entries count as known knowledge for its
  look-alikes unless observation shows otherwise.

## Write (before delivering — mandatory, not optional; skipped entirely in `--audit`)

- Every question the user answered this run → one tagged line under
  `### Manual TC Model (skill 3) → #### Questions and Answers`:
  `- [module: X] [type: qa] **Q (skill 3, {YYYY-MM-DD}):** … — **A:** …`.
  Project-wide answers (base URL per environment, roles, module names, implementation status)
  are ALSO added to `## Project Knowledge`. **Credentials are NEVER written.**
- Every new fact → one tagged line in the matching shared section (`## Common Flows`,
  `## UI Knowledge`, `## Test Data`, `## Locale Knowledge`, `## Automation Tricks`) or this
  skill's `#### Knowledge`. Grep the same tags first; update or dedupe instead of appending twins.
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
  under `## Automation Tricks`, each explained in words on the same line (they help skill 6).
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
### White-Box Model (skill 4)
### Publish Model (skill 5)
### Automation Model (skill 6)
### Rule Discovery Model (skill 7)
```

Each `### … Model` subsection carries `#### Knowledge` and `#### Questions and Answers`.
A legacy `.planning/project-learning.md` is merged into the matching sections of the new file
and then no longer used. Then tell the user to run `/1-generate-update-testing-structure`
(audit first, then repair) so the foundation is created properly.
