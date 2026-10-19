# Answers → bugs, Coverage-Index.md and Learning-UI.md (Step 9)

Loaded from Step 9 of SKILL.md.

## Step 9 — Answers → Bugs, and `Learning-UI.md`

The Open Questions are how the project's real intent gets captured. When the
user answers them — in the same session or a later one — do both of the
following.

### 1. Act on each answer
- **"It should match / that's wrong"** → write it up as a full bug, exactly
  like any other (Step 8 structure, its own evidence crop). Its Expected Result
  cites the answer: *"Confirmed by the product owner on <date>: toolbar buttons
  use 16px horizontal padding."* Confidence is `High` — intent is now stated,
  not inferred.
- **"It's intentional"** → not a bug. Say so briefly, and record the rule
  anyway (below). A confirmed intentional exception is as valuable as a bug: it
  stops the same false positive being raised every future run.
- **"Don't know / ask the designer"** → leave the question open, carry it
  forward to the next report unchanged, and note it's still outstanding.

Update the report in place: move answered questions out of Open Questions and
into either the bug list or the answered-rules record, so the section only ever
holds what's still unanswered.

### 1b. Keep `Coverage-Index.md` — which screens have been audited at all

A per-page report answers "what's wrong with this page". Nothing answers
**"which pages have we never looked at?"** — so maintain
`<base>/UI-Testing/Coverage-Index.md` as the register of the whole product.

**Build the candidate list from the app itself**, not from memory:
- the route definitions in the codebase (the most complete source),
- the navigation menu of the running app,
- the frames in the design file, if there is one.

Then confirm the list with the user once, and keep it as the denominator.

```markdown
# Coverage Index — UI audit status per screen

Every screen in the product. A screen with no row has never been considered;
a row marked "Not audited" has been identified but not yet covered.

| Screen | Route | Languages | Status | Last audited | Report | Open bugs |
|---|---|---|---|---|---|---|
| Dashboard | `/dashboard` | EN, AR | Audited | 2026-09-12 | [report](./Reports/UI-Visual-QA-dashboard.md) | 4 |
| Listing | `/items` | EN | Partially audited — AR not covered | 2026-09-12 | [report](…) | 2 |
| Item details | `/items/:id` | — | **Not audited** | — | — | — |
| Settings | `/settings` | — | **Not audited** | — | — | — |

**Screens audited: 2 of 4.**
```

Update the row the moment a page's report is written, and re-confirm the screen
list whenever the app gains routes. When the user asks what's been covered,
this file is the answer — and the "2 of 4" line is the honest headline, not the
number of reports produced.

### 2. Record what was learned in `Learning-UI.md`

Maintain `<base>/UI-Testing/Learning-UI.md` as the project's accumulated UI
intent — every answer becomes a durable rule that Rung 0 reads on the next run.

```markdown
# Learning-UI — confirmed UI rules for this project

Accumulated from answers to audit Open Questions. Each rule is a stated
decision, not an inference. Newest first.

| # | Scope | Rule | Source | Date |
|---|---|---|---|---|
| 1 | Toolbar buttons (all screens) | Horizontal padding is 16px; the Export button's 24px was unintended | Answer to Q01, Dashboard report | 2026-09-12 |
| 2 | Row actions | The Delete action is red by design; other actions stay blue | Answer to Q03, Dashboard report | 2026-09-12 |
| 3 | Listing tables | Row height is 56px across all listing screens | Answer to Q04, Dashboard report | 2026-09-12 |
```

Rules for this file:
- **Scope matters** — say whether a rule is global, per-screen, or per-component.
  A rule recorded too broadly will generate false bugs elsewhere.
- **Record the source and date**, and which question it came from, so a rule can
  be traced and revisited.
- **A rule is the user's statement, not a design file** — if a later audit finds
  the codebase or a real design contradicting it, raise the conflict rather than
  silently picking a side.
- **Supersede, don't delete**: when an answer changes a previous rule, update the
  row and note that it replaced an earlier decision.
- Add rules learned mid-audit too, not only at the end — if the user clarifies
  something while you're working, capture it there and then.

Over successive audits this file becomes the project's de-facto UI spec: the
question list shrinks, and more findings become provable rather than judgment
calls.

In a project set up by skill 1, also write each confirmed rule as one tagged
line into `Testing/project-learning.md` — `## UI Knowledge` / `## Locale
Knowledge` for the fact, `### UI Visual QA Model (skill 6) → #### Questions
and Answers` for the `[type: qa]` line with `(confirmed by user {date})` — so
the other skills (3, 3b, 6) see the same intent. Plain English, no selectors,
no file paths, no credentials; `Learning-UI.md` keeps the measured detail.

