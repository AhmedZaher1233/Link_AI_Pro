#!/usr/bin/env node
// selftest-tc-hash.mjs — regression harness for tc-hash.mjs (the canonical test-case hash).
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. It is a test harness, not one of the
// read-only reporting scripts. A failing self-test means `automated_tc_sha256` values written to
// ADO-MAP.md cannot be trusted: do not write the column until the harness passes again.
//
// The fixture pair under fixtures/tc-hash/ is byte-identical to skill 4's, and GOLDEN below is the
// constant skill 4's harness asserts on the same pair — the two hash copies must agree.
// Run: node selftest-tc-hash.mjs [--pretty]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { hashDocument, parseTcDocument, parseTestData, tcHash, canonicalTc, normText, HASH_VERSION } from './tc-hash.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(here, 'fixtures', 'tc-hash');
const TC_FILE = path.join(FX, 'TEST-CASES-hash-sample.md');
const DATA_FILE = path.join(FX, 'TEST-DATA-hash-sample.md');
const ID = 'TC-HASH-01';
/** The one golden hash of TC-HASH-01 on this fixture pair — skill 4's selftest-ado-sync.mjs asserts the same value. */
export const GOLDEN = '935858124e72e0dd04faac4bdcc7870cd70171fbb00cdf851033120ad7c79bb8';

const read = (p) => fs.readFileSync(p, 'utf8');
const TC_TEXT = read(TC_FILE);
const DATA_TEXT = read(DATA_FILE);
const hashOf = (tcText = TC_TEXT, dataText = DATA_TEXT) => hashDocument(tcText, dataText, [ID])[ID];
const mustContain = (text, needle) => { if (!text.includes(needle)) throw new Error('fixture no longer contains: ' + needle); return text; };
const mutate = (text, from, to) => mustContain(text, from).replace(from, to);

const cases = []; const fail = [];
function check(name, problems, detail) { cases.push({ case: name, ok: problems.length === 0, problems, detail }); if (problems.length) fail.push({ case: name, problems }); }
const expectSame = (p, label, h) => { if (h.hash !== GOLDEN) p.push(label + ': hash changed although the behaviour did not (' + h.hash.slice(0, 12) + ')'); };
const expectDifferent = (p, label, h) => { if (h.hash === GOLDEN) p.push(label + ': hash did NOT change although the behaviour did'); };

/* 0 — the golden hash on the fixture pair; the data file is picked up by name when --data is omitted. */
{
  const p = [];
  const h = hashOf();
  if (!h) p.push(ID + ' not parsed from the fixture');
  else if (h.hash !== GOLDEN) p.push('golden mismatch: ' + h.hash + ' (expected ' + GOLDEN + ') — regenerate ONLY for a deliberate tc-hash.mjs change, and change skill 4\'s harness with it');
  if (h && !h.canonical.startsWith(HASH_VERSION + '\nid=' + ID)) p.push('canonical form does not start with the version line');
  if (h && !/data=A1=Administrator\|[^;]*;D1=[^;]*;E1=application base URL$/.test(h.canonical)) p.push('data fingerprint does not carry role / item / what only: ' + h.canonical.split('\n').pop());
  if (h && /admin\.user|portal\.example|READY/.test(h.canonical)) p.push('a username, an environment value or a status leaked into the canonical form');
  check('0 golden hash on the fixture pair', p, { hash: h && h.hash });
}

/* 1 — formatting-only edits outside quotes: bold, extra spaces, renumbered steps → same hash. */
{
  const p = [];
  let t = mutate(TC_TEXT, '  1. Open the portal [E1] — the home page is visible.', '  4. Open   the **portal** [E1] —  the home page is  visible.');
  t = mutate(t, '  2. Open Products — the product list shows every product.', '  7. Open _Products_ — the product list shows every product.');
  t = mutate(t, '- **Expected Result:** The list shows exactly 12 rows', '- **Expected Result:**   The list   shows exactly 12 rows');
  expectSame(p, 'bold / spaces / renumbering', hashOf(t));
  if (normText('Open   the **portal** [E1]') !== 'Open the portal [E1]') p.push('normText does not strip emphasis and collapse whitespace outside quotes');
  check('1 formatting-only edit → same hash', p, {});
}

/* 2 — whitespace INSIDE a quoted typed input is meaningful: "Hardware  2026" → "Hardware 2026" → different. */
{
  const p = [];
  expectDifferent(p, 'quoted double space collapsed', hashOf(mutate(TC_TEXT, '"Hardware  2026"', '"Hardware 2026"')));
  if (normText('Type "a  b" now') !== 'Type "a  b" now') p.push('normText altered whitespace inside quotes');
  check('2 quoted input whitespace → different hash', p, {});
}

