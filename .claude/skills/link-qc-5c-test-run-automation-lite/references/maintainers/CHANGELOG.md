# link-qc-5c-test-run-automation-lite — changelog (maintainers copy)

Not loaded by the model. The model-facing references keep one line per rule; the reasoning, the edge cases and the shared-script
impact live here. Self-tests: `node scripts/selftest-lite.mjs` (Lite) — and, when a Full script changed, every
`link-qc-5-test-run-automation/scripts/selftest*.mjs` plus the mirrors in `link-qc-5b-test-run-manual-cli`.

## 1.5.1 — 2026-11-01

Fixes from a skill-quality review; no script behaviour or gate changed.
- Folder renamed `link-qc-5b-test-run-automation-lite` → `link-qc-5c-test-run-automation-lite`: it now equals the front-matter
  `name`, so every documented call path (`.claude/skills/link-qc-5c-…/scripts/lite.mjs`, the engine paths) resolves, and "5b" again
  means only the manual CLI run.
- `allowed-tools`: the bare `Bash` and `mcp__azure-devops` pre-approvals removed (they approved every shell command and every
  Azure DevOps write); `Bash(node *run-data.mjs handoff*)` added. Stage 1's two `grep` calls now use the Grep tool.
- Stage 1 approval check anchored (`^\*{0,2}Status:`): the unanchored search could hit the title of a feature named "… status" and
  "approve now" would then have rewritten the title. The `run-data.mjs handoff` call carries its engine path.
- INPUT.txt: version, the stale "DEPENDS ON (hard): link-qc-5" (standalone since 1.4.0) and the `Testing/Automation` output paths
  (the automation root is discovered since 1.5.0).
- `lite-rules.md`: rule 13 states it overrides the engine's code-craft §15 "no `storageState`"; "Not in Lite" lists the delivery question.
- Selftest case 21: folder = `name`, every documented `.claude/skills/link-qc-5c-…` path resolves, SKILL.md / INPUT.txt /
  `LITE_VERSION` agree, no bare `Bash` / MCP pre-approval, the anchored Status line. New case 30: the engine matches
  `references/maintainers/engine-manifest.json` (`--write-engine-manifest` regenerates it; ENGINE.md).

## 1.5.0 — 2026-11-01

Engine trimmed 357 → 153 files: removed Full's fixtures Lite's selftest never reads (kept `check`, `impact`, `run-data`,
`run-stage`) and `engine/references/maintainers/` (never loaded). Run-time scripts, assets and model-facing references unchanged.
Selftest 38/38 in place and in an isolated copy.

Any Spec Kit project: `Testing/qa-manifest.json` and the learning file are optional; nothing blocks on them and Lite never creates
them. The constitution (`.specify/memory/constitution.md`) is read, never written.

- **One automation-root resolver** (`engine/scripts/project-env.mjs` `discoverAutomationRoot` / `constitutionPaths`): explicit →
  manifest `paths.automationRoot` → the constitution's backticked e2e / automation / playwright folder → the folder of the project's
  ONE Playwright config → existing `Testing/Automation` → `tests/e2e` when `.specify/` exists → `Testing/Automation`; `{path, source}`.
  `check.mjs`, `validate-automation.mjs`, `config-inventory.mjs` (through `automationRootOf`) and Lite all use it.
- **Validator paths follow the automation root** when no manifest names them (`{root}/tests`, `/pages`, `/api`, `/db`): without it a
  project outside `Testing/Automation` got `pom-architecture-unknown` and no POM rules — the gate is now applied, not skipped.
- **Project root** (`run-stage.mjs projectRootOf`) also stops at a Spec Kit constitution; Lite `preflight` names `--root` (the cwd).
- **`lite init-run`**: `--tc` may be a folder or absent (exactly one `TEST-CASES-*.md`, else BLOCKED with `candidates[]`); the sibling
  `TEST-DATA-*.md` and the nearest `spec.md` are found; `lite.sources` records every input once; a Spec Kit feature folder (`001-x`) is
  the story id. `checkpoint-a` / `finalize` take the automation root from the results root (`…/reports/…`).
- Docs: rule 14 "project knowledge first" (constitution read once, its rules apply unless one weakens a gate), rule 15 roots, stage 1
  §2-3, stage 4 learning write-back only to an existing file. Always-loaded set 3,959 tokens (budget 4,000).
- Selftest case 29: a Spec Kit project with a constitution and test artifacts, no manifest / learning file — init-run discovery and
  ambiguity, reconcile + Checkpoint A PASS, POM still FAILs a raw locator, preflight READY, nothing created, constitution
  byte-identical, resolver order. 38 / 38.

