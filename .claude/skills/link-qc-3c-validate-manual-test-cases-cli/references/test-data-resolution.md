# Test-data resolution — look, decide, prepare, close by evidence, ask once (steps 4, 8, 9)

This pass fills `TEST-DATA-{feature}.md` beyond the statuses: for every data item it decides
**how the item is handled** — from evidence first, from the user only for what evidence cannot
settle — gives it a priority, prepares a missing item through a documented e2e scenario when the
run may change data, and closes the test-data questions that evidence turned into facts. It
never adds a status word (`READY` / `MISSING` / `IMPOSSIBLE` / `UNKNOWN`), a way name
(`e2e scenario` / `api` / `db` / `set directly` / `manual`) or a §2 column; skill 3 still owns
the item list and the `Data item` / `Must look like` / `Used by TCs` cells (skills 4 and 5 hash
them); skill 5 reads the result as the starting inventory of its readiness gate. The one
read-only look per item and the advanced-facts rule stay in `patch-rules.md` §3 — this file is
what happens **after** the look.

## 1. Evidence sources — what each may prove

| Source | Read how (never written) | May prove | Availability wording |
|---|---|---|---|
| Learning file: a `[type: data]` line naming this item / entity and how it was created, or a `[type: env]` line naming a seeding service for this environment | step 2 grep (`learning-file.md`) | the way the line names (`api` / `db` / `e2e scenario` / `set directly`) and, when the line says so, that the item exists | `available — confirmed by learning file ({date in the line})` |
| Skill 5's automation code under the automation root (`paths.automationRoot` of `Testing/qa-manifest.json`, fallback `Testing/Automation`): a seeding helper for this entity, a setup journey from an earlier story, a test-data helper that maps this item | step 4: Glob / Grep / Read only — never run, never edited (SKILL.md invariant 9) | `api` (a seeding helper) · `e2e scenario` (a setup journey) · `db` (a database helper **and** a learning-file line saying the QC has access) | `available — confirmed by automation fixture ({date checked})` — in every deliverable the fixture is described in words ("the automation project already seeds orders through its API helper"), never a path, file, function or endpoint (invariant 10) |
| A TC in this set with `Data effect: creates` whose Expected Result is exactly this item, or a `## Common Flows` entry of the learning file that creates it | step 4 (`discovery-plan.md` §1) | `e2e scenario` | `available — TC-{id} in this set` / `available — common flow "{name}"` |
| The walk: a creation screen or a settings screen for this entity reached live | step 8 | `e2e scenario` (creation screen) · `set directly` (settings screen) | `available — seen live {date}` |
| The walk: an API-documentation page, an admin import / seed screen seen live | step 8 | **nothing more than "a way may exist"** | `to be confirmed — {what was seen}; ask the dev team / project` — never `available` |
| The user's answer to the batched ask (§5) | step 9 | whatever was answered | `available — confirmed by user {date}` |
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
| e2e available (a TC of this set, a common flow, a creation screen seen) | `e2e scenario ({TC-id | flow name})` | the source + date |
| no e2e; api available (learning line, automation fixture, user) | `api` | the source |
| no e2e / api; db available **and** access recorded | `db` | the source |
| the item is a setting / toggle and its settings screen is known or seen | `set directly` | the source |
| nothing available, something `to be confirmed` | `manual` (recommended) + a `Q-{n}` naming the way to confirm | `undecided — Q-{n}` |
| nothing available, nothing to confirm | `manual` | `no better way found ({sources searched})` |
| the item is `READY` | the way stays informational (how it would be re-created); no Q | the existence evidence |
| the item is `IMPOSSIBLE` | nothing chosen; the §4 Problems row stays; a Q only when the walk showed a way | — |
| the item is used only by `not-implemented` TCs | decided from file evidence only — never looked at, never prepared, never asked | `deferred — pending implementation` |

A chosen `api` / `db` / `set directly` way is **written for the QC and for skill 5, never
executed by this skill** — it has playwright-cli only (§4).

## 3. Item priority — from the TCs that use the item

```
High   — a using TC has Smoke: YES, or the item keeps ≥ 3 TCs in draft this run
Medium — otherwise: a using TC is Type: positive, or the item keeps 2 TCs in draft
Low    — everything else (used only by negative / locale-variant TCs, or by one TC)
Order inside a level: more TCs kept in draft first, then more using TCs, then the lower D number.
```

