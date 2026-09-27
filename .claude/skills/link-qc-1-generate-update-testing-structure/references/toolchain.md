# Toolchain — Node.js, NPM, Playwright, playwright-cli (skill 3c), Python + Pillow (link-qc-6-ui-testing)

Load only when `validate-setup.mjs` reports `Node.js`, `NPM`, `Playwright`, `Playwright cfg`,
`Playwright CLI` or `Python + Pillow` as FAIL/WARN and the mode allows repair (B, C, new
project). In Mode A the rows are reported as-is with "would be fixed by B".

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

## playwright-cli — the browser tool of skill 3c only (optional)

* What it is: Microsoft's `@playwright/cli` (`playwright-cli`), a command-line browser driver
  that `link-qc-3c-validate-manual-test-cases-cli` uses instead of the Playwright MCP server. Skill 3b
  and every other skill never need it — its absence is a WARN, never a FAIL, and never a reason
  to hold up anything else.
* Detected by `playwright-cli --version` (global, what sync installs) or
  `npx --no-install playwright-cli --version` (a project-local copy); the browser by a chromium
  build in the Playwright browsers cache (`%LOCALAPPDATA%\ms-playwright`, `~/.cache/ms-playwright`,
  `PLAYWRIGHT_BROWSERS_PATH`) — a cache check only; 3c's first `open` is the real one.
* Install (Mode B/C/new, only after the user answered **yes** to "install playwright-cli for skill
  3c?" — record the answer as a `[type: qa]` line so it is never re-asked): run
  `sync-qa-skills.mjs --apply --tools` (`skills-sync.md`), or the same steps by hand under the
  normal permission flow: `npm install -g @playwright/cli@latest`, then
  `playwright-cli install-browser`, then add the line `.playwright-cli/` to `.gitignore`
  (playwright-cli writes page snapshots there; they must never be committed). Global on purpose:
  the tool is a per-machine daemon with a user-level browser cache, and a project without a
  `package.json` must still be able to run 3c. Never run `playwright-cli install --skills` — the
  vendor's own agent skill is not part of this suite; if a project already has it, it shows as
  LOCAL-ONLY in the sync report and is harmless.
* Answered **no** → leave the WARN rows as they are and say that 3c will BLOCK until
  `/sync-skills --tools` runs; nothing else changes.
* Optional secrets file for unattended 3c logins: the user runs
  `scripts/set-playwright-secrets.ps1` / `.sh` in their own terminal (`mcp-setup.md` §2b). You
  only check that the variable and the file exist — never their content.

## Python + Pillow (+ numpy) — link-qc-6-ui-testing's static-image annotation only (optional)

* What it is for: `link-qc-6-ui-testing` draws its red evidence boxes in the page DOM whenever the
  implementation is a live URL — no Python involved. Pillow (and numpy for colour-mask
  detection) is needed only to crop and annotate **static images**: an exported design
  screenshot, or an implementation supplied as screenshots. Its absence is a WARN, never a
  FAIL, and never holds up anything else.
* Detected by `scanPython` in `lib.mjs`: `py -3` / `python` / `python3` (Windows first tries the
  launcher; the Microsoft Store `python` alias exits non-zero and never counts), then
  `import PIL, numpy`. The row reads `Python + Pillow`.
* Install (Mode B/C/new, only after the user answered **yes** to the optional-tools question —
  the same `[type: qa]` answer as playwright-cli): `sync-qa-skills.mjs --apply --tools` runs
  `<python> -m pip install pillow numpy` **only when an interpreter already exists**. This suite
  never installs Python itself: when there is none, tell the user once that link-qc-6-ui-testing works on live
  URLs without it and that installing Python 3 (python.org or `winget install Python.Python.3.12`)
  and re-running `/sync-skills --tools` enables static-image annotation. Never run `pip` under a
  project's virtual environment you did not create; if the project has one, say which
  interpreter was used.
* Answered **no** → leave the WARN row; link-qc-6-ui-testing reports "annotated crops unavailable for static
  images" in its Coverage Limitations and embeds the whole image instead.

## Figma MCP — link-qc-6-ui-testing only (optional)

Not a toolchain item: it is an MCP server entry, documented in `mcp-setup.md` §2c. Nothing to
install — the user logs in once through `/mcp`.

## playwright.config.*
* Create only when required; when it exists, read it and preserve every valid project setting.
* Requirements are listed in `references/testing-layout.md` (paths from the manifest, HTML
  reporter, screenshots on failure, trace on retry, no URLs or credentials, base config free of
  story-specific `headless` / `workers` / reporters).
