# Test-data preparation — the twelve principles and steps 4-7 of `<data_readiness>`

Loaded by `SKILL.md` at **Preparing Test Data** only when a requirement is `MISSING`, `UNKNOWN` or
`IMPOSSIBLE` after step 3 of `<data_readiness>` (`references/test-data-readiness.md`; steps 1-3, 8
and 9 are there). The twelve principles and the consent table below are word for word the ones of
skills 3b / 3c (`references/test-data-resolution.md`) and 5b (`references/test-data-preparation.md`);
edit every copy together.

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

**4. Discover the way per `MISSING` gap** (principle 1 — state what was found and where):
- `api (helper)` — an existing helper of the automation project that creates the entity (step
  2.3). **Available.**
- `api (source code)` — no helper, but the repository holds the application: a create route /
  controller / endpoint with its request shape, read from the source (skill 10's
  `.project-profile.md` names the layers when present; otherwise routes / controllers / API
  definitions outside `{automation_root}` and `Testing/`). Available **pending the QC's "yes"**.
  Swagger / openapi files or an API-documentation page alone → `to be confirmed`.
- `ui` — a common flow in the learning file (`## Common Flows`) or an approved TC that creates
  the entity through the screens → a setup journey built from page objects. **Available, no
  question.**
- `db` — a DB helper the project has, or a connection env var the QC names. Available only with
  the separate "yes".
- `manual` — always available (the QC inserts the data; the skill re-checks).
Fixed order, first available wins: `ui` (a documented journey) → `api (helper)` → `api (source
code)` → `db` → `manual`; the way the test-data file already decided (`How we handle it`) is
taken when it is still available.

**5. Ask the QC — ONE combined message, only for what needs an answer** (the
`<project_learning_file>` ask rule applies: learning file grepped first, nothing already answered
is re-asked). Gaps with a `ui` journey or an `api (helper)` way are **listed, not asked** — they
are prepared automatically; rows that need a "yes" are the `api (source code)` and `db` ones;
`UNKNOWN` / `IMPOSSIBLE` gaps with no way found are asked `manual | skip`:

```
Test-data readiness — {n} gaps; {p} will be prepared automatically, {m} need your yes
| # | Gap (plain English)                         | Affected TCs        | Status     | Way found                         | Planned fixture                                  | Needs |
|---|---------------------------------------------|---------------------|------------|-----------------------------------|--------------------------------------------------|-------|
| 1 | No order with line items in UAT             | TC-010, 011, 011b   | MISSING    | api (helper — order creation)     | 1 order, 12 line items, in a dedicated customer; the order date will be whatever the system stamps | — (prepared) |
| 2 | No customer without orders                  | TC-020              | MISSING    | ui (TC-CUS-01 journey)            | 1 customer "qa-{feature}-{date}"                 | — (prepared) |
| 3 | No order with an expired approval           | TC-015              | MISSING    | api (source code — order endpoint) then db for the date | 1 order, approval date set to yesterday | your yes (endpoint from source + database write) |
| 4 | No user with the Approver role              | TC-030, 030b        | NOT CREATABLE | — (roles are provisioned by the identity provider; none on UAT — configuration, checked) | — | — (skip — not creatable) |
Answer per row that needs it: yes | no | manual | skip — "no" skips the dependents (skip — QC declined).
db: also name the env var that holds the connection string (its value is never shown or stored).
manual: reply "done" when the data is in — I re-check that gap before running.
Keep or clean up is asked ONCE after the run (default keep).
```

Interactive → **WAIT** for the answer; the QC's reply is the decision of record. Pipeline /
non-interactive → a `ui` or `api (helper)` way is prepared without an answer (`source:
learning` when the learning file recorded it, `source: discovery` otherwise); `api (source
code)` and `db` are prepared only with a recorded learning-file "yes" for this environment
(`[type: qa]`), otherwise `skip — QC declined` with `no recorded authorization`; a gap with no
way → `skip — data_missing` with `no way found — searched: {sources}` (`source:
pipeline-default`); the run continues with the rest. Production named in the environment →
nothing is prepared (stated).

**6. Execute the decisions** — under the PHASE 2 rules (POM mandatory, no banned patterns,
never app business logic, never a credential in code, logs, or the learning file) and the twelve
principles:

