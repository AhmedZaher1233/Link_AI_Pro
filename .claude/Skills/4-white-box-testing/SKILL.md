---
name: generic-implementation-analysis
model: claude-opus-5
description: Stack-agnostic implementation audit. Analyse any codebase against a requirement (spec.md, user story, ticket, or free-text acceptance criteria) to verify implementation correctness. On the first run in a new project it auto-profiles the repository — detecting language, frameworks, monorepo layout, architectural layers, requirement sources and test locations — and derives its own code-discovery and search strategy, caching it as a reusable project profile. Then identifies gaps, potential bugs, and concrete reproduction scenarios. Use when the user asks to verify implementation, find bugs for a story, check if a spec is implemented, audit an implementation, or trace a requirement in code — especially in a project this skill has not seen before. Trigger on phrases like "generic implementation analysis", "analyse implementation", "audit implementation", "check if implemented", "find bugs for", "implementation gaps", "trace spec in code", "trace story in code", "verify the code for".
argument-hint: "[<story-id> | <feature-name> | <path/to/spec.md> | <path/to/story.md>] [--reprofile]"
---

# Generic Implementation Analysis Skill

You are a senior software engineer and QA auditor working in a **project you may never have seen before**.
Your job: read a requirement, discover where and how it is implemented, then produce a structured report of
**gaps**, **potential bugs**, and **reproduction scenarios**.

Nothing about the stack is assumed. Everything about *where code lives* is **derived from the repository itself**
in Phase 0 and cached, so the first run pays the discovery cost once and later runs are fast.

**Constraints**
- Write output ONLY to the analysis output directory (default `Testing/White_Box_Testing/`, see 0.6).
- Never modify source code, config, or any file outside that directory.
- Read-only exploration everywhere else.

---

## Execution Workflow

Phase 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6. Do not skip phases. Phase 0 runs in full only on first use.

---

## Phase 0 — Project Profiling (auto, first run only)

### 0.1 Check for an existing profile

```bash
cat "Testing/White_Box_Testing/.project-profile.md" 2>/dev/null || echo "NO_PROFILE"
```

- Profile found **and** `--reprofile` was NOT passed -> read it, run the staleness check in 0.7, then go to Phase 1.
- `NO_PROFILE` or `--reprofile` -> run 0.2 – 0.6 to build it.

Search for the profile in this order and use the first hit: `Testing/White_Box_Testing/.project-profile.md`,
`Testing/white-box-testing/.project-profile.md`, `test/analysis/.project-profile.md`,
`.claude/.project-profile.md`, `docs/analysis/.project-profile.md`.
If found in a legacy location, keep reading it from there but write all NEW analysis output to
`Testing/White_Box_Testing/`.

### 0.2 Repository shape

```bash
git rev-parse --show-toplevel
git ls-files | head -400
git ls-files | wc -l
ls -a
```

If not a git repo, fall back to `find . -maxdepth 3 -type d -not -path '*/node_modules/*' -not -path '*/.git/*'`.

Record: repo root, total tracked files, top-level directories.

### 0.3 Detect stacks from manifests

Search the repo (max depth ~4, ignoring `node_modules`, `dist`, `build`, `bin`, `obj`, `target`, `vendor`, `.venv`):

| Manifest / marker | Stack inferred |
|---|---|
| `package.json` | JS/TS — read `dependencies` for framework (react, next, @angular/core, vue, svelte, express, nest, fastify) |
| `*.sln`, `*.csproj`, `Directory.Build.props` | .NET — read `<TargetFramework>` and `PackageReference`s |
| `pom.xml`, `build.gradle(.kts)` | Java/Kotlin — Spring Boot, Micronaut, Quarkus |
| `go.mod` | Go — gin/echo/chi/fiber |
| `Cargo.toml` | Rust — axum/actix/rocket |
| `pyproject.toml`, `requirements.txt`, `Pipfile` | Python — django/flask/fastapi |
| `Gemfile` | Ruby — rails/sinatra |
| `composer.json` | PHP — laravel/symfony |
| `nx.json`, `turbo.json`, `pnpm-workspace.yaml`, `lerna.json`, `go.work`, workspace `Cargo.toml` | **Monorepo** — enumerate the workspace globs to get the real project list |
| `Dockerfile`, `docker-compose.yml`, `*.tf`, `k8s/`, `helm/` | Deployment surface (relevant for config/secrets findings) |
| `.github/workflows/`, `azure-pipelines*.yml`, `.gitlab-ci.yml` | CI — tells you which test commands are authoritative |

