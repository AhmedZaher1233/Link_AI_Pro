# Test-data resolution — look, decide, prepare, verify, close by evidence, ask once (steps 4, 8b, 9)

This pass fills `TEST-DATA-{feature}.md` beyond the statuses: for every data item it decides
**how the item is handled** — from evidence first, from the user only for what evidence cannot
settle — gives it a priority, **prepares a missing item itself** through the first available way
(a UI journey driven through the Playwright MCP, the automation project's own helper, an endpoint read from
the application's source code, or the database — each under the consent its way needs), verifies
it on its oracle before any dependent is walked, and closes the test-data questions that evidence
turned into facts. It never adds a §2 column or a way name (`e2e scenario` / `api` / `db` /
`set directly` / `manual`); the status words are `READY` / `MISSING` / `IMPOSSIBLE` / `UNKNOWN`
(skill 3's) plus `NOT CREATABLE`, written only by 3b / 3c; skill 3 still owns the item list and the
`Data item` / `Must look like` / `Used by TCs` cells (skills 4 and 5 hash them); skill 5 reads the
result as the starting inventory of its readiness gate. The one read-only look per item and the
advanced-facts rule stay in `patch-rules.md` §3 — this file is what happens **after** the look.

The two `SHARED-3B-3C` blocks below are byte-identical in
`link-qc-3c-validate-manual-test-cases-cli/references/test-data-resolution.md`; the twelve
principles and the consent table also appear word for word in skill 5's PHASE 2.6 and skill 5b's
`references/test-data-preparation.md`. Edit every copy together.

<!-- SHARED-3B-3C BEGIN principles -->
## P. Test-data preparation — the twelve principles

`{env}` is the target environment, `{item}` a data item (`D{n}`), `{entity}` the record type it
needs, `{automation_root}` the automation project (`paths.automationRoot` of
`Testing/qa-manifest.json`, fallback `Testing/Automation`).

1. **Discover before skipping.** For every `MISSING` / `UNKNOWN` item, look for an existing way to
   create it, in this order: (1) the learning file's `[type: data]` / `[type: env]` lines and
   recorded decisions; (2) the automation project's test-data helpers — the manifest paths first,
   then a search for create / seed / fixture / factory / pre-request / setup modules and API
   clients under `{automation_root}`; (3) the application's own create endpoints, read from its
   source code when the repository holds it (skill 10's `.project-profile.md` first when present,
   otherwise routes / controllers / API definitions outside `{automation_root}` and `Testing/`);
   (4) a UI setup journey — a creating TC of this set, a learning-file common flow, a creation
   screen seen live; (5) a database helper the project already has; (6) manual. Record where each
   way was found. A way is **available** only when existing code, a screen seen live or a recorded
   decision proves it; API documentation alone stays `to be confirmed`.
2. **The skill prepares the item itself, with the consent its way needs.** It never asks the QC to
   run a script, a seed or an import. A UI journey needs no question; an existing helper runs
   under the run's data-changes "yes"; an endpoint taken from the source code and a database write
   each need an explicit "yes" naming the item — asked ONCE, together, after discovery and before
   the dependents; keep or clean up is asked ONCE after the run. Production named in the
   environment note stops every preparation (stated, never asked).
3. **A temporary seed, never new code in the repository.** The preparation script is composed in
   the session scratch folder, imports the project's own helpers by absolute path, selects `{env}`
   through the project's own mechanism (environment variable, configuration profile or
   command-line flag), is run once, its created identifiers captured, and is then deleted. It
   becomes a reusable fixture only when the QC asks, and then follows skill 5's placement and
   code rules.
4. **Database writes are a separate consent.** The database is used only for a state no API or UI
   can reach, after an explicit "yes" naming the item; only records this run created are touched,
   every write is read back, and no pre-existing record is ever modified.
5. **Dedicated, right-sized fixtures.** Every item gets its own clearly named, isolated parent
   record so items never interfere with each other or with existing data; it is sized to the
   TC's boundary (more rows than the upper limit the TC tests, exactly the count a count TC
   expects); one preparation serves several items only when they are compatible.
