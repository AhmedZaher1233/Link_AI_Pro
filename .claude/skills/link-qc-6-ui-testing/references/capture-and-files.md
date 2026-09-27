# Capture rules — where files go, the audit viewport, how to capture

Loaded from Step 2 of SKILL.md. Verbatim detail for the folder layout, naming, viewport and capture rules.

### Where every file goes (write into the project, not a sandbox temp dir)

Everything is written into the repository so it can be reviewed and committed.
Create any folder that doesn't exist yet.

**Pick the base directory first.** `<base>` is the project's existing
QA/testing root if there is one — in a project set up by
`link-qc-1-generate-update-testing-structure` that is the `Testing/` root recorded in
`Testing/qa-manifest.json` (so the audit folder is `Testing/UI-Testing/`);
otherwise a `testing/`, `qa/`, `tests/`, or `e2e/` directory at or near the repo
root; if there is none, `<base>` is the repo root itself. Everything below is
written relative to `<base>`, so the audit folder is always exactly one
`UI-Testing/` deep — never nest a second one.

```
<base>/UI-Testing/
  Expected-UI/                              # approved design source images
    _sources.md                             # one row per image: page, lang, source URL, date
    <page-slug>_<lang>.png                  # e.g. dashboard_en.png
  Actual-UI/                                # implementation screenshots you capture
    <page-slug>_<lang>.png                  # the full-page capture
    <page-slug>_<lang>_segments/            # per-section captures, when the page is long/dense
      header.png, filter-row.png, table.png, ...
```

**Where the report and its evidence go — follow the project's convention.**
Before writing anything, check whether the project already has a home for bug
reports (an existing reports directory, or another QA skill/tool in this repo
configured to scan one). If it does, write the report there, because downstream
tooling — bug-tracker sync, retesting, reporting — usually discovers reports by
scanning that directory. A report written somewhere else is invisible to that
tooling, and its bugs silently never reach the tracker. Put the evidence
alongside, next to wherever that convention keeps its screenshots.

If the project has no such convention, use the self-contained default:

```
<base>/UI-Testing/
  Reports/
    UI-Visual-QA-<page-slug>.md             # the report
    evidence/
      <page-slug>_<lang>/                   # one folder per page+language
        audit-log.md                        # what the audit actually did (below)
        bug01_expected.png
        bug01_actual.png
```

### Audit log — the proof behind the Coverage table

`<evidence>/<page-slug>_<lang>/audit-log.md` is written **incrementally, as the
audit runs** — one row per navigation, resize, state driven, capture,
measurement pass, engine run and login check — never reconstructed at the end.
It is what lets a reader (or a second run) verify that "9 of 11 states" and
"1,847 elements measured" happened, and it is the only place tooling events
belong (the report itself stays about the product).

```markdown
# Audit log — Dashboard (EN) — 2026-09-26

| Time (UTC) | Step | Action | Target / value | Result |
|---|---|---|---|---|
| 09:02:11 | 2 | viewport | resize 1536×864, zoom 100 %, dpr 1 | ok |
| 09:02:15 | 2 | navigate | https://qa.example.com/dashboard | 200, signed in as manager |
| 09:02:20 | 2C P1 | console/network | 2 errors, 1 failed request (edit.svg 404) | logged |
| 09:02:31 | 2C P1b | axe-core 4.10.2 | 62 rules | 3 violations, 41 passes, 4 incomplete |
| 09:02:40 | 2C P2 | computed styles | header, nav, main, table, form, button, a, [role] | 1,847 elements |
| 09:03:05 | 2D | state | hover → .toolbar button.export | measured |
| 09:03:40 | 2D | state | error — submit empty form | not reachable: form has no client validation |
| 09:04:02 | 2D.3 | width | 991 | overflow: table +40 px |
| 09:05:10 | 7 | capture | bug03_actual.png (DOM highlight) | saved |
| 09:06:00 | 2C P2b | source trace | #7B2CBF → src/styles/_header.scss:42 | traced |
```

Rules: times from `new Date().toISOString()` at the moment of the action; a
state or width that could not be driven is a row with the reason (it feeds
"Not covered"); never a credential, cookie or token in any cell; the report's
Coverage section links to the log (`see ./evidence/<page-slug>_<lang>/audit-log.md`).
A second round appends to the same file under a `## Second round` heading.

State in the report where it was written and why, so the location is never a
surprise. Throughout the rest of this skill, `<reports>/` means the directory
chosen here and `<evidence>/` its evidence folder.

Naming rules:
- `<page-slug>` is the Step 1 screen/page label, slugified (lowercase, spaces to
  hyphens). `<lang>` is `en` or `ar`. The pair `<page-slug>_<lang>` is the key
  that ties Expected-UI, Actual-UI and evidence together — use the exact same
  string in all three.
