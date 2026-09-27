# Project Learning — {project name}
<!-- Shared knowledge base for all QA skills (skills 1-11, 3b and 3c). Read before asking; update after learning.
     One tagged line per fact, plain English. Never store credentials, tokens or secrets here.
     Specs and steering documents always win over this file. -->

## Index
| Module | Pages | Similar to | Sections that mention it |
|---|---|---|---|

## Project Knowledge
<!-- system overview, environments + base URLs, roles, modules, business rules learned, glossary -->
<!-- out-of-browser test interfaces, one [type: env] line per environment and channel, e.g.:
- [module: Project] [type: env] Test interfaces on UAT: mail sandbox available (reads OTP / notification mail); SMS test provider: none available. (confirmed by user 2026-09-02)
     Never an output-language line here — the review / page language is a per-run choice (--lang), not a saved preference. -->

## Common Flows
<!-- how to reach each screen: sign in → menu → page → panel -->

## UI Knowledge
<!-- how controls behave: waits, dialogs, validation messages, sorting, paging -->

## Test Data
<!-- seeded entities, valid / invalid samples, boundaries — no credentials -->
<!-- one fixture per line, e.g.:
- [module: Orders] [type: data] Fixture "Price list Sample 2026" — 12 line items, ids 401-412, status Approved; environment UAT; created by api on 2026-09-02, kept.
-->

## Locale Knowledge
<!-- EN / AR label differences, RTL quirks, date and number formats -->

## Automation Tricks
<!-- how elements are identified, waits that work, environment quirks, run slicing, VPN / proxy notes -->

## Model Notes

### Setup Model (skill 1)
#### Knowledge
#### Questions and Answers

### Requirements Review Model (skill 2)
#### Knowledge
#### Questions and Answers

### Manual TC Model (skill 3)
#### Knowledge
<!-- design-time facts: spec sources per module, implementation status as stated by the tester, tag convention ([type: env]); never the review-page language (a per-run choice) -->
#### Questions and Answers

### Validation Model (skill 3b)
#### Knowledge
<!-- base URL per environment (never a credential), common flows walked live (name + date), screens confirmed locale-independent, where the app shows its build number -->
#### Questions and Answers

### CLI Validation Model (skill 3c)
#### Knowledge
<!-- same facts observed through playwright-cli; the login method used per environment (attended / secrets file — a name, never a value); cross-validator answers -->
#### Questions and Answers

### Publish Model (skill 4)
#### Knowledge
<!-- Azure DevOps hosting (cloud / self-hosted — which MCP server, org or org URL, project; the self-hosted server has no test plan / suite tools), process-template quirks (accepted AutomationStatus values, custom fields), tagging convention, suite placement decision -->
#### Questions and Answers

### Automation Model (skill 5)
#### Knowledge
<!-- pages that already have page objects (page names only), how to run, environment presets, heal patterns -->
#### Questions and Answers

### UI Visual QA Model (skill 6)
#### Knowledge
<!-- locales the product ships, which screens have an approved design and where (Figma file names, never node ids), the role each screen is audited as, the tracker's accepted Bug Trigger / Impact / Classification values, where the bug reports live; measured UI rules stay in UI-Testing/Learning-UI.md -->
#### Questions and Answers

### Azure Sync Model (skills 7 to 9)
#### Knowledge
<!-- Confirmed [type: env] answers only: ado_org, ado_project, test_plan_id, test_suite_id / plan URL, bug_story_filter_tags, flaky_story_title, default_assignee (optional), custom_fields, language_switch, reopen_mention_text. No PAT or credentials. -->
#### Questions and Answers
<!-- Search before asking; one bundled question; confirmed answers only, dated and tagged. -->

### White-Box Model (skill 10)
#### Knowledge
<!-- which business area each feature belongs to, rules the code enforces (in words), where checks happen, bug patterns; link to White_Box_Testing/.project-profile.md -->
#### Questions and Answers

### Rule Discovery Model (skill 11)
#### Knowledge
<!-- rules the code enforces that the spec never stated (in words, with the story as source), UI-only / DB-only enforcement, QC decisions on undocumented rules -->
#### Questions and Answers
