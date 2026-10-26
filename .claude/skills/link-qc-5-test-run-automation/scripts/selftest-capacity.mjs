#!/usr/bin/env node
// selftest-capacity.mjs — regression harness for capacity.mjs and ledger-exec.mjs.
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. It is a harness, not a reporting script.
// A failing self-test means the machine ceiling, the ledger or the environment lease cannot be trusted: runs must then
// stay at today's worker settings with the ledger switched off (and so no concurrent dispatch).
//
// Every expectation is worked out by hand from injected process tables (no real process listing), injected clocks, an
// injected DNS resolver (no network) and temporary coordination folders: the coordination directory (T-19), the
// lower-only ceiling (T-8), atomic reservations under contention (T-1), two-phase spawn and the 60 s grace (T-4), a stale
// heartbeat with live children (T-3), profile markers and PID reuse (T-5), the lock protocol and torn writes (T-6),
// committed-but-unobserved demand (T-7), the pressure thresholds (T-37), environment identity (T-18), the lease
// lifecycle (T-16 / T-17), reclaim, the process-table parsers, the CLI, the ledger-exec wrapper, EXCLUSIVE execution (the hard
// cap when the ledger is rolled back: one command at a time, PID-judged, swept without a table), skill 9 beside skill 5
// (session holds under the same ceiling, a lease accepted for its run file, contention in both directions), CONFIRMED
// release (20: orphans of ended processes, PID reuse, the environment token, no table → held, never freed by a PID check),
// session holds of skills 3c / 5b / 9 beside skill 5 (21: one hold per session, confirmed close, abandoned sessions) and,
// on the REAL process table with owned local processes, cancellation and clean-up (22: orphaned, held, reclaimed — only
// the run's own; a look-alike survives).
//
// Run: node selftest-capacity.mjs [--pretty]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as cap from './capacity.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(here, 'fixtures', 'capacity');
const CAP = path.join(here, 'capacity.mjs');
const EXEC = path.join(here, 'ledger-exec.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-capacity-selftest-'));
let seq = 0;
const mk = (name) => { const d = path.join(TMP, String(++seq) + '-' + name); fs.mkdirSync(d, { recursive: true }); return d; };
const T0 = Date.parse('2026-01-01T00:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const NO_SNAPSHOT = async () => ({ rows: null, error: 'harness: no real process table' });
const LOCK = { snapshot: NO_SNAPSHOT, giveUpMs: 5000, pollMs: 5 };

const cases = [];
const fail = [];
const eq = (p, what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) p.push(what + ': ' + JSON.stringify(got) + ' != ' + JSON.stringify(want)); };
async function test(name, fn) {
  const p = [];
  let detail;
  try { detail = await fn(p); } catch (e) { p.push('threw: ' + ((e && e.stack) || e)); }
  cases.push({ case: name, ok: p.length === 0, problems: p, detail });
  if (p.length) fail.push({ case: name, problems: p });
}
const entryOf = (dir, token) => cap.readLedger(dir).entries.find((e) => e.token === token) || null;

/* 1 — the coordination directory: an absolute QA_CAPACITY_DIR, else ~/.link-ai-pro/capacity (T-19). */
await test('1 coordination directory: absolute QA_CAPACITY_DIR or the home default', async (p) => {
  const abs = path.join(TMP, 'shared-capacity');
  const home = path.join(os.homedir(), '.link-ai-pro', 'capacity');
  eq(p, 'absolute QA_CAPACITY_DIR', cap.resolveCapacityDir({ QA_CAPACITY_DIR: abs }), path.resolve(abs));
  const relInfo = cap.describeCapacityDir({ QA_CAPACITY_DIR: 'relative/dir' });
  eq(p, 'a relative value is ignored with a warning', [relInfo.dir, relInfo.source, /not an absolute path/.test(relInfo.warning || '')], [home, 'home', true]);
  eq(p, 'unset → home', cap.resolveCapacityDir({}), home);
  eq(p, 'rate-limit state lives in the same directory', cap.rateLimitStatePath(abs, 'abc123'), path.join(abs, 'rate-limits', 'abc123.json'));
  eq(p, 'ledger file', cap.ledgerFile(abs), path.join(abs, 'ledger.json'));
});

/* 2 — the ceiling is AUTO (the host's TOTAL memory / CPU, headed demand), bounded by config.json machineMaxWorkers
   (AUTO_MAX without one); every other limit may only lower it; unusable readings → the conservative fallback (T-8).
   Host 16 GB / 8 cores, headed: reserve 4096 MB + 2 cores → by memory (16384 − 4096) / 1536 = 8, by CPU (8 − 2) / 1.5 = 4 → 4. */
await test('2 machine ceiling: Auto from the host, config upper bound, lower-only overrides, fail-safe (T-8)', async (p) => {
  const pick = (r) => ({ ceiling: r.ceiling, source: r.source, configured: r.configured, lowered: r.lowered, refusedRaises: r.refusedRaises, invalid: r.invalid });
  const H = { totalMemMb: 16384, cpus: 8 };
  const BIG = { totalMemMb: 131072, cpus: 32 };
  const none = mk('no-config');
  eq(p, 'no file → Auto 4 on 16 GB / 8 cores', pick(cap.resolveCeiling({ dir: none, env: {}, host: H })), { ceiling: 4, source: 'auto', configured: false, lowered: [], refusedRaises: [], invalid: [] });
  eq(p, 'Auto basis recorded', (({ byMem, byCpu, upper }) => ({ byMem, byCpu, upper }))(cap.resolveCeiling({ dir: none, env: {}, host: H }).auto.basis), { byMem: 8, byCpu: 4, upper: cap.AUTO_MAX });
  eq(p, 'headless demand admits more', cap.resolveCeiling({ dir: none, env: {}, host: H, kind: 'headless' }).ceiling, 8);
  eq(p, 'a large host stops at AUTO_MAX (a safety bound, not the chosen count)', cap.resolveCeiling({ dir: none, env: {}, host: BIG }).ceiling, cap.AUTO_MAX);
  eq(p, 'QA_MAX_WORKERS cannot raise Auto', pick(cap.resolveCeiling({ dir: none, env: { QA_MAX_WORKERS: '6' }, host: H })), { ceiling: 4, source: 'auto', configured: false, lowered: [], refusedRaises: [{ by: 'QA_MAX_WORKERS', value: 6 }], invalid: [] });
  eq(p, 'QA_MAX_WORKERS lowers Auto', cap.resolveCeiling({ dir: none, env: { QA_MAX_WORKERS: '3' }, host: H }).ceiling, 3);
  const fb = cap.resolveCeiling({ dir: none, env: {}, host: { totalMemMb: 0, cpus: 0 } });
  eq(p, 'unusable readings → the fallback, with the reason', [fb.ceiling, fb.source, /unavailable/.test(fb.auto.reason || '')], [cap.AUTO_FALLBACK, 'auto-fallback', true]);
  const four = mk('config-4');
  fs.writeFileSync(path.join(four, 'config.json'), JSON.stringify({ machineMaxWorkers: 4, classes: { compliance: 3, reviewer: 'x' } }));
  eq(p, 'config is the upper bound of Auto', pick(cap.resolveCeiling({ dir: four, env: {}, host: BIG })), { ceiling: 4, source: 'auto', configured: true, lowered: [], refusedRaises: [], invalid: [] });
  eq(p, 'lower-only chain', pick(cap.resolveCeiling({ dir: four, env: { QA_MAX_WORKERS: '6' }, manifest: { execution: { maxWorkers: 3 } }, workersFlag: 1, host: BIG })),
    { ceiling: 1, source: 'auto', configured: true, lowered: [{ by: 'manifest', value: 3 }, { by: '--workers', value: 1 }], refusedRaises: [{ by: 'QA_MAX_WORKERS', value: 6 }], invalid: [] });
  eq(p, '--workers above the bound is refused', pick(cap.resolveCeiling({ dir: four, env: {}, workersFlag: 5, host: BIG })), { ceiling: 4, source: 'auto', configured: true, lowered: [], refusedRaises: [{ by: '--workers', value: 5 }], invalid: [] });
  eq(p, 'a value between the effective and the bound has no effect', pick(cap.resolveCeiling({ dir: four, env: { QA_MAX_WORKERS: '2' }, workersFlag: 3, host: BIG })), { ceiling: 2, source: 'auto', configured: true, lowered: [{ by: 'QA_MAX_WORKERS', value: 2 }], refusedRaises: [], invalid: [] });
  eq(p, 'an invalid value is listed, never applied', cap.resolveCeiling({ dir: four, env: { QA_MAX_WORKERS: 'abc' }, host: BIG }).invalid, [{ by: 'QA_MAX_WORKERS', value: 'abc' }]);
  const autoCfg = mk('config-auto');
  fs.writeFileSync(path.join(autoCfg, 'config.json'), JSON.stringify({ machineMaxWorkers: 'auto' }));
  eq(p, '"auto" in config.json = no bound beyond AUTO_MAX', [cap.resolveCeiling({ dir: autoCfg, env: {}, host: H }).ceiling, cap.readConfig(autoCfg).error], [4, null]);
  const cfg = cap.readConfig(four);
  eq(p, 'class limits: a valid override kept, an invalid one warned', [cfg.classes, cfg.warnings.length, cfg.error], [{ compliance: 3, reviewer: 2 }, 1, null]);
  const bad = mk('config-bad');
  fs.writeFileSync(path.join(bad, 'config.json'), '{ "machineMaxWorkers": ');
  const rb = cap.resolveCeiling({ dir: bad, env: {}, host: H });
  eq(p, 'an unreadable config fails safe to 1', [rb.ceiling, rb.source, /not valid JSON/.test(rb.configError || '')], [1, 'config-error', true]);
  const zero = mk('config-zero');
  fs.writeFileSync(path.join(zero, 'config.json'), JSON.stringify({ machineMaxWorkers: 0 }));
  const rz = cap.resolveCeiling({ dir: zero, env: {}, host: H });
  eq(p, 'machineMaxWorkers 0 fails safe to 1', [rz.ceiling, rz.source], [1, 'config-error']);
  // ONE shared value: a reservation records it; while anything runs, a run can lower it but never raise it
  const shared = mk('shared-ceiling');
  const r1 = await cap.reserve({ dir: shared, units: 1, limit: 4, machineCeiling: 4, owner: { runId: 'A' }, liveness: 'pid' });
  const led1 = cap.readLedger(shared);
  const r2 = await cap.reserve({ dir: shared, units: 4, limit: 6, machineCeiling: 6, owner: { runId: 'B' }, liveness: 'pid' });
  eq(p, 'a higher machine value beside a live reservation does not raise the shared ceiling', [r1.ok, led1.ceiling && led1.ceiling.value, r2.ok, r2.code, cap.readLedger(shared).ceiling.value], [true, 4, false, 'busy', 4]);
  await cap.forceRelease({ dir: shared, token: r1.token });
  const r3 = await cap.reserve({ dir: shared, units: 6, limit: 6, machineCeiling: 6, owner: { runId: 'B' }, liveness: 'pid' });
  eq(p, 'an idle ledger takes the new value', [r3.ok, cap.readLedger(shared).ceiling.value], [true, 6]);
  if (r3.ok) await cap.forceRelease({ dir: shared, token: r3.token });
});

/* 3 — reserves, container limits, CPU sampling. */
await test('3 reserves (local / CI), cgroup v2 caps, CPU sampler', async (p) => {
  eq(p, 'local 16 GB', cap.reservesFor({ ci: false, totalMemMb: 16384, cpus: 8 }), { memMb: 4096, cores: 2 });
  eq(p, 'local 4 GB → the 2 GB floor', cap.reservesFor({ ci: false, totalMemMb: 4096 }), { memMb: 2048, cores: 2 });
  eq(p, 'CI 8 GB → the 1 GB floor', cap.reservesFor({ ci: true, totalMemMb: 8192 }), { memMb: 1024, cores: 1 });
  eq(p, 'CI 32 GB → 10 %', cap.reservesFor({ ci: true, totalMemMb: 32768 }), { memMb: 3277, cores: 1 });
  const files = { '/sys/fs/cgroup/memory.max': '4294967296\n', '/sys/fs/cgroup/memory.current': '1073741824', '/sys/fs/cgroup/cpu.max': '150000 100000' };
  const reader = (map) => (f) => { if (map[f] === undefined) throw new Error('ENOENT ' + f); return map[f]; };
  eq(p, 'cgroup v2 caps memory and CPU', cap.hostResources({ platform: 'linux', readFile: reader(files), totalmem: 16 * 1024 ** 3, freemem: 8 * 1024 ** 3, cpus: 8 }),
    { totalMemMb: 4096, availableMb: 3072, cpus: 1.5, cgroup: { memMaxMb: 4096, memCurrentMb: 1024, cpuLimit: 1.5 } });
  eq(p, '"max" means no container cap', cap.hostResources({ platform: 'linux', readFile: reader({ '/sys/fs/cgroup/memory.max': 'max', '/sys/fs/cgroup/cpu.max': 'max 100000' }), totalmem: 16 * 1024 ** 3, freemem: 8 * 1024 ** 3, cpus: 8 }),
    { totalMemMb: 16384, availableMb: 8192, cpus: 8, cgroup: { memMaxMb: null, memCurrentMb: null, cpuLimit: null } });
  eq(p, 'no cgroup read on Windows', cap.hostResources({ platform: 'win32', readFile: () => { throw new Error('must not be read'); }, totalmem: 8 * 1024 ** 3, freemem: 3 * 1024 ** 3, cpus: 4 }),
    { totalMemMb: 8192, availableMb: 3072, cpus: 4, cgroup: { memMaxMb: null, memCurrentMb: null, cpuLimit: null } });
  let call = 0;
  const ticks = [{ user: 100, nice: 0, sys: 0, idle: 300, irq: 0 }, { user: 150, nice: 0, sys: 0, idle: 350, irq: 0 }];
  const sampler = cap.createCpuSampler({ cpus: () => { const t = ticks[Math.min(call++, 1)]; return [{ times: t }, { times: t }]; } });
  eq(p, '50 % busy on 2 cores → 1 idle core', sampler.sample(), { cpuPct: 50, idleCores: 1 });
  eq(p, 'no delta → unknown', sampler.sample(), { cpuPct: null, idleCores: null });
});