Written in §3 as `- **Priority:** High — smoke TC-ORD-01; keeps 3 TCs in draft`. A TC with a
`[HUMAN]` step counts as a using TC; a `not-implemented` TC never counts as "kept in draft".
The priority orders the preparations (§4), the §5 blocks, the rows of the batched ask (§5) and
the test-data lines of the final message. It never changes a TC's `Smoke`, `Type` or the walk
set (every TC is walked whatever its data's priority).

## 4. Preparation run — executing an e2e way (authorized runs only)

A `MISSING` item may be **prepared** so that the TCs depending on it can be observed this run.
All seven preconditions must hold; a failed one is recorded as `would prepare — {missing
precondition}` in §3 and the dependents stay `draft — not app-validated (data missing — D{n})`:

1. the data-changes answer of the combined ask is **"yes"** and the environment is not
   production (`walk-rules.md` §3a);
2. the item's status **this run** is `MISSING` — looked at, absent; never `UNKNOWN` (not
   looked at), never `IMPOSSIBLE`;
3. the decided way is `e2e scenario`, named by a TC of this set that is executable this run
   (not `not-implemented`, no `[HUMAN]` step before its creating step, not itself kept out by
   a missing item that cannot be prepared) or by a learning-file common flow;
4. every value in §3 `Exact values needed` is known — none `unknown`, `TBD` or absent. **The
   run never invents a value**; a missing value is a fact question for the batched ask (§5);
5. at least one dependent TC's unique tail will be observed this run (a preparation that serves
   nobody is not run; the way is still written);
6. the mode is not COMPARISON (`cli-vs-mcp-comparison.md` §1 — the two runs must share the
   application state; the run lists what it *would* prepare); in READ-ONLY mode (approved
   document, no authorization) a §5 cleanup way must exist, because a left-behind record could
   not be written anywhere;
7. the way is executed through the browser only — never `api`, never `db`, never `set
   directly`; a chosen `api` / `db` way is handed to skill 5 by the file, not run here.

**Procedure.** Preparations are the **first group of the walk** (`discovery-plan.md` §1), in
priority order, before any dependent. When the flow is a data-changing TC of this set, that one
execution is both its validation (its Expected Result is observed and stamped like any TC) and
the preparation — its own cleanup step is **deferred to the run end**, the one exception to
"revert after the Expected Result was checked" (`walk-rules.md` §3a). Identify the record as
the UI shows it (name, number — plain words) before and after the creating step; one read-only
re-look → the item is `READY — prepared this run {date}` for the rest of the walk; one chat
line `Prepared D{n} "{name}" by TC-… — identity {…}`. A creating TC that itself needs a missing
item is resolved first, in dependency order; a cycle is a `Q-{n}`, nothing is prepared.

**Run end** — after every dependent was observed, before the sessions close: revert through the
§5 cleanup way (UI only) → reconciliation `cleaned up`; no cleanup way, or the revert failed →
`left` + an Environment-blockers line `left in {env}: {record} — prepared for D{n} by TC-…`.

**Delivered status.** An item prepared and reverted is delivered **`MISSING`** — the record no
longer exists (invariant 3; skill 5 would otherwise skip its probe) — with §3 `Prepared this
run: … reverted {date}`, `How we handle it: e2e scenario (TC-…) — prepared per run` and its §5
way `available — executed {date}`. `READY` is delivered only when the record was **left
behind** — then it genuinely exists, and the blockers line says so.

## 5. Question closure — by evidence, or stays open; the ONE batched ask

**Closed by evidence** only when the evidence answers *exactly* what the question asked and a
second observer could re-check it: the item exists (seen live), the way exists (learning line,
automation fixture, creation screen seen), the value is X (seen live). A **preference** stays
`open` with a refreshed `Recommended` line: which available way to prefer, whether a manual wait
is acceptable, whether to ask the dev team for a job trigger. The entry keeps the
`open-questions.md` shape and gains two lines:

```markdown
- **Status:** answered {YYYY-MM-DD}
- **Answer:** {the fact} (by evidence: seen live on {env} {date} | learning-file line under ## Test Data | automation fixture — {plain description})
```

Mirror it in `TEST-DATA` §6 (`Q-{n} — closed by evidence {date}: {fact}`) and drop the line from
the Unclear-requirements bucket (only for a closed Q). Close **at step 9, before any stamp is
written**, so no stamp of this run lists a question this run closed.

**The batched ask** — one `AskUserQuestion`, after the walk, only when at least one item stayed
undecided; rows ordered by §3 priority; items used only by `not-implemented` TCs excluded:

