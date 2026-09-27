# Run modes — classification, A/B/C matrix, restructure procedure

Load this reference right after `preflight.mjs` has run. Everything here decides *what the
run may do*; the checks themselves live in the scripts.

## 1. Classification (from the preflight snapshot, never from a mutated state)

`preflight.mjs` reports markers M1–M7 and a `classification`:

| # | Marker | Counts for classification? |
|---|--------|---------------------------|
| M1 | Testing root exists (`Testing/` or a legacy name) | yes |
| M2 | Automation code exists (spec files or `pages/` folders) | yes |
| M3 | Playwright configured | yes (secondary) |
| M4 | MCP configured | yes (secondary) |
| M5 | QA skills installed | **no — informational only.** The skill installs skills itself, so skill presence must never decide project maturity. |
| M6 | Steering docs exist | yes (secondary) |
| M7 | Learning file exists | yes (secondary) |

* **NEW PROJECT** — neither M1 nor M2, and fewer than two of M3/M4/M6/M7. A project with only
  Playwright (M3, for app development) is NEW. Run the full setup without asking.
* **EXISTING PROJECT** — M1 or M2, or any two of M3/M4/M6/M7. **Stop and ask the mode question.**
  Never pick a mode yourself.

Report the classification with its evidence before asking:

```text
Project classification: EXISTING PROJECT
Evidence: Testing/ (12 folders, 34 spec files), playwright.config.ts, .mcp.json (3 servers),
          docs/steering/ (L1 L2 L3), Testing/project-learning.md · QA skills: 5/7 present
```

## 2. Mode question (EXISTING PROJECT only)

If the invocation carried `audit`, `repair` or `restructure` as an argument, map it to A/B/C,
say so in one line, and skip the question. Otherwise ask exactly this and WAIT:

```text
This project already has a testing structure. What should I do?

  A) AUDIT — health-check only (recommended first)
     Verify everything and report — Node/NPM, Playwright, folder layout, steering docs,
     learning file, .mcp.json and every MCP server, QA skills (present + up to date),
     manifest. Writes NOTHING: no downloads, no installs, no renames, no learning-file or
     manifest update. Lists exactly what B would change.

  B) REPAIR — update skills and add what is missing (keep the structure as it is)
     Sync skills 1-12, 3b and 3c + the sync-skills command from the source repo, install any missing
     steering layer, folder, MCP entry or learning-file section, normalize non-canonical
     steering file names, migrate an uppercase .claude/Skills folder, write the manifest,
     then health-check. Existing folders, tests, pages, configs, steering content and
     learning entries are never moved or rewritten.

  C) RESTRUCTURE — migrate to the canonical layout
     Move automation/, pages/, tests/, reports/, screenshots/ and steering files under the
     canonical roots, update imports and config paths, then do everything in B.
     I will show the exact move plan (old path → new path) and ask you to confirm it
     before moving a single file. Nothing is deleted — only moved.

Reply A, B or C.
```

## 3. What each mode may do

| Step | A — Audit | B — Repair | C — Restructure |
|------|-----------|------------|-----------------|
| `preflight.mjs` | run | run | run |
| Skills sync (`sync-qa-skills.mjs`) | `--check` only | `--apply` | `--apply` |
| Testing/ folders | verify | create **missing** only | create after the move plan is confirmed |
| Steering docs | verify | install missing layers, rename non-canonical, seed README | same, plus relocate from non-standard dirs (confirmed) |
| Node / NPM / Playwright | verify | install/repair **missing** pieces | same |
| playwright-cli (skill 3c only) | verify; `sync --check` lists the planned `--tools` actions | ask once "install playwright-cli for skill 3c? (yes/no)" (recorded, never re-asked); yes → `sync --apply --tools` / `toolchain.md`; no → WARN rows stay, 3b unaffected | same |
| `.mcp.json` | validate (incl. Azure DevOps hosting vs entry) | add **missing** entries only — the `azure-devops` entry as the cloud or self-hosted block per the detected hosting (`mcp-setup.md` §1b); an existing entry with the wrong package for the host is reported, rewritten only after the user confirms | same |
| Uppercase `.claude/Skills` | WARN | migrate to `.claude/skills` | same |
| Learning file | verify | create if missing; add missing sections; rename legacy heading; write Setup Model lines | same, plus migration entry |
| `Testing/qa-manifest.json` | verify | write / refresh | write / refresh |
| `validate-setup.mjs` | run | run | run |
| Report | PASS/FAIL table + **Would be fixed by B** + **Needs C** | full report | full report + migration table |

**Mode A performs zero writes.** No file is created, edited, renamed, downloaded or installed,
and the learning file and manifest are not touched. Every FAIL/WARN row says which mode fixes
it. Missing skills are reported under "Would be fixed by B" with the hint `/sync-skills`.

**Mode B never changes anything that exists and is valid.** Valid = present, parses, canonical
path. Invalid content is reported, not rewritten. The only in-place changes B makes are
renames with reference updates (steering names, skills folder case, legacy learning heading).

**A NEW project** runs the Mode B column end to end without the question.

## 4. Mode C — restructure procedure

1. `preflight.mjs` must show a clean git tree, or the user explicitly accepts working on a
   dirty tree. Record the acceptance.
2. Build the **move plan**: one row per move — `old path → new path`, reason, files affected
   (imports, `testDir`, `outputDir`, `reporter` paths, steering references).
3. Ask `Apply this move plan? (yes/no)`. Anything but an explicit yes → fall back to Mode B
   and say so.
4. Move with `git mv` in a git repo (plain rename otherwise). Never delete.
5. Update every reference that pointed at an old location.
6. Prove nothing broke: `npx playwright test --list` (or the project's equivalent).
7. Record the migration in `Testing/project-learning.md` under *Setup Model (skill 1)* and in
   the manifest's `deviations` (cleared entries for what is now canonical).

A large move plan (many files or several roots) is a reasonable moment to suggest a stronger
model for the session — as advice to the user, never as a requirement.

## 5. Preserving an existing structure (all modes)

* `Testing/` or `automation/` already present → reuse; extend in place; never duplicate.
* Legacy lowercase names under `Testing/` (`requirements/`, `automation/`,
  `white-box-testing/`) are valid structure; extend them and record the deviation in the
  manifest.
* Steering documents living elsewhere (`steering/`, `docs/qa/`, `.claude/rules/`) are relocated
  only in Mode C with confirmation; otherwise record the actual path as a deviation so skills
  2-11 can be pointed at it.
* A valid root-level `automation/` project is relocated only in Mode C; otherwise extend in
  place and record the deviation.
* Another naming convention → document the decision before changing anything.