/* 4 — concurrent reservations never exceed the ceiling, per class (T-1); waits, admission, invalid input, FIFO-with-fit. */
await test('4 atomic reservations: ceiling never exceeded under contention, per class (T-1)', async (p) => {
  const d = mk('t1');
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => cap.reserve({ dir: d, units: 1, limit: 2, owner: { runId: 'R' + i }, lock: LOCK })));
  eq(p, 'granted', results.filter((r) => r.ok).length, 2);
  eq(p, 'refused as busy', results.filter((r) => !r.ok && r.code === 'busy').length, 4);
  eq(p, 'units in the ledger', cap.usedUnits(cap.readLedger(d).entries, 'playwright'), 2);
  const big = await cap.reserve({ dir: d, units: 3, limit: 2, owner: { runId: 'X' }, lock: LOCK });
  eq(p, 'a request above the limit can never fit', [big.ok, big.code], [false, 'exceeds-limit']);
  const comp = await cap.reserve({ dir: d, cls: 'compliance', units: 2, limit: 2, owner: { runId: 'C' }, lock: LOCK });
  eq(p, 'the compliance class has its own limit', comp.ok, true);
  const comp2 = await cap.reserve({ dir: d, cls: 'compliance', units: 1, limit: 2, owner: { runId: 'C2' }, lock: LOCK });
  eq(p, 'compliance full', [comp2.ok, comp2.code], [false, 'busy']);
  const granted = results.filter((r) => r.ok);
  const rel = await cap.release({ dir: d, token: granted[0].token, rows: [], lock: LOCK });
  eq(p, 'release with nothing alive', rel.released, true);
  const two = await cap.reserve({ dir: d, units: 2, limit: 2, owner: { runId: 'T' }, lock: LOCK });
  eq(p, 'two slots needed, one free', [two.ok, two.code], [false, 'busy']);
  const t = Date.now();
  const w = await cap.reserve({ dir: d, units: 2, limit: 2, owner: { runId: 'W' }, waitMs: 120, pollMs: 30, lock: LOCK });
  eq(p, 'a bounded wait ends busy', [w.ok, w.code, Date.now() - t >= 120, cap.readLedger(d).queue.length], [false, 'busy', true, 0]);
  const zero = await cap.reserve({ dir: d, units: 0, limit: 2, lock: LOCK });
  eq(p, 'units 0 is invalid', [zero.ok, zero.code], [false, 'invalid']);
  const d2 = mk('t1-admission');
  const adm = await cap.reserve({ dir: d2, units: 1, limit: 2, admission: () => ({ ok: false, reasons: ['host pressure'] }), lock: LOCK });
  eq(p, 'admission refusal', [adm.ok, adm.code, adm.reasons, cap.readLedger(d2).entries.length], [false, 'admission', ['host pressure'], 0]);
  const q = [{ token: 'a', cls: 'playwright', units: 1, since: 1 }, { token: 'b', cls: 'playwright', units: 1, since: 2 }, { token: 'c', cls: 'compliance', units: 1, since: 0 }];
  eq(p, 'FIFO: the older waiter that fits goes first', [cap.grantable({ queue: q, token: 'b', cls: 'playwright', units: 1, free: 1 }), cap.grantable({ queue: q, token: 'a', cls: 'playwright', units: 1, free: 1 })], [false, true]);
  const q2 = [{ token: 'a', cls: 'playwright', units: 2, since: 1 }, { token: 'b', cls: 'playwright', units: 1, since: 2 }];
  eq(p, 'no head-of-line blocking by a waiter that does not fit', cap.grantable({ queue: q2, token: 'b', cls: 'playwright', units: 1, free: 1 }), true);
  eq(p, 'an unqueued request respects every fitting waiter', cap.grantable({ queue: q, token: null, cls: 'playwright', units: 1, free: 1 }), false);
});

/* 5 — two-phase spawn: wrapper registration holds the capacity; the 60 s grace; the token scan (T-4). */
await test('5 two-phase spawn: self-registration, 60 s grace, token scan (T-4)', async (p) => {
  const d = mk('t4');
  const owner = { pid: 3000, start: 1_000_000, runId: 'R1', runFile: '/r/.runs/phase-1.json' };
  const a = await cap.reserve({ dir: d, units: 1, limit: 2, owner, now: T0, lock: LOCK });
  await cap.registerWrapper({ dir: d, token: a.token, pid: 4001, start: 2_000_000, lock: LOCK });
  const wrapperRow = { pid: 4001, ppid: 1, rssBytes: 0, start: 2_000_000, cmd: 'node ledger-exec.mjs ' + a.token + ' -- node cli.js test' };
  let s = await cap.sweep({ dir: d, rows: [wrapperRow], now: T0 + 5000, lock: LOCK });
  eq(p, 'owner gone, wrapper alive → orphaned', s.orphaned.map((x) => x.token), [a.token]);
  eq(p, 'orphaned capacity is still counted', cap.usedUnits(cap.readLedger(d).entries, 'playwright'), 1);
  s = await cap.sweep({ dir: d, rows: [], now: T0 + 6000, lock: LOCK });
  eq(p, 'tree gone → released', s.released.map((x) => x.token), [a.token]);
  const b = await cap.reserve({ dir: d, units: 1, limit: 2, owner, now: T0, lock: LOCK });
  s = await cap.sweep({ dir: d, rows: [], now: T0 + 30000, lock: LOCK });
  eq(p, 'never registered, owner gone, inside the 60 s grace → kept', [s.kept.map((x) => x.token), s.released.length], [[b.token], 0]);
  s = await cap.sweep({ dir: d, rows: [{ pid: 4100, ppid: 1, start: 5_000_000, cmd: 'node ledger-exec.mjs ' + b.token + ' -- x' }], now: T0 + 61000, lock: LOCK });
  eq(p, 'after the grace the token is found → orphaned, wrapper recorded', [s.orphaned.map((x) => x.token), (entryOf(d, b.token) || {}).wrapper], [[b.token], { pid: 4100, start: 5_000_000 }]);
  s = await cap.sweep({ dir: d, rows: [], now: T0 + 62000, lock: LOCK });
  eq(p, 'then gone → released', s.released.map((x) => x.token), [b.token]);
  const c = await cap.reserve({ dir: d, units: 1, limit: 2, owner, now: T0, lock: LOCK });
  s = await cap.sweep({ dir: d, rows: [], now: T0 + 61000, lock: LOCK });
  eq(p, 'after the grace with no token anywhere → released', s.released.map((x) => x.token), [c.token]);
  const e = await cap.reserve({ dir: d, units: 1, limit: 2, owner, now: T0, lock: LOCK });
  s = await cap.sweep({ dir: d, rows: [{ pid: 3000, ppid: 1, start: 1_000_000, cmd: 'node run-stage.mjs' }], now: T0 + 3_600_000, lock: LOCK });
  eq(p, 'owner alive → a spawning entry is kept however old', s.kept.map((x) => x.token), [e.token]);
  const nBefore = cap.readLedger(d).entries.length;
  const sw0 = await cap.sweep({ dir: d, rows: null, lock: LOCK });
  eq(p, 'no process table → table-judged entries untouched (only PID-judged ones are swept)', [sw0.partial, sw0.released.length, cap.readLedger(d).entries.length], [true, 0, nBefore]);
});

/* 6 — a stale heartbeat never releases capacity while children live (T-3). */
await test('6 stale heartbeat with live children: capacity held (T-3)', async (p) => {
  const d = mk('t3');
  const ownerRow = { pid: 3000, ppid: 1, rssBytes: 0, start: 1_000_000, cmd: 'node run-stage.mjs' };
  const r = await cap.reserve({ dir: d, units: 2, limit: 2, owner: { pid: 3000, start: 1_000_000, runId: 'R1' }, now: T0, lock: LOCK });
  await cap.activate({ dir: d, token: r.token, pid: 4001, start: 2_000_000, now: T0, lock: LOCK });
  const chrome = 'chrome.exe --user-data-dir=C:\\Temp\\playwright_chromiumdev_profile-Stale01 --remote-debugging-pipe';
  const tree = [ownerRow,
    { pid: 4001, ppid: 3000, rssBytes: 0, start: 2_000_000, cmd: 'node ledger-exec.mjs ' + r.token + ' -- node cli.js test' },
    { pid: 4002, ppid: 4001, rssBytes: 0, start: 2_001_000, cmd: 'node cli.js test' },
    { pid: 4003, ppid: 4002, rssBytes: 0, start: 2_002_000, cmd: chrome }];
  const t = await cap.track({ dir: d, token: r.token, rows: tree, now: T0, lock: LOCK });
  eq(p, 'tree walk', [t.descendants, t.markers], [3, 2]);
  const later = [ownerRow, { pid: 4003, ppid: 1, rssBytes: 0, start: 2_002_000, cmd: chrome }];
  const rel1 = await cap.release({ dir: d, token: r.token, rows: later, now: T0 + 3_600_000, lock: LOCK });
  eq(p, 'heartbeat one hour old, a child alive → not released', [rel1.released, rel1.alive.map((a) => a.pid)], [false, [4003]]);
  eq(p, 'state releasing, both slots held', [(entryOf(d, r.token) || {}).state, cap.usedUnits(cap.readLedger(d).entries, 'playwright')], ['releasing', 2]);
  const sw = await cap.sweep({ dir: d, rows: later, now: T0 + 3_600_000, lock: LOCK });
  eq(p, 'a sweep keeps it (owner alive, tree alive)', sw.kept.map((x) => x.token), [r.token]);
  const unknown = await cap.release({ dir: d, token: r.token, rows: null, lock: LOCK });
  eq(p, 'no process table → never released', [unknown.released, /no process table/.test(unknown.reason)], [false, true]);
  const rel2 = await cap.release({ dir: d, token: r.token, rows: [ownerRow], lock: LOCK });
  eq(p, 'tree gone → released', [rel2.released, cap.readLedger(d).entries.length], [true, 0]);
});

/* 7 — browser profile markers keep re-parented browsers attributed; a reused PID is detected by its start time (T-5). */
await test('7 profile markers and PID reuse (T-5)', async (p) => {
  const d = mk('t5');
  const r = await cap.reserve({ dir: d, units: 1, limit: 2, owner: { pid: 3000, start: 1_000_000, runId: 'R5' }, now: T0, lock: LOCK });
  await cap.activate({ dir: d, token: r.token, pid: 4001, start: 100_000, lock: LOCK });
  const marker = 'C:\\Users\\qa\\AppData\\Local\\Temp\\playwright_chromiumdev_profile-AbC123';
  const chrome = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir="' + marker + '" --remote-debugging-pipe';
  const rows1 = [
    { pid: 4001, ppid: 3000, start: 100_000, cmd: 'node ledger-exec.mjs ' + r.token + ' -- node cli.js test' },
    { pid: 4002, ppid: 4001, start: 101_000, cmd: 'node cli.js test' },
    { pid: 4003, ppid: 4002, start: 102_000, cmd: chrome },
    { pid: 4004, ppid: 4003, start: 103_000, cmd: 'chrome.exe --type=renderer' },
    { pid: 4009, ppid: 4001, start: 50_000, cmd: 'a stale ppid: started before its "parent"' },
  ];
  await cap.track({ dir: d, token: r.token, rows: rows1, lock: LOCK });
  const e = entryOf(d, r.token);
  eq(p, 'descendants (the stale-ppid process excluded)', e.descendants.map((x) => x.pid).sort((a, b) => a - b), [4001, 4002, 4003, 4004]);
  eq(p, 'markers', e.markers, ['c:/users/qa/appdata/local/temp/playwright_chromiumdev_profile-abc123', 'playwright_chromiumdev_profile-abc123']);
  const rows2 = [{ pid: 4003, ppid: 1, start: 102_000, cmd: chrome }, { pid: 4004, ppid: 4003, start: 103_000, cmd: 'chrome.exe --type=renderer' }];
  const a2 = await cap.release({ dir: d, token: r.token, rows: rows2, lock: LOCK });
  eq(p, 're-parented browser still attributed', [a2.released, a2.alive.map((x) => x.pid)], [false, [4003, 4004]]);
  const rows3 = [{ pid: 4003, ppid: 1, start: 999_999, cmd: 'notepad.exe' }, { pid: 5005, ppid: 1, start: 200_000, cmd: 'chrome_crashpad_handler.exe --database=' + marker + '\\Crashpad' }];
  const a3 = await cap.release({ dir: d, token: r.token, rows: rows3, lock: LOCK });
  eq(p, 'reused pid not attributed; a marker holder is', [a3.released, a3.alive.map((x) => [x.pid, x.why])], [false, [[5005, 'marker']]]);
  const rows4 = [{ pid: 4003, ppid: 1, start: 999_999, cmd: 'notepad.exe' }];
  const a4 = await cap.release({ dir: d, token: r.token, rows: rows4, lock: LOCK });
  eq(p, 'only the reused pid left → released', a4.released, true);
  eq(p, 'isAlive', [cap.isAlive(rows4, { pid: 4003, start: 102_000 }), cap.isAlive(rows4, { pid: 4003, start: null }), cap.isAlive(null, { pid: 1 }), cap.isAlive([], { pid: 0 })], [false, true, true, false]);
  eq(p, 'holdsMarker is case- and separator-insensitive', cap.holdsMarker({ cmd: 'X --user-data-dir=c:/USERS/qa/appdata/local/temp/PLAYWRIGHT_chromiumdev_profile-abc123' }, e.markers), true);
});

/* 8 — the lock protocol: ownerless 30 s, dead owner at once, reused PID, other host; torn writes; a corrupt ledger (T-6). */
await test('8 lock protocol and atomic writes (T-6)', async (p) => {
  const d = mk('t6');
  fs.mkdirSync(path.join(d, 'ledger.lock'));
  let threw = null;
  let ran = false;
  try { await cap.withLock(d, 'ledger', () => { ran = true; }, { now: () => Date.now() + 10_000, giveUpMs: 150, pollMs: 10, snapshot: NO_SNAPSHOT }); } catch (e) { threw = e; }
  eq(p, 'an ownerless lock younger than 30 s is not broken', [ran, threw && threw.code], [false, 'ELOCKBUSY']);
  const res = await cap.withLock(d, 'ledger', () => 'ran', { now: () => Date.now() + 31_000, giveUpMs: 1000, pollMs: 10, snapshot: NO_SNAPSHOT });
  eq(p, 'an ownerless lock older than 30 s is broken', [res, fs.existsSync(path.join(d, 'ledger.lock'))], ['ran', false]);
  const lockWith = (name, owner) => { fs.mkdirSync(path.join(d, name + '.lock')); fs.writeFileSync(path.join(d, name + '.lock', 'owner.json'), JSON.stringify(owner)); };
  lockWith('x', { pid: 424242, start: 1, host: os.hostname(), token: 'dead' });
  eq(p, 'a dead owner is broken at once', await cap.withLock(d, 'x', () => 'took', { exists: (pid) => pid !== 424242, giveUpMs: 1000, pollMs: 10, snapshot: NO_SNAPSHOT }), 'took');
  lockWith('y', { pid: 5150, start: 1000, host: os.hostname(), token: 'reused' });
  eq(p, 'an owner pid now used by another process is broken', await cap.withLock(d, 'y', () => 'took', { exists: () => true, rows: [{ pid: 5150, ppid: 1, start: 90_000, cmd: 'other' }], giveUpMs: 1000, pollMs: 10 }), 'took');
  lockWith('z', { pid: 5150, start: 1000, host: os.hostname(), token: 'live' });
  let busy = null;
  try { await cap.withLock(d, 'z', () => 'took', { exists: () => true, rows: [{ pid: 5150, ppid: 1, start: 1000, cmd: 'live owner' }], giveUpMs: 100, pollMs: 10 }); } catch (e) { busy = e.code; }
  eq(p, 'a live owner keeps its lock', busy, 'ELOCKBUSY');
  lockWith('w', { pid: 5150, start: 1000, host: 'another-host', token: 'remote' });
  busy = null;
  try { await cap.withLock(d, 'w', () => 'took', { exists: () => false, giveUpMs: 100, pollMs: 10, snapshot: NO_SNAPSHOT }); } catch (e) { busy = e.code; }
  eq(p, 'an owner on another host is never judged dead here', busy, 'ELOCKBUSY');
  const f = cap.ledgerFile(d);
  cap.writeJsonAtomic(f, { schema: cap.CAPACITY_SCHEMA, entries: [{ token: 'k', class: 'playwright', units: 1, state: 'active' }], leases: {}, queue: [] });
  const deadTmp = f + '.tmp-999-dead';
  fs.writeFileSync(deadTmp, '{"entries": [');
  eq(p, 'the ledger stays valid beside a torn temp file', cap.readLedger(d).entries.map((x) => x.token), ['k']);
  const old = new Date(Date.now() - 11 * 60 * 1000);
  fs.utimesSync(deadTmp, old, old);
  const freshTmp = f + '.tmp-998-fresh';
  fs.writeFileSync(freshTmp, 'x');
  cap.writeJsonAtomic(f, { schema: cap.CAPACITY_SCHEMA, entries: [], leases: {}, queue: [] });
  eq(p, 'a temp file older than 10 min is removed, a fresh one kept', [fs.existsSync(deadTmp), fs.existsSync(freshTmp)], [false, true]);
  const c = mk('corrupt');
  fs.writeFileSync(path.join(c, 'ledger.json'), '{oops');
  const lr = cap.readLedger(c);
  eq(p, 'a corrupt ledger is reported, never read as empty capacity', [!!lr.error, lr.entries.length], [true, 0]);
  const rr = await cap.reserve({ dir: c, units: 1, limit: 2, lock: LOCK });
  eq(p, 'nothing is reserved and the file is left as it is', [rr.ok, rr.code, fs.readFileSync(path.join(c, 'ledger.json'), 'utf8')], [false, 'ledger-error', '{oops']);
});

