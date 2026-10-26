# fixtures/impact — the mini automation root of `selftest-impact.mjs`

`project/` is a small, realistic Playwright Page Object Model project. It is **never installed and
never executed** (there is no `node_modules/`; `playwright:version` therefore fingerprints as `none`).
`selftest-impact.mjs` copies it to a temporary directory per case, applies one text mutation and
compares the TCs whose fingerprint changed with the expected set. Every name, label, route and
account is a neutral placeholder.

| File | What it exercises |
|---|---|
| `package.json` | declares `@playwright/test`, so bare imports of it are library code, not unresolved |
| `tsconfig.json` | JSONC (comments, trailing commas); `baseUrl` + `paths` aliases `@pages/*`, `@helpers/*` |
| `playwright.config.ts` | global parts; references `TIMEOUTS.test / expect / action / navigation.default` (global keys) |
| `timeouts.ts` | `export const TIMEOUTS = {…}` parsed at key level (`operations.save` reached only through `OrderPage.save`) |
| `helpers/steps.ts` | a non-class helper (whole `file:` part) imported by every page; references `TIMEOUTS.step.default` |
| `helpers/format.ts` | a non-class helper imported by two specs only (case 9) |
| `helpers/data/orders.json` | a data file read by TC-04 through a path literal (case 17) |
| `pages/BasePage.ts` | parameter property `page: Page`; `open()` reached by almost every test (case 14b) |
| `pages/LoginPage.ts` | locator fields assigned in the constructor; `login(): Promise<DashboardPage>` (case 16) |
| `pages/DashboardPage.ts` | locator field initializers off `this.page`; `openOrders(): Promise<OrderPage>` |
| `pages/OrderPage.ts` | locator fields, `this.m()` calls, `TIMEOUTS.operations.save`, `table = new DataTable(…)`, `goto(): Promise<this>`, an unreached `exportCsv()` (case 23) |
| `pages/ArchivedOrderPage.ts` | `extends OrderPage`, overrides `goto()`, calls the inherited `save()` (case 14); a top-level constant (case 10b) |
| `pages/components/DataTable.ts` | a component reached through `this.table` and through `export *` (case 10c) |
| `pages/index.ts` | barrel: `export * from` and `export { X } from` |
| `fixtures/test.ts` | `base.extend<{ orderPage: OrderPage; signedIn: LoginPage }>` — `orderPage` depends on `signedIn` (case 15) |
| `tests/Orders_Tests/00-setup-order-items.spec.ts` | the setup journey of `setup:orders`; its test carries no TC (case 18) |
| `tests/Orders_Tests/01-orders.spec.ts` | TC-01 … TC-08: a describe with `beforeEach` and `describe.configure({ mode })`, `@run:` tags, a spec-level and a describe-level constant, an alias import, a barrel import, a fixture, a data file, `[TC-07][TC-08]` plus TC-07's own test |
| `tests/Orders_Tests/03-orders-dashboard.spec.ts` | TC-09, TC-10 — imports neither `format.ts` nor the barrel |
| `tests/Other_Tests/02-other.spec.ts` | TC-90, TC-91 — another story reusing `OrderPage` (outside scope, case 20) |

Cases 14e / 14f prove that a base-typed receiver (`openOrders(): Promise<OrderPage>`) also reaches the
`ArchivedOrderPage` overrides — but only where that subclass is in the spec's import closure (01 yes, 03 no).
Cases 18d / 18e prove the explicit `setup_groups[].feeds: ["serial:…"]` link beside the `setup:{gap}` name match.

`extra/04-dynamic.spec.ts` is **not** part of the clean project (case 1 asserts that no TC is
`unknown`); case 12 copies it to `tests/Dynamic_Tests/` to prove that `(orders as any)[action]()`
makes TC-80 `unknown` while TC-81's static call does not.

Cases 25-28 (`reverseDependencies`, `closureOf`, the `reverse` command) read the same project: `helpers/data/orders.json`
is reached by TC-04 only, `helpers/format.ts` by the tests of `01` and `02`, `03-orders-dashboard.spec.ts` by TC-09 / TC-10,
`playwright.config.ts` by every TC; with the run plan the setup journey reaches TC-04 through `setup:orders`; the copied
`extra/04-dynamic.spec.ts` makes TC-80 `unknown`, which reverse dependencies always include.

Changing a file here changes the expectations of the harness: re-run
`node ../../selftest-impact.mjs --pretty` and adjust the expected TC sets only for a deliberate change.
