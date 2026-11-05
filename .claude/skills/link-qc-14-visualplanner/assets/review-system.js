// visualplanner review system: JS. Inserted verbatim by scripts/page-tool.mjs at the page's
// review-js placeholder, inside the main IIFE after PRISTINE_HTML, PAGE_SLUG, FEATURE_DIR,
// ANSWER_TARGET, SOURCE_FILE and root are declared. Never write a literal closing script tag in this file.
// --- REVIEW STATE: reactions, comments, answers ---
var REVIEW_KEY = 'visualplanner-review-' + PAGE_SLUG;
var UI = {
  en: { head: '# Plan Review: ', reaction: 'Reaction', comment: 'Comment', questions: 'Answers to Questions',
        choice: 'Choice', answer: 'Answer',
        copied: 'Review copied to clipboard — paste into Claude',
        copiedAnswers: 'Questions and answers copied — paste them into the chat',
        saved: 'Saved — your comments and answers are in this page now',
        savedRegister: function (n) { return n + (n === 1 ? ' answer' : ' answers') + ' saved to clarification_register.md — the spec owner runs /speckit-clarify to update the spec'; },
        notFiled: function (ids) { return 'Not saved to the register: ' + ids + ' — use Copy for Clarify'; },
        registerUnreadable: 'clarification_register.md has no single table with the columns # · Answer · Status · User · Updated in Spec · Last Updated Date — nothing written to it',
        copyFailed: 'Could not copy — the browser blocked the clipboard',
        savedPlan: function (n) { return n + (n === 1 ? ' answer' : ' answers') + ' saved into ' + SOURCE_FILE + ' — Answers to Questions, at its end'; },
        planBroken: 'Not saved to ' + SOURCE_FILE + ': its Answers to Questions markers are broken or doubled — fix them, or use Copy for Clarify',
        planMissing: SOURCE_FILE + ' is not in that folder — press Save again and pick the folder that holds it',
        pageMissing: 'This page is not in that folder, so your comments stay in this browser only',
        pickFeature: function (dir) { return 'Pick the folder ' + dir; },
        pickPage: function (file) { return 'Pick the folder that holds ' + file; },
        wrongFolder: function (dir) { return 'That is not ' + dir + ' — press Save again and pick it'; },
        needName: 'Fill in "Answering as" first — it is recorded with your answers',
        noFs: 'This browser cannot write files — use Chrome or Edge, or Copy for Clarify',
        saveFailed: 'Could not save' },
  ar: { head: '# مراجعة الخطة: ', reaction: 'رأيك', comment: 'تعليق', questions: 'إجابات الأسئلة',
        choice: 'الاختيار', answer: 'الإجابة',
        copied: 'المراجعة اتنسخت — الصقها في Claude',
        copiedAnswers: 'الأسئلة والإجابات اتنسخت — الصقها في الشات',
        saved: 'اتحفظ — تعليقاتك وإجاباتك بقت جوه الصفحة',
        savedRegister: function (n) { return n + ' إجابة اتحفظت في clarification_register.md — صاحب الـ spec يشغّل /speckit-clarify عشان يحدّث الـ spec'; },
        notFiled: function (ids) { return 'متحفظتش في السجل: ' + ids + ' — استخدم «انسخ للـ Clarify»'; },
        registerUnreadable: 'clarification_register.md مفيهوش جدول واحد بالأعمدة # · Answer · Status · User · Updated in Spec · Last Updated Date — متكتبش فيه حاجة',
        copyFailed: 'معرفناش ننسخ — المتصفح منع الحافظة',
        savedPlan: function (n) { return n + ' إجابة اتحفظت في ' + SOURCE_FILE + ' — جزء «إجابات الأسئلة» في آخره'; },
        planBroken: 'متحفظتش في ' + SOURCE_FILE + ': علامات جزء «إجابات الأسئلة» فيه بايظة أو متكررة — صلّحها، أو استخدم «انسخ للـ Clarify»',
        planMissing: SOURCE_FILE + ' مش في الفولدر ده — دوس «احفظ» تاني واختار الفولدر اللي فيه',
        pageMissing: 'الصفحة دي مش في الفولدر ده، فتعليقاتك فاضلة في المتصفح ده بس',
        pickFeature: function (dir) { return 'اختار فولدر ' + dir; },
        pickPage: function (file) { return 'اختار الفولدر اللي فيه ' + file; },
        wrongFolder: function (dir) { return 'ده مش ' + dir + ' — دوس «احفظ» تاني واختاره'; },
        needName: 'اكتب اسمك في «بتجاوب باسم» الأول — بيتسجل مع إجاباتك',
        noFs: 'المتصفح ده مبيعرفش يكتب في الملفات — استخدم Chrome أو Edge، أو «انسخ للـ Clarify»',
        saveFailed: 'معرفناش نحفظ' }
};
function lang() { return root.lang === 'ar' ? 'ar' : 'en'; }
function msg(key, arg) {
  var m = UI[lang()][key];
  return typeof m === 'function' ? m(arg) : m;
}
function visibleText(el, l) {   // l: 'en' / 'ar'; the language on screen when omitted
  if (!el) return '';
  var own = el.querySelector('[data-lang="' + (l || lang()) + '"]');
  return (own || el).textContent.replace(/\s+/g, ' ').trim();
}
function textWithout(el, selector, l) {   // el's text without the parts matching selector (labels)
  if (!el) return '';
  var copy = el.cloneNode(true);
  copy.querySelectorAll(selector).forEach(function (r) { r.remove(); });
  return visibleText(copy, l);
}
function optionText(opt, l) { return textWithout(opt, '.question-rec', l); }   // without its "Recommended" label
function showToast(text, ms) {
  var toast = document.getElementById('toast');
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(function () { toast.classList.remove('show'); }, ms || 3000);
}