/* 9 — committed-but-unobserved demand; admission; how many workers fit (T-7, §4.3). */
await test('9 committed-but-unobserved demand and admission arithmetic (T-7)', async (p) => {
  const entries = [
    { token: 'e1', class: 'playwright', state: 'active', units: 2, demand: { memMb: 1536, cpu: 1.5 }, createdAt: iso(T0 - 200_000), activatedAt: iso(T0 - 120_000) },
    { token: 'e2', class: 'playwright', state: 'spawning', units: 1, demand: { memMb: 1536, cpu: 1.5 }, createdAt: iso(T0 - 10_000), activatedAt: null },
    { token: 'e3', class: 'playwright', state: 'active', units: 1, demand: null, createdAt: iso(T0 - 500_000) },
    { token: 'e4', class: 'compliance', state: 'releasing', units: 1, demand: { memMb: 768, cpu: 0.75 }, createdAt: iso(T0 - 400_000), activatedAt: iso(T0 - 300_000) },
    { token: 'e5', class: 'playwright', state: 'gone', units: 4, demand: { memMb: 9999, cpu: 9 }, createdAt: iso(T0 - 1) },
  ];
  // e1: 3072 − 2000 = 1072 MB, 3 − 1 = 2 cores · e2 (inside the warm-up) in full: 1536, 1.5 · e4: max(0, 768 − 900) = 0, 0.75
  const committed = cap.committedOutstanding(entries, { e1: { memMb: 2000, cpu: 1 }, e4: 900 }, T0);
  eq(p, 'committed outstanding', committed, { memMb: 2608, cpu: 4.25 });
  const reserves = { memMb: 2048, cores: 2 };
  const demand = { memMb: 1536, cpu: 1.5 };
  eq(p, 'fits: 8000 − 2608 − 1536 = 3856 MB, 8 − 4.25 − 1.5 = 2.25 cores', cap.admissionCheck({ availableMb: 8000, idleCores: 8, committed, demand, reserves }), { ok: true, reasons: [], memLeftMb: 3856, cpuLeft: 2.25 });
  const cpuShort = cap.admissionCheck({ availableMb: 8000, idleCores: 7, committed, demand, reserves });
  eq(p, '1.25 cores left < 2 → refused', [cpuShort.ok, cpuShort.reasons.length, /^CPU/.test(cpuShort.reasons[0])], [false, 1, true]);
  const flags = cap.admissionCheck({ availableMb: 99999, idleCores: 64, committed, demand, reserves, pressure: true, leaseValid: false });
  eq(p, 'pressure and an invalid lease each refuse', flags.reasons, ['host pressure', 'the environment lease is not valid']);
  const adm = cap.admissionFor({ availableMb: 5000, idleCores: 16, demand, reserves, now: T0 });
  eq(p, 'the first reservation fits (5000 − 1536 = 3464 ≥ 2048)', adm({ entries: [] }).ok, true);
  eq(p, 'a second one inside the warm-up does not (5000 − 1536 − 1536 = 1928 < 2048)', adm({ entries: [{ token: 'w1', state: 'spawning', units: 1, demand, createdAt: iso(T0 - 5000) }] }).ok, false);
  const d = mk('t7');
  const live = cap.admissionFor({ availableMb: 5000, idleCores: 16, demand, reserves });
  const r1 = await cap.reserve({ dir: d, units: 1, limit: 2, demand, admission: live, lock: LOCK });
  const r2 = await cap.reserve({ dir: d, units: 1, limit: 2, demand, admission: live, lock: LOCK });
  eq(p, 'through the ledger: the second reservation is refused by memory, not by slots', [r1.ok, r2.ok, r2.code], [true, false, 'admission']);
  const fit = (o) => cap.admissibleWorkers({ committed: { memMb: 0, cpu: 0 }, perWorker: demand, reserves, ...o });
  eq(p, 'workers that fit', [fit({ availableMb: 8000, idleCores: 6, ceilingFree: 2 }), fit({ availableMb: 3000, idleCores: 6, ceilingFree: 2 }), fit({ availableMb: 8000, idleCores: 12, ceilingFree: 5 })], [2, 0, 3]);
});

/* 10 — pressure detection and recovery thresholds (T-37). */
await test('10 pressure monitor: 2 memory samples, critical at once, CPU 30 s, lag 2 samples, 60 s recovery (T-37)', async (p) => {
  const at = (s) => T0 + s * 1000;
  const m = cap.createPressureMonitor({ reserveMb: 2048, workerMemMb: 1536 });
  const seqMem = [[0, 3000], [2, 2000], [4, 1900], [6, 4000], [30, 4000], [40, 3000], [42, 4000], [100, 4000], [102, 4000]];
  const states = [];
  const changed = [];
  for (const [s, avail] of seqMem) {
    const r = m.sample({ now: at(s), availableMb: avail, cpuPct: 50, lagMs: 10 });
    states.push(r.state);
    changed.push(r.changed);
    if (s === 4) m.noteBlocked();
  }
  eq(p, 'memory states', states, ['ok', 'ok', 'pressure', 'pressure', 'pressure', 'pressure', 'pressure', 'pressure', 'ok']);
  eq(p, 'changes', changed, [false, false, true, false, false, false, false, false, true]);
  eq(p, 'episode', m.episodes(), [{ start: iso(at(4)), end: iso(at(102)), reason: 'memory', peak: { minAvailableMb: 1900, maxCpuPct: 50, maxLagMs: 10 }, blockedAdmissions: 1 }]);
  const crit = cap.createPressureMonitor({ reserveMb: 2048, workerMemMb: 1536 });
  eq(p, 'critical memory in one sample', [crit.sample({ now: at(0), availableMb: 900 }).state, crit.state().reason], ['pressure', 'critical memory']);
  const cpu = cap.createPressureMonitor({ reserveMb: 2048, workerMemMb: 1536 });
  const cpuStates = [];
  for (let s = 0; s <= 30; s += 2) cpuStates.push(cpu.sample({ now: at(s), availableMb: 8000, cpuPct: 95, lagMs: 0 }).state);
  eq(p, 'CPU ≥ 90 % for 28 s is not pressure, 30 s is', [cpuStates.slice(0, 15).every((x) => x === 'ok'), cpuStates[15], cpu.state().reason], [true, 'pressure', 'cpu']);
  const dip = cap.createPressureMonitor({ reserveMb: 2048, workerMemMb: 1536 });
  let at52 = null;
  let at54 = null;
  for (let s = 0; s <= 54; s += 2) {
    const r = dip.sample({ now: at(s), availableMb: 8000, cpuPct: s === 22 ? 80 : 95, lagMs: 0 });
    if (s === 52) at52 = r.state;
    if (s === 54) at54 = r.state;
  }
  eq(p, 'a dip restarts the 30 s', [at52, at54], ['ok', 'pressure']);
  const lag = cap.createPressureMonitor({ reserveMb: 2048, workerMemMb: 1536 });
  const l0 = lag.sample({ now: at(0), availableMb: 5000, cpuPct: 10, lagMs: 2500 }).state;
  const l2 = lag.sample({ now: at(2), availableMb: 5000, cpuPct: 10, lagMs: 2500 }).state;
  let l62 = null;
  let l64 = null;
  for (let s = 4; s <= 64; s += 2) {
    const r = lag.sample({ now: at(s), availableMb: 5000, cpuPct: 10, lagMs: 100 });
    if (s === 62) l62 = r.state;
    if (s === 64) l64 = r.state;
  }
  eq(p, 'lag: two samples enter, 60 s healthy leave', [l0, l2, l62, l64], ['ok', 'pressure', 'pressure', 'ok']);
  const once = cap.createPressureMonitor({ reserveMb: 2048, workerMemMb: 1536 });
  const spikes = [2500, 100, 2500].map((lagMs, i) => once.sample({ now: at(i * 2), availableMb: 5000, cpuPct: 10, lagMs }).state);
  eq(p, 'non-consecutive lag spikes are not pressure', spikes, ['ok', 'ok', 'ok']);
  const unknown = cap.createPressureMonitor({ reserveMb: 2048, workerMemMb: 1536 });
  eq(p, 'unknown values never enter pressure', unknown.sample({ now: at(0) }).state, 'ok');
  let threw = false;
  try { cap.createPressureMonitor({ reserveMb: 0 }); } catch { threw = true; }
  eq(p, 'a reserve is required', threw, true);
});

/* 11 — environment identity: normalisation, aliases, CNAME chains, shared addresses, unresolvable hosts (T-18). */
await test('11 environment identity: normalisation and alias grouping (T-18)', async (p) => {
  eq(p, 'IDNA, default port, path prefix', cap.normalizeHost('HTTPS://Bücher.Example:443/a//b/'), { host: 'xn--bcher-kva.example', port: '', pathPrefix: '/a/b', key: 'xn--bcher-kva.example' });
  eq(p, 'non-default port kept', cap.normalizeHost('example.com:8080'), { host: 'example.com', port: '8080', pathPrefix: '', key: 'example.com:8080' });
  eq(p, 'http default port dropped, trailing dot', [cap.normalizeHost('http://example.com:80/').key, cap.normalizeHost('https://App.Example.com.').key], ['example.com', 'app.example.com']);
  eq(p, 'not a host', [cap.normalizeHost(''), cap.normalizeHost('not a url ::'), cap.normalizeHost(null)], [null, null, null]);
  const facts = {
    'app.example.com': { cnames: ['lb.example.net'], addresses: ['10.0.0.1'] },
    'api.example.com': { cnames: [], addresses: ['10.0.0.1'] },
    'cdn.example.net': { cnames: [], addresses: ['10.0.0.9'] },
    'reports.example.com': { cnames: ['app.example.com'], addresses: ['10.0.0.7'] },
    'legacy.example.com': { cnames: [], addresses: ['10.0.0.5'] },
  };
  const resolve = async (h) => { if (h === 'unknown.invalid') throw new Error('ENOTFOUND'); if (!facts[h]) throw new Error('no fixture for ' + h); return facts[h]; };
  const id = await cap.environmentIdentity({ hosts: ['https://App.Example.com:443/portal/', 'api.example.com', 'cdn.example.net', 'http://reports.example.com:8080', 'unknown.invalid'], aliases: [['app.example.com', 'legacy.example.com']], resolve });
  const members = ['api.example.com', 'app.example.com', 'legacy.example.com', 'reports.example.com:8080'];
  eq(p, 'members: shared address (api), CNAME chain (reports), declared alias (legacy)', id.members, members);
  eq(p, 'id = sha256 of the sorted members', id.id, sha(members.join('\n')).slice(0, 16));
  eq(p, 'groups', id.groups, [members, ['cdn.example.net'], ['unknown.invalid']]);
  eq(p, 'the unresolvable host is kept separate and warned about', [id.warnings.length, /^unknown\.invalid: DNS lookup failed/.test(id.warnings[0] || '')], [1, true]);
  const noDns = await cap.environmentIdentity({ hosts: ['https://app.example.com', 'api.example.com', 'https://app.example.com:8443'], useDns: false });
  eq(p, 'without DNS only the same hostname groups', [noDns.members, noDns.id], [['app.example.com', 'app.example.com:8443'], sha('app.example.com\napp.example.com:8443').slice(0, 16)]);
  const slow = await cap.environmentIdentity({ hosts: ['slow.example.com'], resolve: () => new Promise(() => {}), timeoutMs: 50 });
  eq(p, 'a hanging lookup times out into a warning', [slow.members, /timed out/.test(slow.warnings[0] || '')], [['slow.example.com'], true]);
  const empty = await cap.environmentIdentity({ hosts: ['{E1_URL}'] });
  eq(p, 'no valid host → no identity', [empty.id, empty.warnings.length], [null, 2]);
});

/* 12 — the environment lease: exclusive, idempotent, no time-based expiry, reclaimed only when the owner is dead AND no
   tree remains, quiet period, sweep (T-16 / T-17). */