/* 3 — the expected message text changed inside quotes → different. */
{
  const p = [];
  expectDifferent(p, 'expected message', hashOf(mutate(TC_TEXT, '"12 products found"', '"12 products were found"')));
  check('3 expected message changed → different hash', p, {});
}

/* 4 — D-row "Must look like" changed → different (the referenced data shape is part of the behaviour). */
{
  const p = [];
  expectDifferent(p, 'D1 must-look-like', hashOf(TC_TEXT, mutate(DATA_TEXT, '12 rows, category "Hardware"', '24 rows, category "Hardware"')));
  check('4 D-row Must look like changed → different hash', p, {});
}

/* 5 — A-row role changed → different; 6 — A-row username changed → same. */
{
  const p = [];
  expectDifferent(p, 'A1 role', hashOf(TC_TEXT, mutate(DATA_TEXT, '| A1 | Administrator | admin.user |', '| A1 | Auditor | admin.user |')));
  expectSame(p, 'A1 username', hashOf(TC_TEXT, mutate(DATA_TEXT, '| A1 | Administrator | admin.user |', '| A1 | Administrator | other.person |')));
  check('5+6 account role changes the hash, the username does not', p, {});
}

/* 7 — E-row URL changed → same (routine environment); the E-row "What" changed → different. */
{
  const p = [];
  expectSame(p, 'E1 value', hashOf(TC_TEXT, mutate(DATA_TEXT, 'https://portal.example.test', 'https://portal-uat.example.test')));
  expectDifferent(p, 'E1 what', hashOf(TC_TEXT, mutate(DATA_TEXT, '| E1 | application base URL |', '| E1 | admin portal base URL |')));
  check('7 environment URL does not change the hash, the kind of service does', p, {});
}

/* 8 — Shared data changed → different. */
{
  const p = [];
  expectDifferent(p, 'Shared data', hashOf(mutate(TC_TEXT, '- **Shared data:** —', '- **Shared data:** price list "Sample" [D1]')));
  check('8 Shared data changed → different hash', p, {});
}

/* 9 — Validation, the evidence stamp and Tags are excluded: changing them → same hash. */
{
  const p = [];
  expectSame(p, 'Validation', hashOf(mutate(TC_TEXT, '- **Validation:** draft — not app-validated', '- **Validation:** validated')));
  expectSame(p, 'evidence stamp', hashOf(mutate(TC_TEXT, 'validated-on: —\nenv: —', 'validated-on: 2026-09-27\nenv: staging')));
  expectSame(p, 'Tags', hashOf(mutate(TC_TEXT, '- **Tags:** regression', '- **Tags:** regression, uat')));
  expectSame(p, 'Smoke / Automation Candidate / Description', hashOf(mutate(mutate(TC_TEXT, '- **Smoke:** YES', '- **Smoke:** NO'), '### TC-HASH-01 — Filter the product list by category', '### TC-HASH-01 — Filter products by category')));
  check('9 Validation / evidence stamp / Tags / Smoke / heading → same hash', p, {});
}

/* 10 — an unresolved reference is fingerprinted as "?" so the gap stays visible, and changes the hash. */
{
  const p = [];
  const h = hashOf(mutate(TC_TEXT, 'Logged in as Administrator [A1]', 'Logged in as Administrator [A9]'));
  expectDifferent(p, 'unresolved [A9]', h);
  if (!/A9=\?/.test(h.canonical)) p.push('unresolved reference not fingerprinted as ?');
  const noData = hashDocument(TC_TEXT, '', [ID])[ID];
  if (!/A1=\?;D1=\?;E1=\?/.test(noData.canonical)) p.push('missing TEST-DATA file must fingerprint every reference as ?');
  check('10 unresolved reference stays visible', p, {});
}

/* 11 — parsers: fields by name, never by position; PB-/Q- headings skipped; hashing is deterministic. */
{
  const p = [];
  const tcs = parseTcDocument(TC_TEXT + '\n### PB-1 — a potential bug\n- **Steps:** none\n### Q-1 — a question\n');
  if (tcs.length !== 1 || tcs[0].id !== ID) p.push('parseTcDocument returned ' + tcs.map((t) => t.id).join(','));
  const d = parseTestData(DATA_TEXT);
  if (!d.env.E1 || !d.env.E2 || !d.accounts.A1 || !d.items.D1) p.push('parseTestData missed a row: ' + JSON.stringify(Object.keys(d.env)) + JSON.stringify(Object.keys(d.accounts)) + JSON.stringify(Object.keys(d.items)));
  const reordered = mutate(TC_TEXT, '- **Locale:** en\n- **Requirement:** REQ-9001-01', '- **Requirement:** REQ-9001-01\n- **Locale:** en');
  expectSame(p, 'field order', hashOf(reordered));
  if (tcHash(tcs[0], d) !== tcHash(tcs[0], d) || canonicalTc(tcs[0], d) !== canonicalTc(tcs[0], d)) p.push('hashing is not deterministic');
  const crlf = hashDocument(TC_TEXT.replace(/\n/g, '\r\n'), DATA_TEXT.replace(/\n/g, '\r\n'), [ID])[ID];
  if (crlf.hash !== GOLDEN) p.push('CRLF line endings changed the hash');
  check('11 parsers and determinism', p, {});
}

