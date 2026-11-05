---
name: link-qc-14-visualplanner
description: "Turn any planning document into a beautiful, visual HTML breakdown. Use this skill when someone wants to visualize a plan, spec, PRD, or design document as an interactive HTML walkthrough. Trigger on: 'break down this plan', 'visualize this spec', 'make this plan visual', 'visual breakdown', 'plan breakdown', 'turn this spec into HTML', 'make this plan easier to follow', 'plan breakdown in Arabic', 'اعمل الخطة دي بالعربي', or any request to convert a planning/design document into a visual format. Can add Egyptian Arabic as a second language with an in-page English/Arabic switch. Readers answer the plan's questions and comment in the page. Before building, the skill asks where the Save button writes the answers: the feature's clarification_register.md (for /speckit-clarify), the plan document itself, or nowhere. Save always keeps the comments in the page; Copy for Clarify copies the questions and answers for the chat; the page opens in the browser when done."
---

# visualplanner

Transform any planning document into a stunning, visual single-page HTML breakdown. The output is a self-contained HTML file with scroll-based navigation, animated reveals, flow diagrams, expandable sections, and a warm distinctive design. Zero dependencies except Google Fonts.

## First-Run Welcome

When the skill is triggered and the user hasn't specified a document yet:

> **I can turn any planning document into a beautiful visual breakdown.**
>
> Just point me at a file:
> - **A local file** — e.g., "break down ./docs/my-plan.md"
> - **The current doc** — if you're already looking at a spec, just say "break down this plan"
>
> I'll read through the document, figure out the best way to structure it visually, and generate a single HTML file you can scroll through, share, or screen-record. Works in any browser — no setup needed.
>
> I can also add **Egyptian Arabic** as a second language, with a button on the page to switch between English and Arabic.

## Language: English, or English + Egyptian Arabic

A breakdown is English only by default. Egyptian Arabic (عامية مصرية) is an optional second language: the page then holds both languages and a toggle in the nav switches between them, flipping the layout to right-to-left for Arabic.

**Ask before building**, unless the request already settles it. Use the host agent's ask-user-question tool with one question: "Which language should the breakdown be in?", and these options:

- **English only**
- **English + Egyptian Arabic — opens in English**
- **English + Egyptian Arabic — opens in Arabic**

Skip the question when:
- the user asked for Arabic, wrote the request in Arabic, or said "بالعربي" / "Arabic version" → build bilingual, opening in Arabic;
- the user said English only → build English only.

When bilingual, **read `references/arabic-egyptian.md` before writing any HTML**. It is the source of truth for the Egyptian Arabic writing style (with a worked example), the UI strings, and the HTML/CSS/JS for the switch and right-to-left layout. Every visible text in the page exists in both languages; facts, numbers, IDs and section structure are identical in both.

## Answer Destination (gate)

Save writes the readers' answers into a file, so **where they go is the user's decision, never a default**. Settle it
before building: it is baked into the page (`ANSWER_TARGET`, `SOURCE_FILE`) and decides the Save button's label, the
"Answering as" field and the final message.

First take a quick look: does the source document raise questions (Phase 1, item 9), and does its folder hold a
`clarification_register.md`? Then ask, with the host agent's ask-user-question tool, in the **same call** as the
language question when that one is asked too: "Where should Save write the answers to the plan's questions?"

- **The clarification register** (`register`) — only offered when the folder has a `clarification_register.md`
  with one table holding the columns `#`, `Answer`, `Status`, `User`, `Updated in Spec` and `Last Updated Date` (any
  order — Save matches them by name); recommended then. A register without that table is not offered, and the
  question says why. Each answer fills its question's row; the spec owner then runs `/speckit-clarify` to update the
  spec. Answers to questions with no register row are left for Copy for Clarify.
- **The plan itself** (`plan`) — Save writes every answer into the source document (`{SOURCE_FILE}`), inside one
  "Answers to Questions" block at its end that only Save manages; nothing else in the document changes.
  `/speckit-clarify` is not involved.
- **Nowhere — keep them in the page** (`none`) — Save writes the comments and answers into the page only; Copy for
  Clarify and Copy Review carry them out.

Skip the question only when:
- the source raises no questions → `none` (there is nothing to answer);
- the request already names the destination ("save the answers to the register", "write the answers into the plan",
  "don't touch any file");
- the user cannot be asked (pipeline, non-interactive run) → `none`, and say so in the final message. Never pick
  `register` or `plan` without the user's answer.