await test('12 environment lease lifecycle (T-16 / T-17)', async (p) => {
  const HOST = { pid: 2000, ppid: 1, start: 500_000, cmd: '"C:\\Users\\qa\\AppData\\Local\\Claude\\claude.exe" --resume' };
  const SHELL = { pid: 2100, ppid: 2000, start: 600_000, cmd: 'bash -c "node .claude/skills/link-qc-5-test-run-automation/scripts/capacity.mjs lease acquire"' };
  const CLI = { pid: 2200, ppid: 2100, start: 601_000, cmd: 'node .claude/skills/link-qc-5-test-run-automation/scripts/capacity.mjs lease acquire' };
  const alive = [HOST, SHELL, CLI];
  eq(p, 'the Claude Code process is the owner', cap.findHostProcess(alive, 2200), { pid: 2000, start: 500_000, how: 'claude' });
  eq(p, 'the npm package form is recognised', cap.findHostProcess([{ ...HOST, cmd: 'node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js' }, SHELL, CLI], 2200).how, 'claude');
  eq(p, 'no Claude in the chain → the shell\'s parent', cap.findHostProcess([{ ...HOST, cmd: 'C:\\Program Files\\Microsoft VS Code\\Code.exe' }, SHELL, CLI], 2200), { pid: 2000, start: 500_000, how: 'grandparent' });
  eq(p, 'parent only', cap.findHostProcess([SHELL, CLI], 2200), { pid: 2100, start: 600_000, how: 'parent' });
  eq(p, 'unknown process → self', cap.findHostProcess([HOST], 9999).how, 'self');
  eq(p, 'a shell that mentions .claude/skills is never the host', [cap.isHostCmd(SHELL.cmd), cap.isHostCmd(CLI.cmd), cap.isHostCmd(HOST.cmd)], [false, false, true]);
  const d = mk('lease');
  const ENV = 'envabc123';
  const owner = cap.findHostProcess(alive, 2200);
  const acq = (runId, rows, now, extra = {}) => cap.acquireLease({ dir: d, envId: ENV, members: ['app.example.com'], runId, runFile: '/' + runId + '/.runs/phase-1.json', owner, rows, now, lock: LOCK, ...extra });
  let r = await acq('R1', alive, T0);
  eq(p, 'R1 acquires', [r.ok, r.lease && r.lease.runId, r.lease && r.lease.owner.pid], [true, 'R1', 2000]);
  r = await acq('R1', alive, T0 + 1000);
  eq(p, 'R1 again is idempotent', [r.ok, r.reacquired], [true, true]);
  r = await acq('R2', alive, T0 + 2000);
  eq(p, 'R2 is refused while R1 holds it', [r.ok, r.code, r.heldBy && r.heldBy.runId], [false, 'held', 'R1']);
  eq(p, 'validate', [(await cap.validateLease({ dir: d, envId: ENV, runId: 'R1', rows: alive })).valid, (await cap.validateLease({ dir: d, envId: ENV, runId: 'R2', rows: alive })).valid], [true, false]);
  const st = await cap.leaseStatus({ dir: d, envId: ENV, rows: alive, now: T0 + 6 * 3600 * 1000 });
  eq(p, 'six hours later with the owner alive: still held — no time-based expiry', [st.held, st.valid, st.ownerAlive], [true, true, true]);
  const run = await cap.reserve({ dir: d, units: 1, limit: 2, owner: { pid: 3000, start: 1_000_000, runId: 'R1' }, now: T0, lock: LOCK });
  await cap.activate({ dir: d, token: run.token, pid: 4001, start: 2_000_000, lock: LOCK });
  const treeOnly = [{ pid: 4001, ppid: 1, start: 2_000_000, cmd: 'node ledger-exec.mjs ' + run.token + ' -- x' }];
  r = await acq('R2', treeOnly, T0 + 3000);
  eq(p, 'owner gone but a recorded tree of R1 alive → still held', [r.ok, /recorded process tree/.test(r.reason || '')], [false, true]);
  r = await acq('R2', [], T0 + 4000);
  eq(p, 'owner gone and no tree → taken over with cleanup_incomplete', [r.ok, r.reclaimed && r.reclaimed.runId, r.reclaimed && r.reclaimed.warning, /cleanup_incomplete/.test((r.warnings || [])[0] || '')], [true, 'R1', 'cleanup_incomplete', true]);
  let rel = await cap.releaseLease({ dir: d, envId: ENV, runId: 'R9', lock: LOCK });
  eq(p, 'another run cannot release it', rel.released, false);
  rel = await cap.releaseLease({ dir: d, envId: ENV, runId: 'R2', lock: LOCK });
  eq(p, 'released by its own run', [rel.released, Object.keys(cap.readLedger(d).leases).length], [true, 0]);
  await acq('R3', alive, T0 + 10_000);
  rel = await cap.releaseLease({ dir: d, envId: ENV, runId: 'R3', quietMs: 120_000, now: T0 + 20_000, lock: LOCK });
  eq(p, 'release with a quiet period', [rel.released, rel.quietUntil], [true, iso(T0 + 140_000)]);
  eq(p, 'the releasing run may not run on during its quiet period', (await cap.validateLease({ dir: d, envId: ENV, runId: 'R3', rows: alive })).valid, false);
  r = await acq('R4', alive, T0 + 80_000);
  eq(p, 'inside the quiet period another run waits', [r.ok, /quiet period/.test(r.reason || '')], [false, true]);
  r = await acq('R4', alive, T0 + 141_000);
  eq(p, 'after it the lease is free', r.ok, true);
  const sw = await cap.sweep({ dir: d, rows: [], now: T0 + 150_000, lock: LOCK });
  eq(p, 'sweep: the abandoned lease and the dead run\'s entry are released', [sw.leasesReleased.map((x) => [x.runId, x.warning]), sw.released.map((x) => x.token)], [[['R4', 'cleanup_incomplete']], [run.token]]);
  r = await cap.acquireLease({ dir: d, envId: ENV, runId: 'R5', owner: null, rows: alive, lock: LOCK });
  eq(p, 'no owner → refused', [r.ok, r.code], [false, 'invalid']);
  await cap.acquireLease({ dir: d, envId: 'env-dns-a', runId: 'R6', owner, rows: alive, now: T0, lock: LOCK });
  rel = await cap.releaseLease({ dir: d, envId: 'env-dns-b', runId: 'R6', lock: LOCK });
  eq(p, 'a recomputed identity (DNS changed) still releases the run\'s own lease', [rel.released, rel.envIds], [true, ['env-dns-a']]);
});

/* 13 — reclaim: only orphaned trees we recorded (pid + start) or that carry a recorded marker; dry run lists only. */
await test('13 reclaim: recorded or marked processes of orphaned entries only', async (p) => {
  const d = mk('reclaim');
  const orphan = await cap.reserve({ dir: d, units: 1, limit: 3, owner: { pid: 3000, start: 1_000_000, runId: 'RX' }, now: T0, lock: LOCK });
  await cap.activate({ dir: d, token: orphan.token, pid: 4001, start: 100_000, lock: LOCK });
  const marker = 'C:\\Temp\\playwright_chromiumdev_profile-Orph01';
  await cap.track({ dir: d, token: orphan.token, lock: LOCK, rows: [
    { pid: 3000, ppid: 1, start: 1_000_000, cmd: 'node run-stage.mjs' },
    { pid: 4001, ppid: 3000, start: 100_000, cmd: 'node ledger-exec.mjs ' + orphan.token + ' -- node cli.js' },
    { pid: 4003, ppid: 4001, start: 102_000, cmd: 'chrome.exe --user-data-dir=' + marker }] });
  const live = await cap.reserve({ dir: d, units: 1, limit: 3, owner: { pid: 3100, start: 1_100_000, runId: 'RY' }, now: T0, lock: LOCK });
  await cap.activate({ dir: d, token: live.token, pid: 4200, start: 300_000, lock: LOCK });
  const rows = [
    { pid: 3100, ppid: 1, start: 1_100_000, cmd: 'node run-stage.mjs' },
    { pid: 4200, ppid: 3100, start: 300_000, cmd: 'node ledger-exec.mjs ' + live.token + ' -- x' },
    { pid: 4003, ppid: 1, start: 102_000, cmd: 'chrome.exe --user-data-dir=' + marker },
    { pid: 5005, ppid: 1, start: 200_000, cmd: 'chrome_crashpad_handler.exe --database=' + marker + '\\Crashpad' },
    { pid: 6006, ppid: 1, start: 300_000, cmd: 'node unrelated.js' },
  ];
  const killed = [];
  const dry = await cap.reclaim({ dir: d, rows, dryRun: true, kill: (pid) => killed.push(pid), lock: LOCK });
  eq(p, 'the dry run lists the targets and kills nothing', [dry.terminated.map((t) => t.pid), killed.length], [[4003, 5005], 0]);
  eq(p, 'a running entry is never touched', dry.skipped.map((s) => s.token), [live.token]);
  const after = { rows: rows.filter((x) => ![4003, 5005].includes(x.pid)) };
  const real = await cap.reclaim({ dir: d, rows, kill: (pid) => killed.push(pid), snapshot: async () => after, lock: LOCK });
  eq(p, 'only the recorded and the marked process are terminated', killed, [4003, 5005]);
  eq(p, 'released after the kill', real.released, [orphan.token]);
  eq(p, 'the live run keeps its entry', cap.readLedger(d).entries.map((e) => e.token), [live.token]);
});

/* 14 — process-table parsers: CIM JSON (/Date(…)/, DMTF, ISO with 7 fraction digits, a single object), ps lstart, fixtures. */
await test('14 process-table parsers', async (p) => {
  const cim = cap.parseCimJson(fs.readFileSync(path.join(FX, 'cim.json'), 'utf8'));
  const utc = Date.UTC(2023, 10, 14, 21, 13, 20, 123); // DMTF 22:13:20.123456 at +060 minutes = 21:13:20.123 UTC
  eq(p, 'CIM rows', cim.rows, [
    { pid: 4, ppid: 0, rssBytes: 8192, start: null, cmd: '' },
    { pid: 1200, ppid: 4, rssBytes: 1048576, start: 1700000000000, cmd: 'C:\\Windows\\explorer.exe' },
    { pid: 1300, ppid: 1200, rssBytes: 2097152, start: utc, cmd: '"C:\\Program Files\\nodejs\\node.exe" cli.js test' },
    { pid: 1400, ppid: 1300, rssBytes: 4096, start: utc, cmd: 'chrome.exe --user-data-dir=C:\\Temp\\playwright_chromiumdev_profile-XyZ987' },
  ]);
  const single = cap.parseCimJson(fs.readFileSync(path.join(FX, 'cim-single.json'), 'utf8'));
  eq(p, 'a single object (one process) and the /Date(ms±hhmm)/ form', [single.rows.length, single.rows[0].start], [1, 1700000000000]);
  eq(p, 'empty and invalid listings', [cap.parseCimJson('').error, cap.parseCimJson('{bad').error], ['empty process listing', 'process listing is not valid JSON']);
  const ps = cap.parsePsOutput(fs.readFileSync(path.join(FX, 'ps.txt'), 'utf8'));
  eq(p, 'ps rows (lstart is local time; the malformed line skipped)', ps.rows, [
    { pid: 1, ppid: 0, rssBytes: 1234 * 1024, start: new Date(2023, 10, 14, 22, 13, 20).getTime(), cmd: '/sbin/init splash' },
    { pid: 812, ppid: 1, rssBytes: 20480 * 1024, start: new Date(2023, 10, 1, 8, 5, 9).getTime(), cmd: 'node /opt/app/cli.js test --workers=2' },
  ]);
  eq(p, 'start forms', [cap.parseProcessStart('\\/Date(5)\\/'), cap.parseProcessStart(1234), cap.parseProcessStart(''), cap.parseProcessStart('garbage')], [5, 1234, null, null]);
  eq(p, 'fixture placeholders', cap.fixtureRows(path.join(FX, 'table.json'), { self: 11, parent: 22 }).rows, [
    { pid: 11, ppid: 22, rssBytes: 0, start: null, cmd: 'node capacity.mjs' },
    { pid: 22, ppid: 1, rssBytes: 0, start: null, cmd: 'node selftest-capacity.mjs' },
  ]);
  const viaEnv = await cap.processSnapshot({ env: { QA_CAPACITY_PS_FIXTURE: path.join(FX, 'table.json') } });
  eq(p, 'processSnapshot honours the fixture seam', [viaEnv.error, viaEnv.rows.length, viaEnv.rows[0].pid], [null, 2, process.pid]);
});

/* 15 — the CLI: compact JSON, exit 0 unless --strict, QA_CAPACITY_DIR honoured, no DNS with --no-dns (T-19). */
await test('15 CLI: status, config, lease acquire / status / release, --strict, QA_CAPACITY_DIR', async (p) => {
  const d = mk('cli');
  const baseEnv = { ...process.env, QA_CAPACITY_PS_FIXTURE: path.join(FX, 'table.json') };
  delete baseEnv.QA_CAPACITY_DIR;
  const cli = (args, env = baseEnv) => {
    const r = spawnSync(process.execPath, [CAP, ...args], { encoding: 'utf8', env });
    let j = null; try { j = JSON.parse(r.stdout); } catch { /* reported below */ }
    if (!j) p.push('no JSON from `' + args.join(' ') + '`: ' + (r.stdout || r.stderr).slice(0, 200));
    return { status: r.status, j: j || {} };
  };
  const status = cli(['status', '--capacity-dir', d]);
  eq(p, 'status', [status.status, status.j.action, status.j.ceiling && status.j.ceiling.ceiling, status.j.entries], [0, 'status', cap.resolveCeiling({ dir: d, env: baseEnv }).ceiling, []]);
  const config = cli(['config', '--capacity-dir', d]);
  eq(p, 'config', [config.j.exists, config.j.ceiling && config.j.ceiling.ceiling, config.j.template && config.j.template.machineMaxWorkers], [false, cap.resolveCeiling({ dir: d, env: baseEnv }).ceiling, 'auto']);
  const runFile = path.join(d, 'phase-1.json');
  const envId = sha('app.example.com').slice(0, 16);
  const a1 = cli(['lease', 'acquire', '--capacity-dir', d, '--env', 'https://app.example.com', '--no-dns', '--run-file', runFile, '--run-id', 'R1']);
  eq(p, 'lease acquire', [a1.status, a1.j.ok, a1.j.envId, a1.j.owner && a1.j.owner.how], [0, true, envId, 'parent']);
  const ls = cli(['lease', 'status', '--capacity-dir', d, '--env-id', envId]);
  eq(p, 'lease status', [ls.j.held, ls.j.valid], [true, true]);
  const a2 = cli(['lease', 'acquire', '--capacity-dir', d, '--env', 'https://app.example.com', '--no-dns', '--run-file', runFile, '--run-id', 'R2', '--strict']);
  eq(p, 'held by another run → exit 1 under --strict', [a2.status, a2.j.ok, a2.j.code], [1, false, 'held']);
  const rl = cli(['lease', 'release', '--capacity-dir', d, '--env-id', envId, '--run-id', 'R1']);
  eq(p, 'lease release', [rl.status, rl.j.released], [0, true]);
  const shared = path.join(TMP, 'shared-cli-capacity');
  const viaEnv = cli(['lease', 'acquire', '--env', 'https://app.example.com', '--no-dns', '--run-file', runFile, '--run-id', 'R3'], { ...baseEnv, QA_CAPACITY_DIR: shared });
  eq(p, 'QA_CAPACITY_DIR honoured (T-19)', [viaEnv.j.ok, viaEnv.j.capacityDir, fs.existsSync(path.join(shared, 'ledger.json'))], [true, shared.replace(/\\/g, '/'), true]);
  const unknown = cli(['frobnicate', '--capacity-dir', d]);
  eq(p, 'an unknown command is reported with exit 0', [unknown.status, unknown.j.ok], [0, false]);
  const help = cli(['--help']);
  eq(p, '--help', [help.j.tool, Array.isArray(help.j.usage)], ['capacity', true]);
});

/* 16 — ledger-exec.mjs: self-registration before the command, the command's exit code, an unknown token never runs. */
await test('16 ledger-exec wrapper: registers first, exits with the command\'s code, refuses an unknown token', async (p) => {
  const d = mk('exec');
  const r = await cap.reserve({ dir: d, units: 1, limit: 2, owner: { runId: 'RE' }, lock: LOCK });
  const run = spawnSync(process.execPath, [EXEC, r.token, '--capacity-dir', d, '--', process.execPath, '-e', 'process.exit(3)'], { encoding: 'utf8' });
  eq(p, 'the command\'s exit code', run.status, 3);
  const e = entryOf(d, r.token) || {};
  eq(p, 'wrapper registered and the command noted; activation is the parent\'s', [!!(e.wrapper && e.wrapper.pid), (e.descendants || []).length >= 1, e.state], [true, true, 'spawning']);
  const unknown = spawnSync(process.execPath, [EXEC, '0123456789abcdef', '--capacity-dir', d, '--', process.execPath, '-e', 'process.exit(0)'], { encoding: 'utf8' });
  eq(p, 'an unknown token is not started (70)', unknown.status, 70);
  const usage = spawnSync(process.execPath, [EXEC], { encoding: 'utf8' });
  eq(p, 'bad usage (64)', usage.status, 64);
});

