# Project learning file — skill 5b — load at the learning-file step

The shared read-first / ask-second / write-back protocol, the tag vocabulary and the file
skeleton are defined ONCE, in
`../link-qc-1-generate-update-testing-structure/references/project-learning-protocol.md`
(template: `../link-qc-1-generate-update-testing-structure/assets/project-learning.template.md`).
Read that file when it is present — it is authoritative. This page holds only what is specific
to the manual CLI run.

`{learning_file}` is the plain-English knowledge base shared by ALL QA skills. This skill owns one
section, `### Manual Run Model (skill 5b)`, with `#### Knowledge` and `#### Questions and Answers`;
it is created under `## Model Notes` (after `### Automation Model (skill 5)`) when absent.
Shared facts (flows, labels, test data, locale differences, tricks) go to the shared sections,
not to the model section.

## Read (before any work, before any question)

- Read only the `## Index` block; from the story title, feature and page names pick the module /
  page / element names to look for, plus the `Similar to` modules the Index lists for them.
- Grep those tags — `\[module: X\]`, `\[page: Y\]`, `\[element: Z\]`, `\[similar: .*X` — plus
  `\[type: env\]` (base URL per environment, build location, test interfaces, production flag,
  login method) and `\[type: data\]` (fixtures confirmed live). Read only the matching lines.
- `## Common Flows` and `## UI Knowledge` shorten the first visit of a screen (where the menu is,
  what the landing screen shows, how a custom dropdown opens, the assistant's message list and
  reset control); they never replace issuing the TC's own steps — every step is executed anyway
  (`execution-rules.md` §2).
- Before asking anything, grep `#### Questions and Answers` of this skill's section and of
  skills 5, 3c, 3b and 3 for the question's keywords — then follow `open-questions.md` §1.
- Anything already answered is NOT re-asked. State what you are reusing so the user can override.
  A `[similar: …]` module's entries count as a recommendation requiring confirmation, not a fact.

## Write (before delivering — mandatory, not optional; skipped entirely in `--audit`)

What this skill records, each as one tagged line, grepped first and deduped instead of appended
twice:

| Fact | Where | Shape |
|---|---|---|
| login method used per environment and account | `#### Knowledge` | `- [type: env] Login on {env} for [A1] (Administrator): attended \| secrets file (names A1_USER / A1_PASSWORD)` — names only, never a value |
| where the build / version shows | `## Project Knowledge` | `- [type: env] Build number on {env}: footer of every screen` |
| assistant UI facts | `## UI Knowledge` | `- [module: Assistant] [page: Chat] [type: ui] The message list is the panel under the heading "Conversation"; the newest assistant message is last; a reply has finished when its text stops changing (no typing indicator remains); the "New chat" control at the top resets the conversation` |
| a common flow executed this run that the file did not know | `## Common Flows` | `- [module: Orders] [type: flow] To open Order Details: Open Products → open the order → select the Details tab (seen live {date})` |
| a fixture confirmed present live that the file did not know | `## Test Data` | `- [type: data] Fixture "{plain name}" — {what exists}; environment {env}; seen live on {date}` — `MISSING` is NOT written here (the readiness table holds it) |
| every question the user answered this run | `#### Questions and Answers` | `- [module: X] [type: qa] **Q (skill 5b, {YYYY-MM-DD}):** … — **A:** … (confirmed by user {date})` |

Project-wide answers (base URL per environment, roles, module names, implementation status) are
ALSO added to `## Project Knowledge`. Update any entry contradicted by live observation — never
leave conflicting or duplicate entries; a `[similar: …]` link on both entries instead of copied
text; the `## Index` row updated for every module touched.

**Never written:** a reply text or an excerpt of one (it lives in `reply.md`), a credential or a
secret name's value, a TC status or verdict, a bug, an unanswered recommendation, a selector /
locator / element ref / command / file path (an element identifier observed incidentally may go
under `## Automation Tricks`, explained in words on the same line). Plain English only; the
learning file is always English.

## Fallback — skill 1 not present in this project

File missing → create it with the protocol's skeleton (`## Index`, `## Project Knowledge`,
`## Common Flows`, `## UI Knowledge`, `## Test Data`, `## Locale Knowledge`, `## Automation
Tricks`, `## Model Notes` with one `### … Model` subsection per skill, each carrying
`#### Knowledge` and `#### Questions and Answers`), keep the language simple — it is a knowledge
base, NOT another specification — and tell the user to run
`/link-qc-1-generate-update-testing-structure` (audit first, then repair) so the foundation is created
properly.