A repo may match several rows — record **all** of them, marking which is backend and which is frontend.

### 0.4 Derive the layer map (the core of discovery)

Do **not** guess from directory names alone. Combine two signals.

**Signal A — directory and file naming.** List directories 2–4 levels deep and match against these role hints:

| Role | Common directory / file-name hints |
|---|---|
| HTTP entry point | `controllers`, `api`, `routes`, `endpoints`, `handlers`, `resources`, `pages/api`, `*Controller.*`, `*Router.*`, `urls.py` |
| Application / use case | `application`, `services`, `usecases`, `commands`, `queries`, `handlers`, `interactors`, `*Service.*`, `*Handler.*`, `*UseCase.*` |
| Domain / model | `domain`, `models`, `entities`, `core`, `aggregates`, `*Entity.*`, `models.py`, `schema.*` |
| Persistence | `repositories`, `persistence`, `data`, `dal`, `infrastructure`, `migrations`, `*Repository.*`, `*Dao.*`, `dbcontext`, `prisma/`, `entity/` |
| Validation | `validators`, `validation`, `schemas`, `*Validator.*`, zod / joi / FluentValidation / pydantic usages |
| Contracts / DTO | `contracts`, `dto`, `dtos`, `types`, `*.d.ts`, `openapi*.yaml`, `*.proto` |
| Auth / permission | `auth`, `identity`, `security`, `policies`, `guards`, `middleware`, `[Authorize]`, `@UseGuards`, `permission_required` |
| Background / async | `jobs`, `workers`, `tasks`, `schedulers`, `consumers`, hangfire / celery / sidekiq / bullmq / cron refs |
| Messaging / events | `events`, `messaging`, `integration`, `*Event.*`, publish/subscribe, kafka / rabbit / masstransit refs |
| Notification | `email`, `mail`, `notifications`, `templates`, `*Notification*` |
| Configuration | `appsettings*.json`, `.env*`, `config/`, `settings.py`, `application.yml`, `*.config.ts` |
| UI component | `components`, `features`, `pages`, `screens`, `views`, `libs/`, `*.tsx`, `*.component.ts`, `*.vue` |
| UI routing | `routes`, `router`, `app-routing*`, `pages/`, Next `app/`, `*.routes.ts` |
| UI data access | `api`, `services`, `hooks`, `store`, `queries`, `*.service.ts`, `use*.ts`, `slices` |
| i18n | `i18n`, `locales`, `translations`, `lang` |
| Tests | `test`, `tests`, `spec`, `__tests__`, `*.test.*`, `*.spec.*`, `e2e`, `*IntegrationTests*` |

**Signal B — confirm by sampling.** For each role matched, open **1–2 files** and verify the content really plays
that role (a `controllers` folder actually containing route attributes/decorators; a `services` folder actually
containing business logic). Downgrade or drop any role whose sample does not confirm.

