# Toolchain — Node.js, NPM, Playwright

Load only when `validate-setup.mjs` reports `Node.js`, `NPM`, `Playwright` or
`Playwright cfg` as FAIL/WARN and the mode allows repair (B, C, new project). In Mode A the
rows are reported as-is with "would be fixed by B".

## Node.js
* Detected by the scripts (`node --version`). Missing → tell the user Node.js is required and
  install the LTS version the project specifies — check `.nvmrc`, `.node-version`,
  `package.json#engines`, README and CI config before choosing. Never install blindly over a
  pinned version.
* Verify after installing (`node --version`, `npm --version`).

## NPM / package.json
* Existing `package.json` → read it, never overwrite; note existing scripts and dependencies.
* Missing and the automation project needs one → `npm init -y` only then.

## Playwright
* Detected via `npx --no-install playwright --version` and `@playwright/test` in
  `package.json`.
* Missing → install per the project's existing setup (official Playwright TypeScript setup for
  a new project), then `npx playwright install` for browsers, then verify the version again.
  Never reinstall a working setup.
* Installation commands (`npm install`, `npx playwright install`) run under the normal
  permission flow — they are not pre-approved.

## playwright.config.*
* Create only when required; when it exists, read it and preserve every valid project setting.
* Requirements are listed in `references/testing-layout.md` (paths from the manifest, HTML
  reporter, screenshots on failure, trace on retry, no URLs or credentials, base config free of
  story-specific `headless` / `workers` / reporters).
