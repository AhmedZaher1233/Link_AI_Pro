# Egyptian Arabic — Second Language Reference

Read this only when the breakdown is bilingual (English + Egyptian Arabic). It covers how to write the Arabic,
the UI strings, and the HTML/CSS/JS for the language switch and the right-to-left layout.

## Table of Contents
1. [Writing Style](#writing-style)
2. [Worked Example](#worked-example)
3. [UI Strings](#ui-strings)
4. [Bilingual Markup](#bilingual-markup)
5. [Fonts](#fonts)
6. [Language Toggle](#language-toggle)
7. [Right-to-Left CSS](#right-to-left-css)
8. [Language JS](#language-js)
9. [Review System in Two Languages](#review-system-in-two-languages)
10. [Bilingual Checklist](#bilingual-checklist)

---

## Writing Style

Write **Egyptian colloquial Arabic (عامية مصرية)**, the way you'd explain the plan to a colleague at work. Not
Modern Standard Arabic, and not a word-for-word translation of the English.

**Do:**
- Use everyday Egyptian words: ده / دي / دول، مين، إيه، إمتى، فين، ليه، إزاي، مش، لأ، أيوه، عشان، لازم، لسه، كده، بس، حاجة، دلوقتي.
- Use Egyptian verb forms: بيسجل، بيتسجل، هيتسجل، اتغيرت، اتعمل، بيطلبها، متضيعش، محدش يقدر.
- Turn headings into short questions when it helps: «النظام بيغطي إيه؟»، «هل فيه شاشة؟»، «مين بيعمل إيه؟».
- Keep sentences short: one idea per sentence. Lists stay lists.
- Open each part with the "what" in one plain sentence («النظام ده وظيفته إنه…»), then the details.
- Say exceptions plainly: «لكن لو…، ده بيتعتبر…».

**Don't:**
- Don't use stiff MSA connectors: «يتم»، «حيث»، «إذ»، «بناءً عليه»، «يُرجى»، «وفقًا لـ». Say «بيتعمل»، «عشان»، «فـ»، «زي ما».
- Don't add, drop or soften facts. The Arabic says exactly what the English says: same numbers, same IDs, same scope,
  same open items. "Faithful to Source" applies to both languages.
- Don't translate identifiers.

**Keep in English (Latin script), unchanged:**
- IDs and references: `US3-SC2`, `TC-AUD-001`, `Q2`, `AQ-03`, `R4`, `CON-002`, `REQ-US1-SC1-1`.
- Code, class, method, table, queue, file and field names: `AuditedOperationAspectIT`, `outbox_event`, `audit.records`,
  `@Transactional`, `plan.md`.
- Product and technology names: RabbitMQ, PostgreSQL, Testcontainers, Maven, Keycloak, Claude.
- Status values written in the source as code: `PENDING`, `SENT`, `ADDED`.

**Translate:** business roles and words a business reader sees («موظف»، «مدير النظام»، «بوابة الإدارة الداخلية»،
«الهيئة»، «سجل التدقيق»), headings, explanations, labels, button text.

**Numbers:** Western digits (0–9), as in the example (`Q2 – Q15 – Q19`, `1.`، `2.`). Not Arabic-Indic digits.

**Arrows in Arabic prose** point the reading direction: write «أ ← ب» for "A → B". Arrows inside code or IDs stay
as they are (they sit in a left-to-right span).

---

## Worked Example

This is the target tone (from a spec explanation the user supplied). Match its voice, sentence length and use of
questions; don't copy its content into other plans.

> **أولًا: الفكرة العامة**
>
> النظام ده وظيفته إنه يسجل أي عملية إضافة أو تعديل بيانات بيعملها موظف من خلال بوابة الإدارة الداخلية للهيئة.
>
> يعني لو موظف ضاف بيانات جديدة أو عدّل بيانات موجودة، النظام لازم يحتفظ بمعلومات توضح:
>
> - مين الموظف اللي عمل العملية؟
> - عمل إضافة ولا تعديل؟
> - إيه البيانات اللي اتغيرت؟
> - كانت قيمتها إيه قبل التعديل وبقت إيه بعده؟
> - العملية حصلت إمتى؟
>
> والهدف إننا نقدر نرجع لأي تغيير حصل ونعرف تفاصيله.
>
> **النظام بيغطي إيه؟**
>
> 1. **تسجيل الإضافات والتعديلات** — أي موظف يضيف بيانات أو يعدّل بيانات موجودة، النظام يسجل العملية وتفاصيلها.
> 2. **حماية سجلات التدقيق** — النظام لازم يضمن إن السجلات محفوظة، ومحدش يقدر يعدّلها أو يمسحها، وإنها متضيعش حتى لو حصلت مشكلة تقنية.
>
> **هل فيه شاشة لسجل التدقيق؟**
>
> لأ، الإصدار ده مفيهوش شاشة لعرض السجلات أو البحث فيها. النظام بيسجل العمليات تلقائيًا، ولو حد محتاج يطلع على السجلات، بيطلبها من الفريق التقني.
>
> **العمليات اللي مش هتتسجل**
>
> مش كل حاجة الموظف بيعملها هتتسجل في سجل التدقيق. الحاجات التالية خارج النطاق:
>
> - **عرض البيانات:** لو موظف فتح صفحة أو شاف بيانات، حتى لو كانت بيانات شخصية أو حساسة، مش هيتسجل.
> - **حذف سجل بالكامل:** لو موظف حذف سجل كامل، الحذف مش هيتسجل. ونفس الكلام على تغيير كلمات المرور وإدارة حسابات الموظفين. لكن لو الموظف شال عنصر من قائمة جوه نموذج، ده بيتعتبر تعديل على النموذج، ولازم يتسجل.
> - **تسجيل الدخول والخروج:** عمليات دخول وخروج الموظفين مش بتتسجل، وكذلك الوصول لسجلات التدقيق نفسها.
> - **إجراءات الطلبات:** زي بدء دراسة طلب، أو إرجاعه لاستكمال بيانات، أو تسجيل الرد النهائي، أو قفله لأنه خارج اختصاص الهيئة. الإجراءات دي ليها سجل خاص بيها في الطلب نفسه.
> - **تعديلات نظام إدارة المحتوى:** زي تغيير محتوى الصفحة الرئيسية أو تذييل البوابة.
> - **تعديلات مستخدمي البوابة:** لو المستخدم عدّل بياناته بنفسه من خلال بوابة الهيئة، التعديل مش هيتسجل هنا.
> - **التغييرات التلقائية:** لو النظام غيّر بيانات لوحده من غير تدخل موظف، التغيير مش هيتسجل هنا، لكنه بيتتبع من خلال الخاصية المسؤولة عنه.
>
> **ملاحظة مراجعة — لسه معلّقة**
>
> النطاق الحالي متوافق مع الإجابات الموجودة في: Q2 – Q15 – Q19. لكن فيه إجابات قديمة في: Q1 – Q3 – Q4 – Q5.

What it shows: a one-line "what" first, questions as headings, short lists, exceptions stated plainly («لكن لو…»),
IDs (`Q2`) left in English, Western digits, and an open item called out as «لسه معلّقة».

---

## UI Strings

Use these for the page chrome so every breakdown says the same thing.

| English | Egyptian Arabic |
|---|---|
| Overview | نظرة عامة |
| Section | جزء |
| Click to expand | دوس عشان تشوف التفاصيل |
| Save | احفظ |
| Save answers to the clarification register and comments into this page (Ctrl+S) | احفظ الإجابات في سجل الأسئلة والتعليقات جوه الصفحة (Ctrl+S) |
| Copy for Clarify | انسخ للـ Clarify |
| Copy the questions and answers to paste into the chat | انسخ الأسئلة والإجابات عشان تلصقها في الشات |
| Answering as | بتجاوب باسم |
| Your name or email — recorded as User in the register | اسمك أو إيميلك — بيتسجل كـ User في السجل |
| Your name or email — recorded with each answer in the plan | اسمك أو إيميلك — بيتسجل مع كل إجابة في الخطة |
| Save answers into the plan and comments into this page (Ctrl+S) | احفظ الإجابات في الخطة والتعليقات جوه الصفحة (Ctrl+S) |
| Save comments and answers into this page (Ctrl+S) | احفظ التعليقات والإجابات جوه الصفحة (Ctrl+S) |
| Open (question) | لسه مفتوح |
| Answered | اتجاوب |
| Recorded answer | الإجابة المتسجلة |
| Recommended | المقترح |
| Proposed options | الاختيارات المقترحة |
| Type your answer... | اكتب إجابتك... |
| Add a note on this answer... | ضيف ملاحظة على الإجابة دي... |
| Answer to … | إجابة … |
| Formatting | التنسيق |
| Bold / Italic | عريض / مائل |
| Bulleted list / Numbered list | قائمة نقط / قائمة بأرقام |
| Clear formatting | شيل التنسيق |
| Thumbs up | عاجبني |
| Thumbs down | مش عاجبني |
| Add comment | ضيف تعليق |
| Leave a note about this section... | اكتب ملاحظتك على الجزء ده... |
| Copy Review | انسخ المراجعة |
| Review copied to clipboard — paste into Claude | المراجعة اتنسخت — الصقها في Claude |
| Plan Review | مراجعة الخطة |
| Reaction | رأيك |
| Comment | تعليق |
| Reading progress | إنت وصلت لفين |
| Switch language | تغيير اللغة |
| Key decision | قرار مهم |
| Constraint / Risk | قيد / خطر |
| Good to know | معلومة مفيدة |
| Open / pending | لسه معلّق |
| Out of scope | خارج النطاق |
| Done / covered | متغطي |
| Blocked by … | متوقف على … |
| Runnable now | ينفع يشتغل دلوقتي |
| Manual only | يدوي بس |

---

## Bilingual Markup

Every visible text exists twice, marked with `data-lang`. Only the active language shows.

**Short text** (titles, labels, badges): two spans inside the element.
```html
<h1 class="section-title"><span data-lang="en">Acceptance test cases</span><span data-lang="ar">حالات الاختبار</span></h1>
```

**Blocks** (paragraphs, lists, callout bodies): two sibling elements.
```html
<p data-lang="en">Most cases wait for a back-office feature that uses <code>tda-audit-client</code>.</p>
<p data-lang="ar">أغلب الحالات مستنية خاصية في بوابة الإدارة تستخدم <code>tda-audit-client</code>.</p>
```

**Big tables:** translate per cell with two spans, or, when most cells are prose, wrap the whole table twice
(`<div data-lang="en">…</div><div data-lang="ar">…</div>`). Cells holding only IDs, code or numbers are written
once, with no `data-lang`.

**Language-neutral content** (IDs, code, numbers, stat values, test class names) is written once and shows in both.

**Attributes** (placeholder, aria-label, tooltip, title) can't hold two spans. List them in `data-i18n` and give
one value per language; the JS sets the attribute on each switch:
```html
<textarea class="review-textarea"
  data-i18n="placeholder,aria-label"
  data-en-placeholder="Leave a note about this section..." data-ar-placeholder="اكتب ملاحظتك على الجزء ده..."
  data-en-aria-label="Comment on this section" data-ar-aria-label="تعليقك على الجزء ده"></textarea>

<button class="nav-dot" data-target="section-4"
  data-i18n="data-tooltip,aria-label"
  data-en-data-tooltip="Acceptance test cases" data-ar-data-tooltip="حالات الاختبار"
  data-en-aria-label="Section 4" data-ar-aria-label="الجزء 4"></button>
```

**The `<html>` element** carries the opening language and both page titles:
```html
<html lang="en" dir="ltr" data-default-lang="en"
      data-title-en="Audit — Testing" data-title-ar="التدقيق — الاختبارات">
```
For "opens in Arabic" use `lang="ar" dir="rtl" data-default-lang="ar"`.

---

## Fonts

Add the Arabic fonts to the same Google Fonts request style as the design system (still the only external
dependency):
```html
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;700;800&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">
```
```css
html[lang="ar"] {
  --font-display: 'Cairo', 'Bricolage Grotesque', sans-serif;
  --font-body:    'IBM Plex Sans Arabic', 'DM Sans', sans-serif;
}
```
`--font-mono` stays JetBrains Mono: code is English.

---

## Language Toggle

In `.nav-actions` (inside `.nav-inner`, after `.nav-dots`), right after the Save button. It shows the name of the
*other* language.
```html
<button class="lang-toggle" id="langToggle" type="button" aria-pressed="false"
  data-i18n="aria-label" data-en-aria-label="Switch to Arabic" data-ar-aria-label="التحويل للإنجليزي">
  <span data-lang="en" lang="ar">عربي</span>
  <span data-lang="ar" lang="en">English</span>
</button>
```
```css
.lang-toggle {
  font-family: var(--font-body); font-size: var(--text-sm); font-weight: 600;
  padding: var(--space-1) var(--space-4); border-radius: var(--radius-full);
  border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text);
  cursor: pointer; flex-shrink: 0; transition: all var(--duration-fast);
}
.lang-toggle:hover { border-color: var(--color-accent); color: var(--color-accent); }
.lang-toggle [lang="ar"] { font-family: 'IBM Plex Sans Arabic', sans-serif; }
.lang-toggle [lang="en"] { font-family: 'DM Sans', sans-serif; }
```

---

## Right-to-Left CSS

**1. Show only the active language.**
```css
html[lang="en"] [data-lang="ar"],
html[lang="ar"] [data-lang="en"] { display: none !important; }
```

**2. Write direction-dependent rules with logical properties**, so one rule works in both directions. When copying
from `design-system.md` and `interactive-elements.md`, change:

| Element | Physical (from the references) | Write instead |
|---|---|---|
| `.callout-accent/-info/-warning/-success` | `border-left: 4px solid …` | `border-inline-start: 4px solid …` |
| `.step-card` | `border-left: 3px solid …` | `border-inline-start: 3px solid …` |
| `.flow-vertical` | `padding-left` | `padding-inline-start` |
| `.flow-v-line` | `margin-left: 17px` | `margin-inline-start: 17px` |
| `.ft-folder, .ft-file` | `border-left`, `margin-left` | `border-inline-start`, `margin-inline-start` |
| `.ft-folder:first-child` | `border-left: none; margin-left: 0` | `border-inline-start: none; margin-inline-start: 0` |
| `.ft-desc`, `.ft-children` | `margin-left` | `margin-inline-start` |
| `.expandable-header`, `.comparison-table th` | `text-align: left` | `text-align: start` |
| `.float-actions`, `.toast` | `right: …` | `inset-inline-end: …` |
| nav-dot tooltip | `right: …` | `inset-inline-end: …` |

**3. Mirror the flow arrows.** Flex rows already run right-to-left; the `→` glyph must point left too.
```css
[dir="rtl"] .flow-arrow { transform: scaleX(-1); }
@media (max-width: 768px) {
  [dir="rtl"] .flow-arrow { transform: rotate(90deg); }   /* stacked: still points down */
}
```

**4. Keep code and IDs left-to-right inside Arabic text.**
```css
code, pre, .ltr { direction: ltr; unicode-bidi: isolate; }
pre { text-align: left; }
```
Wrap a bare ID or file name that isn't in `<code>` in `<bdi>` or `<span class="ltr">` (e.g. `<bdi>TC-AUD-010</bdi>`).

**5. Arabic typography.** Arabic letters join, so no letter-spacing; labels styled in the mono font switch to the
body font when they hold Arabic; Arabic needs a little more line height.
```css
html[lang="ar"] body * { letter-spacing: 0 !important; }
html[lang="ar"] body { line-height: 1.75; }
html[lang="ar"] .stat-label, html[lang="ar"] .flow-step-label, html[lang="ar"] .expandable-hint,
html[lang="ar"] .arch-zone-label, html[lang="ar"] .pill { font-family: var(--font-body); }
```

---

## Language JS

Inside the main IIFE, after its opening lines (`PRISTINE_HTML`, `PAGE_SLUG`, `root`, see `interactive-elements.md`
→ Review JavaScript) and **before** the review system. `PAGE_SLUG` keys both the language and the review state, so
switching language never loses feedback.
```javascript
// --- LANGUAGE ---
var LANG_KEY = 'visualplanner-lang-' + PAGE_SLUG;

function applyLang(lang) {
  root.lang = lang;
  root.dir = lang === 'ar' ? 'rtl' : 'ltr';
  var title = root.getAttribute('data-title-' + lang);
  if (title) document.title = title;
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    el.getAttribute('data-i18n').split(',').forEach(function (attr) {
      attr = attr.trim();
      var value = el.getAttribute('data-' + lang + '-' + attr);
      if (value !== null) el.setAttribute(attr, value);
    });
  });
  var btn = document.getElementById('langToggle');
  if (btn) btn.setAttribute('aria-pressed', lang === 'ar' ? 'true' : 'false');
}

function initialLang() {
  var fromUrl = new URLSearchParams(location.search).get('lang');
  if (fromUrl === 'en' || fromUrl === 'ar') return fromUrl;
  try {
    var saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'ar') return saved;
  } catch (e) { /* storage unavailable */ }
  return root.getAttribute('data-default-lang') || 'en';
}

applyLang(initialLang());
document.getElementById('langToggle').addEventListener('click', function () {
  var next = root.lang === 'ar' ? 'en' : 'ar';
  applyLang(next);
  try { localStorage.setItem(LANG_KEY, next); } catch (e) { /* storage unavailable */ }
});
```
`?lang=ar` / `?lang=en` in the URL opens a given language, handy when sharing the file.

---

## Review System in Two Languages

The review JS (`assets/review-system.js`, inserted by the page tool) is already bilingual: one state key per page (`PAGE_SLUG`, shared by
both languages), and Copy Review, the toast and the Save messages use the `UI` strings of the language on screen
(`visibleText` takes only the on-screen half of a two-language title). The markup needs:

- **Review buttons and textarea:** `aria-label` and `placeholder` through `data-i18n` (UI Strings above).
- **Copy labels:** two spans each («Copy Review» / «انسخ المراجعة», «Copy for Clarify» / «انسخ للـ Clarify»), and
  Copy for Clarify's `title` through `data-i18n`. What Copy for Clarify copies is always English (it goes into the
  register and `spec.md`). The toast is empty in the HTML: the JS fills it.
- **Answering as:** the label in two spans; the input's `placeholder` through `data-i18n`.
- **Save button:** two label spans inside `.save-label`, and `title` / `aria-label` through `data-i18n` — the pair
  that matches `ANSWER_TARGET` (UI Strings above; the example is `'register'`):
```html
<button class="save-btn" id="saveReviewBtn" type="button"
  data-i18n="title,aria-label"
  data-en-title="Save answers to the clarification register and comments into this page (Ctrl+S)" data-ar-title="احفظ الإجابات في سجل الأسئلة والتعليقات جوه الصفحة (Ctrl+S)"
  data-en-aria-label="Save answers to the clarification register and comments into this page" data-ar-aria-label="احفظ الإجابات في سجل الأسئلة والتعليقات جوه الصفحة">
  <svg>…</svg>
  <span class="save-label"><span data-lang="en">Save</span><span data-lang="ar">احفظ</span></span>
  <span class="save-dot" aria-hidden="true"></span>
</button>
```
- **Question cards:** question text, why, recorded answer, option labels, status (`.q-open` / `.q-answered`) and
  «Recommended» in two spans; the ID and owner once. The answer field's placeholder and label through `data-i18n`
  (the rich editor's placeholder is the `data-placeholder` attribute):
```html
<div class="answer-rich" contenteditable="true" role="textbox" aria-multiline="true" dir="auto"
  data-i18n="data-placeholder,aria-label"
  data-en-data-placeholder="Type your answer..." data-ar-data-placeholder="اكتب إجابتك..."
  data-en-aria-label="Answer to AQ-01" data-ar-aria-label="إجابة AQ-01"></div>
```
  Toolbar buttons and the options group take `aria-label` the same way. The reader's answer is written in either
  language; `dir="auto"` lays it out by its own text.

---

## Bilingual Checklist

Before opening the page:

- [ ] Every visible text has an `en` and an `ar` version: titles, subtitles, body, cards, callouts, tables, badges'
      labels, nav tooltips, buttons, toast, placeholders, `<title>`.
- [ ] Both versions say the same thing: same numbers, IDs, scope and open items; nothing added in either.
- [ ] Arabic reads as Egyptian colloquial (no «يتم» / «حيث»), with IDs, code and product names in English.
- [ ] Switching works both ways and is remembered after reload; `?lang=ar` opens Arabic.
- [ ] In Arabic: layout is right-to-left, callout and step-card bars sit on the right, flow arrows point left
      (down on mobile), tables align right, code and IDs read left-to-right, no letter-spacing on Arabic.
- [ ] Review feedback and answers left in one language are still there after switching; Copy Review uses the
      language on screen.
- [ ] Save, Copy for Clarify, Answering as, the question cards (status, placeholders, toolbar labels) and the toast
      read correctly in both languages.
- [ ] Check at phone width in both languages.