function readEmbeddedState() {
  try { return JSON.parse(document.getElementById('vp-saved-state').textContent || 'null'); } catch (e) { return null; }
}
function readLocalState() {
  try { return JSON.parse(localStorage.getItem(REVIEW_KEY) || 'null'); } catch (e) { return null; }
}
// The newer of the state saved in the file and the one in this browser wins.
var embedded = readEmbeddedState();
var local = readLocalState();
var picked = local && (!embedded || (local.updatedAt || 0) >= (embedded.updatedAt || 0)) ? local : embedded;
var state = {
  sections: (picked && picked.sections) || {},
  answers: (picked && picked.answers) || {},
  filed: (picked && picked.filed) || {},   // register rows this page has filled: { '12': true }
  updatedAt: (picked && picked.updatedAt) || 0
};
var savedAt = (embedded && embedded.updatedAt) || 0;   // when the state was last written into the file

function persist() {
  try { localStorage.setItem(REVIEW_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable: Save still writes the file */ }
}
function touch() {
  state.updatedAt = Date.now();
  persist();
  updateReviewUi();
}
function hasAnswer(a) { return !!a && (!!(a.text && a.text.trim()) || !!a.choice); }
function feedbackCount() {
  var n = 0;
  Object.keys(state.sections).forEach(function (id) {
    var d = state.sections[id];
    if (d.reaction || (d.comment && d.comment.trim())) n++;
  });
  Object.keys(state.answers).forEach(function (id) { if (hasAnswer(state.answers[id])) n++; });
  return n;
}
function updateReviewUi() {
  var total = feedbackCount();
  document.getElementById('reviewCount').textContent = total;
  document.getElementById('copyReviewBtn').style.display = total > 0 ? 'flex' : 'none';
  var answersBtn = document.getElementById('copyAnswersBtn');
  if (answersBtn) {
    var answered = answeredCards().length;
    document.getElementById('answerCount').textContent = answered;
    answersBtn.style.display = answered > 0 ? 'flex' : 'none';
  }
  document.getElementById('saveReviewBtn').classList.toggle('dirty', state.updatedAt > savedAt);
}

// --- SECTION REACTIONS AND COMMENTS ---
function sectionState(bar) {
  var id = bar.dataset.section;
  return state.sections[id] || (state.sections[id] = {});
}
window.setReaction = function (btn, type) {
  var bar = btn.closest('.review-bar');
  var data = sectionState(bar);
  data.reaction = data.reaction === type ? null : type;   // clicking the same reaction again removes it
  bar.querySelector('.review-up').classList.toggle('active', data.reaction === 'up');
  bar.querySelector('.review-down').classList.toggle('active', data.reaction === 'down');
  touch();
};
window.toggleComment = function (btn) {
  var box = btn.closest('.review-bar').querySelector('.review-comment-box');
  var isOpen = box.style.display !== 'none';
  box.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) box.querySelector('textarea').focus();
};
window.saveComment = function (textarea) {
  var bar = textarea.closest('.review-bar');
  sectionState(bar).comment = textarea.value;
  bar.querySelector('.review-comment-btn').classList.toggle('has-comment', textarea.value.trim().length > 0);
  touch();
};

