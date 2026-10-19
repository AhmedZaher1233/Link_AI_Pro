# Annotation fallback — Pillow method for static images

Loaded from Step 7 of SKILL.md through `annotation.md`. **Only needed when there
is no live URL for the side being annotated** (a static design image, or an
implementation supplied as screenshots). With a live URL, use the DOM-highlight
method in `annotation.md` and take coordinates from `getBoundingClientRect()` —
none of the estimation below applies.

### Python annotation script pattern

```python
from PIL import Image, ImageDraw, ImageFont
import os

EVIDENCE_DIR = f"<evidence>/{page_slug}_{lang}"
os.makedirs(EVIDENCE_DIR, exist_ok=True)
img = Image.open(f"<base>/UI-Testing/Actual-UI/{page_slug}_{lang}.png").convert("RGBA")
draw = ImageDraw.Draw(img)

RED = (224, 0, 0)
GAP = 12   # breathing room between the element and the box
WIDTH = 4  # border thickness

def draw_rect(draw, x1, y1, x2, y2, color=RED, width=WIDTH, gap=GAP):
    x1, y1, x2, y2 = x1 - gap, y1 - gap, x2 + gap, y2 + gap
    for i in range(width):
        draw.rectangle([x1-i, y1-i, x2+i, y2+i], outline=color)

def draw_badge(draw, bx, by, number, font):
    # Only for images carrying several boxes; skip on per-bug crops.
    w, h = 30, 26
    draw.rectangle([bx, by-h, bx+w, by], fill=RED)
    draw.text((bx+w//2, by-h//2), str(number), fill="white", font=font, anchor="mm")

try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
except:
    font = ImageFont.load_default()

# OVERVIEW image only — several boxes in one picture, so each needs its number.
# Per-bug crops use crop_and_annotate() below and carry NO badge.
# Each annotation: (x1, y1, x2, y2, bug_number)
annotations = [
    (0,   0,  1920,  50,  1),   # header bar full width
    (780, 230, 960, 340,  2),   # active card
    # ... etc
]

for (x1, y1, x2, y2, num) in annotations:
    draw_rect(draw, x1, y1, x2, y2)
    draw_badge(draw, x1, y1, num, font)

img.convert("RGB").save(f"{EVIDENCE_DIR}/_annotated_overview.png")
```

### Rectangle region guide per bug type (Pillow fallback)

Only needed when you have to estimate a region from a static image. With a live
URL, the element's own bounding box is the rectangle — don't consult this table.


| Bug type | Rectangle region to outline |
|---|---|
| Header / navbar color | Full header bar (x: 0 to img_width, y: 0 to navbar_height) |
| Active card color | Bounding box of the highlighted card |
| Footer background | Full footer bar region |
| Card size / padding | Bounding box of one summary card |
| Icon size | Tight box around icon inside a card |
| Filter row | Full filter row region |
| Status badge | Tight box around the badge element |
| Logo / position | Bounding box of the logo |
| Page background | A representative background strip (e.g. left margin area) |
| Shadow / border | Outline just outside the content card edge |
| Breadcrumb spacing | Region between top of card and breadcrumb text |
| RTL mirroring break | Bounding box of the mis-mirrored element (icon, nav item, field) |

- Position the badge circle at the **top-left corner** of its rectangle
- Where two rectangles are very close, offset the badge slightly outward
- Keep rectangles tight to the actual component — avoid covering unrelated UI

### CRITICAL — Verify coordinates before annotating

**If a live URL is available, take coordinates from `getBoundingClientRect()`
(Step 2C Pass 2), not from a thumbnail.** Those are the element's real pixel
coordinates, so the crop lands exactly on the right element with no estimation.
Remember to account for scroll offset if the capture was taken at a scroll
position other than the top.

The thumbnail workflow below is the fallback for **screenshot-only inputs**
(and for the design side when it's a static image).

**Always derive rectangle coordinates from the actual image, not from memory.**
Before writing annotation coordinates, generate a scaled-down thumbnail and visually
inspect it to read accurate positions:

```python
from PIL import Image
img = Image.open('/path/to/screenshot.png')
W, H = img.size
thumb = img.resize((960, int(960 * H / W)))
thumb.save(f'{SCRATCH}/thumb_check.png')   # SCRATCH = the session scratchpad dir
# Read coordinates from thumb, then multiply by (W/960) to get full-image coords
scale = W / 960
```

Use the thumbnail to identify the bounding box of each element, multiply by `scale`,
then verify by spot-checking a sample crop before generating all crops. This prevents
rectangles from landing on the wrong area of the screenshot.

### CRITICAL — Re-scan implementation coordinates independently from design

> Applies to the **Pillow fallback only**. With a live URL you take coordinates
> from `getBoundingClientRect()` (Step 2C Pass 2) or use the DOM-highlight
> method above, and none of the estimation below is needed.

**Never derive implementation coordinates by mapping from design coordinates.**
The implementation may have extra sections, collapsed panels, or layout shifts that
push elements to completely different vertical positions than in the design. For
AR (RTL), also never mirror EN coordinates by simple horizontal flip — re-scan
the AR screenshot independently, since reflow differs from a pure mirror.

Correct workflow:
1. Scan the **design** thumbnail (or use Figma node coordinates from
   `get_design_context`, if available) to find element positions → record design coords
2. Scan the **implementation** thumbnail **independently** to find the same element → record impl coords separately
3. If an extra section exists in the implementation (a section not in the design), **all elements below it will be shifted down** — re-scan everything below that section from the implementation thumbnail directly

```python
# Always spot-check EVERY crop before embedding in the report
# Save a quick preview and visually confirm the right content is captured
from PIL import Image
img = Image.open('/path/to/impl.png')

# For each bug, verify the crop actually shows the right element:
for (x1, y1, x2, y2, num) in impl_annotations:
    check = img.crop((x1-10, y1-10, x2+10, y2+10))
    check.save(f'{SCRATCH}/verify_{num}.png')
    # Inspect the verify_N.png files in the scratchpad before proceeding
```

**Save narrow horizontal strips** (100–150px tall) at regular intervals through the
implementation image to build an accurate y-position map. Never rely on a single
full-page thumbnail for precise coordinate mapping of small elements.

**For small or color-specific elements** (badges, status pills, toggle switches,
icon buttons) use pixel color detection to find exact bounding boxes rather than
estimating from thumbnails:

```python
import numpy as np
arr = np.array(Image.open(img_path).convert('RGB'))

# Example: find green badge pixels
green_mask = (arr[:,:,1] > 130) & (arr[:,:,0] < 100) & (arr[:,:,2] < 100)
rows, cols = np.where(green_mask)
if len(rows):
    print(f"Green badge: y={rows.min()}–{rows.max()}, x={cols.min()}–{cols.max()}")
```

Adapt thresholds for the color you are looking for (purple, teal, red, etc.).
Always verify the detected region with a quick `img.crop()` spot-check before
annotating. This guarantees the crop lands on the correct element even when
layout shifts have moved it far from expected coordinates.
