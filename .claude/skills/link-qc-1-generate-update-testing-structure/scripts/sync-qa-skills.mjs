#!/usr/bin/env node
// The ONE implementation of QA-skill synchronization from the canonical repository.
// Used by /sync-skills and by link-qc-1-generate-update-testing-structure (Mode B/C, new project).
//
//   node sync-qa-skills.mjs --check   [--target <projectRoot>] [--branch main] [--only <skill>]... [--no-mcp] [--pretty]
//   node sync-qa-skills.mjs --apply   [--target <projectRoot>] [--branch main] [--only <skill>]... [--force] [--no-mcp] [--tools] [--pretty]
//   node sync-qa-skills.mjs --apply --replace --yes [...same options]
//
// --check  : read-only. Reports NEW / UPDATED / CURRENT / LOCAL-ONLY / SKIPPED(local edits) per file, plus the
//            planned .mcp.json migration (`mcp.actions`). Never writes.
// --apply  : copies NEW + UPDATED files into <target>/.claude/skills/ and .claude/commands/sync-skills.md.
//            Files with uncommitted local edits are SKIPPED unless --force.
//            An uppercase .claude/Skills folder is migrated to .claude/skills (two-step rename, git mv when possible).
//            .mcp.json migration (skip with --no-mcp): removes every legacy `word` server (office-word-mcp-server,
//            read-only comments) and adds/pins the `docx` server (docx-mcp-server, `--with mcp<2`, absolute uvx path).
//            Only the docx entry and legacy word entries are ever touched; other servers are never changed — the
//            `azure-devops` entry in particular (cloud @azure-devops/mcp or self-hosted @tiberriver256/…) is left
//            byte-for-byte as it is; scripts/selftest.mjs guards that.
//            Optional tools (opt-in, --tools): installs @playwright/cli globally, its chromium browser, adds
//            `.playwright-cli/` to .gitignore (skill 3c), and — only when a Python interpreter already exists —
//            `pip install pillow numpy` (link-qc-6-ui-testing's static-image annotation fallback). --check always reports the tool
//            status and the planned actions (`tools.actions`); without --tools nothing is installed — none of it is
//            a prerequisite for 3b or any other skill.
//            Clean replace (--replace, needs --yes = the user confirmed): each of OUR skill folders (lib.mjs SKILLS, plus
//            legacy SKILL_RENAMES folders) is DELETED and re-downloaded whole, and the /sync-skills command is overwritten —
//            local edits and extra files inside those folders are lost. Every other folder under .claude/skills/ and every
//            other file (.mcp.json, .gitignore, Testing/, docs/, settings, other commands) is never deleted by it; the
//            .mcp.json migration and --tools keep their normal behaviour. --check always reports the plan under `replace`
//            (what would be deleted, what would be lost, what is kept, and `confirmText` for the question).
//            If the apply updated the sync implementation itself (this script, lib.mjs, the /sync-skills command),
//            it re-runs ONCE with the new code (internal flag --rerun) and reports both passes — one run is enough.
// Exit code is always 0; the JSON payload carries the result (and `error` when the source is unreachable).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, print, run, isDir, isFile, read, actualName, planMcpMigration, applyMcpMigration, resolveUvx, planTools, planReplace, REPLACE_WARNING, SYNC_COMMAND, SKILLS, SKILL_RENAMES, SOURCE_REPO, DOCX_SERVER, PLAYWRIGHT_CLI_PACKAGE, PLAYWRIGHT_CLI_BIN, PLAYWRIGHT_CLI_IGNORE, PYTHON_PACKAGES } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const mode = args.apply ? 'apply' : 'check';
const target = path.resolve(args.target || process.cwd());
const branch = args.branch && args.branch !== true ? args.branch : 'main';
const only = [].concat(args.only || []).filter((x) => x !== true);
const wanted = only.length ? SKILLS.filter((s) => only.includes(s)) : SKILLS;
const OWNED = ['.claude/skills', '.claude/commands/sync-skills.md', `.mcp.json (${DOCX_SERVER} entry + legacy word entries only)`, `with --tools: the global ${PLAYWRIGHT_CLI_PACKAGE} package, its chromium browser, the ${PLAYWRIGHT_CLI_IGNORE} line of .gitignore, and the Python packages ${PYTHON_PACKAGES.join(' + ')} when a Python interpreter exists (link-qc-6-ui-testing annotation fallback)`];
const migrateMcp = !args['no-mcp'];
const installTools = Boolean(args.tools);
const replaceMode = Boolean(args.replace);