// --- QUESTION ANSWERS ---
var RICH_TAGS = { B: 1, STRONG: 1, I: 1, EM: 1, UL: 1, OL: 1, LI: 1, BR: 1, DIV: 1, P: 1 };
function parseHtml(html) { return new DOMParser().parseFromString(html || '', 'text/html').body; }
// Keeps only the editor's own formatting; anything else becomes plain text.
function cleanRich(html) {
  var body = parseHtml(html);
  (function walk(node) {
    Array.prototype.slice.call(node.childNodes).forEach(function (child) {
      if (child.nodeType === 3) return;
      if (child.nodeType !== 1 || !RICH_TAGS[child.tagName]) {
        node.replaceChild(document.createTextNode(child.nodeType === 1 ? child.textContent : ''), child);
        return;
      }
      while (child.attributes.length) child.removeAttribute(child.attributes[0].name);
      walk(child);
    });
  })(body);
  return body.innerHTML;
}
function richToMarkdown(html) {
  function wrap(mark, s) {
    var m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return m[2] ? m[1] + mark + m[2] + mark + m[3] : s;
  }
  function inline(node) {
    var out = '';
    Array.prototype.forEach.call(node.childNodes, function (c) {
      if (c.nodeType === 3) { out += c.textContent; return; }
      if (c.nodeType !== 1) return;
      var t = c.tagName;
      if (t === 'B' || t === 'STRONG') out += wrap('**', inline(c));
      else if (t === 'I' || t === 'EM') out += wrap('*', inline(c));
      else if (t === 'BR') out += '\n';
      else if (t === 'UL' || t === 'OL') out += '\n' + list(c) + '\n';
      else if (t === 'DIV' || t === 'P') out += '\n' + inline(c) + '\n';
      else out += inline(c);
    });
    return out;
  }
  function list(el) {
    var n = 0;
    return Array.prototype.filter.call(el.children, function (li) { return li.tagName === 'LI'; })
      .map(function (li) { n++; return (el.tagName === 'OL' ? n + '. ' : '- ') + inline(li).trim(); })
      .join('\n');
  }
  return inline(parseHtml(html)).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function questionCard(el) { return el.closest('.question-card'); }
function answerState(card) {
  var id = card.dataset.qid;
  return state.answers[id] || (state.answers[id] = {});
}
function syncQuestion(card) {
  var a = state.answers[card.dataset.qid];
  card.classList.toggle('is-answered', card.dataset.recorded === 'true' || hasAnswer(a));
  card.querySelectorAll('.question-option').forEach(function (opt) {
    opt.setAttribute('aria-checked', a && a.choice === opt.dataset.choice ? 'true' : 'false');
  });
}
function storeAnswer(card) {
  var a = answerState(card);
  var rich = card.querySelector('.answer-rich');
  var input = card.querySelector('.answer-input');
  if (rich) {
    if (!rich.textContent.trim() && !rich.querySelector('li')) rich.innerHTML = '';   // brings the placeholder back
    a.html = rich.innerHTML;
    a.text = rich.textContent;
  }
  if (input) a.text = input.value;
  syncQuestion(card);
  touch();
}

// Chromium moves the caret to the start of a line it turns into a list; the toolbar puts it back.
function caretOffset(el) {
  var sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed || !el.contains(sel.anchorNode)) return -1;
  var range = document.createRange();
  range.selectNodeContents(el);
  range.setEnd(sel.anchorNode, sel.anchorOffset);
  return range.toString().length;
}
function setCaret(el, offset) {
  var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), node;
  while ((node = walker.nextNode())) {
    if (offset <= node.length) {
      var range = document.createRange();
      range.setStart(node, offset);
      range.collapse(true);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    offset -= node.length;
  }
}

