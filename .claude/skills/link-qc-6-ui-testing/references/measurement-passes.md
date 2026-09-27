# Measurement — the layered passes (Step 2C) and the states / widths to drive (Step 2D)

Loaded from Steps 2C and 2D of SKILL.md. Run the passes in order; never judge by eye what the browser can measure.

## Step 2C — Layered Comparison Method (run the passes in this order)

Looking at two pictures and judging by eye is the **weakest** available method,
and it is the one most likely to miss bugs and to invent false ones. Whenever a
live URL is in play, far stronger evidence is available — read the real values
out of the browser instead of estimating them from pixels.

Run the passes below **in order**. Each one is cheaper and more exact than the
next, and each one *feeds* the ones after it — most importantly, Pass 2 yields
exact element coordinates, which is what makes the visual passes and the Step 7
crops land accurately instead of being estimated off a thumbnail.

Never skip ahead to the visual passes because they feel faster. A bug caught in
Pass 2 comes with an exact number and `High` confidence; the same bug caught in
Pass 5 is a judgment call.

### Method strength — pick the highest tier the inputs allow

| Tier | Design side | Implementation side | Result |
|---|---|---|---|
| **1** | Figma MCP tokens (Step 2A) | computed CSS via browser | numeric on both sides — strongest |
| **2** | reference website, computed CSS | computed CSS via browser | numeric on both sides |
| **3** | design screenshot | computed CSS via browser | implementation exact, design read visually |
| **4** | screenshot | screenshot | both sides by eye — weakest, use only when no live URL exists |
| **—** | *no design at all* | computed CSS via browser | not a lower tier: judged against the codebase's own design tokens, the project's component-library rendering, sibling screens, the page's measured self-consistency, and standards — see the reference ladder in Step 2B.2. Token-backed findings here are as exact as Tier 1. |

Tier 2 is what makes the "compare against another website" input (Step 1) a
**precise** comparison rather than an impression: open the reference site with
the browser tool too, and extract its computed styles exactly the way you
extract the implementation's.

---

### Pass 1 — Load integrity + structural inventory (what exists)

**First, check what failed to load.** A missing icon, image, or web font is a
*visual* bug whose real cause is a failed request — reporting "the icon is
missing" is useful, but reporting "the icon is missing because
`/assets/icons/edit.svg` returns 404" is what actually gets it fixed. Right
after the page settles, read the console and network logs
(`browser_console_messages`, `browser_network_requests`) and note:
- any `4xx`/`5xx` on an image, icon, font, or stylesheet — file the visual
  symptom as the bug and cite the failing URL as its cause
- any console error that points at rendering (CSS parse failures, missing
  module for a UI component)

**Then record the full environment once per audit** — it feeds the report's
Environment section and each bug's System Info block (Step 8). The viewport and
zoom were already set and verified in Step 2 ("Standard audit viewport"); this
call records the complete picture, it does not re-decide it:

```js
// browser_evaluate
() => {
  const zoom = Math.round((visualViewport?.scale ?? 1) * 100);
  return {
    url: location.href,
    origin: location.origin,
    viewport: `${innerWidth}×${innerHeight}`,
    screen: `${screen.width}×${screen.height}`,
    availScreen: `${screen.availWidth}×${screen.availHeight}`,
    colorDepth: screen.colorDepth,
    dpr: devicePixelRatio,
    zoom: `${zoom}%`,
    lang: document.documentElement.lang || navigator.language,
    dir: document.documentElement.dir ||
         getComputedStyle(document.body).direction,
    ua: navigator.userAgent,
    platform: navigator.userAgentData?.platform ?? navigator.platform,
    appVersion:
      document.querySelector('meta[name="version"], meta[name="build"]')?.content
      ?? null,
    capturedAt: new Date().toISOString(),
  };
}
```

If `appVersion` is null, look for a build/version string in the app's footer,
an `/assets/config/*.json` runtime config, or `package.json`; if there is none,
record it as "not exposed" rather than leaving the field blank.

Then establish *what is on the page*. Enumerate the real elements from the DOM
rather than guessing from a picture:

```js
// browser_evaluate
() => [...document.querySelectorAll('header,nav,main,section,table,form,button,a,[role]')]
  .map(el => ({
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role'),
    cls: el.className?.toString().slice(0, 80),
    text: el.textContent?.trim().slice(0, 40),
  }))
```

