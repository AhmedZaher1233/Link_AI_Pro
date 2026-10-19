#!/usr/bin/env node
// Self-test for skill 1's read-only scanners and the .mcp.json migration. No network, no registry, no writes
// outside a temporary folder. EXITS NON-ZERO ON MISMATCH BY DESIGN (harness, not a reporting script).
//
//   node .claude/skills/link-qc-1-generate-update-testing-structure/scripts/selftest.mjs [--pretty]
//
// Guards, in order:
//   1-2  applyMcpMigration() never changes the `azure-devops` entry — cloud or self-hosted — nor any other
//        non-docx / non-word server (byte-identical before and after), while it removes legacy `word` and
//        adds / re-pins `docx`.
//   3    planMcpMigration() never plans an action that names `azure-devops`.
//   4    detectAdoHosting(): cloud (dev.azure.com https / org@ / ssh / *.visualstudio.com), self-hosted (_git,
//        _workitems, /tfs/, port, bare org URL), not-ADO (GitHub, GitLab, ssh github, empty, garbage).
//   5    scanMcp(): package + PAT variable extraction for both entries; a literal token in AZURE_DEVOPS_PAT or
//        PERSONAL_ACCESS_TOKEN is an inline secret; `${VAR}` references are clean.
//   6    scanPat(): the referenced variable is the one checked; both names when there is no entry;
//        `sessionMissing` when the variable is persisted but absent from this process.
//   7    The template ships both entries with placeholders only, the self-hosted block has the four env keys, and the
//        optional attachments block runs the launcher with placeholders and no PAT / TOKEN key.
//   8    planReplace(): only OUR folders (SKILLS + SKILL_RENAMES) can be replaced / removed; every other skill folder
//        is kept; a wanted folder missing in the source is refused (never deleted); --only narrows the set.
//   9    scanMcp().adoAttachments / inspectAdoAttachmentsEntry(): present / launcher referenced / launcher on disk /
//        package pin / sha-current vs stale / literal token; absent on cloud.mcp.json and self-hosted.mcp.json; the
//        optional server is never in `missing`; a root without .mcp.json still carries the shape.
//   10   applyMcpMigration() leaves the `azure-devops-attachments` entry byte-identical (with azure-devops) and
//        planMcpMigration() never names it.
//   11   The launcher asset parses (node --check), pins ADO_ATTACHMENTS_PACKAGE_PIN, names both PAT variables, requires
//        node: builtins only, carries no real org / host and no token-looking literal.
//   12   validate-setup.mjs row `Azure DevOps attachments MCP`: present + launcher → NOT_RUN "configured"; cloud entry
//        without it → WARN "not configured"; present but launcher missing → WARN "missing"; self-hosted → PASS "not needed".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs, print, run, planMcpMigration, applyMcpMigration, detectAdoHosting, scanMcp, scanPat, inspectAdoEntry, inspectAdoAttachmentsEntry, scanAdoAttachments, adoAttachmentsLauncherAssetPath, ADO_SERVER, ADO_CLOUD_PACKAGE, ADO_SELF_HOSTED_PACKAGE, PAT_VAR_CLOUD, PAT_VAR_SELF_HOSTED, PAT_VARS, DOCX_SERVER, DOCX_ARGS, planReplace, SKILLS, ADO_ATTACHMENTS_SERVER, ADO_ATTACHMENTS_LAUNCHER, ADO_ATTACHMENTS_PACKAGE_PIN } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures', 'mcp');
const template = path.join(here, '..', 'assets', 'mcp.template.json');
const results = [];
const check = (id, name, ok, detail = null) => results.push({ id, name, status: ok ? 'PASS' : 'FAIL', detail });
const loadFixture = (f) => JSON.parse(fs.readFileSync(path.join(fixtures, f), 'utf8'));
const stable = (o) => JSON.stringify(o);

// A scratch root holding one fixture as its .mcp.json — scanMcp reads from disk. `launcher`: null (none), 'asset' (the
// shipped launcher copied to .claude/mcp-launchers/) or 'stale' (a one-line stub standing in for an outdated copy).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-skill1-selftest-'));
function rootWith(fixture, { launcher = null } = {}) {
  const dir = path.join(tmp, fixture.replace(/\W+/g, '_') + (launcher ? `_${launcher}` : ''));
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(fixtures, fixture), path.join(dir, '.mcp.json'));
  if (launcher) {
    const dst = path.join(dir, ADO_ATTACHMENTS_LAUNCHER);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (launcher === 'asset') fs.copyFileSync(adoAttachmentsLauncherAssetPath(), dst);
    else fs.writeFileSync(dst, '// stale stub — not the shipped launcher\n');
  }
  return dir;
}

