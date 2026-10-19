#!/usr/bin/env node
// fake-playwright.mjs — stands in for `playwright test`, used ONLY by selftest-scratch.mjs.
// Called as `test <spec name> --config <overlay> [--grep <text>]` with cwd = the automation root. A marker in the
// probe (`fake:<mode>`) picks the behaviour: pass (default) · fail · secret (prints a credential line and the value
// of A1_PASSWORD) · hang (never exits) · write-outside (writes pages/Leak.ts) · no-report (exits without the json).
// Every call records its argv, cwd and the PW_* variables it received in fake-call.json next to the overlay.
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const overlay = argv[argv.indexOf('--config') + 1];
const dir = path.dirname(overlay);
const specName = argv[1];
const spec = fs.readFileSync(path.join(dir, specName), 'utf8');
const mode = (spec.match(/fake:([a-z-]+)/) || [])[1] || 'pass';
const env = process.env;
fs.writeFileSync(path.join(dir, 'fake-call.json'), JSON.stringify({
  argv, cwd: process.cwd(), mode,
  env: Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('PW_'))),
}, null, 2));

console.log('Running 1 test using 1 worker');
if (mode === 'secret') { console.log('password: hunter2-literal'); console.log('typed value ' + env.A1_PASSWORD); }
if (mode === 'hang') { setInterval(() => {}, 1000); }
else {
  if (mode === 'write-outside') fs.writeFileSync(path.join(process.cwd(), 'pages', 'Leak.ts'), 'export const leak = 1;\n');
  if (mode === 'no-report') { console.error('Error: config could not be loaded'); process.exit(1); }
  const out = env.PW_OUTPUT_DIR;
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'trace.zip'), 'fake trace');
  const failed = mode === 'fail';
  const report = { suites: [{ title: specName, specs: [{ title: 'probe › save button resolves', tests: [{ projectName: 'chromium', results: [{
    status: failed ? 'failed' : 'passed', duration: 12,
    ...(failed ? { error: { message: 'Error: locator.click: password: hunter2-literal\n    at probe.spec.ts:9' } } : {}),
    attachments: [{ name: 'trace', path: path.join(out, 'trace.zip') }, { name: 'outside', path: path.join(process.cwd(), 'pages', 'LoginPage.ts') }],
  }] }] }] }] };
  fs.writeFileSync(env.PW_SCRATCH_JSON, JSON.stringify(report));
  console.log(failed ? '  1 failed' : '  1 passed');
  process.exit(failed ? 1 : 0);
}
