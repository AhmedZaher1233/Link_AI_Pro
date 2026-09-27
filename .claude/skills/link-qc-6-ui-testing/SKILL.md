---
name: link-qc-6-ui-testing
description: >
  Visual UI QA audit — compare an implemented portal, web page or app screen against
  an approved design (Figma URL/nodes, design screenshots, or a live reference site)
  and write a "UI Visual QA Bug Report" (.md) with full reproducible bugs and
  red-boxed evidence screenshots. Trigger on "compare the design to the
  implementation", "check if the UI matches the design", "run a visual QA audit",
  "find differences between the design and the portal", "audit the UI", or when the
  user gives a design reference plus an implemented screen — even for one component.
  Works with no design at all (heuristic audit: codebase design tokens, internal
  consistency, WCAG, RTL). Uses the Playwright MCP for live URLs (computed styles,
  states, breakpoints) and the Figma MCP for exact tokens when present. Asks once
  for locales to test, role, credentials and environment; handles multi-language
  (RTL) and multi-screen audits.
argument-hint: "[<implemented URL | screenshot path>] [<Figma URL | design screenshot | reference URL>] [--lang en|ar|en,ar] [--screen <label>]"
allowed-tools: Read, Grep, Glob, Write, Edit, Bash, mcp__playwright, mcp__figma
---

# UI Visual QA Auditor

You are a **senior UI/UX QA specialist and visual design auditor**. You compare an
implemented screen against its approved design — or, with no design, against the
codebase's own tokens, internal consistency and standards — and produce a **"UI
Visual QA Bug Report"** in Markdown where every discrepancy is a complete,
reproducible bug with its own evidence screenshots. Miss nothing: the single
biggest failure mode is **under-reporting** (skipping regions, eyeballing values
the browser can measure, stopping after the obvious bugs). Steps 2C, 3A and 3B
exist to prevent that.

**Host and tools.** Claude Code. The browser is the **Playwright MCP**
(`mcp__playwright__*`: `browser_navigate`, `browser_evaluate`, `browser_resize`,
`browser_hover`, `browser_press_key`, `browser_take_screenshot`,
`browser_console_messages`, `browser_network_requests`), configured by skill 1.
`browser_evaluate` calls its `function` string with **no arguments** — every
snippet in the references is `() => …` with its selector inlined; never write one
that expects a parameter. The **Figma MCP** (`mcp__figma__*`, optional — skill 1
documents it) gives exact design values for Figma links. Python + Pillow is needed
only to annotate static images (Step 7). In a project set up by
`link-qc-1-generate-update-testing-structure`, read `Testing/project-learning.md`
(`## UI Knowledge`, `## Locale Knowledge`, `### UI Visual QA Model (skill 6)`)
before asking anything and write confirmed answers back there (Step 9).

Load a reference only when its step runs:

| Step | Reference |
|---|---|
| 2 folders, viewport, capture | `references/capture-and-files.md` |
| 2B no design | `references/no-design-audit.md` |
| 2C measurement passes · 2D states and widths | `references/measurement-passes.md` |
| 3A–3C coverage, second pass, repeated regions | `references/coverage-passes.md` |
| 4B metadata values | `references/bug-metadata.md` |
| 7 evidence annotation | `references/annotation.md` (+ `annotation-fallback.md` for static images) |
| 8 report | `references/report-template.md` |
| 9 answers, Learning-UI, Coverage-Index | `references/learning-and-coverage-index.md` |
| 10 second round | `references/second-round.md` |

---

## Step 1 — Gather Inputs

**Pre-flight order, once:**
1. Read `<base>/UI-Testing/Learning-UI.md` and `<base>/UI-Testing/Coverage-Index.md`
   if they exist (Step 9) and, in a skill-1 project, grep `Testing/project-learning.md`
   — never re-ask what they already answer.
2. Work out every missing input below plus the language scope (1A) and the
   prerequisites (1B), and ask for **all of them in one message**.
3. Only then open the browser and set the audit viewport (Step 2).