// ---- 1-2. Migration leaves azure-devops (and every other non-docx / non-word server) byte-identical ----
for (const [id, fixture, expectDocxAction] of [[1, 'cloud.mcp.json', 'mcp-added'], [2, 'self-hosted.mcp.json', 'mcp-updated']]) {
  const before = loadFixture(fixture);
  const untouched = Object.fromEntries(Object.entries(before.mcpServers).filter(([n, s]) => n !== 'word' && !(Array.isArray(s.args) && s.args.includes('docx-mcp-server'))).map(([n, s]) => [n, stable(s)]));
  const { json, applied } = applyMcpMigration(structuredClone(before), '/fake/uvx', () => false);
  const same = Object.entries(untouched).every(([n, s]) => stable(json.mcpServers[n]) === s);
  const wordGone = !('word' in json.mcpServers);
  const docx = json.mcpServers[DOCX_SERVER];
  const docxOk = docx && stable(docx.args) === stable(DOCX_ARGS) && docx.command === '/fake/uvx';
  const actions = applied.map((a) => a.action);
  check(id, `applyMcpMigration keeps ${fixture.replace('.mcp.json', '')} azure-devops entry byte-identical, removes word, ${expectDocxAction === 'mcp-added' ? 'adds' : 'pins'} docx`,
    same && wordGone && docxOk && actions.includes('mcp-removed') && actions.includes(expectDocxAction) && !applied.some((a) => a.server === ADO_SERVER),
    { same, wordGone, docxOk, actions });
}

// ---- 3. The plan never names azure-devops ----
{
  const plans = ['cloud.mcp.json', 'self-hosted.mcp.json', 'self-hosted-inline-pat.mcp.json'].map((f) => planMcpMigration(loadFixture(f)));
  const ok = plans.every((p) => p.actions.every((a) => !a.includes(ADO_SERVER)) && !p.legacyWord.includes(ADO_SERVER));
  check(3, 'planMcpMigration never plans an action on azure-devops', ok, plans.map((p) => p.actions));
}

// ---- 4. Hosting detection ----
{
  const cases = [
    ['https://dev.azure.com/example-org/ExampleProject/_git/repo', { hosting: 'cloud', orgUrl: 'https://dev.azure.com/example-org', organization: 'example-org', project: 'ExampleProject' }],
    ['https://example-org@dev.azure.com/example-org/ExampleProject/_git/repo', { hosting: 'cloud', orgUrl: 'https://dev.azure.com/example-org', organization: 'example-org', project: 'ExampleProject' }],
    ['git@ssh.dev.azure.com:v3/example-org/ExampleProject/repo', { hosting: 'cloud', orgUrl: 'https://dev.azure.com/example-org', organization: 'example-org', project: 'ExampleProject' }],
    ['https://example-org.visualstudio.com/ExampleProject/_git/repo', { hosting: 'cloud', orgUrl: 'https://example-org.visualstudio.com', organization: 'example-org', project: 'ExampleProject' }],
    ['https://example-org.visualstudio.com/DefaultCollection/ExampleProject/_git/repo', { hosting: 'cloud', organization: 'example-org', project: 'ExampleProject' }],
    ['https://dev.azure.com/example-org/ExampleProject/_workitems/edit/123', { hosting: 'cloud', orgUrl: 'https://dev.azure.com/example-org', project: 'ExampleProject' }],
    ['https://dev.azure.com/example-org', { hosting: 'cloud', orgUrl: 'https://dev.azure.com/example-org', project: null }],
    ['https://devops.example.com/DefaultCollection/ExampleProject/_git/repo', { hosting: 'self-hosted', orgUrl: 'https://devops.example.com/DefaultCollection', collection: 'DefaultCollection', project: 'ExampleProject' }],
    ['https://devops.example.com/DefaultCollection/ExampleProject/_workitems/edit/123', { hosting: 'self-hosted', orgUrl: 'https://devops.example.com/DefaultCollection', project: 'ExampleProject' }],
    ['https://devops.example.com:8080/tfs/DefaultCollection/ExampleProject/_git/repo', { hosting: 'self-hosted', orgUrl: 'https://devops.example.com:8080/tfs/DefaultCollection', collection: 'DefaultCollection', project: 'ExampleProject' }],
    ['https://devops.example.com/DefaultCollection', { hosting: 'self-hosted', orgUrl: 'https://devops.example.com/DefaultCollection', project: null }],
    ['https://devops.example.com/tfs/DefaultCollection', { hosting: 'self-hosted', orgUrl: 'https://devops.example.com/tfs/DefaultCollection', collection: 'DefaultCollection' }],
    ['https://github.com/someone/repo.git', { hosting: null, orgUrl: null }],
    ['git@github.com:someone/repo.git', { hosting: null }],
    ['https://gitlab.com/group/sub/repo.git', { hosting: null }],
    ['', { hosting: null }],
    [null, { hosting: null }],
    ['not a url', { hosting: null }],
  ];
  const failures = [];
  for (const [url, expect] of cases) {
    const got = detectAdoHosting(url);
    for (const [k, v] of Object.entries(expect)) if (got[k] !== v) failures.push({ url, key: k, expected: v, got: got[k] });
  }
  check(4, `detectAdoHosting classifies ${cases.length} URLs (cloud / self-hosted / not ADO)`, failures.length === 0, failures.length ? failures : null);
}