function fail(error, extra = {}) { print({ tool: 'sync-qa-skills', mode, target, source: { repo: SOURCE_REPO, branch }, error, ...extra }, args); process.exit(0); }

// Guard: never sync the canonical repo onto itself.
const remote = run('git remote get-url origin', target);
if (remote.ok && /AhmedZaher1233\/Link_AI_Pro(\.git)?$/i.test(remote.out)) fail('target is the canonical repository — run git pull there instead');
// Guard: a clean replace deletes our skill folders — only after the user confirmed (the caller asks, then passes --yes).
if (mode === 'apply' && replaceMode && !args.yes) fail('replace needs confirmation — show replace.confirmText from --check, ask the user, and re-run with --replace --yes only after they agreed; nothing changed');

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
const targetSkillDirs = existingName ? fs.readdirSync(path.join(targetClaude, existingName)).filter((e) => isDir(path.join(targetClaude, existingName, e))) : [];
const localOnlySkills = targetSkillDirs.filter((e) => !SKILLS.includes(e) && !(e in SKILL_RENAMES));
// Folders from before the link-qc-N naming (or merged into another skill): removed by --apply once the replacement is synced.
const sourceSkillDirs = fs.readdirSync(srcSkills).filter((e) => isDir(path.join(srcSkills, e)));
const legacySkills = targetSkillDirs.filter((e) => e in SKILL_RENAMES).map((e) => ({ folder: e, replacement: SKILL_RENAMES[e], action: mode === 'apply' ? 'removed by --apply' : 'legacy (removed by --apply)' }));

// 3a. Plan the clean replace (reported on every run; executed only by --apply --replace --yes).
const replacePlan = planReplace({ targetDirs: targetSkillDirs, wanted, sourceDirs: sourceSkillDirs });
const replace = buildReplaceReport();
function buildReplaceReport() {
  const affected = new Set(replacePlan.replace);
  const lost = files.filter((f) => (affected.has(f.skill) && (f.status === 'LOCAL-ONLY' || f.localEdits)) || (f.skill === 'commands' && f.localEdits))
    .map((f) => ({ skill: f.skill, file: f.file, kind: f.status === 'LOCAL-ONLY' ? 'extra file (deleted)' : 'local edit (overwritten)' }));
  const edited = lost.filter((l) => l.kind.startsWith('local edit')).length, extra = lost.length - edited;
  const confirmText = REPLACE_WARNING.replace('{repo}', SOURCE_REPO).replace('{branch}', branch).replace('{edited}', edited).replace('{extra}', extra)
    .replace('{kept}', replacePlan.keep.length ? replacePlan.keep.join(', ') : 'none');
  return {
    requested: replaceMode, confirmed: Boolean(args.yes),
    deleteAndRedownload: replacePlan.replace.map((s) => `.claude/skills/${s}`), installNew: replacePlan.install.map((s) => `.claude/skills/${s}`),
    legacyRemoved: replacePlan.remove.map((l) => `.claude/skills/${l.folder}`), command: SYNC_COMMAND,
    keptUntouched: replacePlan.keep.map((s) => `.claude/skills/${s}`), refused: replacePlan.refused,
    lost, edited, extra, needsConfirmation: replacePlan.replace.length + replacePlan.remove.length > 0, confirmText,
  };
}

// 3b. Plan the .mcp.json migration (legacy word -> docx). Read-only here; applied in step 4.
const mcp = planMcp();
function planMcp() {
  const file = path.join(target, '.mcp.json');
  const base = { file: '.mcp.json', exists: isFile(file), skipped: !migrateMcp, actions: [], legacyWord: [], docxPresent: false, docxPinned: false, uvxPath: null, uvxFound: null, error: null };
  if (!migrateMcp) return base;
  let json = { mcpServers: {} };
  if (base.exists) {
    try { json = JSON.parse(read(file)); } catch { return { ...base, error: 'invalid JSON - .mcp.json not touched; fix it by hand or via link-qc-1-generate-update-testing-structure' }; }
    if (json === null || typeof json !== 'object' || Array.isArray(json)) return { ...base, error: 'unexpected shape - .mcp.json not touched' };
  }
  const plan = planMcpMigration(json);
  const uvx = plan.actions.some((a) => a.startsWith('add:') || a.startsWith('pin:')) ? resolveUvx() : { path: null, found: null };
  return { ...base, json, plan, actions: plan.actions, legacyWord: plan.legacyWord, docxPresent: plan.docxPresent, docxPinned: plan.docxPinned, uvxPath: uvx.path, uvxFound: uvx.found };
}
function applyMcp() {
  if (!migrateMcp || mcp.error || !mcp.actions.length) return [];
  // The JSON mutation lives in lib.mjs (applyMcpMigration) so scripts/selftest.mjs can prove it never touches the
  // `azure-devops` entry (cloud or self-hosted) or any other server — only docx + legacy word entries.
  const { json, applied } = applyMcpMigration(mcp.json, mcp.uvxPath);
  fs.writeFileSync(path.join(target, '.mcp.json'), JSON.stringify(json, null, 2) + '\n');
  return applied;
}