6. **Verify before use.** An item is `READY` only after its oracle confirmed it: the screen the TC
   reads, plus a read-only API or database read when the screen hides the value (paginated
   lists, details-only fields). Dependents run, or are walked, only after that verification.
7. **Read back what the system decided.** Values the seed cannot choose — creation or publish
   dates, the current period, generated codes, sequence numbers — are read back, and the
   effective values are used for this run in place of the TC's literal values; every substitution
   is recorded and routed to skill 3 `--revision` when the TC text should change.
8. **Check the real rule, not just the screen.** A permission, visibility or ownership
   precondition is verified against the rule's source as well (code, configuration or database),
   because a list may show everything while the API filters; a TC whose oracle relies on a
   misleading screen is a finding for skill 3, never a reason to skip.
9. **"Not creatable" is its own outcome.** When evidence proves the state cannot exist on `{env}`,
   the item is `NOT CREATABLE` with its evidence (never "data missing"), and the evidence goes to
   the learning file.
10. **A permission-system refusal stops the step.** When the host's permission layer refuses a
    bulk creation, a database write or a credential-bearing command, the skill stops, reports
    exactly what was refused and why, and asks the QC to allow it (a permission rule or a
    one-time approval). It never works around a refusal.
11. **No secrets anywhere.** Credentials stay in the project's existing secret mechanism; they are
    never printed, logged, stored or passed on a command line; token and password lines are
    filtered from every captured output before anything is recorded.
12. **Keep or clean up — asked once, after the run.** Default keep, recorded in the learning file.
    Clean-up only through an existing helper or the UI; everything left behind is listed in the
    final message.

**Consent by way** — the same table in all four skills:

| Way | Found by | Before preparing | After the run |
|---|---|---|---|
| `e2e scenario` — a UI journey (a creating TC of this set, a learning-file common flow, a creation screen seen live) | principle 1 steps 1, 4 | **no question** — prepared automatically, before its dependents; the only guard is production named in the environment note | ONE keep / clean-up question, listing every record created |
| `api` — an existing project helper (fixture / factory / pre-request / seed module under `{automation_root}` or a manifest path) | step 2 | the run's data-changes "yes", nothing more | same |
| `api` — an endpoint read from the application's source code (no helper) | step 3 | **explicit "yes" per item**, asked ONCE with every other such item after discovery: the endpoint in plain words, the request summary, the authentication through the project's existing secret mechanism, the TCs it unblocks | same |
| `db` — a project database helper, or a connection variable the QC names | step 5 | **separate explicit "yes"** naming the item; own records only, read back | same |
| nothing found · `NOT CREATABLE` · the QC declined | — | skip with the precise reason (`no way found` · `not creatable — {evidence}` · `QC declined`) | — |
<!-- SHARED-3B-3C END principles -->

## 1. Evidence sources — what each may prove