/* 17 — a waiting reservation is granted once the capacity is released. */
await test('17 a queued reservation is granted after a release', async (p) => {
  const d = mk('wait');
  const a = await cap.reserve({ dir: d, units: 2, limit: 2, owner: { runId: 'A' }, lock: LOCK });
  const waiting = cap.reserve({ dir: d, units: 1, limit: 2, owner: { runId: 'B' }, waitMs: 3000, pollMs: 20, lock: LOCK });
  let released = null;
  setTimeout(() => { released = cap.release({ dir: d, token: a.token, rows: [], lock: LOCK }); }, 100);
  const b = await waiting;
  if (released) await released;
  eq(p, 'granted after the release', [b.ok, b.waitedMs >= 50], [true, true]);
  eq(p, 'the queue is empty again', cap.readLedger(d).queue.length, 0);
});

/* 18 — EXCLUSIVE execution (the hard cap when the ledger is rolled back): an exclusive reservation is granted only while
   nothing else of the class is live, and while it is live nothing else is granted; 'pid' entries are judged by PID
   existence (injected) — pruned inside reserve() and by a sweep without a table, which leaves table entries alone. */
await test('18 exclusive execution: one command at a time, PID-judged, swept without a table', async (p) => {
  const d = mk('exclusive');
  const alive = new Set([process.pid]);
  const exists = (pid) => alive.has(pid);
  // another run's ordinary reservation (1 slot) → an exclusive request waits, even with a free slot
  const other = await cap.reserve({ dir: d, units: 1, limit: 2, owner: { runId: 'LEDGER-RUN' }, lock: LOCK });
  const ex1 = await cap.reserve({ dir: d, units: 1, limit: 2, exclusive: true, liveness: 'pid', owner: { runId: 'EX' }, exists, lock: LOCK });
  eq(p, 'exclusive waits for a live ordinary reservation', [other.ok, ex1.ok, ex1.code], [true, false, 'busy']);
  await cap.release({ dir: d, token: other.token, rows: [], lock: LOCK });
  const ex2 = await cap.reserve({ dir: d, units: 2, limit: 2, exclusive: true, liveness: 'pid', owner: { runId: 'EX' }, exists, lock: LOCK });
  eq(p, 'granted once nothing else runs; recorded exclusive + pid', [ex2.ok, ex2.entry && ex2.entry.exclusive, ex2.entry && ex2.entry.liveness], [true, true, 'pid']);
  // while it is live: an ordinary request (even 1 slot under a higher limit) and a second exclusive one are refused
  const ord = await cap.reserve({ dir: d, units: 1, limit: 4, owner: { runId: 'LEDGER-RUN' }, exists, lock: LOCK });
  const ex3 = await cap.reserve({ dir: d, units: 1, limit: 2, exclusive: true, liveness: 'pid', owner: { runId: 'EX2' }, exists, lock: LOCK });
  eq(p, 'nothing else is granted while it is live', [ord.ok, ord.code, ex3.ok, ex3.code], [false, 'exclusive', false, 'exclusive']);
  eq(p, 'a compliance reservation is another class — not blocked', (await cap.reserve({ dir: d, cls: 'compliance', units: 1, owner: { runId: 'CHK' }, exists, lock: LOCK })).ok, true);
  // the child is recorded; release without a table judges the child by PID (the owner — the caller — is not counted)
  await cap.activate({ dir: d, token: ex2.token, pid: 777001, lock: LOCK });
  alive.add(777001);
  const rel1 = await cap.release({ dir: d, token: ex2.token, rows: null, exists, lock: LOCK });
  eq(p, 'held while the child PID exists', [rel1.released, (rel1.alive || []).map((a) => a.pid)], [false, [777001]]);
  // the owner dies with the child still running → orphaned, still held; the child ends → pruned by the next reserve
  const ownerDead = { ...cap.readLedger(d) };
  const e = ownerDead.entries.find((x) => x.token === ex2.token);
  e.owner.pid = 777002; e.owner.start = null; delete e.owner.startSource;
  fs.writeFileSync(path.join(d, 'ledger.json'), JSON.stringify(ownerDead));
  const blocked = await cap.reserve({ dir: d, units: 1, limit: 2, owner: { runId: 'NEXT' }, exists, lock: LOCK });
  eq(p, 'owner gone, child alive → orphaned and still exclusive', [blocked.ok, blocked.code, (entryOf(d, ex2.token) || {}).state], [false, 'exclusive', 'orphaned']);
  alive.delete(777001);
  const next = await cap.reserve({ dir: d, units: 1, limit: 2, owner: { runId: 'NEXT' }, exists, lock: LOCK });
  eq(p, 'child gone → pruned inside reserve(), the next run is granted', [next.ok, entryOf(d, ex2.token)], [true, null]);
  // sweep without a table: only 'pid' entries are judged; the table entry NEXT stays
  const dead = await cap.reserve({ dir: d, units: 1, limit: 4, liveness: 'pid', owner: { pid: 777003, start: null, runId: 'GONE' }, exists: () => true, lock: LOCK });
  const sw = await cap.sweep({ dir: d, rows: null, exists: (pid) => pid === process.pid, spawningGraceMs: 0, lock: LOCK });
  eq(p, 'tableless sweep: the dead pid entry released, the table entry kept', [dead.ok, sw.partial, sw.released.map((r) => r.runId), !!entryOf(d, next.token)], [true, true, ['GONE'], true]);
  eq(p, 'pidTable keeps existing PIDs only', cap.pidTable([process.pid, 0, -1, 999999991]).map((r) => r.pid), [process.pid].concat(cap.pidExists(999999991) ? [999999991] : []));
});

/* 19 — skill 9 beside skill 5: a session hold counts against the ceiling and lives as long as its owner; a lease is
   accepted for its RUN FILE under another run id (skill 9's own lease for phase N), never for another run file; while
   skill 5's run holds the environment, skill 9's acquire is refused (and vice versa); the CLI hold commands. */
await test('19 skill 9 coordination: session holds, lease by run file, 5 vs 9 contention, hold CLI', async (p) => {
  const d = mk('skill9');
  // the ceiling is Auto (host-dependent): this case bounds it at 2 so its counts hold on every machine
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ machineMaxWorkers: 2 }));
  const runFile = path.join(d, 'reports', 'US-1', '.runs', 'phase-2.json').replace(/\\/g, '/');
  const otherFile = path.join(d, 'reports', 'US-2', '.runs', 'phase-1.json').replace(/\\/g, '/');
  const HOST5 = { pid: 3100, ppid: 1, start: 900_000, cmd: 'claude --resume' };
  const HOST9 = { pid: 3200, ppid: 1, start: 950_000, cmd: 'claude' };
  const rows = [HOST5, HOST9];
  // skill 5 runs story US-2 on the environment
  const l5 = await cap.acquireLease({ dir: d, envId: 'env1', runId: 'R5', runFile: otherFile, owner: { pid: 3100, start: 900_000 }, rows, lock: LOCK });
  const l9 = await cap.acquireLease({ dir: d, envId: 'env1', runId: 'skill9-retest-1', runFile, owner: { pid: 3200, start: 950_000 }, rows, lock: LOCK });
  eq(p, 'skill 9 waits while skill 5 holds the environment', [l5.ok, l9.ok, l9.code], [true, false, 'held']);
  await cap.releaseLease({ dir: d, envId: 'env1', runId: 'R5', lock: LOCK });
  const l9b = await cap.acquireLease({ dir: d, envId: 'env1', runId: 'skill9-retest-1', runFile, owner: { pid: 3200, start: 950_000 }, rows, lock: LOCK });
  const l5b = await cap.acquireLease({ dir: d, envId: 'env1', runId: 'R5b', runFile: otherFile, owner: { pid: 3100, start: 900_000 }, rows, lock: LOCK });
  eq(p, 'and skill 5 waits while skill 9 holds it', [l9b.ok, l5b.ok, l5b.code], [true, false, 'held']);
  // run-stage validates by run id OR run file: skill 9's call on phase-2.json (run id R-phase2 from the file) is accepted
  const v1 = await cap.validateLease({ dir: d, envId: 'env1', runId: 'R-phase2', runFile, rows });
  const v2 = await cap.validateLease({ dir: d, envId: 'env1', runId: 'R5', runFile: otherFile, rows });
  const v3 = await cap.validateLease({ dir: d, envId: 'env1', runId: 'R-phase2', runFile: runFile.toUpperCase(), rows });
  eq(p, 'lease accepted for its run file, refused for another run file', [v1.valid, v2.valid, /leased by run skill9-retest-1/.test(v2.reason)], [true, false, true]);
  eq(p, 'run-file match is case-insensitive on Windows only', v3.valid, process.platform === 'win32');
  // decideLease sees a tree recorded under the run FILE (skill 9's run-stage reservations carry the phase's run id)
  const lease = cap.readLedger(d).leases.env1;
  const tree = [{ token: 't', class: 'playwright', units: 1, state: 'active', owner: { pid: 1, runId: 'R-phase2', runFile }, child: { pid: 4000, start: 1_000_000 }, descendants: [] }];
  eq(p, 'owner gone but a run-file tree alive → lease kept', cap.decideLease(lease, tree, [{ pid: 4000, ppid: 1, start: 1_000_000 }], T0).action, 'keep');
  // session holds: 1 slot per open playwright-cli browser, under the same ceiling as run-stage's commands
  const alive = new Set([3200]);
  const exists = (pid) => alive.has(pid);
  const h1 = await cap.acquireHold({ dir: d, runId: 'skill9-retest-1', runFile, owner: { pid: 3200, start: 950_000 }, units: 1, label: 'playwright-cli session admin', exists, lock: LOCK });
  const he = entryOf(d, h1.token) || {};
  eq(p, 'hold granted, active, pid-judged', [h1.ok, he.state, he.kind, he.liveness, he.label], [true, 'active', 'session-hold', 'pid', 'playwright-cli session admin']);
  const two = await cap.reserve({ dir: d, units: 2, limit: 2, owner: { runId: 'R5' }, exists, lock: LOCK });
  const one = await cap.reserve({ dir: d, units: 1, limit: 2, owner: { runId: 'R5' }, exists, lock: LOCK });
  eq(p, 'a run-stage command of 2 waits beside a 1-slot hold; 1 fits', [two.ok, two.code, one.ok], [false, 'busy', true]);
  await cap.release({ dir: d, token: one.token, rows: [], lock: LOCK });
  eq(p, 'a session hold lives while its owner lives', cap.decideEntry(he, [HOST9], T0).action, 'keep');
  alive.delete(3200);
  const after = await cap.reserve({ dir: d, units: 2, limit: 2, owner: { runId: 'R5' }, exists, lock: LOCK });
  eq(p, 'owner gone → the hold is freed by the next reserve', [after.ok, entryOf(d, h1.token)], [true, null]);
  await cap.release({ dir: d, token: after.token, rows: [], lock: LOCK });
  alive.add(3200);
  const h2 = await cap.acquireHold({ dir: d, runId: 'skill9-retest-1', runFile, owner: { pid: 3200, start: 950_000 }, exists, lock: LOCK });
  const h3 = await cap.acquireHold({ dir: d, runId: 'skill9-retest-1', runFile, owner: { pid: 3200, start: 950_000 }, exists, lock: LOCK });
  const h4 = await cap.acquireHold({ dir: d, runId: 'skill9-retest-1', runFile, owner: { pid: 3200, start: 950_000 }, exists, lock: LOCK });
  eq(p, 'holds never exceed the ceiling', [h2.ok, h3.ok, h4.ok, h4.code], [true, true, false, 'busy']);
  const rh = await cap.releaseHold({ dir: d, runId: 'skill9-retest-1', lock: LOCK });
  eq(p, 'release every hold of the run', [rh.released.length, cap.readLedger(d).entries.length], [2, 0]);
  eq(p, 'acquireHold needs an owner', (await cap.acquireHold({ dir: d, runId: 'x', lock: LOCK })).code, 'invalid');
  // exclusive hold (QA_LEDGER=off in the session): granted only when nothing runs, then nothing else starts
  const busyCmd = await cap.reserve({ dir: d, units: 1, limit: 2, owner: { runId: 'R5' }, exists, lock: LOCK });
  const xh = await cap.acquireHold({ dir: d, runId: 'skill9-retest-2', owner: { pid: 3200, start: 950_000 }, exclusive: true, exists, lock: LOCK });
  await cap.release({ dir: d, token: busyCmd.token, rows: [], lock: LOCK });
  const xh2 = await cap.acquireHold({ dir: d, runId: 'skill9-retest-2', owner: { pid: 3200, start: 950_000 }, exclusive: true, exists, lock: LOCK });
  const blocked = await cap.reserve({ dir: d, units: 1, limit: 2, owner: { runId: 'R5' }, exists, lock: LOCK });
  eq(p, 'exclusive hold: waits for a command, then blocks the next one', [xh.ok, xh2.ok, blocked.ok, blocked.code], [false, true, false, 'exclusive']);
  await cap.releaseHold({ dir: d, token: xh2.token, lock: LOCK });
  // the CLI: hold acquire / release with an explicit owner (this harness — alive)
  const cliEnv = { ...process.env };
  delete cliEnv.QA_LEDGER;
  const cli = (args, env = cliEnv) => { const r = spawnSync(process.execPath, [CAP, ...args], { encoding: 'utf8', env }); let j = null; try { j = JSON.parse(r.stdout); } catch { p.push('no JSON from hold ' + args.join(' ')); } return { status: r.status, j: j || {} }; };
  const ha = cli(['hold', 'acquire', '--capacity-dir', d, '--run-file', runFile, '--run-id', 'skill9-cli', '--owner-pid', String(process.pid), '--label', 'cli', '--strict']);
  eq(p, 'CLI hold acquire', [ha.status, ha.j.ok, ha.j.exclusive, ha.j.entry && ha.j.entry.kind], [0, true, false, 'session-hold']);
  const full = cli(['hold', 'acquire', '--capacity-dir', d, '--run-id', 'skill9-cli2', '--owner-pid', String(process.pid), '--workers', '2', '--strict']);
  eq(p, 'CLI hold beyond the ceiling → exit 1 under --strict', [full.status, full.j.ok], [1, false]);
  const hr = cli(['hold', 'release', '--capacity-dir', d, '--token', ha.j.token || 'none']);
  eq(p, 'CLI hold release', [hr.status, (hr.j.released || []).length], [0, 1]);
  const xcli = cli(['hold', 'acquire', '--capacity-dir', d, '--run-id', 'skill9-cli3', '--owner-pid', String(process.pid)], { ...cliEnv, QA_LEDGER: 'off' });
  eq(p, 'CLI hold under QA_LEDGER=off is exclusive', [xcli.j.ok, xcli.j.exclusive], [true, true]);
  cli(['hold', 'release', '--capacity-dir', d, '--run-id', 'skill9-cli3']);
});

