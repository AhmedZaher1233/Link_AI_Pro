# TC design rules and format — load at the design phase (workflow step 7)

Draft the complete test case set FIRST: coverage from the specs, journey detail (navigation,
preconditions, known flows, test data) from the learning file where it already has answers.
This draft is complete in scope (coverage) but any step wording not backed by learning-file
knowledge is NOT yet trusted — the MCP pass validates it against the real application.

Coverage (WHAT to verify) comes from the requirements and specs — never from implementation
files (no reading components, templates, or services to decide coverage). The learning file
informs HOW (navigation, preconditions, data), never WHAT.

## Universal interaction patterns

Check which patterns apply to the feature. Apply ONLY relevant ones. Document which were
applied and which skipped (with reason) in the output header.

| Pattern | Rule | Applies to |
|---------|------|------------|
| **P1 — Reveal first** | Hidden or collapsed UI must be explicitly opened and confirmed visible before interacting with it | Collapsible panels, drawers, modals, expandable sections |
| **P2 — Async wait** | If a control depends on a response from another control, wait for population to complete. Confirm loading appeared then cleared. | Cascading dropdowns, dynamic lists, dependent fields |
| **P3 — Explicit trigger** | Selections alone do NOT commit changes. Submit, apply, save, or confirm must be its own step, followed by load-then-clear confirmation. | Any commit-before-update flow |
| **P4 — Navigation matches state** | Use the navigation type that matches state architecture. A tab switch within the same page preserves state; a full-page navigation resets it. | State persistence test cases |
| **P5 — Page-load precondition** | Every test case must declare the view is fully loaded before any interaction: no overlay, no spinner, content visible. | Every test case that loads a screen |

## Automation-friendliness — the full user journey rule

A Manual TC must read as a complete, executable user journey. Vague steps are the main cause of
downstream automation failure. BAD:

```text
Open the KPI page. Apply the required filter. Verify the result.
```

GOOD (every hop, precondition, selection, and trigger explicit):

```text
Login as Strategy Super Admin ({exact username})
Open Strategies
Open the required strategy
Open KPI Details
Open the Filter panel
Set Display Type to Year
Select 2026
Click Apply — confirm loading appears on the grid, then clears
Verify the KPI row (Data Oracle: ...)
```

If the draft cannot state the journey at this resolution, that step is a GAP — record it for
the MCP-pass discovery list instead of papering over it.

## Step quality — 4-field handoff contract

Every step MUST provide all four fields (the human reviewer AND the automation agent both
depend on them):

| Field | Requirement |
|-------|-------------|
| **Action verb** | navigate, click, select, type, wait, assert |
| **Logical target** | Human-readable element name with the display label in every required locale |
| **Value / outcome** | Exact value entered or selected, or the condition being verified |
| **Locale note** | State explicitly if text or layout differs between locales |

BAD: "User fills the form and submits." / "Verify the result."
GOOD: "Click the Save button — confirm the button label reads 'Save' in English and its exact
Arabic label in Arabic. Assert the confirmation message appears with the correct text in each
language."

## Inline assertions

Do NOT save all assertions for the end. Every significant step needs an immediate result:

| After this action... | Assert this immediately |
|---------------------|------------------------|
| Navigation | Correct screen or page title is visible |
| State-changing click | Change is visible on screen |
| Explicit trigger (submit, apply) | Loading indicator appears on the relevant area → clears → content updates |
| Async control population | Loading indicator appears on the control → clears → control is ready with its options |
| Language switch | Page language and text direction change, all labels re-render |
| Mode switch | Visible state matches the new mode |

**Loading indicator assertions** must be TWO explicit steps: (1) confirm the loading indicator
appears on the specific area, (2) wait for it to disappear and confirm the content is ready.
Never combine into one step. Never write "loading appeared" without specifying WHERE.

## Coverage minimums

Every feature MUST cover:
- **Happy path** — at least 1 per acceptance criterion
- **Edge cases** — at least 1 per user-facing input (boundaries, empty states, maximum values)
- **Negative cases** — at least 1 per guarded action