```
Test data — {u} items need your decision (everything else was decided from evidence)
| # | Item | Priority | TCs kept in draft | Ways found | Recommended | Why |
| D4 | an approved order with 12 line items | High | TC-ORD-03, TC-ORD-07, TC-ORD-12 | api — to be confirmed (an API-documentation page was seen); manual | manual | nothing confirms API seeding; the dev team could confirm it |
Answer per item: e2e scenario (TC-… / flow) | api | db | set directly | manual
("db" also needs the access confirmation; "e2e scenario" with known values while the sessions are still open → prepared now (§4), otherwise next run)
```

Each row is also a `Q-{n}` in the required shape, written in `## Open Questions` and listed in
`TEST-DATA` §6. **Unanswered** → `manual` stays the recommended way, the Q stays `open`, the
dependents keep their state (`open-questions.md` §3). **Answered** → `available — confirmed by
user {date}`, `Status: answered {date}`, and the Q&A learning line `(confirmed by user {date})`
(`open-questions.md` §4). Answered in-run with an executable e2e way and sessions still open →
§4 now for that item and its dependents, then step 10; otherwise recorded, effective next run.

**What reaches the learning file.** Evidence-closed facts and confirmed ways → `## Test Data` as
`[type: data]` lines:

```
- [module: Orders] [type: data] Fixture "an approved order with 12 line items" — exists on staging; seen live on 2026-10-12
- [module: Orders] [type: data] Fixture "an approved order with 12 line items" — created by e2e scenario "TC-ORD-03" on 2026-10-12, reverted at the end of the run — way confirmed
- [module: Orders] [type: data] Fixture "an approved order with 12 line items" — created by e2e scenario "TC-ORD-03" on 2026-10-12, left in place on staging
```

A user-confirmed way → also the Q&A line of `### CLI Validation Model (skill 3c)`. Never an
evidence closure in the Q&A section (it is reserved for confirmed user answers); never
`MISSING` / `UNKNOWN` / `IMPOSSIBLE` as a fact line; never a value the user did not give.

## 6. What is written where in `TEST-DATA-{feature}.md`

| Place | Written by this pass | Never |
|---|---|---|
| header | counts recomputed; `Environment: {env} checked {date}` | a new header line |
| §2 `Status` | per `patch-rules.md` §3 and the delivered-status rule of §4 | — |
| §2 `Best way to get it` | `{way} ({source short form})` — e.g. `e2e scenario (TC-ORD-03) — available`, `api — confirmed by automation fixture`, `manual — api to be confirmed (Q-4)`, `deferred — pending implementation` | a new column; the `Data item`, `Must look like` (advanced-facts rule only) and `Used by TCs` cells |
| §3 per item, appended after `Shared with other TCs` | `- **Priority:** {High \| Medium \| Low} — {reason}` · `- **How we handle it:** {way} — {one sentence in plain words}` · `- **Decided from:** {evidence + date \| user answer {date} \| undecided — Q-{n} \| deferred — pending implementation}` · `- **Prepared this run:** {date} by TC-… / flow "{name}" as "{record identity}" — reverted {date} \| left in {env}` (only when it happened; `would prepare — {missing precondition}` when it did not) | the meaning of the existing bullets; `What it is`; `Exact values needed` (advanced-facts rule only) |
| §4 Problems | per `patch-rules.md` §3 | — |
| §5 | the `(recommended: {way})` heading per item; the `Availability` cell of every way with the §1 wording; a row for a way the walk found that the file lacked | a sixth way name; an unconfirmed `api` / `db` marked available |
| §6 | closed Qs with their fact (`closed by evidence {date}`); open Qs with the recommended way | — |

Plain English throughout: entities, screens, roles, values and flows in words — no path,
endpoint, table, helper or fixture name (invariant 10).

## 7. Reconciliation and return lines

- Plan line (`discovery-plan.md` §3) gains `{p} items to prepare`.
- `**Data changes:** {authorized | not authorized} · {n} made ({t} by TCs · {p} preparations) · {n} cleaned up · {n} left ({record identities | none})`
- `**Test data:** ready {a}→{b} · missing {a}→{b} · impossible {a}→{b} · unknown {a}→{b} · advanced facts added: {n} · ways decided: {e} by evidence · {u} by user · {q} undecided (Q-ids) · prepared this run: {p} (reverted {r} · left {l})`
- `**Open questions:** {N} open — {Q-ids with the recommended answer, or "none"} · {c} closed by evidence this run`
- Audit return: `**Data plan:** {n} items · {e} ways decided from evidence · {q} undecided (asked once after the walk) · {p} preparation candidates (e2e scenario, authorized runs only, not in audit)` — computed from the files and the learning file only; no look, no preparation, no ask.
- Final message: test data before → after, the ways decided (evidence / user / undecided), the items prepared (reverted / left), the questions closed by evidence — ordered by priority.