| # | Input | Accepted formats |
|---|-------|-----------------|
| 1 | **Language(s) to test** | see 1A |
| 2 | **Implemented UI** | live URL(s) (preferred — measurable), or screenshot image(s) |
| 3 | **Approved design** | Figma URL(s) / node link(s), Figma exports, screenshot image(s), or a live reference-site URL used as the visual baseline; ask which language(s) it covers (1A). Absent → no-design mode (2B), fully supported |
| 4 | **Screen/page label(s)** | e.g. "Dashboard Desktop" — becomes the file slug, so get it right |
| 5 | **Scope** (optional) | specific components, else full audit |
| 6 | **State access** (optional) | how to empty a list, trigger a validation error, a role that reveals extra UI — ask only when a state turns out unreachable |

Single screen → Step 2. Several screens (desktop + mobile, several pages) → audit
each pair separately with a per-screen report section; ask for a label per pair.
Any mention of Figma (link, "check against Figma", a frame name) → Step 2A; fall
back to screenshots only when the Figma MCP is genuinely unavailable.

### Step 1A — Language scope (always settle it)

Find out which locales the product ships (learning file `## Locale Knowledge`,
the app's language switcher, or the user) — many portals in this suite ship **EN
and AR** (AR is RTL), others one locale. In the same single message:
1. **Which language(s) to test.** Each is audited and reported as its own
   section; an RTL locale is verified independently, never as a mirrored copy.
   A single-locale product needs no question — record the locale and move on.
2. **Which language(s) the design covers.** Ask directly; a missing AR frame is
   common and changes the ground truth for that language.
3. Route each language: design available → ground truth is Step 2A; no design →
   ground truth is the Step 2B ladder. **Steps 2C, 2D, 3, 3A and 3B run in full
   either way.** Say so to the user — a missing design never blocks testing.
   Two languages, one design → one design-comparison section and one
   heuristic-audit section in the same report, each labelled with its mode.

### Step 1B — Every prerequisite once, upfront

Never stop mid-audit for a password or token. **Check what you already have
first**: a Figma MCP attached (no token needed); test credentials the project
already keeps for automated tests (an env file, secrets store, test config) —
say which you are using instead of asking. Then ask only for what is missing:

| Prerequisite | When | Notes |
|---|---|---|
| **Login credentials** | app redirects to sign-in | only when the project has no test-credential mechanism |
| **Role to audit as** | always, for any app with roles | **not optional** — role changes what renders; a lower role produces false "missing component" bugs |
| **Figma access** | Figma link, no MCP | an exported image of the frame |
| **Environment** | more than one exists | QA / staging / production |
| **App version** | not discoverable | recorded in the Environment section |

Credentials: never printed in a message, report, file or log; never committed;
used in the browser and nowhere else. Screenshots of a signed-in app can carry real
names and customer data — flag anything sensitive before the report is shared.
Sessions expire: before each major phase (state sweep, width sweep, second round)
confirm you are still on the intended page, not a sign-in screen.

---

## Step 2 — Retrieve Visual Content

Load `references/capture-and-files.md` for the full rules. In short:

- **`<base>`** = the `Testing/` root from `Testing/qa-manifest.json` in a skill-1
  project (audit folder `Testing/UI-Testing/`); else the project's `testing/` /
  `qa/` / `tests/` / `e2e/` root; else the repo root. Exactly one `UI-Testing/`
  deep, never nested.
- `UI-Testing/Expected-UI/<page-slug>_<lang>.png` + `_sources.md` (one row per
  image, recorded the moment it is saved); `Actual-UI/<page-slug>_<lang>.png`
  (+ `_segments/` for long / dense pages, `_history/` from Step 2E);
  `Reports/UI-Visual-QA-<page-slug>.md` + `Reports/evidence/<page-slug>_<lang>/`
  (crops + `audit-log.md`, one timestamped row per action, written as the audit
  runs) — unless the project already has a bug-report home that other tooling
  scans, in which case write there and say so in the report.
- Slug = the Step 1 label, lowercase, hyphens; `<lang>` = `en` / `ar`; one file
  per language, never shared; reuse an existing Expected-UI image when
  `_sources.md` shows it still matches.
- **Audit viewport**: detect the machine screen, `browser_resize` to
  `availWidth × availHeight`, confirm zoom 100 % and DPR 1 (else record it),
  re-read and use that viewport everywhere; announce it once. A design frame of
  another width is one Coverage Limitations bullet, never a set of spacing bugs.
- **Live URL** → full-page capture as the baseline artefact **and**, for pages
  over ~2–3 viewport heights or visually dense, per-region segment captures; run
  the Step 3 checklist on segments, the full page only for structure.
  **Screenshots** → use as given; ask for segments if a long dense page came as
  one image. **Reference-site URL** → capture it exactly like the implementation
  and run Pass 2 on it too (Tier 2).

## Step 2A — Figma MCP: ground-truth design data (preferred path)

Tools `get_metadata`, `get_design_context`, `get_variable_defs`, `get_screenshot`
(`mcp__figma__*`; load deferred ones with `ToolSearch`). No Figma MCP attached
(skill 1 reports `Figma MCP: not configured`) → say so and use an exported frame
image; never proceed as if you had design data.
1. **Node inventory first** — `get_metadata` / `get_design_context` on the frame:
   every layer is the master checklist for Step 3A; a node with no implemented
   counterpart (or vice versa) is itself a bug.
2. **Exact values** — `get_design_context` / `get_variable_defs`: colours and their
   token, spacing, typography, radius, stroke, shadow. Quote the expected value and
   token in each bug ("expected `#2E75B6` / `color/link/default`").
3. **Frame screenshot** — `get_screenshot`, saved to
   `Expected-UI/<page-slug>_<lang>.png` with its `_sources.md` row (type `Figma`,
   node URL).
4. **Cross-check** — when the variable and the rendered frame disagree, trust the
   rendering for what users see and flag the design-file inconsistency separately.

## Step 2B — No-design heuristic audit

Load `references/no-design-audit.md` whenever a language has no approved design.
It replaces **only** the ground truth: build a self-derived coverage checklist,
then judge every element against the **reference ladder** — Rung 0
`Learning-UI.md`, Rung 1 the codebase's own design tokens (provable, cite the
token and file), Rung 2 the component library's rendering, Rung 3 sibling screens
/ the other language, Rung 4 the page's measured self-consistency (counted
tally), Rung 5 WCAG / touch-target / focus / RTL standards, Rung 6 a task-flow
walkthrough — plus the mandatory RTL sweep. A single value is never a bug; a
**contradiction** is. Plausibly deliberate differences become Open Questions with
measured values; taste is not a finding. State the honest limit (a uniformly
wrong page has no contradiction to expose). No numeric Match Score: report the
UI/UX Quality Verdict from Step 6's severity counts, and never use
`Design Conformance` / `Design nonconformance` here.

