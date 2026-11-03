#!/usr/bin/env node
// visualplanner page tool — zero dependencies, Node >= 18.
//
//   node page-tool.mjs build --draft <draft.html> --page <target.html> [--force] [--pretty]
//   node page-tool.mjs check --page <page.html> [--pretty]
//
// build: inserts assets/review-system.css and assets/review-system.js at the draft's two placeholders, carries the
//        saved comments and answers of an existing page at --page into the new one, checks the result and writes
//        --page ONLY when the check passes. The draft is never modified. An existing page whose saved state cannot be
//        read is not overwritten unless --force.
// check: runs the same checks on an existing page (read-only).
//
// Output: one JSON payload { command, verdict: PASS | FAIL, written, errors[], warnings[], carried }.
// Exit codes: 0 PASS · 1 FAIL · 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, '..', 'assets');
const CSS_MARK = '/* @visualplanner:review-css */';
const JS_MARK = '/* @visualplanner:review-js */';
const HOLDER_RE = /(<script\b[^>]*\bid="vp-saved-state"[^>]*>)([\s\S]*?)(<\/script\s*>)/i;
const TARGETS = ['register', 'plan', 'none'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const REGISTER_FILE = 'clarification_register.md';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
      else { out[a.slice(2)] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

const readText = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
const asset = (name) => readText(path.join(ASSETS, name)).replace(/\r\n/g, '\n');

// The register-table rules of the page itself (assets/review-system.js), run here so both agree by construction.
function registerRules() {
  const js = asset('review-system.js');
  const from = js.indexOf('var REGISTER_COLUMNS');
  const to = js.indexOf('// Fills the register row');
  if (from < 0 || to < from) throw new Error('assets/review-system.js: register rules not found');
  const ctx = {};
  vm.runInNewContext(js.slice(from, to) + '\nthis.registerTable = registerTable; this.rowCells = rowCells;', ctx);
  return ctx;
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*"([^"]*)"', 'i'));
  return m ? m[1] : null;
};
const tags = (html, name) => html.match(new RegExp('<' + name + '\\b[^>]*>', 'gi')) || [];
const hasClass = (tag, cls) => (attr(tag, 'class') || '').split(/\s+/).includes(cls);
const constant = (code, name) => {
  const m = code.match(new RegExp('\\bvar\\s+' + name + "\\s*=\\s*'([^'\\\\]*)'"));
  return m ? m[1] : null;
};

function scripts(html) {   // every <script> element: { open, body, start, end }
  const list = [];
  const re = /<script\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const close = html.slice(re.lastIndex).search(/<\/script\s*>/i);
    if (close < 0) { list.push({ open: m[0], body: html.slice(re.lastIndex), start: m.index, end: html.length }); break; }
    const bodyEnd = re.lastIndex + close;
    const end = bodyEnd + html.slice(bodyEnd).match(/^<\/script\s*>/i)[0].length;
    list.push({ open: m[0], body: html.slice(re.lastIndex, bodyEnd), start: m.index, end });
    re.lastIndex = end;
  }
  return list;
}

