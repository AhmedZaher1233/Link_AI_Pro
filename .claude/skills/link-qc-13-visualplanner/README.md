# visualplanner

A Claude Code skill that turns any planning document into a visual HTML breakdown.

Point it at a spec, PRD, design doc, or implementation plan. Get back a single-page HTML file with scroll-based
navigation, animated reveals, flow diagrams and expandable detail cards, where readers can answer the plan's questions
and comment.

## How to use

In this suite the skill lives at `.claude/skills/link-qc-13-visualplanner/`. Then say, in Claude Code:

- "break down this plan"
- "visualize this spec"
- "make this plan visual"
- "turn this spec into HTML"

Point it at a file:

```
break down ./docs/my-design-spec.md
```

Before building it asks, once, which language the page should be in (English, or English + Egyptian Arabic) and where
the page's Save button should write the answers: the feature's `clarification_register.md`, the plan document itself,
or nowhere.

Requires Node 18+ (the page tool that assembles and checks the page). Save in the page needs Chrome or Edge; reading,
commenting and the Copy buttons work in any modern browser.

### Output

A single self-contained HTML file beside the source document (only Google Fonts load from outside). Re-running the
skill rebuilds it and carries the readers' saved comments and answers over.

## What the output looks like

- **Full-height sections** with progress bar and dot navigation (no scroll-snap)
- **Scroll-triggered animations** — elements fade in as you scroll
- **Flow diagrams** showing how components and phases connect
- **Expandable detail cards** — summary visible, details one click away
- **Pattern cards** for tech stack, features, and components
- **Step cards** for sequential processes
- **Callout boxes** for key decisions and constraints
- **Dark code blocks** for technical snippets
- **Stat badges** for key numbers
- **Question cards** — every question in the plan, answerable in the page (one-line input or rich text with bold, italic and lists)
- **Review toolbar** on every section — thumbs up/down and comments
- **Answer destination gate** — before building, the skill asks where Save writes the answers: the feature's `clarification_register.md` (then the spec owner runs `/speckit-clarify`), the plan document itself (one managed "Answers to Questions" block at its end), or nowhere (page only)
- **Save button** in the header (or `Ctrl+S`, Chrome/Edge) — writes the answers to that destination and all comments and answers into the HTML file itself, overwriting it, never creating a new one. Register columns are matched by name; a register without the expected table is never written
- **Copy for Clarify** — copies only the questions and their answers as a `/speckit-clarify` message to paste straight into the chat
- **Copy Review** — copies all feedback and answers as markdown to paste into Claude
- **Opens automatically** in the browser when generation finishes (`scripts/launch.ps1` / `scripts/launch.sh`)
- **Keyboard navigation** (arrow keys)
- **Warm, distinctive design** — Bricolage Grotesque, warm palette, not the generic AI look

## Design philosophy

**Visual first** — Every section is at least 50% visual. Max 2-3 sentences per text block. Lists become cards. Sequences become flow diagrams. Dense details go in expandable cards.

**Faithful to source** — Simplifies the presentation, not the content. Uses the original document's language. Doesn't add or reinterpret. Source text is escaped, never treated as markup.

**Checked before it is written** — The review system (state, Save, copy buttons) ships as fixed assets inserted by `scripts/page-tool.mjs`, which checks the assembled page and writes it only when every check passes.

## Skill structure

```
link-qc-13-visualplanner/
├── SKILL.md                      # Main skill instructions
├── README.md                     # This file
├── assets/
│   ├── review-system.css         # Review system CSS (inserted by the page tool)
│   └── review-system.js          # Review system JS: answers, comments, Copy buttons, Save to register / plan / page
├── scripts/
│   ├── page-tool.mjs             # build: assemble + carry saved feedback + check + write · check: re-check a page
│   ├── selftest.mjs              # Harness for the page tool and the Save logic (exits non-zero on a mismatch)
│   ├── launch.ps1                # Opens the finished page (Windows)
│   └── launch.sh                 # Opens the finished page (macOS, Linux, WSL, Git Bash)
└── references/
    ├── design-system.md          # CSS tokens, typography, colors, layout
    ├── interactive-elements.md   # HTML patterns: visual elements, question cards, review markup, main script head
    └── arabic-egyptian.md        # Egyptian Arabic second language and right-to-left layout
```

After changing an asset or the page tool: `node scripts/selftest.mjs --pretty`.

## Credits

Inspired by [codebase-to-course](https://github.com/zarazhangrui/codebase-to-course) by [Zara](https://x.com/zarazhangrui). Adapted from codebases to planning documents.

Originally built by [Ethan Rogers](https://ethanplus.ai) with Claude Code. Check the upstream licence before redistributing.
