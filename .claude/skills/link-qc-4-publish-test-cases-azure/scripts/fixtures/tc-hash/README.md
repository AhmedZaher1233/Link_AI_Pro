# tc-hash fixture

`TEST-CASES-hash-sample.md` + `TEST-DATA-hash-sample.md`: one test case (`TC-HASH-01`) that references
an account (`[A1]`), an environment row (`[E1]`) and a data item (`[D1]`), a quoted typed input with a
double space (`"Hardware  2026"`) and a quoted expected message. `selftest-tc-hash.mjs` asserts ONE
golden hash for this pair and the canonical-hash rules (formatting-only edits → same hash; a changed
quoted value, referenced-data shape, account role or `Shared data` → different hash; username, URL,
Validation, evidence stamp, Tags → same hash).

The same two files, byte for byte, live in `link-qc-4-publish-test-cases-azure/scripts/fixtures/tc-hash/`
and that skill's harness asserts the same golden constant — a drift between the two hash copies shows
up as two different goldens. Regenerate the constant only for a deliberate change of `tc-hash.mjs`
(`node scripts/tc-hash.mjs --tc scripts/fixtures/tc-hash/TEST-CASES-hash-sample.md --pretty`) and
change both harnesses together.