| Decision | How | Teardown |
|---|---|---|
| `api (helper)` | a **temporary seed** composed in the session scratch folder: imports the helper by absolute path, selects `{env}` through the project's own mechanism (env var / config profile / CLI flag), creates the planned fixture, prints the identifiers; run once, output filtered for token / password lines, then deleted. It becomes a `prerequest/{Entity}PreRequest.ts` fixture (create + delete functions, find-or-create so re-runs are idempotent, wired through `beforeAll` / `afterAll` by single-line delegation per `<pom_mandatory>`) **only when the QC asks to keep it as code** | per the keep / clean-up answer (step 7); a kept fixture's delete function exists but is not wired to run |
| `api (source code)` | the same temporary seed, calling the endpoint found in the source with the project's own request helper and secret mechanism — after the QC's "yes" | same |
| `ui` | `tests/{Area}_Tests/00-setup-{entity}.spec.ts` — an end-to-end journey built ONLY from page objects (login → navigate → create → assert it exists), tagged `@setup @run:setup-{entity}`; the run plan schedules it FIRST as its own serial setup group, before smoke; **no question needed** | UI delete journey, or the api / db delete when one exists — run only on "clean up" |
| `db` | `{db_access} = helper` → the project's DB helper; otherwise SQL through Bash (`sqlcmd` / `psql` / `mysql`) reading the connection string from the QC-named env var **at run time** — refuse if unset; never echo, log, write, or paste the value anywhere; **only records this run created are touched, every write is read back**; insert + matching delete, both idempotent, both under `{data_setup_layer}` | delete script — run only on "clean up" |
| `manual` | wait for the QC's "done", then re-probe THAT requirement only | none (QC owns the data) |
| `skip — data_missing` / `skip — not creatable` / `skip — QC declined` | skip guard on every dependent TC with the gap's exact wording and reason; counted as `SKIP`, never a failure | — |

Rules that hold for every preparation:
- **Dedicated, right-sized fixtures** (principle 5): each gap gets its own clearly named,
  isolated parent record (`uniqueName(prefix)` from the test-data layer), sized to the TC's
  boundary (more rows than the upper limit the TC tests; exactly the count a count TC expects);
  one preparation serves several gaps only when they are compatible.
- **Seed once**: a failed test never re-seeds; the preparation runs before the first stage, and a
  re-run of a stage re-uses the records it created (find-or-create).
- **Verify before use** (principle 6): a gap is `MISSING→READY` only after its oracle confirmed
  it — the screen the TCs read (one MCP look) plus a read-only API or DB read when the screen
  hides the value (paginated lists, details-only fields). Not confirmed → `skip — data_missing`
  with `prepared but not confirmed on {screen}`, the records listed for clean-up.
- **Read back what the system decided** (principle 7): creation / publish dates, the current
  period, generated codes, sequence numbers are read back after the seed; the effective values
  are propagated into the generated specs **through the test-data layer** (`helpers/test-data.ts`
  exposes them per gap id — never a literal in a spec); every substitution is a `### Deviations`
  bullet `R{n}: {field} — TC says {literal}, system stamped {value}` and a step-wording finding
  for skill 3 `--revision`, never a silent change of the expected result.
- **Check the real rule, not just the screen** (principle 8): a permission / visibility /
  ownership precondition is verified against the rule's source as well (code, configuration or
  DB); a TC whose oracle relies on a misleading screen is a Deviation for skill 3, never a skip.
- **A refusal stops the step** (principle 10): the host's permission layer refusing the seed, a
  bulk creation, a DB write or a credential-bearing command → stop, report exactly what was
  refused and why, ask the QC to allow it; never worked around.
- **No secrets** (principle 11): credentials stay in the project's secret mechanism; nothing is
  printed, logged, stored or passed on a command line; captured output is filtered.
- **No app business logic in tests, no banned patterns** — the seed imports helpers; it never
  re-implements the application's rules.

**7. Keep or clean up — asked ONCE after the run (principle 12), default keep.** Every record a
preparation created is listed (gap, identity, stamped values, the clean-up way); "clean up R{n}"
runs that gap's delete through an existing helper or the UI journey; everything else is kept and
registered in `## Test Data` as a `[type: data]` line (plain English: what exists, counts,
identifiers, stamped values, environment, how it was created, date). A record that could not be
removed is `left` and listed in the final message.

**Worked example — four `MISSING` gaps, no "data missing" outcome.** Story "order approval",
UAT: (1) *an order with 12 line items* — the automation project already creates orders through
its API helper → `prepared (api)` without a question, temporary seed in scratch, order no. 10231
read back, **order date stamped by the system** and propagated through the test-data layer, a
Deviation for the TC that expected a literal date; (2) *a customer without orders* — TC-CUS-01
of the document creates one → `prepared (ui)`, the setup journey runs first; (3) *an order whose
approval expired yesterday* — no helper sets dates; the source holds the order endpoint, the
expiry date is only reachable in the DB → asked once, both "yes" → `prepared (db)` on the order
the same seed created, read back; (4) *an order approved by a user who no longer exists* —
approvals are removed with their approver (code, checked) → `skip — not creatable`, `[type: env]`
line. Verdict `READY-WITH-SKIPS (1 TC) — 3 gaps prepared`; post-run keep / clean-up asked once,
all kept and registered.
