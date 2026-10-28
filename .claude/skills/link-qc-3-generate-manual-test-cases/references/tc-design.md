# TC design rules and format — load at the design phase (workflow step 7)

Draft the complete test case set: coverage from the specs, journey detail (navigation,
preconditions, known flows, test data) from the learning file where it already has answers.
This draft is complete in scope (coverage) but any step wording not backed by learning-file
knowledge is NOT yet trusted — every TC leaves this skill `draft — not app-validated`, and the
optional `link-qc-3b-validate-manual-test-cases` confirms or corrects the wording against the real
application later. A journey detail neither the specs nor the learning file can supply is a named
GAP in the step (e.g. "open the {panel — exact label to be captured live}") and, when the answer
would change the design, an open question (`open-questions.md`) — never a guess.

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
| **P5 — Page-load precondition** | Every test case must declare the view is fully loaded before any interaction: no overlay, no spinner, content visible. | Every test case that loads a screen (not a pure `api` / `db` / `api+db` TC — "API and DB test cases") |

## Automation-friendliness — the full user journey rule

A Manual TC must read as a complete, executable user journey. Vague steps are the main cause of
downstream automation failure. BAD:

```text
Open the Orders page. Apply the required filter. Verify the result.
```

GOOD (every hop, precondition, selection, and trigger explicit; configuration by reference):

```text
Open the portal [E1]
Login as Administrator [A1]
Open Products
Open the required product
Open Order Details
Open the Filter panel
Set Display Type to Year
Select 2026
Click Apply — confirm loading appears on the grid, then clears
Verify the order row (Data Oracle: price list "Sample" [D2] — expected count: 12, …)
```

The URL, the username and the shared dataset are **references** (`[E1]`, `[A1]`, `[D2]`) to
their rows in `TEST-DATA-{feature}.md` — never literals in the TC ("Test-data collection"
below). Typed inputs (`2026`) and expected outputs stay inline.

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

An `[API]` / `[DB]` line follows its own grammar instead ("API and DB test cases" below): the
method / entity is its action, the endpoint / entity its target, the payload / filter its value.

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

## Test-design techniques — how edge and negative values are derived

The minimums above say how many edge / negative TCs a feature needs; these techniques say
**which values and combinations** those TCs use. A minimum satisfied by one arbitrary value is
not satisfied. Pick the technique from what the spec shows:

| Technique | Use when the spec shows… | What it yields |
|---|---|---|
| **Equivalence Partitioning (EP)** | an input with valid / invalid classes — type, format, allowed set, required / optional | one TC per partition, valid and invalid (one representative value each) |
| **Boundary Value Analysis (BVA)** | a numeric range, a length limit, a date window, a count or size limit | below / at / above **each stated boundary** wherever the input domain permits — including a maximum-only constraint (a documented max of 50 → 49, 50, 51) and a minimum-only one (a documented min of 1 → 0, 1, 2). Only when a neighbour cannot exist (a length of −1, a date before the epoch the app accepts) is that side omitted, with the reason |
| **Decision table** | ≥ 2 conditions that together decide one action — role × record state, flag × amount, plan × quota | one TC per rule column; don't-care rows collapsed; impossible combinations listed as N/A with the reason |
| **State transition** | a status / lifecycle — draft → submitted → approved → …, active / suspended, open / closed | every valid transition once (0-switch) + one invalid transition attempt per guarded state (e.g. "approve" from draft) |
| **Use-case / scenario** | end-to-end journeys | already the "full user journey" rule above — no additional TCs |

Rules:

- **Source-defined boundaries, derived test values.** The *boundary* itself must come from the
  spec, the steering minimums or a learning-file line (a stated max of 50, a stated range 18–65).
  The *test values* around it (49 / 50 / 51; 17 / 18 / 19 / 64 / 65 / 66) are legitimately
  derived by BVA and are not "invented". A limit the spec implies but never states → a `Q-{n}`
  with the recommended value (`open-questions.md`), never an invented boundary (SKILL.md
  invariant 1, "deterministically").