function check(html, pageDir) {
  const errors = [];
  const warnings = [];
  const err = (id, text) => errors.push({ id, text });

  if (html.includes(CSS_MARK) || html.includes(JS_MARK)) err('placeholder', 'a review placeholder was not replaced');
  if (/scroll-snap/i.test(html)) err('scroll-snap', 'scroll-snap is used; the skill forbids it');

  const all = scripts(html);
  // The markup without script bodies, so strings inside the JS never count as elements.
  let markup = '';
  let at = 0;
  for (const s of all) { markup += html.slice(at, s.start) + s.open; at = s.end; }
  markup += html.slice(at);

  for (const t of [...tags(markup, 'link'), ...tags(markup, 'script')]) {
    const url = attr(t, 'href') || attr(t, 'src');
    if (!url || !/^(https?:)?\/\//i.test(url)) continue;
    const host = url.replace(/^(https?:)?\/\//i, '').split(/[/?#]/)[0].toLowerCase();
    if (!FONT_HOSTS.includes(host)) err('external', 'external resource outside Google Fonts: ' + url);
  }

  const holders = all.filter((s) => attr(s.open, 'id') === 'vp-saved-state');
  const inline = all.filter((s) => attr(s.open, 'id') !== 'vp-saved-state');
  if (holders.length !== 1) err('holder', 'expected one <script type="application/json" id="vp-saved-state">, found ' + holders.length);
  if (inline.length !== 1) {
    err('scripts', 'expected exactly one main <script> besides the saved-state holder, found ' + inline.length +
      ' — a <script> in source text must be HTML-escaped');
  }
  const holder = holders[0];
  const main = inline[inline.length - 1];
  let code = '';
  if (holder) {
    try { JSON.parse(holder.body.trim() || 'null'); } catch (e) { err('holder-json', 'the saved state is not valid JSON'); }
    if ((attr(holder.open, 'type') || '').toLowerCase() !== 'application/json') err('holder-type', 'the holder needs type="application/json"');
  }
  if (main) {
    code = main.body;
    if (attr(main.open, 'src')) err('main-src', 'the main script must be inline');
    if (holder && !/^\s*$/.test(html.slice(holder.end, main.start))) err('order', 'the main <script> must follow the saved-state holder directly');
    if (!/^\s*<\/body\s*>\s*<\/html\s*>\s*$/i.test(html.slice(main.end))) err('last', 'the main <script> must be the last element of <body>');
    try { new vm.Script(code, { filename: 'main-script.js' }); } catch (e) { err('syntax', 'the main script does not parse: ' + e.message); }
    if (!/^\s*\(function\s*\(\)\s*\{\s*(\/\/[^\n]*\n\s*)*var\s+PRISTINE_HTML\s*=\s*'<!DOCTYPE html>\\n'\s*\+\s*document\.documentElement\.outerHTML\s*;/.test(code)) {
      err('snapshot', 'the main script must open with (function () { … var PRISTINE_HTML = … outerHTML; as its first statement');
    }
    if (/<!--/.test(code)) warnings.push({ id: 'comment-opener', text: 'the main script contains "<!--"; build such strings from pieces' });
  }

  const slug = constant(code, 'PAGE_SLUG');
  const target = constant(code, 'ANSWER_TARGET');
  const sourceFile = constant(code, 'SOURCE_FILE');
  const featureDir = constant(code, 'FEATURE_DIR');
  if (!slug) err('slug', 'PAGE_SLUG is missing or empty');
  if (featureDir === null) err('feature-dir', "FEATURE_DIR is missing ('' when the source is not a Spec Kit feature)");
  if (!TARGETS.includes(target)) err('target', "ANSWER_TARGET must be 'register', 'plan' or 'none' (the user's answer at the gate)");
  if (target === 'plan') {
    if (!sourceFile) err('source-file', "SOURCE_FILE is required when ANSWER_TARGET is 'plan'");
    else if (pageDir && !fs.existsSync(path.join(pageDir, sourceFile))) err('source-file', SOURCE_FILE_MSG(sourceFile));
  }

  const ids = new Set(tags(markup, '[a-z][a-z0-9]*').map((t) => attr(t, 'id')).filter(Boolean));
  for (const id of ['saveReviewBtn', 'copyReviewBtn', 'reviewCount', 'toast']) if (!ids.has(id)) err('element', '#' + id + ' is missing');

  const sections = tags(markup, 'section').filter((t) => hasClass(t, 'section') && attr(t, 'id')).map((t) => attr(t, 'id'));
  const bars = tags(markup, 'div').filter((t) => hasClass(t, 'review-bar')).map((t) => attr(t, 'data-section'));
  for (const s of sections) if (!bars.includes(s)) err('review-bar', 'section #' + s + ' has no review bar');
  for (const b of bars) if (!sections.includes(b)) err('review-bar', 'review bar data-section="' + b + '" matches no section id');
  if (new Set(bars).size !== bars.length) err('review-bar', 'two review bars share a data-section');

  const cards = tags(markup, 'div').filter((t) => hasClass(t, 'question-card'));
  const qids = cards.map((t) => attr(t, 'data-qid'));
  if (qids.some((q) => !q)) err('question', 'a question card has no data-qid');
  if (new Set(qids).size !== qids.length) err('question', 'two question cards share a data-qid');
  for (const t of cards) {
    const kind = attr(t, 'data-answer');
    if (kind && !['rich', 'input'].includes(kind)) err('question', attr(t, 'data-qid') + ': data-answer must be rich or input');
  }
  if (cards.length) {
    if (!ids.has('copyAnswersBtn') || !ids.has('answerCount')) err('element', 'question cards need the Copy for Clarify button');
    if ((target === 'register' || target === 'plan') && !ids.has('answererInput')) err('element', 'the "Answering as" field (#answererInput) is missing');
  }

  const regCards = cards.filter((t) => attr(t, 'data-reg') !== null);
  if (regCards.length && target !== 'register') err('data-reg', "data-reg is used but ANSWER_TARGET is not 'register'");
  if (target === 'register') {
    for (const t of regCards) if (!/^\d+$/.test(attr(t, 'data-reg'))) err('data-reg', attr(t, 'data-qid') + ': data-reg must be a row number');
    const regPath = pageDir && path.join(pageDir, REGISTER_FILE);
    if (pageDir && !fs.existsSync(regPath)) err('register', REGISTER_FILE + " is not beside the page; ANSWER_TARGET 'register' needs it");
    else if (regPath) {
      const rules = registerRules();
      const lines = readText(regPath).split('\n');
      const table = rules.registerTable(lines);
      if (table.reason) err('register', REGISTER_FILE + ': ' + table.reason + ' with the columns # · Answer · Status · User · Updated in Spec · Last Updated Date');
      else {
        const rows = {};
        for (let i = table.from; i < table.to; i++) {
          const cells = rules.rowCells(lines[i]);
          const m = cells.length === table.width && cells[table.columns.num].trim().match(/^Q?(\d+)$/i);
          if (m) rows[Number(m[1])] = (rows[Number(m[1])] || 0) + 1;
        }
        for (const t of regCards) {
          const n = Number(attr(t, 'data-reg'));
          if (rows[n] !== 1) err('data-reg', attr(t, 'data-qid') + ': register row ' + n + (rows[n] ? ' is not unique' : ' does not exist'));
        }
      }
    }
  }
  return { errors, warnings, slug, sections, qids };
}
const SOURCE_FILE_MSG = (f) => f + " (SOURCE_FILE) is not beside the page; ANSWER_TARGET 'plan' writes into it";

function savedState(html) {   // { found, state, raw } from a page's holder
  const m = html.match(HOLDER_RE);
  if (!m) return { found: false };
  try { return { found: true, state: JSON.parse(m[2].trim() || 'null') }; } catch (e) { return { found: true, error: e.message }; }
}

function build(args) {
  const draftPath = path.resolve(args.draft);
  const pagePath = path.resolve(args.page);
  const out = { command: 'build', draft: draftPath, page: pagePath, verdict: 'FAIL', written: false, errors: [], warnings: [], carried: null };
  let html = readText(draftPath);
  for (const [mark, file] of [[CSS_MARK, 'review-system.css'], [JS_MARK, 'review-system.js']]) {
    const n = html.split(mark).length - 1;
    if (n !== 1) { out.errors.push({ id: 'placeholder', text: mark + ' must appear exactly once in the draft (found ' + n + ')' }); continue; }
    const text = asset(file);
    html = html.replace(mark, () => text);
  }
  if (!HOLDER_RE.test(html)) out.errors.push({ id: 'holder', text: 'the draft has no saved-state holder' });

  if (fs.existsSync(pagePath)) {
    const old = readText(pagePath);
    const prev = savedState(old);
    const oldSlug = constant(old, 'PAGE_SLUG');
    if (prev.error && !args.force) {
      out.errors.push({ id: 'carry', text: 'the existing page\'s saved state is unreadable (' + prev.error + '); not overwritten — rerun with --force to discard it' });
    } else if (prev.found && prev.state && typeof prev.state === 'object') {
      const s = prev.state;
      const json = JSON.stringify(s).replace(/</g, '\\u003c');
      html = html.replace(HOLDER_RE, (m, open, body, close) => open + json + close);
      out.carried = {
        sections: Object.keys(s.sections || {}).length,
        answers: Object.keys(s.answers || {}).length,
        updatedAt: s.updatedAt || 0,
      };
    } else if (!prev.found) {
      out.warnings.push({ id: 'carry', text: 'the existing page has no saved-state holder; nothing to carry' });
    }
    const newSlug = constant(html, 'PAGE_SLUG');
    if (oldSlug && newSlug && oldSlug !== newSlug) {
      out.warnings.push({ id: 'slug', text: 'PAGE_SLUG changed (' + oldSlug + ' → ' + newSlug + '): readers\' unsaved browser copies will not be found' });
    }
  }

  const result = check(html, path.dirname(pagePath));
  out.errors.push(...result.errors);
  out.warnings.push(...result.warnings);
  if (out.carried) {
    const st = savedState(html).state || {};
    const orphanSections = Object.keys(st.sections || {}).filter((id) => !result.sections.includes(id));
    const orphanAnswers = Object.keys(st.answers || {}).filter((id) => !result.qids.includes(id));
    if (orphanSections.length || orphanAnswers.length) {
      out.carried.orphans = { sections: orphanSections, answers: orphanAnswers };
      out.warnings.push({ id: 'orphans', text: 'carried feedback for ids the new page no longer has (kept in the saved state, not shown): ' +
        [...orphanSections, ...orphanAnswers].join(', ') });
    }
  }
  if (!out.errors.length) {
    fs.writeFileSync(pagePath, html);
    out.written = true;
    out.verdict = 'PASS';
  }
  return out;
}

function checkPage(args) {
  const pagePath = path.resolve(args.page);
  const r = check(readText(pagePath), path.dirname(pagePath));
  return { command: 'check', page: pagePath, verdict: r.errors.length ? 'FAIL' : 'PASS', errors: r.errors, warnings: r.warnings };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  let out;
  try {
    if (cmd === 'build' && typeof args.draft === 'string' && typeof args.page === 'string') out = build(args);
    else if (cmd === 'check' && typeof args.page === 'string') out = checkPage(args);
    else {
      process.stderr.write('usage: page-tool.mjs build --draft <draft.html> --page <target.html> [--force] [--pretty]\n' +
        '       page-tool.mjs check --page <page.html> [--pretty]\n');
      process.exit(2);
    }
  } catch (e) {
    out = { command: cmd, verdict: 'FAIL', written: false, errors: [{ id: 'exception', text: e.message }], warnings: [] };
  }
  process.stdout.write(JSON.stringify(out, null, args.pretty ? 2 : 0) + '\n');
  process.exit(out.verdict === 'PASS' ? 0 : 1);
}

main();