L1 §4 required negative categories (all must be represented, or documented as N/A with
justification):
- Invalid inputs — type, format, length, business rule violations
- Boundary conditions — minimum, maximum, just below minimum, just above maximum
- Missing required inputs — empty, blank
- Unauthorized access — blocked roles
- Error recovery — correct behaviour on failure

Any category with no coverage → flag in the output. Never silently omit.

## Locale coverage

MANDATORY for every test case — one separate entry per locale in `required_locales`, each with
a distinct ID (secondary locale appends "b" to the ID). Each variant MUST:
1. Confirm the page language and text direction BEFORE any interaction
2. Reference element labels by their display text in that locale — never assume labels are
   direct translations
3. RTL variants: confirm right-to-left layout (panels open from the opposite side, content
   alignment, tree indentation direction)
4. Confirm locale-appropriate date and number formats where applicable

(How much of the secondary locale is walked live via MCP is governed by `mcp-pass.md` §4 —
the TC documents still carry full per-locale coverage.)

## Data oracle requirement

MANDATORY for any test case asserting on rendered data (counts, identifiers, percentages,
server-loaded content):
- Cite a named fixture with documented counts and identifier lists, OR a pre-fetched response.
- Format: "Data Oracle: {fixture name} — expected count: {N}, identifiers: {list}"
- Values MUST come from actual test fixtures — never invented. Fixtures recorded in the
  learning file's Test Data section count as documented.
- No documented fixture → BLOCKED for that TC.

"Data should be visible" or "rows are displayed" are NOT acceptable assertions.

## Test-data collection — build the data-item list while you draft

Every TC states its data needs in `Preconditions`, `Data Oracle` and `Shared data`. While
drafting, keep ONE running list of **data items** for the story — this list becomes
`TEST-DATA-{feature}.md` at delivery (`deliverables.md` §2b). For each item record:

- a **plain name** (e.g. `an approved KPI with 12 monthly values`, `a user with the Approver
  role`, `an empty strategy with no objectives`), never a table, fixture-function or class name;
- the **exact values** the TCs need (fields, counts, identifiers, states — the Data Oracle values);
- the **TC-IDs** that use it, and whether several TCs use the **same** item (say "these TCs use
  the same data item"; mention execution order only when one TC really depends on the result of
  another, e.g. TC-B needs the record TC-A creates);
- its **status** — set from evidence only, never assumed:

| Status | Meaning |
|---|---|
| `READY` | The data is confirmed to exist — a learning-file `[type: data]` / `[type: env]` line, or seen live on a listing screen during the MCP pass. |
| `MISSING` | The data is required, WAS checked, and was not found. |
| `IMPOSSIBLE` | The data cannot be created by any available or allowed way (background job only, external system, a role that exists in no environment, a state the app cannot reach). Decided only after the ways below were considered. |
| `UNKNOWN` | Not enough information to confirm — not checked, screen unreachable, no Playwright MCP, story not implemented, or the spec does not say the value. |

An item is never `MISSING` only because it was not checked: no check → `UNKNOWN`.

- the **ways to prepare it** when it is not `READY`. Availability is confirmed, never assumed:

| Way | Use it when |
|---|---|
| `e2e scenario` | **Preferred.** An existing UI flow creates the data — another TC in this set, or a `## Common Flows` entry in the learning file. Name that TC-ID / flow in words. |
| `api` | Only when API-based test-data creation/seeding is **already available** in the project (a learning-file `[type: data]` / `[type: env]` line or a recorded skill 6 setup fixture says so) or **explicitly confirmed** by the project / dev team. Otherwise write `api — to be confirmed`, never "available". |
| `db` | Only when DB-based seeding is already available or explicitly confirmed **and** the QC has the required access. Otherwise `db — to be confirmed`. |
| `set directly` | Only for settings / configuration values that can be changed directly in the app (admin settings, feature toggles). |
| `manual` | When no suitable automated way is available — the QC creates the data by hand. |

A `to be confirmed` way is never the recommended way. Recommended order: `e2e scenario` when a
flow exists → `api` when confirmed → `db` when confirmed and granted → `set directly` for
settings → `manual`.

A TC with no documented fixture is still BLOCKED (Data oracle rule above) — and its data item
is recorded as `MISSING` (checked, absent) or `UNKNOWN` (not checkable) with its ways, so the
reviewer sees how to unblock it.