// 3c. Plan the optional tools — skill 3c's browser CLI and link-qc-6-ui-testing's Python packages (read-only; applied in step 4 only with --tools).
const tools = { ...planTools(target), requested: installTools, skipped: !installTools };
function applyTools() {
  if (!installTools || !tools.actions.length) return [];
  const out = [];
  for (const action of tools.actions) {
    if (action.startsWith('install:')) {
      const r = run(`npm install -g ${PLAYWRIGHT_CLI_PACKAGE}@latest`, target, 300000);
      out.push(r.ok ? { action: 'tool-installed', tool: PLAYWRIGHT_CLI_BIN, package: PLAYWRIGHT_CLI_PACKAGE } : { action: 'tool-failed', step: action, error: firstLine(r.out) });
      if (!r.ok) break; // the browser needs the CLI
    } else if (action.startsWith('install-browser:')) {
      const r = run(`${PLAYWRIGHT_CLI_BIN} install-browser`, target, 600000);
      out.push(r.ok ? { action: 'browser-installed', tool: PLAYWRIGHT_CLI_BIN, browser: 'chromium' } : { action: 'tool-failed', step: action, error: firstLine(r.out) });
    } else if (action.startsWith('gitignore:')) {
      const p = path.join(target, '.gitignore');
      const cur = isFile(p) ? read(p) || '' : '';
      fs.writeFileSync(p, (cur.length && !cur.endsWith('\n') ? cur + '\n' : cur) + `${PLAYWRIGHT_CLI_IGNORE}\n`);
      out.push({ action: 'gitignore-added', file: '.gitignore', line: PLAYWRIGHT_CLI_IGNORE });
    } else if (action.startsWith('pip:')) {
      // link-qc-6-ui-testing's annotation fallback: only when an interpreter already exists (planTools never plans it otherwise).
      const r = run(`${tools.python.command} -m pip install ${PYTHON_PACKAGES.join(' ')}`, target, 300000);
      out.push(r.ok ? { action: 'python-packages-installed', interpreter: tools.python.command, packages: PYTHON_PACKAGES } : { action: 'tool-failed', step: action, error: firstLine(r.out) });
    }
  }
  return out;
}
function firstLine(s) { return String(s || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || 'no output'; }

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
  if (replaceMode) applied.push(...applyReplace());
  for (const f of files) {
    if (replaceMode && f.skill !== 'commands') continue; // skill folders were replaced whole above
    if (!['NEW', 'UPDATED'].includes(f.status) && !(replaceMode && f.status === 'SKIPPED')) continue;
    const dst = path.join(target, f.file);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(f.src, dst);
    applied.push({ action: f.status === 'NEW' ? 'created' : 'updated', file: f.file });
  }
  for (const l of legacySkills) {
    const replacementReady = isFile(path.join(targetSkills, l.replacement, 'SKILL.md'));
    if (!replacementReady) { applied.push({ action: 'legacy-kept', folder: `.claude/skills/${l.folder}`, reason: `replacement ${l.replacement} not synced` }); continue; }
    const rel = `.claude/skills/${l.folder}`;
    const useGit = git && run(`git ls-files --error-unmatch -- "${rel}"`, target).ok;
    if (useGit) run(`git rm -r -q -- "${rel}"`, target);
    fs.rmSync(path.join(targetSkills, l.folder), { recursive: true, force: true });
    applied.push({ action: 'legacy-removed', folder: rel, replacement: l.replacement, via: useGit ? 'git rm' : 'fs.rm' });
  }
  applied.push(...applyMcp());
  applied.push(...applyTools());
}
cleanup();