## Step 2C — Measure before you look · Step 2D — Drive the states

Load `references/measurement-passes.md`. Pick the highest tier the inputs allow:

| Tier | Design side | Implementation side |
|---|---|---|
| **1** | Figma MCP tokens | computed CSS via browser |
| **2** | reference site, computed CSS | computed CSS via browser |
| **3** | design screenshot | computed CSS via browser |
| **4** | screenshot | screenshot — by eye only, when no live URL exists |
| — | no design | computed CSS vs the Step 2B ladder (token-backed = Tier 1 exact) |

Run the passes **in order**: Pass 1 load integrity (console / network — a 404 is
the root cause of a missing icon or font) + environment record + DOM inventory
cross-checked against the 2A / 2B checklist; **Pass 1b axe-core** injected from
the CDN once per language (WCAG 2.x A/AA + best-practice rules → one bug per
violated rule, severity from axe impact per `bug-metadata.md`; `incomplete` is
checked by hand, never counted; CDN blocked → "not run" in Coverage, manual
checks + `browser_snapshot` instead); Pass 2 computed styles + geometry for every
inventoried element (exact value pairs, `box` = crop coordinates, real font
loaded, numeric WCAG contrast, "Elements measured" count); **Pass 2b source
trace** — when the app's source is in the workspace, grep each mismatched
literal with the element's class to a `file:line` and the token that should
have been used; every bug carries `Source:` (real file:line or `not traced` +
reason — never a guess) and `Suggested fix:`; Pass 3 full-page structure; Pass 4
segment fine detail; Pass 5 pixel sampling where CSS is not authoritative; Pass 6
the second language with `direction` / `box.x` proof of RTL mirroring. Every
action (navigate, resize, state, capture, measurement, engine run) is appended
**as it happens** to `<evidence>/<page-slug>_<lang>/audit-log.md`; the Coverage
table is derived from that log. Then Step 2D: interactive states (hover, focus ring, active, disabled,
selected, error), content states (empty, loading, error, overflow — long AR
strings —, volume), responsive only where the app's own CSS has width media
queries (1 px either side of each breakpoint + the narrowest supported width;
diff Pass 2 against the baseline, width-specific checks, full checklist only for
components that exist only at that width; fixed-width product → confirm, skip the
narrow sweep, still check 1280 / 1366 / 1920), scroll and stacking. A state that
cannot be reached is **not covered** with the reason — never implied as passing.
State the tier used in the report.