document.addEventListener('input', function (e) {
  if (e.target.matches && e.target.matches('.answer-rich, .answer-input')) storeAnswer(questionCard(e.target));
});
// Toolbar buttons format the selection without taking the focus from the editor.
document.addEventListener('mousedown', function (e) {
  if (e.target.closest && e.target.closest('.answer-tool')) e.preventDefault();
});
document.addEventListener('click', function (e) {
  if (!e.target.closest) return;
  var tool = e.target.closest('.answer-tool');
  if (tool) {
    var card = questionCard(tool);
    var rich = card.querySelector('.answer-rich');
    if (document.activeElement !== rich) rich.focus();
    var at = caretOffset(rich);
    document.execCommand(tool.dataset.cmd, false, null);
    if (at >= 0 && caretOffset(rich) !== at) setCaret(rich, at);
    storeAnswer(card);
    return;
  }
  var opt = e.target.closest('.question-option');
  if (opt) {
    var a = answerState(questionCard(opt));
    a.choice = a.choice === opt.dataset.choice ? null : opt.dataset.choice;   // clicking the chosen option again clears it
    syncQuestion(questionCard(opt));
    touch();
  }
});
// Pastes as plain text, so outside formatting never enters an answer.
document.addEventListener('paste', function (e) {
  var host = e.target.nodeType === 1 ? e.target : e.target.parentElement;
  if (!host || !host.closest('.answer-rich')) return;
  e.preventDefault();
  document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
});

// --- COPY REVIEW ---
window.copyReview = function () {
  if (!feedbackCount()) return;
  var L = UI[lang()];
  var out = L.head + document.title + '\n\n';
  document.querySelectorAll('.section[id]').forEach(function (section) {
    var d = state.sections[section.id];
    if (!d || (!d.reaction && !(d.comment && d.comment.trim()))) return;
    out += '## ' + (visibleText(section.querySelector('.section-title, .hero-title')) || section.id) + '\n';
    if (d.reaction) out += '- **' + L.reaction + ':** ' + (d.reaction === 'up' ? '👍' : '👎') + '\n';
    if (d.comment && d.comment.trim()) out += '- **' + L.comment + ':** "' + d.comment.trim() + '"\n';
    out += '\n';
  });
  var answered = answeredCards();
  if (answered.length) {
    out += '## ' + L.questions + '\n\n';
    answered.forEach(function (card) {
      var a = state.answers[card.dataset.qid];
      out += '### ' + card.dataset.qid + ' — ' + visibleText(card.querySelector('.question-text')) + '\n';
      var opt = a.choice && card.querySelector('.question-option[data-choice="' + a.choice + '"]');
      if (opt) out += '- **' + L.choice + ':** ' + optionText(opt) + '\n';
      var text = answerMarkdown(a);
      if (text) out += '- **' + L.answer + ':**\n\n' + text.replace(/^(?=.)/gm, '  ') + '\n';
      out += '\n';
    });
  }
  navigator.clipboard.writeText(out.trim() + '\n').then(function () { showToast(msg('copied')); },
    function () { showToast(msg('copyFailed')); });
};

