# Test-data preparation — discover, prepare, verify, then run (steps 6, 6b, 11)

A manual run never stops at "data missing" while the project itself can create the data. For
every `D{n}` item the executable TCs reference, this pass takes skill 3's `TEST-DATA-{feature}.md`
as the inventory of record (read-only — skill 3 owns it, 3b / 3c patch it, this skill only reads
it), looks once, **prepares what is absent through the first available way** under the consent
that way needs, verifies it on its oracle, reads back the values the system stamped, and only then
lets the dependents run. The outcome of every item is a row of the phase's `### Test-data
readiness` table and of the run file's `data_readiness` object; `TEST-DATA` is never written —
a status that should change is routed to 3b / 3c or to skill 3 `--revision` in the final message.

The twelve principles and the consent table below are word for word the ones of skill 5's PHASE
2.6 and of the validators' `test-data-resolution.md` (3b, 3c). Edit every copy together.

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

## 1. Inventory of record — what each item needs

Start from `TEST-DATA-{feature}.md` (skill 5 PHASE 2.6 step 1 does the same): the `## 0.
Environment` rows, the `## 1. Accounts` rows, the `## 2` items with `Must look like`, `Used by
TCs`, `Status` and `Best way to get it`, the `## 3` details (`Exact values needed`, `How we handle
it`, `Decided from`, `Prepared this run`, `Stamped values` when a validator wrote them), the `## 4`
Problems and the `## 5` ways. Every token a TC carries is a requirement of its own: `[E2]` is the
mail sandbox row, not the base URL; `[A2]` is that account; a token with no row is a gap
(`SKIP · data_missing` with the token named — `execution-rules.md` §2), never a substitution.
Add only requirements the TC document carries that the file lacks (a Preconditions / Data Oracle
/ Shared data sentence with no item) and say which were added. The learning file is read first
(`learning-file.md`): a `[type: data]` line that names the item and how it was created, a
`[type: env]` line that says a state cannot exist, a `[type: qa]` decision of an earlier run —
nothing already answered is probed, asked or prepared again.

## 2. Look, then classify — once per item, never per TC

One read-only look per item on the listing screen the file names (`execution-rules.md` §4), before
the first stage that needs it, shared by every TC that uses it:

| Status | Meaning | What happens next |
|---|---|---|
| `READY` | present with the values the TCs need (seen now, or a learning-file line confirms a kept fixture) | dependents run |
| `MISSING` | the screen was reached and the item is absent, or the file already says so | **discover a way (§3 step 1) and prepare** — never a skip before every way was searched |
| `IMPOSSIBLE` | skill 3's word: needs a background job, an external system, a role no environment has, a state the app cannot reach through any interface | dependents `SKIP — not creatable` only when the look and the discovery confirm it; otherwise prepared like `MISSING` |
| `UNKNOWN` | the screen was not reached / not looked at | tried at execution; absent there → the same discovery and preparation, at that moment |
| `NOT CREATABLE` | evidence proves the state cannot exist on `{env}` (a rule in the code or configuration, a role that exists in no environment, a job that never runs here) — written by a validator in `TEST-DATA`, or established by this run's discovery | dependents `SKIP — not creatable — {evidence}`; the evidence goes to the learning file (`[type: env]`) |

## 3. The nine steps — per `MISSING` item, before its dependents

1. **Discover** (principle 1) — in order: the learning file; the automation project's test-data
   helpers (the manifest paths first — `paths.automationRoot` and any path the manifest names for
   fixtures / helpers —, then a search for create / seed / fixture / factory / pre-request / setup
   modules and API clients under `{automation_root}`); the application's create endpoints read
   from its source code when the repository holds it (skill 10's `.project-profile.md` first,
   otherwise routes / controllers / API definitions outside `{automation_root}` and `Testing/`);
   a UI journey (a creating TC of this document, a learning-file `## Common Flows` entry, a
   creation screen seen during the run); a database helper the project already has; manual.
   Record where each way was found. The decided way is the first available one; an
   API-documentation page or an import screen alone is `to be confirmed`, never available.
2. **Plan the fixture** (principle 5) — a dedicated, clearly named parent record for this run
   (`{item name} — qa-{feature}-{date}` in plain words), sized to the TC's boundary (more rows than
   the upper limit the TC tests, exactly the count a count TC expects); the exact values from
   `TEST-DATA` §3 — **the run never invents a value**; a value the file does not name is a `Q-{n}`
   (`open-questions.md`) and the item stays `MISSING` until answered; which items share one
   preparation (only compatible ones).