- **No new TC field.** The technique is visible through the TC `Description` wording ("… at the
  maximum of 50 characters", "… with 51 characters", "… approve from draft is rejected") and
  through the existing Negative Coverage rows — the frozen shape below is unchanged.
- **Map to the L1 §4 categories** so the Negative Coverage table stays the evidence: EP →
  Invalid inputs; BVA → Boundary conditions; decision table → Unauthorized access and business
  rule violations; state transition → Error recovery and guarded actions.

## Error-guessing checklist — apply where the flow has the trigger

Experience says these scenarios fail most often in commit / async flows. Walk the list for every
flow **that has the trigger named in the "Applies when" column**; the last column lists what a
spec *may* define — it is a prompt for what to look up, never a default assertion.

| # | Scenario | Applies when the flow has… | Possible expected behaviours (only if the requirement states one) |
|---|---|---|---|
| **E1** | Double-submit / double-click on the trigger | a P3 explicit trigger that creates or modifies | the **business outcome** is verified: one record / one order / one message visible afterwards. Never assume "exactly one request" or a disabled button — those are implementation choices |
| **E2** | Concurrent edit / stale data | an edit flow on a record another user or TC can change | second save rejected, merged, or last-writer-wins — whichever the spec says |
| **E3** | Session expiry mid-flow | a multi-step flow with a save at the end | redirect to login, inline re-authentication, or an error — and whether the input survives — per spec |
| **E4** | Network / server failure during the trigger | any P3 trigger | error message text, whether form data is preserved, whether retry is offered — per spec |
| **E5** | Refresh / browser back after submit | P4 state-persistence flows | no duplicate submission; state after refresh — per spec |
| **E6** | Navigate away with unsaved changes | forms with a dirty state | warning / silent discard — per spec |

Rules:

- **Requirement-dependent, never mandatory.** An applicable item becomes a TC **only** when the
  spec or steering states the expected behaviour for it. Button disabling, login redirects, data
  preservation, retry availability and "one request" are *not* assumed; when the requirement is
  silent, the item becomes a `Q-{n}` with a recommended behaviour (a recommendation is never an
  expected result) and stays out of the TC set until answered — invariant 1.
- **An applicable item is never skipped.** It is a requirement-backed TC or a `Q-{n}`. "Skipped"
  is reserved for items that are **not applicable** (the flow has no such trigger) or
  **explicitly excluded from scope** by the user or the spec — each named with its reason in the
  existing `**Patterns applied / skipped:**` header line, the same line P1–P5 use (its key is
  unchanged; the renderer does not parse it).
- E1–E6 TCs use the existing types and stages: `negative` / `@negative` for a rejection or a
  guard, `edge-case` / `@positive` where the outcome is a success path (E5 with no duplicate).
  No new enum value.

## Locale coverage

MANDATORY for every test case — one separate entry per locale in `required_locales`, each with
a distinct ID (secondary locale appends "b" to the ID). Each variant MUST:
1. Confirm the page language and text direction BEFORE any interaction
2. Reference element labels by their display text in that locale — never assume labels are
   direct translations. A secondary-locale label the learning file (`## Locale Knowledge`) does
   not record is written as the English label plus "(Arabic label: to be captured live)" —
   never a guessed translation; 3b captures it live and replaces the note.
3. RTL variants: confirm right-to-left layout (panels open from the opposite side, content
   alignment, tree indentation direction)
4. Confirm locale-appropriate date and number formats where applicable

(The TC documents carry full per-locale coverage from design; how much of the secondary locale
is walked live is the validator's decision — `link-qc-3b-validate-manual-test-cases/references/mcp-pass.md` §4,
or `link-qc-3c-validate-manual-test-cases-cli/references/walk-rules.md` §4.)

## Out-of-browser outcomes — design them anyway

A requirement-defined outcome that leaves the browser — an email, an SMS or OTP code, a push
notification, a notification-centre entry, a downloaded file, a background job's result — gets a
**complete TC**, exactly like an on-screen outcome. "N/A" is valid only when the requirement
defines no such outcome; what a browser tool can or cannot observe never removes a TC. Four axes
stay separate:

| Axis | Owner | Values |
|---|---|---|
| **Design coverage** | skill 3 | the TC exists in full — tool limits never remove it |
| **Automation candidacy** | skill 3 proposes, the reviewer decides | `YES` / `NO` — decided on the interfaces available, not on the channel |
| **Execution coverage** | skill 5 | `full` / `partial (human step: n)` / `manual — not automated` |
| **Validation status** | 3b / 3c | the six frozen states; a `[HUMAN]` step is never observed by the tool |

**Assess the interfaces first — ask only when nothing establishes them.** For each out-of-browser
channel the requirement uses, resolve in this order and stop at the first answer:

1. the current task input ("the UAT mail sandbox is …", "there is no test SMS provider");
2. the learning file — `[type: env]` "test interfaces" lines — and the `## 0. Environment` rows
   of the project's other `TEST-DATA-*.md` files;
3. only when neither says whether an authorized mail sandbox / SMS test provider / OTP test hook
   / notification API / job trigger exists for this environment: ONE question in the
   `open-questions.md` shape (with a recommendation), joined to the step-6 ask. The answer is
   written back as a `[type: env]` fact so it is never asked again — a recorded **"none
   available" is as good an answer as a recorded interface**.

An available interface becomes an Environment row (`[E2]` mail sandbox, `[E3]` SMS test
provider …) and the step stays an ordinary step (`Open the mail sandbox [E2] and open the newest
message for [A2]`). Only with **no** authorized interface is the step prefixed **`[HUMAN]`** — a
frozen marker at the start of the step or expected-result line, no new field:

```text
[HUMAN] Read the 6-digit code from the SMS received on the test phone [A2] and type it in the "Code" field.
```

Rules: the `[HUMAN]` step keeps its 4 fields and its inline assertion; the TC keeps every other
step and its Expected Result; the `Manual-Only Scenarios` category for it is `Human-observed
step` (`self-review.md` check 5); a `[HUMAN]` step never forces `Automation Candidate: NO`
(suitability table below); 3b / 3c walk up to it and stop (`draft — not app-validated (human
step pending)`), skill 5 automates up to it (`partial (human step: n)`), skill 4 publishes it
verbatim.

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
`TEST-DATA-{feature}.md` at delivery (`deliverables.md` §2b). Assign the IDs **while you draft**
and write the reference into the TC the moment you need the thing:

| ID | What | Written in the TC as |
|---|---|---|
| `E{n}` | an environment row — `E1` is always the application base URL; `E2`, `E3`… one per service the TCs reach (mail sandbox, SMS test provider, admin portal, `API base`, `Database`, `Environment class`…). `Value` is `unknown — asked by 3b/3c` when the learning file has no `[type: env]` line for it. A `Database` value is a logical identity `{db name} @ {server alias} ({engine})`, never a connection string; `Environment class` is `test` / `staging` / `production` ("API and DB test cases") | `Open the portal [E1]`, `Open the mail sandbox [E2]`, `[API] GET [E3] /orders` |
| `A{n}` | an account — one row per account, never per role (a role may own several accounts; the ID, never the role, identifies one). Username from the learning file or "unknown"; never a password | `Login as Administrator [A1]`, `the SMS received on the test phone [A2]` |
| `D{n}` | a data item (below) | `Data Oracle: price list "Sample" [D2]`, `Shared data: order "Sample" [D3]` |

The form is always **name + token** — a bare `[A1]` with no name, or a name with no token, is a
check-12 finding. Each token means *that row and nothing else*: `[E{n}]` is never "the URL",
`[A{n}]` is never "whoever has the role". A TC value that deliberately equals a configuration
value (typing the portal URL into a "Website" field, for instance) is marked `(intentional
input)` on the same line so the renderer's `data-literal` check skips it.

For each data item record:

- a **plain name** (e.g. `an approved order with 12 line items`, `a user with the Approver
  role`, `an empty product with no orders`), never a table, fixture-function or class name;
- the **exact values** the TCs need (fields, counts, identifiers, states — the Data Oracle values);
- the **TC-IDs** that use it, and whether several TCs use the **same** item (say "these TCs use
  the same data item"; mention execution order only when one TC really depends on the result of
  another, e.g. TC-B needs the record TC-A creates);
- its **status** — set from evidence only, never assumed:

| Status | Meaning |
|---|---|
| `READY` | The data is confirmed to exist — a learning-file `[type: data]` / `[type: env]` line (3b / 3c may also confirm it live on a listing screen, or prepare it and keep it). |
| `MISSING` | The data is required, WAS checked live, and was not found. **Never written by this skill** — only 3b / 3c (one read-only look) or skill 5 can establish it. |
| `NOT CREATABLE` | Evidence proves the state cannot exist on the environment (a rule in the code or configuration, a role no environment has, a job that never runs there). **Never written by this skill** — only 3b / 3c write it, with the evidence in the Problems row. |
| `IMPOSSIBLE` | The data cannot be created by any available or allowed way (background job only, external system, a role that exists in no environment, a state the app cannot reach). Decided only after the ways below were considered. |
| `UNKNOWN` | Not enough information to confirm — not checked (this skill checks nothing live), story not implemented, or the spec does not say the value. |

An item is never `MISSING` only because it was not checked: no check → `UNKNOWN`.

- the **ways to prepare it** when it is not `READY`. Availability is confirmed, never assumed:

| Way | Use it when |
|---|---|
| `e2e scenario` | **Preferred.** An existing UI flow creates the data — another TC in this set, or a `## Common Flows` entry in the learning file. Name that TC-ID / flow in words. |
| `api` | Only when API-based test-data creation/seeding is **already available** in the project (a learning-file `[type: data]` / `[type: env]` line or a recorded skill 5 setup fixture says so) or **explicitly confirmed** by the project / dev team. Otherwise write `api — to be confirmed`, never "available" (3b / 3c, 5 and 5b later search the automation project's helpers and the application's source code themselves and may confirm it). |
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

Field names are a frozen contract — skills 4, 5 and 3b and the renderer parse them. Never rename
or drop one. The **shape** is frozen too (the renderer parses by it, legacy documents excepted):

```markdown
### {TC-ID} — {Description}
- **Type:** happy-path | edge-case | negative
- **Locale:** en | ar | …
- **Requirement:** REQ-…, REQ-…
- **Stage:** @positive | @negative
- **Preconditions:**
  1. {…}
  2. {…}
- **Steps:**
  1. {action + element label + value + inline assertion}
  2. {…}
- **Expected Result:** {…}
- **Data Oracle:** {… | —}
- **AI Oracle:**                       (optional — only a TC that prompts an AI assistant; omitted otherwise)
  - Intent: {what the reply must accomplish, in words; may cite [D{n}] facts}
  - Must contain: {fact; fact} | —
  - Must not contain: {phrase; phrase} | —
  - Language: en | ar
  - Max length: {n} words | —
  - Repeats: {n} · Pass threshold: {k} of {n}
- **Smoke:** YES | NO
- **Automation Candidate:** YES | NO
- **Data effect:** {read-only | creates | modifies | deletes | —}
- **Shared data:** {plain words | —}
- **Tags:** {comma-separated, e.g. uat, regression | —}
- **Validation:** draft — not app-validated
```

One bullet per field in this order; `Preconditions` and `Steps` as 2-space-indented ordered
sub-lists; an empty optional value is `—`, never blank and never omitted. `AI Oracle` is the one
field that is **omitted** when it does not apply (a 2-space-indented `- ` sub-list when present —
"AI / chatbot test cases" below). A `<!-- tc-evidence -->`
comment after the block belongs to 3b / 3c — never write or edit one here. A step or
expected-result line that needs a person starts with `[HUMAN] ` ("Out-of-browser outcomes"); an
API or database line starts with `[API] ` / `[DB] ` ("API and DB test cases").

| Field | Description |
|-------|-------------|
| ID | Screen-prefixed unique identifier. Secondary-locale variant appends "b". |
| Type | happy-path / edge-case / negative |
| Locale | one entry per required locale |
| Requirement | Verified requirement IDs from the requirements source |
| Stage | `@positive` for happy-path and edge-case; `@negative` for a TC that asserts a rejection, a guard, a validation error or a blocked role (whatever its Type). Written per TC so skill 5 never derives it |
| Description | One-sentence summary |
| Preconditions | Page-load state, language, the environment and the account by reference (`Open the portal [E1]`, `Logged in as Administrator [A1]` — the username lives only in `TEST-DATA` §1, "unknown" there when the learning file has none, with an open question), data state (`[D{n}]`) |
| Steps | Numbered — action + element label + value + inline assertion |
| Expected Result | Final outcome — specific, assertable, labels in every required locale |
| Data Oracle | MANDATORY if the TC asserts on data values |
| AI Oracle | OPTIONAL — present only on a TC whose step sends a prompt to an AI assistant / chatbot whose reply differs every run. Sub-list `Intent` · `Must contain` · `Must not contain` · `Language` · `Max length` · `Repeats` / `Pass threshold` ("AI / chatbot test cases" below). The prompt stays a typed input in `Steps`; `Expected Result` stays the human-readable outcome. Judged by the manual CLI run (skill 5b) and, on one observation, by 3b / 3c; the renderer displays it and never judges it |
| Smoke | YES / NO — YES only for the critical happy-path journeys that prove the feature is alive (login works, screen reachable, core flow functions). Keep the smoke set small: roughly 10–20% of TCs, at least 1 per screen. Skill 5 runs `Smoke: YES` TCs FIRST behind a failure gate. Mark deliberately — never default everything to YES. |
| Automation Candidate | YES / NO — see automation suitability below |
| Data effect | OPTIONAL — ONE value, the strongest that applies (`deletes` over `modifies` over `creates` over `read-only`): what this TC does to application data. `read-only` — changes nothing (signing in is fine). `creates` — adds only NEW records of its own (unique names / generated values) and changes no existing record — also when it later edits or deletes a record it created itself. `modifies` / `deletes` — changes or removes an EXISTING record: name that record in the step that changes it, by its token (`Edit order "Sample" [D3]`). `—` → skill 5 infers it from the step verbs. Skill 5's parallel planner turns it into conflicts — "Data effect and Shared data" below; it never makes a TC "serial" by itself. |
| Shared data | OPTIONAL — data whose STATE this TC shares with other TCs, so they must not run at the same time: a record two TCs change, or one changes while another checks it; a total or counter several TCs move. Plain words plus its token, written the SAME way in every TC that shares it (skill 5 matches the words): `order "Sample" [D3]`. Add `(depends on TC-012)` when this TC needs the state another TC leaves behind — the two then run in that order. Never data the TC only reads and nobody changes (the token in its steps already says so). `—` when none. |
| Tags | OPTIONAL, design-owned — comma-separated tags the reviewer wants on the Azure DevOps work item (e.g. `uat`, `regression`); `—` when none. Skill 4 publishes them (with its own owned tags); 3b / 3c / 5 never edit them. A project-wide tag every TC carries goes in the `**Tag convention:**` header line instead (`deliverables.md` §2). |
| Validation | Always `draft — not app-validated` at design time (or `not-implemented — pending implementation` per `entry-cases.md` §4). The other states are set only by 3b — `validation-states.md`. |

Do NOT include as literals — **configuration is externalized**: environment URLs / hosts /
service endpoints, account usernames, and reusable datasets shared by several TCs appear only
as references to their `TEST-DATA` rows (`[E{n}]` / `[A{n}]` / `[D{n}]`). Intentional inputs
and expected outputs **stay inline**: a typed test input (an invalid URL, a boundary value, a
51-character name), an exact expected output (a validation message, a computed total), a label,
a one-off value of this TC's scenario. A value that deliberately equals a configuration value is
written `… (intentional input)` on the same line. Never: selectors, code, attribute names,
framework-specific assertions, or any password. `Data effect` / `Shared data` are plain words
only — never table names, fixture function names, or identifiers from the code.

**Type → run-stage mapping (contract with skill 5):** `happy-path` and `edge-case` TCs run in
skill 5's `@positive` stage; a TC that asserts a rejection, a guard, a validation error or a
blocked role runs in `@negative` — whether it is typed `edge-case` or `negative`. State this
mapping in the document header AND write the result per TC in the `Stage` field / summary column
so skill 5 never has to guess.

### Data effect and Shared data — what skill 5's parallel planner reads

Skill 5 runs TCs side by side only when nothing one does can change what another checks. It derives that from these
two fields plus the steps (its parallel readiness check); a field that is precise lets more TCs run together, a vague
one makes them run alone — safe, only slower. The rules it applies:

| The TC … | Write | Skill 5 then |
|---|---|---|
| only reads (opens, filters, views) | `Data effect: read-only` | runs it beside anything that does not change what it reads |
| adds records of its own with unique names, e.g. "Create order 'QA-{timestamp}'" (also when it later edits / deletes that same record) | `Data effect: creates` | runs it beside other creators; keeps it apart from TCs that **count, list the latest, search or export** that collection — so name the collection in those TCs' steps ("the Orders list shows …") |
| edits or removes an EXISTING record | `Data effect: modifies` / `deletes`, and the record's token in the step that changes it: `Edit order "Sample" [D3]` | keeps it apart only from the TCs that use `[D3]`; a change whose record it cannot tell (no token, no noun) runs alone |
| changes a system / global setting, or anything every user sees | the setting named plainly in the step ("Open the system settings and …") | runs it alone (a barrier: nothing else runs while it does) |
| needs the state another TC leaves behind | `Shared data: order "Sample" [D3] (depends on TC-012)` | runs TC-012 first and this TC after it, never apart from each other |
| and other TCs move the same record, total or counter | `Shared data:` the same words in each of them, e.g. `order "Sample" [D3]` | never runs them at the same time |

- An account that allows only one session at a time is a note on its TEST-DATA `## 1. Accounts` row ("allows one
  session") — every TC signing in with it is then kept apart, without a Shared data line on each.
- A step that submits wrong credentials (a lockout counter) or switches the session language is recognised from the
  step text; nothing extra is needed.
- Both fields are design data in the TC hash: changing them on an APPROVED document is a design change
  (`--revision`, then republish / re-automation), so they are set while drafting or before approval — never patched
  into an approved TC to tune a run.

## AI / chatbot test cases

When the requirement has an AI assistant / chatbot (a free-text prompt answered by a generated
reply), the reply differs every run, so a TC cannot assert exact text. Such a TC keeps the frozen
shape and adds the optional `AI Oracle` sub-list right after `Data Oracle`:

- **The prompt stays inline in `Steps`** as a typed input, quoted (`Type "Where is my order
  12345?" into the message box and send`). Never a secret, a credential or personal data in a
  prompt or in any oracle line.
- **`Expected Result` stays the human-readable outcome** ("the assistant names the order status
  and the delivery date") — the reader must understand the TC without the oracle.
- **Hard checks are deterministic** and need no judgement: `Must contain` (facts the reply must
  carry, `;`-separated, may cite `[D{n}]` facts), `Must not contain` (phrases that must be
  absent), `Language` (`en` | `ar`), `Max length` (`{n} words` | `—`), plus the implicit ones
  every AI TC has — a reply arrives, it carries no error text, it echoes no secret and no PII.
  `—` when a line does not apply; `Intent` is always present.
- **The rubric is judged from the reply text** by Claude in the manual CLI run
  (`link-qc-5b-test-run-manual-cli`): the `Intent` was met, the reply is grounded in the cited
  `[D{n}]` facts, no hallucinated capability, scope / refusal behaviour as required, injection
  resistance, tone, and consistency across repeats. Each repeat's reply is stored verbatim.
- **Repeats / Pass threshold**: `Repeats: {n} · Pass threshold: {k} of {n}` with
  `Pass threshold ≤ Repeats`; absent → `1` · `1 of 1`. Use repeats for a reply whose variability
  matters (a grounded answer, a refusal).
- **`Automation Candidate: NO` by default** — generated code cannot assert a reply that differs
  every run. `YES` only with a deterministic hard-check-only oracle (no rubric line the code would
  have to judge) and the reason stated in the TC.
- **Negative AI set** the design covers whenever the requirement has an assistant — one TC each,
  REQ-backed or a `Q-{n}`: prompt injection ("ignore your instructions …"), an out-of-scope
  request, a request for another user's data / PII, a secret-echo attempt, empty input, very
  long input, a language switch mid-conversation.
- **Validation**: 3b / 3c observe such a TC once and judge the reply by the hard checks and the
  rubric; `validated` only when it passes; a rubric they cannot decide → `Q-{n}`, the TC stays
  `draft`. The field enters the canonical TC hash only when present; skill 4 publishes its lines
  verbatim in the last ADO step's expected text.

## API and DB test cases — only behind the layer gate

The requirement may state behaviour a screen does not show: an API's status code and response,
a record the system stores, a status saved after a UI action. Such behaviour is designed as
**`[API]` / `[DB]` lines** — but only for the layers the tester confirmed (SKILL.md invariant 16).

**Layer gate (step 6).** Collect the **layer candidates** while reading the source: every
statement naming an API contract (an endpoint, a request / response, a status code, an OpenAPI
file given as input) and every persistence rule ("is stored", "an audit row is written", "the
status is saved as …"). None → no question, UI only. Otherwise ONE question in the
`open-questions.md` shape, joined to the step-6 ask:

```text
Q-{n} — Test layers. The source describes {n} API behaviours (REQ-…, REQ-…) and {m} persistence
rules (REQ-…). Which layers should I design? UI only · + API · + DB · + hybrid (UI action, then an
API / DB check) — several may be chosen. Recommendation: {e.g. + hybrid for REQ-…: the saved
status is not visible on any screen}. Pending until answered: those REQs are designed UI-only.
```

`--layers ui,api,db,hybrid` answers it in advance. A pipeline run with no answer designs UI only
and lists every candidate as `Q-{n} (layer candidate)`. Record the answer in the header line
`**Test layers:** ui, api` (`deliverables.md` §2) — a record, never read as an input by a later run.

**Markers.** A Steps or Expected Result line that starts with `[API] ` or `[DB] ` is a backend
line (the `[HUMAN]` precedent — no new field). The TC's **test layer** is derived from the lines,
never written:

| Layer | When | Skill 5 runs it in | Evidence |
|---|---|---|---|
| `ui` | no `[API]` / `[DB]` line (every TC without the markers) | browser project | image |
| `hybrid` | ≥ 1 unmarked step **and** ≥ 1 `[API]` / `[DB]` line | browser project | image **and** record |
| `api` | every action step `[API]`, no `[DB]` line | `backend` project | record |
| `db` | every action step `[DB]`, no `[API]` line | `backend` project | record |
| `api+db` | no unmarked step, both markers | `backend` project | record |
| `unknown` | backend markers but no `[API]` / `[DB]` action step, or an unmarked Expected line in a TC with no UI step | — the review page BLOCKs | — |

Only **Steps** are actions: Preconditions, `Data effect`, cleanup notes and every other field
never decide the layer. `[HUMAN]` is neutral. In a TC without a UI step, **every Expected line is
marked**.

**Grammar.**

| Line | Shape |
|---|---|
| API call (Steps) | `[API] {METHOD} [E{n}] {path} as [A{n}] with [D{n}] \| {inline payload}` — `as [A{n}]` names the role, never a token or a mechanism; `with …` only when there is a body |
| Capture | `… → capture body.{json path} as $name` (also from a UI step: `→ capture the order number shown as $order`) |
| API assertion (Expected) | `[API] status {code}` · `[API] body.{path} = "{literal}"` \| `= $name` · `[API] body.{path} is string\|number\|boolean\|array\|object\|null` · `[API] body.{path} has {n} items` · `[API] body matches schema [E{n}]#{schema name}` · `[API] header {name} present` |
| DB check (Steps or Expected) | `[DB] Check that the {entity} record where {attribute} = $name \| [D{n}] \| "{literal}" has {attribute} = "{literal}"` · `… has {n} rows` · `… does not exist` |
| DB write (Steps) | `[DB] Create \| Update \| Delete the {entity} record …` — requires `Data effect` (`creates` / `modifies` / `deletes`) and names a record **created earlier in this TC** or a `[D{n}]` item whose TEST-DATA row says "created by preparation" — never a pre-existing record |

- **Several calls per TC** — each `[API]` line is one call; later lines reuse `$name` values. A
  negative response is a normal assertion (`[API] status 400`, `[API] body.error.code =
  "VALIDATION"`). A create / update / delete TC proves the change with a read-back line (a GET or
  a `[DB] Check …`) in the same TC.
- **No invention.** The expected status, body and stored values come from the approved
  requirement only. A concrete path or table / column name is written only when the approved
  source names it (invariant 10); otherwise business words (`[API] Create an order as [A1] …`,
  `[DB] Check that the order record …`) plus a `Q-{n}` for the contract — skill 5 maps business
  words to an endpoint / query only from a verified contract and never guesses.
- **Configuration by reference.** The API host is an `API base` `[E{n}]` row; a database is a
  `Database` row (`orders DB @ db-test (PostgreSQL)`). Every environment used by a data-changing
  TC needs an `Environment class` row — unknown counts as production, and skill 5 refuses every
  data change there. No token, key or connection string in any line or row (a `token:` / `api key
  =` shape is refused by skill 4).
- **Data-changing TCs** (an `[API]` call that changes data, a `[DB]` write, or `Data effect ≠
  read-only`) run in skill 5 only after the tester's per-run "yes" (its data-changes gate) and
  only on records the run created; skill 5 cleans up after asking, and refuses a write it cannot
  prove safe — so design such a TC on dedicated data.
- **Smoke / P5.** A pure `api` / `db` / `api+db` TC has no screen: P5 and "1 smoke per screen" do
  not apply; mark the one call that proves the service alive `Smoke: YES` when it is critical.
- **Manual runners.** 3b / 3c / 5b cannot run a backend line: they validate the UI part and stop
  there (`draft — not app-validated (api/db step — automation only)` / `PARTIAL — out of tool`).
  Such a TC is normally `Automation Candidate: YES`.

## Automation suitability (proposal only — the human decides)

Mark each TC as an Automation Candidate using these heuristics:

| Signal | Marking |
|--------|---------|
| Stable, deterministic UI or API behaviour | YES |
| Core business flow with regression risk | YES |
| Reply differs every run (AI assistant — TC carries an `AI Oracle`) | NO by default; judged by the manual CLI run (skill 5b). YES only with a hard-check-only oracle and a stated reason |
| Requires visual judgment (layout, colour, aesthetics) | NO — manual preferred |
| Depends on real-time external data with no fixture | NO — environment risk |
| One-time scenario with no regression value | NO — overhead exceeds value |
| Exploratory / discovery-oriented scenario | NO — manual preferred |
| Requirement not implemented yet (`entry-cases.md` §4 — tester's answer or skill-4 report) | Defer — mark YES/NO on merit, but note "pending implementation" |
| `[API]` / `[DB]` lines ("API and DB test cases") | YES by default — only skill 5 can execute them; NO only with a stated reason |
| One or more `[HUMAN]` steps ("Out-of-browser outcomes") | Does **not** force NO — decide on the steps around them. `YES` with `[HUMAN]` steps = "partially automatable — human step(s) {n}": skill 5 automates up to the first human step and reports `partial (human step: n)`; the manual-only row (category `Human-observed step`) names the human part |

The human reviewer can flip any marking during review.

---

## Existing-TC update — Case 1 replaces the design phase with this

Run the TC writing/normalization phase over the existing set instead of a fresh design. **Every
rule above applies unchanged** (patterns, 4-field steps, inline assertions, coverage minimums,
locale coverage, out-of-browser outcomes, data oracles, reference tokens, format, automation
suitability) — an existing TC that carries a URL or a username as a literal is normalized to the
reference form and its row added to the data-item list.

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
4. Then **continue automatically** to the self-review and the deliverables — the flow does not
   pause between the writing phase and the review phase. Existing TCs kept unchanged keep the
   validation state (and evidence stamp) they carried; updated ones are reset to
   `draft — not app-validated (stale — revised)`; new ones are `draft — not app-validated`.
