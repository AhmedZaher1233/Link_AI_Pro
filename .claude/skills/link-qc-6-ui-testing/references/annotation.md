# Annotating evidence (Step 7) — DOM highlight first, Pillow for static images

Loaded from Step 7 of SKILL.md. The Pillow coordinate-estimation workflow lives in annotation-fallback.md.

## Step 7 — Annotate Screenshots

Produce annotated crops of both the **design** and **implementation**
screenshots using Python + Pillow (for a no-design section, only the
implementation screenshot exists to annotate), so the Markdown report can show
each bug visually with a red box around the exact issue. Write the crops
directly into their final home:
`<evidence>/<page-slug>_<lang>/` (create the folder if
it doesn't exist). Source images come from
`<base>/UI-Testing/Expected-UI/<page-slug>_<lang>.png` (design side) and
`<base>/UI-Testing/Actual-UI/<page-slug>_<lang>.png` or its `_segments/`
folder (implementation side).

### Preferred method for the implementation side — highlight in the page, then capture

When the implementation is a live URL, **draw the box in the DOM before taking
the screenshot** instead of cropping and annotating afterwards. You already
have the element from Step 2C Pass 2, so the box lands on it exactly — no
thumbnail estimation, no coordinate arithmetic, and it stays correct even if
the layout shifted.

**Box style — match this exactly:** a **thick, bright red, square-cornered**
outline sitting a clear gap away from the element, so the box reads as an
annotation over the UI rather than as part of it. Specifically: `4px solid
#e00000`, **no border radius**, and ~12px of breathing room on every side.
Never tint or fill the region — the UI underneath must stay fully readable.

```js
// browser_evaluate — highlight one element. Inline the selector and the badge
// number (null for a per-bug crop): browser_evaluate passes no arguments.
() => {
  const sel = '.toolbar > button.export';   // ← the element from Pass 2
  const num = null;                          // ← 1, 2, 3 … only on an overview image
  document.querySelectorAll('.__qa_hl').forEach(n => n.remove());
  const el = document.querySelector(sel);
  if (!el) return 'not found';
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const GAP = 12, W = 4;
  const mk = (styles, text) => {
    const d = document.createElement('div');
    d.className = '__qa_hl';
    Object.assign(d.style, {
      position: 'absolute', pointerEvents: 'none', zIndex: '2147483647',
      ...styles,
    });
    if (text) d.textContent = text;
    document.body.appendChild(d);
    return d;
  };
  mk({
    left:  (r.left + scrollX - GAP - W) + 'px',
    top:   (r.top  + scrollY - GAP - W) + 'px',
    width:  (r.width  + GAP * 2) + 'px',
    height: (r.height + GAP * 2) + 'px',
    border: `${W}px solid #e00000`,
    borderRadius: '0',
  });
  // Number badge ONLY when one image carries several boxes; a per-bug crop
  // needs no number — the file name already identifies the bug.
  if (num != null) {
    mk({
      left: (r.left + scrollX - GAP - W) + 'px',
      top:  (r.top  + scrollY - GAP - W - 26) + 'px',
      height: '26px', padding: '0 10px',
      background: '#e00000', color: '#fff', font: 'bold 15px sans-serif',
      display: 'flex', alignItems: 'center',
    }, String(num));
  }
  return r;
}
```

Then take the screenshot, and **remove the highlight afterwards**
(`document.querySelectorAll('.__qa_hl').forEach(n => n.remove())`) so it never
leaks into a later capture — a leftover red box in an unrelated screenshot is
worse than no box at all.

Capture the viewport with the element centred rather than the element alone:
the surrounding context is what makes a bug screenshot readable.

Use the Pillow method below for the **design side** (a static image has no DOM),
and for the implementation whenever DOM injection isn't possible.

### Annotation rules (Pillow method — static images)

Requires Python with Pillow (and `numpy` for the colour-detection technique).
**Verify the interpreter before relying on it** — the command differs by
environment (`python`, `python3`, or `py` on Windows); skill 1's
`validate-setup.mjs` reports it as the `Python + Pillow` row and
`/sync-skills --tools` installs Pillow + numpy when Python is present. If
Python or Pillow isn't available, fall back to the DOM-highlight method above
for the implementation side; for a static design image, embed the **whole**
design image (or the Figma `get_screenshot` of the specific node, which needs
no cropping) in the bug's Expected cell and describe the region precisely in
the bug text — never skip the evidence entirely.

Match the DOM-highlight style above so both sides of a bug look identical:

- Draw a **bright red rectangle** around the issue area — **4px border,
  square corners, no fill**, offset ~12px outward from the element so it
  frames the element rather than touching it
- Use `#e00000`
- Add a **numbered red badge** (white number on a solid red block, at the
  rectangle's top-left) **only when one image carries several boxes**. A
  per-bug crop needs no number — its file name already identifies the bug
- When numbering, use the bug index numbers (1, 2, 3 …) matching the report
- For bugs only visible in one image (e.g. an extra element, or any no-design
  bug that has no design side at all), annotate only the relevant image and
  use "—" for the other side in the report

### Python annotation script pattern and coordinate estimation

**See `references/annotation-fallback.md`** for the Pillow script, the
rectangle-region guide per bug type, and the coordinate-verification workflow.
Only needed for a static image; skip it entirely when the side you are
annotating has a live URL.

### Per-bug crops — one pair of images per issue

Generate a **separate cropped PNG per bug** rather than one big annotated
screenshot per side. Each crop shows only the relevant component with context,
sized to embed directly in that bug's write-up in the Markdown report.

Every crop goes in
`<evidence>/<page-slug>_<lang>/` and is named
`bug<NN>_expected.png` (design side) / `bug<NN>_actual.png` (implementation
side) — e.g. `evidence/dashboard_ar/bug01_actual.png`. The page and language
live in the folder name, so they are **not** repeated in the file name.
For a no-design heuristic bug there is no `_expected` image — only
`bug<NN>_actual.png` exists; the report shows "—" for the missing design side.

```python
PADDING = 55  # pixels of context around each rectangle

def crop_and_annotate(img_path, rect, num, side, padding=PADDING):
    # side is "expected" (design) or "actual" (implementation)
    img = Image.open(img_path).convert("RGB")
    W, H = img.size
    x1, y1, x2, y2 = rect

    # Pad and clamp to image bounds
    cx1 = max(0, x1 - padding)
    cy1 = max(0, y1 - padding)
    cx2 = min(W, x2 + padding)
    cy2 = min(H, y2 + padding)
    cropped = img.crop((cx1, cy1, cx2, cy2))

    # Translate rect into cropped coordinate space
    rx1, ry1 = x1 - cx1, y1 - cy1
    rx2, ry2 = x2 - cx1, y2 - cy1

    draw = ImageDraw.Draw(cropped)
    draw_rect(draw, rx1, ry1, rx2, ry2)

    # NO badge here: this is a per-bug crop and the file name already
    # identifies the bug. Badges belong only on an image carrying several boxes.

    cropped.save(f"{EVIDENCE_DIR}/bug{num:02d}_{side}.png")
```

- `EVIDENCE_DIR` is `<evidence>/<page_slug>_<lang>` —
  create it with `os.makedirs(..., exist_ok=True)` before saving
- For wide full-width elements (headers, footers, filter rows), use `PADDING = 30` to keep
  crops reasonably sized
- For multi-page or multi-language audits, each page+language gets its **own**
  evidence folder, so `bug01_actual.png` can safely repeat across folders
  without collision