3. **Compose the temporary seed** (principle 3) — for a helper or an endpoint from the source: a
   script in the session scratch folder that imports the project's helpers by absolute path (or
   calls the endpoint with the project's own client and secret mechanism), selects `{env}` the
   project's way (environment variable, configuration profile or command-line flag), creates the
   planned records and prints their identifiers; for a UI journey: the creating TC's steps, the
   common flow or the creation screen, driven through playwright-cli in the run's own session
   (`browser-cli.md`); for the database: the project's helper, after its separate "yes". Never a
   password on the command line, never a new file under the repository.
4. **Run it** — once, under the consent its way needs (§4); a permission refusal → stop, report
   exactly what was refused, ask (principle 10); a failure → `skip — data_missing` with
   `preparation failed: {what failed}` as the reason, the dependents skipped; every captured
   output is filtered for token / password lines (principle 11) before anything is recorded.
5. **Capture the identifiers** — name, number, key as the UI shows them (plain words); one
   progress-log line `Prepared D{n} "{name}" by {way} — identity {…}`.
6. **Verify on the oracle** (principle 6) — one read-only look at the screen the dependents read;
   when the screen hides the value (paginated list, details-only field) a read-only API or
   database read as well; the item is `READY` for the rest of the run only after this look. Not
   confirmed → `skip — data_missing` with `prepared but not confirmed on {screen}`, the record
   listed for the keep / clean-up question.
7. **Read back the stamped values** (principle 7) — creation / publish dates, the current period,
   generated codes, sequence numbers: the run observes against the effective values in place of
   the TC's literals; each substitution is a `### Deviations` bullet `D{n} "{item}": {field} — TC
   says {literal}, the system stamped {value}; the observation used the stamped value — route to
   skill 3 --revision`, never a silent change of what the TC expects. A permission / visibility /
   ownership precondition is verified against the rule's source too (principle 8); a TC whose
   oracle relies on a misleading screen is a Deviation for skill 3, never a skip.
8. **Delete the seed** — the scratch script and any captured output file; nothing of it reaches
   the repository, the report set or the learning file (the way is described in words).
9. **Keep or clean up** — decided ONCE for every record of this run by the post-run question
   (§4), default keep; clean-up only through an existing helper or the UI (the creating TC's own
   clean-up step, a `TEST-DATA` §5 way, a learning-file entry); a record that could not be removed
   is listed under `### Deviations` as `left in {env}: {record} — prepared for D{n} by {way}` and
   in the final message.

## 4. The two questions — asked at most once each

**Consent ask** — ONE message, after discovery and before the first stage that needs the item,
only when at least one `MISSING` item's decided way is an endpoint from the source code or the
database; rows ordered by the stage that needs them (smoke first):

```
Test data — {n} items can be created, {m} of them need your yes
| # | Item | TCs it unblocks | Way | What would be done | Needs |
| D4 | an approved order with 12 line items | TC-010, TC-011, TC-011b | api (source code) | call the application's order-creation endpoint as [A1] with 12 line items, in a dedicated customer created for this run | your yes |
| D6 | an order whose approval expired yesterday | TC-015 | db | set the approval date of the order THIS run creates to yesterday, read it back | your yes (database write) |
| D2 | a customer without orders | TC-020 | e2e scenario (TC-CUS-01) | prepared automatically — no answer needed | — |
Answer per item: yes | no — "no" skips the dependents (skip — QC declined); keep or clean up is asked after the run.
```

UI journeys and existing helpers appear for information only — they are never a question. "No"
or no answer → `skip — QC declined` for that item's dependents; the item is never prepared later
in the same run without the answer.

**Keep / clean-up ask** — ONE message after the last stage (step 11), whenever at least one record
was prepared this run; default keep:

```
Test data — {p} records were prepared this run (keep by default — answer "clean up D{n}" for any you want removed)
| D2 | a customer without orders | e2e scenario (TC-CUS-01) | customer "qa-orders-2026-10-13" | clean-up way: the customer's Delete action |
| D4 | an approved order with 12 line items | api (source code, your yes) | order no. 10231 (stamped 2026-10-13) | clean-up way: the automation project's order helper |
```

Unanswered → kept, and the learning file says so (`[type: data]`). "clean up D{n}" → §3 step 9 for
that record, through an existing helper or the UI only.

Production named in the environment note stops every preparation and every data-changing TC
(stated, never asked — `intake.md` §3).

## 5. What is recorded where

| Outcome per item | Readiness `Decision` | Dependents | Elsewhere |
|---|---|---|---|
| present at the look | `READY` | run | — |
| prepared and confirmed | `prepared (api \| ui \| db)` — `Source` = `learning` / `qc` / `helper` / `source code (user yes)` / `e2e TC-…` | run | `Identifiers / names`, `Effective stamped values`, `Verified on`, `Cleanup` (`kept` / `cleaned up` / `left`) filled; each substitution a `### Deviations` bullet; the `### Run` bullets `Data changes` and `Data preparation` count it |
| no way found after the principle-1 search, or the preparation failed / was not confirmed | `skip — data_missing` | `SKIP`, classification `data_missing`, Skips row with the precise reason (`no way found — searched: learning file, automation helpers, application source, UI journeys` · `preparation failed: …` · `prepared but not confirmed on {screen}`) | — |
| evidence that the state cannot exist | `skip — not creatable` | `SKIP`, classification `—`, Skips row `not creatable — {evidence}` | `[type: env]` learning line with the evidence |
| the QC answered "no" to the consent ask | `skip — QC declined` | `SKIP`, classification `—`, Skips row `QC declined (data preparation through {way})` | — |

