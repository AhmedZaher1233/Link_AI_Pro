# fixtures/scratch — the fake Playwright of `selftest-scratch.mjs`

`selftest-scratch.mjs` copies `../impact/project` (the mini POM project) to `{tmp}/Testing/Automation`, writes
probes into its `test-results/qa-scratch/`, and runs the REAL `scratch.mjs` with `--cli fake-playwright.mjs`.

| File | What it does |
|---|---|
| `fake-playwright.mjs` | stands in for `playwright test <spec> --config <overlay>`; a `fake:<mode>` marker in the probe picks `pass` · `fail` · `secret` · `hang` · `write-outside` · `no-report`; records argv, cwd and the `PW_*` variables in `fake-call.json` beside the overlay; writes the json report to `PW_SCRATCH_JSON` and a trace into `PW_OUTPUT_DIR` |

The overlay against a real `@playwright/test` (no fake) was checked by hand when the runner was written: the shared
config's `globalSetup` and custom reporter stay unloaded, a `setup` dependency is dropped, one worker runs, the json
report parses and every artifact stays under `test-results/qa-scratch/out/`.
