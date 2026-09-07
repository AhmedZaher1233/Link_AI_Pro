#!/usr/bin/env node
// The ONE implementation of QA-skill synchronization from the canonical repository.
// Used by /sync-skills and by 1-generate-update-testing-structure (Mode B/C, new project).
//
//   node sync-qa-skills.mjs --check   [--target <projectRoot>] [--branch main] [--only <skill>]... [--pretty]
//   node sync-qa-skills.mjs --apply   [--target <projectRoot>] [--branch main] [--only <skill>]... [--force] [--pretty]
//
// --check  : read-only. Reports NEW / UPDATED / CURRENT / LOCAL-ONLY / SKIPPED(local edits) per file. Never writes.
// --apply  : copies NEW + UPDATED files into <target>/.claude/skills/ and .claude/commands/sync-skills.md.
//            Files with uncommitted local edits are SKIPPED unless --force.
//            An uppercase .claude/Skills folder is migrated to .claude/skills (two-step rename, git mv when possible).
// Exit code is always 0; the JSON payload carries the result (and `error` when the source is unreachable).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { parseArgs, print, run, isDir, isFile, actualName, SKILLS, SOURCE_REPO } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const mode = args.apply ? 'apply' : 'check';
const target = path.resolve(args.target || process.cwd());
const branch = args.branch && args.branch !== true ? args.branch : 'main';
const only = [].concat(args.only || []).filter((x) => x !== true);
const wanted = only.length ? SKILLS.filter((s) => only.includes(s)) : SKILLS;
const OWNED = ['.claude/skills', '.claude/commands/sync-skills.md'];

function fail(error, extra = {}) { print({ tool: 'sync-qa-skills', mode, target, source: { repo: SOURCE_REPO, branch }, error, ...extra }, args); process.exit(0); }

// Guard: never sync the canonical repo onto itself.
const remote = run('git remote get-url origin', target);
if (remote.ok && /AhmedZaher1233\/Link_AI_Pro(\.git)?$/i.test(remote.out)) fail('target is the canonical repository — run git pull there instead');

// 1. Fetch the source into a temp folder (sparse clone, fallback to raw download).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-skills-'));
let source = { repo: SOURCE_REPO, branch, ref: null, method: null };
const clone = run(`git clone --quiet --depth 1 --filter=blob:none --sparse --branch ${branch} ${SOURCE_REPO}.git "${tmp}"`, undefined, 120000);
if (clone.ok) {
  run(`git -C "${tmp}" sparse-checkout set .claude/skills .claude/commands`, undefined, 60000);
  const log = run(`git -C "${tmp}" log -1 --format=%h_%ad --date=short`);
  source.ref = log.ok ? log.out : null; source.method = 'git-sparse-clone';
} else {
  try { await rawDownload(tmp); source.method = 'raw-download'; }
  catch (e) { cleanup(); fail(`source unreachable (${e.message}) — local skills unchanged`); }
}
const srcSkills = path.join(tmp, '.claude', actualName(path.join(tmp, '.claude'), 'skills') || 'skills');
if (!isDir(srcSkills)) { cleanup(); fail('source has no .claude/skills folder'); }

// 2. Resolve the target skills folder (and detect an uppercase legacy folder).
const targetClaude = path.join(target, '.claude');
const existingName = actualName(targetClaude, 'skills');
const uppercaseDir = existingName !== null && existingName !== 'skills';
const targetSkills = path.join(targetClaude, 'skills');

