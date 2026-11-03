# `validate-automation.mjs` - contract, gate, exceptions and limits

Load only to close an open `review[]` / `notRun[]` / `exceptions[]` item. Every finding carries `ruleId`, `severity`, `message`; the catalogue (`RULES`) and the limits (`limits[]`) live in the script. A read-only token-level screen over stripped source: a screen, not a judge; what it cannot establish goes to semantic review. Detail: references/maintainers/validator.md.

## Running it

Plain command shape: no `cd`, no pipe, no env prefix, no `--pretty`.

```text
node .claude/skills/link-qc-5-test-run-automation/scripts/validate-automation.mjs --root <project> --summary
  --out {results_root}/artifacts/checks/validator-full.json
  [--files a.spec.ts,b.spec.ts] [--tests-path <dir>] [--pages-path <dir>] [--automation-root <dir>]
  [--tc-ids <csv|file>] [--req-ids <csv|file>] [--allow-file <path>] [--evidence-fn captureEvidence]
  [--console-guard-fn attachConsoleGuard] [--network-guard-fn attachNetworkGuard]
  [--treat-as-spec] [--require-steps] [--inventory <automation-inventory.md>] [--strict]
node … --root <project> --page-scan [--automation-root <dir>] [--inventory <automation-inventory.md>] [--strict]
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest.mjs      # exits 1 on mismatch
```

- `--summary`: the full payload cut down; its `gate` / `gateReason` ARE the full payload's; `--out` keeps the full payload for the items you close. `--page-scan`: the `<automation_inventory>` discovery digest; `--strict` exits 2 while a candidate pair is undecided.
- `--files` carries the page objects, fixtures and helpers the specs touch as well as the specs (the timing rules apply in every layer; an unseen file is unchecked). `--require-steps` turns on `step-missing` for the specs this run generated or updated.
- Paths: CLI flag, then `Testing/qa-manifest.json` (`paths.tests`, `paths.pages`, `paths.automationRoot`), then `Testing/Automation/*`.
- `--tc-ids` / `--req-ids`: a comma list or a file (the TC document, `ADO-MAP.md`, the REQ file). Without them the ID rules land in `notRun[]`, never in a PASS.
- `--inventory`: the story's decision table, passed on every run; a candidate pair becomes `pom-duplicate-page-decided` only when a row names both classes; an unreadable inventory is `pom-inventory-unreadable` and decides nothing.
- Run the project's own tooling first (ESLint + `eslint-plugin-playwright`, `tsc`); this script covers what they do not.

## Output and gate

`--summary`: `{ gate, gateReason, counts, byRule, open[] ('{ruleId} {file}:{line}', at most 20), openTotal, review, notRun, notRunItems[], exceptions, fingerprint { scopeDigest, files }, pageScan { classes, candidates, decided, undecided }, full }`; `full` is the `--out` file with every finding, `review[]`, `notRun[]`, `exceptions[]`, `limits[]`. Severities: `violation` (moves the gate) · `warning` · `review` (undetermined; blocks a compliance PASS until closed) · `info`.