## 1.4.0 — 2026-11-01

Standalone skill: the link-qc-5 3.2.0 runtime is vendored into `engine/` (scripts, templates, references, the selftest fixtures);
`lite.mjs` resolves `FULL_DIR` to `../engine` (override `QA_LITE_FULL_DIR`) and BLOCKS with "the Lite engine is missing" when it is
absent. SKILL.md defines "Full" as that engine copy, so every `Full x.md` pointer resolves inside the skill. Path hints in
`preflight` (lite) and `run-stage.mjs` (engine) name `config-inventory.mjs` by its real relative path. Provenance, the one engine patch
and the refresh procedure: `ENGINE.md`. Behaviour, gates and file shapes are unchanged.

## 1.3.0 — 2026-10-29

Source: evaluation E3 of Lite run 3 (`Evaluate-Skill/link-qc-5c-test-run-automation-lite/HISTORY.md`). Every fix is written for any
story, app and team: no story content in the skill, behaviour that differs between apps is probed or asked once and recorded,
fixtures are synthetic, and no gate accepts less — the checks understand more correct code.

### L11 — no false re-runs (output roots are never inputs)
- **Seen:** Checkpoint A's `playwright test --list` ran with the project's reporters; the JSON reporter's fallback file
  (`artifacts/stages/unnamed.json`) was rewritten; the impact analysis read the config's string literal naming that file as a
  `data:` input, so every result went stale and all TCs ran again with identical verdicts.
- **Layer 1 — inspection runs have no side effects** (`lite.mjs listSpecs`): `--reporter=list` (the config's JSON / HTML
  reporters never write), `--output=<OS temp dir>` (removed after), `PW_OUTPUT_DIR` pointed there, the stage variables
  (`PW_STAGE_JSON`, `PW_PROGRESS_FILE`, `PW_PHASE`, `PW_STAGE_ATTEMPT`, …) removed from the child environment.
- **Layer 2 — freshness inputs** (Full `impact.mjs`, shared): `isOutputPath(root, file)` — a file whose first segment under the
  automation root is `reports`, `artifacts`, `screenshots`, `automation-logs`, `test-results`, `playwright-report`,
  `blob-report` or `.auth`, or that sits inside an `artifacts` / `test-results` / `playwright-report` / `blob-report` / `.auth`
  folder anywhere, is never a `data:` part — neither as a string literal in a hashed region nor as an imported data module.
  Inputs stay: the spec, its transitive imports, the config, declared test-data files (proven by the self-test: changing a
  `test-data/*.json` a spec names still stales that TC).
- **Template** (Full `assets/playwright.config.template.ts`, shared): the JSON reporter exists only when `PW_STAGE_JSON` is set —
  no `unnamed.json` fallback. Existing configs keep their fallback; layers 1 and 2 make it harmless.
- **Self-tests:** Lite 23 (a) hash of every output root before / after `checkpoint-a` with a fake CLI that writes the fallback
  file unless `--reporter=list` (control proves it would); (b) a rewritten file under `artifacts/` / `test-results/` → `stale: []`;
  (c) a page object imported by 2 of 5 specs → exactly those 2 TCs; (d) a config with no JSON reporter → same.

### P1 — sign in once per role
- **Seen:** preconditions signed in through the portal on every role switch (up to 8 sign-ins per TC); a pass took twice as long.
- **Decided per app, recorded once** (`lite auth`, run file `auth`): `mechanism` (cookie / token / other), `survives_reset`
  (true / false / no-reset), `language_scope` (profile / session / cookie / none), `api_signin` (yes / no), `strategy`, `per`,
  `why`, `source` (probe / flags / learning / probe+flags), `fallback_reason` for the UI fallback.
- **Strategy (`authStrategy`)**: survives the reset or no reset → `setup-project` (storageState per role, × language when the
  language lives in the session or a cookie); the reset ends sessions + API sign-in → `api-helper` (after each reset); no API path →
  `ui-fallback`, refused without a reason of ≥ 8 characters; unknown API path → BLOCKED asking for `--api-signin`.
- **Probe** (`--probe-spec`): runs the auth setup journey once as a Full setup-stage group (`auth-probe`) with `PW_AUTH_PROBE=1`;
  only on a `test` / `staging` environment (the probe may call the environment reset). `probe.json` is whitelisted to
  `mechanism, survives_reset, language_scope, cookie_names, storage_keys, checked_at, note` — any other key is refused (no value
  can slip in). The model writes the result to the learning file as generic `[type: env]` facts; the next run uses
  `--source learning` without probing.