/* 12 — CLI: --tc alone finds the TEST-DATA file by name; --ids filters; --canonical expands; no --tc → NOT_RUN, exit 0. */
{
  const p = [];
  const script = path.join(here, 'tc-hash.mjs');
  const call = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: here });
  const r1 = call(['--tc', TC_FILE, '--ids', ID]);
  let j1; try { j1 = JSON.parse(r1.stdout); } catch { p.push('stdout is not a single JSON object'); }
  if (r1.status !== 0) p.push('exit ' + r1.status + ' != 0');
  if (j1 && (j1.gate !== 'PASS' || j1.hashes[ID] !== GOLDEN || j1.count !== 1)) p.push('CLI payload wrong: ' + JSON.stringify(j1 && { gate: j1.gate, count: j1.count, hash: j1.hashes && j1.hashes[ID] }));
  if (j1 && !/TEST-DATA-hash-sample\.md$/.test(String(j1.data))) p.push('the TEST-DATA file was not found by name: ' + j1.data);
  const r2 = JSON.parse(call(['--tc', TC_FILE, '--data', DATA_FILE, '--canonical']).stdout);
  if (!r2.hashes[ID] || r2.hashes[ID].hash !== GOLDEN || !r2.hashes[ID].canonical) p.push('--canonical did not return hash + canonical');
  const r3 = call([]); const j3 = JSON.parse(r3.stdout);
  if (r3.status !== 0 || j3.gate !== 'NOT_RUN') p.push('missing --tc must be NOT_RUN with exit 0, got ' + j3.gate + ' / ' + r3.status);
  const r4 = JSON.parse(call(['--tc', path.join(FX, 'missing.md')]).stdout);
  if (r4.gate !== 'NOT_RUN') p.push('missing file must be NOT_RUN');
  check('12 CLI', p, {});
}

/* 13 — MIRROR: this copy must be byte-identical to skill 4's canonical tc-hash.mjs and share the fixture pair (skipped when the sibling is absent). */
{
  const p = []; let skipped = false;
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const sib = path.resolve(here, '..', '..', 'link-qc-4-publish-test-cases-azure', 'scripts');
  if (!fs.existsSync(path.join(sib, 'tc-hash.mjs'))) skipped = true;
  else {
    if (sha(path.join(here, 'tc-hash.mjs')) !== sha(path.join(sib, 'tc-hash.mjs'))) p.push('tc-hash.mjs differs from skill 4\'s canonical copy — copy it byte for byte, never edit it here');
    for (const f of ['TEST-CASES-hash-sample.md', 'TEST-DATA-hash-sample.md']) {
      const other = path.join(sib, 'fixtures', 'tc-hash', f);
      if (fs.existsSync(other) && read(other).replace(/\r\n?/g, '\n') !== read(path.join(FX, f)).replace(/\r\n?/g, '\n')) p.push('fixture ' + f + ' differs from skill 4\'s copy — the two goldens would drift');
    }
  }
  check('13 mirror of skill 4\'s tc-hash.mjs and fixture pair', p, { skipped });
}

/* 14 — a reviewer's `Reviewer comment` field (shown on the rendered pages, read by the skills) never changes a TC hash. */
{
  const p = [];
  const withNote = TC_TEXT.replace(/\r?\n(- \*\*Validation:\*\*[^\r\n]*)/, '\n$1\n- **Reviewer comment:** Step 2 should name the grid.');
  if (withNote === TC_TEXT) p.push('fixture has no Validation line to anchor the comment');
  if (hashOf(withNote).hash !== hashOf().hash) p.push('a Reviewer comment field changed the hash');
  check('14 a Reviewer comment never changes the hash', p, {});
}

const out = {
  tool: 'selftest-tc-hash',
  skill: path.basename(path.resolve(here, '..')),
  golden: GOLDEN,
  ran: cases.length,
  ok: fail.length === 0,
  cases,
  mismatches: fail,
  note: fail.length ? 'tc-hash.mjs disagrees with its own fixture. Do not write automated_tc_sha256 until this passes.' : 'All fixtures behave as documented.',
};
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