Gate: `NOT_RUN` (nothing analysed) · `BLOCKED` (an unreadable file in scope, a test's layer unresolved, or an undecided `pom-duplicate-page` pair) · `FAIL` (one or more non-excepted violations) · `PASS` (zero violations, nothing more). A PASS with open `review[]` / `notRun[]` items is normal; the scanner gate is not the compliance gate. Every `review[]` / `notRun[]` entry is an APPLICABLE check that did not complete: close it with the missing input, other tooling or documented semantic review; never PASS, never `N/A`. Exit code 0 always; `--strict` maps PASS 0 · FAIL 1 · BLOCKED 2 · NOT_RUN 3; an internal error is `gate: BLOCKED`. If the validator cannot run at all, report it unavailable, never passed. `RULE_CHECKS` (`--help`) maps every rule to its `compliance-checkpoints.md` §2 item(s).

## Rules

V = violation, W = warning, R = review, I = info; (nx) = non-exemptible. A `qa-allow` on a non-exemptible rule is itself `exception-not-permitted`.

| Rule | Sev. | Meaning |
|---|---|---|
| `focus-only` · `modifier-no-reason` | V (nx) | `only` committed · a modifier without a traceable reason |
| `placeholder-assertion` · `empty-test-body` · `no-assertions` | V (nx) | an assertion that cannot fail · an empty body · no assertion on any followed path |
| `evidence-missing` · `evidence-in-hook` · `evidence-duplicate` | V (nx) | no `captureEvidence` on any followed path · in a hook · twice |
| `evidence-helper-contract` (item 14) | V (nx) | the evidence helper under the automation root must emit exactly one `evidence` heartbeat per written assertion-point image and none for the failure image; a helper that emits two `evidence` events per attempt fails it |
| `trace-title-missing-tcid` · `trace-unknown-tcid` | V (nx) | no `[TC-ID]` in the title · an id not in `--tc-ids` |
| `exception-not-permitted` · `layer-mismatch` | V (nx) | a `qa-allow` on a non-exemptible rule · the code layer differs from the document's `tcLayer` |
| `record-missing` · `record-in-hook` · `record-duplicate` · `api-record-missing` · `db-record-missing` | V (nx) | `captureRecord` absent / in a hook / twice · a backend test without the recorded fixture |
| `api-mutation-unledgered` · `api-effect-undeclared` · `api-effect-mismatch` · `api-redirect-enabled` · `api-secret-header` | V (nx) | a write outside the ledger · no `effect` · `effect` differs from the mapping row · `maxRedirects` overridden · an auth literal |
| `db-write-unledgered` · `db-write-freeform` · `db-connection-literal` | V (nx) | a write outside the ledger · write SQL text · a literal connection string |
| `pom-raw-locator` · `pom-navigation` · `pom-evaluate` · `pom-keyboard` · `pom-chained-locator` · `pom-spec-helper` | V (specs only) | a raw locator · navigation · `evaluate` · `keyboard` · chaining off an exposed locator · a UI helper in the spec |
| `api-raw-request` · `db-raw-sql` · `db-driver-import` | V | the API / DB twins of the POM rules |
| `wait-for-timeout` · `bare-set-timeout` · `wait-network-idle` | W (or an adjacent timing justification) | a fixed wait · a bare `setTimeout` · `networkidle` as readiness |
| `positional-unscoped` | W (a 15+ character comment above) | `first()` / `last()` / `nth()` on an unscoped chain |
| `step-missing` | W (with `--require-steps`) | no `step()` per manual step |
| `absolute-url` · `trace-describe-missing-reqid` · `trace-unknown-reqid` | W | a literal URL · no REQ id on the describe · an id not in `--req-ids` |
| `hardcoded-credential` · `trace-title-dynamic` · `manifest-unreadable` · `exception-malformed` · `exception-expired` · `pom-inventory-unreadable` | W (nx) | a password-shaped literal · a computed title · bookkeeping warnings |
| `assertions-conditional` · `assertions-unresolved` · `evidence-conditional` · `evidence-unresolved` · `evidence-placement-unproven` · `record-conditional` · `record-unresolved` · `record-placement-unproven` | R | the only call sits behind a branch · a hop could not be followed · placement against teardown unproven |
| `outcome-coverage-unassessed` · `exception-unverified` · `pom-architecture-unknown` | R | needs semantic review · a provisionally honoured exception · the layer layout is unknown |
| `pom-duplicate-page` · `layer-unresolved` | R (nx), gate BLOCKED | a candidate pair with no inventory row · a test's layer cannot be classified |
| `api-mutation-in-setup-unlabelled` · `db-env-not-qc` | R (nx) · R | a setup mutation without `purpose: 'setup'` · a non-QC connection variable |
| `constant-redeclared` (item 6) | R, B8 | a spec declaring a numeric timeout / tolerance / threshold constant, or any `TIMEOUTS` declaration |
| `empty-catch` (item 28) | R (nx), B8 | an empty `catch` / `.catch()` body in any layer |
| `timeout-literal` (item 43) | R (nx), B8 | a timeout / deadline property or `setTimeout()`-family call with a numeric value (`0` = unlimited); `timeouts.ts` itself is silent |
| `console-guard-missing` (46a) · `network-guard-missing` (49) | R, B8 | no covering `beforeEach` attaches the guard, or it is never reported in `afterEach` |
| `admission-contract` (25a, 47) | R, B8 | a side-effecting fixture or `beforeAll` without `workerAdmission` / `unitAdmission` |
| `assertions-call-found` · `evidence-call-found` · `record-call-found` · `modifier-declared` · `trace-uncovered-id` · `exception-unused` · `pom-duplicate-page-decided` | I | a call site (not proof of execution) · bookkeeping; every excepted finding is downgraded to info, never removed |

B8 rules stay at `review`: each is an open item Checkpoint A closes (fixed, or documented semantic review against the same `scopeDigest`); none moves the scanner gate. The guard rules need the helper defined under the automation root (or `--console-guard-fn` / `--network-guard-fn`), else `notRun[]`. API / DB (3.0): every test is classified `ui` · `api` · `db` · `api+db` · `hybrid`; `evidence-*` and guard rules apply to ui / hybrid, record rules to the backend layers; `--tc-ids` on the TC document feeds `layer-mismatch`, `--inventory` feeds `api-effect-mismatch`. Writes to pre-existing records are enforced at runtime by the helpers, not by this scan.

## Call-site resolution

A test with no direct assertion or evidence call is followed through the methods it invokes up to three hops. `*-call-found` = a call site, not proof of execution; `*-conditional` = behind a guard, loop, callback or early return; `*-unresolved` = a hop not followed (alias, base class, dynamic dispatch), neither presence nor absence claimed; `no-assertions` / `evidence-missing` = every hop followed and the call genuinely absent. Presence elsewhere in an imported file is never accepted.

## Exceptions

`// qa-allow: <rule> — <reason> (<source>)` (the next line / block), `/* qa-allow-block: … */`, `// qa-allow-file: …` (`pom-*` only); project-wide in `Testing/qa-allow.json` (`{ "schemaVersion": 1, "allow": [{ ruleId, file, reason, source, expires }] }`). Honoured only when the rule is exemptible, the scope is allowed, the reason is 12+ characters of substance and the `(<source>)` resolves; else `exception-malformed`. A honoured exception is provisional: it raises `exception-unverified` until the reviewing model opens the source and records `justified` (basis quoted) or `rejected` (finding restored). Honoured findings are downgraded to `info`, kept in `findings[]` and listed in `exceptions[]`; nothing is removed. An inline timing justification works the same way (`justification-comment`).

## Architecture, fingerprint, limits, self-test

- POM rules apply to spec files only, once the layer layout is known (`paths.pages`, `automation.layers`, or the detected tree); unknown: `pom-architecture-unknown`.
- `fingerprint.scopeDigest` = hashes of the in-scope code and configuration + every `playwright*.config.*` with one hop of relative imports + every page class found; a recorded checkpoint is valid only for the digest it names (`compliance-checkpoints.md` §5).
- Read `limits[]` before trusting a PASS: only banned text patterns are proven absent; `*-call-found` is a call site; evidence placement against teardown is never verified; three import hops; assertion quality is not judged; exceptions are checked for form only; B8 rules read names and shapes.
- `scripts/selftest.mjs` (twenty-six fixture cases) exits non-zero on mismatch by design: a failing self-test means the compliance gate is **BLOCKED** and the affected checks are closed another way.
