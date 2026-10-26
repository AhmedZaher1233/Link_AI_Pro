# fixtures/parallel-plan — the mini story of `selftest-parallel-plan.mjs`

`project/` is a small Playwright POM automation root and `story/` its approved TC document, TEST-DATA, learning file and
run file. **Never installed, never executed** — `parallel-plan.mjs` only reads them. Every name is a neutral placeholder.
`selftest-parallel-plan.mjs` copies both folders to a temporary directory per case (some cases apply one text mutation)
and compares the payload with the values below, worked out by hand.

## The project

| File | What it exercises |
|---|---|
| `helpers/admission.ts` | the admission fixtures `workerAdmission` / `unitAdmission` — its presence switches the admission-contract check on |
| `fixtures/test.ts` | `signedIn` (test scope, depends on `unitAdmission`, signs in — compliant) · `seededOrder` (test scope, creates an order through `prerequest/` WITHOUT `unitAdmission` — the contract violation) · `catalog` (worker scope, depends on `workerAdmission`, creates its own catalog) |
| `prerequest/*.ts` | provisioning functions (`createOrder`, `deleteOrder`, `createCatalog`, `deleteCatalog`) — side effects by convention |
| `tests/…/01-orders-own.spec.ts` | TC-01, TC-02, TC-03, TC-05, TC-06 — single tests in a hook-free describe (U1) |
| `tests/…/02-orders-chain.spec.ts` | TC-10 → TC-11 → TC-12 in `test.describe.serial` (U2, never split) |
| `tests/…/03-orders-shared.spec.ts` | TC-20, TC-21 under a `beforeAll` that creates the fixed record "Shared order" and takes `workerAdmission`, and an `afterAll` that deletes it (U3) |
| `tests/…/04-orders-dashboard.spec.ts` | TC-04 — the order count (an aggregate read) |
| `tests/…/05-orders-misc.spec.ts` | TC-30 (uses `seededOrder` → U4), TC-31, TC-32 (declared in a loop with a template title → U4), TC-33, TC-34 (`@negative`), TC-35 |
| `tests/…/06-catalog.spec.ts` | TC-40, TC-41 sharing the worker fixture `catalog` (U3) |

## The claims (from `story/TEST-CASES-orders.md` + TEST-DATA + the learning file)

| TC | Claims | Class |
|---|---|---|
| TC-01 | `acct:A1` read · `col:order` own write (Data effect creates, "New order") | restricted |
| TC-02 | `acct:A1` read · `rec:D1` read · `col:product` + `col:product@D1` aggregate · `learned:L1` | restricted (learned, revalidate: TC-02's hash ≠ `00000000`) |
| TC-03, TC-05 | `acct:A1` read | parallel-ready (the pool) |
| TC-04 | `acct:A1` read · `col:order` aggregate ("order count") | restricted |
| TC-06 | `acct:A1` read · `col:order` aggregate ("latest", "search") · `bg:audit@order` aggregate · `learned:L1` | restricted |
| TC-10 | `col:order` own write | ordered (chain) |
| TC-11, TC-12 | `shared:lifecycle-order` write · `col:order` write (not own) · depends on TC-10 / TC-11 | ordered (chain) |
| TC-20, TC-21 | `shared:shared-order-d2` write · `rec:D2` read; the unit adds the hook's `col:order` write and `rec:lit:order:shared order` | restricted |
| TC-30 | `col:order` write (approves an order it did not create); the unit adds `seededOrder`'s own `col:order` write | restricted, U4 |
| TC-31 | exclusive `*` — Data effect modifies, no record named (fail safe) | run-alone |
| TC-32 | `acct:A1` read | parallel-ready, U4 |
| TC-33 | exclusive `*` — changes a system setting | barrier |
| TC-34 | `acct:A2` write — a wrong password counts toward A2's lockout | restricted |
| TC-35 | `acct:A2` read | restricted |
| TC-40, TC-41 | `acct:A1` read; the unit adds `catalog`'s own `col:catalog` write | parallel-ready, U3 |
| TC-50 | — (Automation Candidate NO, no test) | not-scheduled |

Every unit writing `col:order` (TC-01, the chain, the shared-order unit, TC-30) also gets an own `bg:audit@order` write,
because TC-06 observes the audit effect of orders.

## Expected results of the baseline

- 15 units, in order: u1 TC-01 · u2 TC-02 · u3 TC-03 · u4 TC-05 · u5 TC-06 · u6 TC-10..12 (U2) · u7 TC-20..21 (U3) ·
  u8 TC-04 · u9 TC-30 (U4) · u10 TC-31 · u11 TC-32 (U4) · u12 TC-33 · u13 TC-34 · u14 TC-35 · u15 TC-40..41 (U3).
- Pool: u3, u4. 16 pairwise conflicts (u1–u5, u1–u6, u1–u7, u1–u8, u1–u9, u2–u5, u5–u6, u5–u7, u5–u9, u6–u7, u6–u8, u6–u9,
  u7–u8, u7–u9, u8–u9, u13–u14) + 2 global entries (u10, u12).
- Candidate concurrency 7 (greedy over u1, u2, u3, u4, u11, u13, u15); serial-only 195 000 ms over 5 known units.
- Candidate plan: `parallel` [TC-03, TC-05, TC-32] · `serial:order` [TC-01, TC-02, TC-04, TC-06, TC-10, TC-11, TC-12, TC-20,
  TC-21, TC-30] · `serial:catalog` [TC-40, TC-41] · `account:A2` [TC-34, TC-35] · `serial:alone-tc-31` · `serial:barrier-tc-33`.
- Against the hand plan in `story/.runs/phase-1.json`: 19 compared, 14 agree, 5 differ (TC-01, TC-02, TC-06, TC-40, TC-41 —
  hand parallel, candidate serial).

Changing a file here changes these expectations: re-run `node ../../selftest-parallel-plan.mjs --pretty` and adjust the
harness only for a deliberate change.