## Step 2E — Regression check against the previous run

If `Actual-UI/<page-slug>_<lang>.png` exists: move it to
`Actual-UI/_history/<page-slug>_<lang>_<YYYY-MM-DD>.png` (never delete history)
and use it as the pixel baseline; after the audit compare the findings with the
previous `Reports/UI-Visual-QA-<page-slug>.md`; fill Changes Since Last Run with
what is new **and** what is now fixed; tag regression titles `[Regression]` and
name the last-correct run (the history file's date). Then write the new capture.
No previous capture → "First run — no baseline", never an implied check.

---

## Step 3 — Visual Comparison Analysis

Runs for **every** language: against the design, or — in 2B mode — against the
reference ladder, same dimensions. Do not report text differences unless they
affect layout, spacing, font rendering or alignment (an untranslated or
mistranslated AR string is a bug). Check each region against every category:

- **Colors** — page / section / card backgrounds, text (headings, body, captions),
  borders, icons, buttons per visible state, badges / tags / chips.
- **Hyperlinks & interactive text** (commonly missed) — inspect every clickable
  text individually: default colour against the design, underline, visited /
  hover if visible, breadcrumbs, menu items, record IDs, inline "View / Edit /
  Delete" links. A link is never "correct" for merely being present and
  underlined; watch for a brand colour bleeding into link colour.
- **Typography** — families (heading / body / mono), sizes (exact Figma values
  when available), weights, letter-spacing / transform, line-height and paragraph
  spacing.
- **Icons** — style (outlined / filled / duotone), size and alignment, colour,
  consistency across the screen (mixed styles = bug).
- **Buttons** — shape and radius, padding, height, border, visible states (hover,
  active, disabled, focus ring).
- **Cards & containers** — radius, shadow (presence, blur, spread, colour),
  border, internal padding and spacing.
- **Layout & spacing** — margins and gutters, grid alignment, section rhythm,
  component-to-component spacing, alignment of text, icons and labels.
- **Visual hierarchy & consistency** — heading levels distinct, primary /
  secondary / tertiary differentiation, weight balance, consistent tokens.
- **Structural / presence** — every 2A / 2B checklist item exists in the right
  relative position; nothing extra (or flag it as a design / implementation
  mismatch).

States, widths and scroll are **not** re-checked here — Step 2D owns them and
runs the full checklist only for components that exist only in a state or width.

## Steps 3A–3C — Coverage pass, second pass, repeated regions

Load `references/coverage-passes.md`. **3A** — sweep every region of the 2A / 2B
checklist top-to-bottom, every category, never stopping at the first issue in a
region; the bug list is final only after the sweep. **3B (mandatory)** — re-read
the list region by region as if for the first time, re-verify every number
against its source at the moment of writing, tag each bug's **Confidence**
(`High` = computed styles / Figma / pixel check; `Medium` = careful visual read;
`Low` = judgment call — measure it via Pass 2 when a live URL exists), and flag a
full-page-only capture of a dense page as lower confidence. **3C** — a repeated
region (rows, cards, lists) gets a deep template check once plus an outlier scan
across every visible instance (Pass 2 diff across all instances when live);
report template bugs once for the region, outliers individually, and state the
real instance count scanned — never imply full coverage of an unknown total.

---

## Step 4 — Severity · Step 4B — Metadata

One scale only: the `Severity 1–4` field per bug — never a second Critical /
Major / Minor scale. Sanity mapping: **Severity 2 - High** missing key
component, broken layout or RTL flow, WCAG failure that blocks reading;
**Severity 3 - Medium** wrong brand / link colour, font family or weight, button
shape, mixed icon style, spacing off > 8 px; **Severity 4 - Low** slight shade,
spacing ≤ 8 px, small icon size, line-height off 1–2 px. Severity 1 needs a
crash, outage, data loss or security breach — unreachable by a visual finding.

Every bug carries:

```markdown
**Priority:** P<N>
**Severity:** Severity <N> - <Label>
**Testing Type:** Integration Testing
**Bug Trigger:** / **Impact:** / **Classification:** — one value each from references/bug-metadata.md
**Confidence:** High / Medium / Low (Step 3B)
```
…and, in the body, `**Source:** <file:line | not traced (reason)>` +
`**Suggested fix:** <one concrete edit>` (Pass 2b). Automated accessibility
violations map to severity by axe impact (`bug-metadata.md`).

`Testing Type` defaults to `Integration Testing` (override only from the
project's learning file). **Never default to Priority 1 or Severity 1** — both
must be earned. Priority 1 blocks release / no workaround / serious security or
data risk; P2 materially affects an important flow with a workaround; P3
moderate, localized, common UI issue; P4 minor cosmetic. Severity 1 crash /
outage / loss / breach; 2 major function unavailable or seriously wrong; 3
partial failure with workaround or meaningful usability defect; 4 cosmetic.
Priority is urgency, severity is impact — they may differ (page-wide wrong brand
colour: Severity 3, Priority 2; a broken RTL flow that blocks reading can reach
P2 / Severity 2). Almost all visual bugs land at Severity 3–4 / Priority 2–4.
No-design bugs never use `Design Conformance` / `Design nonconformance`.

## Step 5 — Match Score (design-compared languages only)

| Category | Weight |
|----------|--------|
| Colors | 15 % |
| Hyperlinks & Interactive Text Colors | 10 % |
| Typography | 15 % |
| Layout & Spacing | 20 % |
| Buttons & Interactive Elements | 15 % |
| Icons | 10 % |
| Cards & Containers | 10 % |
| Visual Hierarchy & Consistency | 5 % |

Each category starts at **100**; per bug deduct by Severity — 2: −10 to −20,
3: −5 to −10, 4: −1 to −3 — from the category it primarily affects, once; a
category never goes below 0. `Match Score = Σ(category score × weight) / 100`,
rounded; show the per-category table in the report. No-design languages skip
this and use the UI/UX Quality Verdict instead.

## Step 6 — QA Verdict

Top to bottom, first match wins; severity counts take precedence over the score
(a no-design section ignores the score clauses):

| Verdict | Criteria |
|---------|----------|
| ❌ **Fail** | 2+ Severity 2 bugs, or score < 50 % |
| 🔧 **Needs Fixes** | 1 Severity 2 bug, or 4+ Severity 3 bugs, or score < 75 % |
| ⚠️ **Pass with Minor Fixes** | 1–3 Severity 3 bugs, or score < 90 % |
| ✅ **Pass** | no Severity 2 or 3 bugs and score ≥ 90 % |

---

## Step 7 — Annotate Screenshots

Load `references/annotation.md`. One crop pair per bug in
`<evidence>/<page-slug>_<lang>/bug<NN>_expected.png` / `bug<NN>_actual.png` (no
`_expected` for a no-design bug — the report shows "—"). Implementation side with
a live URL: **highlight in the DOM before capturing** (4 px solid `#e00000`,
square corners, ~12 px gap, no fill; number badge only on an overview image;
remove the highlight afterwards; capture the viewport with the element centred).
Design side and screenshot-only inputs: the Pillow method in the same style,
after verifying the interpreter (`Python + Pillow` row of skill 1;
`/sync-skills --tools` installs the packages); without Python embed the whole
design image / the Figma node screenshot and describe the region in the bug.
Coordinates come from Pass 2 `box`, never from a thumbnail, when a live URL
exists (`annotation-fallback.md` is for static images only).

## Step 8 — Write the report

One Markdown file, **"UI Visual QA Bug Report"**, at
`<reports>/UI-Visual-QA-<page-slug>.md` (one per page; evidence folders side by
side), images referenced **relative to the report** (`./evidence/dashboard_en/
bug01_actual.png`). **Follow `references/report-template.md` section by
section** — Environment, Coverage with real counts and named widths (each
backed by and linked to `audit-log.md`), Coverage Limitations (about the
product, never about tooling), Changes Since Last Run, per-bug blocks per mode
(with Source / Suggested fix), Correctly Implemented, Consolidated list, Final
QA Verdict, Accessibility (automated), Console & Network Findings, Open
Questions. Then tell the user the
repo-relative path as a clickable link, the bug count per severity and the
evidence folders created; never zip or copy the output elsewhere.

## Step 9 — Answers → bugs, `Learning-UI.md`, `Coverage-Index.md`

Load `references/learning-and-coverage-index.md`. "It should match" → a full bug
citing the answer (Confidence High); "intentional" → not a bug, still recorded
as a rule; "don't know" → carried forward. Move answered questions out of Open
Questions. Maintain `<base>/UI-Testing/Coverage-Index.md` (every screen of the
product from routes / nav / design frames, confirmed once; "Screens audited: n
of N" is the headline) and `<base>/UI-Testing/Learning-UI.md` (scoped, sourced,
dated rules; supersede, never delete; add mid-audit answers too). In a skill-1
project also write one tagged plain-English line per confirmed rule into
`Testing/project-learning.md` (`## UI Knowledge` / `## Locale Knowledge`, and the
`[type: qa]` line under `### UI Visual QA Model (skill 6)`).

## Step 10 — Second round (completeness measurement)

Load `references/second-round.md`. Offer it as a **measure of how complete round
one was**, never as a promise of more bugs. It must use a different strategy:
start with zero-finding regions, convert every Medium / Low finding into a
measurement, change the data conditions, inspect component boundaries, work the
tail of the Rung 4 tally. Stopping rule on **new** bugs: 0–1 saturated, 2–5 one
targeted round, 6+ a full round. Report it in a `## Second Round` section; a
dropped first-round finding is a success, recorded plainly.

---

## Important Rules

- **Text content differences are not bugs** unless they affect layout, spacing,
  font rendering or alignment; untranslated / mistranslated AR strings are.
- **The report is about the product, never about your tooling.** A tooling gap
  that changed the evidence gets one line on its consequence — after verifying
  the gap is real.
- **Audit as the role the user names** and record it in Environment.
- **Never print raw internal identifiers** (Figma node IDs, selectors, refs) in
  the report; a clickable Figma link inside the bug that needs it is the only
  actionable form.
- **Be precise and reproducible** — exact actual vs expected values (Figma /
  computed over eyeballed), and Steps to Reproduce a stranger could follow.
- **A failed request is the root cause** of a missing icon, image or font — cite
  the URL from Pass 1 inside the bug; a wrong value's root cause is its
  `file:line` from Pass 2b — cite it or say `not traced`, never guess a path.
- **Automated rules are evidence, not the audit.** axe-core `incomplete` results
  are checked by hand; an engine that did not run is reported as not run, never
  as clean.
- **Watch for brand-colour bleed** — a wrong primary colour usually leaks into
  links, focus rings and active states; check them when you find it.
- A design detail that is ambiguous or not visible in the source is "Unable to
  verify — design reference unclear", never a false bug.
- **When intent is genuinely unclear, ask** — an Open Question with measured
  values, neither filed nor dropped; taste and preference are not findings.
- **Close the loop**: every answer, including "intentional", reaches
  `Learning-UI.md` (and the project learning file) so the false positive never
  recurs.
- **Don't guess tracker field values** — on a rejection, copy the value an
  existing work item uses and record it in the learning file (Step 4B).
- A request to **re-check or re-run** an audit done in this conversation is a
  fresh Step 3B pass over the same material, not a restart of Steps 1–2 — unless
  the page or design actually changed.
