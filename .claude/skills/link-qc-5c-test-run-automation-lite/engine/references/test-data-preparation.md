# Test-data preparation — the twelve principles and steps 4-7 of `<data_readiness>`

Loaded by `SKILL.md` at **Preparing Test Data** only when a requirement is `MISSING`, `UNKNOWN` or `IMPOSSIBLE` after
step 3 of `<data_readiness>` (`test-data-readiness.md` holds steps 1-3, 8-9). The twelve principles and the consent
table are word for word those of skills 3b / 3c and 5b; edit every copy together.

## P. The twelve principles

`{env}` = target environment, `{item}` = a data item (`D{n}`), `{entity}` = its record type, `{automation_root}` =
`paths.automationRoot` of `Testing/qa-manifest.json`.

1. **Discover before skipping** — for every `MISSING` / `UNKNOWN` item, in order: learning-file `[type: data]` / `[type: env]` lines and decisions → the project's test-data helpers (manifest paths, then create / seed / fixture / factory / pre-request / setup modules and API clients under `{automation_root}`) → the application's own create endpoints read from its source (skill 10's `.project-profile.md` first; else routes / controllers / API definitions outside `{automation_root}` and `Testing/`) → a UI setup journey → an existing database helper → manual; record where each was found. A way is **available** only when existing code, a screen seen live or a recorded decision proves it; API documentation alone = `to be confirmed`.
2. **The skill prepares the item itself, with the consent its way needs** — never asks the QC to run a script / seed / import; a UI journey needs no question; an existing helper runs under the run's data-changes "yes"; an endpoint from the source and a database write each need an explicit "yes" naming the item, asked ONCE together after discovery, before the dependents; keep or clean up asked ONCE after the run; production in the environment note stops every preparation (stated, never asked).
3. **A temporary seed, never new code in the repository** — composed in the session scratch folder, imports the project's helpers by absolute path, selects `{env}` through the project's own mechanism, runs once, identifiers captured, then deleted; a reusable fixture only when the QC asks, then under skill 5's placement and code rules.
4. **Database writes are a separate consent** — only for a state no API or UI can reach, after an explicit "yes" naming the item; own records only, every write read back, no pre-existing record modified.
5. **Dedicated, right-sized fixtures** — own clearly named, isolated parent record per item, sized to the TC's boundary (more rows than the upper limit tested, exactly the count a count TC expects); one preparation serves several items only when compatible.
6. **Verify before use** — `READY` only after its oracle confirmed it: the screen the TC reads, plus a read-only API / DB read when the screen hides the value; dependents run only after that.
7. **Read back what the system decided** — creation / publish dates, current period, generated codes, sequence numbers are read back and used in place of the TC's literals; every substitution recorded and routed to skill 3 `--revision` when the TC text should change.
8. **Check the real rule, not just the screen** — a permission / visibility / ownership precondition is verified against the rule's source (code, configuration, database); a misleading-screen oracle is a finding for skill 3, never a reason to skip.
9. **"Not creatable" is its own outcome** — evidence that the state cannot exist on `{env}` → `NOT CREATABLE` with its evidence (never "data missing"), written to the learning file.
10. **A permission-system refusal stops the step** — report exactly what was refused and why, ask the QC to allow it (a permission rule or a one-time approval); never work around it.
11. **No secrets anywhere** — credentials stay in the project's secret mechanism; never printed, logged, stored or on a command line; token / password lines filtered from every captured output.
12. **Keep or clean up — asked once, after the run** — default keep, recorded in the learning file; clean-up only through an existing helper or the UI; everything left behind listed in the final message.

**Consent by way** — the same table in all four skills:

| Way | Found by | Before preparing | After the run |
|---|---|---|---|
| `e2e scenario` — a UI journey (a creating TC, a learning-file common flow, a creation screen seen live) | principle 1 steps 1, 4 | **no question** — prepared automatically before its dependents; the only guard is production named in the environment note | ONE keep / clean-up question listing every record created |
| `api` — an existing project helper (fixture / factory / pre-request / seed under `{automation_root}`) | step 2 | the run's data-changes "yes", nothing more | same |
| `api` — an endpoint read from the application's source (no helper) | step 3 | **explicit "yes" per item**, asked ONCE with every other such item after discovery: the endpoint in plain words, the request summary, authentication through the project's secret mechanism, the TCs it unblocks | same |
| `db` — a project database helper, or a connection variable the QC names | step 5 | **separate explicit "yes"** naming the item; own records only, read back | same |
| nothing found · `NOT CREATABLE` · QC declined | — | skip with the precise reason (`no way found` · `not creatable — {evidence}` · `QC declined`) | — |

**4. Discover the way per `MISSING` gap** (principle 1 — state what was found and where): `api (helper)` — an
existing helper of the automation project that creates the entity: **available**. `api (source code)` — a create
route / controller / endpoint with its request shape, read from the application's source: available **pending the
QC's "yes"**; Swagger / openapi files or an API-documentation page alone → `to be confirmed`. `ui` — a `## Common
Flows` entry or an approved TC that creates the entity through the screens → a setup journey from page objects:
**available, no question**. `db` — a DB helper the project has, or a connection env var the QC names: only with the
separate "yes". `manual` — always available (the QC inserts, the skill re-checks). Fixed order, first available wins:
`ui` (a documented journey) → `api (helper)` → `api (source code)` → `db` → `manual`; the way the test-data file
already decided (`How we handle it`) is taken when still available.

**5. Ask the QC — ONE combined message, only for what needs an answer** (`<project_learning_file>` ask rule: learning
file grepped first, nothing already answered is re-asked). `ui` / `api (helper)` gaps are **listed, not asked** (prepared
automatically); `api (source code)` and `db` rows need a "yes"; `UNKNOWN` / `IMPOSSIBLE` gaps with no way are asked
`manual | skip`:

```
Test-data readiness — {n} gaps; {p} will be prepared automatically, {m} need your yes
| # | Gap (plain English) | Affected TCs | Status | Way found | Planned fixture | Needs |
| 1 | No order with line items in UAT | TC-010, 011, 011b | MISSING | api (helper — order creation) | 1 order, 12 line items, in a dedicated customer; the order date will be whatever the system stamps | — (prepared) |
| 2 | No order with an expired approval | TC-015 | MISSING | api (source code — order endpoint) then db for the date | 1 order, approval date set to yesterday | your yes (endpoint from source + database write) |
Answer per row that needs it: yes | no | manual | skip — "no" skips the dependents (skip — QC declined).
db: also name the env var that holds the connection string (its value is never shown or stored).
manual: reply "done" when the data is in — I re-check that gap before running.
Keep or clean up is asked ONCE after the run (default keep).
```

Interactive → **WAIT**; the QC's reply is the decision of record. Pipeline → `ui` / `api (helper)` prepared without an
answer (`source: learning` when the learning file recorded it, else `discovery`); `api (source code)` / `db` only with
a recorded learning-file "yes" for this environment (`[type: qa]`), else `skip — QC declined` with `no recorded
authorization`; no way → `skip — data_missing` with `no way found — searched: {sources}` (`source: pipeline-default`);
the run continues. Production named → nothing is prepared (stated).
**API / DB TCs (3.0):** data-changing `[API]` / `[DB]` TCs → the SAME message carries the `<data_changes_gate>` of
`api-db.md` below the table (all · TC-IDs · none) — never a second question; the preparation "yes" (`api (source
code)` / `db` rows) is recorded as `data_changes.setup` and its writes go through the recorded request / client with
`purpose: 'setup'` so their keys are ledger-owned and an update / delete TC may change them. A production, unknown-class
or unverified target gets neither.

**6. Execute the decisions** — under the PHASE 2 rules (POM mandatory, no banned patterns, never app business logic,
never a credential anywhere) and the twelve principles:

| Decision | How | Teardown |
|---|---|---|
| `api (helper)` | a **temporary seed** in the session scratch folder: imports the helper by absolute path, selects `{env}` through the project's own mechanism, creates the planned fixture, prints the identifiers; run once, output filtered for token / password lines, then deleted. A `prerequest/{Entity}PreRequest.ts` fixture (create + delete, find-or-create, wired through `beforeAll` / `afterAll` per `<pom_mandatory>`) **only when the QC asks to keep it as code** | per step 7; a kept fixture's delete function exists but is not wired |
| `api (source code)` | the same temporary seed, calling the endpoint found in the source with the project's request helper and secret mechanism — after the QC's "yes" | same |
| `ui` | `tests/{Area}_Tests/00-setup-{entity}.spec.ts` — a journey built ONLY from page objects (login → navigate → create → assert it exists), tagged `@setup @run:setup-{entity}`; scheduled FIRST as its own serial setup group, before smoke; **no question** | UI delete journey, or the api / db delete when one exists — only on "clean up" |
| `db` | `{db_access} = helper` → the project's DB helper; otherwise SQL through Bash (`sqlcmd` / `psql` / `mysql`) reading the connection string from the QC-named env var **at run time** — refuse if unset; never echo, log, write or paste the value; **own records only, every write read back**; insert + matching delete, both idempotent, under `{data_setup_layer}` | delete script — only on "clean up" |
| `manual` | wait for the QC's "done", then re-probe THAT requirement only | none (QC owns the data) |
| `skip — data_missing` / `not creatable` / `QC declined` | skip guard on every dependent TC with the gap's exact wording and reason; counted as `SKIP`, never a failure | — |

For every preparation — principles 5, 8, 10 and 11 apply as written; on top: **seed once** (a failed test never
re-seeds; the preparation runs before the first stage; a stage re-run re-uses its records, find-or-create); **verify
before use** (principle 6) on the screen the TCs read (one MCP look) plus a read-only API / DB read when the screen
hides the value — not confirmed → `skip — data_missing` with `prepared but not confirmed on {screen}`, records listed
for clean-up; **stamped values** (principle 7) reach the specs only through `helpers/test-data.ts` (per gap id, never a
literal in a spec), every substitution a `### Deviations` bullet `R{n}: {field} — TC says {literal}, system stamped
{value}` and a step-wording finding for skill 3 `--revision`; the seed imports helpers, never re-implements the
application's rules.

**7. Keep or clean up — asked ONCE after the run (principle 12), default keep.** Every record a preparation created is
listed (gap, identity, stamped values, the clean-up way); "clean up R{n}" runs that gap's delete through an existing
helper or the UI journey; everything else is kept and registered in `## Test Data` as a `[type: data]` line. A record
that could not be removed is `left` and listed in the final message.
Detail: references/maintainers/test-data-preparation.md §P, steps 4-7