// 3. Diff.
const files = [];
const git = run('git rev-parse --is-inside-work-tree', target).ok;
function classify(rel, srcAbs) {
  const dstAbs = path.join(target, rel);
  if (!isFile(dstAbs)) return 'NEW';
  const a = fs.readFileSync(srcAbs), b = fs.readFileSync(dstAbs);
  if (a.equals(b)) return 'CURRENT';
  return 'UPDATED';
}
function hasLocalEdits(rel) {
  if (!git) return false;
  const tracked = run(`git ls-files --error-unmatch -- "${rel}"`, target).ok;
  if (!tracked) return true; // untracked local copy: treat as hand-made
  return !run(`git diff --quiet -- "${rel}"`, target).ok;
}
for (const skill of wanted) {
  const sdir = path.join(srcSkills, skill);
  if (!isDir(sdir)) { files.push({ skill, file: `.claude/skills/${skill}/`, status: 'MISSING-IN-SOURCE' }); continue; }
  for (const f of walk(sdir)) {
    const relInSkill = path.relative(sdir, f).replace(/\\/g, '/');
    const rel = `.claude/skills/${skill}/${relInSkill}`;
    const legacyRel = uppercaseDir ? `.claude/${existingName}/${skill}/${relInSkill}` : null;
    const status = classify(legacyRel && isFile(path.join(target, legacyRel)) && !isFile(path.join(target, rel)) ? legacyRel : rel, f);
    const localEdits = status === 'UPDATED' && hasLocalEdits(rel);
    files.push({ skill, file: rel, status: localEdits && !args.force ? 'SKIPPED' : status, localEdits, src: f });
  }
  // local-only files inside the skill folder
  const tdir = path.join(target, '.claude', existingName || 'skills', skill);
  if (isDir(tdir)) for (const f of walk(tdir)) {
    const rel = `.claude/skills/${skill}/${path.relative(tdir, f).replace(/\\/g, '/')}`;
    if (!files.some((x) => x.file === rel)) files.push({ skill, file: rel, status: 'LOCAL-ONLY' });
  }
}
const cmdSrc = path.join(tmp, '.claude/commands/sync-skills.md');
if (isFile(cmdSrc)) {
  const status = classify('.claude/commands/sync-skills.md', cmdSrc);
  const localEdits = status === 'UPDATED' && hasLocalEdits('.claude/commands/sync-skills.md');
  files.push({ skill: 'commands', file: '.claude/commands/sync-skills.md', status: localEdits && !args.force ? 'SKIPPED' : status, localEdits, src: cmdSrc });
}
const localOnlySkills = existingName ? fs.readdirSync(path.join(targetClaude, existingName)).filter((e) => isDir(path.join(targetClaude, existingName, e)) && !SKILLS.includes(e)) : [];

// 4. Apply.
const applied = [];
if (mode === 'apply') {
  if (uppercaseDir) {
    const from = path.join(targetClaude, existingName), viaTmp = path.join(targetClaude, '_skills_tmp_rename');
    const useGit = git && run(`git ls-files --error-unmatch -- ".claude/${existingName}"`, target).ok;
    if (useGit) { run(`git mv ".claude/${existingName}" ".claude/_skills_tmp_rename"`, target); run(`git mv ".claude/_skills_tmp_rename" ".claude/skills"`, target); }
    else { fs.renameSync(from, viaTmp); fs.renameSync(viaTmp, targetSkills); }
    applied.push({ action: 'renamed', from: `.claude/${existingName}`, to: '.claude/skills', via: useGit ? 'git mv' : 'fs.rename' });
  }
  for (const f of files) {
    if (!['NEW', 'UPDATED'].includes(f.status)) continue;
    const dst = path.join(target, f.file);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(f.src, dst);
    applied.push({ action: f.status === 'NEW' ? 'created' : 'updated', file: f.file });
  }
}
cleanup();

const summary = files.reduce((a, f) => ((a[f.status.toLowerCase().replace('-', '_')] = (a[f.status.toLowerCase().replace('-', '_')] || 0) + 1), a), {});
const skillMdChanged = applied.some((a) => /SKILL\.md$|sync-skills\.md$/.test(a.file || ''));
print({
  tool: 'sync-qa-skills', mode, target, source, owned: OWNED, skillsChecked: wanted,
  uppercaseDir: uppercaseDir ? `.claude/${existingName}` : null,
  files: files.map(({ src, ...rest }) => rest), summary, localOnlySkills, applied,
  reloadRequired: skillMdChanged,
  hint: mode === 'check' ? 'read-only check — nothing copied' : (files.some((f) => f.status === 'SKIPPED') ? 'some files skipped (local edits) — re-run with --force to overwrite' : null),
}, args);

/* ---------------- helpers ---------------- */
function walk(dir) { const out = []; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...walk(p)); else out.push(p); } return out; }
function cleanup() { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
async function rawDownload(dest) {
  const api = `https://api.github.com/repos/AhmedZaher1233/Link_AI_Pro/git/trees/${branch}?recursive=1`;
  const res = await fetch(api, { headers: { 'User-Agent': 'qa-skills-sync' } });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const tree = (await res.json()).tree.filter((t) => t.type === 'blob' && (/^\.claude\/skills\//i.test(t.path) || t.path === '.claude/commands/sync-skills.md'));
  for (const t of tree) {
    const r = await fetch(`https://raw.githubusercontent.com/AhmedZaher1233/Link_AI_Pro/${branch}/${t.path}`);
    if (!r.ok) throw new Error(`raw ${r.status} for ${t.path}`);
    const p = path.join(dest, t.path.replace(/^\.claude\/[Ss]kills\//, '.claude/skills/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
  }
  source.ref = `${branch}@raw`;
}