/* 20 — CONFIRMED RELEASE (exclusive commands, probes, holds: confirm 'table'). A fresh table decides: a browser orphaned
   when its recorded parent ENDED keeps the slots (Windows keeps the dead parent's pid); a parent pid reused by another
   process fathers only the children born before the reuse; a re-parented browser carrying the run's QA_LEDGER_TOKEN in its
   environment (Linux) is the run's; no table → held ("could not be confirmed stopped"), never freed by a PID check, a
   waiting reserve frees it as soon as a table confirms it; a child whose birth cannot be ordered holds the slots but is
   never terminated; releaseConfirmed terminates only the run's own survivors; forceRelease (user-run) frees one entry. */
await test('20 confirmed release: orphans of ended processes, PID reuse, environment token, no table → held (gap 5)', async (p) => {
  const OWNER = { pid: 3000, ppid: 1, start: T0 - 100_000, cmd: 'node run-stage.mjs' };
  const own = { pid: 3000, start: T0 - 100_000 };
  const chrome = (m) => 'chrome.exe --user-data-dir=C:\\Temp\\playwright_chromiumdev_profile-' + m + ' --remote-debugging-pipe';
  const excl = (d, runId, extra = {}) => cap.reserve({ dir: d, units: 2, limit: 2, exclusive: true, liveness: 'pid', confirm: 'table', owner: { ...own, runId }, now: T0, exists: () => true, lock: LOCK, ...extra });
  // A — the orphan of an ended worker, and a reused parent pid
  const d = mk('confirm');
  const r = await excl(d, 'A');
  eq(p, 'recorded confirm: table', [r.ok, (entryOf(d, r.token) || {}).confirm], [true, 'table']);
  await cap.activate({ dir: d, token: r.token, pid: 4001, start: T0 + 1000, lock: LOCK });
  await cap.noteDescendant({ dir: d, token: r.token, pid: 4002, start: T0 + 2000, lock: LOCK });
  const during = [OWNER, { pid: 4001, ppid: 3000, start: T0 + 1000, cmd: 'node ledger-exec.mjs ' + r.token + ' -- node cli.js test' },
    { pid: 4002, ppid: 4001, start: T0 + 2000, cmd: 'node cli.js test' }, { pid: 4003, ppid: 4002, start: T0 + 3000, cmd: 'node worker.js' }];
  await cap.track({ dir: d, token: r.token, rows: during, now: T0, lock: LOCK });
  eq(p, 'tree recorded', (entryOf(d, r.token).descendants || []).map((x) => x.pid).sort(), [4001, 4002, 4003]);
  // the command ended; the worker (4003) died after starting a browser (4004) — never walked, its parent recorded
  const after = [OWNER, { pid: 4004, ppid: 4003, start: T0 + 4000, cmd: chrome('Orph01') }, { pid: 4005, ppid: 4004, start: T0 + 4100, cmd: 'chrome.exe --type=renderer' }];
  const a1 = await cap.release({ dir: d, token: r.token, rows: after, lock: LOCK });
  eq(p, 'an orphan of an ended recorded process holds the slots', [a1.released, a1.alive.map((x) => [x.pid, x.why])], [false, [[4004, 'child-of-recorded'], [4005, 'tree']]]);
  eq(p, 'state releasing, both slots held', [entryOf(d, r.token).state, cap.usedUnits(cap.readLedger(d).entries, 'playwright')], ['releasing', 2]);
  // pid 4003 reused by notepad (born T0+50 s): its own child (T0+60 s) is not ours, the orphan born before the reuse is
  const reused = [OWNER, { pid: 4003, ppid: 1, start: T0 + 50_000, cmd: 'notepad.exe' }, { pid: 4007, ppid: 4003, start: T0 + 60_000, cmd: 'notepad-helper.exe' },
    { pid: 4004, ppid: 4003, start: T0 + 4000, cmd: chrome('Orph01') }];
  const a2 = await cap.release({ dir: d, token: r.token, rows: reused, lock: LOCK });
  eq(p, 'reused parent pid: only the child born before the reuse', a2.alive.map((x) => x.pid), [4004]);
  const a3 = await cap.release({ dir: d, token: r.token, rows: [OWNER, { pid: 4003, ppid: 1, start: T0 + 50_000, cmd: 'notepad.exe' }, { pid: 4007, ppid: 4003, start: T0 + 60_000, cmd: 'x' }], lock: LOCK });
  eq(p, 'nothing of ours left → released on the table', [a3.released, a3.confirmed, entryOf(d, r.token)], [true, 'table', null]);
  // a process older than the reservation is never a child of it (a stale ppid)
  const r2 = await excl(d, 'A2');
  await cap.activate({ dir: d, token: r2.token, pid: 4101, start: T0 + 1000, lock: LOCK });
  const old = await cap.release({ dir: d, token: r2.token, rows: [OWNER, { pid: 4102, ppid: 4101, start: T0 - 500_000, cmd: 'svchost.exe' }], lock: LOCK });
  eq(p, 'a process born before the reservation is not its child', old.released, true);
  // B — a re-parented browser (ppid 1) carrying the run's token in its environment (Linux /proc)
  const r3 = await excl(d, 'B');
  const b = await cap.release({ dir: d, token: r3.token, rows: [OWNER, { pid: 5001, ppid: 1, start: T0 + 3000, cmd: 'chrome --type=gpu-process', ledgerToken: r3.token }, { pid: 5002, ppid: 1, start: T0 + 3000, cmd: 'chrome', ledgerToken: 'another-run-token' }], lock: LOCK });
  eq(p, 'environment token: ours only', b.alive.map((x) => [x.pid, x.why]), [[5001, 'env-token']]);
  const envRows = cap.addEnvTokens([{ pid: 1 }, { pid: 2 }, { pid: 3 }], { readFile: (f) => (f.includes('/1/') ? 'A=1\0QA_LEDGER_TOKEN=abc-1\0B=2' : f.includes('/2/') ? 'XQA_LEDGER_TOKEN=zz\0' : (() => { throw new Error('EACCES'); })()) });
  eq(p, 'addEnvTokens reads only QA_LEDGER_TOKEN, only as a whole variable', envRows.map((x) => x.ledgerToken || null), ['abc-1', null, null]);
  await cap.forceRelease({ dir: d, token: r3.token, lock: LOCK });
  // C — no table: held, never freed by a PID check; a waiting reserve frees it once a table confirms it
  const dc = mk('confirm-none');
  const c = await excl(dc, 'C');
  await cap.activate({ dir: dc, token: c.token, pid: 4201, start: T0 + 1000, lock: LOCK });
  const none = await cap.release({ dir: dc, token: c.token, rows: null, lock: LOCK });
  eq(p, 'no table → held', [none.released, /could not be confirmed stopped/.test(none.reason), entryOf(dc, c.token).unconfirmed], [false, true, 'no process table']);
  const gone = () => false;
  const pidOnly = await cap.reserve({ dir: dc, units: 1, limit: 2, owner: { runId: 'NEXT' }, exists: gone, lock: LOCK });
  eq(p, 'every PID gone: the PID check keeps it, the refusal says why', [pidOnly.ok, pidOnly.code, /could not be confirmed stopped/.test(pidOnly.reason), !!entryOf(dc, c.token)], [false, 'exclusive', true, true]);
  const sw = await cap.sweep({ dir: dc, rows: null, exists: gone, lock: LOCK });
  eq(p, 'a tableless sweep lists it unconfirmed, keeps it', [sw.released.length, sw.unconfirmed, !!entryOf(dc, c.token)], [0, [c.token], true]);
  let snaps = 0;
  const waited = await cap.reserve({ dir: dc, units: 1, limit: 2, owner: { runId: 'NEXT' }, exists: gone, waitMs: 2000, pollMs: 10, confirmEveryMs: 0, lock: LOCK,
    snapshot: async () => { snaps++; return { rows: [{ pid: 9, ppid: 1, start: T0, cmd: 'unrelated' }] }; } });
  eq(p, 'a waiting reserve confirms it on a table and is granted', [waited.ok, snaps >= 1, entryOf(dc, c.token)], [true, true, null]);
  // D — releaseConfirmed: kills only the run's own certain survivors, never on a missing table, never a look-alike
  const dd = mk('confirm-kill');
  const k = await excl(dd, 'D');
  await cap.activate({ dir: dd, token: k.token, pid: 4301, start: T0 + 1000, lock: LOCK });
  let table = [OWNER, { pid: 4302, ppid: 4301, start: T0 + 2000, cmd: chrome('Own01') }, { pid: 4303, ppid: 1, start: T0 - 900_000, cmd: chrome('LookAlike') }];
  const killed = [];
  const kill = (pid) => { killed.push(pid); table = table.filter((x) => x.pid !== pid); };
  const noTable = await cap.releaseConfirmed({ dir: dd, token: k.token, snapshot: async () => ({ rows: null, error: 'listing failed' }), attempts: 3, delayMs: 0, kill, lock: LOCK });
  eq(p, 'no table in any attempt → held, nothing killed', [noTable.released, noTable.confirmed, killed], [false, 'none', []]);
  const rc = await cap.releaseConfirmed({ dir: dd, token: k.token, snapshot: async () => ({ rows: table }), attempts: 3, delayMs: 0, kill, lock: LOCK });
  eq(p, 'own survivor stopped, then released; the look-alike untouched', [rc.released, rc.confirmed, killed], [true, 'table', [4302]]);
  const u = await excl(dd, 'U');
  await cap.activate({ dir: dd, token: u.token, pid: 4401, lock: LOCK }); // no start time known
  const unk = [OWNER, { pid: 4402, ppid: 4401, start: null, cmd: 'chrome.exe' }];
  const ru = await cap.releaseConfirmed({ dir: dd, token: u.token, snapshot: async () => ({ rows: unk }), attempts: 2, delayMs: 0, kill, lock: LOCK });
  eq(p, 'a child that cannot be birth-ordered (parent ended) holds the slots, never killed', [ru.released, ru.alive.map((x) => [x.pid, x.certain === false]), killed], [false, [[4402, true]], [4302]]);
  const fr = await cap.forceRelease({ dir: dd, token: u.token, lock: LOCK });
  eq(p, 'forceRelease (user-run) frees it', [fr.released, fr.forced, entryOf(dd, u.token)], [true, true, null]);
});

/* 21 — SESSION HOLDS for playwright-cli (skills 3c, 5b and 9) beside skill 5 under ONE ceiling (2): one hold per session
   name (acquiring it again reuses it — never counted twice; another live owner's session is refused), the mixed holds and
   a run-stage reservation never exceed the ceiling, a hold is released only when a table shows its daemon (cliDaemon.js
   <session>) and browser ended, an abandoned hold whose session still runs stays held (orphaned) until it ends, a hold
   whose owner lives but whose session closed without a release is freed after the grace (a never-opened one after the
   longer open grace), a similar session name never matches, the CLI (acquire --session, track, release --wait). */
