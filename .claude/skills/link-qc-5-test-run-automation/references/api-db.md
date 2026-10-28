# API and DB test cases (3.0) — layers, mapping, the data-changes gate, records and clean-up

Loaded only when the TC document has `[API]` / `[DB]` lines (activities 1, 2, 4, 5 and 8 — the Workflow Load column).
The code rules live in `code-craft.md` §16-19; the checks in `compliance-checkpoints.md` §2 items 51-54. Nothing here
applies to a UI-only document, and a UI-only run behaves exactly as in 2.x.

<backend_layers>

## 1. Layer of a TC — decided by `tcLayer`, never by judgement

Skill 3 marks a Steps or Expected Result line with `[API]` or `[DB]` (its `tc-design.md` § "API and DB test cases").
`tc-hash.mjs --layers` (and every script that needs it) classifies each TC from its **Steps** lines only —
Preconditions, Data effect and clean-up notes never count; a `[HUMAN]` line is neutral:

| Layer | Rule | Playwright project | Evidence |
|---|---|---|---|
| `ui` | ≥ 1 unmarked step, no `[API]` / `[DB]` line | browser (`chromium`) | image |
| `api` / `db` / `api+db` | no unmarked step; every action step marked | `backend` | record (api / db / both) |
| `hybrid` | ≥ 1 unmarked step **and** ≥ 1 `[API]` / `[DB]` line | browser | image **and** record |
| `unknown` | no action step, or an unmarked Expected line in a TC without a UI step | — | not generated: `NOT_RUN — not started: layer unknown` + a skill 3 `--revision` note |

Routing: `api`, `db`, `api+db` → `run_plan.backend_project` (`backend`, matching `*.api.spec.ts` / `*.db.spec.ts`; the
browser project ignores those files — `code-craft.md` §8); `ui`, `hybrid` → the browser project. Record the run plan's
`layers` (TC → layer) and `backend_project`; `run-data.mjs defaultProjectFor` routes from them and check 25b FAILs a
TC executed in the wrong project. The validator classifies every TEST from its parameters and fixtures
(`layer-unresolved` holds the scanner gate BLOCKED, `layer-mismatch` — document vs code — is a non-exemptible
violation), and the evidence a TC needs is the union of both layers. Never re-label a TC to make a check pass.

## 2. Intake additions (activity 1)

- **Profile keys** (`<project_profile>`, recorded once): `api_client` (the project's existing API client / OpenAPI
  client, or `none`), `api_auth` (its API-auth helper or the login endpoint, by role — never a token), `db_client`
  (`pg` · `mssql` · `mysql2` · `oracledb` · `prisma` · `knex` · `typeorm` · `sequelize` · `none`, detected from the
  automation root's and the application's `package.json`) and `db_access` (`env:{VAR}`, default `QA_DB_URL` /
  `QA_DB_{NAME}_URL`). Read skill 10's `.project-profile.md` first when it exists.
- **No DB client** while a TC has a `[DB]` line → ONE question inside the intake block: *add the matching
  devDependency (`pg` / `mssql` / `mysql2`) to the automation project?* Yes → add it (the only dependency change this
  skill makes); no → those TCs are `NOT_RUN — not started: db unavailable (no client)`. Pipeline → no.
- **The environment** (TEST-DATA `## 0. Environment`): the `API base` host(s) → `environment.api_hosts`; the
  `Database` logical identity (`"{db} @ {server alias} ({engine})"`) → `environment.db_identity`; the `Environment
  class` (`test` · `staging` · `production`) → `environment.class` — absent = unknown = treated as production; the
  learning file's production markers → `environment.production_markers`; `db_access` → `environment.db_env_var`.
  The connection string is never read, printed or stored — only the variable's NAME.

## 3. Mapping business words to an operation (activity 2) — from a verified contract only

A `[API]` / `[DB]` line names an operation in business words unless the approved source named the path / table.
Map each one to a concrete endpoint or query **only from a verified contract** — the OpenAPI file, the route /
controller source, a migration or ORM entity — and record it in the automation inventory's **API / DB mapping**
table:

| Operation | Method | Path | Effect | Evidence |
|---|---|---|---|---|
| search orders | POST | /api/orders/search | read | src/routes/orders.ts:41 (no write in the handler) |
| create order | POST | /api/orders | mutation | src/routes/orders.ts:12 (repository.save) |

- **`Effect` is decided by the contract, never by the HTTP method**: `mutation` when the handler / service writes
  (repository / ORM save · insert · update · delete, an emitted event or job), `read` when it provably does not, `auth`
  for a login / token call, `unknown` without evidence. A POST search can be `read`; a GET with side effects is
  `mutation`. `unknown` is treated as a mutation everywhere (gate, ownership, serial lane).
- A mapped `mutation` against a TC whose `Data effect` says `none` is a **mapping conflict** — handled like an
  unresolved mapping. An unresolved mapping parks the TC (`<open_questions>`; unanswered →
  `NOT_RUN — not started: mapping unresolved (Q-{n})`), never a guessed endpoint, payload, table or value.
- Expected values always come from the TC; the mapping only says WHERE to look.
- The table is passed to the validator (`--inventory`) and to `parallel-plan.mjs --inventory`; every `api/` client
  method declares the same `effect` (`api-effect-undeclared` / `api-effect-mismatch`, non-exemptible).

</backend_layers>

<data_changes_gate>

## 4. The data-changes gate (activity 4) — the tester's yes, per TC list

A **data-changing TC** is one with a `[DB]` write (`Create / Update / Delete …`), an `[API]` call whose mapped effect is
`mutation` or `unknown`, or a `Data effect` other than `none`. Before the first stage, in the **same message** as the
test-data preparation consent (`test-data-preparation.md` step 5 — the run asks no extra question), list them:

