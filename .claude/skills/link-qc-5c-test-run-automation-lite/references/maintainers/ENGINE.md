# engine/ — the vendored link-qc-5 runtime (maintainers copy)

Not loaded by the model. Lite 1.4.0 made the skill standalone: `scripts/lite.mjs` composes the scripts in `engine/scripts/`
instead of `../link-qc-5-test-run-automation/scripts/`, so this one folder can be copied to another project with no other QA skill
installed. `QA_LITE_FULL_DIR` still overrides the engine folder (tests, or pointing at a newer Full skill on purpose).

## Provenance

- Source: `.claude/skills/link-qc-5-test-run-automation/` version **3.2.0**, copied 2026-11-01 — including the shared fixes Lite
  1.1.0–1.3.0 made in Full (run-data `resolveStatusLines`, check 53 `modify-external`, `superseded_attempts`, validator L17 / L18,
  impact `isOutputPath`, renderer `statusLineMismatches`, the config template's JSON reporter).
- Copied: `assets/` (templates), `references/` (with `schemas/`), `scripts/*.mjs` except `selftest*.mjs`, and only the
  `scripts/fixtures/{check,impact,run-data,run-stage}/` folders Lite's selftest reads. Not copied: Full's `SKILL.md` (replaced by a
  front-matter stub that carries `metadata.version` for `check.mjs skillVersionOf` and is `user-invocable: false`), `INPUT.txt`,
  Full's selftests, its other fixtures and `references/maintainers/` (never loaded at run time; the engine docs' "Detail:
  references/maintainers/…" pointers refer to the link-qc-5 skill's copy).

## Local changes to the engine (re-apply after a refresh)

1. `engine/scripts/run-stage.mjs` — the `config location` fix hint names `config-inventory.mjs` by its path relative to the project
   root (`path.relative(root, path.join(here, 'config-inventory.mjs'))`) instead of the hard-coded link-qc-5 path.
2. (1.5.0) `engine/scripts/project-env.mjs` — `CONSTITUTION`, `constitutionPaths()`, `discoverAutomationRoot()`; `automationRootOf()`
   falls back to the discovery instead of a fixed `Testing/Automation`.
3. (1.5.0) `engine/scripts/check.mjs` — its private `automationRootOf` delegates to project-env (import added).
4. (1.5.0) `engine/scripts/validate-automation.mjs` — `resolvePaths`: the automation root from project-env when no flag / manifest, and
   tests / pages / api / db derived from it instead of fixed `Testing/Automation/…` paths (import added).
5. (1.5.0) `engine/scripts/run-stage.mjs` — `projectRootOf` also stops at `.specify/memory/constitution.md`.

With a `Testing/qa-manifest.json` that names its paths, 2-5 change nothing. Nothing else differs from Full 3.2.0: the engine keeps the Full gate-record shape, the `@link-qc-5-template` markers and the
`link-qc-5-*` artifact names, so reports, gate records and run files stay readable by the Full skill and its renderer.

## Lite rules that override the engine's references (the engine text is left unchanged)

- **Sign-in** — Lite rule 13 (sign in once per role: `storageState` setup project or an API helper) replaces the engine's
  `code-craft.md` §15 / `<pom_mandatory>` line "login per test through `{login_page_object}`, no `storageState`" (Full's decision
  2026-10-19). `scratch.mjs` still refuses `storageState` in an investigation probe — probes log in through the page object.
- **Delivery** — Lite does not ask Full's delivery question (`intake.md` item 4); it uses md + failed-only screenshots unless a flag
  says otherwise.

## Engine manifest

`references/maintainers/engine-manifest.json` holds the sha256 (line endings normalised) of every engine file except the fixtures;
selftest case 30 fails on any changed, extra or missing file and on an engine version that differs from the manifest. After a
deliberate engine change (a refresh or a new local change listed above) regenerate it:
`node scripts/selftest-lite.mjs --write-engine-manifest`. The installed link-qc-5 is not compared: it can be older or newer than
the engine (this repo's is 3.1.0 while the engine is 3.2.0), so case 30 only reports its version (`fullInstalled`).

## Refreshing the engine from a newer Full

1. Copy the same set again (above), keep `engine/SKILL.md` and set its `metadata.version` to the Full version.
2. Re-apply the local changes listed above.
3. `node scripts/selftest-lite.mjs --write-engine-manifest`, then `node scripts/selftest-lite.mjs` must stay green; when the
   engine's scripts changed, run Full's own selftests in the Full folder.
4. Note the new Full version here and in `CHANGELOG.md`.

A fix made in the engine is NOT in the Full skill (and the reverse): the two copies drift until someone refreshes one from the other.