**Plain English only.** The data-item list — and the file built from it — must stay readable
for QC/QA and PO: no locator names, API endpoint paths, database table or column names,
code / class / function names, implementation details, or credentials. Entities, screens,
roles, values and flows in plain words.

## Test case format

Field names are a frozen contract — skills 5 and 6 parse them. Never rename or drop one.

| Field | Description |
|-------|-------------|
| ID | Screen-prefixed unique identifier. Secondary-locale variant appends "b". |
| Type | happy-path / edge-case / negative |
| Locale | one entry per required locale |
| Requirement | Verified requirement IDs from the requirements source |
| Description | One-sentence summary |
| Preconditions | Page-load state, language, user role (exact username from the combined ask), data state |
| Steps | Numbered — action + element label + value + inline assertion |
| Expected Result | Final outcome — specific, assertable, labels in every required locale |
| Data Oracle | MANDATORY if the TC asserts on data values |
| Smoke | YES / NO — YES only for the critical happy-path journeys that prove the feature is alive (login works, screen reachable, core flow functions). Keep the smoke set small: roughly 10–20% of TCs, at least 1 per screen. Skill 6 runs `Smoke: YES` TCs FIRST behind a failure gate. Mark deliberately — never default everything to YES. |
| Automation Candidate | YES / NO — see automation suitability below |
| Data effect | OPTIONAL — `read-only` / `creates` / `modifies` / `deletes`. Tells skill 6 whether this TC may run in parallel with others (read-only) or must run one after another (it changes data). Leave blank to let skill 6 infer it from the steps. |
| Shared data | OPTIONAL — the fixture, record, or account this TC shares with other TCs, in plain words (e.g. `KPI "Revenue" yearly values`, `single-session admin account`). TCs naming the same shared data run one after another. |
| Validation | draft (set at design time; updated by the MCP pass — see the six states there) |

Do NOT include: selectors, code, attribute names, framework-specific assertions, or any
password. `Data effect` / `Shared data` are plain words only — never table names, fixture
function names, or identifiers from the code.

**Type → run-stage mapping (contract with skill 6):** `happy-path` and `edge-case` TCs run in
skill 6's `@positive` stage; a TC that asserts a rejection, a guard, a validation error or a
blocked role runs in `@negative` — whether it is typed `edge-case` or `negative`. State this
mapping in the document header so skill 6 never has to guess.

## Automation suitability (proposal only — the human decides)

Mark each TC as an Automation Candidate using these heuristics:

| Signal | Marking |
|--------|---------|
| Stable, deterministic UI or API behaviour | YES |
| Core business flow with regression risk | YES |
| Requires visual judgment (layout, colour, aesthetics) | NO — manual preferred |
| Depends on real-time external data with no fixture | NO — environment risk |
| One-time scenario with no regression value | NO — overhead exceeds value |
| Exploratory / discovery-oriented scenario | NO — manual preferred |
| Requirement not implemented yet (`mcp-pass.md` §1) | Defer — mark YES/NO on merit, but note "pending implementation" |

The human reviewer can flip any marking during review.

---

## Existing-TC update — Case 1 replaces the design phase with this

Run the TC writing/normalization phase over the existing set instead of a fresh design. **Every
rule above applies unchanged** (patterns, 4-field steps, inline assertions, coverage minimums,
locale coverage, data oracles, format, automation suitability).

1. **Normalize** every existing TC into the format table above. Preserve original IDs where
   possible; record an ID mapping when renumbering is unavoidable.
2. **Review against the User Story / specification:**
   - Coverage matrix first: AC ↔ REQ-ID ↔ existing TC-IDs → every uncovered AC, negative
     category, or missing locale variant becomes a NEW TC.
   - Duplicates / redundant TCs → merge or remove.
   - Incorrect or outdated TCs (steps, labels, expected results contradicting the current
     spec) → update.
   - Unchanged, still-correct TCs → keep.
3. **Log every disposition** in the Existing-TC Analysis table (kept / updated / merged /
   removed / new, with reason) — included in the deliverable and in the HTML review page.
4. Then **continue automatically** to the MCP pass (gated by its §1) and the self-review — the flow does not
   pause between the writing phase and the review phase.
