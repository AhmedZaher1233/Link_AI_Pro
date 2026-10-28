# layers-bad — the backend-member violations

A second automation root for `selftest.mjs` case 29: `api/BadApi.ts`, `db/BadDb.ts` and `fixtures/setup.ts` carry one
violation per marked line (`// expect: {rule-id}`), next to clean members on the unmarked lines. It is kept apart from
`../layers/` so the clean specs there scan with a PASS gate. Never executed.