// --- COPY FOR CLARIFY: only the questions and their answers, ready to paste into the chat ---
// Always in English: the answers go into the register and spec.md.
function answeredCards() {
  return Array.prototype.filter.call(document.querySelectorAll('.question-card'), function (card) {
    return hasAnswer(state.answers[card.dataset.qid]);
  });
}
function answerMarkdown(a) { return a.html !== undefined ? richToMarkdown(a.html) : (a.text || '').trim(); }
function today() {   // DD-MM-YYYY, the register's date format
  var d = new Date();
  return ('0' + d.getDate()).slice(-2) + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + d.getFullYear();
}
window.copyAnswers = function () {
  var cards = answeredCards();
  if (!cards.length) return;
  var who = answererName();
  var out = FEATURE_DIR
    ? '/speckit-clarify Apply these answers, given in the "' + document.title + '" breakdown' +
      (who ? ' by ' + who : '') + ' on ' + today() + ', to ' + FEATURE_DIR + '/spec.md. Record each one in ' +
      FEATURE_DIR + '/clarification_register.md first: fill its row (Q<#>), or add a row (Owner PO) for a question ' +
      'that has none; then update the spec and set Updated in Spec.\n\n'
    : '# Answers to Questions: ' + document.title + '\n\n';
  cards.forEach(function (card) {
    var a = state.answers[card.dataset.qid];
    out += '### ' + card.dataset.qid + ' — ' + visibleText(card.querySelector('.question-text'), 'en') + '\n';
    if (card.dataset.reg && card.dataset.qid !== 'Q' + card.dataset.reg) out += '- **Register row:** Q' + card.dataset.reg + '\n';
    var recorded = card.querySelector('.question-recorded');
    if (recorded) out += '- **Recorded answer:** ' + textWithout(recorded, '.question-recorded-label', 'en') + '\n';
    var opt = a.choice && card.querySelector('.question-option[data-choice="' + a.choice + '"]');
    if (opt) out += '- **Choice:** ' + optionText(opt, 'en') + '\n';
    var text = answerMarkdown(a);
    if (text) out += '- **' + (recorded ? 'Note' : 'Answer') + ':**\n\n' + text.replace(/^(?=.)/gm, '  ') + '\n';
    out += '\n';
  });
  navigator.clipboard.writeText(out.trim() + '\n').then(function () { showToast(msg('copiedAnswers')); },
    function () { showToast(msg('copyFailed')); });
};

// --- SAVE: answers into the clarification register, everything into this page ---
// Never creates a file. The folder is picked once (the feature folder) and remembered; Save then fills the
// register rows in it and overwrites this page in it.
var REGISTER_FILE = 'clarification_register.md';
var ANSWERER_KEY = 'visualplanner-answerer';
var answererInput = document.getElementById('answererInput');
function answererName() { return answererInput ? answererInput.value.trim() : ''; }
if (answererInput) {
  try { answererInput.value = localStorage.getItem(ANSWERER_KEY) || ''; } catch (e) { /* not remembered */ }
  answererInput.addEventListener('input', function () {
    answererInput.classList.remove('needed');
    try { localStorage.setItem(ANSWERER_KEY, answererInput.value.trim()); } catch (e) { /* not remembered */ }
  });
}

function pageFileName() {
  var name = decodeURIComponent(location.pathname.split('/').pop() || '');
  return /\.html?$/i.test(name) ? name : PAGE_SLUG + '-breakdown.html';
}
function pageWithState() {
  var json = JSON.stringify(state).replace(/</g, '\\u003c');   // a closing script tag typed in a comment can't end the block
  return PRISTINE_HTML.replace(/(<script[^>]*id="vp-saved-state"[^>]*>)[\s\S]*?(<\/script>)/, function (m, open, close) {
    return open + json + close;
  });
}

