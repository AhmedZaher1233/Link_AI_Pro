# Interactive Elements Reference

Implementation patterns for every visual element used in plan breakdowns. Pick the elements that best serve each section's content.

## Table of Contents
1. [Expandable Detail Cards](#expandable-detail-cards)
2. [Flow Diagrams](#flow-diagrams)
3. [Numbered Step Cards](#numbered-step-cards)
4. [Callout Boxes](#callout-boxes)
5. [Pattern/Feature Cards](#patternfeature-cards)
6. [Stat Badges](#stat-badges)
7. [Visual File Tree](#visual-file-tree)
8. [Icon-Label Rows](#icon-label-rows)
9. [Architecture Diagram](#architecture-diagram)
10. [Comparison Table](#comparison-table)
11. [Code Blocks with Labels](#code-blocks-with-labels)
12. [Hero Section](#hero-section)
13. [Question Cards](#question-cards)
14. [Review System](#review-system) — section toolbar, Save button, Copy for Clarify, Copy Review

---

## Expandable Detail Cards

For dense technical content that shouldn't overwhelm the main flow. Summary is always visible; details expand on click.

**HTML:**
```html
<div class="expandable-card animate-in">
  <button class="expandable-header" onclick="toggleExpand(this)" aria-expanded="false">
    <div class="expandable-title-row">
      <span class="expandable-icon">+</span>
      <strong>Card Title — Brief Summary</strong>
    </div>
    <span class="expandable-hint">Click to expand</span>
  </button>
  <div class="expandable-body">
    <p>Detailed content goes here. Can include any other elements — code blocks, lists, etc.</p>
  </div>
</div>
```

**CSS:**
```css
.expandable-card {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  margin: var(--space-4) 0;
  border: 1px solid var(--color-border-light);
}
.expandable-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  background: none;
  border: none;
  cursor: pointer;
  font-family: var(--font-body);
  font-size: var(--text-base);
  color: var(--color-text);
  text-align: left;
  transition: background var(--duration-fast);
}
.expandable-header:hover {
  background: var(--color-surface-warm);
}
.expandable-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.expandable-icon {
  font-family: var(--font-mono);
  font-size: var(--text-lg);
  color: var(--color-accent);
  font-weight: 700;
  width: 24px;
  text-align: center;
  transition: transform var(--duration-normal) var(--ease-out);
}
.expandable-card.open .expandable-icon {
  transform: rotate(45deg);
}
.expandable-hint {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.expandable-card.open .expandable-hint {
  display: none;
}
.expandable-body {
  max-height: 0;
  overflow: hidden;
  transition: max-height var(--duration-slow) var(--ease-out),
              padding var(--duration-slow) var(--ease-out);
  padding: 0 var(--space-5);
}
.expandable-card.open .expandable-body {
  max-height: 2000px;
  padding: 0 var(--space-5) var(--space-5);
}
.expandable-body p {
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}
```

**JS:**
```javascript
window.toggleExpand = function(btn) {
  const card = btn.closest('.expandable-card');
  card.classList.toggle('open');
  btn.setAttribute('aria-expanded', card.classList.contains('open'));
};
```

---

## Flow Diagrams

CSS flexbox-based. Boxes with arrows showing how parts connect. Color-coded per component.

**Horizontal flow (default — wraps to vertical on mobile):**
```html
<div class="flow-steps animate-in">
  <div class="flow-step" style="border-top: 3px solid var(--color-section-1)">
    <div class="flow-step-label" style="background: var(--color-section-1)">Scanner</div>
    <p>Walks the directory tree and discovers all files</p>
  </div>
  <div class="flow-arrow">&rarr;</div>
  <div class="flow-step" style="border-top: 3px solid var(--color-section-2)">
    <div class="flow-step-label" style="background: var(--color-section-2)">Parser</div>
    <p>Extracts imports and builds dependency graph</p>
  </div>
  <div class="flow-arrow">&rarr;</div>
  <div class="flow-step" style="border-top: 3px solid var(--color-section-3)">
    <div class="flow-step-label" style="background: var(--color-section-3)">Renderer</div>
    <p>Displays the graph as 3D particles</p>
  </div>
</div>
```

**CSS:**
```css
.flow-steps {
  display: flex;
  align-items: stretch;
  gap: var(--space-2);
  margin: var(--space-8) 0;
  flex-wrap: wrap;
  justify-content: center;
}
.flow-step {
  flex: 1;
  min-width: 160px;
  max-width: 260px;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: var(--space-5);
  box-shadow: var(--shadow-sm);
  text-align: center;
}
.flow-step-label {
  display: inline-block;
  color: white;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  margin-bottom: var(--space-3);
}
.flow-step p {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  margin: 0;
  line-height: var(--leading-normal);
}
.flow-arrow {
  display: flex;
  align-items: center;
  font-size: var(--text-2xl);
  color: var(--color-text-muted);
  font-weight: 300;
  padding: 0 var(--space-1);
}

@media (max-width: 768px) {
  .flow-steps { flex-direction: column; align-items: center; }
  .flow-step { max-width: 100%; width: 100%; }
  .flow-arrow { transform: rotate(90deg); }
}
```

**Vertical flow (for longer sequences):**
```html
<div class="flow-vertical animate-in">
  <div class="flow-v-step">
    <div class="flow-v-num" style="background: var(--color-section-1)">1</div>
    <div class="flow-v-content">
      <strong>Step Title</strong>
      <p>Description of what happens at this step</p>
    </div>
  </div>
  <div class="flow-v-line"></div>
  <div class="flow-v-step">
    <div class="flow-v-num" style="background: var(--color-section-2)">2</div>
    <div class="flow-v-content">
      <strong>Step Title</strong>
      <p>Description</p>
    </div>
  </div>
  <!-- more steps -->
</div>
```

**CSS:**
```css
.flow-vertical {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0;
  margin: var(--space-8) 0;
  padding-left: var(--space-4);
}
.flow-v-step {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
}
.flow-v-num {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: white;
  font-weight: 700;
  font-family: var(--font-display);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.flow-v-content {
  padding-bottom: var(--space-4);
}
.flow-v-content p {
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  margin: var(--space-1) 0 0;
}
.flow-v-line {
  width: 2px;
  height: 24px;
  background: var(--color-border);
  margin-left: 17px;
}
```

---

## Numbered Step Cards

For sequential processes. Each step is a card with a number, title, and description.

```html
<div class="step-cards stagger-children">
  <div class="step-card animate-in">
    <div class="step-num">1</div>
    <div class="step-body">
      <strong>Step Title</strong>
      <p>Description of what happens in this step</p>
    </div>
  </div>
  <div class="step-card animate-in">
    <div class="step-num">2</div>
    <div class="step-body">
      <strong>Step Title</strong>
      <p>Description</p>
    </div>
  </div>
  <div class="step-card animate-in">
    <div class="step-num">3</div>
    <div class="step-body">
      <strong>Step Title</strong>
      <p>Description</p>
    </div>
  </div>
</div>
```

```css
.step-cards {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: var(--space-6) 0;
}
.step-card {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  background: var(--color-surface);
  border-radius: var(--radius-md);
  border-left: 3px solid var(--color-accent);
  box-shadow: var(--shadow-sm);
}
.step-num {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--color-accent);
  color: white;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  flex-shrink: 0;
}
.step-body p {
  margin: var(--space-1) 0 0;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}
```

---

## Callout Boxes

Highlighted boxes for key decisions, constraints, trade-offs, or important notes.

```html
<div class="callout callout-accent animate-in">
  <div class="callout-icon">&#x1f4a1;</div>
  <div class="callout-content">
    <strong class="callout-title">Key Decision</strong>
    <p>Explanation of why this decision was made and what it means for the project.</p>
  </div>
</div>
```

**CSS:**
```css
.callout {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-5);
  border-radius: var(--radius-md);
  margin: var(--space-6) 0;
}
.callout-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
  line-height: 1;
}
.callout-title {
  display: block;
  margin-bottom: var(--space-2);
  font-family: var(--font-display);
  font-size: var(--text-base);
}
.callout p {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}

/* Variants */
.callout-accent {
  background: var(--color-accent-light);
  border-left: 4px solid var(--color-accent);
}
.callout-accent .callout-title { color: var(--color-accent); }

.callout-info {
  background: var(--color-info-light);
  border-left: 4px solid var(--color-info);
}
.callout-info .callout-title { color: var(--color-info); }

.callout-warning {
  background: var(--color-error-light);
  border-left: 4px solid var(--color-error);
}
.callout-warning .callout-title { color: var(--color-error); }

.callout-success {
  background: var(--color-success-light);
  border-left: 4px solid var(--color-success);
}
.callout-success .callout-title { color: var(--color-success); }
```

**When to use each variant:**
- `callout-accent` — Key decisions, architectural choices, "why we chose this"
- `callout-info` — Good to know, context, background information
- `callout-warning` — Constraints, limitations, risks, things to watch out for
- `callout-success` — Wins, benefits, what makes this approach work well

---

## Pattern/Feature Cards

Grid of cards for listing components, features, tech stack items, or any set of related concepts.

```html
<div class="pattern-cards stagger-children">
  <div class="pattern-card animate-in" style="border-top: 3px solid var(--color-section-1)">
    <div class="pattern-icon" style="background: var(--color-section-1)">icon</div>
    <h4 class="pattern-title">Component Name</h4>
    <p class="pattern-desc">Brief description of what this component does and why it matters.</p>
  </div>
  <div class="pattern-card animate-in" style="border-top: 3px solid var(--color-section-2)">
    <div class="pattern-icon" style="background: var(--color-section-2)">icon</div>
    <h4 class="pattern-title">Component Name</h4>
    <p class="pattern-desc">Brief description.</p>
  </div>
  <!-- more cards -->
</div>
```

```css
.pattern-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-4);
  margin: var(--space-6) 0;
}
.pattern-card {
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: var(--space-6);
  box-shadow: var(--shadow-sm);
  transition: transform var(--duration-normal) var(--ease-out),
              box-shadow var(--duration-normal);
}
.pattern-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-md);
}
.pattern-icon {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  margin-bottom: var(--space-3);
  color: white;
}
.pattern-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: var(--text-base);
  margin: 0 0 var(--space-2);
}
.pattern-desc {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  margin: 0;
  line-height: var(--leading-normal);
}
```

---

## Stat Badges

Small badges for key numbers and metrics. Use in the hero section or anywhere stats add context.

```html
<div class="stat-badges animate-in">
  <div class="stat-badge">
    <span class="stat-value">147</span>
    <span class="stat-label">Files</span>
  </div>
  <div class="stat-badge">
    <span class="stat-value">5</span>
    <span class="stat-label">Modules</span>
  </div>
  <div class="stat-badge">
    <span class="stat-value">Node.js</span>
    <span class="stat-label">Runtime</span>
  </div>
</div>
```

```css
.stat-badges {
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin: var(--space-6) 0;
}
.stat-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-3) var(--space-5);
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--color-border-light);
  min-width: 80px;
}
.stat-value {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: var(--text-xl);
  color: var(--color-accent);
}
.stat-label {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
```

---

## Visual File Tree

For showing project structure. Much better than a paragraph listing directories.

```html
<div class="file-tree animate-in">
  <div class="ft-folder open">
    <span class="ft-name">src/</span>
    <span class="ft-desc">Main source code</span>
    <div class="ft-children">
      <div class="ft-folder">
        <span class="ft-name">scanner/</span>
        <span class="ft-desc">File discovery and parsing</span>
      </div>
      <div class="ft-folder">
        <span class="ft-name">server/</span>
        <span class="ft-desc">Express server and API routes</span>
      </div>
      <div class="ft-file">
        <span class="ft-name">index.js</span>
        <span class="ft-desc">Entry point</span>
      </div>
    </div>
  </div>
</div>
```

```css
.file-tree {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: var(--space-5);
  box-shadow: var(--shadow-sm);
  margin: var(--space-6) 0;
}
.ft-folder, .ft-file {
  padding: var(--space-2) var(--space-3);
  border-left: 2px solid var(--color-border-light);
  margin-left: var(--space-4);
}
.ft-folder:first-child {
  border-left: none;
  margin-left: 0;
}
.ft-folder > .ft-name {
  color: var(--color-accent);
  font-weight: 600;
}
.ft-file > .ft-name {
  color: var(--color-text);
}
.ft-desc {
  color: var(--color-text-muted);
  font-family: var(--font-body);
  margin-left: var(--space-2);
  font-size: var(--text-xs);
}
.ft-children {
  margin-left: var(--space-4);
  margin-top: var(--space-1);
}
```

---

## Icon-Label Rows

For listing components, features, or tech stack visually. Replaces bullet-point paragraphs.

```html
<div class="icon-rows stagger-children">
  <div class="icon-row animate-in">
    <div class="icon-circle" style="background: var(--color-section-1)">icon</div>
    <div>
      <strong>Component Name</strong>
      <p>Brief description of what it does</p>
    </div>
  </div>
  <div class="icon-row animate-in">
    <div class="icon-circle" style="background: var(--color-section-2)">icon</div>
    <div>
      <strong>Component Name</strong>
      <p>Brief description</p>
    </div>
  </div>
</div>
```

```css
.icon-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin: var(--space-6) 0;
}
.icon-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--color-surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}
.icon-row p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}
.icon-circle {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  flex-shrink: 0;
  color: white;
}
```

---

## Architecture Diagram

Box-and-arrow layout showing how major system components relate. CSS grid-based.

```html
<div class="arch-diagram animate-in">
  <div class="arch-zone">
    <h4 class="arch-zone-label">Client</h4>
    <div class="arch-components">
      <div class="arch-box" style="border-color: var(--color-section-1)">
        <strong>Browser UI</strong>
        <p>Three.js graph</p>
      </div>
    </div>
  </div>

  <div class="arch-connector">&darr; &uarr;</div>

  <div class="arch-zone">
    <h4 class="arch-zone-label">Server</h4>
    <div class="arch-components">
      <div class="arch-box" style="border-color: var(--color-section-2)">
        <strong>Express</strong>
        <p>REST + WebSocket</p>
      </div>
      <div class="arch-box" style="border-color: var(--color-section-3)">
        <strong>Scanner</strong>
        <p>File + AST parsing</p>
      </div>
    </div>
  </div>

  <div class="arch-connector">&darr; &uarr;</div>

  <div class="arch-zone">
    <h4 class="arch-zone-label">External</h4>
    <div class="arch-components">
      <div class="arch-box" style="border-color: var(--color-section-4)">
        <strong>Ollama</strong>
        <p>Local LLM</p>
      </div>
    </div>
  </div>
</div>
```

```css
.arch-diagram {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-8) 0;
}
.arch-zone {
  width: 100%;
  max-width: var(--content-width);
  background: var(--color-surface);
  border-radius: var(--radius-md);
  padding: var(--space-4) var(--space-5);
  box-shadow: var(--shadow-sm);
}
.arch-zone-label {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  margin: 0 0 var(--space-3);
}
.arch-components {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.arch-box {
  flex: 1;
  min-width: 140px;
  padding: var(--space-3) var(--space-4);
  border: 2px solid;
  border-radius: var(--radius-sm);
  text-align: center;
}
.arch-box strong {
  display: block;
  font-size: var(--text-sm);
  font-family: var(--font-display);
}
.arch-box p {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}
.arch-connector {
  font-size: var(--text-xl);
  color: var(--color-text-muted);
  letter-spacing: 0.3em;
}
```

---

## Comparison Table

For "what makes this different" or "before/after" comparisons.

```html
<div class="comparison-table animate-in">
  <table>
    <thead>
      <tr>
        <th></th>
        <th>Before</th>
        <th>After</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="comp-label">First impression</td>
        <td>Wall of text</td>
        <td class="comp-highlight">Visual scroll-through</td>
      </tr>
      <tr>
        <td class="comp-label">Navigation</td>
        <td>Scroll and hunt</td>
        <td class="comp-highlight">Dot nav + keyboard shortcuts</td>
      </tr>
    </tbody>
  </table>
</div>
```

```css
.comparison-table {
  margin: var(--space-6) 0;
  overflow-x: auto;
}
.comparison-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}
.comparison-table th {
  font-family: var(--font-display);
  font-weight: 600;
  padding: var(--space-3) var(--space-4);
  text-align: left;
  border-bottom: 2px solid var(--color-border);
}
.comparison-table td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border-light);
  color: var(--color-text-secondary);
}
.comp-label {
  font-weight: 600;
  color: var(--color-text) !important;
}
.comp-highlight {
  color: var(--color-accent) !important;
  font-weight: 500;
}
```

---

## Code Blocks with Labels

For technical snippets from the plan (CLI commands, config examples, etc.).

```html
<div class="labeled-code animate-in">
  <span class="code-label">CLI Usage</span>
  <pre><code>$ npm install -g codeorb
$ codeorb ~/my-project

  codeorb v1.0.0
  Starting local server...
  Open http://localhost:3333</code></pre>
</div>
```

```css
.labeled-code {
  position: relative;
  margin: var(--space-6) 0;
}
.code-label {
  position: absolute;
  top: var(--space-2);
  right: var(--space-3);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(205, 214, 244, 0.4);
  z-index: 1;
}
```

---

## Hero Section

The opening section of every breakdown. Project name, description, and key stats.

```html
<section class="section hero-section" id="section-hero" style="background: var(--color-bg)">
  <div class="section-content">
    <div class="hero-content animate-in">
      <h1 class="hero-title">Project Name</h1>
      <p class="hero-description">One-line description of what this project does and why it matters.</p>
      <div class="stat-badges">
        <!-- stat badges here -->
      </div>
    </div>
  </div>
</section>
```

```css
.hero-section {
  display: flex;
  align-items: center;
}
.hero-title {
  font-family: var(--font-display);
  font-size: var(--text-5xl);
  font-weight: 800;
  line-height: var(--leading-tight);
  margin: 0 0 var(--space-4);
  color: var(--color-text);
}
.hero-description {
  font-size: var(--text-xl);
  color: var(--color-text-secondary);
  line-height: var(--leading-normal);
  margin: 0 0 var(--space-8);
  max-width: 600px;
}
```

---

## Question Cards

Every question the plan raises becomes a card the reader answers **in the page**: questions for the spec owner
(`AQ-nn`), clarification register rows (`Q<#>`), `[NEEDS CLARIFICATION]` markers, "Open questions" lists, and
unknowns the plan states as questions. Answers share the review state: they autosave, go into the feature's
clarification register and the page on **Save**, and into **Copy for Clarify** and **Copy Review** (see Review System).

**Pick the answer field per question:**

| The question asks for | `data-answer` | Field |
|---|---|---|
| A short value: a number, date, name, ID, single term | `input` | one-line `<input class="answer-input">` |
| Anything else: a decision, rule, reason, list (**default**) | `rich` | rich-text editor: bold, italic, bulleted and numbered lists |

- **Options in the source** (A / B / C, a recommended option): add `.question-options` chips above the field; the
  field then holds the reason or detail.
- **Already answered in the source**: show the recorded answer in `.question-recorded`, add `is-answered` and
  `data-recorded="true"` to the card, and keep the field with the placeholder "Add a note on this answer...".
- **Never pre-fill a field** with an answer the source doesn't record.
- **Register row** (`data-reg`): only when `ANSWER_TARGET` is `'register'` (see Review JavaScript) — give each card the number of its row in the feature's `clarification_register.md`: `Q12` → `data-reg="12"`; a plan
  question handed to the spec owner as a register row (`AQ-03` … "as register row Q25") → `data-reg="25"`. Read the
  number from the register or the plan; never guess it. A question with no register row (an `AQ-nn` not yet handed
  over, a `[NEEDS CLARIFICATION]` marker) has no `data-reg`: Save can't file it, and Copy for Clarify carries it.
- **Answering as**: when `ANSWER_TARGET` is `'register'` or `'plan'`, put one `.answerer` field at the top of the
  questions (first card's section, or the Questions section). Save writes its value as the register's `User`, or
  beside each answer in the plan; it is remembered per browser. For `'plan'`, its placeholder is "Your name or email —
  recorded with each answer in the plan".
- **Placement**: one "Questions" section near the end, or each card inside the section the question belongs to when
  the plan ties it there. The hero shows the number of open questions as a stat badge.

**HTML — answering as** (once, above the first question card):
```html
<label class="answerer">
  <span class="answerer-label">Answering as</span>
  <input class="answerer-input" id="answererInput" type="text" dir="auto" autocomplete="email"
         placeholder="Your name or email — recorded as User in the register">
</label>
```

**HTML — rich text (default):**
```html
<div class="question-list">
  <div class="question-card" data-qid="AQ-01" data-answer="rich" data-reg="25">
    <div class="question-head">
      <span class="question-id">AQ-01</span>
      <span class="question-owner">PO</span>
      <span class="question-status"><span class="q-open">Open</span><span class="q-answered">Answered</span></span>
    </div>
    <p class="question-text">Should a deactivated user's open sessions end immediately?</p>
    <p class="question-why">Decides whether deactivation can cut someone off mid-task.</p>

    <!-- only when the source lists options -->
    <div class="question-options" role="radiogroup" aria-label="Proposed options">
      <button type="button" class="question-option" data-choice="A" role="radio" aria-checked="false">A — End immediately <span class="question-rec">Recommended</span></button>
      <button type="button" class="question-option" data-choice="B" role="radio" aria-checked="false">B — End at the next request</button>
    </div>

    <div class="answer-editor">
      <div class="answer-toolbar" role="toolbar" aria-label="Formatting">
        <button type="button" class="answer-tool" data-cmd="bold" aria-label="Bold"><b>B</b></button>
        <button type="button" class="answer-tool" data-cmd="italic" aria-label="Italic"><i>I</i></button>
        <button type="button" class="answer-tool" data-cmd="insertUnorderedList" aria-label="Bulleted list">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/></svg>
        </button>
        <button type="button" class="answer-tool" data-cmd="insertOrderedList" aria-label="Numbered list">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6h11"/><path d="M10 12h11"/><path d="M10 18h11"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>
        </button>
        <button type="button" class="answer-tool" data-cmd="removeFormat" aria-label="Clear formatting">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M5 20h6"/><path d="M13 4 8 20"/><path d="m15 15 5 5"/><path d="m20 15-5 5"/></svg>
        </button>
      </div>
      <div class="answer-rich" contenteditable="true" role="textbox" aria-multiline="true" dir="auto"
           aria-label="Answer to AQ-01" data-placeholder="Type your answer..."></div>
    </div>
  </div>
</div>
```

**HTML — one-line input** (same card, the editor replaced by):
```html
<input class="answer-input" type="text" dir="auto" aria-label="Answer to Q12" placeholder="Type your answer...">
```

**HTML — answered in the source** (card attributes and the extra block):
```html
<div class="question-card is-answered" data-qid="AQ-02" data-answer="rich" data-recorded="true">
  <!-- head, text -->
  <div class="question-recorded"><span class="question-recorded-label">Recorded answer</span>Keep both lists (Q45).</div>
  <!-- editor, with data-placeholder="Add a note on this answer..." -->
</div>
```

**CSS:** in `assets/review-system.css` — `scripts/page-tool.mjs` inserts it at the stylesheet's
`/* @visualplanner:review-css */` placeholder; never retype it.

The JS for question cards is part of **Review JavaScript** below.

---

## Review System

Every section gets a review toolbar: thumbs up/down and a comment. The answers to the question cards share the same
state. Three buttons act on it:

- **Save** — in the nav header, beside the language toggle; `Ctrl+S` / `⌘S` does the same. It **never creates a new
  file**. The first Save asks for the folder once (the folder that holds the page and the source document — for
  `register`, the feature folder `FEATURE_DIR`, which also holds the register); the folder is remembered, so later
  Saves are silent. Then it:
  1. writes the answers to the destination the user chose before the build (`ANSWER_TARGET`):
     - `'register'`: each answer to its row in `clarification_register.md` (`data-reg`): Answer, Status `Answered`,
       User (Answering as), Updated in Spec `No`, Last Updated Date. Only an `Open` row is filled, or a row this page
       filled before whose answer is not yet in the spec; any other row is left for `/speckit-clarify`;
     - `'plan'`: every answered question into the managed "Answers to Questions" block at the end of `SOURCE_FILE`
       (appended on the first Save; later Saves replace this page's entries by question ID and keep the rest; nothing
       outside the markers changes; two start markers, or a start without an end, and the plan is not written);
     - `'none'`: nowhere;
  2. overwrites the page itself in that folder, with every reaction, comment and answer inside, so it reopens, or is
     sent on, with them. If the page is not in that folder, it is not written (nothing new is created).

  The toast then says where the answers went (and, for `register`, to run `/speckit-clarify`, so the spec owner
  applies them to `spec.md`). Writing files needs Chrome or Edge; another browser shows a toast pointing to Copy for
  Clarify.
- **Copy for Clarify** — floating bottom-right, shown once a question has an answer. Copies only the questions and
  their answers, starting with `/speckit-clarify` and the feature folder, ready to paste straight into the chat.
- **Copy Review** — floating bottom-right. Copies all feedback (sections and answers) as markdown, ready to paste
  into Claude.

Everything also autosaves to `localStorage` as the reader types; a dot on Save shows feedback not yet saved.

**IMPORTANT:** The review system, the Save button and the question cards' JS are REQUIRED in every generated HTML
file. They are not optional.

### Review Toolbar (one per section)

Appears at the bottom of each section. Minimal, clean, dark-themed (Claude-style).

**HTML — add inside each `<section class="section" id="section-N">`, after `.section-body`.** `data-section` must
equal the section's `id`:
```html
<div class="review-bar" data-section="section-N">
  <div class="review-actions">
    <button class="review-btn review-up" onclick="setReaction(this, 'up')" aria-label="Thumbs up">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/>
      </svg>
    </button>
    <button class="review-btn review-down" onclick="setReaction(this, 'down')" aria-label="Thumbs down">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z"/>
      </svg>
    </button>
    <button class="review-btn review-comment-btn" onclick="toggleComment(this)" aria-label="Add comment">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </button>
  </div>
  <div class="review-comment-box" style="display:none">
    <textarea class="review-textarea" placeholder="Leave a note about this section..." rows="2" oninput="saveComment(this)"></textarea>
  </div>
</div>
```

**CSS:** in `assets/review-system.css` — `scripts/page-tool.mjs` inserts it at the stylesheet's
`/* @visualplanner:review-css */` placeholder; never retype it.

### Save Button (nav header)

**HTML — in `.nav-inner`, after `.nav-dots`.** Save comes first in `.nav-actions`; in a bilingual page the language
toggle follows it (see `arabic-egyptian.md`). The `title` / `aria-label` follow `ANSWER_TARGET` — `'register'`: as
below; `'plan'`: "Save answers into the plan and comments into this page"; `'none'`: "Save comments and answers into
this page" (each with " (Ctrl+S)" in the title):
```html
<div class="nav-actions">
  <button class="save-btn" id="saveReviewBtn" type="button"
          title="Save answers to the clarification register and comments into this page (Ctrl+S)"
          aria-label="Save answers to the clarification register and comments into this page">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>
    </svg>
    <span class="save-label">Save</span>
    <span class="save-dot" aria-hidden="true"></span>
  </button>
  <!-- bilingual only: the language toggle -->
</div>
```

**HTML — the saved-state holder**, immediately before the main `<script>`. The main `<script>` is the **last
element of `<body>`**, so the page snapshot Save writes back holds the whole page:
```html
<script type="application/json" id="vp-saved-state">{}</script>
<script>
  (function () { /* ... */ })();
</script>
</body>
```

**CSS:** in `assets/review-system.css` — `scripts/page-tool.mjs` inserts it at the stylesheet's
`/* @visualplanner:review-css */` placeholder; never retype it.

### Floating Copy Buttons (Copy for Clarify, Copy Review)

Stacked at the bottom-right of the viewport. **Copy for Clarify** shows the number of answered questions and copies
only the questions with their answers, as a `/speckit-clarify` message to paste into the chat. **Copy Review** shows
the number of sections and questions with feedback and copies the whole review. The toast is shared by both and by
Save; the JS sets its text. A page with no question cards leaves out Copy for Clarify.

**HTML — add before the saved-state holder:**
```html
<div class="float-actions">
  <button class="copy-review-btn copy-answers-btn" id="copyAnswersBtn" onclick="copyAnswers()" style="display:none"
          title="Copy the questions and answers to paste into the chat">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>
    </svg>
    <span>Copy for Clarify</span>
    <span class="review-count" id="answerCount">0</span>
  </button>
  <button class="copy-review-btn" id="copyReviewBtn" onclick="copyReview()" style="display:none">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
    </svg>
    <span>Copy Review</span>
    <span class="review-count" id="reviewCount">0</span>
  </button>
</div>

<div class="toast" id="toast" role="status" aria-live="polite"></div>
```

**CSS:** in `assets/review-system.css` — `scripts/page-tool.mjs` inserts it at the stylesheet's
`/* @visualplanner:review-css */` placeholder; never retype it.

### Review JavaScript

**Start of the main IIFE** — these lines come first, before any other code (the snapshot must be taken before any
script changes the DOM). `PAGE_SLUG` is a fixed slug of the page: the output file name without `-breakdown.html`. It
keys the review state, and in a bilingual page the language too. `FEATURE_DIR` is the Spec Kit feature folder the
source belongs to, relative to the repository root and with forward slashes (`specs/008-audit`); `''` when the source
is not a feature, and then Copy for Clarify copies plain questions and answers. `ANSWER_TARGET` is the user's answer
to the destination gate (SKILL.md → Answer Destination): `'register'`, `'plan'` or `'none'` — never set without that
answer, and `'none'` when the user could not be asked. `SOURCE_FILE` is the source document's file name (`plan.md`),
in the same folder as the page; Save writes into it only when `ANSWER_TARGET` is `'plan'`.
```javascript
(function () {
  // Snapshot of the page as served; Save writes it back with the review state inside.
  var PRISTINE_HTML = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  var PAGE_SLUG = 'audit-testing';
  var FEATURE_DIR = 'specs/008-audit';
  var ANSWER_TARGET = 'register';   // 'register' | 'plan' | 'none' — the user's choice at the gate
  var SOURCE_FILE = 'plan.md';
  var root = document.documentElement;

  // ... language block (bilingual only), navigation, animations ...

  /* @visualplanner:review-js */
})();
```

**The rest of the review JS** — review state, section reactions and comments, question answers, Copy Review, Copy for
Clarify, Save (register / plan / page) and restore on load — is `assets/review-system.js`. Write only the placeholder
`/* @visualplanner:review-js */` as the last line inside the IIFE; `scripts/page-tool.mjs` inserts the asset there
verbatim (both languages' UI strings included). Never retype or edit it in a page.

### Clipboard Output Format

When the user clicks "Copy Review", this is what gets copied — formatted for Claude to read and act on:

```markdown
# Plan Review: CodeOrb

## The Experience
- **Reaction:** 👍
- **Comment:** "Love the build animation, this is the TikTok moment"

## Scanner Pipeline
- **Reaction:** 👎
- **Comment:** "tree-sitter too heavy, use regex first"

## Answers to Questions

### AQ-01 — Should a deactivated user's open sessions end immediately?
- **Choice:** A — End immediately
- **Answer:**

  End them, but:
  - finish an upload already running
  - log the forced sign-out

### Q12 — How many days are audit records kept?
- **Answer:**

  365
```

When the user clicks "Copy for Clarify", only the answered questions are copied, in English, as a message that runs
`/speckit-clarify` when pasted into the chat (a page with no `FEATURE_DIR` starts with
`# Answers to Questions: {title}` instead of the command line):

```markdown
/speckit-clarify Apply these answers, given in the "Audit — Plan Breakdown" breakdown by reviewer@example.com on 01-11-2026, to specs/008-audit/spec.md. Record each one in specs/008-audit/clarification_register.md first: fill its row (Q<#>), or add a row (Owner PO) for a question that has none; then update the spec and set Updated in Spec.

### AQ-03 — May an audit record be missing in these rare cases, with the failure logged?
- **Register row:** Q25
- **Choice:** A — Yes, log the failure
- **Answer:**

  Yes, as long as the saved change is never rolled back.

### Q12 — How many days are audit records kept?
- **Answer:**

  365
```

With `ANSWER_TARGET = 'plan'`, Save keeps one block at the end of `SOURCE_FILE` (appended by the first Save; each
later Save replaces only the entries of the questions this page answered, by ID, and keeps the rest):

```markdown
<!-- visualplanner:answers -->
## Answers to Questions

_Written by the Save button of the "Audit — Plan Breakdown" breakdown page. Answer in the page; edits here are replaced on the next Save._

### AQ-03 — May an audit record be missing in these rare cases, with the failure logged?
- **Answered by:** reviewer@example.com · 01-11-2026
- **Choice:** A — Yes, log the failure
- **Answer:**

  Yes, as long as the saved change is never rolled back.

<!-- /visualplanner:answers -->
```

In the register, Save writes the same answer on one line (`A — Yes, log the failure — Yes, as long as …`; list items
joined with `; `), sets Status `Answered`, User to "Answering as", Updated in Spec `No` and today's date. Applying it
to `spec.md`, and flipping Updated in Spec, is `/speckit-clarify`'s job.

### Rules
- The review toolbar MUST appear on every section (including the hero)
- The review CSS and JS come from `assets/review-system.css` / `.js`, inserted by `scripts/page-tool.mjs build`, which
  also carries a re-run's saved feedback over and checks the page before writing it; never retype them in a page
- The Save button MUST be in the nav header of every page (beside the language toggle when bilingual)
- Every question in the source MUST be a question card with an answer field (`input` or `rich`); in a Spec Kit
  feature, each card with a register row carries `data-reg`, and the page has one "Answering as" field
- Where Save writes answers is the user's choice at the gate (`ANSWER_TARGET`), never the generator's
- Save never creates a file: it fills the feature's `clarification_register.md` rows (`'register'`) or the managed
  answers block of `SOURCE_FILE` (`'plan'`), and overwrites the page in the folder picked once; with `'register'` it
  never writes `spec.md` or `plan.md` (that is `/speckit-clarify` and `/speckit-plan`), with `'plan'` it never writes
  outside the markers
- The "Copy for Clarify" button only appears after at least one question has an answer; "Copy Review" after at least
  one reaction, comment or answer
- Review state autosaves to localStorage; Save writes it into the HTML file, and the newer of the two wins on open
- Saved comments open expanded, so a reader of a saved page sees them
- The toast confirms each copy, and after Save says how many answers went into the register (and to run
  `/speckit-clarify`) or the plan, which answers were not filed, and whether the page was written
- Keep the review UI minimal and unobtrusive — it should not distract from reading the plan
- The review bar sits below the section content, separated by a thin border-top
- SVG icons are inline (no icon library dependencies)