- When both languages are tested, produce a separate file per language in both
  `Expected-UI/` and `Actual-UI/` — never one shared file.
- Inside an evidence folder the page and language are already in the folder
  name, so crops are just `bug<NN>_expected.png` / `bug<NN>_actual.png` — do not
  repeat the page slug in the file name.
- Record every new Expected-UI image in `Expected-UI/_sources.md` (page, lang,
  source type, Figma/reference URL, date) at the moment you save it. An image
  with no row in `_sources.md` is unusable by a later audit.
- Reuse an existing `Expected-UI/<page-slug>_<lang>.png` if one is already
  there and `_sources.md` shows it still matches the design the user means —
  don't re-fetch a design that's already stored.

### Standard audit viewport — set this first, before anything else

**Every audit runs at the machine's own screen size, at 100% zoom.** This is
the baseline viewport for all measurement, all comparison, and all evidence
screenshots, so that two runs on the same machine are directly comparable and
the captures match what the tester actually sees.

As soon as the browser opens, and before navigating anywhere for measurement:

```js
// browser_evaluate — detect the machine's screen
() => ({
  screen: `${screen.width}×${screen.height}`,
  available: `${screen.availWidth}×${screen.availHeight}`,
  viewport: `${innerWidth}×${innerHeight}`,
  dpr: devicePixelRatio,
  zoom: `${Math.round((visualViewport?.scale ?? 1) * 100)}%`,
})
```

Then:
1. **Resize the viewport** to the reported `availWidth × availHeight`
   (`browser_resize`) — the usable screen area, excluding OS taskbars.
2. **Confirm zoom is 100%** and `devicePixelRatio` is 1. If either differs,
   reset it before measuring; if it cannot be reset, record the actual value in
   the report's Environment section — measurements taken at another zoom will
   not reproduce.
3. **Re-read the values after resizing** and use that final `viewport` as the
   audit viewport everywhere: the Environment section, each bug's System Info,
   and the `Actual-UI` capture.

Announce the detected size once at the start ("Auditing at 1536×864, zoom 100%")
so the basis of every later measurement is explicit.

**When the design frame is a different width** than the audit viewport, say so
as one Coverage Limitations bullet — in a fluid layout, page-level spacing and
column widths will differ purely because of the width difference, so those
specific findings need that context to be read correctly. Do not silently
report width-driven differences as implementation defects.

### For live URLs (implemented UI)
Navigate to the URL at the standard audit viewport above and take a
**full-page** screenshot (the entire scrollable page, not just the visible
viewport) — that is the `<page-slug>_<lang>.png` baseline artifact, and Pass 3
needs the whole page to judge structure and vertical rhythm. Capture at a high
enough resolution that small text and icons are legible when cropped later
(Step 7). Other widths are covered separately in the responsive sweep
(Step 2D.3) — they are not the comparison baseline.

**For long or visually dense pages, do not rely on a single full-page
screenshot.** A page that scrolls more than ~2–3 viewport heights, or has many
small components packed together (dense tables, multi-column card grids,
crowded forms), loses detail when squeezed into one image — that lost detail
is a direct source of missed bugs. Instead:
- Capture the full page once for overall layout/structural context, **and**
- Capture separate, full-resolution segment screenshots per major region
  (header, each distinct section, the data table, the footer, etc.) by
  scrolling to each region and capturing it on its own.
- Run the Step 3 checklist against the segment screenshots, not the squeezed
  full-page one — the full-page shot is for layout/structure checks only
  (spacing rhythm, section order), never for reading fine detail (colors,
  icon style, exact spacing).

### For uploaded screenshots
Use the images directly — no fetching needed. If the user's screenshot is a
single long capture of a dense page, ask whether they can provide (or let you
capture, for a live URL) segment-level screenshots too — flag this as a factor
that increases the chance of missing fine-grained bugs if not available (see
also Step 3B).

### For Figma URLs — plain screenshot fallback
If no Figma MCP connector is available and the link isn't otherwise accessible,
ask the user for an exported screenshot instead of guessing at the design.
Prefer an export of each major frame/section if the page is long, for the same
reason as above.

### For a reference-website URL (approved design given as a live URL, not Figma)
Treat this exactly like the implemented-UI live URL above: navigate to it with
the browser tool and capture full-viewport (and, for long/dense pages,
per-section segment) screenshots — do not eyeball it from memory or a single
squeezed capture.

**Critically, also run the Step 2C Pass 2 computed-style extraction on the
reference site**, not just on the implementation. A live reference has a real
DOM, so its colors, spacing and typography are readable as exact values — which
puts this comparison at **Tier 2** (numeric on both sides), not at the
screenshot-vs-screenshot tier. Do not downgrade a live reference to "just
another design screenshot"; that throws away the precision it offers.