- **Secrets:** `.auth/` is added to the automation root's `.gitignore` when `setup-project` is recorded; `finalize` removes the
  folder after PUBLISHED (`authStateRemoved`), `lite auth --clear` at any other close-out. Nothing reads or logs a state file.
- **Checkpoint A warning (`uiSignIns`)**: a test that is not a journey and whose title is not about sign-in (sign in / log in /
  sign out / lockout / password / session / post-login / redirect) and that calls a sign-in method (`login`, `signIn`,
  `signInAs`, `loginWith…`, …) on a non-API receiver more than once — its own body plus the `beforeEach` hooks around it. Silent
  when the strategy is `ui-fallback`. A warning, never a FAIL: indirect sign-ins inside page-object methods are invisible statically.
- **Templates:** `assets/templates/auth.setup.ts` (setup journey + probe mode), `auth.ts` (roles from TEST-DATA, `storageStateFor`,
  `saveState`, `writeProbe`, `signInAs` API helper with credentials by secret name), all generic.
- **Self-tests:** Lite 24 — fixture A (cookie, survives) → setup project per role (× language for session scope); fixture B
  (token, reset ends sessions) → API helper, from a probe file; fixture C (no API path) → refused without reason, UI fallback with
  it; probe with a value key refused; probe off test / staging refused; `--clear`; sign-in warning on a role switch and on
  beforeEach + body, never on a sign-in TC or an API helper; no stored session after `finalize`.

### L10 — setup / teardown journeys have no TC-ID
- **Seen:** the Lite teardown template has no `[TC-ID]` by design; traceability rejected it (`trace-title-missing-tcid`,
  non-exemptible) while stage 4 told the model to include it in finalize.
- **Fix:** a declared journey = annotation `{ type: 'journey', description: 'setup' | 'teardown' }` on the test or its describe
  (`journeysOf`). The exemption needs BOTH signals: declared in code AND listed in the run file (`lite.journeys`, written by
  `lite journey` or `lite teardown`). Exempt from `trace-title-missing-tcid` only; a journey title with a `[TC-ID]` FAILs; a
  declared-but-unlisted journey FAILs naming `lite journey`; an undeclared spec without a TC-ID still FAILs (with a hint when the
  file name says setup / teardown — the name is a hint, never the signal). Journeys never contribute to the TC mapping.
- `teardown --spec` accepts automation-root or project-relative paths (L15 of E2).
- **Self-tests:** Lite 25.

### L16 — titles built in a loop
- **Seen:** `for (const [id, lang] of …) test(\`[${id}] … [lang: ${lang}]\`)` — the static scan cannot read the IDs; variants were
  unrolled and the spec doubled.
- **Fix:** traceability reads the RESOLVED titles of the side-effect-free `--list` (`parseListTitles`: project, spec mapped onto
  the scope, line, last title segment). Rules on resolved titles: exactly one `[TC-ID]` per test (0 or ≥ 2 FAIL, naming the
  resolved title), one test per project × TC × variant (Full's `variationSlug`: a `— variation X` suffix is a declared variant;
  otherwise a second test of the same TC is a duplicate). The mapping (and so the coverage cross-check) comes from the resolved
  titles. Static parsing remains the fallback when `--list` cannot run (no CLI); a load error is a `tsc` FAIL. The mechanical
  cache re-lists an old snapshot whose list result has no titles (pre-1.3.0).
- Note: "exactly one TC-ID per resolved title" is stricter than Full's static rule (which accepts `[TC-1, TC-2]`); Lite applies it
  only to resolved titles, as E3 asked.
- **Self-tests:** Lite 26 (loop over a literal list PASS; no TC-ID / two TC-IDs / duplicate variant FAIL; declared variations PASS;
  integration with resolved titles PASS and the static fallback FAIL on the same loop spec).

### L17 — shared readiness waits flagged as duplicate pages
- **Fix (Full `validate-automation.mjs`, shared):** the `locators` evidence of `pom-duplicate-page` counts only page-specific
  locators — a locator literal that a common ancestor class declares (the shared base) or that a non-page component class declares
  (a class that does not take a Page: toast, dialog, header) is shared UI, not identity. A subclass and its own ancestor are never a
  pair (extension is the endorsed outcome). Name and route evidence are unchanged, so two classes with the same route still pair.
- **Template:** `assets/templates/base-page.ts` (route + root locator per page, readiness wait once).
- **Self-tests:** Lite 27; Full `selftest.mjs` (validator, 32 cases) unchanged and PASS.