| Source | Read how (never written) | May prove | Availability wording |
|---|---|---|---|
| Learning file: a `[type: data]` line naming this item / entity and how it was created, or a `[type: env]` line naming a seeding service for this environment | step 2 grep (`learning-file.md`) | the way the line names (`api` / `db` / `e2e scenario` / `set directly`) and, when the line says so, that the item exists | `available — confirmed by learning file ({date in the line})` |
| Skill 5's automation code under `{automation_root}`: a helper that **creates** this entity (fixture / factory / pre-request / seed module / API client), a setup journey from an earlier story, a test-data helper that maps this item | step 4: Glob / Grep / Read — never edited (SKILL.md invariant 9); imported by the temporary seed (§4), never run in place | `api` (a creating helper — **available**, principle 1) · `e2e scenario` (a setup journey) · `db` (a database helper **and** the separate consent) | `available — confirmed by automation helper ({date checked})` — in every deliverable the helper is described in words ("the automation project already creates orders through its API helper"), never a path, file, function or endpoint (invariant 10) |
| The application's source code in this repository: a create route / controller / endpoint for this entity with its request shape (skill 10's `.project-profile.md` names the layers when present) | step 4: Glob / Grep / Read — never edited; outside `{automation_root}` and `Testing/` | `api` — available **pending the user's "yes"** (consent table) | `available — endpoint found in the application source ({date checked}); needs the user's yes` — described in words ("the application exposes an order-creation endpoint"), never a path |
| A TC in this set with `Data effect: creates` whose Expected Result is exactly this item, or a `## Common Flows` entry of the learning file that creates it | step 4 (`scope-gate.md` §1) | `e2e scenario` | `available — TC-{id} in this set` / `available — common flow "{name}"` |
| The walk: a creation screen or a settings screen for this entity reached live | step 8 (in-scope screens only) | `e2e scenario` (creation screen) · `set directly` (settings screen) | `available — seen live {date}` |
| The walk: an API-documentation page, an admin import / seed screen seen live | step 8 (in-scope screens only) | **nothing more than "a way may exist"** | `to be confirmed — {what was seen}; ask the dev team / project` — never `available` |
| The user's answer to a consent ask (§4) or the batched ask (§5) | steps 4b, 9 | whatever was answered | `available — confirmed by user {date}` |
| Evidence that the state cannot exist on `{env}` (a rule in the code or configuration, a role that exists in no environment, a background job that never runs here) | steps 4, 8 | `NOT CREATABLE` (principle 9) | `not creatable — {evidence}` |
| Nothing | — | — | `api` / `db` → `to be confirmed` · `e2e scenario` / `set directly` → `not available` · `manual` → `always available` |

Rules: the evidence is named per item in §3 `Decided from` (source + date); a `[similar: …]`
line or a look-alike module is a recommendation that needs confirmation, never evidence
(`open-questions.md` §1); two sources for the same way → the most recent dated one is cited,
both are listed.

## 2. Way decision — fixed order, first available wins

```
e2e scenario → api → db → set directly → manual
The decided way is the FIRST in that order whose availability starts with "available".
"to be confirmed" and "not available" are never chosen; manual is chosen when nothing above it is available.
```

| Situation | Decided way | §3 `Decided from` |
|---|---|---|
| e2e available (a TC of this set, a common flow, a creation screen seen) | `e2e scenario ({TC-id | flow name | screen})` | the source + date |
| no e2e; api available through an automation helper (learning line, helper, user) | `api (helper)` | the source |
| no e2e, no helper; an endpoint found in the application source | `api (source code)` — executed only after the user's "yes" (§4b); "no" → `manual` + `QC declined` | the source + `user yes {date}` / `user declined {date}` |
| no e2e / api; db available (helper or named variable) **and** the separate "yes" | `db` | the source + `user yes {date}` |
| the item is a setting / toggle and its settings screen is known or seen | `set directly` | the source |
| nothing available, something `to be confirmed` | `manual` (recommended) + a `Q-{n}` naming the way to confirm | `undecided — Q-{n}` |
| nothing available, nothing to confirm | `manual` | `no better way found ({sources searched})` |
| the item is `READY` | the way stays informational (how it would be re-created); no Q | the existence evidence |
| the item is `IMPOSSIBLE` or `NOT CREATABLE` | nothing chosen; the §4 Problems row stays (with the evidence for `NOT CREATABLE`); a Q only when the walk showed a way | the evidence |
| the item is used only by `not-implemented` TCs | decided from file evidence only — never looked at, never prepared, never asked | `deferred — pending implementation` |

A chosen `e2e scenario` / `api` / `db` way is **executed by this skill** (§4) when the item is
`MISSING`; `set directly` is executed through the settings screen like any step; `manual` is
written for the QC. The way is still written into the file when nothing needed preparing, so
skill 5 and the next run find it.

## 3. Item priority — from the TCs that use the item

```
High   — a using TC has Smoke: YES, or the item keeps ≥ 3 TCs in draft this run
Medium — otherwise: a using TC is Type: positive, or the item keeps 2 TCs in draft
Low    — everything else (used only by negative / locale-variant TCs, or by one TC)
Order inside a level: more TCs kept in draft first, then more using TCs, then the lower D number.
```