// ---- 5. scanMcp: package, PAT variable, inline secret ----
{
  const cloud = scanMcp(rootWith('cloud.mcp.json')).azureDevops;
  const self = scanMcp(rootWith('self-hosted.mcp.json')).azureDevops;
  const selfInline = scanMcp(rootWith('self-hosted-inline-pat.mcp.json'));
  const cloudInline = scanMcp(rootWith('cloud-inline-pat.mcp.json'));
  const cloudOk = cloud.present && cloud.package === 'cloud' && cloud.hosting === 'cloud' && cloud.patVar === PAT_VAR_CLOUD && cloud.patKey === 'PERSONAL_ACCESS_TOKEN' && !cloud.inlinePat;
  const selfOk = self.present && self.package === 'self-hosted' && self.hosting === 'self-hosted' && self.patVar === PAT_VAR_SELF_HOSTED && self.patKey === PAT_VAR_SELF_HOSTED && self.orgUrl === 'https://devops.example.com/DefaultCollection' && self.defaultProject === 'ExampleProject' && self.authMethod === 'pat' && !self.inlinePat;
  const cleanOk = !scanMcp(rootWith('cloud.mcp.json')).inlineSecrets && !scanMcp(rootWith('self-hosted.mcp.json')).inlineSecrets;
  const selfInlineOk = selfInline.inlineSecrets && selfInline.azureDevops.inlinePat && selfInline.azureDevops.patVar === null;
  const cloudInlineOk = cloudInline.inlineSecrets && cloudInline.azureDevops.inlinePat;
  const missingOk = inspectAdoEntry(undefined).present === false && inspectAdoEntry(undefined).patVar === null;
  check(5, 'scanMcp reads both azure-devops entries (package, PAT variable, org URL) and flags a literal token in AZURE_DEVOPS_PAT / PERSONAL_ACCESS_TOKEN',
    cloudOk && selfOk && cleanOk && selfInlineOk && cloudInlineOk && missingOk, { cloudOk, selfOk, cleanOk, selfInlineOk, cloudInlineOk, missingOk, cloud, self });
  // Secret hygiene of the payload itself: no scanner output may carry the literal token from the fixture.
  const attInline = scanMcp(rootWith('cloud-attachments-inline-pat.mcp.json'));
  const leaked = JSON.stringify([selfInline, cloudInline, attInline]).includes('notarealtoken') || JSON.stringify([selfInline, cloudInline, attInline]).includes('OjAwMDAw');
  check('5b', 'scanMcp output never contains the token value', !leaked);
}