await test('21 session holds: 3c / 5b / 9 / skill 5 under one ceiling, one hold per session, confirmed release, abandoned sessions (gap 6)', async (p) => {
  const d = mk('holds');
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ machineMaxWorkers: 2 }));   // Auto is host-dependent: bound at 2 for fixed counts
  const alive = new Set([6100, 6200, 6300]);
  const exists = (pid) => alive.has(pid);
  const H = (pid) => ({ pid, ppid: 1, start: T0 - 1_000_000, cmd: 'claude' });
  const daemon = (pid, ppid, s) => ({ pid, ppid, start: T0 + 5000, cmd: '"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\qa\\AppData\\Roaming\\npm\\node_modules\\@playwright\\cli\\node_modules\\playwright-core\\lib\\entry\\cliDaemon.js ' + s + ' --headed' });
  const browser = (pid, ppid) => ({ pid, ppid, start: T0 + 6000, cmd: 'chrome.exe --user-data-dir=C:\\Temp\\playwright_chromiumdev_profile-' + pid });
  const hold = (owner, runId, session, extra = {}) => cap.acquireHold({ dir: d, runId, owner: { pid: owner, start: T0 - 1_000_000 }, session, exists, now: T0, lock: LOCK, ...extra });
  const used = () => cap.usedUnits(cap.readLedger(d).entries, 'playwright');
  const h3c = await hold(6100, 'skill3c-run', 'qa3c-US1-A1');
  const h5b = await hold(6200, 'skill5b-run', 'qa5b-US1-A1');
  const h9 = await hold(6300, 'skill9-run', 'qa9-US1-A1');
  const cmd = await cap.reserve({ dir: d, units: 1, owner: { runId: 'R5' }, exists, lock: LOCK });
  eq(p, '3c + 5b fill the ceiling; 9 and a skill 5 command wait', [h3c.ok, h5b.ok, h9.ok, h9.code, cmd.ok, used()], [true, true, false, 'busy', false, 2]);
  eq(p, 'recorded as a confirmed session hold', [entryOf(d, h3c.token).session, entryOf(d, h3c.token).confirm, entryOf(d, h3c.token).kind], ['qa3c-US1-A1', 'table', 'session-hold']);
  const again = await hold(6100, 'skill3c-run-2', 'qa3c-US1-A1');
  eq(p, 'the same session again → its hold reused, never counted twice', [again.ok, again.reused, again.token === h3c.token, used()], [true, true, true, 2]);
  const stolen = await hold(6200, 'skill5b-run', 'qa3c-US1-A1');
  eq(p, 'another live owner\'s session is refused', [stolen.ok, stolen.code, /one hold per session/.test(stolen.reason)], [false, 'busy', true]);
  eq(p, 'a bad session name is refused', (await hold(6100, 'x', 'bad name; rm')).code, 'invalid');
  // release only on a table that shows the session ended
  const open = [H(6100), H(6200), H(6300), daemon(7001, 6100, 'qa3c-US1-A1'), browser(7002, 7001), daemon(7003, 6100, 'qa3c-US1-A10')];
  const rel1 = await cap.releaseHold({ dir: d, token: h3c.token, rows: open, now: T0, lock: LOCK });
  eq(p, 'session still open → held (the daemon and its browser; a similar name never matches)', [rel1.released.length, rel1.held.length && rel1.held[0].alive.map((a) => [a.pid, a.why]), used()], [0, [[7001, 'session'], [7002, 'tree']], 2]);
  const relNone = await cap.releaseHold({ dir: d, token: h3c.token, rows: null, lock: LOCK });
  eq(p, 'no table → held', [relNone.released.length, /no process table/.test(relNone.held[0].reason)], [0, true]);
  const rel2 = await cap.releaseHold({ dir: d, token: h3c.token, rows: [H(6100), H(6200), H(6300)], lock: LOCK });
  const h9b = await hold(6300, 'skill9-run', 'qa9-US1-A1');
  eq(p, 'closed → released; skill 9\'s browser now fits', [rel2.released.length, h9b.ok, used()], [1, true, 2]);
  // abandoned: 5b's Claude Code process is gone, its session still runs → orphaned, held; ends → freed by a table sweep
  alive.delete(6200);
  const sw1 = await cap.sweep({ dir: d, rows: [H(6300), daemon(7101, 1, 'qa5b-US1-A1')], now: T0, lock: LOCK });
  const blocked = await cap.reserve({ dir: d, units: 1, owner: { runId: 'R5' }, exists, lock: LOCK });
  eq(p, 'abandoned hold with a live session → orphaned, still counted', [sw1.orphaned.map((o) => o.token), blocked.ok, used()], [[h5b.token], false, 2]);
  const pruneOnly = await cap.sweep({ dir: d, rows: null, exists, lock: LOCK });
  eq(p, 'a PID check never frees it (the session cannot be seen without a table)', [pruneOnly.released.length, !!entryOf(d, h5b.token)], [0, true]);
  const sw2 = await cap.sweep({ dir: d, rows: [H(6300)], now: T0, lock: LOCK });
  eq(p, 'the abandoned session ended → released', [sw2.released.map((x) => x.token), used()], [[h5b.token], 1]);
  // owner alive, session closed without a release: freed after the grace; a never-opened hold only after the open grace
  const e9 = entryOf(d, h9b.token);
  const seen = { ...e9, lastSeenAt: iso(T0) };
  eq(p, 'closed < grace → kept; > grace → released', [cap.decideEntry(seen, [H(6300)], T0 + cap.HOLD_CLOSED_GRACE_MS - 1).action, cap.decideEntry(seen, [H(6300)], T0 + cap.HOLD_CLOSED_GRACE_MS + 1).action], ['keep', 'release']);
  const fresh = { ...e9, lastSeenAt: undefined, activatedAt: iso(T0) };
  eq(p, 'never opened: kept through the open grace', [cap.decideEntry(fresh, [H(6300)], T0 + cap.HOLD_CLOSED_GRACE_MS + 1).action, cap.decideEntry(fresh, [H(6300)], T0 + cap.HOLD_OPEN_GRACE_MS + 1).action], ['keep', 'release']);
  eq(p, 'an open session keeps it however old', cap.decideEntry(seen, [H(6300), daemon(7201, 6300, 'qa9-US1-A1')], T0 + 10 * cap.HOLD_OPEN_GRACE_MS).action, 'keep');
  // adopting an abandoned hold: same session, its owner gone → the new owner takes it over (one browser, one hold)
  const h3 = await hold(6100, 'skill3c-run', 'qa3c-US1-A2');
  alive.delete(6100);
  alive.add(6400);
  const adopt = await hold(6400, 'skill3c-run-3', 'qa3c-US1-A2');
  eq(p, 'an abandoned hold is adopted, not doubled', [adopt.ok, adopt.adopted, adopt.token === h3.token, entryOf(d, h3.token).owner.pid, used()], [true, true, true, 6400, 2]);
  await cap.forceRelease({ dir: d, token: h3.token, lock: LOCK });
  await cap.forceRelease({ dir: d, token: h9b.token, lock: LOCK });
  // QA_LEDGER=off: an exclusive session hold blocks a run-stage command and another session
  const xh = await hold(6300, 'skill9-run', 'qa9-US1-A3', { exclusive: true });
  const nx = await cap.reserve({ dir: d, units: 1, owner: { runId: 'R5' }, exists, lock: LOCK });
  const nh = await hold(6400, 'skill5b-run', 'qa5b-US1-A3');
  eq(p, 'exclusive hold: nothing else starts beside it', [xh.ok, nx.ok, nx.code, nh.ok, nh.code], [true, false, 'exclusive', false, 'exclusive']);
  await cap.forceRelease({ dir: d, token: xh.token, lock: LOCK });
  // the CLI on a fixture table (this harness is the owner)
  const fx = path.join(d, 'ps.json');
  const cliEnv = { ...process.env, QA_CAPACITY_PS_FIXTURE: fx };
  delete cliEnv.QA_LEDGER;
  const cli = (args) => { const r = spawnSync(process.execPath, [CAP, ...args, '--capacity-dir', d], { encoding: 'utf8', env: cliEnv }); let j = {}; try { j = JSON.parse(r.stdout); } catch { p.push('no JSON from ' + args.join(' ')); } return { status: r.status, j }; };
  fs.writeFileSync(fx, JSON.stringify([{ pid: 'PARENT', ppid: 1, start: null, cmd: 'claude' }, { pid: 8801, ppid: 'PARENT', start: new Date().toISOString(), cmd: 'node C:/x/playwright-core/lib/entry/cliDaemon.js qa5b-US9-A1' }, { pid: 8802, ppid: 8801, start: new Date().toISOString(), cmd: 'chrome.exe --user-data-dir=C:/Temp/playwright_chromiumdev_profile-cli' }]));
  const ca = cli(['hold', 'acquire', '--run-id', 'skill5b-cli', '--session', 'qa5b-US9-A1', '--owner-pid', String(process.pid), '--strict']);
  const cb = cli(['hold', 'acquire', '--run-id', 'skill5b-cli', '--session', 'qa5b-US9-A1', '--owner-pid', String(process.pid), '--strict']);
  eq(p, 'CLI acquire --session twice → one hold', [ca.status, ca.j.ok, cb.j.reused, cb.j.token === ca.j.token], [0, true, true, true]);
  const ct = cli(['hold', 'track', '--token', ca.j.token || 'none']);
  eq(p, 'CLI track records the daemon and its browser', [ct.status, ct.j.ok, ct.j.alive, ct.j.markers >= 1], [0, true, 2, true]);
  const cr1 = cli(['hold', 'release', '--token', ca.j.token || 'none', '--strict']);
  eq(p, 'CLI release while the session runs → exit 1, held', [cr1.status, cr1.j.ok, (cr1.j.held || []).length], [1, false, 1]);
  fs.writeFileSync(fx, JSON.stringify([{ pid: 'PARENT', ppid: 1, start: null, cmd: 'claude' }]));
  const cr2 = cli(['hold', 'release', '--token', ca.j.token || 'none', '--wait', '1000', '--strict']);
  eq(p, 'CLI release after the close → exit 0, released', [cr2.status, cr2.j.ok, (cr2.j.released || []).length, cap.readLedger(d).entries.length], [0, true, 1, 0]);
});

/* 22 — CANCELLATION AND CLEANUP with real processes: a run (a real node process) takes an exclusive, confirmed reservation
   and starts a detached "browser"; the run is killed (no clean-up of its own). The real process table then shows the
   entry orphaned and still holding the machine; the next reservation waits; `reclaim` terminates ONLY the recorded tree
   (an unrelated process with a look-alike profile marker survives), after which the slots are freed. No table at all →
   releaseConfirmed keeps it held. */
await test('22 cancellation and cleanup on the real process table: orphaned, held, reclaimed — only the run\'s own (gap 5)', async (p) => {
  const d = mk('cancel');
  const markerDir = mk('cancel-markers');
  const decoy = spawnDetached(path.join(markerDir, 'playwright_chromiumdev_profile-decoy22'));
  const script = [
    "const cap = await import(process.env.C22_CAP);",
    "const { spawn } = await import('node:child_process');",
    "const r = await cap.reserve({ dir: process.env.C22_DIR, units: 1, limit: 2, exclusive: true, liveness: 'pid', confirm: 'table', owner: { runId: 'CANCELLED' } });",
    "const br = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', '--', '--user-data-dir=' + process.env.C22_MARKER], { detached: true, stdio: 'ignore', windowsHide: true });",
    "br.unref();",
    "await cap.activate({ dir: process.env.C22_DIR, token: r.token, pid: br.pid, start: Date.now(), startSource: 'spawn' });",
    "process.stdout.write(JSON.stringify({ token: r.token, browser: br.pid }) + '\\n');",
    "setInterval(() => {}, 1000);",
  ].join('\n');
  const { spawn } = await import('node:child_process');
  const run = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true,
    env: { ...process.env, C22_CAP: pathToFileURL(CAP).href, C22_DIR: d, C22_MARKER: path.join(markerDir, 'playwright_chromiumdev_profile-run22') } });
  const first = await new Promise((resolve) => { let buf = ''; const t = setTimeout(() => resolve(null), 20000); run.stdout.on('data', (c) => { buf += c; const i = buf.indexOf('\n'); if (i >= 0) { clearTimeout(t); try { resolve(JSON.parse(buf.slice(0, i))); } catch { resolve(null); } } }); });
  if (!first) { p.push('the run process did not start'); try { run.kill(); } catch { /* gone */ } try { process.kill(decoy); } catch { /* gone */ } return; }
  run.kill(); // the cancellation: the run ends without releasing anything
  await new Promise((r) => run.once('exit', r));
  const live = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const table = async () => (await cap.processSnapshot({ timeoutMs: 20000 })).rows;
  let rows = await table();
  if (!rows) { p.push('no real process table on this machine'); }
  else {
    const sw = await cap.sweep({ dir: d, rows, lock: LOCK });
    eq(p, 'the cancelled run\'s entry is orphaned and held (its browser runs)', [sw.orphaned.map((o) => o.token), sw.released.length, live(first.browser)], [[first.token], 0, true]);
    const next = await cap.reserve({ dir: d, units: 1, limit: 2, owner: { runId: 'NEXT' }, lock: LOCK });
    eq(p, 'nothing starts beside it', [next.ok, next.code], [false, 'exclusive']);
    const none = await cap.releaseConfirmed({ dir: d, token: first.token, snapshot: async () => ({ rows: null, error: 'listing failed' }), attempts: 2, delayMs: 0, kill: () => p.push('killed on a missing table'), lock: LOCK });
    eq(p, 'no table → still held', [none.released, none.confirmed], [false, 'none']);
    const dry = await cap.reclaim({ dir: d, rows, dryRun: true, lock: LOCK });
    eq(p, 'reclaim --dry-run lists only the run\'s browser', dry.terminated.map((t) => t.pid), [first.browser]);
    const rc = await cap.reclaim({ dir: d, rows, lock: LOCK, snapshot: () => cap.processSnapshot({ timeoutMs: 20000 }) });
    for (let i = 0; i < 20 && live(first.browser); i++) await new Promise((r) => setTimeout(r, 250));
    rows = await table();
    if (entryOf(d, first.token) && rows) await cap.sweep({ dir: d, rows, lock: LOCK });
    eq(p, 'reclaim stopped the run\'s browser only, then the slots were freed', [rc.terminated.map((t) => t.pid), live(first.browser), live(decoy), entryOf(d, first.token)], [[first.browser], false, true, null]);
  }
  for (const pid of [first.browser, decoy]) { try { process.kill(pid); } catch { /* gone */ } }
});

/* 23 — OVERLAPPING ENVIRONMENTS: two runs that list different subsets / aliases of ONE application get different ids but
   share a name or a resolved address — the second is refused while the first holds its lease (whatever the DNS gives); a
   reclaimable overlapping lease is taken over; disjoint environments stay independent; a lease without tokens (written
   before them) is compared by its member names. */
await test('23 overlapping environments never hold independent leases (subsets, aliases, shared addresses, no DNS)', async (p) => {
  const facts = {
    'app.example.com': { cnames: [], addresses: ['10.0.0.1'] },
    'api.example.com': { cnames: [], addresses: ['10.0.0.1'] },
    'www.example.com': { cnames: ['app.example.com'], addresses: ['10.0.0.1'] },
    'other.example.org': { cnames: [], addresses: ['10.9.9.9'] },
  };
  const resolve = async (h) => { if (!facts[h]) throw new Error('ENOTFOUND'); return facts[h]; };
  const HOST = { pid: 2000, ppid: 1, start: 500_000, cmd: '"C:\\Users\\qa\\AppData\\Local\\Claude\\claude.exe"' };
  const alive = [HOST];
  const owner = { pid: 2000, start: 500_000, how: 'claude' };
  const d = mk('lease-overlap');
  const lease = async (runId, hosts, extra = {}) => {
    const id = await cap.environmentIdentity({ hosts, resolve, ...extra });
    const r = await cap.acquireLease({ dir: d, envId: id.id, members: id.members, tokens: id.tokens, runId, runFile: '/' + runId + '/.runs/phase-1.json', owner, rows: alive, now: T0, lock: LOCK });
    return { id, r };
  };
  const a = await lease('R1', ['https://app.example.com']);
  const b = await lease('R2', ['https://app.example.com', 'https://api.example.com']);
  eq(p, 'the probe of the review: different ids for one application', a.id.id !== b.id.id, true);
  eq(p, 'tokens carry the names and the shared address', a.id.tokens, ['addr:10.0.0.1', 'name:app.example.com']);
  eq(p, 'R1 holds; R2 (a superset) is refused, naming R1 and what is shared', [a.r.ok, b.r.ok, b.r.code, b.r.heldBy && b.r.heldBy.runId, b.r.heldBy && b.r.heldBy.shared], [true, false, 'held', 'R1', ['addr:10.0.0.1', 'name:app.example.com']]);
  const c = await lease('R3', ['https://api.example.com']);
  eq(p, 'a different host on the same address is refused too', [c.r.ok, c.r.heldBy && c.r.heldBy.shared], [false, ['addr:10.0.0.1']]);
  const w = await lease('R4', ['https://www.example.com']);
  eq(p, 'an alias by CNAME is refused', [w.r.ok, w.r.code], [false, 'held']);
  const nd = await lease('R5', ['https://app.example.com:8443'], { useDns: false });
  eq(p, 'without DNS another port of the same host (another id) still overlaps by name', [nd.id.id !== a.id.id, nd.r.ok, nd.r.heldBy && nd.r.heldBy.shared], [true, false, ['name:app.example.com']]);
  const o = await lease('R6', ['https://other.example.org']);
  eq(p, 'a disjoint environment stays independent', o.r.ok, true);
  const again = await lease('R1', ['https://app.example.com', 'https://api.example.com']);
  eq(p, 'the holder may widen its own environment (its other lease is its own)', again.r.ok, true);
  // R1's owner is gone and nothing of it runs: an overlapping request takes both of its leases over (cleanup_incomplete)
  const id2 = await cap.environmentIdentity({ hosts: ['https://api.example.com'], resolve });
  const take = await cap.acquireLease({ dir: d, envId: id2.id, members: id2.members, tokens: id2.tokens, runId: 'R7', owner: { pid: 2500, start: 1 }, rows: [{ pid: 2500, ppid: 1, start: 1, cmd: 'claude' }], now: T0 + 1000, lock: LOCK });
  const runsLeft = Object.values(cap.readLedger(d).leases).map((l) => l.runId).sort();
  eq(p, 'reclaimable overlapping leases are taken over with a warning', [take.ok, take.warnings.some((x) => /overlapping lease .* of run R1 .*was taken over/.test(x) && /cleanup_incomplete/.test(x)), runsLeft], [true, true, ['R6', 'R7']]);
  // a lease written before tokens existed: compared by its member names
  const d2 = mk('lease-legacy');
  const led = cap.readLedger(d2);
  await cap.acquireLease({ dir: d2, envId: 'old-id', members: ['app.example.com'], runId: 'OLD', owner, rows: alive, now: T0, lock: LOCK });
  const raw = JSON.parse(fs.readFileSync(path.join(d2, 'ledger.json'), 'utf8'));
  delete raw.leases['old-id'].tokens;
  fs.writeFileSync(path.join(d2, 'ledger.json'), JSON.stringify(raw));
  const nid = await cap.environmentIdentity({ hosts: ['https://app.example.com', 'https://api.example.com'], resolve });
  const r2 = await cap.acquireLease({ dir: d2, envId: nid.id, members: nid.members, tokens: nid.tokens, runId: 'NEW', owner, rows: alive, now: T0, lock: LOCK });
  eq(p, 'a token-less legacy lease still blocks by member name', [led.error || null, r2.ok, r2.heldBy && r2.heldBy.runId], [null, false, 'OLD']);
});

