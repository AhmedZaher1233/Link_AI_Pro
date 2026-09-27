# `validate-automation.mjs` — contract, rules, exceptions and limits

A read-only static screen over generated Playwright automation. Zero dependencies, Node ≥ 18,
never writes anything. **It is a screen, not a judge**: it reports what a token-level scan over
comment/string-stripped source can establish, and routes everything else to semantic review.

## Running it

```bash
node .claude/skills/link-qc-5-test-run-automation/scripts/validate-automation.mjs \
  --root <project> --pretty \
  [--files a.spec.ts,b.spec.ts] [--tests-path <dir>] [--pages-path <dir>] \
  [--tc-ids <csv|file>] [--req-ids <csv|file>] [--allow-file <path>] \
  [--evidence-fn captureEvidence] [--treat-as-spec] [--require-steps] \
  [--automation-root <dir>] [--inventory <automation-inventory.md>] [--strict]

node .claude/skills/link-qc-5-test-run-automation/scripts/selftest.mjs      # exits 1 on mismatch
node .claude/skills/link-qc-5-test-run-automation/scripts/validate-automation.mjs --help
```

`--files` should carry the page objects, components, fixtures and helpers the specs touch as well
as the specs: the wait, `networkidle` and positional-selector rules apply in every layer, and a
file the scanner never sees is never checked (support files reached by call resolution are only
searched for assertions and evidence). `--require-steps` turns on `step-missing` — pass it for the
specs this run generated or updated, not for legacy specs.

Paths resolve CLI flag → `Testing/qa-manifest.json` (`paths.tests`, `paths.pages`,
`paths.automationRoot`) → canonical `Testing/Automation/*`. Scope is `--files`, else every spec
under the tests path.

`--tc-ids` / `--req-ids` take a comma list or a file (the approved TC document, `ADO-MAP.md`, the
REQ file — IDs are read out by token). **Without them the ID rules do not run**; they land in
`notRun[]`, never in a PASS. The script never derives or invents an ID.