Written in §3 as `- **Priority:** High — smoke TC-ORD-01; keeps 3 TCs in draft`. A TC with a
`[HUMAN]` step counts as a using TC; a `not-implemented` TC never counts as "kept in draft".
The priority orders the preparations (§4), the §5 blocks, the rows of the consent ask (§4b) and
the batched ask (§5) and the test-data lines of the final message. It never changes a TC's
`Smoke`, `Type` or the walk set (the chosen scope — `scope-gate.md` — decides which TCs are walked; only items whose dependents are inside that scope are prepared).

## 4. Preparation run — the nine steps (every way, under the consent of its way)

A `MISSING` item is **prepared** so that the TCs depending on it can be observed this run. The
preconditions; a failed one is recorded as `would prepare — {missing precondition}` in §3 and the
dependents stay `draft — not app-validated (data missing — D{n})`:

1. the environment is not production (`mcp-pass.md` §3a); the way's consent holds (consent
   table — none for `e2e scenario`; the run's data-changes "yes" for `api (helper)`; the user's
   "yes" of §4b for `api (source code)` and `db`);
2. the item's status **this run** is `MISSING` — looked at, absent; never `UNKNOWN` (not looked
   at), never `IMPOSSIBLE` / `NOT CREATABLE`;
3. the decided way is executable this run: an `e2e scenario` named by a TC of this set that is
   executable (not `not-implemented`, no `[HUMAN]` step before its creating step, not itself
   kept out by an item that cannot be prepared), a common flow, a creation screen seen live, a
   creating helper, an endpoint with a known request shape, or a database helper;
4. every value in §3 `Exact values needed` is known — none `unknown`, `TBD` or absent. **The
   run never invents a value**; a missing value is a fact question for the batched ask (§5);
5. at least one dependent TC's unique tail will be observed this run (a preparation that serves
   nobody is not run; the way is still written);
6. the mode is not COMPARISON (the 3b-vs-3c comparison — `../link-qc-3c-validate-manual-test-cases-cli/references/cli-vs-mcp-comparison.md` §1 — the two runs must share the
   application state; the run lists what it *would* prepare); in READ-ONLY mode (approved
   document, no authorization) a clean-up way must exist, because a left-behind record could not
   be written anywhere.

**4b. The consent ask** — ONE `AskUserQuestion`, after step 4's data plan and before the first
browser command, only when at least one `MISSING` item's decided way is `api (source code)` or
`db`; rows ordered by §3 priority:

```
Test data — {n} items can be created, {m} of them need your yes
| # | Item | Priority | TCs it unblocks | Way | What would be done | Needs |
| D4 | an approved order with 12 line items | High | TC-ORD-03, TC-ORD-07, TC-ORD-12 | api (source code) | call the application's order-creation endpoint as [A1] with 12 line items, in a dedicated customer created for this run | your yes |
| D6 | an order whose approval expired yesterday | Medium | TC-ORD-15 | db | set the approval date of the order THIS run creates to yesterday, read it back | your yes (database write) |
| D2 | a customer without orders | Low | TC-ORD-09 | e2e scenario (TC-CUS-01) | prepared automatically — no answer needed | — |
Answer per item: yes | no — "no" leaves the dependents draft (data missing — QC declined); keep or clean up is asked after the walk.
```

Answered "yes" → `available — confirmed by user {date}`; "no" / unanswered → `manual` stays the
recommended way, `Decided from: user declined {date}` / `undecided — Q-{n}`, the dependents keep
their state. Items prepared through an `e2e scenario` or a helper appear in the message for
information only — they are never a question.

**Procedure — the nine steps, per item, in priority order, each before its dependents** (they form
the first group of the walk, `scope-gate.md` §4 — only for items whose dependents are inside the chosen scope):

1. **Discover** (principle 1, done at step 4 and refreshed by what the walk shows) — the way and
   where it was found.
2. **Plan the fixture** (principle 5) — a dedicated, clearly named parent record for this run
   (`{item name} — qa-{feature}-{date}` in plain words), sized to the TC's boundary; the exact
   values from §3; which items share one preparation (only compatible ones).