### L18 — skip / fixme reason given as a constant (also Full E3 H1)
- **Fix (Full `validate-automation.mjs`, shared):** for the conditional form `skip(condition, description)` the reason is the LAST
  argument and counts only as a string literal, a template literal without `${}`, or an identifier bound by `const` to such a
  literal in the same module or exported by a relative import (aliases followed, depth ≤ 2). A `let` / `var`, a call, an
  expression, an empty or < 8-character string → `modifier-no-reason`. Before, any literal of ≥ 8 characters anywhere in the
  arguments counted — including one inside the condition or a call; that is now refused (tightened). Block and unconditional
  forms are unchanged.
- **Self-tests:** Lite 27 (literal, local const, imported const, aliased import, plain template → declared; let, '', call,
  template with an expression → no reason); Full `selftest.mjs` PASS.

### L19 — the report header tells the truth
- **Seen:** the published markdown said "Checkpoint B pending — see gate record" (the draft is rendered before B exists and is
  frozen by B); run 1's said BLOCKED (an earlier snapshot's record).
- **Fix (Full `run-data.mjs` + `render-run-report.mjs`, shared; renderer mirrored into skill 5b):**
  - `resolveStatusLines(text, { phase, gate })` rewrites ONLY the header `**Compliance:**` and the phase's `- **Compliance:**` /
    `- **Acceptance:**` bullets from ONE object — the B record of the snapshot being published (with the A record it froze).
    `publishPhase` verifies the draft against the frozen hash first, then promotes `resolve(draft, gate)`; the freeze stays
    provable (deterministic from frozen draft + gate record). The staged copy used for the pre-render is removed at once so it is
    never part of a later freeze.
  - The renderer gate, when given a Checkpoint B record, MISMATCHes (`status-line`) any status line of that phase that names
    another verdict ("pending" included), another snapshot, or no checkpoint — so an inconsistent report can never publish.
  - Acceptance: "ACCEPTED pending Checkpoint B" resolves to ACCEPTED when B is PASS, not void and has no stale result; otherwise
    NOT ACCEPTED with B's reasons — the same conditions as the final acceptance.
- **Self-tests:** Lite 19b (an earlier FAIL record on disk → header shows the published snapshot's PASS), Lite 28 (B PASS →
  header PASS with both snapshots; forced mismatch → MISMATCH); Full `selftest-run-data` 9 and `selftest-run-report` 34 updated.

### H-LF — learning-file hygiene
- The learning file holds application / environment facts only. A workaround for a skill / tooling defect goes under Deviations
  and in the return. A line that must stay is tagged `[type: tooling] [skill: x.y.z]`; stage 1 ignores tooling lines from an older
  skill version. Rule 14, stage 1 §3, stage 4 §4; Lite self-test 21 checks the wording.
- On this upgrade the two tooling-workaround lines of the project learning file (L10: keep the teardown out of the A scope; L11:
  run checkpoint-a before the last stage) were removed.

### Shared-script impact (Full skill 5, mirrored where Full mirrors)
| Script | Change | Full self-test |
|---|---|---|
| `validate-automation.mjs` | L17 page identity, L18 const reasons | `selftest.mjs` PASS (32/32) |
| `impact.mjs` | L11 `isOutputPath` | `selftest-impact.mjs` PASS |
| `run-data.mjs` | L19 `resolveStatusLines`, publish | `selftest-run-data.mjs` PASS (case 9 updated) |
| `render-run-report.mjs` (+ 5b copy) | L19 `statusLineMismatches` | `selftest-run-report.mjs` PASS in 5 and 5b (case 34 extended); skills 3 / 3b / 3c kit mirror PASS |
| `assets/playwright.config.template.ts` | L11 JSON reporter only with `PW_STAGE_JSON` | — |

Unrelated Full failures seen in the same run (no import of a changed script): `selftest-check` 21, `selftest-parallel-plan` 15
(known before), `selftest-run-stage` 38, `selftest-scratch` 12 / 13, `selftest-watchdog` 9.

### Measurement (next run, on a NEW story — not the one the learning file already knows)
Full passes = 1 without heals, ≤ 2 with heals · 0 false-stale TCs · Checkpoint A ≤ 2 rounds · finalize 1 round · 0 hand fixes ·
UI sign-ins outside sign-in TCs = 0 (or the recorded fallback reason) · report header = gate records · no tooling line added to the
learning file.

## 1.2.0 — 2026-10-29
L12 ledger ownership (template `createOrModify` / `inRunData`, `checkpoint-a` ownership lane), L14 stall in teardown, L13 in Full.

## 1.1.0 — 2026-10-29
E1 fixes: `consent`, `teardown`, `--force` / config-project default in `init-run`, `--burn-in`, `--list` + ledger warning in
`checkpoint-a`, Checkpoint A refresh in `finalize`.