`--inventory <automation-inventory.md>` is the story's page-object decision table
(`{reports_folder}/automation-inventory.md`, written by `<automation_inventory>` before any file is
generated). The page-class pass runs with or without it — over the **whole automation root**, not
only `pages/` — and every candidate pair it finds is `pom-duplicate-page` (`review`) until a row of
the table names both classes, which turns it into `pom-duplicate-page-decided` (`info`, carrying the
row's decision). Pass the file on every run; an inventory path that does not exist or holds no
decision table is `pom-inventory-unreadable` (warning) and decides nothing.

**Run the project's own tooling first where it exists** — ESLint with `eslint-plugin-playwright`,
`tsc`, an existing lint script. This script covers the rules those do not.

## Output

One JSON object: `{ tool, schemaVersion, readOnly, root, generatedOn, config, scope, pageScan,
fingerprint, findings[], review[], exceptions[], notRun[], traceability, counts, gate, gateReason,
complianceNote, limits[] }`. `pageScan` lists every page class the root walk found (file, line,
name, base class, route literals, locator count), the candidate / decided / undecided counts and the
inventory file used — it is the machine half of the `<automation_inventory>` scan.

Severities: `violation` (moves the gate) · `warning` · `review` (undetermined — blocks a *compliance*
PASS until closed) · `info`.

### The scanner gate

| gate | when |
|---|---|
| `NOT_RUN` | nothing was analysed — folder missing, no spec matched, scope selector matched nothing |
| `BLOCKED` | the scan started but its evidence is incomplete — a file in scope was unreadable or unscannable; **or** a `pom-duplicate-page` candidate pair has no inventory decision (see below) |
| `FAIL` | scan complete, ≥1 non-excepted violation |
| `PASS` | scan complete, zero violations — **and nothing more than that** |

A `PASS` with open `review[]` / `notRun[]` items is normal and expected. **The scanner gate is not
the compliance gate** — see `compliance-checkpoints.md` §1. The one review item that DOES move the
scanner gate is an undecided `pom-duplicate-page`: Checkpoint A cannot open until every candidate
pair has a row in `automation-inventory.md`, and that row is the documented semantic review — pass
it back through `--inventory` and the item closes mechanically (`--strict` exits 2 until then).

**Every `review[]` and `notRun[]` entry is an APPLICABLE check that did not complete.** Each carries
`applicable: true` and a `resolution` line saying so. Closing one requires supplying the missing
input, other project tooling, or documented semantic review — recording it as PASS, or as `N/A`, is
invalid, and leaving it open keeps the compliance checkpoint BLOCKED for that item. `N/A` belongs
only to a rule that has **no subject** in this scope (no ADO linkage, no modifier in scope, no API
fixtures), with the reason naming why it has none.

> **What the script does and does not do here.** `applicable`, `resolution` and `complianceNote`
> are **text the script emits for the reader**. They state the rule; they do not apply it. The
> script cannot tell whether you performed the semantic review, whether you classified something
> `N/A` honestly, or whether you went on to declare `AUTOMATION COMPLETE` with an item still open —
> it has no visibility into any of that. Those are followed because `SKILL.md` and
> `compliance-checkpoints.md` instruct it, in the same way as every other rule in this skill.

### Exit codes

Default **0** always, with the verdict in the payload (the convention every read-only script in this
suite follows). `--strict` maps the gate: `PASS` 0 · `FAIL` 1 · `BLOCKED` 2 · `NOT_RUN` 3 — so a CI
job cannot mistake "found nothing to check" for "everything passed". An internal error is caught and
emitted as `gate: BLOCKED`; a stack trace never reaches stdout.

**If the validator cannot run at all, report it as unavailable — never as passed.**

## Rules

### Definite violations

| Rule | Exemptible | What it catches |
|---|---|---|
| `focus-only` | no | `test.only`, `describe.only`, `fit`, `fdescribe`, including `import { test as t }` and `const t = test` aliases |
| `modifier-no-reason` | no | `skip`/`fixme`/`fail`/`slow` — bare, conditional or suite-level — with no reason argument and no justification comment |
| `placeholder-assertion` | no | literal-vs-literal assertions only |
| `empty-test-body` | no | a test body that is empty or comments only |
| `no-assertions` | no | no assertion in the body **and** none in any method it calls, every hop followed |
| `evidence-missing` | no | same, for the evidence call |
| `evidence-in-hook` | no | evidence captured from `afterEach`/`afterAll` |
| `evidence-duplicate` | no | more than one evidence call in one test |
| `trace-title-missing-tcid` | no | a test title with no `[TC-ID]` |
| `trace-unknown-tcid` | no | a `[TC-ID]` that is not in the supplied list |
| `exception-not-permitted` | no | a `qa-allow` aimed at a rule that may never be excepted |
| `pom-raw-locator` · `pom-navigation` · `pom-evaluate` · `pom-keyboard` · `pom-chained-locator` · `pom-spec-helper` | **yes** | POM boundaries in spec files |

### Warnings

`wait-for-timeout`, `bare-set-timeout`, `wait-network-idle` (all three suppressed by an adjacent
justification containing a timing word — retry, backoff, debounce, deliberate, a REQ/TC id …),
`positional-unscoped` (`first()` / `last()` / `nth()` on a receiver chain with no `filter()` segment
and no named-container root narrowed by a further `getBy*`; suppressed by ANY comment of 15+
characters on the line above, or a `qa-allow`; skipped on a line that already produced
`pom-chained-locator`), `step-missing` (only with `--require-steps`: a test with no `test.step()`
nested in it and no call to a `step` wrapper the file IMPORTS), `hardcoded-credential`,
`absolute-url`, `trace-describe-missing-reqid`, `trace-unknown-reqid`, `trace-title-dynamic`,
`manifest-unreadable`, `exception-malformed`, `exception-expired`, `pom-inventory-unreadable`
(`--inventory` names a file that is missing or has no `Screen | Decision | Class | Candidates
considered | Reason` table — nothing is decided).

Warnings never move the gate. The three timing rules run in every layer the scan is pointed at — pass
page objects and helpers in `--files` or they are never checked.

### `review` — undetermined, never guessed

`assertions-conditional`, `assertions-unresolved`, `evidence-conditional`, `evidence-unresolved`,
`evidence-placement-unproven`, `outcome-coverage-unassessed`, `exception-unverified`,
`pom-architecture-unknown`, `pom-duplicate-page`.

#### `pom-duplicate-page` — candidates, never verdicts (non-exemptible)

The page-class pass walks the **whole automation root** (every `.ts` / `.js` that is not a spec,
whatever folder or skill wrote it, plus the non-spec files in `--files`) and takes every class whose
constructor takes a `Page` (`constructor(page: Page)`, or a parameter named `page`) or that extends a
class whose name ends in `Page` / a page class found in the same scan. Component objects (a scoping
`Locator` in the constructor) are not pages. Two page classes in two files are a **candidate pair**
when any of these holds — the finding names both files, both classes, `evidence` (the strongest
kind) and `evidenceKinds[]` with the matching detail:

| `evidence` | Rule |
|---|---|
| `name` | normalized class names equal — case-insensitive, a trailing `s` and a trailing `Page` ignored — or normalized file stems equal, with leading digits + separators ignored (`4-ListingPage.ts` ≡ `ListingPage.ts`, `ListingPages` ≡ `ListingPage`) |
| `route` | an identical route literal: the first string of `goto(…)` / `gotoAppPath(…)` / `navigate(…)` inside the class body, or a `url` / `path` / `route` field value; a leading `${…}` and a trailing `/` are ignored, case is not significant |
| `locators` | **two or more** identical locator call literals (`locator('…')`, `getByTestId('…')`, `getByRole('…', { name: '…' })` — every string inside the call joined) — one common loader locator is not a match |

A different class name with the same route is a reuse candidate; a legitimately shared route or
common locators are closed by the inventory row's justification — **the row decides, the scanner
never does**. Covered = one row of the `--inventory` table names both classes in its `Class` +
`Candidates considered` cells (for two classes of the same name: both files, with a folder
component). Covered → `pom-duplicate-page-decided` (`info`) carrying `decision`, `screen` and
`inventoryLine`; uncovered → `pom-duplicate-page` (`review`) and the scanner gate is **BLOCKED**
until the row exists. A page file the scanner cannot strip lands in `notRun[]` under this rule
(its classes were not compared) — never in a silent PASS. Every page class found is hashed into the
fingerprint, so a new twin file invalidates a recorded gate.

### `info`

`assertions-call-found`, `evidence-call-found`, `modifier-declared`, `trace-uncovered-id`,
`exception-unused`, `pom-duplicate-page-decided`, plus every excepted finding (downgraded, never
removed).

## Call-site resolution — and what a positive result means

A test with no direct assertion or evidence call is not condemned. The script follows **the methods
that test actually invokes** — through relative imports, `new XPage(page)` bindings, and
fixture-destructured names matched against the pages folder — and looks for the call **in the
invoked method's own body**, up to three hops (`this.x()` and imported-object calls included).

| Outcome | Meaning |
|---|---|
| `*-call-found` (info) | A call site exists on a path with no visible branch before it. **This is not proof it executes.** |
| `*-conditional` (review) | The only call found sits behind a guard, in a loop or callback, or after a possible early return. |
| `*-unresolved` (review) | A hop could not be followed — bare package, path alias, base class, dynamic dispatch. **Neither presence nor absence is claimed.** |
| `no-assertions` / `evidence-missing` (violation) | Every hop was followed to a real method body and the call is genuinely absent. |

**Presence elsewhere in an imported file is never accepted.** A method nobody calls captures nothing
and asserts nothing; the script only ever looks inside methods the test invokes.

## Exceptions

```ts
// qa-allow: pom-navigation — SSO bootstrap runs before any page object exists (REQ-014)
/* qa-allow-block: wait-for-timeout — gateway rate limit backoff (REQ-014) */
// qa-allow-file: pom-raw-locator — this suite predates the page objects (docs/decisions/ADR-7.md)
```

Scopes: the next code line (widened to that block when one opens there), a trailing comment's own
line, the following block (`-block`), or the whole file (`-file`, **only** for `pom-*` rules).
Project-wide entries live in `Testing/qa-allow.json`:

```json
{ "schemaVersion": 1,
  "allow": [{ "ruleId": "pom-navigation", "file": "Testing/Automation/tests/Auth_Tests/*.spec.ts",
              "reason": "SSO bootstrap must run before any page object exists",
              "source": "REQ-014", "expires": "2026-12-31" }] }
```

### Form is checked here; substance is checked at the checkpoint

The script honours an exception only when **all** of these hold: the rule is exemptible; the scope is
line or block (file scope only for `pom-*`); the reason is ≥12 characters of substance; and the
`(<source>)` **resolves** — to an ID present in the supplied lists, or to a file that exists.
Anything else → `exception-malformed`, **not honoured**.

Passing that check makes an exception *provisionally* honoured, and raises
`exception-unverified` (`review`). Before a compliance checkpoint can pass, a reviewer opens the
cited source and records whether it actually justifies **that rule, in that scope** — `justified`
with the basis quoted, or `rejected`, which drops the exception and restores the finding at full
severity. This is the reviewing model's own work; it adds no approval step for the user.

An honoured exception is downgraded to `info` **and kept** in `findings[]` with its `exception`
attached, and listed in `exceptions[]`. Nothing is ever silently removed. A `qa-allow` on a
non-exemptible rule is itself a violation and the original finding keeps full severity.

An inline justification comment on a timer works the same way: it suppresses the warning to `info`,
appears in `exceptions[]` as `justification-comment`, and still raises `exception-unverified`.

## Architecture

POM rules apply only to spec files, and only once the project's layer layout is known — from
`paths.pages`, from an optional `automation.layers` block in `qa-manifest.json`, or by detecting the
existing tree. When it cannot be determined the script emits `pom-architecture-unknown` (`review`)
and applies no POM rule to that file, rather than imposing a layout the project does not use.

## File-state fingerprint

`fingerprint.scopeDigest` is a content hash over every in-scope code and configuration file —
specs, the support files actually read, `playwright*.config.*`, `qa-allow.json`, `qa-manifest.json`
— **including untracked files**, with generated output (`reports/`, `screenshots/`,
`automation-logs/`, `coverage/`) excluded so a report can never invalidate its own run. Per-file
hashes are in `fingerprint.files`.

Git HEAD and dirty status are context, never identity: they cannot tell you which bytes were tested.
A recorded checkpoint is valid only for the `scopeDigest` it names; a differing digest invalidates
the affected checks and results.

## Documented detection limits

These ship in the payload's `limits[]` too, so no one can consume a `PASS` without them.

1. **A PASS proves no banned text pattern was found.** It does not prove the tests are correct,
   meaningful, or that they verify their requirement.
2. Text analysis, not a parser. Identifiers are matched by name; dynamic dispatch, computed member
   access and locators built by string concatenation are invisible.
3. Regex literals are not detected. A regex containing a quote or an unbalanced brace surfaces as a
   parse failure and `BLOCKED` — never as a PASS, and never as a violation against that file.
4. **Call sites are not execution.** `*-call-found` means "no visible branch precedes this call".
5. Evidence *placement* relative to teardown is not verified — only that it is not captured from a
   teardown hook, and that there is exactly one call.
6. At most three hops, relative imports only. Bare packages, TS path aliases, barrel re-exports,
   base classes and mixins are reported unresolved.
7. Assertion *quality* is not judged. Only literal tautologies are detected; an assertion on the
   wrong thing passes every rule here.
8. Traceability is linkage only, and only as good as the supplied ID list.
9. Modifier reasons are checked for presence, not truth.
10. Exceptions are checked for form and for a resolving source, never for substance.
11. Credential detection is keyword-based: a secret in a neutrally named variable is missed, and a
    harmless literal beside a key named `token` is a false positive.
12. Only files in the resolved scope are examined.
13. Steps are recognised only in the scanned file: `test.step()` and a step wrapper IMPORTED into
    the spec. A step inside a page-object method does not count for the spec that calls it, and
    `step-missing` runs only behind `--require-steps`.
14. Positional scoping (`first` / `last` / `nth`) is judged on the receiver chain of that call: a
    `filter()` segment, or a named `getByRole` / `getByTestId` root narrowed by a further `getBy*`,
    counts as scoped. An array `.filter` on a different receiver in the same statement does not; a
    locator scoped by an earlier assignment is a false positive to justify with a comment.
15. `networkidle` detection reads string literals next to `waitForLoadState(` or `waitUntil:` only;
    a readiness helper that hides the literal behind a constant is invisible.
16. Page-class duplicate detection only produces **candidates**: name normalization is a suffix rule
    (`Address` / `Addresses` do not match), a route or locator built at runtime is invisible, a route
    inherited from a base class is not seen on the subclass, and whether a match is a duplicate is
    decided by the inventory row — never here.

The fingerprint (`scopeDigest`) hashes every `playwright*.config.*` in the root and the automation
root **and one hop of each config's relative imports** (`timeouts.ts`, an env module), so editing
the shared timeout policy invalidates a recorded gate exactly as editing the config does — and every
page class the root walk found, so a new twin file does too.

## Self-test

`selftest.mjs` runs eighteen fixture cases, including the false-PASS guards: evidence in an
uncalled method, an unfollowable hop, a conditional call path, an exception aimed at a
non-exemptible rule, a linked-but-partially-asserted requirement, unscannable valid code, a post-run
code change, and — for the timing rules — true positives at known lines (`timing.fixture.ts`),
false-positive guards (`timing-clean.fixture.ts`: filter-scoped and justified positionals, a
`networkidle` string constant, a comment, an imported step wrapper), false-negative guards
(`timing-negative.fixture.ts`: an unrelated `.filter` in the same statement, a local `step`
function, a step inside the page object), the config-import fingerprint and — case 18, over the six
roots of `fixtures/pom/` — the page-class duplicate candidates: same class name in two files,
different name + same route, a numeric-prefixed / plural twin (false-negative guard), a shared route
decided by an inventory row (`pom-duplicate-page-decided`, `--strict` PASS) versus the same route
with no row (`review`, `--strict` BLOCKED), and two pages sharing one loader locator (no hit —
false-positive guard).

It **exits non-zero on mismatch** — deliberately. It is a harness, not a reporting script. A failing
self-test means the validator's verdicts cannot be trusted: record the compliance gate **BLOCKED**
rather than passed, and close the affected checks another way.
