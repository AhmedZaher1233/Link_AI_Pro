# Page-object duplicate fixtures (validator case 18)

Six automation roots, one per row of the plan's fixture table for the `pom-duplicate-page` rule.
Every file is a page class (takes a `Page` in its constructor) and is never executed by Playwright.

| Root | Files | `--inventory` | Expected |
|---|---|---|---|
| `same-name/` | `pages/OrderPage.ts` + `pages/checkout/OrderPage.ts` — same class name, different routes and locators | none | `review` (evidence `name`), gate BLOCKED |
| `same-route/` | `OrderListPage` + `OrdersOverview` — different names, both `goto('/orders')`, distinct locators | none | `review` (evidence `route`) |
| `prefixed-twin/` | `ListingPage.ts` (`ListingPage`) + `4-listingpage.ts` (`ListingPages`) — numeric prefix + case / plural variant | none | `review` (evidence `name`) — false-negative guard |
| `shared-route/` | `DashboardPage` + `DashboardWidgetPage` — same `/dashboard` route, distinct locators | `automation-inventory.md` names both in one row | `pom-duplicate-page-decided` (info) carrying the decision, `--strict` PASS |
| `shared-route/` | the same files | none | `review`, `--strict` BLOCKED (an unaddressed candidate fails the checkpoint) |
| `common-loader/` | `OrderPage` + `CustomerPage` — different names and routes, ONE common `app-loader` locator | none | no hit (the threshold is two identical locators) — false-positive guard |

Each root is scanned with `automationRoot` pointing at it, `--files` naming one of its page files
(so the scan has a subject) and `tests` pointing at an absent `tests/` folder (so the page files are
support files, not specs).