**Prefer explicit documentation over inference.** Before inferring, read whichever of these exist — they usually
state the architecture outright and override your guesses:
`CLAUDE.md`, `AGENTS.md`, `.claude/rules/**`, `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `docs/**`,
`.cursorrules`, any `specs/*/plan.md`.

### 0.5 Derive the search strategy

From the layer map, write down for this project:

1. **Glob patterns per role** — a concrete pattern per layer, e.g. `src/**/*Controller.cs`, `apps/*/src/routes/**/*.ts`.
2. **Ignore globs** — vendor/build dirs found in 0.2, plus anything in `.gitignore` worth skipping.
3. **Identifier casing conventions** — PascalCase / camelCase / snake_case / kebab-case, taken from real filenames.
   Every later search must try the requirement's vocabulary in **all conventions actually used here**.
4. **Vocabulary expansion rules** — singular/plural, plus the verb synonyms actually observed in this codebase
   (`Get/Fetch/List/Query`, `Create/Add/Register`, `Update/Edit/Modify`, `Delete/Remove/Archive`).
5. **Trace order** — the sequence to follow when tracing a feature, e.g.
   `route -> controller -> service/handler -> domain -> repository -> DB`, adjusted to the layers that actually exist.
6. **Test command(s)** — from `package.json` scripts, CI workflow files, `Makefile`, or docs.
   Record them; do not run them in this skill without asking.

### 0.6 Locate requirement sources and the output directory

```bash
git ls-files | grep -Ei '(spec|stor(y|ies)|requirement|feature|prd|acceptance)' | head -60
```

Record every directory holding requirements (e.g. `specs/*/spec.md`, `test/User stories/*.md`,
`docs/features/*.md`, `*.feature` Gherkin files) and the ID convention used (e.g. `US-123456`).

**Output directory** — first that applies:
1. `Testing/White_Box_Testing/` if a `Testing/` folder exists (the project's standard testing structure —
   see the `generate-testing-structure` skill). Create the `White_Box_Testing/` subfolder if missing.
2. Otherwise create `Testing/White_Box_Testing/` at the repo root and use it.

Legacy analysis dirs (`Testing/white-box-testing/`, `test/analysis/`, `docs/analysis/`) are read-only
history — never write new output there.

### 0.7 Write / refresh the profile

Write to `<output-dir>/.project-profile.md`:

```markdown
# Project Profile — {repo name}
Generated: {YYYY-MM-DD} · Head: {git short sha} · Tracked files: {N}

## Stacks
| Role | Language / Framework | Root path | Manifest |
|---|---|---|---|

## Monorepo layout
{workspace tool + project list, or "single project"}

## Layer map
| Role | Path glob | Confirmed by sample | Notes |
|---|---|---|---|

## Search strategy
- Ignore globs: ...
- Casing conventions: ...
- Vocabulary expansion: ...
- Trace order: ...

## Requirement sources
| Kind | Path glob | ID convention |
|---|---|---|

## Test suites & commands
| Suite | Path | Command | Authoritative? |
|---|---|---|---|

## Authoritative docs consulted
- {path} — {what it dictates}

## Confidence & unknowns
- {role or area that could not be confirmed, and why}
```

**Staleness check on later runs**: if the recorded head sha differs and
`git diff --name-only <recorded-sha>..HEAD` touches manifests, workspace config, or adds top-level directories,
re-run 0.3–0.6 and rewrite the profile. Otherwise reuse it as-is.

Tell the user in one line whether you built a new profile or reused a cached one.

---

## Phase 1 — Requirement Ingestion

### 1.1 Resolve the requirement

| Argument | Action |
|---|---|
| Path ending in `.md` / `.feature` / `.txt` | Read directly |
| ID or feature name | Search every requirement source from profile §Requirement sources, by filename and content. If several match, prefer the most formal artifact (spec > story > ticket dump) and cross-reference the others |
| Blank | List the requirement sources found and ask which requirement to analyse |

If the requirement has sibling artifacts (`plan.md`, `data-model.md`, `contracts/`, `tasks.md`, linked ADRs,
API schemas), read them read-only for trace context.

### 1.2 Extract

Record every: **scenario**, **business rule** (must/should/always/never), **configurable value / named constant**,
**threshold or cutoff**, **role / persona**, **permission rule**, **notification or email**, **idempotency rule**,
**skip condition**, **integration point** (job, queue, webhook, external API), **non-functional requirement**
(performance, audit, concurrency).

Build a **Scenario Checklist** — one row per scenario/rule — to be verified in Phase 3.

Also extract the **domain vocabulary**: entity nouns, action verbs, role names, status/enum values. This is the
input to Phase 2.

---

## Phase 2 — Code Discovery

Drive every search from the profile's layer map and search strategy — never from hardcoded paths.

### 2.1 Search loop

For each domain term from 1.2:

1. Expand it using the profile's casing conventions and vocabulary rules
   (e.g. `resource request` -> `ResourceRequest`, `resourceRequest`, `resource_request`, `resource-request`,
   `ResourceRequests`, `RequestResource`).
2. Grep repo-wide (with the profile's ignore globs) for each variant; record hit counts per directory.
3. Map the hit directories onto the layer map to see which roles are covered and which are silent.
4. For each covered role, open the top files and follow the profile's trace order outward
   (caller -> callee, route -> handler -> service -> repository), plus every reference to the enums/statuses from 1.2.
5. If a term yields **no hits**, try: synonyms, the DB table/column name, the i18n label text, the API URL segment,
   and the frontend field name. Only after all of those fail, mark it **NOT FOUND**.

### 2.2 Cross-cutting sweeps

Regardless of vocabulary, always check the requirement's:
- permission/auth enforcement at every entry point found,
- validation of every input the requirement names,
- config keys the requirement names (search config files *and* the code that reads them),
- background/async path, if the requirement mentions scheduling, retries, or bulk processing,
- notification/email path, if the requirement mentions telling someone,
- existing tests covering it (profile §Test suites) — a test is evidence of intent, and its assertions may
  contradict the requirement.

### 2.3 Record

Build an **Implementation Map**: file -> layer role -> scenario(s) served -> ✅ Found / ⚠️ Partial / ❌ Not found.

---

## Phase 3 — Gap Analysis

For each Scenario Checklist row, decide whether the code covers it.

| Gap type | Description |
|---|---|
| Missing scenario | No code path at all (no route, handler, branch) |
| Partial implementation | Happy path only; edge/error/boundary cases absent |
| Missing business rule | An explicit rule is not enforced anywhere |
| Missing validation | Required input constraint not enforced server-side |
| Missing permission check | Requirement restricts to a role; no guard/policy at the entry point |
| Missing notification | Requirement demands a message; no send call on that path |
| Missing configurability | Named constant hardcoded instead of read from config |
| Missing idempotency / concurrency guard | Re-run or parallel run would double-process |
| Missing persistence / audit | Requirement says record/log/track; nothing is written |
| Layer mismatch | Rule enforced only in the UI, trivially bypassable via the API |
| Frontend gap | Backend exists but no UI surfaces it, or vice-versa |
| Contract mismatch | API shape differs between producer and consumer |

Record per gap: scenario ref · expected behaviour · what is missing · affected file(s) or "none found" ·
severity 🔴 Critical / 🟠 Major / 🟡 Minor.

---

## Phase 4 — Bug Detection

Read every file found in Phase 2. Look for logic contradicting the requirement.

**Stack-agnostic bug patterns**

| Category | What to look for |
|---|---|
| Boundary direction | `>` vs `>=`, `<` vs `<=` on thresholds and cutoffs; inclusive/exclusive ranges |
| Wrong comparison axis | Comparing the wrong timestamp/field (created vs completed, now vs stored) |
| Time & zone | Local vs UTC mixing, DST, date-only vs datetime truncation |
| Wrong entity assignment | Value written to the wrong record, owner, or period |
| Null / empty guards | Nullable deref, empty collection assumed non-empty, default masking absence |
| Wrong filter or scope | Query misses or over-includes records; missing tenant/cycle/status scoping |
| Aggregation errors | Sum/count over the wrong grouping; rounding and fractional splits |
| Ordering assumptions | Relies on unordered query results |
| Duplicate processing | No processed-flag or dedupe key before re-running |
| Race & concurrency | No lock, no concurrency token, read-modify-write gap |
| Transaction boundary | Multiple writes not atomic; partial state on failure |
| Silent failure | Swallowed exception or silent skip where the requirement demands an error |
| Error surface | Internal details leaked, or wrong status code / user-facing message |
| Auth flaws | Authenticated but not authorized; object-level ownership unchecked (IDOR) |
| Injection / unsafe input | String-concatenated queries or commands built from user input |
| Secrets & config | Hardcoded credentials, endpoints, or thresholds |
| API contract drift | Field name/type/nullability mismatch between backend and client |
| N+1 / performance | Query inside a loop; unbounded result set; missing pagination |
| Wrong recipient / template | Notification to the wrong role or from the wrong template |
| UI state | No loading/disabled state; double-submit possible; stale cache after mutation |
| Dead or unreachable code | Branch that can never execute given upstream guards |

Record per bug: `BUG-{FEATURE}-{NNN}` · category · file:line · requirement expectation · actual code behaviour ·
severity 🔴/🟠/🟡/🔵 · confidence High/Medium/Low.

**Before reporting**, re-read the exact lines and confirm no upstream guard already handles the case.
Downgrade to Low confidence anything you could not fully trace, and say why.

---

## Phase 5 — Reproduction Scenarios

For every 🔴 Critical or 🟠 Major finding:

```
SCENARIO: {Bug ID} — {short title}

Preconditions:
  - {specific data setup: entities, field values, dates}
  - {system state: config keys, feature flags, actor's role}

Steps to Reproduce:
  1. {actor + action — UI step or API call with a concrete payload}
  2. ...
  3. Observe: {what currently happens}

Expected Behaviour:
  {what the requirement says}

Actual Behaviour (Predicted):
  {what the code will produce, per Phase 4}

Code Reference:
  {file}:{line or symbol}

Suggested Fix:
  {concrete change, one or two lines}
```

Where an API-level repro is possible, give the request (method, path, body) as well as the UI steps.

---

## Phase 6 — Write Report

```bash
mkdir -p <output-dir>
```

Write `<output-dir>/{RequirementID}-{FeatureName}-analysis.md` using this template:

```markdown
# Implementation Analysis — {Requirement Title}
**Requirement ID**: {ID}
**Date**: {YYYY-MM-DD}
**Source**: {relative path}
**Profile**: {new | reused, generated YYYY-MM-DD}
**Commit**: {git short sha}

---

## Executive Summary

| Metric | Count |
|---|---|
| Scenarios / rules analysed | N |
| Implementation files found | N |
| Gaps identified | N |
| Potential bugs identified | N |
| Critical / Major issues | N |
| Reproduction scenarios | N |

**Overall Implementation Status**: ✅ Fully Implemented / ⚠️ Partially Implemented / ❌ Not Implemented

## Project Context (from profile)
| Aspect | Value |
|---|---|
| Stacks | |
| Trace order used | |
| Test suites relevant | |

## Implementation Map
| Scenario / Rule | Layer role | File | Status |
|---|---|---|---|

## Gap Analysis
| # | Scenario | Gap type | Expected | Missing | Severity |
|---|---|---|---|---|---|
{If none: "No gaps identified."}

## Potential Bugs
| # | Bug ID | Category | File:Line | Expectation | Code behaviour | Severity | Confidence |
|---|---|---|---|---|---|---|---|
{If none: "No bugs identified."}

## Reproduction Scenarios
{One SCENARIO block per Critical/Major finding}

## Minor Observations
{Low-severity notes}

## Coverage of Existing Tests
| Requirement rule | Existing test | Verdict |
|---|---|---|

## Recommendations
### Must Fix (Critical / Major)
- [ ] {ID}: {title} — {one-line fix}
### Should Fix (Minor)
- [ ] {ID}: {title}
### Gaps to Implement
- [ ] {ID}: {what to add}
### Suggested Tests to Add
- [ ] {scenario} — covers {ID}

## Unverified / Assumptions
- {anything you could not confirm, and what would confirm it}
```

---

## After Writing

Report to the user:

```
## Implementation Analysis Complete — {Requirement Title}

**Requirement**: {ID} — {title}
**Project profile**: {built new | reused (generated {date})} — {stacks}
**Files analysed**: N across N layers

**Gaps**: N  (🔴 N | 🟠 N | 🟡 N)
**Bugs**: N  (🔴 N | 🟠 N | 🟡 N | 🔵 N)
**Reproduction scenarios**: N

**Top issues**:
  {BUG-001}: {title} — {file:line}
  {G-001}:   {gap}

**Report**: {output-dir}/{ID}-{Feature}-analysis.md
**Profile**: {output-dir}/.project-profile.md  (re-run with --reprofile after big structural changes)
```

---

## Notes

- **Never invent paths.** Every path you cite must come from an actual search hit.
- **Confidence over volume.** A short report of confirmed findings beats a long list of speculation.
- If Phase 0 cannot confirm a layer, say so in the profile's *Confidence & unknowns* section and treat any
  finding that depends on it as Low confidence.
- If the project already has a stack-specific analysis skill, prefer that one; this skill is the fallback for
  unfamiliar or mixed repositories.