Cross-check this against the Step 2A Figma node inventory (or the Step 2B
self-built checklist). **Catches:** missing components, extra components,
wrong ordering — before you spend any effort on their styling.

### Pass 1b — Automated accessibility rules (axe-core)

Contrast, focus and target size are measured by hand in the passes below; the
rest of WCAG (accessible names, ARIA validity, form labels, landmark structure,
heading order, duplicate ids, keyboard traps in widgets) is a rule engine's job.
Run **axe-core** in the page once per language, resting state, before Pass 2:

```js
// browser_evaluate — load axe-core from the CDN, then run it
() => new Promise((resolve) => {
  if (window.axe) return resolve('present');
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
  s.onload = () => resolve('loaded');
  s.onerror = () => resolve('blocked');   // CSP or offline — see below
  document.head.appendChild(s);
})
```

```js
// browser_evaluate — run it and keep only what the report needs
() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag22aa', 'best-practice'] } })
  .then(r => ({
    violations: r.violations.map(v => ({
      id: v.id, impact: v.impact, wcag: v.tags.filter(t => /^wcag\d/.test(t)),
      help: v.help, helpUrl: v.helpUrl,
      nodes: v.nodes.slice(0, 5).map(n => ({ target: n.target[0], html: n.html.slice(0, 120), fix: n.failureSummary?.split('\n')[1]?.trim() })),
      count: v.nodes.length,
    })),
    passes: r.passes.length, incomplete: r.incomplete.length, rulesRun: r.passes.length + r.violations.length + r.incomplete.length,
    axeVersion: axe.version,
  }))
```

Rules:
- Every violation becomes **one bug per rule** (not per node) with the node count
  and up to five example targets; severity from axe `impact` per
  `bug-metadata.md` ("Automated accessibility findings"); the `helpUrl` and the
  WCAG criterion go in the bug; `Confidence: High`. Contrast violations that
  Pass 2 already measured are merged into that bug, never duplicated.
- `incomplete` results are **not** bugs — they are the rules axe could not decide;
  list their count in the Accessibility section and check the ones that matter
  by hand (colour on images, dynamic widgets).
- Record `rulesRun`, `violations`, `passes`, `incomplete` and `axeVersion` in the
  report's **Accessibility (automated)** section and the Coverage table.