// ---- 6. scanPat follows the referenced variable; session-vs-machine ----
{
  const probe = (envSet, persistedSet) => ({ inProcess: (n) => envSet.includes(n), persisted: (n) => ({ persisted: persistedSet.includes(n), scope: 'test' }) });
  const a = scanPat(PAT_VAR_SELF_HOSTED, probe([], [PAT_VAR_CLOUD]));            // self-hosted entry, only the cloud var exists → not set
  const b = scanPat(PAT_VAR_SELF_HOSTED, probe([], [PAT_VAR_SELF_HOSTED]));      // saved, not in session
  const c = scanPat(PAT_VAR_SELF_HOSTED, probe([PAT_VAR_SELF_HOSTED], [PAT_VAR_SELF_HOSTED])); // ready
  const d = scanPat(null, probe([], [PAT_VAR_SELF_HOSTED]));                     // no entry: both checked, the set one reported
  const e = scanPat(null, probe([], []));                                        // nothing anywhere
  const ok = a.name === PAT_VAR_SELF_HOSTED && !a.persisted && !a.inProcess && !a.sessionMissing && stable(a.checked) === stable([PAT_VAR_SELF_HOSTED])
    && b.persisted && !b.inProcess && b.sessionMissing && typeof b.restartHint === 'string' && /quit/i.test(b.restartHint)
    && c.persisted && c.inProcess && !c.sessionMissing
    && d.name === PAT_VAR_SELF_HOSTED && d.persisted && stable(d.checked) === stable(PAT_VARS)
    && e.name === PAT_VAR_CLOUD && !e.persisted && !e.inProcess && stable(e.checked) === stable(PAT_VARS);
  check(6, 'scanPat checks the variable the entry references, both names without an entry, and reports sessionMissing', ok, { a, b, c, d, e });
}

// ---- 7. Template: both entries, placeholders only ----
{
  const t = JSON.parse(fs.readFileSync(template, 'utf8'));
  const cloud = t.mcpServers?.[ADO_SERVER];
  const self = t._self_hosted_azure_devops_server?.[ADO_SERVER];
  const cloudOk = cloud && cloud.args.includes(ADO_CLOUD_PACKAGE) && cloud.env.PERSONAL_ACCESS_TOKEN === `\${${PAT_VAR_CLOUD}}`;
  const selfOk = self && self.args.includes(ADO_SELF_HOSTED_PACKAGE) && self.env.AZURE_DEVOPS_PAT === `\${${PAT_VAR_SELF_HOSTED}}` && self.env.AZURE_DEVOPS_AUTH_METHOD === 'pat' && self.env.AZURE_DEVOPS_ORG_URL === '{ORG_URL}' && self.env.AZURE_DEVOPS_DEFAULT_PROJECT === '{PROJECT_NAME}';
  const text = fs.readFileSync(template, 'utf8');
  const noData = !/nupco|linkdev|link-dev|dev\.azure\.com\/[a-z]/i.test(text);
  const bothInspect = inspectAdoEntry(cloud).package === 'cloud' && inspectAdoEntry(self).package === 'self-hosted' && !inspectAdoEntry(cloud).inlinePat && !inspectAdoEntry(self).inlinePat;
  const att = t._optional_azure_devops_attachments_server?.[ADO_ATTACHMENTS_SERVER];
  const attShape = att ? inspectAdoAttachmentsEntry(att) : null;
  const attOk = att && att.command === 'node' && stable(att.args) === stable([ADO_ATTACHMENTS_LAUNCHER]) && att.env.AZURE_DEVOPS_ORG_URL === 'https://dev.azure.com/{ORG_NAME}' && att.env.AZURE_DEVOPS_AUTH_METHOD === 'pat' && att.env.AZURE_DEVOPS_DEFAULT_PROJECT === '{PROJECT_NAME}'
    && !Object.keys(att.env).some((k) => /PAT|TOKEN/i.test(k)) && attShape.launcherReferenced && !attShape.inlinePat && !(ADO_ATTACHMENTS_SERVER in (t.mcpServers || {}));
  check(7, 'mcp.template.json ships the cloud entry, the self-hosted block and the optional attachments block with placeholders only', Boolean(cloudOk && selfOk && noData && bothInspect && attOk), { cloudOk: Boolean(cloudOk), selfOk: Boolean(selfOk), noData, bothInspect, attOk: Boolean(attOk) });
}

