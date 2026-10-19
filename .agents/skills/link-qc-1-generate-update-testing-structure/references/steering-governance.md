# Steering governance — `docs/steering/`

Load when the preflight reports steering missing, non-canonical, duplicated, or when a run
may install/rename steering files (Mode B/C, new project).

## 1. Canonical layout and names

```text
docs/steering/
├── README.md                    ← index + the resolution rules (assets/steering-readme.template.md)
├── L1-testing-foundation.md     ← L1 — organization baseline (GENERIC, copied, never authored)
├── L2-testing-qa-standards.md   ← L2 — organization implementation standards (GENERIC, copied, never authored)
└── L3-project-testing.md        ← L3 — this project's values, stricter constraints, approved exemptions
```

Naming rules (every later skill globs `docs/steering/*`): lowercase kebab-case `.md`, prefixed
`L1-` / `L2-` / `L3-`; no spaces, no `(1)`, no trailing ` 1` / ` 2`, no version number in the
name (the version lives in the document header). Exactly one file per layer. Extra steering
files must be layer-prefixed too (`L2-api-standards.md`).

## 2. The resolution rules (single source: `assets/steering-readme.template.md`)

1. L1 is the mandatory baseline; nothing below may weaken it.
2. L2 refines L1 and may not contradict it.
3. L3 supplies project values and stricter constraints; it may weaken L1/L2 only through an
   approved exemption (clause, approver, date).
4. Conflicts: stricter L3 wins; weaker L3 without an approved exemption is ignored; an approved
   exemption wins for this project only.
5. Specs govern business truth; steering governs quality policy; `CLAUDE.md` and skill rules
   fill gaps; `project-learning.md` never overrides any of them.

Never write a different precedence chain anywhere (no "L1 > L2 > L3" shorthand). Point at the
README rules instead.

## 3. Procedure

1. **Read what exists** — for each file: declared layer (header), non-empty, canonical name.
2. **Never overwrite a valid layer file.** README.md is the one file this skill may author
   (from the template), and only if missing; adjust the table to the files present and mark a
   missing layer `MISSING — see setup report`.
3. **Normalize non-canonical names** (Mode B/C): `git mv` in a git repo, plain rename otherwise;
   content untouched. Then grep the repository (`.claude/skills/**`, `CLAUDE.md`, other
   steering files' "Related Documents") and update every reference. Never rename onto an
   existing file — report the collision and stop that rename.
4. **Install a missing layer** from, in order: a user-provided path → the `docs/steering/` tree
   of the source repository (fetch it with the same sparse clone the skills sync uses:
   `git -C <tmp> sparse-checkout set .claude/skills .claude/commands docs/steering`) → another
   steering location already in the repository or workspace. Copy under the canonical name.
   **Never author L1 or L2** — a layer that cannot be found is reported under `USER ACTION
   REQUIRED`, not substituted. L3 may be copied as a **template** with `[placeholder]` values
   left intact; never invent SLAs, locale lists, browser matrices or thresholds.
5. **Keep L1/L2 generic.** If an L1/L2 file names a product, repository, module, framework,
   auth provider, endpoint, database or codebase-specific known issue: do not delete or
   rewrite it; report the file and the offending lines; propose the split (generic rules stay,
   project rules move to L3 or `docs/project-rules/`); apply only with explicit confirmation
   and update references. Reverse check: per-project values (locale set, SLA, browser matrix,
   coverage threshold, file-size limit) must not be hardcoded in L1/L2 — they belong to the
   L2 §0 Project Configuration Contract and are resolved in L3.
6. **Project Configuration Contract** — L2 §0 requires a populated `/project-config.md`; L3
   normally declares itself to be that file. Confirm which: L3 fulfils it (verify the
   configuration section exists, count `[placeholder]` keys) or a standalone
   `project-config.md` exists where L2 expects it and L3 points at it. Never fill the contract
   yourself; report unfilled keys under `USER ACTION REQUIRED` (L2 §17.8 makes an incomplete
   contract a blocker for skills 3, 4 and 5).
7. **Relocation** of steering files living outside `docs/steering/` happens only in Mode C with
   a confirmed move plan; otherwise record the actual path as a manifest deviation.

## 4. Validation (what `Steering Docs` PASS means — see validation-contract.md)

PASS: directory exists; L1 and L2 present, non-empty, canonical; no duplicate layers; README
present; every reference to a renamed file updated. WARN (reported `PARTIAL`): L3 missing or
its contract keys unfilled, or README missing, or non-canonical names still present in Mode A.
FAIL: L1 or L2 could not be found — name the missing layer; never paper over it.