The table header is `Gap · TCs · Decision · Source · Provisioning · Identifiers / names · Effective
stamped values · Verified on · Cleanup` (skill 5's `run-report.md` §4); `**Verdict:** READY` ·
`READY-WITH-SKIPS ({n} TCs)[ — {p} gaps prepared]`; the renderer counts the decisions and shows a
`Decisions:` line. The run file's `data_readiness` object (`run-report-manual.md` §6) holds the
same rows. A `SKIP` for a readiness reason is never a bug (`execution-rules.md` §7).

## 6. Learning file

Each prepared fixture → one `[type: data]` line under `## Test Data`: what exists, where (the
environment), its identity, the stamped values, how it was created (in words), kept or cleaned up,
the date. Not-creatable evidence and "the screen is not the rule" facts (principle 8) → one
`[type: env]` line each. Each answer to the two questions → `[type: qa]` under `### Manual Run
Model (skill 5b)`. Never a path, endpoint, table, helper or fixture name, never a credential
(`learning-file.md`).

## 7. Worked example — four `MISSING` items, no "data missing" outcome

Story "order approval", UAT, data changes authorized. After the look, four items are `MISSING`:

| Item | Discovery (principle 1) | Way | Consent | Preparation | Readiness row |
|---|---|---|---|---|---|
| D2 a customer without orders (TC-020) | learning file: nothing · helpers: none for customers · source: a customer endpoint exists · TC-CUS-01 of this document creates a customer | `e2e scenario (TC-CUS-01)` — first available | none | TC-CUS-01 executed first as customer "qa-orders-2026-10-13" (its own result + the preparation); oracle: the customer list shows the row with 0 orders | `prepared (ui)` · `e2e TC-CUS-01` · customer "qa-orders-2026-10-13" · — · customer list 2026-10-13 · kept |
| D4 an approved order with 12 line items (TC-010, 011, 011b) | learning: nothing · helpers: the automation project creates orders through its API helper (found under the manifest's automation root) | `api (helper)` | the run's data-changes "yes" | temporary seed in scratch importing the helper, env selected by the project's profile variable; 12 line items in customer "qa-orders-2026-10-13"; identifiers read: order no. 10231; oracle: the order list (paginated) + a read-only API read for the line count; **stamped order date 2026-10-13** — TC-011 expects "order date = 2026-01-15" → observed against the stamped value, Deviation for skill 3 | `prepared (api)` · `helper` · order no. 10231 · order date = 2026-10-13 · order list + API read 2026-10-13 · kept |
| D6 an order whose approval expired yesterday (TC-015) | learning: nothing · helpers: none set dates · source: the expiry date is never accepted by the endpoint · db helper exists in the automation project | `db` — the only way to the state | separate "yes" (consent ask, answered yes) | seed sets the approval date of order no. 10232 (created by the same seed — own record only), read back; oracle: the order details screen shows "expired" | `prepared (db)` · `db (user yes 2026-10-13)` · order no. 10232 · approval date = 2026-10-12 · order details 2026-10-13 · kept |
| D8 an order approved by a user who no longer exists (TC-021) | learning: nothing · helpers / source: approvals require an active approver; deleting a user cascades to its approvals (code, checked) | none | — | — | `skip — not creatable` · read-only look + code 2026-10-13 · — · — · — · — ; TC-021 `SKIP`, Skips row `not creatable — approvals are removed with their approver (code, checked 2026-10-13)`; `[type: env]` learning line |

Verdict `READY-WITH-SKIPS (1 TC) — 3 gaps prepared`; `Decisions: ready 0 · prepared 3 (api 1 · ui 1
· db 1) · skipped 1 (data_missing 0 · not creatable 1 · QC declined 0)`; `### Deviations`: `D4
"an approved order with 12 line items": order date — TC-011 says 2026-01-15, the system stamped
2026-10-13; the observation used the stamped value — route to skill 3 --revision`; post-run ask:
three records listed, all kept; `**Data changes:** authorized · 4 made (1 by TCs · 3 preparations)
· 0 cleaned up · 4 kept · 0 left`; `**Data preparation:** e2e 1 · api helper 1 · api from source 0
· db 1 · kept 3 · cleaned up 0`. No `data_missing` anywhere.