// ---- 8. planReplace: our folders only ----
{
  const ours = ['link-qc-1-generate-update-testing-structure', 'link-qc-5-test-run-automation', 'link-qc-6-ui-testing'];
  const targetDirs = [...ours, 'i-have-adhd', 'qc-ui', 'find-skills', 'my-own-skill'];
  const sourceDirs = SKILLS.filter((x) => x !== 'link-qc-6-ui-testing');         // source lacks skill 6
  const a = planReplace({ targetDirs, wanted: SKILLS, sourceDirs });
  const b = planReplace({ targetDirs, wanted: ['link-qc-5-test-run-automation', 'not-a-skill'], sourceDirs: SKILLS });
  const touched = [...a.replace, ...a.remove.map((r) => r.folder), ...b.replace, ...b.remove.map((r) => r.folder)];
  const ok = stable(a.replace) === stable(ours.slice(0, 2))
    && stable(a.remove.map((r) => r.folder)) === stable(['i-have-adhd'])                // qc-ui's replacement (skill 6) is missing in source
    && stable(a.keep) === stable(['find-skills', 'my-own-skill'])
    && stable(a.refused.map((r) => r.folder)) === stable(['link-qc-6-ui-testing'])
    && a.install.length === SKILLS.length - 3 && !a.install.includes('link-qc-6-ui-testing')
    && stable(b.replace) === stable(['link-qc-5-test-run-automation']) && b.remove.length === 0 && b.install.length === 0
    && !touched.some((x) => ['find-skills', 'my-own-skill', 'not-a-skill'].includes(x));
  check(8, 'planReplace deletes only our skill folders, keeps every other skill, refuses a folder missing in the source, honours --only', ok, { a, b });
}

// ---- 9. The optional attachments server: entry shape, launcher on disk, freshness, never required ----
{
  const a = scanMcp(rootWith('cloud-attachments.mcp.json', { launcher: 'asset' }));
  const b = scanMcp(rootWith('cloud-attachments.mcp.json'));
  const c = scanMcp(rootWith('cloud-attachments.mcp.json', { launcher: 'stale' }));
  const d = [scanMcp(rootWith('cloud.mcp.json')), scanMcp(rootWith('self-hosted.mcp.json'))];
  const e = scanMcp(rootWith('cloud-attachments-inline-pat.mcp.json'));
  const noFile = scanMcp(path.join(tmp, 'no-mcp-json'));
  const aa = a.adoAttachments;
  const aOk = aa.present && aa.launcherReferenced && aa.launcherExists && aa.package === ADO_ATTACHMENTS_PACKAGE_PIN && aa.pinned === true && aa.launcherCurrent === true && typeof aa.assetSha256 === 'string'
    && !aa.inlinePat && aa.orgUrl === 'https://dev.azure.com/example-org' && aa.defaultProject === 'ExampleProject' && aa.authMethod === 'pat'
    && a.optional[ADO_ATTACHMENTS_SERVER] === true && !a.inlineSecrets && !a.missing.includes(ADO_ATTACHMENTS_SERVER) && a.azureDevops.package === 'cloud';
  const bOk = b.adoAttachments.present && b.adoAttachments.launcherReferenced && !b.adoAttachments.launcherExists && b.adoAttachments.package === null && b.adoAttachments.launcherCurrent === null;
  const cOk = c.adoAttachments.launcherExists && c.adoAttachments.launcherCurrent === false && c.adoAttachments.package === null && c.adoAttachments.pinned === null;
  const dOk = d.every((m) => m.adoAttachments.present === false && m.optional[ADO_ATTACHMENTS_SERVER] === false && !m.missing.includes(ADO_ATTACHMENTS_SERVER));
  const eOk = e.adoAttachments.inlinePat && e.inlineSecrets;
  const f1 = inspectAdoAttachmentsEntry({ command: 'npx', args: ['-y', ADO_ATTACHMENTS_PACKAGE_PIN] });
  const f2 = inspectAdoAttachmentsEntry({ command: 'C:\\Program Files\\nodejs\\node.exe', args: ['.\\.claude\\mcp-launchers\\azure-devops-attachments.cjs'] });
  const fOk = f1.present && !f1.launcherReferenced && f2.present && f2.launcherReferenced && inspectAdoAttachmentsEntry(undefined).present === false;
  const noFileOk = noFile.exists === false && noFile.adoAttachments && noFile.adoAttachments.present === false && noFile.optional[ADO_ATTACHMENTS_SERVER] === false;
  check(9, 'scanMcp reads the optional azure-devops-attachments entry (launcher referenced / on disk / pinned / current vs stale / literal token), absent on the plain fixtures, never required',
    aOk && bOk && cOk && dOk && eOk && fOk && noFileOk, { aOk, bOk, cOk, dOk, eOk, fOk, noFileOk, a: aa, b: b.adoAttachments, c: c.adoAttachments });
}