> **Data changes.** {n} test cases change data on {API host · DB identity (verified | unverified)} — environment class
> {class}: TC-04 (creates an order), TC-07 (deletes the order it created; cascade: order_lines, owned) …
> Allow: **all** · **TC-IDs** · **none**? (Recommended: all — every write is limited to records this run creates.)

- The target shown is the one the helpers will verify: `db-record` compares the engine's own identity
  (`current_database()` / `DB_NAME()` / `database()` and the server) with `environment.db_identity` on connect.
- **Production, an unknown class, an unverified identity or a production marker → no question; nothing is
  allowed** (the data-changing TCs are `NOT_RUN — not started: data changes not permitted (…)`). Reads still run and
  their records say `identity: unverified` when it could not be checked.
- `--allow-data-changes all|TC-01,TC-03|none` answers in advance; a pipeline run without it is `none`. The answer is
  per run, never persisted, never written to the learning file.
- Record `data_changes {consent, tcs[], setup, cleanup, teardown, asked_at}` in the run file, one `### Deviations`
  line, and name it in the final message. `run-stage.mjs` passes `PW_DATA_CHANGES_TCS` (and `PW_DATA_CHANGES_SETUP`
  for preparation writes) to a command **only for an environment of class `test` / `staging`**; the helpers check the
  current test's TC on every write. Consent never permits a side effect the helper cannot verify (cascades, triggers,
  row counts — `code-craft.md` §17): that write is refused whatever the answer.
- Update / delete TCs work only on records created earlier in the same TC or by **this run's** preparation (which
  ledgers its keys with `purpose: setup`); a pre-existing `D{n}` row is never modified.

</data_changes_gate>

<backend_results>

## 5. Status of a backend step (activity 5) — mapped by `run-stage.mjs`, fail-closed

| Event | TC status |
|---|---|
| `[API]` status / body assertion fails | FAIL `api_contract_failure` (bug) |
| `[DB]` check assertion fails | FAIL `db_assertion_failure` (bug) |
| auth call 401 / 403 the TC did not expect | INCOMPLETE `auth_failure` |
| no DB client / variable unset / mapping unresolved / config missing | NOT_RUN `not started: {db unavailable \| mapping unresolved \| config missing} (…)` |
| write not consented, target production / unverified | NOT_RUN `not started: data changes not permitted (…)` |
| write on a non-owned record or resource; cascade, trigger, row-count or identity guard | INCOMPLETE `data_write_refused ({ownership \| cascade \| trigger \| row-count \| identity})` + item 53 FAIL |
| redirect to a non-permitted host; a mutation answered 301 / 302 / 303 | INCOMPLETE `redirect_refused` |
| write error / rollback | INCOMPLETE `data_write_failed` |
| read-back differs | INCOMPLETE `read_back_mismatch` |
| an intent without an outcome after a crash, still unresolved | INCOMPLETE `data_in_doubt` · item 53 unresolved · run NOT ACCEPTED |
| teardown failed | PASS → INCOMPLETE `cleanup_incomplete` (a FAIL stays FAIL + note) |
| record missing / unreadable / malformed / redaction-blocked / not matching | PASS → INCOMPLETE `evidence_invalid ({reason})` |
| 429 / rate refusal | INCOMPLETE `rate_limited` (unchanged) |

One call per stage stays the rule: a stage with backend and browser TCs is ONE `run-stage.mjs` call with
`--project chromium,backend`; a command whose TCs are all backend reserves the lighter `backend` capacity kind (same
slot, same ceiling). After every command `run-stage` validates each executed backend / hybrid attempt's record
(schema, TC and attempt, every backend Expected line `ER{n}` with a passing assertion, the redaction re-scan) and
downgrades a PASS that fails it. Data-changing TCs run in the `serial-mutation` lane of the parallel readiness check
unless their isolation is proven (`<parallel_readiness>`); read-only API / DB TCs parallelise normally; browser and
`request` traffic to one backend share one rate-limit book.

## 6. Clean-up, retained and in-doubt records (activity 8)

- Each test's own teardown removes what it created, after its record, through the same guarded path (reverse order,
  absence read back). The ledger (`artifacts/progress/*.data-ledger.jsonl`, one per command) is the only list of what
  the run owns; `run-stage`'s summary carries `data_ledger {writes, in_doubt, retained, orphaned, removed}`.
- **Kept or orphaned records** → ONE question after the run, together with the test-data keep / clean-up question
  (default keep), asked before the drafts. Clean up → `data_changes.cleanup: yes` in the run file, a `setup_groups`
  entry `{ name: "data-cleanup", spec: "tests/_cleanup/data-ledger.cleanup.api.spec.ts", workers: 1 }` in the run
  plan (`run_plan_adjustments[]` when the plan is frozen) and ONE call `run-stage.mjs --stage setup --run rerun --groups
  data-cleanup --project backend …` under the lease; the spec deletes only ledger-owned records through the guarded
  path, never an in-doubt one, and lists what it could not remove.
- **In doubt** (an intent with no committed / rolled-back line): the next DB attach resolves it by a read-only lookup of
  the intended identity (match → recovered, owned; prior state → rolled back); otherwise it stays in doubt, is never
  cleaned, and blocks acceptance until the tester resolves it.
- The report lists them in `### Retained test records` / `### In-doubt test records` — the ready sub-sections
  `run-data.mjs report` returns as `retainedTable` / `inDoubtTable` from the ledgers (resource, key, TC, reason —
  nothing sensitive; never written by hand) — `run-report.md` §4.

</backend_results>