// The picked folder is kept in IndexedDB, so the browser asks for it once per page.
function folderStore(mode, run) {
  return new Promise(function (resolve, reject) {
    var open = indexedDB.open('visualplanner', 1);
    open.onupgradeneeded = function () { open.result.createObjectStore('folders'); };
    open.onerror = function () { reject(open.error); };
    open.onsuccess = function () {
      var db = open.result;
      var tx = db.transaction('folders', mode);
      var req = run(tx.objectStore('folders'));
      tx.oncomplete = function () { db.close(); resolve(req.result); };
      tx.onerror = function () { db.close(); reject(tx.error); };
    };
  });
}
var folder = null;
async function pickFolder() {
  if (!folder) folder = await folderStore('readonly', function (s) { return s.get(PAGE_SLUG); }).catch(function () { return null; });
  if (folder && (await folder.queryPermission({ mode: 'readwrite' })) !== 'granted' &&
      (await folder.requestPermission({ mode: 'readwrite' })) !== 'granted') folder = null;
  if (!folder) {
    showToast(FEATURE_DIR ? msg('pickFeature', FEATURE_DIR) : msg('pickPage', pageFileName()), 8000);
    folder = await window.showDirectoryPicker({ id: ('vp-' + PAGE_SLUG).slice(0, 32), mode: 'readwrite' });
    folderStore('readwrite', function (s) { return s.put(folder, PAGE_SLUG); }).catch(function () {});
  }
  return folder;
}
function forgetFolder() {
  folder = null;
  folderStore('readwrite', function (s) { return s.delete(PAGE_SLUG); }).catch(function () {});
}
async function fileIn(dir, name) {
  try { return await dir.getFileHandle(name); } catch (e) { return null; }   // never creates a file
}
async function writeFile(handle, text) {
  var w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

function registerCell(s) {   // one register cell: a single line, `|` escaped
  return ' ' + s.split('\n').map(function (l) { return l.trim().replace(/^- /, ''); }).filter(Boolean).join('; ')
    .replace(/\|/g, '\\|') + ' ';
}
function registerAnswer(card) {
  var a = state.answers[card.dataset.qid];
  var opt = a.choice && card.querySelector('.question-option[data-choice="' + a.choice + '"]');
  return [opt ? optionText(opt, 'en') : '', answerMarkdown(a)].filter(Boolean).join(' — ');
}
// The register table is found by its header: these columns, by name, in any order. Only rows of that one table are
// written; a register with no such table, or several, is not written at all.
var REGISTER_COLUMNS = { num: '#', answer: 'Answer', status: 'Status', user: 'User', inSpec: 'Updated in Spec',
                         date: 'Last Updated Date' };
function rowCells(line) {   // the cells between the outer pipes, or null when the line is not a table row
  var t = line.replace(/\r$/, '').trim();
  if (t.length < 2 || t[0] !== '|' || t[t.length - 1] !== '|') return null;
  return t.slice(1, -1).split(/(?<!\\)\|/);
}
function registerTable(lines) {   // { width, columns, from, to } of the one register table, or { reason }
  var found = [];
  for (var i = 0; i + 1 < lines.length; i++) {
    var head = rowCells(lines[i]), sep = rowCells(lines[i + 1]);
    if (!head || !sep || !sep.every(function (c) { return /^\s*:?-{3,}:?\s*$/.test(c); })) continue;
    var names = head.map(function (c) { return c.trim().replace(/\s+/g, ' ').toLowerCase(); });
    var columns = {}, ok = sep.length === head.length;
    Object.keys(REGISTER_COLUMNS).forEach(function (k) {
      var name = REGISTER_COLUMNS[k].toLowerCase(), at = names.indexOf(name);
      if (at < 0 || names.lastIndexOf(name) !== at) ok = false;
      columns[k] = at;
    });
    var to = i + 2;
    while (to < lines.length && rowCells(lines[to])) to++;
    if (ok) found.push({ width: head.length, columns: columns, from: i + 2, to: to });
    i = to - 1;
  }
  return found.length === 1 ? found[0] : { reason: found.length ? 'several register tables' : 'no register table' };
}
// Fills the register row of each answered card. A row is filled while it is Open, or when this page filled it
// (same User) and the spec has not taken it yet; any other row — or a row number that is missing or not unique —
// is left to /speckit-clarify.
function fillRegister(md, cards, who) {
  var lines = md.split('\n');   // a CRLF file keeps its \r at each line end
  var table = registerTable(lines);
  if (table.reason) return { text: md, filed: [], left: cards.map(function (card) { return card.dataset.qid; }), unreadable: true };
  var rows = {}, filed = [], left = [], c = table.columns;
  for (var i = table.from; i < table.to; i++) {
    var cells = rowCells(lines[i]);
    var m = cells.length === table.width && cells[c.num].trim().match(/^Q?(\d+)$/i);
    if (m) (rows[Number(m[1])] = rows[Number(m[1])] || []).push(i);
  }
  cards.forEach(function (card) {
    var num = Number(card.dataset.reg), at = rows[num];
    if (!at || at.length !== 1) { left.push(card.dataset.qid); return; }
    var line = lines[at[0]], cells = rowCells(line);
    var status = cells[c.status].trim();
    var ours = state.filed[num] && status === 'Answered' && cells[c.user].trim() === who && cells[c.inSpec].trim() === 'No';
    if (status !== 'Open' && !ours) { left.push(card.dataset.qid); return; }
    cells[c.answer] = registerCell(registerAnswer(card));
    cells[c.status] = ' Answered ';
    cells[c.user] = registerCell(who);
    cells[c.inSpec] = ' No ';
    cells[c.date] = ' ' + today() + ' ';
    lines[at[0]] = line.match(/^\s*/)[0] + '|' + cells.join('|') + '|' + (/\r$/.test(line) ? '\r' : '');
    filed.push(String(num));
  });
  return { text: lines.join('\n'), filed: filed, left: left, unreadable: false };
}

// ANSWER_TARGET 'plan': the answers live in one managed block at the end of the plan. Save appends it once, then
// replaces this page's entries by question ID and keeps the others; nothing outside the markers changes.
// Built from pieces: a literal comment opener inside an inline script changes how the HTML parser reads it.
var PLAN_START = '<' + '!-- visualplanner:answers --' + '>';
var PLAN_END = '<' + '!-- /visualplanner:answers --' + '>';
function planEntry(card, who) {
  var a = state.answers[card.dataset.qid];
  var out = '### ' + card.dataset.qid + ' — ' + visibleText(card.querySelector('.question-text'), 'en') + '\n';
  out += '- **Answered by:** ' + who + ' · ' + today() + '\n';
  var recorded = card.querySelector('.question-recorded');
  if (recorded) out += '- **Recorded answer:** ' + textWithout(recorded, '.question-recorded-label', 'en') + '\n';
  var opt = a.choice && card.querySelector('.question-option[data-choice="' + a.choice + '"]');
  if (opt) out += '- **Choice:** ' + optionText(opt, 'en') + '\n';
  var text = answerMarkdown(a);
  if (text) out += '- **' + (recorded ? 'Note' : 'Answer') + ':**\n\n' + text.replace(/^(?=.)/gm, '  ') + '\n';
  return out.trim();
}
function fillPlan(md, cards, who) {   // the new plan text, or null when the markers are broken (nothing is written)
  var count = function (s) { return md.split(s).length - 1; };
  var start = md.indexOf(PLAN_START), end = md.indexOf(PLAN_END);
  if (count(PLAN_START) > 1 || count(PLAN_END) > 1 || (start < 0) !== (end < 0) || end < start) return null;
  var eol = md.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  var order = [], entries = {};
  if (start >= 0) {   // keep the entries already in the block, in their order
    md.slice(start + PLAN_START.length, end).replace(/\r\n/g, '\n').split(/\n(?=### )/).forEach(function (chunk) {
      var m = chunk.match(/^### (\S+)/);
      if (m) { order.push(m[1]); entries[m[1]] = chunk.trim(); }
    });
  }
  cards.forEach(function (card) {
    var id = card.dataset.qid;
    if (!entries[id]) order.push(id);
    entries[id] = planEntry(card, who);
  });
  var block = [PLAN_START, '## Answers to Questions', '',
    '_Written by the Save button of the "' + document.title + '" breakdown page. Answer in the page; edits here are ' +
    'replaced on the next Save._', '']
    .concat(order.map(function (id) { return entries[id] + '\n'; }), [PLAN_END]).join('\n').replace(/\n/g, eol);
  return start >= 0
    ? md.slice(0, start) + block + md.slice(end + PLAN_END.length)
    : md.replace(/\s*$/, '') + eol + eol + block + eol;
}

async function saveAll() {
  if (!window.showDirectoryPicker) return { lines: [msg('noFs')] };
  var answered = ANSWER_TARGET === 'none' ? [] : answeredCards();
  var toFile = ANSWER_TARGET === 'plan' ? answered
    : ANSWER_TARGET === 'register' ? answered.filter(function (card) { return card.dataset.reg; }) : [];
  var left = ANSWER_TARGET !== 'register' ? []
    : answered.filter(function (card) { return !card.dataset.reg; }).map(function (card) { return card.dataset.qid; });
  var who = answererName();
  if (toFile.length && !who) {
    if (answererInput) {
      answererInput.classList.add('needed');
      answererInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
      answererInput.focus({ preventScroll: true });
    }
    return { lines: [msg('needName')] };
  }
  var dir = await pickFolder();
  if (FEATURE_DIR && dir.name !== FEATURE_DIR.split('/').pop()) {
    forgetFolder();
    return { lines: [msg('wrongFolder', FEATURE_DIR)] };
  }
  var lines = [];
  if (toFile.length && ANSWER_TARGET === 'plan') {
    var plan = await fileIn(dir, SOURCE_FILE);
    if (!plan) { forgetFolder(); return { lines: [msg('planMissing')] }; }
    var updated = fillPlan(await (await plan.getFile()).text(), toFile, who);
    if (updated === null) lines.push(msg('planBroken'));
    else { await writeFile(plan, updated); lines.push(msg('savedPlan', toFile.length)); }
  }
  if (toFile.length && ANSWER_TARGET === 'register') {
    var register = await fileIn(dir, REGISTER_FILE);
    if (!register) { forgetFolder(); return { lines: [msg('wrongFolder', FEATURE_DIR)] }; }
    var result = fillRegister(await (await register.getFile()).text(), toFile, who);
    if (result.filed.length) {
      await writeFile(register, result.text);
      result.filed.forEach(function (num) { state.filed[num] = true; });
      persist();
    }
    lines.push(result.unreadable ? msg('registerUnreadable') : msg('savedRegister', result.filed.length));
    left = left.concat(result.left);
  }
  if (left.length) lines.push(msg('notFiled', left.join(', ')));
  var page = await fileIn(dir, pageFileName());
  if (page) {
    await writeFile(page, pageWithState());
    if (ANSWER_TARGET !== 'register' || !toFile.length) lines.push(msg('saved'));
  } else if (FEATURE_DIR) {
    lines.push(msg('pageMissing'));
  } else {
    forgetFolder();
    return { lines: [msg('pickPage', pageFileName())] };
  }
  return { lines: lines, pageSaved: !!page };
}
var saving = false;
function savePage() {
  if (saving) return;
  saving = true;
  var stamp = state.updatedAt;
  saveAll().then(function (r) {
    if (r.pageSaved) savedAt = stamp;
    updateReviewUi();
    showToast(r.lines.join('\n'), 8000);
  }, function (e) {
    if (!(e && e.name === 'AbortError')) showToast(msg('saveFailed'));   // AbortError: the reader closed the folder dialog
  }).then(function () { saving = false; });
}
document.getElementById('saveReviewBtn').addEventListener('click', savePage);
document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    savePage();
  }
});

// --- RESTORE ON LOAD ---
document.querySelectorAll('.review-bar').forEach(function (bar) {
  var d = state.sections[bar.dataset.section];
  if (!d) return;
  bar.querySelector('.review-up').classList.toggle('active', d.reaction === 'up');
  bar.querySelector('.review-down').classList.toggle('active', d.reaction === 'down');
  if (d.comment && d.comment.trim()) {
    bar.querySelector('.review-textarea').value = d.comment;
    bar.querySelector('.review-comment-btn').classList.add('has-comment');
    bar.querySelector('.review-comment-box').style.display = 'block';   // saved comments are visible on open
  }
});
document.querySelectorAll('.question-card').forEach(function (card) {
  var a = state.answers[card.dataset.qid];
  var rich = card.querySelector('.answer-rich');
  var input = card.querySelector('.answer-input');
  if (a && rich && a.html) rich.innerHTML = cleanRich(a.html);
  if (a && input && a.text) input.value = a.text;
  syncQuestion(card);
});
updateReviewUi();