Name the choice in the final message.

## What This Does

Takes a planning document (markdown spec, PRD, architecture doc, design doc, implementation plan) and generates an HTML file that presents the same information in a visual, easy-to-follow format with:

- Full-height sections with progress tracking
- Scroll-triggered fade-in animations
- Flow diagrams showing how pieces connect
- Expandable detail cards for deeper dives
- Color-coded phases/components
- Step cards for sequential processes
- Callout boxes for key decisions and constraints
- Dark code blocks for technical snippets
- Stat badges for key numbers
- Question cards: every question in the plan with an answer field (one-line input or rich text) in the page
- A Save button in the header that writes the answers where the user chose before the build (the feature's
  `clarification_register.md`, the plan document itself, or nowhere) and all comments and answers into the HTML page
  itself (overwriting it, never creating a new file)
- A Copy for Clarify button that copies the questions and their answers as a `/speckit-clarify` message to paste
  into the chat

The goal is **clarity through visual structure** — make the plan dramatically easier to scan, understand, and share than the raw markdown.

---

## The Process

### Phase 0: Choose the Language and the Answer Destination

Settle English only vs. English + Egyptian Arabic as described in **Language** above, and where Save writes the
answers as described in **Answer Destination (gate)** — one ask-user-question call holding both questions when both
are open. Do not start Phase 2 until the destination is settled.

### Phase 1: Analyze the Document

Read the entire planning document. Extract:

1. **Project name and one-line description** — for the hero section
2. **Document type** — determine the best visual structure:
   - **Phase-based** — sequential implementation phases → use numbered phase sections
   - **Architecture-first** — system design with components → lead with architecture diagram, then detail sections
   - **Feature walkthrough** — organized around user-facing features → feature-by-feature sections
   - **Narrative** — traces a user journey or data flow → story-arc sections
   - **Mixed** — combination of the above → pick the dominant pattern, weave in others
3. **Major sections** — these become the scrollable sections (aim for 4-8)
4. **Relationships** — how parts connect to each other (these become flow diagrams)
5. **Technical details** — code snippets, file structures, API specs (these go in expandable cards and code blocks)
6. **Key decisions and constraints** — (these become callout boxes)
7. **Numbers and metrics** — file counts, endpoint counts, tech stack items (these become stat badges)
8. **The tech stack** — languages, frameworks, services mentioned
9. **Questions** — every question the plan raises: questions for the spec owner (`AQ-nn`), clarification rows
   (`Q<#>`), `[NEEDS CLARIFICATION]` markers, "Open questions" lists. For each: its ID, text, owner, why it matters,
   any options (and the recommended one), and the recorded answer if there is one. These become question cards
10. **The feature folder and register rows** — only when the destination is `register`: the document belongs to a
   Spec Kit feature (`specs/…/` with a `clarification_register.md`); note the folder (`FEATURE_DIR`, e.g. `specs/008-audit`) and, for each question, its
   register row number: `Q12` is row 12; a plan question (`AQ-nn`) is the row the plan or register says it was
   handed over as ("as register row Q25"). Read the register to confirm each number; a question with no row gets
   none. Never guess a row number

### Phase 2: Build the HTML

