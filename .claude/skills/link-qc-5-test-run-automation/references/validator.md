# `validate-automation.mjs` — contract, gate, exceptions and limits

Load only to close an open `review[]` / `notRun[]` / `exceptions[]` item. Every finding in the payload
carries its `ruleId`, `severity` and `message`; the rule catalogue (`RULES`) and the detection limits
(`LIMITS`, shipped as `limits[]`) live in the script — this file says how to act on them.

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

**Every `review[]` and `notRun[]` entry is an APPLICABLE check that did not complete** — close it with
the missing input, other project tooling or documented semantic review; never PASS, never `N/A`
(`compliance-checkpoints.md` §1; the payload's `complianceNote` says the same, it does not enforce it).

### Exit codes

Default **0** always, with the verdict in the payload (the convention every read-only script in this
suite follows). `--strict` maps the gate: `PASS` 0 · `FAIL` 1 · `BLOCKED` 2 · `NOT_RUN` 3 — so a CI
job cannot mistake "found nothing to check" for "everything passed". An internal error is caught and
emitted as `gate: BLOCKED`; a stack trace never reaches stdout.

**If the validator cannot run at all, report it as unavailable — never as passed.**

## Rules

- **Violations** move the gate. Non-exemptible: `focus-only`, `modifier-no-reason`,
  `placeholder-assertion`, `empty-test-body`, `no-assertions`, `evidence-missing`, `evidence-in-hook`,
  `evidence-duplicate`, `trace-title-missing-tcid`, `trace-unknown-tcid`, `exception-not-permitted`.
  Exemptible: the six POM rules `pom-raw-locator` · `pom-navigation` · `pom-evaluate` · `pom-keyboard` ·
  `pom-chained-locator` · `pom-spec-helper` (spec files only).
- **Warnings** never move the gate. Exemptible: `wait-for-timeout`, `bare-set-timeout`,
  `wait-network-idle` (each also suppressed by an adjacent timing justification), `positional-unscoped`
  (suppressed by a 15+ character comment on the line above), `step-missing` (only with
  `--require-steps`), `absolute-url`, `trace-describe-missing-reqid`, `trace-unknown-reqid`. Not exemptible:
  `hardcoded-credential` and the bookkeeping warnings (`trace-title-dynamic`, `manifest-unreadable`,
  `exception-malformed`, `exception-expired`, `pom-inventory-unreadable`). The timing rules run in every
  layer the scan is pointed at — pass page objects and helpers in `--files`.
- **`review`** — undetermined, never guessed: `assertions-conditional`, `assertions-unresolved`,
  `evidence-conditional`, `evidence-unresolved`, `evidence-placement-unproven`,
  `outcome-coverage-unassessed`, `exception-unverified`, `pom-architecture-unknown`, `pom-duplicate-page`.
- **`info`** — `assertions-call-found`, `evidence-call-found`, `modifier-declared`, `trace-uncovered-id`,
  `exception-unused`, `pom-duplicate-page-decided`, and every excepted finding (downgraded, never removed).

**`pom-duplicate-page` — candidates, never verdicts (non-exemptible).** The page-class pass compares every
page class of the whole automation root and reports a pair when the normalized names / file stems match
(`evidence: name`), a route literal matches (`route`), or two or more locator literals match
(`locators`). The `<automation_inventory>` row decides: a row naming both classes turns the pair into
`pom-duplicate-page-decided`; without one the scanner gate stays BLOCKED. An unstrippable page file
lands in `notRun[]` under this rule.

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

## File-state fingerprint and limits

`fingerprint.scopeDigest` is the identity of the tested code (`compliance-checkpoints.md` §5): content
hashes of the in-scope code and configuration — untracked files included, generated output excluded —
plus every `playwright*.config.*` with one hop of its relative imports (`timeouts.ts`) and every page
class the root walk found. A recorded checkpoint is valid only for the digest it names.

Read `limits[]` before trusting a PASS. The ones that change what you do: a PASS proves only that no
banned text pattern was found; `*-call-found` is a call site, not execution; evidence placement against
teardown is never verified; at most three relative-import hops (aliases, barrels and base classes are
`*-unresolved`); assertion quality is not judged; exceptions are checked for form, never substance;
duplicate-page matching only produces candidates.

## Self-test

`scripts/selftest.mjs` (eighteen fixture cases, the false-PASS guards among them) **exits non-zero on
mismatch by design**. A failing self-test means the validator's verdicts cannot be trusted: record the
compliance gate **BLOCKED** rather than passed, and close the affected checks another way.
