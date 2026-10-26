# B8 rule fixtures (validator cases 21-26)

The stricter deterministic rules of the optimisation plan (Revision 3 B8, Revision 3.1 §3.5), staged at severity
`review`. Every file is scanned by `selftest.mjs` only — never executed by Playwright. Each rule has a true-positive
fixture (`tp`), a false-positive guard (`fp` — legitimate code that must stay silent) and a false-negative guard
(`fn` — a disguised violation that must still fire).

| Folder / file | Rule (check) | Scanned as | Expected |
|---|---|---|---|
| `constants/tp.fixture.ts` | `constant-redeclared` (6) | spec | lines 6, 7, 11 |
| `constants/fp.fixture.ts` | | spec | none — an expected count, a label map, a `TIMEOUTS.*` reference, a non-policy name, a commented or quoted number |
| `constants/fn.fixture.ts` | | spec | lines 6 (typed, exported, arithmetic), 7 (parenthesised `let`), 8 (`TIMEOUTS` shadowed) |
| `catch/tp.fixture.ts` | `empty-catch` (28) | support | lines 6 (`catch (e) {}`), 11 (`.catch(() => {})`) |
| `catch/fp.fixture.ts` | | support | none — a commented block, a rethrow, a commented handler, a rethrowing handler, a value fallback |
| `catch/fn.fixture.ts` | | support | lines 5 (whitespace-only, typed parameter), 8 (lone `;`), 9 (`=> undefined`), 10 (`async () => {}`) |
| `timeout/tp.fixture.ts` | `timeout-literal` (43) | support | lines 8, 9, 13 (`test.setTimeout`), 14 (`timeout: 0`) |
| `timeout/fp.fixture.ts` | | support | none — `TIMEOUTS.*`, a computed budget, a type literal, a ternary |
| `timeout/fn.fixture.ts` | | support | lines 10 (`deadline` arithmetic), 12 (`timeout: WAIT`, a numeric constant of the file) |
| `timeout/timeouts.ts` | | support | none — the policy file itself is skipped |
| `guards/` | `console-guard-missing` (46a), `network-guard-missing` (49) | automation root (helpers define both guards) | |
| `guards/tests/tp.fixture.ts` | | spec | both rules at line 7 |
| `guards/tests/fp.fixture.ts` | | spec | none — file-level beforeEach / afterEach |
| `guards/tests/fixture-fp.fixture.ts` | | spec | none — attached by the automatic fixture of `guards/fixtures/test.ts` |
| `guards/tests/fn.fixture.ts` | | spec | console 10 (handle not kept), 21 (in the test body); network 10 (never reported), 20 (not attached) |
| `admission/` | `admission-contract` (25a, 47) | automation root (`helpers/admission.ts` present) | |
| `admission/fixtures/tp.fixture.ts` | | support | lines 6 (worker, prerequest), 11 (`request.post`), 15 (login) |
| `admission/fixtures/fp.fixture.ts` | | support | none — direct and transitive admission, a read-only fixture, an option fixture |
| `admission/fixtures/fn.fixture.ts` | | support | lines 10 (through a non-admitted fixture), 14 (worker fixture on `unitAdmission`, renamed prerequest import) |
| `admission/tests/hooks.fixture.ts` | | spec | line 8 (side-effecting `beforeAll` without `workerAdmission`); line 20 is clean |
| `pragmas.fixture.ts` | staged severity / exemptibility | spec, `--req-ids REQ-014` | `constant-redeclared` 8 honoured (info + `exception-unverified`); `exception-not-permitted` 13 + `empty-catch` 14 (review); gate FAIL |

Without the guard helpers under the automation root (the default `fixtures/pages` root) the guard rules land in
`notRun[]`; without `helpers/admission.*` the admission rule has no subject and stays silent.
