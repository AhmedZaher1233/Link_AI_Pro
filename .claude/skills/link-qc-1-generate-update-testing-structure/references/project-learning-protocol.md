# Project learning file — `Testing/project-learning.md`

Load in write modes (B, C, new project) before touching the learning file, and in any mode
before asking the user a question.

## What it is
One plain-English file every QA skill (1-11, 3b and 3c) reads **before asking the QC/user anything** and
updates **after learning anything**: modules, rules, roles, screens, flows, test data, EN/AR
differences, automation tricks — one section per skill (`Knowledge` + `Questions and Answers`)
plus shared sections. Behaviour knowledge lives here; structural paths live in
`Testing/qa-manifest.json`, never here.

## Create / repair (Mode B/C, new project)
* Missing → copy `assets/project-learning.template.md`, replace `{project name}` only.
* Present → never delete or rewrite content. Add any missing shared section or model section
  (the validator lists them). Rename every legacy heading listed in `lib.mjs`
  `LEARNING_LEGACY_HEADINGS` to its current form in place, keeping its content — the numbering of
  earlier releases (`### Publish Model (skill 5)` → `(skill 4)`, `### Automation Model (skill 6)` →
  `(skill 5)`, `### White-Box Model (skill 4)` → `(skill 10)`, `### Rule Discovery Model (skill 7)`
  → `(skill 11)`, `### UI Visual QA Model (skill qc-ui)` → `(skill 6)`, `### Azure Sync Model
  (skills link-qc-1…link-qc-6)` → `(skills 7 to 9)`). Add a missing model section (`### Validation
  Model (skill 3b)`, `### CLI Validation Model (skill 3c)`, `### UI Visual QA Model (skill 6)`,
  `### Azure Sync Model (skills 7 to 9)`, …) with its `#### Knowledge` / `#### Questions and Answers`
  at the position the template gives it; never reorder existing sections.
* Legacy `.planning/project-learning.md` present and the new file missing → move its content
  under the matching sections and tell the user.
* Mode A never touches the file.

## Entry format — one tagged fact per line
```markdown
- [module: Orders] [page: Order Details] [element: Year filter] [type: flow] To see yearly order totals: open Products, open the product, open Order Details, then choose the year at the top right.
- [module: Orders] [page: Order Details] [type: rule] An order cannot be closed while it still has open line items. (source: US-1234 AC-3)
- [module: Login] [type: qa] **Q (skill 3, 2026-09-02):** Which URL is the test environment? — **A:** the UAT site (recorded under Project Knowledge).
- [module: Project] [type: env] Test interfaces on UAT: mail sandbox available (reads OTP / notification mail); SMS test provider: none available. (confirmed by user 2026-09-02)
```

The output / review-page language is never recorded here: it is a per-run choice (`--lang` or
an explicit sentence in the task input), so no skill reads or writes an "output language" line.
Tag keys (lowercase, fixed): `module:` (always), `page:`, `element:`, `type:` one of
`flow | rule | ui | data | locale | trick | qa | env | status | bug`, `similar:` (other
modules/pages/elements that behave the same), and `(source: …)` in the text when known.
A `[type: qa]` line records provenance in the text — `(confirmed by user {YYYY-MM-DD})`: only a
confirmed answer is written and only a confirmed answer is reused later without re-asking; a
recommendation the user never answered is not written at all.

Content rules: written for a QC who has never seen the code. Never method, class, function or
file names, variables, selectors, code, stack traces, secrets, or requirement text copied
verbatim. `data-testid` values and URLs only under `Automation Tricks` / `Automation Model`,
each explained in words on the same line.

## Protocol — shared by skills 1-11, 3b and 3c (read first, ask second, write back)

*Read first — targeted, never the whole file:* read only the `## Index`; pick the module/page/
element names relevant to the task plus their `Similar to` modules; grep the tags
(`\[module: X\]`, `\[page: Y\]`, `\[similar: .*X`, `\[type: env\]`, `\[type: qa\]`) and read
only matching lines; grep this skill's `#### Questions and Answers` before asking anything;
load a whole section only if it is under ~40 lines and the grep found nothing (a file under
80 lines may be read whole).

*Ask second:* anything still missing (not in the file, the task input, `CLAUDE.md`, or the
specs) → ask in ONE combined message and WAIT. Never re-ask what the file answers; say what
you are reusing. Credentials and PATs are asked fresh and NEVER written.

*Write back (write modes, before delivering):*
* every answered question → `[type: qa]` line under `### Setup Model (skill 1) → #### Questions
  and Answers`; project-wide answers also under `## Project Knowledge`;
* every new fact → one tagged line in the matching shared section or `#### Knowledge` — grep
  first, update or dedupe instead of appending twins;
* similar modules → `[similar: …]` on both entries; update the `## Index` row for every module
  touched;
* entries contradicted by observation or a spec → correct them. Specs and steering always win
  (see `docs/steering/README.md` resolution rules).

Examples of what this skill records under `### Setup Model (skill 1) → #### Knowledge`:
```markdown
- [module: Project] [type: env] The app is an Angular front end with a .NET back end; tests run with Playwright on Chromium.
- [module: Project] [type: env] Automation code lives under Testing/Automation (new project, no earlier framework found).
- [module: Project] [type: env] MCP servers configured: Playwright, Azure DevOps (hosting: cloud, organization {org}, PAT authentication), Docx.
- [module: Project] [type: env] Azure DevOps hosting: self-hosted — org URL https://{host}/{Collection}, project {Project}, server @tiberriver256/mcp-server-azure-devops (no test plan / suite tools; PAT variable AZURE_DEVOPS_PAT).
- [module: Project] [type: env] Node 20 and NPM 10 were found already installed.
```

*Report:* end the result message with
`**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}`
(Mode A: `not touched (audit)`).

### Azure Sync Model (skills 7 to 9)
The six QC skills share this section: ado_org, ado_project, test_plan_id, test_suite_id, bug_story_filter_tags, flaky_story_title, default_assignee, custom_fields, language_switch and reopen_mention_text. Use tagged [type: env] confirmed answers, one bundled ask, no PAT. Sixteen skills therefore have eleven model sections.