- Loader returned `blocked` (CSP, offline, proxy): say so in one Coverage
  Limitations line ("automated accessibility rules not run — page CSP blocks
  script injection"), fall back to the manual checks plus `browser_snapshot`
  (the accessibility tree: every interactive element has a role and a name) and
  mark the Coverage row `not run`. Never report the section as clean when the
  engine did not run.
- Repeat per language: AR pages fail different rules (`html[lang]`, `dir`,
  mixed-direction names).

### Pass 2 — Computed styles + geometry (the numeric layer)

This is the highest-value pass. For every element in the Pass 1 inventory, pull
the values the browser actually resolved:

```js
// browser_evaluate — run on the implementation AND, in Tier 2, on the reference site.
// Inline the selector: browser_evaluate calls the function with no arguments.
() => [...document.querySelectorAll('header, nav, main, section, table, form, button, a, [role]')].map(el => {
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    text: el.textContent?.trim().slice(0, 30),
    color: s.color, background: s.backgroundColor,
    font: `${s.fontFamily} ${s.fontSize} ${s.fontWeight}`,
    lineHeight: s.lineHeight, letterSpacing: s.letterSpacing,
    padding: s.padding, margin: s.margin, gap: s.gap,
    border: `${s.borderWidth} ${s.borderColor}`, radius: s.borderRadius,
    shadow: s.boxShadow, direction: s.direction, textAlign: s.textAlign,
    box: { x: Math.round(r.x), y: Math.round(r.y),
           w: Math.round(r.width), h: Math.round(r.height) },
  };
})
```

**Catches:** every color, typography, spacing, radius, border and shadow
mismatch — as an exact value pair, not an impression. Also catches alignment
and sizing issues from `box` (elements that should share an x-offset but
don't, rows of differing height, a container wider than its siblings).

**Verify the font actually loaded, don't just read its name.** `fontFamily`
reports what the CSS *asked for*, not what the browser rendered — a page whose
Arabic font failed to load still reports the right family while rendering in a
fallback. Prove it:

Don't guess the expected family — read it from the page itself. The first name
in an element's `font-family` list is what the CSS asked for; compare that
against what the browser actually loaded:

```js
// browser_evaluate — did the requested font actually load? (replace 'body' with an
// element that carries the script you are checking, e.g. an AR heading)
() => {
  const el = document.querySelector('body');
  const requested = getComputedStyle(el).fontFamily.split(',')[0]
    .trim().replace(/^["']|["']$/g, '');
  return {
    requested,
    resolved: document.fonts.check(`16px "${requested}"`),
    faces: [...document.fonts].map(f => `${f.family} ${f.weight} ${f.status}`),
  };
}
```

A face whose `status` is not `loaded`, or a `resolved: false`, means the page is
rendering in a fallback — a real bug, and it pairs with the Pass 1 network check
that will usually show the `.woff2` 404 behind it.

Run this against an element in each language (in RTL, an element containing the
RTL script), since a page often loads its Latin face successfully while the
script-specific face fails. That is the proof for the font item in the RTL
checks of Step 2B.2 — no expected family needs to be supplied by hand.

Two extra things this pass gives you for free:
- **Exact crop coordinates for Step 7** — `box` is the rectangle to annotate.
  Use it instead of the thumbnail-estimation workflow whenever a live URL is
  available; that workflow exists for screenshot-only inputs.
- **Exact WCAG contrast ratios** — compute them from the real `color` /
  `backgroundColor` values rather than eyeballing "this looks low contrast".
  This makes every contrast finding in Step 2B numeric and `High` confidence.

**Record how many elements this returned** — that number is the "Elements
measured" figure in the report's Coverage table, and it is what makes coverage
a fact rather than a claim. Record the region and state counts the same way as
you go, rather than reconstructing them at the end — every navigation, resize,
state driven, capture, measurement and engine run is appended to
`<evidence>/<page-slug>_<lang>/audit-log.md` (`capture-and-files.md`, "Audit
log") the moment it happens; the Coverage table is derived from that log, not
from memory.

For a repeated region (Step 3C), run this selector across **all** instances at
once and diff the resulting objects — an outlier row surfaces as a value that
differs from the rest, which is far more reliable than visually scanning a long
list.

### Pass 2b — Source trace (turn each measured mismatch into a file:line)

A bug that says "rendered `#7B2CBF`, expected `#2E75B6`" is fixable; a bug that
also says **where** the wrong value comes from is fixed in one edit. When the
project's source is available in the workspace (the usual case for this suite —
never for a remote-only URL), trace every Pass 2 mismatch before writing it up:

1. **Find the token source once** (Rung 1 in `no-design-audit.md`): search the
   styles tree for variable declarations (`$`, `--`, `theme`, `tokens`,
   `palette`, `variables`, `colors`, `spacing`) and note the file. Grep the
   expected value / token name there — that is the *expected* side's citation.
2. **Find the offending declaration**: grep the rendered literal (the hex,
   `13px`, `3px`, the font family) together with one of the element's class
   names from Pass 1 `cls`, in the app's stylesheets and component files
   (`.scss`, `.css`, `.less`, `.tsx`, `.vue`, `.html`, styled-components,
   Tailwind config / class strings). Prefer the match whose selector contains
   the element's class; a `!important`, an inline `style=` or a utility class
   (`text-purple-700`) counts as the source too.
3. **Write two lines into the bug**:
   - `**Source:** src/styles/_header.scss:42 — hard-coded `#7B2CBF` in `.app-header`; token `$color-primary` = `#2E75B6` defined in src/styles/_variables.scss:8`
   - `**Suggested fix:** replace the literal with `$color-primary`` (or the
     logical property, the token, the shared mixin — one concrete edit).
4. **Never guess a file.** If the grep finds nothing or several equally likely
   matches, write `**Source:** not traced (value not found in the workspace —
   likely computed at runtime / third-party CSS)` and leave Suggested fix as the
   CSS-level change. A wrong file:line costs the developer more than none.
5. **Hard-coded literal where a token exists is a finding on its own**
   (`Classification: UI/Layout Issue`, Severity 4 when it renders correctly
   today): it is the root cause behind "this one screen looks different".
   Report it once per file:line, never once per element.

Record the number of bugs traced vs not traced in the Coverage table
("Source traced: 9 of 11 bugs").

### Pass 3 — Full-page visual (structure and rhythm)

Now look at the full-page screenshot, for the things no single element's CSS
can tell you: section order, vertical rhythm across the whole page, visual
hierarchy and balance, whether the page reads as one coherent design.

**Catches:** layout-level problems that are invisible element-by-element.

### Pass 4 — Segment visual (fine detail)

Go through the per-section segment captures for what CSS cannot express:
icon style (outlined vs filled), icon and image quality, overlap or clipping,
text truncation, visual weight, anything rendered inside an image/SVG/canvas.

**Catches:** the qualitative issues the numeric passes structurally cannot see.

### Pass 5 — Pixel sampling (where CSS isn't authoritative)

For anything whose appearance doesn't come from the element's own CSS —
colors baked into an image, a gradient, an SVG sprite fill, a canvas — use the
`numpy` colour-mask technique in Step 7 to measure the real pixel values.

**Catches:** colour bugs the computed styles would report as "correct" because
the element's own CSS genuinely is correct.

### Pass 6 — Language / RTL pass

Repeat Passes 1–5 for the second language. `direction`, `textAlign` and the
`box` x-offsets from Pass 2 make RTL mirroring failures objectively provable
(an element whose `direction` is `rtl` but whose `box.x` still matches the LTR
layout is a mirroring bug, stated as a fact rather than an opinion).

---

**In the report**, always state which tier was used for that page, so the
reader knows whether a finding is a measured value or a visual read. A page
audited entirely at Tier 4 says so in the report's Coverage Limitations section.

---

## Step 2D — State & Condition Coverage (what to put the page into)

Step 2C is *how* you measure; this step is *what you point it at*. Auditing
only the default resting state of a page — whatever happened to be on screen
when it loaded — leaves entire categories of bugs undiscovered, because the
states where styling breaks most often are not the resting state.

**With a live URL, every state below is observable**: drive the browser into
it, then run the Step 2C passes against it exactly as you would the resting
state. Do not label these "unable to verify" when a browser is available —
that is only true for static-screenshot inputs.

Capture a screenshot of each state you find a bug in, into
`Actual-UI/<page-slug>_<lang>_segments/` with a descriptive name
(`button-hover.png`, `empty-state.png`, `form-validation-error.png`).

### 1. Interactive states
For every interactive element (buttons, links, inputs, selects, rows,
tabs, icon buttons):
- **hover** — `browser_hover`, then re-read computed styles
- **focus** — `browser_press_key` Tab to it, or `el.focus()`; check the focus
  ring exists, is visible, and is the right color (a missing or invisible
  focus ring is an accessibility bug, not a cosmetic one)
- **active / pressed** — where observable
- **disabled** — does it actually look disabled (contrast, cursor), or does it
  look identical to enabled?
- **selected / checked / expanded** — active tab, selected row, open accordion
- **error state** — submit a form with invalid input and inspect the error
  styling, the message placement, and whether the field itself changes

This is the category where wrong-token bugs hide (a focus ring inheriting the
wrong brand color, a hover state that never changes, a disabled button that
looks enabled) — see the brand-colour-bleed rule in Important Rules.

### 2. Content states
The same layout behaves differently with different data. Check each state that
the page can actually reach:
- **empty** — filter to zero results: is there a proper empty state, or a bare
  blank area?
- **loading** — skeleton/spinner styling, and whether layout shifts when real
  content replaces it
- **error** — a failed load (offline, filtered to an error case): is the error
  presented in the page's own visual language?
- **overflow / long content** — a long title, a long AR string, a long tag: does
  it wrap, truncate with an ellipsis, or break the layout? AR strings are often
  longer than their EN equivalents, so test this in AR specifically.
- **volume** — one row versus a full page of rows: check row rhythm,
  pagination styling, and whether the table header stays aligned.

### 3. Responsive behaviour

**First, establish whether responsive is even in scope.** Auditing phone widths
on a product that was never built for them manufactures bugs nobody asked for.

Read the app's own stylesheets for width media queries:

```js
// browser_evaluate — the app's real breakpoints
() => {
  const out = new Set();
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules } catch { continue }  // cross-origin
    for (const r of rules) {
      const m = r.media?.mediaText;
      if (m && /width/.test(m)) out.add(m);
    }
  }
  return [...out];
}
```

- **Breakpoints found** → responsive is in scope. Use these, not invented
  widths (next section).
- **No width media queries at all** → the product is not responsive by design.
  Confirm with the user, then **skip the narrow-width sweep entirely** and
  record it in Coverage as "Responsive: not applicable — fixed-width product
  (confirmed)". Do not file bugs for layouts breaking at phone widths.
  **But still check the realistic desktop range** (e.g. 1280 / 1366 / 1920) —
  a desktop-only product is still opened on laptops of different sizes, and
  breaking at 1366 is a genuine bug even with no responsive design.

### Testing at the real breakpoints

A breakpoint is where the layout is *designed* to change, so that is where it
breaks. Testing 1024 and 768 around a 992px breakpoint shows you the wide
layout and the narrow layout — both fine — while the failure sits at 991.

```
768 ────────── 992 ────────── 1024
 ✓              ↑               ✓
             breakpoint
          (never tested)
```

So for each breakpoint found, test **1px either side of it** (991 and 993),
plus the smallest width the product claims to support. The
**standard audit viewport** (Step 2) is the baseline and is already covered;
skip any width equal to it.

### Scope at each width — do NOT repeat the whole checklist

The full Step 3 checklist runs **once, at the standard audit viewport**. Colour,
typography, icon style, border radius and the like do not change with width, so
re-checking them at five widths answers the same question five times.

At every *other* width, three things happen and nothing else:

1. **Run the Pass 2 extraction and diff it against the baseline.** This is
   automatic and nearly free, and it means the measured categories are still
   covered at every width — you only investigate values that actually
   *changed*. An unchanged value needs no attention.
2. **Run the width-specific checks** below (overflow, disappeared content,
   touch targets, wrapping, reflow/stacking). These exist only at width.
3. **Give the full Step 3 checklist to anything that is new at this width.**
   A hamburger button, a slide-out nav, a stacked card variant replacing a
   table — these do not exist at the baseline, so they were never audited at
   all. Treat each as a fresh region: colours, typography, icons, spacing,
   states, the lot.

The principle is the same as Step 3C: **what repeats gets a diff; what is new
gets the full treatment.**

### The width-specific checks — measure, don't eyeball

```js
// browser_evaluate — what overflows, and by how much
() => [...document.querySelectorAll('*')]
  .map(el => ({ el, r: el.getBoundingClientRect() }))
  .filter(({ r }) => r.right > innerWidth + 1 || r.left < -1)
  .map(({ el, r }) => ({
    tag: el.tagName.toLowerCase(),
    cls: el.className?.toString().slice(0, 60),
    text: el.textContent?.trim().slice(0, 30),
    overflowBy: Math.round(r.right - innerWidth),
  }));
```

- **Horizontal overflow** — the snippet above names the culprit element and the
  overflow in px, so the bug says "this element extends 40px past the viewport"
  rather than "the page scrolls sideways".
- **What disappeared, and what appeared** — diff the Pass 1 element inventory
  against the baseline width, in both directions. Content that vanished with no
  alternative access is a bug (responsive layouts legitimately hide things, so
  ask via Step 9 when unsure). Anything that *appeared* is a newly-surfaced
  component: audit it in full, per the scope rule above, and record it as its
  own region in the Coverage table.
- **Touch targets** at the narrowest supported width — interactive elements
  should be ≥44×44px; measure from `getBoundingClientRect`.
- **Text truncation and wrapping**, especially in RTL, where strings differ in
  length from their LTR equivalents.
- **Reflow and stacking** — nav, tables, and filters switching to their
  small-screen form correctly. RTL reflow is not a mirror of LTR reflow; check
  it separately.

**Return to the standard audit viewport when the sweep is finished**, so any
later measurement or capture stays on the baseline.

**Honest limit — state it in Coverage Limitations:** resizing the viewport is
not the same as a real device. There is no touch input, no mobile user agent,
and no mobile browser chrome. Report this as "narrow-width layout checked by
viewport resize; not verified on a physical device."

### 4. Scroll and stacking behaviour
Only visible once the page moves:
- a sticky header/toolbar overlapping content, or not sticking when it should
- z-index/stacking problems: dropdowns rendering behind other elements, a modal
  overlay not covering everything, tooltips clipped by a container's `overflow`
- scroll containers with a double scrollbar, or a body that scrolls when a
  modal is open
- anything that only misbehaves partway down the page

### Reporting state coverage
List in the report's Coverage Checklist which states were actually exercised
per language. A state that could not be reached (no way to trigger an error,
no permission to empty the list) is stated as **not covered**, with the reason
— never silently skipped and never implied as passing.