Write the page as a **draft** in a temporary folder outside the project (the session's scratch or temp folder), never
straight to the output path. Read `references/design-system.md` for the complete CSS design tokens. Read
`references/interactive-elements.md` for implementation patterns. The review system's CSS and JS are **not** written by
hand: they live in `assets/review-system.css` and `assets/review-system.js`, and the draft carries only their two
placeholders, which Phase 2b fills.

**Build order:**

1. **Foundation first** — HTML shell with all sections (empty), complete CSS design system from references (with
   `/* @visualplanner:review-css */` as the stylesheet's last line), navigation bar with progress tracking and the
   **Save** button, keyboard navigation, scroll-triggered animations, the review markup (toolbars, question cards, copy
   buttons, toast, saved-state holder) and the main script's head: `PRISTINE_HTML` first, then `PAGE_SLUG`,
   `FEATURE_DIR`, `ANSWER_TARGET` and `SOURCE_FILE` set from Phase 0 and Phase 1, and `/* @visualplanner:review-js */`
   as the last line inside the IIFE (`references/interactive-elements.md` → Review JavaScript). When bilingual, the foundation also includes the language toggle, the Arabic fonts, the right-to-left CSS and the language JS from `references/arabic-egyptian.md`. After this step: a working skeleton you can scroll through (and switch language in).

2. **Hero section** — Project name, one-line description, key stats (as badges), and a visual overview of what the plan covers.

3. **One section at a time** — Fill in each section's content and visual elements. Don't try to write all sections in one pass. Build Section 1, then Section 2, etc. When bilingual, write each section's Egyptian Arabic text together with its English text, not as a separate pass at the end.

4. **Polish pass** — After all sections are built, do a final pass for visual consistency. When bilingual, also run the bilingual checklist in `references/arabic-egyptian.md` (every text in both languages, layout correct in right-to-left).

**Output file name:** `{project-name}-breakdown.html` (slugified from document title), written **beside the source
document**: for a Spec Kit feature, in the feature folder (`specs/008-audit/audit-breakdown.html`), so Save finds the
register and the page in the one folder it asks for. On a re-run keep the same file name and `PAGE_SLUG`, and the same
section ids where the sections are unchanged, so earlier feedback lands on the same sections.

### Phase 2b: Assemble, Carry Over and Check

Write the page with the page tool — never with a plain file write, because the page at the output path may hold the
readers' saved comments and answers:

```
node "<skill-dir>/scripts/page-tool.mjs" build --draft "<draft.html>" --page "<absolute output path>" --pretty
```

It inserts the two assets at the placeholders; if the output page already exists, it **carries its saved comments and
answers into the new page**; it checks the result (one main script that parses and opens with the snapshot, the
saved-state holder right before it, a review bar on every section, unique question IDs, `ANSWER_TARGET` one of the
three values, every `data-reg` a unique row of the register table, `SOURCE_FILE` beside the page for `plan`, no
scroll-snap, no extra `<script>`, only Google Fonts outside the file); and it writes the page **only when every
check passes**.

- `verdict: PASS` → go to Phase 3. When the payload lists `carried`, say in the final message how many sections and
  answers were carried over, and name any `orphans` (feedback for sections or questions the new page no longer has —
  kept in the saved state, not shown).
- `verdict: FAIL` → nothing was written. Fix the draft for each error and run it again. An existing page whose saved
  state cannot be read is never overwritten: tell the user and use `--force` only when they say to discard it.
- No Node on the machine → insert both asset files' contents at the placeholders by copying them unchanged, ask
  before overwriting an existing page (its saved feedback would be lost), and report the checks as not run.

### Phase 3: Open and Present

As soon as the page tool has written the page, open it with the launcher in this skill's `scripts/` folder (`<skill-dir>` is
this skill's base directory), passing the file's absolute path:

- **Windows (PowerShell):** `powershell -NoProfile -ExecutionPolicy Bypass -File "<skill-dir>/scripts/launch.ps1" -Path "<absolute path to the html>"`
- **macOS / Linux / WSL / Git Bash:** `sh "<skill-dir>/scripts/launch.sh" "<absolute path to the html>"`

Don't ask first: opening the page is the end of the run. If the launcher fails (no browser, headless session), say so
and give the file's absolute path. Then tell the user, in two or three lines, that they can answer the questions and
comment in the page; what **Save** (or `Ctrl+S`, in Chrome or Edge) does with the chosen destination — `register`:
answers into the feature's `clarification_register.md`, after which the spec owner runs `/speckit-clarify`; `plan`:
answers into the "Answers to Questions" block at the end of `{SOURCE_FILE}`; `none`: answers stay in the page — and
that it always writes everything into the page; and that **Copy for Clarify** copies the questions and answers to
paste straight into the chat.

---

## Content Philosophy

### Visual First — Aggressively

The whole point is that this is easier to follow than the raw document. Follow these rules:

**Text limits:**
- Max **2-3 sentences** per text block. If you're writing a fourth sentence, stop and convert it into a visual element.
- Every section should be **at least 50% visual** — flow diagrams, cards, code blocks, badges, step cards.

**Convert text to visuals:**
- A list of 3+ items → **pattern cards** with icons
- A sequence of steps → **step cards** or **flow diagram with arrows**
- "Component A connects to Component B" → **flow diagram**
- Architecture descriptions → **box-and-arrow layouts** with color-coded zones
- File/directory structures → **visual file tree**
- Technical details that might overwhelm → **expandable detail cards** (summary visible, details on click)
- Key numbers → **stat badges**
- Comparisons → **side-by-side columns**

### Faithful to Source

- Use the original document's language and terms — don't rewrite or reinterpret
- Preserve technical accuracy — simplify the **presentation**, not the **content**
- Don't add information that isn't in the source document
- Don't skip sections just because they're technical — use expandable cards for dense details

### Lead with the "What" Before the "How"

Each section should open with what this part of the plan does or achieves, then go into the details. The reader should be able to scroll through quickly and get the gist, or slow down and expand cards for depth.

### Plain Language Summaries

For each major section, write a 1-2 sentence plain language summary that captures the essence. This appears as the section subtitle. The original technical content goes in the body and expandable cards below.

---

## Section Structure

Each major chunk of the planning document becomes a section:

```
Section N
├── Section number (large, accent-colored)
├── Section title (bold heading)
├── Section subtitle (1-line plain language summary)
├── Body
│   ├── Visual element (flow diagram, cards, file tree, etc.)
│   ├── Brief text (2-3 sentences max per block)
│   ├── Expandable detail cards (for deeper content)
│   ├── Code blocks (if technical snippets exist)
│   ├── Callout boxes (for key decisions/constraints)
│   └── Question cards (when the section raises questions)
└── Review toolbar (thumbs up, thumbs down, comment button)
```

**Aim for 4-8 sections total.** If the document has more major headings, group related ones. If it has fewer, split large sections into logical sub-parts.

---

## Required Elements

Every breakdown must include:

1. **Hero section** — Project name, description, key stat badges
2. **At least one flow diagram** — showing how major parts connect
3. **At least one set of pattern/feature cards** — for listing components, features, or tech stack
4. **Expandable detail cards** — for any section with dense technical content
5. **Callout boxes** — for key decisions, constraints, or trade-offs mentioned in the plan
6. **Progress bar and dot navigation** — always present
7. **Review system on every section** — thumbs up/down + comment + Copy Review button (see below)
8. **Question cards** — one per question in the source, each with an answer field (see below), its register row
   (`data-reg`) when the destination is `register` and it has one, and one "Answering as" field above them when the
   destination is `register` or `plan`; when the source has none, no cards
9. **Save button in the header** — always, beside the language toggle when bilingual (see below)
10. **Copy for Clarify button** — whenever the page has question cards (see below)
11. **Language toggle** — only when bilingual: an English / عربي button in the nav, remembered per viewer (see `references/arabic-egyptian.md`)

---

## Question Cards

Every question the plan raises is answerable **in the page**. Each becomes a card with its ID, owner, status
(Open / Answered), the question, why it matters, and an answer field:

- **One-line input** (`data-answer="input"`) when the answer is a short value: a number, a date, a name, an ID.
- **Rich text** (`data-answer="rich"`, the default) for anything else: a toolbar with bold, italic, bulleted and
  numbered lists. Pasted text arrives as plain text.
- **Options** from the source (A / B / C, recommended) appear as chips above the field; the field holds the reason.
- **Answered in the source**: the recorded answer shows above the field, the card shows Answered, and the field
  invites a note. Never pre-fill a field with an answer the source doesn't record.

- **Register row** (`data-reg`): destination `register` only — the card's row number in `clarification_register.md`
  (Phase 1, item 10). Save fills that row; a card without one is carried by Copy for Clarify.
- **Answering as**: one name/email field above the cards when the destination is `register` or `plan`. Save records
  it as the row's `User` (register) or beside each answer (plan).

Group the cards in a "Questions" section near the end, or put each in the section it belongs to. The hero shows the
number of open questions. Answers autosave with the review, go into the chosen destination and the page on Save, into
Copy for Clarify, and into Copy Review under "Answers to Questions". See `references/interactive-elements.md` →
Question Cards.

---

## Review System

Every section includes a review toolbar so users can give feedback on the plan. This is NOT optional — include it in every generated HTML file.

**Per-section toolbar:**
- Thumbs up button (green when active)
- Thumbs down button (red when active)
- Comment button (opens a textarea inline, turns blue when comment exists)
- Clicking the same reaction again deselects it (toggle behavior)

**"Save" button in the header:**
- In the nav bar, after the section dots (before the language toggle when bilingual); `Ctrl+S` / `⌘S` does the same
- **Never creates a new file.** The first Save asks for the folder once (the feature folder, which holds the
  register and the page) and remembers it; later Saves are silent
- **Answers → the destination chosen at the gate** (`ANSWER_TARGET`):
  - `register`: each answer goes into its row of the feature's `clarification_register.md` (Answer, Status
    `Answered`, User = "Answering as", Updated in Spec `No`, today's date). Only an `Open` row is filled, or a row
    this page filled before that the spec hasn't taken yet; an already-answered row, or a question with no row, is
    left for `/speckit-clarify` (the toast names them: use Copy for Clarify). Save never edits `spec.md` or
    `plan.md`; the toast tells the reader to have the spec owner run `/speckit-clarify`, which applies the answered
    rows to the spec and sets Updated in Spec (register rule 7)
  - `plan`: every answered question goes into the "Answers to Questions" block at the end of `{SOURCE_FILE}`, one
    entry per question ID (answer, choice, "Answering as", date), between the markers
    `<!-- visualplanner:answers -->` and `<!-- /visualplanner:answers -->`. The first Save appends the block; later
    Saves replace only this page's entries and keep the others. Nothing outside the block is ever changed; a document
    with a broken or doubled block is not written (the toast says so)
  - `none`: no answer leaves the page
- **Comments → the page itself:** every reaction, comment and answer is written into the HTML file in that folder (a
  JSON block in the page), overwriting it, so the file reopens, or is sent to someone, with all of it
- Needs Chrome or Edge (File System Access); another browser shows a toast pointing to Copy for Clarify
- A dot on the button shows feedback not yet saved into the page; a toast reports each Save
- On open, saved comments are shown expanded and answers filled in

**Floating "Copy for Clarify" button:**
- Above Copy Review, bottom-right; only visible once at least one question has an answer; badge = answered questions
- Copies only the questions and their answers (choice, answer, register row, recorded answer for a note), in English,
  starting with `/speckit-clarify` and the feature folder, so pasting it into the chat runs clarify directly
- The route when Save can't file an answer (no register row, row already answered, a browser without file access)

**Floating "Copy Review" button:**
- Fixed bottom-right corner, dark pill-shaped button
- Only visible after the user leaves at least one reaction, comment or answer
- Shows a badge count of how many sections and questions have feedback
- On click: collects all reactions, comments and answers, formats them as markdown, copies to clipboard
- Shows a toast: "Review copied to clipboard — paste into Claude"

**localStorage persistence:**
- All review state also autosaves to localStorage, keyed by the page slug, as the user types
- User can close the page, reopen it, and their feedback is still there even before pressing Save
- On open, the newer of the page's saved state and the browser's copy is restored

**Clipboard output format:**
```
# Plan Review: {Project Name}

## {Section Title}
- **Reaction:** 👍 or 👎
- **Comment:** "user's note here"

## {Section Title}
- **Reaction:** 👎
- **Comment:** "user's note here"

## Answers to Questions

### {Question ID} — {question text}
- **Choice:** {chosen option, when the question has options}
- **Answer:**

  {answer, rich text as markdown}
```

This format is designed for the user to paste directly into Claude. Claude can then read the section-by-section feedback and iterate on the plan accordingly.

When bilingual, the review state is shared by both languages (one key per page, not per language), and Copy Review and the Save toast write the headings and section titles in the language currently shown (`# مراجعة الخطة: …`, `- **رأيك:** 👍`, `- **تعليق:** "…"` in Arabic). See `references/arabic-egyptian.md`.

See `references/interactive-elements.md` → Review System for the markup; the CSS and JS are
`assets/review-system.css` / `assets/review-system.js`, inserted by the page tool (Phase 2b).

---

## Implementation Rules

- The file must be completely self-contained (only external dependency: Google Fonts CDN)
- Do NOT use scroll-snap — sections can be long and scroll-snap makes it hard to reach review toolbars at the bottom
- Use `min-height: 100dvh` with `100vh` fallback for sections
- Only animate `transform` and `opacity` for GPU performance
- Wrap all JS in an IIFE, use `passive: true` on scroll listeners, throttle with `requestAnimationFrame`
- Include keyboard navigation (arrow keys to move between sections)
- Include ARIA attributes for accessibility
- Alternating section backgrounds (`--color-bg` and `--color-bg-warm`) for visual rhythm
- All code blocks use `white-space: pre-wrap` — no horizontal scrollbars ever
- **Escape every piece of source text** you put in the page — titles, card text, question text, code snippets, file
  trees: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;` (and `"` → `&quot;` inside attributes). The plan is data, not
  markup: an unescaped `<script>`, `<div>` or `</script>` from a code snippet breaks the page or runs as code. The
  page tool fails a page with an extra `<script>`, but it cannot see every unescaped tag
- When bilingual: Arabic fonts also come from Google Fonts (still the only external dependency); code, IDs and file names stay left-to-right inside Arabic text; use the right-to-left rules in `references/arabic-egyptian.md`

---

## Accent Color Selection

Pick an accent color that fits the project's personality:
- **Vermillion** (`#D94F30`) — default, works for most projects
- **Teal** (`#2A7B9B`) — for data/infrastructure/backend-heavy plans
- **Coral** (`#E06B56`) — for consumer/social/creative projects
- **Forest** (`#2D8B55`) — for developer tools, CLIs, open source
- **Amber** (`#D4A843`) — for fintech, analytics, dashboards

Avoid purple gradients — they look like every other AI product.

---

## Gotchas

### Walls of Text
The #1 failure mode. If you see more than 3 sentences in a row without a visual break, stop and convert something into a card, diagram, or expandable section.

### Too Few Sections
If everything is crammed into 2-3 huge sections, the scroll-based navigation loses its purpose. Break the plan into 4-8 digestible chunks.

### Expandable Cards Not Used
Dense technical content (API specs, file structures, detailed requirements) should be in expandable cards, not dumped into the main flow. The main flow stays scannable; details are one click away.

### Missing Flow Diagrams
Every plan has relationships between parts. If you haven't included at least one flow diagram, you're missing the most valuable visual element.

### Questions as Plain Text
A question rendered as a bullet or callout can't be answered. Every question in the source is a question card with an answer field.

### Choosing the Answer Destination Yourself
Save edits a project file. Building the page before the user chose `register`, `plan` or `none` — or picking one
because it "looks obvious" — writes answers where nobody agreed. Ask the gate question; only `none` is safe without it.

### Save Fills the Wrong Register Row
Save writes the answer into the row named by `data-reg`. A wrong number puts an answer on another question. Take every
number from the register or the plan's hand-over note, and leave `data-reg` off when there is no row.

### Save Writes a Broken Page
Save writes back the snapshot taken on the first line of the main script. Keep that line first, keep the main `<script>` the last element of `<body>`, and keep `<script type="application/json" id="vp-saved-state">` right before it, or the saved page loses content or its comments. Never write a literal closing script tag anywhere inside the inline JS (not even in a comment or string): it ends the script early and every button stops working. The page tool checks all of this; a FAIL means fix the draft, never write the page another way.

### Overwriting a Page That Holds Feedback
The breakdown page is where Save keeps the readers' comments and answers. Writing a re-run's page over it with a plain
file write deletes them. Always write through `page-tool.mjs build`, which carries them over.

### Retyping the Review JS
The review CSS and JS are assets inserted by the page tool. Retyping or "improving" them in a page is how a register
column or a script tag goes wrong; change the asset (and run `scripts/selftest.mjs`) instead.

### Not Opening the Page
The run ends by opening the page with `scripts/launch.ps1` / `scripts/launch.sh`, not by printing a path and stopping.

---

## Reference Files

Read these before writing any HTML (`references/arabic-egyptian.md` only when bilingual):

- **`references/design-system.md`** — Complete CSS custom properties, color palette, typography scale, spacing, shadows, animations, navigation, module structure, responsive breakpoints.
- **`references/interactive-elements.md`** — HTML/CSS/JS patterns for: expandable cards, flow diagrams, step cards, callout boxes, code blocks, stat badges, pattern cards, file trees, icon rows, question cards, and the review system markup (section toolbar, Save button, Copy for Clarify, Copy Review) and the main script's head.

Used, not read:

- **`assets/review-system.css`, `assets/review-system.js`** — the review system's CSS and JS (reactions, comments, answers, Copy Review, Copy for Clarify, Save to register / plan / page), inserted verbatim by the page tool.
- **`scripts/page-tool.mjs`** — `build` assembles, carries saved feedback over, checks and writes the page (Phase 2b); `check` re-checks a page.
- **`scripts/selftest.mjs`** — the harness for the page tool and the Save logic; run it after changing an asset or the tool (exits non-zero on a mismatch).
- **`scripts/launch.ps1`, `scripts/launch.sh`** — open the finished page in the browser (Phase 3).
- **`references/arabic-egyptian.md`** — only when bilingual: Egyptian Arabic writing style and worked example, UI strings, language toggle, right-to-left CSS, language JS, bilingual review output, and the bilingual checklist.