/* 24 — LEASE TAKEOVER needs more than a dead owner: a process the owner started AFTER taking the lease (a shell, a
   playwright-cli daemon) and its tree (the browser) keep the lease held although no ledger entry records them; a child
   older than the lease (an MCP server of the session) does not; a reused owner pid fathers only children born before the
   reuse; an owner without a start time keeps every child (cannot be birth-ordered); no table keeps it. */
await test('24 lease takeover: a dead owner is not enough — surviving processes it started after the lease keep it held', async (p) => {
  const OWNER = { pid: 2000, start: T0 - 3600_000, how: 'claude' };
  const lease = { envId: 'env-strays', runId: 'R1', runFile: '/R1/.runs/phase-1.json', owner: OWNER, state: 'held', acquiredAt: iso(T0) };
  const shell = { pid: 2600, ppid: 2000, start: T0 + 5000, cmd: 'cmd.exe /c playwright-cli -s=admin open https://app.example.com' };
  const browser = { pid: 2601, ppid: 2600, start: T0 + 6000, cmd: 'chrome.exe --user-data-dir=C:\\Temp\\playwright_chromiumdev_profile-x' };
  const mcp = { pid: 2700, ppid: 2000, start: T0 - 600_000, cmd: 'node @playwright/mcp/cli.js' };
  let d = cap.decideLease(lease, [], [shell, browser], T0 + 60_000);
  eq(p, 'the shell and the browser below it keep the lease', [d.action, (d.alive || []).map((a) => a.pid).sort()], ['keep', [2600, 2601]]);
  d = cap.decideLease(lease, [], [browser, { ...shell }], T0 + 60_000);
  eq(p, 'the reason names what is alive', /started after taking the lease are still alive/.test(d.why), true);
  d = cap.decideLease(lease, [], [mcp], T0 + 60_000);
  eq(p, 'a child older than the lease (the session\'s MCP server) is not the run\'s', [d.action, d.warning], ['release', 'cleanup_incomplete']);
  const reused = { pid: 2000, ppid: 1, start: T0 + 30_000, cmd: 'notepad.exe' };
  d = cap.decideLease(lease, [], [reused, { pid: 2800, ppid: 2000, start: T0 + 40_000, cmd: 'notepad-child.exe' }], T0 + 60_000);
  eq(p, 'the owner pid reused by another process: that process\'s child is not the run\'s', d.action, 'release');
  d = cap.decideLease(lease, [], [reused, shell], T0 + 60_000);
  eq(p, 'the owner pid reused, but a child born before the reuse is still the run\'s', d.action, 'keep');
  d = cap.decideLease({ ...lease, owner: { pid: 2000, start: null } }, [], [shell], T0 + 60_000);
  eq(p, 'an owner without a start time: its children cannot be birth-ordered — kept', d.action, 'keep');
  eq(p, 'no table → kept', cap.decideLease(lease, [], null, T0 + 60_000).action, 'keep');
  // through acquireLease (same id) and through an overlapping request: both refused while the browser lives
  const dd = mk('lease-strays');
  await cap.acquireLease({ dir: dd, envId: 'env-strays', members: ['app.example.com'], runId: 'R1', runFile: '/R1/.runs/phase-1.json', owner: OWNER, rows: [{ ...OWNER, ppid: 1, cmd: 'claude' }], now: T0, lock: LOCK });
  const same = await cap.acquireLease({ dir: dd, envId: 'env-strays', members: ['app.example.com'], runId: 'R2', owner: { pid: 3000, start: T0 }, rows: [shell, browser], now: T0 + 60_000, lock: LOCK });
  const over = await cap.acquireLease({ dir: dd, envId: 'env-other', members: ['app.example.com', 'api.example.com'], runId: 'R3', owner: { pid: 3000, start: T0 }, rows: [shell, browser], now: T0 + 60_000, lock: LOCK });
  eq(p, 'acquireLease refuses while the browser lives (same id, overlapping id)', [same.ok, same.code, over.ok, over.code], [false, 'held', false, 'held']);
  const sw = await cap.sweep({ dir: dd, rows: [shell, browser], now: T0 + 60_000, lock: LOCK });
  eq(p, 'sweep keeps it too', [sw.leasesReleased.length, Object.keys(cap.readLedger(dd).leases)], [0, ['env-strays']]);
  const gone = await cap.acquireLease({ dir: dd, envId: 'env-strays', members: ['app.example.com'], runId: 'R2', owner: { pid: 3000, start: T0 }, rows: [], now: T0 + 120_000, lock: LOCK });
  eq(p, 'once nothing of it lives: taken over with cleanup_incomplete', [gone.ok, gone.reclaimed && gone.reclaimed.warning], [true, 'cleanup_incomplete']);
});

/* 25 — ONE RATE-LIMIT BOOK per overlapping environment group: a later run under another id of the same application paces
   against the book that holds the earlier run's server deadline; disjoint environments keep their own; a request that
   bridges two books merges them (the later notBefore, every slot, the higher refusal count, the stricter advertisement)
   and redirects the younger; validateLease hands run-stage the book. */
await test('25 overlapping environments share one rate-limit book (deadlines never shortened by a merge)', async (p) => {
  const d = mk('books');
  const owner = { pid: 2000, start: 500_000, how: 'claude' };
  const rows = [{ pid: 2000, ppid: 1, start: 500_000, cmd: 'claude' }];
  const acq = (envId, tokens, runId, now = T0) => cap.acquireLease({ dir: d, envId, tokens, members: [], runId, runFile: '/' + runId + '/.runs/phase-1.json', owner, rows, now, lock: LOCK });
  const book = (id) => JSON.parse(fs.readFileSync(cap.rateLimitStatePath(d, id), 'utf8'));
  const writeBook = (id, buckets) => { fs.mkdirSync(path.join(d, 'rate-limits'), { recursive: true }); fs.writeFileSync(cap.rateLimitStatePath(d, id), JSON.stringify({ schema: 'skill5-ratelimit-state/1', updatedAt: iso(T0), buckets })); };
  const NB = Date.now() + 60_000;
  const a = await acq('envA', ['addr:10.0.0.1', 'name:app.example.com'], 'R1');
  eq(p, 'the first lease names its own book', [a.ok, a.bookId], [true, 'envA']);
  writeBook('envA', { 'service:login': { slots: [1, 2], notBefore: NB, advertised: { pace: 5, windowMs: 60000, at: 1 }, refusals: 1, lastRefusalAt: 5, recovery: null, lastWindowMs: 60000, updatedAt: 10 } });
  await cap.releaseLease({ dir: d, envId: 'envA', runId: 'R1', lock: LOCK });
  const b = await acq('envB', ['addr:10.0.0.1', 'name:api.example.com'], 'R2', T0 + 1000);
  const vb = await cap.validateLease({ dir: d, envId: 'envB', runId: 'R2', rows });
  eq(p, 'another id of the same application (shared address) paces against the SAME book', [b.ok, b.bookId, vb.bookId], [true, 'envA', 'envA']);
  const c = await acq('envC', ['addr:10.9.9.9', 'name:other.example.org'], 'R3', T0 + 2000);
  eq(p, 'a disjoint environment keeps its own book', c.bookId, 'envC');
  writeBook('envC', { 'service:login': { slots: [2, 3], notBefore: NB + 60_000, advertised: { pace: 3, windowMs: 60000, at: 2 }, refusals: 4, lastRefusalAt: 9, recovery: { since: 7 }, lastWindowMs: 30000, updatedAt: 5 },
    'endpoint:GET /api/x': { slots: [], notBefore: NB + 5000, advertised: null, refusals: 1, lastRefusalAt: 8, recovery: null, lastWindowMs: 0, updatedAt: 8 } });
  await cap.releaseLease({ dir: d, envId: 'envB', runId: 'R2', lock: LOCK });
  await cap.releaseLease({ dir: d, envId: 'envC', runId: 'R3', lock: LOCK });
  const bridge = await acq('envD', ['addr:10.0.0.1', 'addr:10.9.9.9'], 'R4', T0 + 3000);
  const m = book('envA');
  const login = m.buckets['service:login'];
  eq(p, 'a bridging request merges the younger book into the older', [bridge.ok, bridge.bookId, bridge.booksMerged, cap.readLedger(d).books.envC.mergedInto], [true, 'envA', ['envC'], 'envA']);
  eq(p, 'merged: the later deadline, every slot, the higher refusal count, the stricter advertisement, the later recovery',
    [login.notBefore, login.slots, login.refusals, login.lastRefusalAt, login.advertised.pace, login.recovery && login.recovery.since, !!m.buckets['endpoint:GET /api/x']],
    [NB + 60_000, [1, 2, 3], 4, 9, 3, 7, true]);
  await cap.releaseLease({ dir: d, envId: 'envD', runId: 'R4', lock: LOCK });
  const c2 = await acq('envC', ['name:other.example.org'], 'R5', T0 + 4000);
  eq(p, 'a later lease under the redirected id follows to the merged book', [c2.ok, c2.bookId, (await cap.validateLease({ dir: d, envId: 'envC', runId: 'R5', rows })).bookId], [true, 'envA', 'envA']);
  await cap.releaseLease({ dir: d, envId: 'envC', runId: 'R5', lock: LOCK });
  const bare = await cap.acquireLease({ dir: d, envId: 'envE', runId: 'R6', owner, rows, now: T0 + 5000, lock: LOCK });
  eq(p, 'a lease without an identity (--env-id only) keeps its own book', bare.bookId, 'envE');
  // a ledger lease written before books existed: its own id
  eq(p, 'bookOf on a legacy lease', cap.bookOf({ books: {} }, { envId: 'old' }), 'old');
  // pure merge: never a shorter deadline from either side, legacy books read as service buckets
  const mm = cap.mergeRateBooks({ login: [5] }, { schema: 'skill5-ratelimit-state/1', buckets: { 'service:login': { slots: [6], notBefore: 99, refusals: 2 } } });
  eq(p, 'legacy + current merge', [mm.buckets['service:login'].slots, mm.buckets['service:login'].notBefore], [[5, 6], 99]);
});

/* 26 — LOCK RELEASE never leaves an ownerless folder (the cause of the 10-30 s stalls, measured with QA_CAPACITY_TRACE:
   a recursive delete refused with EPERM while a contender read owner.json). A folder marked released is broken at once; a
   release while another process holds owner.json open frees the lock in seconds, not 30 s; real processes contending for
   one lock lose no update, never give up at the default bound and leave no lock behind; a legacy ownerless folder still
   waits out the 30 s rule. */
await test('26 lock release: no ownerless folder after a refused delete; mutual exclusion under real contention', async (p) => {
  const d = mk('lock-release');
  fs.mkdirSync(path.join(d, 'ledger.lock'));
  fs.writeFileSync(path.join(d, 'ledger.lock', 'released-1-abc.json'), '{}');
  let t = Date.now();
  const r1 = await cap.withLock(d, 'ledger', () => 'ran', { giveUpMs: 500 });
  eq(p, 'a folder marked released (no owner) is broken at once', [r1, Date.now() - t < 500], ['ran', true]);
  // the owner releases while another holder has owner.json open (Windows: the folder cannot be renamed or deleted then)
  let fd = null;
  await cap.withLock(d, 'ledger', () => { fd = fs.openSync(path.join(d, 'ledger.lock', 'owner.json'), 'r'); });
  const left = fs.existsSync(path.join(d, 'ledger.lock')) ? fs.readdirSync(path.join(d, 'ledger.lock')) : [];
  eq(p, 'after the release the folder is gone or holds only a released marker — never an ownerless folder', left.every((n) => /^released-/.test(n)) && !left.includes('owner.json'), true);
  setTimeout(() => { try { fs.closeSync(fd); } catch { /* closed */ } }, 300);
  t = Date.now();
  const r2 = await cap.withLock(d, 'ledger', () => 'ran', { giveUpMs: 5000 });
  eq(p, 'the next taker gets it in seconds (not the 30 s ownerless rule)', [r2, Date.now() - t < 5000], ['ran', true]);
  // a legacy ownerless folder (no marker) still waits: it may be a creator still writing its owner file
  fs.mkdirSync(path.join(d, 'ledger.lock'));
  let threw = null;
  try { await cap.withLock(d, 'ledger', () => 'ran', { giveUpMs: 300 }); } catch (e) { threw = e; }
  eq(p, 'an ownerless folder without a marker is not broken before 30 s', threw && threw.code, 'ELOCKBUSY');
  fs.rmSync(path.join(d, 'ledger.lock'), { recursive: true, force: true });
  // real contention: 4 processes × 60 cycles, a shared counter incremented INSIDE the lock
  const dir = mk('lock-stress');
  fs.writeFileSync(path.join(dir, 'counter.json'), '0');
  const child = 'const fs=require("fs"),path=require("path");(async()=>{const cap=await import(' + JSON.stringify(pathToFileURL(CAP).href) + ');const dir=' + JSON.stringify(dir) + ';let ok=0,busy=0;'
    + 'for(let i=0;i<60;i++){try{await cap.withLock(dir,"ledger",async()=>{const f=path.join(dir,"counter.json");const v=Number(fs.readFileSync(f,"utf8"));fs.writeFileSync(f,String(v+1));});ok++;}catch(e){if(e&&e.code==="ELOCKBUSY")busy++;else throw e;}}'
    + 'console.log(JSON.stringify({ok,busy}));})();';
  const { spawn } = await import('node:child_process');
  const runs = await Promise.all([0, 1, 2, 3].map(() => new Promise((resolve) => {
    const c = spawn(process.execPath, ['-e', child], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (x) => { out += x; });
    c.on('exit', () => { try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch { resolve({ ok: 0, busy: -1, out }); } });
  })));
  const ok = runs.reduce((s, r) => s + r.ok, 0);
  const busy = runs.reduce((s, r) => s + r.busy, 0);
  const counter = Number(fs.readFileSync(path.join(dir, 'counter.json'), 'utf8'));
  eq(p, '240 contended cycles: no giveup, no lost update, no lock left behind', [ok, busy, counter, fs.existsSync(path.join(dir, 'ledger.lock'))], [240, 0, 240, false]);
});

function spawnDetached(marker) {
  const r = spawnSync(process.execPath, ['-e', "const c = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', '--', '--user-data-dir=' + process.argv[1]], { detached: true, stdio: 'ignore', windowsHide: true }); c.unref(); console.log(c.pid);", marker], { encoding: 'utf8' });
  return Number(String(r.stdout).trim());
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* a temp folder left behind is harmless */ }
const out = {
  tool: 'selftest-capacity',
  ran: cases.length,
  ok: fail.length === 0,
  cases,
  mismatches: fail,
  note: fail.length
    ? 'capacity.mjs / ledger-exec.mjs disagree with their fixtures. Keep the ledger switched off (and so no concurrent dispatch) until this passes.'
    : 'The ceiling, the ledger, the pressure monitor, the environment identity and the lease match every hand-computed expectation.',
};
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