3. **Compose the temporary seed** (principle 3) — for `api (helper)` / `api (source code)` / `db`:
   a script in the session scratch folder that imports the project's helpers by absolute path
   (or calls the endpoint found in the source with the project's own client and secret
   mechanism), selects `{env}` the project's way, creates the planned records and prints their
   identifiers; for `e2e scenario`: the creating TC's steps, the common flow or the creation
   screen, driven through the Playwright MCP like any TC (`mcp-pass.md` §3). Never a password on the
   command line, never a new file under the repository.
4. **Run it** — once; a permission refusal → stop, report, ask (principle 10); a failure →
   `would prepare — {what failed}` and the dependents stay draft; captured output filtered for
   token / password lines (principle 11) before anything is recorded.
5. **Capture the identifiers** — name, number, key as the UI shows them (plain words); one chat
   line `Prepared D{n} "{name}" by {way} — identity {…}`.
6. **Verify on the oracle** (principle 6) — one read-only look at the screen the dependents read;
   when the screen hides the value (paginated list, details-only field), a read-only API or
   database read as well; the item becomes `READY — prepared this run {date}` for the rest of the
   walk only after this look. Not confirmed → `would prepare — not confirmed on {screen}`,
   dependents draft, the record listed for clean-up.
7. **Read back the stamped values** (principle 7) — creation / publish dates, the current period,
   generated codes, sequence numbers: use the effective values for this run's observations in
   place of the TC's literals; each substitution is a Deviation line `D{n}: {field} — TC says
   {literal}, system stamped {value}` and a step-wording finding for skill 3 `--revision`, never
   a silent rewrite of the Expected Result. A permission / visibility / ownership precondition is
   checked against the rule's source too (principle 8); a misleading screen is a finding for
   skill 3.
8. **Delete the seed** — the scratch script and any captured output file; nothing of it reaches
   the repository, the deliverables or the learning file (the way is described in words).
9. **Keep or clean up** — decided ONCE for every record of this run by the post-walk question
   (§5), default keep; clean-up only through an existing helper or the UI (the creating TC's own
   clean-up step, a `TEST-DATA` §5 way, a learning-file entry); a record that could not be
   removed is `left` + an Environment-blockers line `left in {env}: {record} — prepared for D{n}
   by {way}`.

When the way is a data-changing TC of this set, that one execution is both its validation (its
Expected Result is observed and stamped like any TC) and the preparation — its own clean-up step
is **deferred to the post-walk decision**, the one exception to "revert after the Expected
Result was checked" (`mcp-pass.md` §3a). A creating TC that itself needs a missing item is
resolved first, in dependency order; a cycle is a `Q-{n}`, nothing is prepared.

<!-- SHARED-3B-3C BEGIN write-rules -->
**Delivered status.** The §2 `Status` cell holds exactly one word; the preparation note lives in
§3:

| Outcome of this run | §2 `Status` | §3 `Prepared this run` | §5 way |
|---|---|---|---|
| prepared and **kept** (default) | `READY` — the record genuinely exists; `Must look like` describes it in plain words (identity, count, stamped values) | `{date} by {way} as "{record identity}" — kept; stamped values: {field = value, …}` | `available — executed {date}` |
| prepared and **cleaned up** on the QC's answer | `MISSING` — the record no longer exists | `{date} by {way} as "{record identity}" — removed {date}; recreate by {way}` | `available — executed {date}` |
| preparation attempted, not confirmed by the oracle | `MISSING` | `would prepare — not confirmed on {screen} ({date})` | unchanged |
| not prepared (precondition failed, consent declined, nothing to serve) | unchanged (`MISSING` / `UNKNOWN`) | `would prepare — {missing precondition | QC declined {date} | no dependent this run}` | unchanged |
| evidence that the state cannot exist on `{env}` | `NOT CREATABLE` | — (the §4 Problems row carries the evidence) | — |
| `IMPOSSIBLE` (skill 3's word: needs a background job, an external system, a role no environment has) | unchanged | — | — |

A TC walked on prepared data is validated like any other; its evidence stamp carries
`data: prepared this run ({way})` (`tc-format-contract.md`). A stamped-value substitution is a
step-wording finding for skill 3, never a silent rewrite of the Expected Result.
<!-- SHARED-3B-3C END write-rules -->

## 5. Question closure — by evidence, or stays open; the ONE post-walk ask

**Closed by evidence** only when the evidence answers *exactly* what the question asked and a
second observer could re-check it: the item exists (seen live), the way exists (learning line,
automation helper, endpoint in the source, creation screen seen), the value is X (seen live or
read back). A **preference** stays `open` with a refreshed `Recommended` line: which available
way to prefer, whether a manual wait is acceptable, whether to ask the dev team for a job
trigger. The entry keeps the `open-questions.md` shape and gains two lines:

```markdown
- **Status:** answered {YYYY-MM-DD}
- **Answer:** {the fact} (by evidence: seen live on {env} {date} | learning-file line under ## Test Data | automation helper — {plain description} | application source — {plain description} | read back after preparation {date})
```

Mirror it in `TEST-DATA` §6 (`Q-{n} — closed by evidence {date}: {fact}`) and drop the line from
the Unclear-requirements bucket (only for a closed Q). Close **at step 9, before any stamp is
written**, so no stamp of this run lists a question this run closed.

**The post-walk ask** — one `AskUserQuestion`, after the walk, whenever at least one record was
prepared this run (keep / clean-up, principle 12) or at least one item stayed undecided; both
parts in the same message, rows ordered by §3 priority; items used only by `not-implemented` TCs
excluded:

```
Test data — {p} records were prepared this run; {u} items still need your decision
Prepared (keep by default — answer "clean up D{n}" for any you want removed):
| D2 | a customer without orders | e2e scenario (TC-CUS-01) | customer "qa-orders-2026-10-13" | clean-up way: the customer's Delete action |
| D4 | an approved order with 12 line items | api (source code, your yes) | order no. 10231 (stamped 2026-10-13) | clean-up way: the automation project's order helper |
Undecided:
| # | Item | Priority | TCs kept in draft | Ways found | Recommended | Why |
| D7 | a supplier flagged for audit | Low | TC-SUP-04 | api — to be confirmed (an API-documentation page was seen); manual | manual | nothing confirms API creation; the dev team could confirm it |
Answer per undecided item: e2e scenario (TC-… / flow) | api | db | set directly | manual
("db" also needs its own yes; an executable way answered while the browser is still open → prepared now (§4), otherwise next run)
```

Each undecided row is also a `Q-{n}` in the required shape, written in `## Open Questions` and
listed in `TEST-DATA` §6. **Unanswered** → `manual` stays the recommended way, the Q stays
`open`, the dependents keep their state (`open-questions.md` §3); prepared records are **kept**.
**Answered** → `available — confirmed by user {date}`, `Status: answered {date}`, and the Q&A
learning line `(confirmed by user {date})` (`open-questions.md` §4). Answered in-run with an
executable way and the browser still open → §4 now for that item and its dependents, then step 10;
otherwise recorded, effective next run. "clean up D{n}" → §4 step 9 for that record.

**What reaches the learning file.** Evidence-closed facts, confirmed ways and prepared fixtures
→ `## Test Data` as `[type: data]` lines; not-creatable evidence and "the screen is not the rule"
facts → `[type: env]` lines:

```
- [module: Orders] [type: data] Fixture "an approved order with 12 line items" — exists on staging; seen live on 2026-10-12
- [module: Orders] [type: data] Fixture "an approved order with 12 line items" — order no. 10231 in customer "qa-orders-2026-10-13"; created through the application's order-creation endpoint on 2026-10-13 (stamped order date 2026-10-13), kept on staging
- [module: Customers] [type: data] Fixture "a customer without orders" — customer "qa-orders-2026-10-13"; created by e2e scenario "TC-CUS-01" on 2026-10-13, removed at the end of the run — way confirmed
- [module: Orders] [type: env] An order with an expired approval cannot exist on staging: the expiry job is disabled there (configuration, checked 2026-10-13) — NOT CREATABLE
- [module: Orders] [type: env] The order list shows every order to every role; the permission rule is applied by the API only (code, checked 2026-10-13) — the screen is not the rule
```

A user-confirmed way → also the Q&A line of `### Validation Model (skill 3b)`. Never an
evidence closure in the Q&A section (it is reserved for confirmed user answers); never
`MISSING` / `UNKNOWN` / `IMPOSSIBLE` as a fact line; never a value the user did not give; never a
path, endpoint, table, helper or fixture name.

## 6. What is written where in `TEST-DATA-{feature}.md`

| Place | Written by this pass | Never |
|---|---|---|
| header | counts recomputed (`ready · missing · impossible · unknown · not creatable`); `Environment: {env} checked {date}` | a new header line |
| §2 `Status` | per `patch-rules.md` §3 and the delivered-status table of §4 — one word | a status with a note after it |
| §2 `Best way to get it` | `{way} ({source short form})` — e.g. `e2e scenario (TC-ORD-03) — available`, `api — confirmed by automation helper`, `api — endpoint in the application source (user yes 2026-10-13)`, `db — user yes 2026-10-13`, `manual — api to be confirmed (Q-4)`, `deferred — pending implementation`, `none — not creatable (see Problems #2)` | a new column; the `Data item`, `Must look like` (advanced-facts rule only) and `Used by TCs` cells |
| §3 per item, appended after `Shared with other TCs` | `- **Priority:** {High \| Medium \| Low} — {reason}` · `- **How we handle it:** {way} — {one sentence in plain words}` · `- **Decided from:** {evidence + date \| user yes {date} \| user declined {date} \| undecided — Q-{n} \| deferred — pending implementation}` · `- **Prepared this run:** …` (the delivered-status table of §4; absent when nothing was attempted) · `- **Stamped values:** {field = value, …} (read back {date})` (only after a preparation) | the meaning of the existing bullets; `What it is`; `Exact values needed` (advanced-facts rule only) |
| §4 Problems | per `patch-rules.md` §3; a `NOT CREATABLE` item gets a row whose `Problem` cell starts with `not creatable —` and names the evidence in words | — |
| §5 | the `(recommended: {way})` heading per item; the `Availability` cell of every way with the §1 wording; a row for a way the walk or the search found that the file lacked | a sixth way name; an unconfirmed `api` / `db` marked available |
| §6 | closed Qs with their fact (`closed by evidence {date}`); open Qs with the recommended way | — |

Plain English throughout: entities, screens, roles, values and flows in words — no path,
endpoint, table, helper or fixture name (invariant 10). Code identifiers observed on the way may
go only to the learning file's `## Automation Tricks`, explained in words on the same line.

## 7. Reconciliation and return lines

- Plan line (`scope-gate.md` §3) gains `{p} items to prepare`.
- `**Data changes:** {authorized | not authorized} · {n} made ({t} by TCs · {p} preparations: {e} e2e · {a} api helper · {s} api from source · {d} db) · {n} cleaned up · {n} kept · {n} left ({record identities | none})`
- `**Test data:** ready {a}→{b} · missing {a}→{b} · impossible {a}→{b} · unknown {a}→{b} · not creatable {a}→{b} · advanced facts added: {n} · ways decided: {e} by evidence · {u} by user · {q} undecided (Q-ids) · prepared this run: {p} (kept {k} · removed {c}) · stamped values substituted: {n}`
- `**Open questions:** {N} open — {Q-ids with the recommended answer, or "none"} · {c} closed by evidence this run`
- Audit return: `**Data plan:** {n} items · {e} ways decided from evidence · {q} undecided (asked once after the walk) · {p} preparation candidates ({e} e2e — no question · {a} api helper · {s} api from source + {d} db — need a yes; not in audit)` — computed from the files, the learning file, the automation code and the application source only; no look, no preparation, no ask.
- Final message: test data before → after, the ways decided (evidence / user / undecided), the items prepared (kept / removed, with the stamped values substituted), the not-creatable items with their evidence, the questions closed by evidence — ordered by priority.

## 8. Worked example — four `MISSING` items, no "data missing" outcome

Story "order approval", staging, data changes authorized, not COMPARISON. After the look, four
items are `MISSING`:

| Item | Discovery (principle 1) | Decided way | Consent | Preparation | Delivered |
|---|---|---|---|---|---|
| D2 a customer without orders (TC-ORD-09) | learning file: nothing · automation helpers: none for customers · source: a customer endpoint exists · TC-CUS-01 of this set creates a customer | `e2e scenario (TC-CUS-01)` — first available | none | TC-CUS-01 walked first as customer "qa-orders-2026-10-13" (its own validation + the preparation); oracle: the customer list shows the row with 0 orders | kept → `READY` |
| D4 an approved order with 12 line items (TC-ORD-03, 07, 12) | learning: nothing · helpers: the automation project creates orders through its API helper (found under the manifest's automation root) | `api (helper)` | the run's data-changes "yes" | temporary seed in scratch importing the helper, env selected by the project's profile variable; 12 line items in customer "qa-orders-2026-10-13"; identifiers read: order no. 10231; oracle: the order list (paginated) + a read-only API read for the line count; **stamped order date 2026-10-13** — TC-ORD-07 expects "order date = 2026-01-15" → substituted for this run, Deviation + finding for skill 3 | kept → `READY`; `Stamped values: order date = 2026-10-13` |
| D6 an order whose approval expired yesterday (TC-ORD-15) | learning: nothing · helpers: none set dates · source: the expiry date is never accepted by the endpoint · db helper exists in the automation project | `db` — the only way to the state | separate "yes" (consent ask, answered yes) | seed sets the approval date of order no. 10231's sibling created by the same seed (own record only), read back; oracle: the order details screen shows "expired" | kept → `READY` |
| D8 an order approved by a user who no longer exists (TC-ORD-21) | learning: nothing · helpers / source: approvals require an active approver; deleting a user cascades to its approvals (code, checked) | none | — | — | `NOT CREATABLE` — Problems row "not creatable — approvals are removed with their approver (code, checked 2026-10-13)"; TC-ORD-21 `draft — not app-validated (data not creatable — D8)`, a finding for skill 3 |

Resulting `TEST-DATA` rows (§2) — one word per status cell:

```markdown
| D2 | a customer without orders | customer "qa-orders-2026-10-13", 0 orders | TC-ORD-09 | READY | e2e scenario (TC-CUS-01) — available |
| D4 | an approved order with 12 line items | order no. 10231, 12 line items, order date 2026-10-13 | TC-ORD-03, TC-ORD-07, TC-ORD-12 | READY | api — confirmed by automation helper |
| D6 | an order whose approval expired yesterday | order no. 10232, approval date 2026-10-12, shown as "expired" | TC-ORD-15 | READY | db — user yes 2026-10-13 |
| D8 | an order approved by a user who no longer exists | — | TC-ORD-21 | NOT CREATABLE | none — not creatable (see Problems #2) |
```

§3 for D4:

```markdown
- **Priority:** High — smoke TC-ORD-03; keeps 3 TCs in draft
- **How we handle it:** api — the automation project already creates orders through its API helper
- **Decided from:** automation helper (checked 2026-10-13)
- **Prepared this run:** 2026-10-13 by api (helper) as "order no. 10231 in customer qa-orders-2026-10-13" — kept; stamped values: order date = 2026-10-13
- **Stamped values:** order date = 2026-10-13 (read back 2026-10-13)
```

TC stamps: TC-ORD-03 `validated`, stamp `… tool: mcp · data: prepared this run (api helper) ·
outcome-check: order list shows order no. 10231 with 12 line items`; TC-ORD-07 `enhanced` (step 4
wording now reads "the order date shown by the system") with the Deviation `D4: order date — TC says
2026-01-15, system stamped 2026-10-13`; TC-ORD-15 `validated`, `data: prepared this run (db)`;
TC-ORD-21 `draft — not app-validated (data not creatable — D8)`. Post-walk ask: four records
listed for keep / clean-up (kept), no undecided item. Return line: `prepared this run: 3 (kept 3 ·
removed 0) · stamped values substituted: 1 · not creatable 0→1`.