// 5. Self-update: when this pass refreshed the sync implementation itself (this script, lib.mjs or the
//    /sync-skills command), the NEW code may sync differently — re-run it ONCE (--rerun guards the loop) so the
//    user never has to run /sync-skills twice. Both passes are reported in one payload.
const SELF_FILES = ['.claude/skills/link-qc-1-generate-update-testing-structure/scripts/sync-qa-skills.mjs', '.claude/skills/link-qc-1-generate-update-testing-structure/scripts/lib.mjs', '.claude/commands/sync-skills.md'];
const replacedSkill1 = applied.some((a) => a.action === 'replaced' && a.folder === '.claude/skills/link-qc-1-generate-update-testing-structure');
const selfUpdated = [...new Set([
  ...applied.filter((a) => SELF_FILES.includes(a.file)).map((a) => a.file),
  ...(replacedSkill1 ? files.filter((f) => SELF_FILES.includes(f.file) && ['NEW', 'UPDATED', 'SKIPPED'].includes(f.status)).map((f) => f.file) : []),
])];
let rerunFailed = null;
if (mode === 'apply' && !args.rerun && selfUpdated.length) {
  const q = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  // pass 2 is a plain --apply: the folders are already fresh, so it only re-checks with the new code
  const argv = process.argv.slice(2).filter((a) => a !== '--replace' && a !== '--yes').map(q).join(' ');
  const second = run(`node ${q(path.join(target, SELF_FILES[0]))} ${argv} --rerun`, target, 300000);
  let pass2 = null;
  try { pass2 = JSON.parse(second.out); } catch {}
  if (pass2 && !pass2.error) {
    print({
      ...pass2,
      applied: [...applied, ...(pass2.applied || [])],
      reloadRequired: true,
      rerun: { reason: 'sync implementation was updated in pass 1 — re-ran once with the new code', pass1Applied: applied, pass1Updated: selfUpdated },
      hint: [pass2.hint, 'sync re-ran itself after updating its own implementation — no second /sync-skills needed'].filter(Boolean).join(' | '),
    }, args);
    process.exit(0);
  }
  rerunFailed = `self re-run failed (${pass2?.error || second.out.slice(0, 200) || 'no output'}) — run /sync-skills once more`;
}