// ---- 10. Migration guard for the attachments entry ----
{
  const before = loadFixture('cloud-attachments.mcp.json');
  const keep = { [ADO_SERVER]: stable(before.mcpServers[ADO_SERVER]), [ADO_ATTACHMENTS_SERVER]: stable(before.mcpServers[ADO_ATTACHMENTS_SERVER]) };
  const { json, applied } = applyMcpMigration(structuredClone(before), '/fake/uvx', () => false);
  const same = Object.entries(keep).every(([n, s]) => stable(json.mcpServers[n]) === s);
  const wordGone = !('word' in json.mcpServers);
  const docx = json.mcpServers[DOCX_SERVER];
  const docxOk = docx && stable(docx.args) === stable(DOCX_ARGS);
  const noTouch = !applied.some((x) => [ADO_SERVER, ADO_ATTACHMENTS_SERVER].includes(x.server));
  const plans = ['cloud-attachments.mcp.json', 'cloud-attachments-inline-pat.mcp.json'].map((f) => planMcpMigration(loadFixture(f)));
  const planOk = plans.every((p) => p.actions.every((a) => !a.includes(ADO_ATTACHMENTS_SERVER) && !a.includes(ADO_SERVER)) && !p.legacyWord.includes(ADO_ATTACHMENTS_SERVER));
  check(10, 'applyMcpMigration leaves azure-devops-attachments (and azure-devops) byte-identical, removes word, adds docx; planMcpMigration never names it', same && wordGone && docxOk && noTouch && planOk, { same, wordGone, docxOk: Boolean(docxOk), noTouch, planOk });
}

// ---- 11. The launcher asset ----
{
  const asset = adoAttachmentsLauncherAssetPath();
  const text = asset ? fs.readFileSync(asset, 'utf8') : '';
  const parses = asset ? run(`node --check "${asset}"`).ok : false;
  const ok = Boolean(asset) && parses
    && text.includes(ADO_ATTACHMENTS_PACKAGE_PIN) && text.includes(PAT_VAR_CLOUD) && text.includes(PAT_VAR_SELF_HOSTED) && text.includes("'use strict'")
    && !/require\(\s*['"](?!node:)/.test(text)
    && !/nupco|linkdev|link-dev|dev\.azure\.com\/[a-z]/i.test(text)
    && !/[A-Za-z0-9+/]{40,}={0,2}/.test(text);
  check(11, 'launcher asset parses, pins the package, names both PAT variables, requires node: builtins only, carries no data or token-looking literal', ok, { asset, parses });
}

// ---- 12. validate-setup.mjs row for the optional server ----
{
  const validate = path.join(here, 'validate-setup.mjs');
  const rowFor = (root) => {
    const r = spawnSync(process.execPath, [validate, '--root', root], { encoding: 'utf8' });
    try { return JSON.parse(r.stdout).rows.find((x) => x.item === 'Azure DevOps attachments MCP') || null; } catch { return null; }
  };
  const present = rowFor(rootWith('cloud-attachments.mcp.json', { launcher: 'asset' }));
  const absent = rowFor(rootWith('cloud.mcp.json'));
  const missing = rowFor(rootWith('cloud-attachments.mcp.json'));
  const stale = rowFor(rootWith('cloud-attachments.mcp.json', { launcher: 'stale' }));
  const selfHosted = rowFor(rootWith('self-hosted.mcp.json'));
  const ok = present?.status === 'NOT_RUN' && /configured/.test(present.reason)
    && absent?.status === 'WARN' && /not configured/.test(absent.reason)
    && missing?.status === 'WARN' && /missing/.test(missing.reason)
    && stale?.status === 'WARN' && /outdated/.test(stale.reason)
    && selfHosted?.status === 'PASS' && /not needed/.test(selfHosted.reason);
  check(12, 'validate-setup row: present → NOT_RUN configured; cloud without it → WARN; launcher missing / outdated → WARN; self-hosted → PASS not needed', ok, { present, absent, missing, stale, selfHosted });
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

const failed = results.filter((r) => r.status !== 'PASS');
print({ tool: 'selftest-skill1', cases: results.length, passed: results.length - failed.length, failed: failed.length, results, overall: failed.length ? 'FAIL' : 'PASS' }, args);
process.exit(failed.length ? 1 : 0);