const summary = files.reduce((a, f) => ((a[f.status.toLowerCase().replace('-', '_')] = (a[f.status.toLowerCase().replace('-', '_')] || 0) + 1), a), {});
const skillMdChanged = applied.some((a) => /SKILL\.md$|sync-skills\.md$/.test(a.file || '') || ['replaced', 'installed'].includes(a.action));
const mcpChanged = applied.some((a) => String(a.action).startsWith('mcp-'));
const { json: _j, plan: _p, ...mcpReport } = mcp;
const toolsReport = { ...tools, after: mode === 'apply' && installTools ? planTools(target) : null };
const toolFailed = applied.filter((a) => a.action === 'tool-failed');
const hints = [];
if (legacySkills.length) hints.push(`legacy skill folder(s) ${legacySkills.map((l) => l.folder).join(', ')} — renamed in this release; --apply removes each one once its replacement is in place`);
if (mode === 'check') hints.push('read-only check — nothing copied' + (mcp.actions.length ? `; .mcp.json migration planned: ${mcp.actions.join(', ')} (skip with --no-mcp)` : ''));
if (mode === 'check' && replace.needsConfirmation) hints.push(`clean replace available: --apply --replace --yes deletes and re-downloads ${replace.deleteAndRedownload.length} Link skill folder(s)${replace.lost.length ? `, losing ${replace.edited} local edit(s) and ${replace.extra} extra file(s)` : ''} — ask the user with replace.confirmText first`);
const replaced = applied.filter((a) => ['replaced', 'installed'].includes(a.action)), replaceFailed = applied.filter((a) => a.action === 'replace-failed');
if (replaced.length) hints.push(`${replaced.length} Link skill folder(s) deleted and re-downloaded fresh; other skills untouched`);
if (replaceFailed.length) hints.push(`replace failed for ${replaceFailed.map((a) => a.folder).join(', ')} (${replaceFailed.map((a) => a.error).join(' | ')}) — the old folder was kept where possible; close editors watching it and re-run /sync-skills`);
if (mode === 'apply' && !replaceMode && files.some((f) => f.status === 'SKIPPED')) hints.push('some files skipped (local edits) — re-run with --force to overwrite');
if (mcp.error) hints.push(`.mcp.json: ${mcp.error}`);
if (mcp.uvxFound === false) hints.push('uv not found — the docx entry uses command "uvx"; install uv (powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"  or  pip install uv), then re-run so the absolute uvx path is written');
if (!mcp.exists && migrateMcp && mode === 'apply' && mcpChanged) hints.push('.mcp.json created with the docx entry only — run /link-qc-1-generate-update-testing-structure for playwright and azure-devops');
if (mcpChanged) hints.push('.mcp.json changed — reload the Claude Code session and approve the docx server via /mcp (a reload is enough for a server entry; only a NEW environment variable needs a full quit + relaunch of VS Code)');
if (tools.actions.length && !installTools) hints.push(`tools (skill 3c playwright-cli / link-qc-6-ui-testing pillow+numpy — optional): playwright-cli ${tools.cli.version ? 'installed ' + tools.cli.version : 'not installed'}, python ${tools.python.command ? (tools.python.ready ? 'ready' : 'packages missing') : 'absent'} — planned with --tools: ${tools.actions.join(', ')}; not needed by 3b or any other skill`);
if (mode === 'apply' && installTools && !tools.actions.length) hints.push('playwright-cli already installed with its browser and the gitignore line' + (tools.python.ready ? ', pillow + numpy present' : '') + ' — skill 3c ready' + (tools.python.ready ? ', link-qc-6-ui-testing annotation fallback ready' : ''));
if (mode === 'apply' && installTools && tools.actions.length && !toolFailed.length) hints.push('tools installed (' + tools.actions.join(', ') + ') — no session reload needed');
if (mode === 'apply' && installTools && !tools.python.command) hints.push('no Python interpreter — pillow + numpy not installed (link-qc-6-ui-testing annotates live pages in the DOM without them; install Python 3 and re-run --tools only to annotate static design images)');
if (toolFailed.length) hints.push(`tool setup failed at ${toolFailed.map((a) => a.step).join(', ')} (${toolFailed.map((a) => a.error).join(' | ')}) — run /link-qc-1-generate-update-testing-structure repair, or use 3b (Playwright MCP) / DOM annotation meanwhile; every skill file was still synced`);
if (rerunFailed) hints.push(rerunFailed);
print({
  tool: 'sync-qa-skills', mode, target, source, owned: OWNED, skillsChecked: wanted,
  uppercaseDir: uppercaseDir ? `.claude/${existingName}` : null,
  files: files.map(({ src, ...rest }) => rest), summary, localOnlySkills, legacySkills, replace, mcp: mcpReport, tools: toolsReport, applied,
  reloadRequired: skillMdChanged || mcpChanged,
  hint: hints.length ? hints.join(' | ') : null,
}, args);

/* ---------------- helpers ---------------- */
// Clean replace of OUR skill folders only (planReplace decides which). The new copy is staged first; the old
// folder is moved aside, the new one moved in, then the old one deleted. Any failure restores the old folder.
function applyReplace() {
  const out = [];
  const stage = path.join(targetClaude, '.sync-replace');
  fs.mkdirSync(targetSkills, { recursive: true });
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  for (const skill of [...replacePlan.replace, ...replacePlan.install]) {
    const final = path.join(targetSkills, skill), fresh = path.join(stage, `${skill}.new`), old = path.join(stage, `${skill}.old`);
    const existed = isDir(final);
    try {
      fs.cpSync(path.join(srcSkills, skill), fresh, { recursive: true });
      if (existed) moveDir(final, old);
      moveDir(fresh, final);
      if (existed) fs.rmSync(old, { recursive: true, force: true });
      out.push({ action: existed ? 'replaced' : 'installed', folder: `.claude/skills/${skill}` });
    } catch (e) {
      try { if (existed && !isDir(final) && isDir(old)) moveDir(old, final); } catch {}
      out.push({ action: 'replace-failed', folder: `.claude/skills/${skill}`, error: e.message, kept: isDir(final) ? 'old folder kept' : 'folder missing — re-run /sync-skills' });
    }
  }
  fs.rmSync(stage, { recursive: true, force: true });
  return out;
}
// rename, with a copy + delete fallback (Windows can refuse a rename while an editor watches the folder).
function moveDir(from, to) {
  try { fs.renameSync(from, to); }
  catch { fs.cpSync(from, to, { recursive: true }); fs.rmSync(from, { recursive: true, force: true }); }
}
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
