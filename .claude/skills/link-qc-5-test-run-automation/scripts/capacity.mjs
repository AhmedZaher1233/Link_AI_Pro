#!/usr/bin/env node
// capacity.mjs — the machine capacity ledger of skill 5: ONE machine ceiling for every Playwright worker the skill-5 /
// skill-9 runners launch, an atomic reservation ledger shared by every run under this OS user (or an admin-provisioned
// QA_CAPACITY_DIR), host-pressure detection, and the EXCLUSIVE environment lease that keeps two runs off the same
// application environment. Node >= 18, zero dependencies.
//
// Contract: optimisation plan Revision 3.1 §3.6 (environment identity and lease) and §4.1-§4.6 (ceiling, ledger,
// two-phase spawn, release, capacity arithmetic, pressure). It never decides a TC status and never kills a process it
// did not record — `reclaim` (user-run) terminates only orphaned trees whose PID + start time was recorded, or that
// carry a recorded browser profile marker.
//
// The coordination directory (resolveCapacityDir) holds:
//   config.json                 { "machineMaxWorkers": 6, "classes": { "compliance": 2, "reviewer": 2 } } — written by a
//                               human (or the CI pipeline owner) only. The ceiling is AUTO (resolveCeiling: from the host's
//                               total memory / CPU); machineMaxWorkers is its absolute upper bound (absent / "auto" → AUTO_MAX).
//   ledger.json  (+ ledger.lock/)   reservations, the queue of waiting reservations and the environment leases
//   rate-limits/{envId}.json (+ {envId}.json.lock/)   the shared rate-limit bucket state (helpers/rate-limit.ts) —
//                               same lock protocol: rateLimitStatePath() names the file, withLock(dir, '{envId}.json').
// Lock protocol (everything shared): `mkdir {name}.lock` is the lock; `{name}.lock/owner.json` = {pid, start, host, at,
// token}. A lock whose owner is dead (PID gone, or the PID now belongs to a process with another start time) is broken at
// once; a lock with NO owner file (its writer died between mkdir and the owner write) only after 30 s, which no live
// holder can reach. Data files are written temp + rename; temp files older than 10 min are removed.
//
// Ledger entry: { token, class: playwright|compliance|reviewer, units, state: spawning|active|releasing|orphaned,
//   owner {pid, start, runId, runFile}, demand {memMb, cpu} per unit | null, environment | null, createdAt, activatedAt,
//   heartbeatAt, wrapper {pid, start} | null, child {pid, start} | null, descendants [{pid, start}], ended [{pid, start}],
//   markers [], exclusive: boolean, liveness: 'table' | 'pid', confirm?: 'table', kind?: 'session-hold', session?,
//   lastSeenAt? }.
// OWNERSHIP (what keeps an entry's slots held): its recorded processes (pid + start time — a reused PID is someone else),
// any process carrying its token on the command line (the ledger-exec wrapper) or in its environment (QA_LEDGER_TOKEN,
// read from /proc on Linux), any process carrying one of its recorded browser profile markers, a session hold's
// playwright-cli daemon (`cliDaemon.js <session>`), every child of a recorded process — also of one that has ENDED (an
// orphaned browser keeps its dead parent's pid on Windows): a child born before its recorded parent, before the entry,
// or after that parent's pid was reused by another process is not ours — and every descendant of all of these. A child
// whose birth cannot be ordered against its parent's holds the slots but is never terminated.
// CONFIRMED RELEASE (`confirm: 'table'` — every exclusive command, probe and session hold): such an entry is released
// only on a FRESH process table that shows none of its processes alive. Without a table — the listing failed — it stays
// held ("could not be confirmed stopped"), whatever its PIDs say: a PID check can keep or orphan it, never free it. A
// waiting reserve() takes a table every CONFIRM_EVERY_MS and frees what the table confirms; `sweep` does the same; a
// user who checked by hand may free one entry with `release --token <t> --force`. Nothing is ever terminated on a guess:
// releaseConfirmed() kills only what a fresh table shows alive with its recorded identity.
// EXCLUSIVE execution — the hard cap when the ledger machinery is rolled back (QA_LEDGER=off / --no-ledger) or cannot run
// (no process listing): reserve({ exclusive: true, liveness: 'pid', confirm: 'table' }) is granted only while NO other live
// Playwright entry exists, and while an exclusive entry is live nothing else of the class is granted — one Playwright
// command at a time on the machine, never above the ceiling. Its OWNER is judged by PID existence (no process table
// needed; an existing PID — also a reused one — counts as alive); its release needs the confirmation above. It is pruned
// inside every reserve() and by a sweep without a table. Disabling the ledger therefore never permits an uncoordinated
// launch; an unusable coordination directory or ledger file refuses the launch instead.
// Session holds (`hold acquire | track | release`): a long-lived reservation for a browser this machine runs OUTSIDE
// run-stage (the playwright-cli sessions of skills 3c, 5b and 9) — owned by the Claude Code process like a lease, ONE per
// session name (acquiring the same session again reuses its hold — a browser is never counted twice), released only when a
// table confirms the session's daemon and browser have ended. An abandoned hold (its owner gone) stays held while its
// session runs; a hold whose owner lives but whose session was closed without a release is freed after HOLD_CLOSED_GRACE_MS
// (HOLD_OPEN_GRACE_MS when the session was never seen — the acquire → open window).
// Two-phase spawn: reserve() writes `spawning` + a unique token; the parent spawns `ledger-exec.mjs <token> -- <cmd>`,
// which registers its OWN pid + start (registerWrapper) before starting the command; the parent records the child
// (activate) → `active`. A periodic tree walk (track) records descendants and browser profile markers. release() frees
// the slots only when nothing recorded or marked is alive — a stale heartbeat NEVER releases capacity. sweep() resolves
// entries whose owner died: tree alive → `orphaned` (capacity held, reported); nothing alive → released; `spawning` with
// no wrapper registered → held for a 60 s grace, then the token is looked for in every command line.
//
// CLI (compact JSON on stdout, exit 0 unless --strict):
//   node capacity.mjs status | config | sweep | reclaim [--dry-run]                       [--capacity-dir <dir>] [--pretty]
//   node capacity.mjs lease acquire --env <url,…> [--test-data <TEST-DATA md>] [--aliases a=b,…] --run-file <f>
//                                   [--run-id <id>] [--owner-pid <pid>] [--wait <ms>] [--no-dns] [--dns-timeout <ms>]
//   node capacity.mjs lease status  (--env <url,…> | --env-id <id>) [--aliases …] [--no-dns]
//   node capacity.mjs lease release (--env <url,…> | --env-id <id>) (--run-file <f> | --run-id <id>) [--quiet-ms <ms>] [--force]
//   node capacity.mjs hold acquire --run-file <f> [--run-id <id>] --session <name> [--workers 1] [--owner-pid <pid>] [--wait <ms>] [--label <text>]
//   node capacity.mjs hold track   --token <t>
//   node capacity.mjs hold release (--token <t> | --run-file <f> [--run-id <id>] [--session <name>]) [--wait <ms>]
//   node capacity.mjs release --token <t> [--wait <ms>] [--force]       (user-run; --force frees WITHOUT confirmation)
// --strict: lease / hold acquire 0 acquired · 1 held by another run / no free slot · 2 error; hold release / release 0
// released · 1 still open or not confirmed · 2 error; everything else 0 (2 on a command error).
// A lease names its run (runId) and the run file it serves. run-stage accepts it for a call on that run file even when the
// runId differs — how skill 9 retests phase N of a story under its OWN lease (`--run-id`), never inheriting skill 5's.
// The harness seam QA_CAPACITY_PS_FIXTURE names a JSON process table ("SELF" / "PARENT" stand for this process / its parent);
// a file that cannot be read is a failed listing (no table).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, domainToASCII, pathToFileURL } from 'node:url';
import { parseArgs, print, posix, sha256 } from './scan-lib.mjs';

export const CAPACITY_SCHEMA = 'skill5-capacity/1';
// Auto ceiling (resolveCeiling): AUTO_MAX is the safety upper bound when config.json sets none — raise or lower it
// there with machineMaxWorkers; AUTO_FALLBACK is used only when the host readings are unusable
export const AUTO_MAX = 8;
export const AUTO_FALLBACK = 2;
export const DEFAULT_CEILING = AUTO_FALLBACK;
export const DEFAULT_CLASS_LIMITS = Object.freeze({ compliance: 2, reviewer: 2 });
export const LIVE_STATES = Object.freeze(['spawning', 'active', 'releasing', 'orphaned']);
export const START_TOLERANCE_MS = 2000;
// a start time this module derived itself (startSource 'node' = this process's uptime, 'spawn' = the spawn moment) is
// compared more leniently than one read from the OS process table: a slow start must never make a live owner look dead
export const APPROX_TOLERANCE_MS = 10000;
export const OWNERLESS_LOCK_MS = 30000;
export const STALE_TEMP_MS = 10 * 60 * 1000;
export const SPAWNING_GRACE_MS = 60000;
export const WARMUP_MS = 60000;
// a waiting reserve() takes a process table at most this often to confirm entries that ended without a confirmed release
export const CONFIRM_EVERY_MS = 10000;
// a session hold whose owner lives but whose session no table shows: freed after these (never seen = acquire → open window)
export const HOLD_CLOSED_GRACE_MS = 120000;
export const HOLD_OPEN_GRACE_MS = 15 * 60 * 1000;
export const ENDED_KEEP = 200;
// per worker (Playwright) or per process (compliance), the ×1.5 bootstrap safety already applied (§4.3)
export const BOOTSTRAP_DEMAND = Object.freeze({ headed: { memMb: 1536, cpu: 1.5 }, headless: { memMb: 768, cpu: 0.75 }, compliance: { memMb: 1536, cpu: 1 }, backend: { memMb: 256, cpu: 0.25 } });
// this process's start time as the OS reports it to within milliseconds (the process table is compared with a 2 s tolerance)
export const SELF_START = Date.now() - Math.round(process.uptime() * 1000);

const MB = 1024 * 1024;
const here = path.dirname(fileURLToPath(import.meta.url));
const isoOf = (ms) => new Date(ms).toISOString();
const msOf = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v ? Date.parse(v) : NaN);
const nowOf = (now) => (typeof now === 'function' ? now() : Number.isFinite(now) ? now : Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* best effort */ } };
const uniq = (xs) => [...new Set(xs)];
const posInt = (v) => { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return Number.isInteger(n) && n > 0 ? n : null; };

function readJsonFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return e && e.code === 'ENOENT' ? { exists: false, value: null, error: null } : { exists: true, value: null, error: e.message }; }
  try { return { exists: true, value: JSON.parse(text.replace(/^\uFEFF/, '')), error: null }; } catch (e) { return { exists: true, value: null, error: 'not valid JSON (' + e.message + ')' }; }
}

/* ---------------- the coordination directory, the config, the ceiling ---------------- */

export function describeCapacityDir(env = process.env) {
  const raw = env && typeof env.QA_CAPACITY_DIR === 'string' ? env.QA_CAPACITY_DIR.trim() : '';
  const home = path.join(os.homedir(), '.link-ai-pro', 'capacity');
  if (!raw) return { dir: home, source: 'home', warning: null };
  // every process must resolve the SAME folder: a relative value would depend on each one's working directory
  if (!path.isAbsolute(raw)) return { dir: home, source: 'home', warning: 'QA_CAPACITY_DIR "' + raw + '" is not an absolute path — ignored; using ' + home };
  return { dir: path.resolve(raw), source: 'QA_CAPACITY_DIR', warning: null };
}

export function resolveCapacityDir(env = process.env) { return describeCapacityDir(env).dir; }

export const configFile = (dir) => path.join(dir, 'config.json');
export const ledgerFile = (dir) => path.join(dir, 'ledger.json');
export const rateLimitStatePath = (dir, envId) => path.join(dir, 'rate-limits', String(envId) + '.json');

// config.json — written by hand only. `error` concerns the ceiling (unreadable file, invalid machineMaxWorkers) and makes
// the ceiling fail safe; a bad class value is only a warning (that class keeps its default).
export function readConfig(dir) {
  const file = configFile(dir);
  const classes = { ...DEFAULT_CLASS_LIMITS };
  const r = readJsonFile(file);
  if (!r.exists) return { machineMaxWorkers: null, classes, file: null, error: null, warnings: [] };
  if (r.error) return { machineMaxWorkers: null, classes, file, error: 'config.json: ' + r.error, warnings: [] };
  const c = r.value;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { machineMaxWorkers: null, classes, file, error: 'config.json is not a JSON object', warnings: [] };
  const warnings = [];
  let max = null;
  let error = null;
  if (c.machineMaxWorkers !== undefined && c.machineMaxWorkers !== null && c.machineMaxWorkers !== 'auto') {
    max = posInt(c.machineMaxWorkers);
    if (max === null) error = 'config.json machineMaxWorkers must be a positive integer (got ' + JSON.stringify(c.machineMaxWorkers) + ')';
  }
  for (const k of Object.keys(DEFAULT_CLASS_LIMITS)) {
    const v = c.classes && typeof c.classes === 'object' ? c.classes[k] : undefined;
    if (v === undefined) continue;
    if (posInt(v) === null) warnings.push('config.json classes.' + k + ' must be a positive integer — default ' + DEFAULT_CLASS_LIMITS[k] + ' kept');
    else classes[k] = posInt(v);
  }
  return { machineMaxWorkers: max, classes, file, error, warnings };
}

// Auto (§4.1 revised): the machine ceiling is computed from the host's TOTAL capacity — never its current free memory,
// so every run on this machine computes the same value — and bounded by `upper`:
//   min(floor((totalMemMb − reserve.memMb) / perWorker.memMb), floor((cpus − reserve.cores) / perWorker.cpu)), within [1, upper]
// perWorker = BOOTSTRAP_DEMAND[kind] (headed by default: visible windows cost more). Current load, other runs'
// reservations and host pressure are NOT part of the ceiling: reserve()'s admission decides them at every launch.
// Unusable readings → AUTO_FALLBACK, with the reason. AUTO_MAX is a SAFETY upper bound, not the worker count chosen.
export function autoCeiling({ totalMemMb, cpus, ci = false, kind = 'headed', upper = AUTO_MAX } = {}) {
  const per = BOOTSTRAP_DEMAND[kind] || BOOTSTRAP_DEMAND.headed;
  const basis = { totalMemMb: Number.isFinite(totalMemMb) ? totalMemMb : null, cpus: Number.isFinite(cpus) ? cpus : null, kind, perWorker: { memMb: per.memMb, cpu: per.cpu }, upper };
  if (!(totalMemMb > 0) || !(cpus > 0)) return { value: Math.min(AUTO_FALLBACK, upper), basis, reason: 'host memory / CPU readings unavailable — conservative fallback ' + Math.min(AUTO_FALLBACK, upper) };
  const reserves = reservesFor({ ci, totalMemMb, cpus });
  basis.reserves = reserves;
  const byMem = Math.floor((totalMemMb - reserves.memMb) / per.memMb);
  const byCpu = Math.floor((cpus - reserves.cores) / per.cpu);
  basis.byMem = byMem;
  basis.byCpu = byCpu;
  const value = Math.max(1, Math.min(upper, byMem, byCpu));
  // 1 stays the ceiling's floor (an upper bound, never a launch decision); a host whose TOTAL memory / cores cannot hold
  // one worker of this kind beside the reserve is flagged — the runner blocks before any side effect instead of waiting
  // for an admission that can never come (and never launches anyway: admission still decides every launch)
  const insufficient = byMem < 1 || byCpu < 1;
  return { value, basis, reason: null, ...(insufficient ? { insufficient: true, insufficientReason: 'this host cannot hold one ' + kind + ' worker beside its reserve: '
    + (byMem < 1 ? totalMemMb + ' MB total − ' + reserves.memMb + ' MB reserve < ' + per.memMb + ' MB per worker' : '') + (byMem < 1 && byCpu < 1 ? '; ' : '')
    + (byCpu < 1 ? cpus + ' cores − ' + reserves.cores + ' reserved < ' + per.cpu + ' per worker' : '') } : {}) };
}

// The ceiling is Auto (above), bounded by config.json machineMaxWorkers when set (an absolute upper bound written by hand
// — "auto" or absent = AUTO_MAX); an unreadable or invalid file → 1, fail safe. QA_MAX_WORKERS, the project limit
// (qa-manifest.json execution.maxWorkers) and --workers may only LOWER it: a value above it is listed under refusedRaises.
// `host` ({totalMemMb, cpus}) replaces the readings (run-stage passes its fixture-aware ones); `kind` headed | headless.
export function resolveCeiling({ dir = resolveCapacityDir(), env = process.env, manifest = null, workersFlag = null, config = null, host = null, kind = 'headed' } = {}) {
  const cfg = config || readConfig(dir);
  let base;
  let source;
  let auto = null;
  const upper = cfg.machineMaxWorkers || AUTO_MAX;
  if (cfg.error) { base = 1; source = 'config-error'; }
  else {
    const h = host || hostResources({});
    auto = autoCeiling({ totalMemMb: h.totalMemMb, cpus: h.cpus, ci: isCi(env), kind, upper });
    base = auto.value;
    source = auto.reason ? 'auto-fallback' : 'auto';
  }
  let ceiling = base;
  const lowered = [];
  const refusedRaises = [];
  const invalid = [];
  const consider = (by, raw) => {
    if (raw === undefined || raw === null || raw === '' || raw === false) return;
    const v = posInt(raw);
    if (v === null) { invalid.push({ by, value: raw }); return; }
    if (v < ceiling) { ceiling = v; lowered.push({ by, value: v }); }
    else if (v > base) refusedRaises.push({ by, value: v });
  };
  consider('QA_MAX_WORKERS', env && env.QA_MAX_WORKERS);
  consider('manifest', manifest && manifest.execution ? manifest.execution.maxWorkers : undefined);
  consider('--workers', workersFlag);
  return { ceiling, base, source, configured: !!cfg.machineMaxWorkers, upper: { value: cfg.error ? 1 : upper, from: cfg.machineMaxWorkers ? 'config' : 'AUTO_MAX' },
    auto: auto ? { value: auto.value, basis: auto.basis, reason: auto.reason, ...(auto.insufficient ? { insufficient: true, insufficientReason: auto.insufficientReason } : {}) } : null, lowered, refusedRaises, invalid, configError: cfg.error || null, classes: cfg.classes };
}

export const isCi = (env = process.env) => !!(env && env.CI) && !/^(0|false|no)$/i.test(String(env.CI).trim());

// reserves (§4.3): local max(2 GB, 25 %) and 2 cores; CI max(1 GB, 10 %) and 1 core
export function reservesFor({ ci = isCi(), totalMemMb = Math.round(os.totalmem() / MB), cpus = os.cpus().length } = {}) {
  void cpus;
  if (ci) return { memMb: Math.max(1024, Math.round(totalMemMb * 0.1)), cores: 1 };
  return { memMb: Math.max(2048, Math.round(totalMemMb * 0.25)), cores: 2 };
}

// machine resources, container-aware: cgroup v2 memory.max / memory.current / cpu.max cap what the host reports
export function hostResources({ platform = process.platform, readFile = (p) => fs.readFileSync(p, 'utf8'), totalmem = os.totalmem(), freemem = os.freemem(), cpus = os.cpus().length } = {}) {
  let totalMemMb = Math.round(totalmem / MB);
  let availableMb = Math.round(freemem / MB);
  let cpuCount = cpus;
  const cgroup = { memMaxMb: null, memCurrentMb: null, cpuLimit: null };
  if (platform === 'linux') {
    const rd = (p) => { try { return String(readFile(p)).trim(); } catch { return null; } };
    const max = rd('/sys/fs/cgroup/memory.max');
    const cur = rd('/sys/fs/cgroup/memory.current');
    const cpu = rd('/sys/fs/cgroup/cpu.max');
    if (max && /^\d+$/.test(max)) {
      cgroup.memMaxMb = Math.round(Number(max) / MB);
      totalMemMb = Math.min(totalMemMb, cgroup.memMaxMb);
      if (cur && /^\d+$/.test(cur)) { cgroup.memCurrentMb = Math.round(Number(cur) / MB); availableMb = Math.min(availableMb, Math.max(0, cgroup.memMaxMb - cgroup.memCurrentMb)); }
    }
    if (cpu) {
      const [q, p] = cpu.split(/\s+/);
      if (/^\d+$/.test(q) && /^\d+$/.test(p || '') && Number(p) > 0) { cgroup.cpuLimit = Math.round((Number(q) / Number(p)) * 100) / 100; cpuCount = Math.min(cpuCount, cgroup.cpuLimit); }
    }
  }
  return { totalMemMb, availableMb, cpus: cpuCount, cgroup };
}

// CPU busy share and idle cores between two calls (os.cpus tick deltas); the first call has no delta
export function createCpuSampler({ cpus = () => os.cpus() } = {}) {
  const times = () => {
    let idle = 0;
    let total = 0;
    const list = cpus() || [];
    for (const c of list) { const t = c.times; idle += t.idle; total += t.user + t.nice + t.sys + t.idle + t.irq; }
    return { idle, total, n: list.length };
  };
  let prev = times();
  return {
    sample() {
      const cur = times();
      const dt = cur.total - prev.total;
      const di = cur.idle - prev.idle;
      prev = cur;
      if (!(dt > 0)) return { cpuPct: null, idleCores: null };
      const busy = Math.min(1, Math.max(0, 1 - di / dt));
      return { cpuPct: Math.round(busy * 1000) / 10, idleCores: Math.round((1 - busy) * cur.n * 100) / 100 };
    },
  };
}

/* ---------------- the process table ---------------- */

// a process start time from any form the platforms produce: epoch ms, ISO 8601 (any fraction length), the JSON
// "/Date(ms[±hhmm])/" form of Windows PowerShell 5.1, and the WMI DMTF form yyyymmddHHMMSS.ffffff±UUU (offset minutes)
export function parseProcessStart(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  let m = s.match(/^\\?\/?Date\((-?\d+)(?:[+-]\d{4})?\)\\?\/?$/);
  if (m) return Number(m[1]); // the milliseconds are UTC epoch already; the offset is informational
  m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d{1,6}))?([+-])(\d{1,4})$/);
  if (m) {
    const frac = m[7] ? Math.floor(Number(m[7].padEnd(6, '0')) / 1000) : 0;
    const local = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), frac);
    return local - (m[8] === '-' ? -1 : 1) * Number(m[9]) * 60000;
  }
  const t = Date.parse(s.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isNaN(t) ? null : t;
}

// Windows: `Get-CimInstance Win32_Process | Select-Object … | ConvertTo-Json -Compress` (one object when there is one process)
export function parseCimJson(text) {
  let data;
  try { data = JSON.parse(String(text || '').replace(/^\uFEFF/, '').trim() || 'null'); } catch { return { rows: null, error: 'process listing is not valid JSON' }; }
  if (data === null || data === undefined) return { rows: null, error: 'empty process listing' };
  const rows = [];
  for (const p of Array.isArray(data) ? data : [data]) {
    const pid = Number(p && p.ProcessId);
    if (!Number.isInteger(pid)) continue;
    rows.push({ pid, ppid: Number(p.ParentProcessId) || 0, rssBytes: Number(p.WorkingSetSize) || 0, start: parseProcessStart(p.CreationDate), cmd: typeof p.CommandLine === 'string' ? p.CommandLine : '' });
  }
  return rows.length ? { rows, error: null } : { rows: null, error: 'empty process listing' };
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// POSIX: `ps -A -o pid=,ppid=,rss=,lstart=,args=` under LC_ALL=C — lstart is "Tue Nov 14 22:13:20 2023", local time
export function parsePsOutput(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(\d{4})(?:\s+(.*))?$/);
    if (!m) continue;
    const mon = MONTHS[m[4].toLowerCase()];
    const start = mon === undefined ? null : new Date(Number(m[9]), mon, Number(m[5]), Number(m[6]), Number(m[7]), Number(m[8])).getTime();
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), rssBytes: Number(m[3]) * 1024, start, cmd: m[10] || '' });
  }
  return rows.length ? { rows, error: null } : { rows: null, error: 'empty process listing' };
}

export function fixtureRows(file, { self = process.pid, parent = process.ppid } = {}) {
  const r = readJsonFile(file);
  if (r.error || !Array.isArray(r.value)) return { rows: null, error: 'fixture: ' + (r.error || 'not a JSON array') };
  const sub = (v) => (v === 'SELF' ? self : v === 'PARENT' ? parent : Number(v));
  return {
    rows: r.value.map((x) => ({ pid: sub(x.pid), ppid: sub(x.ppid), rssBytes: Number(x.rssBytes ?? (x.rss ? x.rss * 1024 : 0)) || 0, start: parseProcessStart(x.start), cmd: String(x.cmd || ''),
      ...(x.ledgerToken ? { ledgerToken: String(x.ledgerToken) } : {}) })),
    error: null,
  };
}

// Linux: the QA_LEDGER_TOKEN a process inherited (ledger-exec sets it for the command; Playwright's workers and browsers
// inherit it) — a re-parented browser keeps it. Only this one variable is read; a process of another user is skipped.
export function addEnvTokens(rows, { readFile = (p) => fs.readFileSync(p) } = {}) {
  for (const r of rows || []) {
    let buf;
    try { buf = readFile('/proc/' + r.pid + '/environ'); } catch { continue; }
    const s = String(buf);
    const i = s.indexOf('QA_LEDGER_TOKEN=');
    if (i < 0 || (i > 0 && s[i - 1] !== '\0')) continue;
    const end = s.indexOf('\0', i);
    r.ledgerToken = s.slice(i + 16, end < 0 ? undefined : end);
  }
  return rows;
}

const PS_WIN = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,"
  + "@{n='CreationDate';e={if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}else{$null}}},CommandLine | ConvertTo-Json -Compress";

// one snapshot of every process: [{pid, ppid, rssBytes, start (epoch ms | null), cmd}] — never throws
export function processSnapshot({ timeoutMs = 10000, env = process.env, platform = process.platform } = {}) {
  if (env && env.QA_CAPACITY_PS_FIXTURE) return Promise.resolve(fixtureRows(env.QA_CAPACITY_PS_FIXTURE));
  return new Promise((resolve) => {
    let child;
    try {
      child = platform === 'win32'
        ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_WIN], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
        : spawn('ps', ['-A', '-o', 'pid=,ppid=,rss=,lstart=,args='], { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, LC_ALL: 'C', LANG: 'C' } });
    } catch (e) { resolve({ rows: null, error: e.message }); return; }
    let out = '';
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish({ rows: null, error: 'process listing timed out after ' + timeoutMs + ' ms' }); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', (e) => finish({ rows: null, error: e.message }));
    child.on('close', () => {
      try {
        const r = platform === 'win32' ? parseCimJson(out) : parsePsOutput(out);
        if (platform === 'linux' && r.rows) addEnvTokens(r.rows);
        finish(r);
      } catch (e) { finish({ rows: null, error: e.message }); }
    });
  });
}

const indexCache = new WeakMap();
function pidIndex(rows) {
  let m = indexCache.get(rows);
  if (!m) { m = new Map(); for (const r of rows) m.set(r.pid, r); indexCache.set(rows, m); }
  return m;
}

// alive = the pid is in the table and (when both start times are known) its start matches within the tolerance — a
// different start is a reused PID. No table (null) → liveness UNKNOWN → treated as alive: capacity is never released
// and a lock never broken on a guess.
export function isAlive(rows, ident, toleranceMs = START_TOLERANCE_MS) {
  if (!ident) return false;
  const pid = Number(ident.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (!Array.isArray(rows)) return true;
  const row = pidIndex(rows).get(pid);
  if (!row) return false;
  const want = msOf(ident.start);
  if (!Number.isFinite(want) || row.start === null || row.start === undefined) return true;
  return Math.abs(row.start - want) <= (ident.startSource ? Math.max(toleranceMs, APPROX_TOLERANCE_MS) : toleranceMs);
}

// the roots and every descendant ([{pid, start}]); a "child" created before its parent started is a stale ppid (the
// parent's pid was reused), never a descendant
export function treeOf(rows, rootPids) {
  if (!Array.isArray(rows)) return [];
  const idx = pidIndex(rows);
  const kids = new Map();
  for (const r of rows) { if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push(r.pid); }
  const seen = new Set();
  const out = [];
  const queue = (rootPids || []).map(Number).filter((p) => idx.has(p));
  while (queue.length) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    seen.add(p);
    const row = idx.get(p);
    out.push({ pid: p, start: row.start ?? null });
    for (const c of kids.get(p) || []) {
      if (seen.has(c) || c === p) continue;
      const cr = idx.get(c);
      if (row.start != null && cr && cr.start != null && cr.start < row.start - START_TOLERANCE_MS) continue;
      queue.push(c);
    }
  }
  return out;
}

const normMarker = (s) => String(s).replace(/^["']|["']$/g, '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
// browser profile markers: the --user-data-dir of every recorded browser (a Playwright temp profile
// `…/playwright_chromiumdev_profile-XXXX`) — a re-parented or detached browser keeps carrying it
export function markersOf(rows, pids) {
  if (!Array.isArray(rows)) return [];
  const idx = pidIndex(rows);
  const out = [];
  for (const pid of pids || []) {
    const cmd = (idx.get(Number(pid)) || {}).cmd || '';
    for (const m of cmd.matchAll(/--user-data-dir=(?:"([^"]+)"|'([^']+)'|(\S+))/gi)) out.push(normMarker(m[1] || m[2] || m[3]));
    for (const m of cmd.matchAll(/[^\s"'\\/=]*playwright[^\s"'\\/=]*profile-[A-Za-z0-9]+/gi)) out.push(normMarker(m[0]));
  }
  return uniq(out.filter((m) => m.length >= 8)).sort();
}

export function holdsMarker(row, markers) {
  const cmd = String((row && row.cmd) || '').replace(/\\/g, '/').toLowerCase();
  if (!cmd) return false;
  return (markers || []).some((m) => m && String(m).length >= 8 && cmd.includes(String(m).toLowerCase()));
}

// the session a playwright-cli daemon serves: `node …/playwright-core/lib/entry/cliDaemon.js <session> [options]`
const SESSION_RE = /clidaemon\.[cm]?js["']?\s+["']?([^\s"']+)/i;
export function sessionOf(cmd) { const m = String(cmd || '').replace(/\\/g, '/').match(SESSION_RE); return m ? m[1] : null; }
const sameSession = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

export function pidExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); }
}

// a process table built from PID existence alone (start unknown) — for 'pid' entries when no listing is available
export function pidTable(pids, exists = pidExists) {
  return uniq((pids || []).map(Number).filter((p) => Number.isInteger(p) && p > 0)).filter((p) => exists(p)).map((pid) => ({ pid, ppid: null, start: null }));
}
const pidsOf = (e) => [e.owner, e.wrapper, e.child, ...(e.descendants || [])].filter(Boolean).map((x) => Number(x.pid));
// drop every 'pid' entry whose recorded processes are all gone, mark one whose owner died while its child lives orphaned
// (pure decision on a PID-existence table); released.changed tells the caller the ledger must be written. An entry that
// needs a confirmed release (confirm: 'table') is never freed here — a PID check cannot see a re-parented browser; it is
// listed in released.unconfirmed instead.
function prunePidEntries(led, nowMs, exists = pidExists, graceMs = SPAWNING_GRACE_MS) {
  const released = [];
  released.changed = false;
  released.unconfirmed = [];
  led.entries = led.entries.filter((e) => {
    if (!e || e.liveness !== 'pid') return true;
    const d = decideEntry(e, pidTable(pidsOf(e), exists), nowMs, graceMs);
    if (d.action === 'release') {
      if (e.confirm === 'table') { released.unconfirmed.push(e.token); return true; }
      released.push({ token: e.token, class: e.class, units: e.units, runId: e.owner && e.owner.runId, why: d.why + ' (PID check)' });
      return false;
    }
    if (d.action === 'orphan' && e.state !== 'orphaned') { e.state = 'orphaned'; e.orphanedAt = isoOf(nowMs); released.changed = true; }
    return true;
  });
  if (released.length) released.changed = true;
  return released;
}

// apply a FRESH process table to every entry (the per-entry half of sweep; also run by a waiting reserve): release what
// nothing alive holds, mark orphans, refresh a session hold's lastSeenAt — returns what changed
function confirmEntries(led, rows, nowMs, graceMs = SPAWNING_GRACE_MS) {
  const out = { released: [], orphaned: [], kept: [], changed: false };
  led.entries = led.entries.filter((e) => {
    const d = decideEntry(e, rows, nowMs, graceMs);
    if (d.action === 'release') { out.released.push({ token: e.token, class: e.class, units: e.units, runId: e.owner && e.owner.runId, why: d.why }); out.changed = true; return false; }
    if (d.seen && e.kind === 'session-hold') { e.lastSeenAt = isoOf(nowMs); out.changed = true; }
    if (d.action === 'orphan') {
      if (e.state !== 'orphaned') { e.state = 'orphaned'; e.orphanedAt = isoOf(nowMs); out.changed = true; }
      if (d.wrapper && !e.wrapper) { e.wrapper = d.wrapper; out.changed = true; }
      out.orphaned.push({ token: e.token, class: e.class, units: e.units, runId: e.owner && e.owner.runId, why: d.why, alive: d.alive });
      return true;
    }
    out.kept.push({ token: e.token, state: e.state, why: d.why });
    return true;
  });
  return out;
}

export function defaultKill(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
}

function ancestorsOf(rows, pid) {
  const out = new Set();
  if (!Array.isArray(rows)) return out;
  const idx = pidIndex(rows);
  let cur = Number(pid);
  for (let i = 0; i < 64 && cur && !out.has(cur); i++) { out.add(cur); const r = idx.get(cur); if (!r) break; cur = r.ppid; }
  return out;
}

/* ---------------- locks and atomic writes ---------------- */

// QA_CAPACITY_TRACE={file}: an append-only JSONL diagnostic of every lock event (who took, released, broke or gave up on
// which lock, with process identity, timings and the lock folder's state). Off unless set; never read by any decision.
const TRACE_FILE = process.env.QA_CAPACITY_TRACE || null;
const TRACE_WHO = (() => { const a = process.argv.slice(1).map((x) => path.basename(String(x))); return a.slice(0, 3).join(' '); })();
export function trace(event, data = {}) {
  if (!TRACE_FILE) return;
  try { fs.appendFileSync(TRACE_FILE, JSON.stringify({ at: new Date().toISOString(), t: Date.now(), pid: process.pid, start: SELF_START, who: TRACE_WHO, event, ...data }) + '\n'); } catch { /* diagnostics never fail a caller */ }
}
function lockState(lockDir) {
  let st = null;
  let names = null;
  try { st = fs.statSync(lockDir); } catch (e) { return { exists: false, code: e && e.code }; }
  try { names = fs.readdirSync(lockDir); } catch (e) { names = 'unreadable: ' + (e && e.code); }
  const owner = readJsonFile(path.join(lockDir, 'owner.json'));
  return { exists: true, names, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs, owner: owner.value || null, ownerError: owner.error || null };
}

export class LockBusyError extends Error {
  constructor(lockDir, owner, waitedMs) {
    super('lock ' + lockDir + ' stayed busy for ' + waitedMs + ' ms' + (owner ? ' (held by pid ' + owner.pid + (owner.host ? ' on ' + owner.host : '') + ')' : ' (no owner file yet)'));
    this.name = 'LockBusyError';
    this.code = 'ELOCKBUSY';
    this.owner = owner || null;
  }
}

export function removeStaleTemps(file, nowMs = Date.now(), maxAgeMs = STALE_TEMP_MS) {
  const dir = path.dirname(file);
  const stem = path.basename(file) + '.tmp-';
  const removed = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return removed; }
  for (const n of names) {
    if (!n.startsWith(stem)) continue;
    const p = path.join(dir, n);
    try { if (nowMs - fs.statSync(p).mtimeMs > maxAgeMs) { fs.unlinkSync(p); removed.push(n); } } catch { /* raced with its writer */ }
  }
  return removed;
}

// temp + rename (a reader sees the old or the new file, never half of one); Windows refuses a rename while another
// process has the target open without delete sharing — retried briefly
export function writeJsonAtomic(file, obj, { now = Date.now } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  let last = null;
  for (let i = 0; i < 20; i++) {
    try { fs.renameSync(tmp, file); last = null; break; } catch (e) {
      last = e;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e && e.code)) break;
      sleepSync(10 + i * 5);
    }
  }
  if (last) { try { fs.unlinkSync(tmp); } catch { /* best effort */ } throw last; }
  removeStaleTemps(file, nowOf(now));
}

// `nonce` = token: helpers/rate-limit.ts reads a lock owner by { pid, nonce } — a book lock taken here is an owned lock there
const selfOwner = () => { const token = crypto.randomBytes(8).toString('hex'); return { pid: process.pid, start: SELF_START, startSource: 'node', host: os.hostname(), at: new Date().toISOString(), token, nonce: token }; };

// RELEASE (Windows-safe). A recursive delete of the lock folder fails with EPERM while a contender still has owner.json open
// (they read it every poll): the file goes "delete pending", the folder stays — ownerless — and every contender had to
// wait it out as "a creator still writing its owner file" (30 s; observed with QA_CAPACITY_TRACE). So the owner first
// RENAMES the folder away (atomic; retried briefly — nobody breaks a live owner's lock meanwhile) and only if that keeps
// failing renames owner.json to released-{pid}-{token}.json inside it (a rename works while a reader has the file open)
// and never touches the folder again; a contender breaks a folder that holds such a marker and no owner at once.
// rate-limit.template.ts follows the same convention for the shared book's lock.
const RELEASED_RE = /^released-/;
const isReleased = (names) => Array.isArray(names) && names.some((n) => RELEASED_RE.test(n));
function removeLockDir(lockDir, ownerFileName, why) {
  for (let i = 0; i < 25; i++) {
    const tomb = lockDir + '.released-' + process.pid + '-' + crypto.randomBytes(3).toString('hex');
    try { fs.renameSync(lockDir, tomb); try { fs.rmSync(tomb, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 }); } catch { /* a tombstone is swept later */ } return { removed: true, attempts: i + 1 }; }
    catch (e) { if (e && e.code === 'ENOENT') return { removed: true, attempts: i + 1, note: 'already gone' }; if (!['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(e && e.code)) return { removed: false, code: e && e.code, attempts: i + 1 }; sleepSync(2 + i * 2); }
  }
  // still refused: mark it released where it stands — a contender breaks it at once
  const marker = path.join(lockDir, 'released-' + process.pid + '-' + crypto.randomBytes(4).toString('hex') + '.json');
  try {
    if (ownerFileName) fs.renameSync(path.join(lockDir, ownerFileName), marker); else fs.writeFileSync(marker, JSON.stringify({ why }));
    return { removed: false, marked: true, attempts: 25 };
  } catch (e) {
    try { fs.writeFileSync(marker, JSON.stringify({ why })); return { removed: false, marked: true, attempts: 25, note: 'marker written (' + (e && e.code) + ')' }; } catch (e2) { return { removed: false, marked: false, code: e2 && e2.code, attempts: 25 }; }
  }
}
// tombstones of released / broken locks whose removal was refused at the time — swept by age, never a live lock
function sweepTombstones(dir, name, nowMs) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (!n.startsWith(name + '.lock.released-') && !n.startsWith(name + '.lock.broken-')) continue;
    const p = path.join(dir, n);
    try { if (nowMs - fs.statSync(p).mtimeMs > 60000) fs.rmSync(p, { recursive: true, force: true }); } catch { /* next time */ }
  }
}

function judgeLock(lockDir, { staleOwnerlessMs, now, rows, exists, host }) {
  const r = readJsonFile(path.join(lockDir, 'owner.json'));
  const owner = r.value && typeof r.value === 'object' && !Array.isArray(r.value) ? r.value : null;
  if (!owner) {
    let st = null;
    try { st = fs.statSync(lockDir); } catch { return { break: false, owner: null, gone: true }; }
    let names = null;
    try { names = fs.readdirSync(lockDir); } catch { /* judged by age below */ }
    if (!r.exists && isReleased(names)) return { break: true, owner: null, released: true, why: 'released by its owner (its folder could not be removed at the time)' };
    const age = nowOf(now) - st.mtimeMs;
    return { break: age > staleOwnerlessMs, owner: null, why: 'no owner file for ' + Math.round(age / 1000) + ' s' };
  }
  if (owner.host && owner.host !== host) return { break: false, owner, why: 'held from another host — cannot be judged here' };
  if (!exists(Number(owner.pid))) return { break: true, owner, why: 'its owner process is gone' };
  if (Array.isArray(rows)) return isAlive(rows, owner) ? { break: false, owner } : { break: true, owner, why: 'its owner pid now belongs to another process' };
  return { break: false, owner, needTable: true };
}

function breakLock(lockDir, judged) {
  // only the lock that was judged: an owner that appeared or changed since is judged again, never removed
  const cur = readJsonFile(path.join(lockDir, 'owner.json')).value;
  if (judged && (!cur || (cur.token || '') !== (judged.token || '') || cur.pid !== judged.pid)) return false;
  if (!judged && cur) return false;
  const tomb = lockDir + '.broken-' + process.pid + '-' + crypto.randomBytes(3).toString('hex');
  try { fs.renameSync(lockDir, tomb); } catch (e) { trace('lock-break-failed', { lock: path.basename(lockDir), judged: judged || null, code: e && e.code }); return false; }
  try { fs.rmSync(tomb, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 }); } catch { /* a leftover tombstone is harmless */ }
  trace('lock-broken', { lock: path.basename(lockDir), judged: judged || null });
  return true;
}

function releaseLock(lockDir, token) {
  const cur = readJsonFile(path.join(lockDir, 'owner.json')).value;
  if (cur && cur.token && cur.token !== token) { trace('lock-release-skipped', { lock: path.basename(lockDir), mine: token, cur }); return; } // ours was broken and is someone else's now — never remove theirs
  const r = removeLockDir(lockDir, 'owner.json', 'released');
  if (TRACE_FILE) trace(r.removed ? 'lock-released' : r.marked ? 'lock-release-marked' : 'lock-release-failed', { lock: path.basename(lockDir), token, ...r, after: r.removed ? null : lockState(lockDir) });
}

// run fn while holding `{dir}/{name}.lock`. Options (all injectable for the harness): staleOwnerlessMs, giveUpMs, pollMs,
// now (number or function), rows (a process table), exists (pid → boolean), snapshot (the process-table source taken once
// after 1 s of contention with a live-looking owner, to catch a reused PID), host.
export async function withLock(dir, name, fn, opts = {}) {
  const { staleOwnerlessMs = OWNERLESS_LOCK_MS, giveUpMs = 10000, rows = null, now = Date.now, pollMs = 25, exists = pidExists, snapshot = null, host = os.hostname() } = opts;
  fs.mkdirSync(dir, { recursive: true });
  const lockDir = path.join(dir, name + '.lock');
  sweepTombstones(dir, name, Date.now());
  const t0 = Date.now();
  let table = Array.isArray(rows) ? rows : null;
  let snapshotTried = false;
  const traced = { ownerless: false };
  const me = selfOwner();
  for (;;) {
    let made = false;
    try { fs.mkdirSync(lockDir); made = true; } catch (e) { if (!e || e.code !== 'EEXIST') throw e; }
    if (made) {
      try { writeJsonAtomic(path.join(lockDir, 'owner.json'), me); } catch (e) {
        const cleanup = removeLockDir(lockDir, null, 'its creator could not write its owner file');
        trace('lock-owner-write-failed', { lock: path.basename(lockDir), code: e && e.code, cleanup, after: lockState(lockDir) });
        throw e;
      }
      trace('lock-acquired', { lock: path.basename(lockDir), token: me.token, waitedMs: Date.now() - t0 });
      break;
    }
    const v = judgeLock(lockDir, { staleOwnerlessMs, now, rows: table, exists, host });
    const waited = Date.now() - t0;
    if (TRACE_FILE && !v.gone && !v.owner && !traced.ownerless) { traced.ownerless = true; trace('lock-ownerless-seen', { lock: path.basename(lockDir), waitedMs: waited, state: lockState(lockDir) }); }
    if (TRACE_FILE && waited > giveUpMs) trace('lock-giveup', { lock: path.basename(lockDir), waitedMs: waited, judged: { break: !!v.break, why: v.why || null, needTable: !!v.needTable }, state: lockState(lockDir) });
    if (v.gone || (v.break && breakLock(lockDir, v.owner))) { if (waited > giveUpMs) throw new LockBusyError(lockDir, v.owner, waited); await sleep(1); continue; } // freed (or broken) — take it at once
    if (v.break) { if (waited > giveUpMs) throw new LockBusyError(lockDir, v.owner, waited); await sleep(pollMs); continue; } // another contender changed it first
    if (v.needTable && !table && !snapshotTried && waited >= 1000) {
      snapshotTried = true;
      try { const s = await (snapshot || processSnapshot)({ timeoutMs: 5000 }); if (s && Array.isArray(s.rows)) table = s.rows; } catch { /* stays unknown */ }
      continue;
    }
    if (waited > giveUpMs) throw new LockBusyError(lockDir, v.owner, waited);
    await sleep(pollMs);
  }
  try { return await fn(); } finally { releaseLock(lockDir, me.token); }
}

/* ---------------- the ledger ---------------- */

const emptyLedger = () => ({ schema: CAPACITY_SCHEMA, entries: [], leases: {}, books: {}, queue: [], updatedAt: null });

// an unreadable ledger is never treated as empty — that would release every reservation; it is reported and nothing is
// reserved until a human repairs it (deleting it is safe only while no run is active)
export function readLedger(dir) {
  const r = readJsonFile(ledgerFile(dir));
  if (!r.exists) return emptyLedger();
  if (r.error || !r.value || typeof r.value !== 'object' || Array.isArray(r.value)) {
    return { ...emptyLedger(), error: 'ledger.json ' + (r.error || 'is not a JSON object') + ' — capacity cannot be counted; nothing is reserved until it is repaired (delete it only while no run is active)' };
  }
  const v = r.value;
  return { schema: v.schema || CAPACITY_SCHEMA, entries: Array.isArray(v.entries) ? v.entries : [], leases: v.leases && typeof v.leases === 'object' && !Array.isArray(v.leases) ? v.leases : {}, books: v.books && typeof v.books === 'object' && !Array.isArray(v.books) ? v.books : {}, queue: Array.isArray(v.queue) ? v.queue : [],
    ...(v.ceiling && typeof v.ceiling === 'object' ? { ceiling: v.ceiling } : {}), updatedAt: v.updatedAt || null };
}

// read-modify-write under the ledger lock; fn(ledger, ctl) — ctl.skip() leaves the file untouched
async function mutateLedger(dir, fn, lockOpts = {}) {
  return withLock(dir, 'ledger', async () => {
    const led = readLedger(dir);
    let skip = false;
    const res = await fn(led, { skip: () => { skip = true; } });
    if (skip || led.error) return res;
    led.updatedAt = isoOf(nowOf(lockOpts.now));
    const { error, ...clean } = led;
    void error;
    writeJsonAtomic(ledgerFile(dir), clean);
    return res;
  }, lockOpts);
}

export const usedUnits = (entries, cls) => (entries || []).filter((e) => e && e.class === cls && LIVE_STATES.includes(e.state)).reduce((s, e) => s + (Number(e.units) || 0), 0);

// FIFO with fit: an older waiter of the same class that fits the free slots goes first; one that does not fit never
// blocks a smaller request behind it (no head-of-line blocking)
export function grantable({ queue = [], token = null, cls, units, free }) {
  const mine = queue.find((w) => w.token === token);
  for (const w of queue) {
    if (w.token === token || w.cls !== cls) continue;
    if (mine && !(w.since < mine.since || (w.since === mine.since && w.token < mine.token))) continue;
    if ((Number(w.units) || 0) <= free) return false;
  }
  return free >= units;
}

function pruneQueue(led, nowMs, exists = pidExists) {
  led.queue = (led.queue || []).filter((w) => w && nowMs - msOf(w.seenAt) <= (Number(w.ttlMs) || 10000) && (!w.owner || !w.owner.pid || w.owner.pid === process.pid || exists(Number(w.owner.pid))));
}

// Reserve `units` slots of class `cls` (Playwright: the child's FULL --workers; compliance: one per process). `limit`
// defaults to the machine ceiling (playwright) or the config's class limit; `demand` is per unit ({memMb, cpu}) and feeds
// the committed-but-unobserved arithmetic; `admission(ledger)` → {ok, reasons[]} adds the memory / CPU / pressure / lease
// conditions (admissionFor builds one). Waits up to waitMs (polling outside the lock, queued FIFO-with-fit). confirm:
// 'table' marks an entry that is released only on a fresh process table (exclusive commands, probes, session holds).
// snapshot (async → rows | {rows}): while refused, a table is taken at most every confirmEveryMs (outside the lock) and
// applied to every entry, so an entry that ended without a confirmed release is freed as soon as a table shows it gone.
// → { ok: true, token, entry, waitedMs } | { ok: false, code: invalid|exceeds-limit|busy|queued|admission|ledger-error, reason, waitedMs }
const rowsOf = (s) => (Array.isArray(s) ? s : s && Array.isArray(s.rows) ? s.rows : null);
// why a live entry still holds its slots — for the refusal a waiting caller reports
function holderNote(e) {
  const who = (e.kind === 'session-hold' ? 'session hold' + (e.session ? ' "' + e.session + '"' : '') : 'command') + ' of run ' + ((e.owner && e.owner.runId) || '?');
  if (e.state === 'releasing' && e.confirm === 'table') return who + ' has ended but could not be confirmed stopped (' + (e.unconfirmed || 'its processes are still alive or no process table') + ') — `capacity.mjs sweep` frees it once a table shows it gone (last resort, user-run, only after confirming none of its processes or browsers is open: `capacity.mjs release --token ' + e.token + ' --force`)';
  if (e.state === 'orphaned') return who + ' is orphaned: its owner is gone but its processes run on (`capacity.mjs reclaim`, user-run)';
  return who + ' (' + e.state + ')';
}
export async function reserve(opts = {}) {
  const { dir = resolveCapacityDir(), cls = 'playwright', units: rawUnits, limit: rawLimit = null, demand = null, owner = {}, environment = null,
    admission = null, waitMs = 0, pollMs = 2000, onWait = null, now = Date.now, lock = {}, exclusive = false, liveness = 'table', exists = pidExists, kind = null,
    confirm = null, session = null, label = null, snapshot = null, confirmEveryMs = CONFIRM_EVERY_MS, machineCeiling = null, deadline = null } = opts;
  // deadline (absolute ms, optional): ONE end-to-end budget for the caller — every lock acquisition inside the wait gives up
  // by it, and a busy ledger lock becomes a refusal (code lock-busy, its owner named) instead of a throw; without it the
  // established behaviour (a LockBusyError after the lock's own give-up time) is unchanged
  const dl = Number.isFinite(Number(deadline)) && Number(deadline) > 0 ? Number(deadline) : null;
  const lockFor = () => (dl ? { ...lock, giveUpMs: Math.max(1, Math.min(lock.giveUpMs ?? 10000, dl - Date.now())) } : lock);
  const units = posInt(rawUnits);
  if (units === null) return { ok: false, code: 'invalid', reason: 'units must be a positive integer', waitedMs: 0 };
  const own = cls === 'playwright' && (rawLimit === null || rawLimit === undefined || !posInt(machineCeiling)) ? resolveCeiling({ dir }) : null;
  const limit = rawLimit !== null && rawLimit !== undefined ? posInt(rawLimit)
    : cls === 'playwright' ? own.ceiling : (readConfig(dir).classes[cls] ?? DEFAULT_CLASS_LIMITS[cls] ?? 1);
  // the machine value every Playwright reservation shares (Auto / config — without this run's own lowerings)
  const machine = cls === 'playwright' ? (posInt(machineCeiling) || own.base) : null;
  if (limit === null) return { ok: false, code: 'invalid', reason: 'limit must be a positive integer', waitedMs: 0 };
  if (units > limit) return { ok: false, code: 'exceeds-limit', reason: 'needs ' + units + ' ' + cls + ' slot(s); the limit is ' + limit + ' — lower the workers first', waitedMs: 0 };
  const token = crypto.randomUUID();
  // pass owner.start from a process snapshot when there is one (exact); otherwise this process's own start is used
  const isSelf = owner.pid === undefined || owner.pid === null || owner.pid === process.pid;
  const explicitStart = owner.start !== undefined && owner.start !== null;
  const ident = { pid: owner.pid ?? process.pid, start: explicitStart ? owner.start : isSelf ? SELF_START : null, ...(!explicitStart && isSelf ? { startSource: 'node' } : {}),
    runId: owner.runId ?? null, runFile: owner.runFile ?? null };
  const queued = waitMs > 0;
  const t0 = Date.now();
  let refused = false;
  let lastConfirm = 0;
  for (;;) {
    let rows = null;
    if (snapshot && refused && Date.now() - lastConfirm >= confirmEveryMs) {
      lastConfirm = Date.now();
      try { rows = rowsOf(await snapshot()); } catch { rows = null; }
    }
    let res;
    try { res = await mutateLedger(dir, (led, ctl) => {
      if (led.error) { ctl.skip(); return { ok: false, code: 'ledger-error', reason: led.error }; }
      const nowMs = nowOf(now);
      const before = (led.queue || []).length;
      pruneQueue(led, nowMs);
      const pruned = prunePidEntries(led, nowMs, exists);
      const confirmed = rows ? confirmEntries(led, rows, nowMs) : null;
      if (queued) {
        const w = led.queue.find((x) => x.token === token);
        if (w) w.seenAt = isoOf(nowMs);
        else led.queue.push({ token, cls, units, owner: ident, since: nowMs, seenAt: isoOf(nowMs), ttlMs: Math.max(10000, pollMs * 3) });
      }
      const used = usedUnits(led.entries, cls);
      const live = led.entries.filter((e) => e && e.class === cls && LIVE_STATES.includes(e.state));
      // one shared machine ceiling: while anything runs, a run may LOWER the recorded value (a smaller host reading, a
      // lower config) but never raise it beside the others; it is re-recorded freely only when the class is idle
      let shared = limit;
      if (machine) {
        const rec = led.ceiling && posInt(led.ceiling.value);
        const value = live.length && rec ? Math.min(rec, machine) : machine;
        if (!led.ceiling || led.ceiling.value !== value) led.ceiling = { value, at: isoOf(nowMs), by: ident.runId || null };
        shared = Math.min(limit, value);
      }
      const free = shared - used;
      const busy = (code, reason, extra = {}) => {
        if (!queued && led.queue.length === before && !pruned.changed && !(confirmed && confirmed.changed)) ctl.skip();
        const notes = uniq(live.filter((e) => e.state !== 'active' && e.state !== 'spawning').map(holderNote));
        return { ok: false, code, reason: reason + (notes.length ? ' — ' + notes.join('; ') : ''), free, used, limit,
          holders: live.map((e) => ({ token: e.token, state: e.state, runId: e.owner ? e.owner.runId : null, kind: e.kind || 'command', units: e.units,
            runFile: e.owner ? e.owner.runFile ?? null : null, pid: e.owner ? e.owner.pid ?? null : null, since: e.createdAt || null, heartbeatAt: e.heartbeatAt || null, ...(e.label ? { label: e.label } : {}) })), ...extra };
      };
      const excl = live.find((e) => e.exclusive);
      if (excl) return busy('exclusive', 'exclusive execution in progress (run ' + ((excl.owner && excl.owner.runId) || '?') + ') — one Playwright command at a time on this machine while the ledger is off for it');
      if (exclusive && used > 0) return busy('busy', 'exclusive execution waits until no other ' + cls + ' command runs on this machine: ' + used + ' slot(s) in use');
      if (free < units) return busy('busy', cls + ' capacity in use: ' + used + ' of ' + limit + ' slot(s), ' + units + ' needed');
      if (!grantable({ queue: led.queue, token, cls, units, free })) return busy('queued', 'an earlier waiting request of this class goes first');
      if (admission) {
        let a;
        try { a = admission(led) || { ok: true, reasons: [] }; } catch (e) { a = { ok: false, reasons: ['admission check failed: ' + e.message] }; }
        if (!a.ok) return busy('admission', (a.reasons || []).join('; ') || 'admission refused', { reasons: a.reasons || [] });
      }
      led.queue = led.queue.filter((x) => x.token !== token);
      const entry = { token, class: cls, units, state: 'spawning', owner: ident, demand, environment, createdAt: isoOf(nowMs), activatedAt: null, heartbeatAt: isoOf(nowMs), wrapper: null, child: null, descendants: [], ended: [], markers: [],
        exclusive: !!exclusive, liveness: liveness === 'pid' ? 'pid' : 'table', ...(confirm === 'table' ? { confirm: 'table' } : {}), ...(kind ? { kind } : {}), ...(session ? { session: String(session) } : {}), ...(label ? { label: String(label).slice(0, 120) } : {}) };
      led.entries.push(entry);
      return { ok: true, token, entry, limit, used: used + units };
    }, lockFor()); } catch (e) {
      if (!dl || !(e instanceof LockBusyError)) throw e;
      res = { ok: false, code: 'lock-busy', reason: 'the capacity ledger lock stayed busy: ' + e.message, holders: e.owner ? [{ lock: 'ledger', pid: e.owner.pid ?? null, host: e.owner.host || null, since: e.owner.at || null }] : [] };
    }
    const waitedMs = Date.now() - t0;
    refused = !res.ok;
    if (res.ok) return { ...res, waitedMs };
    if (res.code === 'ledger-error' || waitedMs >= waitMs || (dl && Date.now() >= dl)) {
      if (queued) { try { await mutateLedger(dir, (led) => { led.queue = (led.queue || []).filter((x) => x.token !== token); }, dl ? { ...lock, giveUpMs: 2000 } : lock); } catch { /* the waiter expires by its ttl */ } }
      return { ...res, waitedMs };
    }
    if (onWait) { try { onWait({ ...res, waitedMs }); } catch { /* a callback never breaks the wait */ } }
    await sleep(Math.max(1, Math.min(pollMs, waitMs - waitedMs, dl ? dl - Date.now() : Infinity)));
  }
}

async function onEntry(dir, token, lock, fn) {
  return mutateLedger(dir, (led, ctl) => {
    if (led.error) { ctl.skip(); return { ok: false, reason: led.error }; }
    const e = led.entries.find((x) => x.token === token);
    if (!e) { ctl.skip(); return { ok: false, reason: 'unknown token' }; }
    return fn(e, led, ctl);
  }, lock);
}

// ledger-exec.mjs, as it starts: its own pid + start, so the capacity stays held even if the parent dies before activate()
export async function registerWrapper({ dir = resolveCapacityDir(), token, pid = process.pid, start = null, now = Date.now, lock = {} } = {}) {
  return onEntry(dir, token, lock, (e) => {
    e.wrapper = start !== null && start !== undefined ? { pid, start } : pid === process.pid ? { pid, start: SELF_START, startSource: 'node' } : { pid, start: null };
    e.heartbeatAt = isoOf(nowOf(now));
    return { ok: true, entry: e };
  });
}

// the parent records the process it spawned (the wrapper) → active; start = the spawn moment (startSource 'spawn',
// compared leniently) when the OS start time is not known yet
export async function activate({ dir = resolveCapacityDir(), token, pid, start = null, startSource = null, now = Date.now, lock = {} } = {}) {
  return onEntry(dir, token, lock, (e) => {
    const nowMs = nowOf(now);
    e.child = { pid, start, ...(startSource ? { startSource } : {}) };
    if (e.state === 'spawning') e.state = 'active';
    e.activatedAt = e.activatedAt || isoOf(nowMs);
    e.heartbeatAt = isoOf(nowMs);
    return { ok: true, entry: e };
  });
}

// one process the wrapper started (its start time approximated by the spawn time — compared with a 2 s tolerance)
export async function noteDescendant({ dir = resolveCapacityDir(), token, pid, start = Date.now(), now = Date.now, lock = {} } = {}) {
  return onEntry(dir, token, lock, (e) => {
    if (!(e.descendants || []).some((d) => d.pid === pid)) (e.descendants = e.descendants || []).push({ pid, start, startSource: 'spawn' });
    e.heartbeatAt = isoOf(nowOf(now));
    return { ok: true };
  });
}

const sameProc = (a, b) => a.pid === b.pid && (a.start == null || b.start == null || Math.abs(a.start - b.start) <= (a.startSource || b.startSource ? APPROX_TOLERANCE_MS : START_TOLERANCE_MS));

// the periodic tree walk: every process the entry owns (aliveOf — recorded, token, environment token, session daemon,
// marker, child of a recorded process) and every descendant of those, with pid + start, plus every browser profile
// marker. A recorded process that has ended moves to `ended` (its orphans stay attributable by their parent pid).
export async function track({ dir = resolveCapacityDir(), token, rows, now = Date.now, lock = {} } = {}) {
  if (!Array.isArray(rows)) return { ok: false, reason: 'no process table' };
  return onEntry(dir, token, lock, (e) => {
    const nowMs = nowOf(now);
    const { alive } = aliveOf(e, rows);
    const tree = treeOf(rows, uniq(alive.filter((a) => a.certain !== false).map((a) => a.pid)));
    const list = [...(e.descendants || [])];
    for (const t of tree) {
      const i = list.findIndex((d) => sameProc(d, t));
      if (i < 0) list.push(t);
      else if (list[i].startSource && t.start != null) list[i] = t; // the OS start time supersedes an approximation
    }
    const gone = list.filter((d) => !isAlive(rows, d));
    e.descendants = list.filter((d) => isAlive(rows, d)).slice(0, 500);
    e.ended = [...(e.ended || []), ...gone.filter((d) => !(e.ended || []).some((x) => sameProc(x, d)))].slice(-ENDED_KEEP);
    e.markers = uniq([...(e.markers || []), ...markersOf(rows, tree.map((t) => t.pid))]).slice(0, 50);
    e.heartbeatAt = isoOf(nowMs);
    if (alive.length) e.lastSeenAt = isoOf(nowMs);
    return { ok: true, alive: alive.length, descendants: e.descendants.length, ended: e.ended.length, markers: e.markers.length };
  });
}

// what of an entry is still alive (see OWNERSHIP above): recorded processes (pid + start), any process carrying the
// token on its command line or in its environment, a session hold's playwright-cli daemon, marker holders, children of a
// recorded or ended process (birth-ordered; a reused parent pid only fathers children born before the reuse), and every
// descendant of all of these. An item with certain: false holds capacity but is never terminated. No table → { known: false }.
export function aliveOf(entry, rows) {
  if (!Array.isArray(rows)) return { known: false, alive: [] };
  const idx = pidIndex(rows);
  const alive = [];
  const seen = new Set();
  const add = (r, why, certain = true) => { if (seen.has(r.pid)) return; seen.add(r.pid); alive.push({ pid: r.pid, start: r.start ?? null, why, ...(certain ? {} : { certain: false }) }); };
  const ids = [entry.wrapper, entry.child, ...(entry.descendants || [])].filter(Boolean);
  for (const id of ids) {
    const pid = Number(id.pid);
    if (!seen.has(pid) && isAlive(rows, id)) add({ pid, start: (idx.get(pid) || {}).start ?? id.start ?? null }, 'recorded');
  }
  for (const r of rows) {
    if (seen.has(r.pid)) continue;
    if (entry.token && r.cmd && r.cmd.includes(entry.token)) add(r, 'token');
    else if (entry.token && r.ledgerToken && r.ledgerToken === entry.token) add(r, 'env-token');
    else if (entry.session && sameSession(sessionOf(r.cmd), entry.session)) add(r, 'session');
    else if ((entry.markers || []).length && holdsMarker(r, entry.markers)) add(r, 'marker');
  }
  const parents = new Map();
  for (const id of [...ids, ...(entry.ended || [])]) {
    const p = Number(id.pid);
    if (!Number.isInteger(p) || p <= 0) continue;
    if (!parents.has(p)) parents.set(p, []);
    parents.get(p).push({ start: msOf(id.start), tol: id.startSource ? APPROX_TOLERANCE_MS : START_TOLERANCE_MS });
  }
  // the same pid recorded with and without a start time (the wrapper as `wrapper` and as `child`): the timed record decides
  for (const [p, list] of parents) { const timed = list.filter((x) => Number.isFinite(x.start)); if (timed.length) parents.set(p, timed); }
  const created = msOf(entry.createdAt);
  for (const r of rows) {
    if (seen.has(r.pid) || !parents.has(r.ppid) || r.ppid === r.pid) continue;
    const cur = idx.get(r.ppid);
    for (const par of parents.get(r.ppid)) {
      const rs = r.start;
      if (rs == null || !Number.isFinite(par.start)) {
        // cannot be birth-ordered: ours only while the recorded parent itself is alive (then it is its child), else it
        // holds the slots without ever being terminated
        if (cur && isAlive(rows, { pid: r.ppid, start: par.start })) add(r, 'child-of-recorded');
        else add(r, 'child-of-recorded', false);
        break;
      }
      if (rs < par.start - par.tol) continue;                                       // born before that parent: stale ppid
      if (Number.isFinite(created) && rs < created - APPROX_TOLERANCE_MS) continue;   // older than the reservation
      if (cur && cur.start != null && Math.abs(cur.start - par.start) > par.tol && !(rs < cur.start - START_TOLERANCE_MS)) continue; // the reused pid's own child
      add(r, 'child-of-recorded');
      break;
    }
  }
  // everything below the processes found (the session daemon's browser, an orphan's renderers)
  for (const a of [...alive]) {
    for (const t of treeOf(rows, [a.pid])) if (!seen.has(t.pid)) add({ pid: t.pid, start: t.start }, 'tree', a.certain !== false);
  }
  return { known: true, alive };
}

// free the slots — only when nothing the entry owns is alive; otherwise the entry stays `releasing` with the survivors
// listed. No process table → stays held (a sweep or a waiting reserve confirms later). A legacy 'pid' entry without
// confirm: 'table' is still judged on its recorded PIDs other than the owner (the caller releasing it).
export async function release({ dir = resolveCapacityDir(), token, rows, now = Date.now, lock = {}, exists = pidExists } = {}) {
  return mutateLedger(dir, (led, ctl) => {
    if (led.error) { ctl.skip(); return { released: false, alive: [], reason: led.error }; }
    const i = led.entries.findIndex((x) => x.token === token);
    if (i < 0) { ctl.skip(); return { released: true, alive: [], note: 'no entry — already released' }; }
    const e = led.entries[i];
    const pidOnly = !Array.isArray(rows) && e.liveness === 'pid' && e.confirm !== 'table';
    const { known, alive } = aliveOf(e, pidOnly ? pidTable(pidsOf(e).filter((p) => p !== Number(e.owner && e.owner.pid)), exists) : rows);
    if (!known || alive.length) {
      e.state = 'releasing';
      e.heartbeatAt = isoOf(nowOf(now));
      e.unconfirmed = known ? alive.length + ' process(es) it owns still alive' : 'no process table';
      return { released: false, alive, reason: known ? alive.length + ' process(es) of its tree still alive' : 'no process table — its processes could not be confirmed stopped; capacity stays held until a table confirms it (sweep, a waiting reserve) or a user frees it after checking (release --token … --force)' };
    }
    led.entries.splice(i, 1);
    return { released: true, alive: [], confirmed: pidOnly ? 'pid' : 'table' };
  }, lock);
}

// user-run: free ONE entry without confirmation, after checking by hand that none of its processes runs
export async function forceRelease({ dir = resolveCapacityDir(), token, lock = {} } = {}) {
  return mutateLedger(dir, (led, ctl) => {
    if (led.error) { ctl.skip(); return { released: false, reason: led.error }; }
    const e = led.entries.find((x) => x.token === token);
    if (!e) { ctl.skip(); return { released: true, note: 'no entry — already released' }; }
    led.entries = led.entries.filter((x) => x.token !== token);
    return { released: true, forced: true, entry: { token: e.token, class: e.class, units: e.units, state: e.state, runId: e.owner ? e.owner.runId : null, kind: e.kind || 'command', session: e.session || null } };
  }, lock);
}

// the process kinds a releasing owner may terminate: only what a fresh table shows with its recorded identity
const OWN_KINDS = new Set(['recorded', 'token', 'env-token', 'marker', 'child-of-recorded', 'tree']);

// release with confirmation: a FRESH table each attempt (snapshot → rows | {rows} | null), the entry's processes tracked,
// then release(); with kill (the owner of a command — run-stage, scratch), from the second attempt the survivors the
// table shows alive with their identity are terminated (never a certain: false item, never on a missing table). No table
// in any attempt → the entry stays held: { released: false, confirmed: 'none' }.
export async function releaseConfirmed({ dir = resolveCapacityDir(), token, snapshot = null, attempts = 4, delayMs = 2000, kill = null, now = Date.now, lock = {} } = {}) {
  let last = null;
  let confirmed = 'none';
  const killed = [];
  for (let i = 0; i < attempts; i++) {
    let rows = null;
    if (snapshot) { try { rows = rowsOf(await snapshot()); } catch { rows = null; } }
    if (rows) { confirmed = 'table'; try { await track({ dir, token, rows, now, lock }); } catch { /* release still decides */ } }
    try { last = await release({ dir, token, rows, now, lock }); } catch (e) { last = { released: false, alive: [], reason: 'the ledger could not be used (' + e.message + ')' }; }
    if (last.released) break;
    if (kill && rows && i >= 1) {
      for (const p of last.alive || []) {
        if (p.certain === false || !OWN_KINDS.has(p.why) || !isAlive(rows, p) || killed.includes(p.pid)) continue;
        try { kill(p.pid); killed.push(p.pid); } catch { /* reported as still alive */ }
      }
    }
    if (i < attempts - 1) await sleep(delayMs);
  }
  return { released: !!(last && last.released), alive: (last && !last.released && last.alive) || [], reason: last && !last.released ? last.reason || null : null, confirmed, killed };
}

// the decision for one entry given a process table (pure)
export function decideEntry(e, rows, nowMs, graceMs = SPAWNING_GRACE_MS) {
  const ownerAlive = isAlive(rows, e.owner);
  if (e.kind === 'session-hold') {
    // a hold from before sessions were named has no process to find: it lives exactly as long as its owner
    if (!e.session && e.confirm !== 'table') return ownerAlive ? { action: 'keep', why: 'session hold; its owner is alive' } : { action: 'release', why: 'session hold; its owner is gone' };
    const { known, alive } = aliveOf(e, rows);
    const real = Array.isArray(rows) && rows.some((r) => r.cmd || r.start != null); // a PID-existence table cannot see a session
    if (alive.length && real) return ownerAlive ? { action: 'keep', why: 'session hold; its session is open', seen: true } : { action: 'orphan', why: 'session hold; its owner is gone but its playwright-cli session still runs', alive, seen: true };
    if (!known || !real) return ownerAlive ? { action: 'keep', why: 'session hold; its owner is alive' } : { action: 'release', why: 'session hold; its owner is gone (no process table — confirmation needed)' };
    if (!ownerAlive) return { action: 'release', why: 'session hold; its owner is gone and no process of the session is alive' };
    const since = msOf(e.lastSeenAt || e.activatedAt || e.createdAt);
    const grace = e.lastSeenAt ? HOLD_CLOSED_GRACE_MS : HOLD_OPEN_GRACE_MS;
    if (Number.isFinite(since) && nowMs - since >= grace) return { action: 'release', why: 'session hold; its session ' + (e.lastSeenAt ? 'closed' : 'never opened') + ' ' + Math.round((nowMs - since) / 1000) + ' s ago without a release' };
    return { action: 'keep', why: 'session hold; nothing of the session runs yet / any more — kept for ' + Math.round(grace / 1000) + ' s after ' + (e.lastSeenAt ? 'it was last seen' : 'the acquire') };
  }
  if (e.state === 'spawning' && !e.wrapper && !e.child) {
    if (ownerAlive) return { action: 'keep', why: 'spawning; its owner is alive' };
    const created = msOf(e.createdAt);
    const age = Number.isFinite(created) ? nowMs - created : Infinity;
    if (age < graceMs) return { action: 'keep', why: 'spawning; its owner is gone — inside the ' + Math.round(graceMs / 1000) + ' s grace' };
    const holders = (rows || []).filter((r) => r.cmd && e.token && r.cmd.includes(e.token));
    if (holders.length) return { action: 'orphan', why: 'its owner is gone; the wrapper carrying the token is still running', alive: holders.map((r) => ({ pid: r.pid, start: r.start ?? null, why: 'token' })), wrapper: { pid: holders[0].pid, start: holders[0].start ?? null } };
    return { action: 'release', why: 'its owner is gone and no process carries the token after the grace' };
  }
  const { alive } = aliveOf(e, rows);
  if (alive.length) return ownerAlive ? { action: 'keep', why: 'running' } : { action: 'orphan', why: 'its owner is gone; its process tree is still alive', alive };
  return { action: 'release', why: ownerAlive ? 'its process tree has ended' : 'its owner is gone and nothing of its tree is alive' };
}

const sameFile = (a, b) => !!a && !!b && (process.platform === 'win32' ? String(a).toLowerCase() === String(b).toLowerCase() : a === b);

// a lease whose holder is gone is reclaimable only when nothing the run owns is alive (pure): no recorded tree of the run
// (its ledger entries — commands, probes, session holds — by run id or run file, with every ownership rule of aliveOf) AND
// no process the dead owner started after it took the lease, with that process's tree (a shell, a playwright-cli daemon and
// its browser, a Playwright started outside run-stage — none of them in the ledger). Birth-ordered: a child older than the
// lease (an MCP server of the session) is not the run's, and a reused owner pid fathers only children born before the reuse.
export function decideLease(l, entries, rows, nowMs) {
  if (l && l.state === 'quiet') return nowMs >= msOf(l.releaseAfter) ? { action: 'release', why: 'its quiet period is over', warning: null } : { action: 'keep', why: 'released by its run; quiet period until ' + l.releaseAfter };
  if (!Array.isArray(rows)) return { action: 'keep', why: 'liveness unknown (no process table)' };
  if (isAlive(rows, l.owner)) return { action: 'keep', why: 'its owner process is alive' };
  const trees = (entries || []).filter((e) => e.owner && ((e.owner.runId && e.owner.runId === l.runId) || sameFile(e.owner.runFile, l.runFile)) && aliveOf(e, rows).alive.length);
  if (trees.length) return { action: 'keep', why: 'its owner process is gone but ' + trees.length + ' recorded process tree(s) of the run are still alive' };
  const strays = l.owner ? aliveOf({ token: null, ended: [l.owner], createdAt: l.acquiredAt || null }, rows).alive : [];
  if (strays.length) return { action: 'keep', why: 'its owner process is gone but ' + strays.length + ' process(es) it started after taking the lease are still alive (' + strays.slice(0, 5).map((s) => s.pid).join(', ') + ')', alive: strays };
  return { action: 'release', why: 'its owner process is gone and nothing it owns is alive (no recorded tree, no process it started after taking the lease)', warning: 'cleanup_incomplete' };
}

// resolve every entry whose owner died, every expired waiter and every abandoned lease
export async function sweep({ dir = resolveCapacityDir(), rows, now = Date.now, spawningGraceMs = SPAWNING_GRACE_MS, lock = {}, exists = pidExists } = {}) {
  const empty = { released: [], orphaned: [], kept: [], leasesReleased: [] };
  if (!Array.isArray(rows)) {
    // without a table only the 'pid' entries (exclusive execution, session holds) can be judged — everything else stays
    return mutateLedger(dir, (led, ctl) => {
      if (led.error) { ctl.skip(); return { ...empty, error: led.error }; }
      const released = prunePidEntries(led, nowOf(now), exists, spawningGraceMs);
      if (!released.changed) ctl.skip();
      return { ...empty, released: [...released], unconfirmed: released.unconfirmed, partial: true, note: 'no process table — only PID-judged entries were swept; an entry that needs a confirmed release (exclusive commands, probes, session holds) stays held until a table confirms it' };
    }, lock);
  }
  return mutateLedger(dir, (led, ctl) => {
    if (led.error) { ctl.skip(); return { ...empty, error: led.error }; }
    const nowMs = nowOf(now);
    const c = confirmEntries(led, rows, nowMs, spawningGraceMs);
    const out = { released: c.released, orphaned: c.orphaned, kept: c.kept, leasesReleased: [] };
    for (const [envId, l] of Object.entries(led.leases)) {
      const d = decideLease(l, led.entries, rows, nowMs);
      if (d.action === 'release') { delete led.leases[envId]; out.leasesReleased.push({ envId, runId: l.runId, runFile: l.runFile || null, why: d.why, warning: d.warning }); }
    }
    pruneQueue(led, nowMs);
    return out;
  }, lock);
}

// user-run: terminate the orphaned trees we recorded (pid + start match) or that carry a recorded marker — never anything
// else, never this process or its ancestors; then release what is gone. --dry-run lists only.
export async function reclaim({ dir = resolveCapacityDir(), rows, kill = defaultKill, dryRun = false, now = Date.now, snapshot = null, lock = {} } = {}) {
  if (!Array.isArray(rows)) return { dryRun, terminated: [], released: [], skipped: [], leasesReleased: [], error: 'no process table — nothing reclaimed' };
  const sw = await sweep({ dir, rows, now, lock });
  if (sw.error) return { dryRun, terminated: [], released: [], skipped: [], leasesReleased: [], error: sw.error };
  const led = readLedger(dir);
  const protect = ancestorsOf(rows, process.pid);
  const plan = [];
  const skipped = [];
  for (const e of led.entries) {
    if (e.state !== 'orphaned') { skipped.push({ token: e.token, reason: 'not orphaned (' + e.state + ')' }); continue; }
    const targets = aliveOf(e, rows).alive.filter((a) => !protect.has(a.pid) && a.certain !== false);
    plan.push({ token: e.token, targets });
  }
  const terminated = [];
  for (const p of plan) {
    for (const t of p.targets) {
      if (dryRun) { terminated.push({ token: p.token, pid: t.pid, why: t.why, dryRun: true }); continue; }
      try { kill(t.pid); terminated.push({ token: p.token, pid: t.pid, why: t.why }); } catch (err) { skipped.push({ token: p.token, pid: t.pid, reason: 'kill failed: ' + (err && err.message) }); }
    }
  }
  let released = sw.released.map((x) => x.token);
  let leasesReleased = sw.leasesReleased;
  if (!dryRun && terminated.length) {
    let after = null;
    try { after = await (snapshot || processSnapshot)({ timeoutMs: 15000 }); } catch { after = null; }
    if (after && Array.isArray(after.rows)) {
      const sw2 = await sweep({ dir, rows: after.rows, now, lock });
      released = released.concat((sw2.released || []).map((x) => x.token));
      leasesReleased = leasesReleased.concat(sw2.leasesReleased || []);
    }
  }
  return { dryRun, terminated, released, skipped, leasesReleased };
}

/* ---------------- demand, admission, pressure ---------------- */

// Σ over live reservations of max(0, projected − observed); a reservation younger than the warm-up counts in full.
// observedMbByToken: { token: MB } or { token: { memMb, cpu } }.
export function committedOutstanding(entries, observedMbByToken = {}, now = Date.now(), warmupMs = WARMUP_MS) {
  const nowMs = nowOf(now);
  let memMb = 0;
  let cpu = 0;
  for (const e of entries || []) {
    if (!e || !LIVE_STATES.includes(e.state) || !e.demand) continue;
    const units = Number(e.units) || 1;
    const projMem = (Number(e.demand.memMb) || 0) * units;
    const projCpu = (Number(e.demand.cpu) || 0) * units;
    const since = msOf(e.activatedAt || e.createdAt);
    const young = !Number.isFinite(since) || nowMs - since < warmupMs;
    const o = observedMbByToken ? observedMbByToken[e.token] : undefined;
    const obsMem = typeof o === 'number' ? o : o && typeof o === 'object' ? Number(o.memMb) || 0 : 0;
    const obsCpu = o && typeof o === 'object' ? Number(o.cpu) || 0 : 0;
    memMb += young ? projMem : Math.max(0, projMem - obsMem);
    cpu += young ? projCpu : Math.max(0, projCpu - obsCpu);
  }
  return { memMb: Math.round(memMb), cpu: Math.round(cpu * 100) / 100 };
}

// §4.3 — a child (its whole demand d) is admitted only when available − committed − d ≥ the memory reserve, idle −
// committed − d ≥ the reserve cores, the pressure flag is clear and the lease is valid. Not ok is a valid answer.
export function admissionCheck({ availableMb, idleCores, committed = { memMb: 0, cpu: 0 }, demand = { memMb: 0, cpu: 0 }, reserves, pressure = false, leaseValid = true } = {}) {
  const reasons = [];
  if (pressure) reasons.push('host pressure');
  if (leaseValid === false) reasons.push('the environment lease is not valid');
  const memLeftMb = typeof availableMb === 'number' ? availableMb - (committed.memMb || 0) - (demand.memMb || 0) : null;
  const cpuLeft = typeof idleCores === 'number' ? Math.round((idleCores - (committed.cpu || 0) - (demand.cpu || 0)) * 100) / 100 : null;
  if (memLeftMb !== null && reserves && memLeftMb < reserves.memMb) reasons.push('memory: ' + availableMb + ' MB available − ' + (committed.memMb || 0) + ' MB committed − ' + (demand.memMb || 0) + ' MB needed leaves ' + memLeftMb + ' MB, below the ' + reserves.memMb + ' MB reserve');
  if (cpuLeft !== null && reserves && cpuLeft < reserves.cores) reasons.push('CPU: ' + idleCores + ' idle cores − ' + (committed.cpu || 0) + ' committed − ' + (demand.cpu || 0) + ' needed leaves ' + cpuLeft + ', below the ' + reserves.cores + '-core reserve');
  return { ok: reasons.length === 0, reasons, memLeftMb, cpuLeft };
}

// how many workers fit now: min(free ceiling slots, memory, CPU) — 0 is a valid answer
export function admissibleWorkers({ availableMb, idleCores, committed = { memMb: 0, cpu: 0 }, perWorker, reserves, ceilingFree }) {
  const byMem = typeof availableMb === 'number' && perWorker && perWorker.memMb > 0 ? Math.floor((availableMb - (committed.memMb || 0) - reserves.memMb) / perWorker.memMb) : Infinity;
  const byCpu = typeof idleCores === 'number' && perWorker && perWorker.cpu > 0 ? Math.floor((idleCores - (committed.cpu || 0) - reserves.cores) / perWorker.cpu) : Infinity;
  const n = Math.min(Number.isFinite(ceilingFree) ? ceilingFree : Infinity, byMem, byCpu);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

// the admission(ledger) callback reserve() takes, from one sample of the host
export function admissionFor({ availableMb, idleCores, demand, reserves, pressure = false, leaseValid = true, observedMbByToken = {}, now = Date.now(), warmupMs = WARMUP_MS }) {
  return (led) => admissionCheck({ availableMb, idleCores, committed: committedOutstanding(led.entries, observedMbByToken, now, warmupMs), demand, reserves, pressure, leaseValid });
}

// §4.5 — fed every 2 s by the runner's lightweight sampler. Enters `pressure` on: memory below the reserve for 2
// consecutive samples · critical memory (below half the reserve) in one sample · CPU ≥ 90 % sustained 30 s · event-loop
// lag > 2 s in 2 consecutive samples. Leaves it only after available ≥ reserve + one projected worker AND CPU < 75 %
// (AND the lag back under its limit, so a lag episode cannot flap) held for 60 s. An unknown value (null) neither enters
// nor blocks recovery.
export function createPressureMonitor(opts = {}) {
  const { reserveMb, workerMemMb = 0, sampleMs = 2000, cpuPct: cpuLimit = 90, cpuSustainMs = 30000, lagMs: lagLimit = 2000, recoveryMs = 60000, recoveryCpuPct = 75, memSamples = 2, lagSamples = 2 } = opts;
  if (!(reserveMb > 0)) throw new Error('createPressureMonitor: reserveMb must be a positive number');
  void sampleMs;
  let state = 'ok';
  let reason = null;
  let since = null;
  let memLow = 0;
  let lagHigh = 0;
  let cpuSince = null;
  let recoverySince = null;
  let cur = null;
  let blockedOutside = 0;
  const eps = [];
  const known = (v) => typeof v === 'number' && Number.isFinite(v);
  const peak = (s) => {
    if (!cur) return;
    if (known(s.availableMb)) cur.peak.minAvailableMb = cur.peak.minAvailableMb === null ? s.availableMb : Math.min(cur.peak.minAvailableMb, s.availableMb);
    if (known(s.cpuPct)) cur.peak.maxCpuPct = cur.peak.maxCpuPct === null ? s.cpuPct : Math.max(cur.peak.maxCpuPct, s.cpuPct);
    if (known(s.lagMs)) cur.peak.maxLagMs = cur.peak.maxLagMs === null ? s.lagMs : Math.max(cur.peak.maxLagMs, s.lagMs);
  };
  return {
    sample({ now = Date.now(), availableMb = null, cpuPct = null, lagMs = null } = {}) {
      const s = { availableMb, cpuPct, lagMs };
      memLow = known(availableMb) && availableMb < reserveMb ? memLow + 1 : 0;
      lagHigh = known(lagMs) && lagMs > lagLimit ? lagHigh + 1 : 0;
      if (known(cpuPct) && cpuPct >= cpuLimit) { if (cpuSince === null) cpuSince = now; } else cpuSince = null;
      if (state === 'ok') {
        const critical = known(availableMb) && availableMb < reserveMb / 2;
        const why = critical ? 'critical memory' : memLow >= memSamples ? 'memory' : cpuSince !== null && now - cpuSince >= cpuSustainMs ? 'cpu' : lagHigh >= lagSamples ? 'host lag' : null;
        if (!why) return { state, changed: false, reason: null, since: null };
        state = 'pressure'; reason = why; since = now; recoverySince = null;
        cur = { start: isoOf(now), end: null, reason: why, peak: { minAvailableMb: null, maxCpuPct: null, maxLagMs: null }, blockedAdmissions: 0 };
        eps.push(cur);
        peak(s);
        return { state, changed: true, reason, since: isoOf(since) };
      }
      peak(s);
      const recovered = (!known(availableMb) || availableMb >= reserveMb + workerMemMb) && (!known(cpuPct) || cpuPct < recoveryCpuPct) && (!known(lagMs) || lagMs <= lagLimit);
      if (recovered) { if (recoverySince === null) recoverySince = now; } else recoverySince = null;
      if (recoverySince !== null && now - recoverySince >= recoveryMs) {
        const was = reason;
        cur.end = isoOf(now);
        cur = null; state = 'ok'; reason = null; since = null; recoverySince = null; memLow = 0; lagHigh = 0; cpuSince = null;
        return { state, changed: true, reason: 'recovered from ' + was, since: null };
      }
      return { state, changed: false, reason, since: isoOf(since) };
    },
    state() { return { state, reason, since: since === null ? null : isoOf(since) }; },
    episodes() { return eps.map((e) => ({ ...e, peak: { ...e.peak } })); },
    noteBlocked() { if (cur) cur.blockedAdmissions++; else blockedOutside++; },
    blockedOutsideEpisodes() { return blockedOutside; },
  };
}

/* ---------------- environment identity ---------------- */

// lower-case, IDNA (ASCII), default port dropped, path prefix normalised; key = host[:non-default port]
export function normalizeHost(input) {
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  let host = (u.hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return null;
  if (!host.startsWith('[')) { try { const a = domainToASCII(host); if (a) host = a; } catch { /* WHATWG URL already gave the ASCII form */ } }
  // WHATWG URL accepts characters no real host has (a `{E1_URL}` placeholder parses) — only DNS-shaped names and IP literals count
  if (!/^(\[[0-9a-f:.]+\]|[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?)*)$/i.test(host)) return null;
  const port = u.port || '';
  const pathPrefix = (u.pathname || '').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return { host, port, pathPrefix, key: host + (port ? ':' + port : '') };
}

const isIpLiteral = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || (/^\[?[0-9a-f:.]+\]?$/i.test(h) && h.includes(':'));
// the timer is NOT unref'd (a lookup that never settles must still time out) and is cleared as soon as the race settles
const withTimeout = (p, ms) => {
  let t = null;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timed out after ' + ms + ' ms')), ms); })]).finally(() => clearTimeout(t));
};

export async function defaultResolver(host) {
  const cnames = [];
  let cur = host;
  for (let i = 0; i < 5; i++) {
    let next;
    try { next = await dns.promises.resolveCname(cur); } catch { break; }
    if (!next || !next.length) break;
    const n = String(next[0]).toLowerCase().replace(/\.$/, '');
    if (cnames.includes(n) || n === host) break;
    cnames.push(n);
    cur = n;
  }
  const addrs = await dns.promises.lookup(host, { all: true });
  return { cnames, addresses: addrs.map((a) => a.address) };
}

function unionFind(keys) {
  const parent = new Map(keys.map((k) => [k, k]));
  const find = (k) => { let r = k; while (parent.get(r) !== r) r = parent.get(r); let c = k; while (parent.get(c) !== r) { const n = parent.get(c); parent.set(c, r); c = n; } return r; };
  const union = (a, b) => { if (!parent.has(a) || !parent.has(b)) return; const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb); };
  const groups = () => { const g = new Map(); for (const k of parent.keys()) { const r = find(k); if (!g.has(r)) g.set(r, []); g.get(r).push(k); } return [...g.values()].map((x) => x.sort()).sort((x, y) => (x[0] < y[0] ? -1 : 1)); };
  return { find, union, groups };
}

// Hosts join one group when they share a hostname, are declared aliases, are linked by a CNAME chain (one host named in
// another's chain, or both chains meeting) or share a resolved address. Over-merging only serialises more (safe); a host
// whose DNS cannot be resolved stays separate and is warned about. The group of the FIRST valid host (E1 — the
// application) is the identity; id = first 16 hex of sha256 of its sorted member keys. `tokens` = every name and resolved
// address of that group (`name:{host}`, `addr:{ip}`) — what acquireLease compares with the leases already held, so two runs
// that list different subsets or aliases of one application never hold independent leases.
export async function environmentIdentity({ hosts = [], aliases = [], resolve = defaultResolver, timeoutMs = 3000, useDns = true } = {}) {
  const warnings = [];
  const keys = [];
  const hostOf = new Map();
  const add = (raw) => {
    const n = normalizeHost(raw);
    if (!n) { warnings.push('"' + raw + '" is not a host or URL — ignored'); return null; }
    if (!hostOf.has(n.key)) { hostOf.set(n.key, n.host); keys.push(n.key); }
    return n.key;
  };
  const primary = (hosts || []).map(add).filter(Boolean);
  const aliasGroups = (aliases || []).map((g) => (Array.isArray(g) ? g : [g]).map(add).filter(Boolean));
  if (!primary.length) return { id: null, members: [], groups: [], warnings: warnings.concat('no valid host — no environment identity') };
  const uf = unionFind(keys);
  const byHost = new Map();
  for (const k of keys) { const h = hostOf.get(k); if (byHost.has(h)) uf.union(byHost.get(h), k); else byHost.set(h, k); }
  for (const g of aliasGroups) for (let i = 1; i < g.length; i++) uf.union(g[0], g[i]);
  const owners = new Map();
  const tokensOf = new Map();
  const claim = (tokenKey, k) => {
    if (!tokensOf.has(k)) tokensOf.set(k, new Set());
    tokensOf.get(k).add(tokenKey);
    if (owners.has(tokenKey)) uf.union(owners.get(tokenKey), k); else owners.set(tokenKey, k);
  };
  for (const k of keys) claim('name:' + hostOf.get(k), k);
  if (useDns && resolve) {
    const facts = new Map();
    await Promise.all([...new Set(keys.map((k) => hostOf.get(k)))].map(async (h) => {
      if (isIpLiteral(h)) { facts.set(h, { cnames: [], addresses: [h.replace(/^\[|\]$/g, '')] }); return; }
      try {
        const f = await withTimeout(Promise.resolve().then(() => resolve(h)), timeoutMs);
        facts.set(h, { cnames: ((f && f.cnames) || []).map((c) => String(c).toLowerCase().replace(/\.$/, '')), addresses: ((f && f.addresses) || []).map(String) });
      } catch (e) { warnings.push(h + ': DNS lookup failed (' + ((e && e.message) || e) + ') — kept separate unless declared an alias'); }
    }));
    for (const k of keys) {
      const f = facts.get(hostOf.get(k));
      if (!f) continue;
      for (const c of f.cnames) claim('name:' + c, k);
      for (const a of f.addresses) claim('addr:' + a, k);
    }
  }
  const groups = uf.groups();
  const members = groups.find((g) => g.includes(primary[0])) || [primary[0]];
  const tokens = [...new Set(members.flatMap((k) => [...(tokensOf.get(k) || [])]))].sort();
  return { id: sha256(members.join('\n')).slice(0, 16), members, tokens, groups, warnings };
}

// a lease's identity tokens: the recorded ones, else its member hosts as names (a lease written before tokens existed)
export function leaseTokens(l) {
  if (l && Array.isArray(l.tokens) && l.tokens.length) return l.tokens;
  return ((l && l.members) || []).map((k) => { const n = normalizeHost(String(k)); return n ? 'name:' + n.host : null; }).filter(Boolean);
}

/* ---------------- the environment lease ---------------- */

const HOST_RE = /@anthropic-ai[\\/]claude-code|(^|[\\/\s"'])claude(?:\.exe)?(?=["'\s]|$)/i;
const SKILL_PATH_RE = /\.claude[\\/](skills|commands|agents|plugins)[\\/]/i;
export const isHostCmd = (cmd) => HOST_RE.test(String(cmd || '')) && !SKILL_PATH_RE.test(String(cmd || ''));

// the lease's liveness owner: the Claude Code host process running the skill — the nearest ancestor whose command line
// is Claude Code (never a shell that merely mentions .claude/skills); otherwise the shell's parent (grandparent), the
// parent, or this process
export function findHostProcess(rows, startPid = process.pid) {
  const self = startPid === process.pid ? { pid: startPid, start: SELF_START, startSource: 'node', how: 'self' } : { pid: startPid, start: null, how: 'self' };
  if (!Array.isArray(rows)) return self;
  const idx = pidIndex(rows);
  const me = idx.get(Number(startPid));
  if (!me) return self;
  const chain = [];
  let cur = me;
  for (let i = 0; i < 64; i++) {
    const parent = idx.get(cur.ppid);
    if (!parent || parent.pid === cur.pid || chain.includes(parent)) break;
    chain.push(parent);
    if (isHostCmd(parent.cmd)) return { pid: parent.pid, start: parent.start ?? null, how: 'claude' };
    cur = parent;
  }
  if (chain[1]) return { pid: chain[1].pid, start: chain[1].start ?? null, how: 'grandparent' };
  if (chain[0]) return { pid: chain[0].pid, start: chain[0].start ?? null, how: 'parent' };
  return me.start != null ? { pid: me.pid, start: me.start, how: 'self' } : self;
}

/* ---------------- the shared rate-limit book of an environment group ---------------- */

// rate-limits/{bookId}.json is the slot book helpers/rate-limit.ts paces against. Overlapping identities (different ids,
// a shared name or address) must share ONE book, or a server deadline learned under one id would not hold a later run
// under the other. The ledger's books { bookId: { tokens[], createdAt } | { mergedInto } } map identity tokens to a book:
// a lease resolves to the oldest book whose tokens meet its own; a request that bridges two books merges the younger into
// the older (under both book locks — a deadline is never shortened: latest notBefore, every slot, the highest refusal
// count, the stricter advertisement, the later recovery) and redirects it.
const RATE_SCHEMA = 'skill5-ratelimit-state/1';
const bookBuckets = (v) => {
  if (v && v.schema === RATE_SCHEMA && v.buckets && typeof v.buckets === 'object') return v.buckets;
  const out = {};
  // the phase-local book of an older helper ({ "<service>[:<key>]": [slot, …] }) — read as service buckets
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (Array.isArray(x)) out[k.startsWith('service:') ? k : 'service:' + k] = { slots: x.filter((n) => typeof n === 'number') };
  return out;
};
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
function mergeBucket(x, y) {
  if (!x) return y;
  if (!y) return x;
  const newer = num(y.updatedAt) > num(x.updatedAt) ? y : x;
  const ads = [x.advertised, y.advertised].filter((a) => a && Number.isFinite(Number(a.pace)));
  return {
    ...newer,
    slots: uniq([...(x.slots || []), ...(y.slots || [])].filter((n) => typeof n === 'number')).sort((a, b) => a - b),
    notBefore: Math.max(num(x.notBefore), num(y.notBefore)),
    refusals: Math.max(num(x.refusals), num(y.refusals)),
    lastRefusalAt: Math.max(num(x.lastRefusalAt), num(y.lastRefusalAt)),
    lastWindowMs: Math.max(num(x.lastWindowMs), num(y.lastWindowMs)),
    updatedAt: Math.max(num(x.updatedAt), num(y.updatedAt)),
    advertised: ads.length ? ads.reduce((a, b) => (Number(b.pace) < Number(a.pace) ? b : a)) : null,
    recovery: x.recovery || y.recovery ? { since: Math.max(num(x.recovery && x.recovery.since), num(y.recovery && y.recovery.since)) } : null,
  };
}
// pure: one book holding both — never a shorter deadline or a looser pace than either
export function mergeRateBooks(a, b) {
  const A = bookBuckets(a);
  const B = bookBuckets(b);
  const buckets = {};
  for (const k of uniq([...Object.keys(A), ...Object.keys(B)])) buckets[k] = mergeBucket(A[k] || null, B[k] || null);
  return { schema: RATE_SCHEMA, updatedAt: new Date().toISOString(), buckets };
}
async function mergeBookFiles(dir, into, from, lock) {
  const fi = rateLimitStatePath(dir, into);
  const ff = rateLimitStatePath(dir, from);
  if (!fs.existsSync(ff)) return { merged: false, reason: 'no book file' };
  return withLock(path.dirname(fi), path.basename(fi), () => withLock(path.dirname(ff), path.basename(ff), () => {
    const a = readJsonFile(fi);
    const b = readJsonFile(ff);
    if (b.error) return { merged: false, reason: 'unreadable book ' + from + ': ' + b.error };
    writeJsonAtomic(fi, mergeRateBooks(a.exists && !a.error ? a.value : null, b.value));
    return { merged: true };
  }, lock), lock);
}
const followBook = (books, id) => { let x = id; for (let i = 0; i < 32 && books[x] && books[x].mergedInto; i++) x = books[x].mergedInto; return x; };
// the book of a lease (redirects followed); a lease written before books existed keeps its own id
export const bookOf = (led, l) => followBook((led && led.books) || {}, (l && (l.bookId || l.envId)) || null);
async function resolveBook(dir, led, envId, tokens, nowMs, lock) {
  led.books = led.books || {};
  const B = led.books;
  const own = followBook(B, envId);
  const hits = Object.entries(B).filter(([id, b]) => !b.mergedInto && (id === own || (tokens.length && (b.tokens || []).some((t) => tokens.includes(t)))))
    .map(([id, b]) => ({ id, b })).sort((x, y) => String(x.b.createdAt || '').localeCompare(String(y.b.createdAt || '')) || x.id.localeCompare(y.id));
  if (!hits.length) {
    // a book file written before the registry existed is adopted under its own id
    B[own] = { tokens: [...tokens].sort(), createdAt: isoOf(nowMs) };
    return { bookId: own, merged: [], notes: [] };
  }
  const primary = hits[0];
  const notes = [];
  for (const o of hits.slice(1)) {
    const m = await mergeBookFiles(dir, primary.id, o.id, lock);
    if (!m.merged && m.reason !== 'no book file') notes.push('rate-limit book ' + o.id + ' could not be merged into ' + primary.id + ' (' + m.reason + ') — kept, not redirected');
    else B[o.id] = { mergedInto: primary.id, mergedAt: isoOf(nowMs), tokens: o.b.tokens || [] };
  }
  const merged = hits.slice(1).map((o) => o.id).filter((id) => B[id] && B[id].mergedInto === primary.id);
  primary.b.tokens = uniq([...(primary.b.tokens || []), ...tokens, ...hits.slice(1).filter((o) => merged.includes(o.id)).flatMap((o) => o.b.tokens || [])]).sort();
  return { bookId: primary.id, merged, notes };
}

// EXCLUSIVE per environment id AND per overlapping environment: a lease of another run whose identity tokens (names,
// resolved addresses — environmentIdentity) share one with this request holds it too, whatever its id (two stories that
// list different subsets or aliases of one application). The same runId acquiring again is idempotent (the owner is
// refreshed). Another run's lease is taken over only when decideLease() says it is reclaimable (owner dead and no recorded
// tree) — with a cleanup_incomplete warning — or its quiet period is over. Long gaps never release a lease.
export async function acquireLease({ dir = resolveCapacityDir(), envId, members = [], tokens = [], runId, runFile = null, owner, waitMs = 0, pollMs = 5000, rows, now = Date.now, snapshot = null, lock = {} } = {}) {
  if (!envId) return { ok: false, code: 'invalid', reason: 'no environment id', lease: null, heldBy: null, waitedMs: 0 };
  if (!runId) return { ok: false, code: 'invalid', reason: 'no run id', lease: null, heldBy: null, waitedMs: 0 };
  if (!owner || !Number.isInteger(Number(owner.pid))) return { ok: false, code: 'invalid', reason: 'no liveness owner (the Claude Code process) — pass --owner-pid', lease: null, heldBy: null, waitedMs: 0 };
  const t0 = Date.now();
  let table = rows;
  for (;;) {
    const res = await mutateLedger(dir, async (led, ctl) => {
      if (led.error) { ctl.skip(); return { ok: false, code: 'ledger-error', reason: led.error, lease: null, heldBy: null }; }
      const nowMs = nowOf(now);
      const myTokens = tokens.length ? [...tokens] : leaseTokens({ members });
      // the granted lease gets its environment group's shared rate-limit book
      const settle = async (lease, out) => {
        const b = await resolveBook(dir, led, envId, myTokens, nowMs, lock);
        lease.bookId = b.bookId;
        return { ...out, lease, bookId: b.bookId, ...(b.merged.length ? { booksMerged: b.merged } : {}), warnings: [...(out.warnings || []), ...b.notes] };
      };
      const fresh = { envId, members, ...(myTokens.length ? { tokens: myTokens } : {}), runId, runFile, owner: { pid: Number(owner.pid), start: owner.start ?? null, how: owner.how || null, ...(owner.startSource ? { startSource: owner.startSource } : {}) },
        state: 'held', acquiredAt: isoOf(nowMs), renewedAt: isoOf(nowMs) };
      // another run's lease on an OVERLAPPING environment (another id, a shared name or address) holds this one too
      const takenOver = [];
      for (const [k, other] of Object.entries(led.leases)) {
        if (k === envId || other.runId === runId) continue;
        const shared = leaseTokens(other).filter((t) => myTokens.includes(t));
        if (!shared.length) continue;
        const d = decideLease(other, led.entries, table, nowMs);
        if (d.action === 'release') { takenOver.push({ envId: k, lease: other, d }); continue; }
        ctl.skip();
        return { ok: false, code: 'held', reason: 'an overlapping environment (' + shared.join(', ') + ') is leased by run ' + other.runId + (other.runFile ? ' (' + other.runFile + ')' : '') + ' — ' + d.why, lease: null,
          heldBy: { runId: other.runId, runFile: other.runFile || null, envId: k, shared, since: other.acquiredAt, state: other.state || 'held', releaseAfter: other.releaseAfter || null } };
      }
      const overlapNotes = takenOver.map((x) => { delete led.leases[x.envId]; return 'the overlapping lease ' + x.envId + ' of run ' + x.lease.runId + (x.lease.runFile ? ' (' + x.lease.runFile + ')' : '') + ' was taken over: ' + x.d.why + (x.d.warning ? ' — ' + x.d.warning : ''); });
      const cur = led.leases[envId];
      if (!cur) { led.leases[envId] = fresh; return settle(fresh, { ok: true, heldBy: null, warnings: overlapNotes }); }
      if (cur.runId === runId) {
        cur.owner = fresh.owner;
        if (members.length) cur.members = members;
        if (myTokens.length) cur.tokens = uniq([...(cur.tokens || []), ...myTokens]).sort();
        if (runFile) cur.runFile = runFile;
        cur.state = 'held';
        delete cur.releaseAfter;
        cur.renewedAt = isoOf(nowMs);
        return settle(cur, { ok: true, heldBy: null, reacquired: true, warnings: overlapNotes });
      }
      const d = decideLease(cur, led.entries, table, nowMs);
      if (d.action === 'release') {
        led.leases[envId] = fresh;
        const note = 'the previous lease of run ' + cur.runId + (cur.runFile ? ' (' + cur.runFile + ')' : '') + ' was taken over: ' + d.why + (d.warning ? ' — ' + d.warning : '');
        return settle(fresh, { ok: true, heldBy: null, warnings: [...overlapNotes, note], reclaimed: { runId: cur.runId, runFile: cur.runFile || null, warning: d.warning } });
      }
      ctl.skip();
      return { ok: false, code: 'held', reason: 'the environment is leased by run ' + cur.runId + (cur.runFile ? ' (' + cur.runFile + ')' : '') + ' — ' + d.why, lease: null,
        heldBy: { runId: cur.runId, runFile: cur.runFile || null, since: cur.acquiredAt, state: cur.state || 'held', releaseAfter: cur.releaseAfter || null } };
    }, lock);
    const waitedMs = Date.now() - t0;
    if (res.ok || res.code !== 'held' || waitedMs >= waitMs) return { ...res, waitedMs };
    await sleep(Math.max(1, Math.min(pollMs, waitMs - waitedMs)));
    if (snapshot) { try { const s = await snapshot(); if (s && Array.isArray(s.rows)) table = s.rows; } catch { /* keep the last table */ } }
  }
}

// is this run's lease in force? (read-only; the run keeps it while its owner is alive and through any gap)
export async function validateLease({ dir = resolveCapacityDir(), envId, runId, runFile = null, rows } = {}) {
  const led = readLedger(dir);
  if (led.error) return { valid: false, reason: led.error };
  const l = led.leases[envId];
  if (!l) return { valid: false, reason: 'no lease held for environment ' + envId };
  // the run's own lease, or a lease taken for THIS run file under another run id (skill 9's retest of the phase)
  if (l.runId !== runId && !sameFile(l.runFile, runFile)) return { valid: false, reason: 'the environment is leased by run ' + l.runId + (l.runFile ? ' (' + l.runFile + ')' : '') };
  if (l.state === 'quiet') return { valid: false, reason: 'this run released the lease (quiet period until ' + l.releaseAfter + ')' };
  const bookId = bookOf(led, l);
  if (!Array.isArray(rows)) return { valid: true, bookId, reason: 'held by this run (owner liveness unknown — no process table)' };
  return { valid: true, bookId, reason: isAlive(rows, l.owner) ? 'held by this run' : 'held by this run (its owner process is gone — re-acquire from the current session)' };
}

export async function leaseStatus({ dir = resolveCapacityDir(), envId, rows, now = Date.now } = {}) {
  const led = readLedger(dir);
  if (led.error) return { held: false, lease: null, ownerAlive: null, valid: false, error: led.error };
  const l = led.leases[envId] || null;
  if (!l) return { held: false, lease: null, ownerAlive: null, valid: false };
  const d = decideLease(l, led.entries, rows, nowOf(now));
  return { held: true, lease: l, ownerAlive: Array.isArray(rows) ? isAlive(rows, l.owner) : null, valid: d.action === 'keep', verdict: d.why };
}

// release at close-out — every lease this run holds (an environment identity recomputed after a DNS change still finds
// its run's lease); quietMs keeps the environment reserved for the story's background effects after the run ended (nobody
// needs to stay alive for it); --force (user only) releases another run's lease under envId
export async function releaseLease({ dir = resolveCapacityDir(), envId, runId, quietMs = 0, force = false, now = Date.now, lock = {} } = {}) {
  return mutateLedger(dir, (led, ctl) => {
    if (led.error) { ctl.skip(); return { released: false, reason: led.error }; }
    const named = led.leases[envId];
    if (named && named.runId !== runId && !force) { ctl.skip(); return { released: false, reason: 'the lease belongs to run ' + named.runId + ', not ' + runId }; }
    const ids = uniq([...(named ? [envId] : []), ...Object.keys(led.leases).filter((k) => led.leases[k].runId === runId)]);
    if (!ids.length) { ctl.skip(); return { released: true, envIds: [], note: 'no lease was held' }; }
    if (quietMs > 0) {
      const until = isoOf(nowOf(now) + quietMs);
      for (const k of ids) { led.leases[k].state = 'quiet'; led.leases[k].releaseAfter = until; }
      return { released: true, envIds: ids, quietUntil: until };
    }
    for (const k of ids) delete led.leases[k];
    return { released: true, envIds: ids };
  }, lock);
}

/* ---------------- session holds ---------------- */

// A reservation for a browser this machine runs outside run-stage (the playwright-cli sessions of skills 3c, 5b and 9):
// `units` Playwright slots under the same ceiling, owned by the Claude Code process (owner {pid, start}), ONE per session
// name — acquiring a session that already has a live hold reuses it (the browser is counted once; a hold whose owner is
// gone is adopted by the new owner), released only on a table that shows the session ended (releaseHold), or freed after
// the grace when its owner lives but the session is gone (decideEntry). Without `session` the hold is the legacy kind (it
// lives as long as its owner). exclusive = the caller runs with the ledger off (QA_LEDGER=off) — then the hold is granted
// only when nothing else runs and nothing else starts while it is held. snapshot: see reserve().
export async function acquireHold({ dir = resolveCapacityDir(), runId, runFile = null, owner, units = 1, label = null, session = null, exclusive = false, waitMs = 0, pollMs = 2000, now = Date.now, lock = {}, exists = pidExists, snapshot = null } = {}) {
  if (!runId) return { ok: false, code: 'invalid', reason: 'no run id', waitedMs: 0 };
  if (!owner || !Number.isInteger(Number(owner.pid))) return { ok: false, code: 'invalid', reason: 'no liveness owner (the Claude Code process) — pass --owner-pid', waitedMs: 0 };
  if (session !== null && !/^[A-Za-z0-9][\w.-]{0,79}$/.test(String(session))) return { ok: false, code: 'invalid', reason: 'the session name must be letters, digits, ".", "_" or "-" (the playwright-cli -s= value)', waitedMs: 0 };
  const ident = { pid: Number(owner.pid), start: owner.start ?? null, runId, runFile };
  if (session) {
    // the same session already reserved: reuse (same owner) or adopt (its owner is gone) — never a second reservation
    const reused = await mutateLedger(dir, (led, ctl) => {
      if (led.error) { ctl.skip(); return null; }
      const h = led.entries.find((e) => e.kind === 'session-hold' && sameSession(e.session, session) && LIVE_STATES.includes(e.state));
      if (!h) { ctl.skip(); return null; }
      const nowMs = nowOf(now);
      const sameOwner = h.owner && Number(h.owner.pid) === ident.pid;
      if (!sameOwner && exists(Number(h.owner && h.owner.pid))) { ctl.skip(); return { busy: true, holder: { token: h.token, runId: h.owner ? h.owner.runId : null } }; }
      const adopted = !sameOwner;
      h.owner = ident;
      h.state = 'active';
      delete h.unconfirmed;
      h.heartbeatAt = isoOf(nowMs);
      if (label) h.label = String(label).slice(0, 120);
      return { ok: true, token: h.token, entry: h, reused: true, adopted };
    }, lock);
    if (reused && reused.ok) return { ...reused, waitedMs: 0, limit: null };
    if (reused && reused.busy) return { ok: false, code: 'busy', reason: 'session "' + session + '" is held by another live run (' + (reused.holder.runId || '?') + ') — one hold per session; choose another -s= name', waitedMs: 0 };
  }
  const r = await reserve({ dir, cls: 'playwright', units, owner: ident, exclusive, liveness: 'pid', confirm: session ? 'table' : null, kind: 'session-hold', session, label, waitMs, pollMs, now, lock, exists, snapshot });
  if (!r.ok) return r;
  await onEntry(dir, r.token, lock, (e) => { e.state = 'active'; e.activatedAt = isoOf(nowOf(now)); return { ok: true }; });
  return { ...r, entry: { ...r.entry, state: 'active' } };
}

// release one hold (token) or every hold of a run (runId and / or runFile, optionally one session). A named-session hold
// is freed only when `rows` (a fresh table) shows nothing of its session alive — else it stays `releasing`, listed under
// held[] with what still runs; no table → held[] with 'no process table'. force (user-run) frees without confirmation.
export async function releaseHold({ dir = resolveCapacityDir(), token = null, runId = null, runFile = null, session = null, rows = null, force = false, now = Date.now, lock = {} } = {}) {
  return mutateLedger(dir, (led, ctl) => {
    if (led.error) { ctl.skip(); return { released: [], held: [], reason: led.error }; }
    const mine = (e) => e.kind === 'session-hold' && (token ? e.token === token
      : ((runId && e.owner && e.owner.runId === runId) || (runFile && e.owner && sameFile(e.owner.runFile, runFile))) && (!session || sameSession(e.session, session)));
    const matched = led.entries.filter(mine);
    if (!matched.length) { ctl.skip(); return { released: [], held: [], note: 'no hold matched' }; }
    const released = [];
    const held = [];
    const nowMs = nowOf(now);
    for (const e of matched) {
      const legacy = !e.session && e.confirm !== 'table';
      const { known, alive } = legacy || force ? { known: true, alive: [] } : aliveOf(e, rows);
      if (known && !alive.length) { released.push({ token: e.token, units: e.units, runId: e.owner && e.owner.runId, session: e.session || null, ...(force && !legacy ? { forced: true } : {}) }); continue; }
      e.state = 'releasing';
      e.heartbeatAt = isoOf(nowMs);
      e.unconfirmed = known ? 'the session still runs (' + alive.length + ' process(es))' : 'no process table';
      if (known) e.lastSeenAt = isoOf(nowMs);
      held.push({ token: e.token, session: e.session || null, alive: alive.map((a) => ({ pid: a.pid, why: a.why })), reason: known ? 'session "' + e.session + '" still runs (' + alive.length + ' process(es)) — close it (playwright-cli -s=' + e.session + ' close) and release again' : 'no process table — the session could not be confirmed closed; the hold stays (sweep frees it once a table shows it gone)' });
    }
    const gone = new Set(released.map((x) => x.token));
    led.entries = led.entries.filter((e) => !gone.has(e.token));
    return { released, held };
  }, lock);
}

/* ---------------- status ---------------- */

export function capacityStatus({ dir = resolveCapacityDir(), rows = null, env = process.env, manifest = null, now = Date.now } = {}) {
  const nowMs = nowOf(now);
  const cfg = readConfig(dir);
  const ceiling = resolveCeiling({ dir, env, manifest, config: cfg });
  const led = readLedger(dir);
  const entries = led.entries.map((e) => {
    const a = aliveOf(e, rows);
    return { token: e.token, class: e.class, units: e.units, state: e.state, exclusive: !!e.exclusive, liveness: e.liveness || 'table', confirm: e.confirm || null, kind: e.kind || null, session: e.session || null, label: e.label || null,
      unconfirmed: e.unconfirmed || null, lastSeenAt: e.lastSeenAt || null, runId: e.owner ? e.owner.runId : null, runFile: e.owner ? e.owner.runFile : null,
      ownerAlive: Array.isArray(rows) ? isAlive(rows, e.owner) : null, alive: a.known ? a.alive.length : null, markers: (e.markers || []).length,
      environment: e.environment || null, createdAt: e.createdAt, heartbeatAt: e.heartbeatAt, verdict: Array.isArray(rows) ? decideEntry(e, rows, nowMs).why : 'liveness unknown' };
  });
  const used = {};
  for (const c of ['playwright', ...Object.keys(DEFAULT_CLASS_LIMITS)]) used[c] = usedUnits(led.entries, c);
  const leases = Object.values(led.leases).map((l) => ({ envId: l.envId, members: l.members, runId: l.runId, runFile: l.runFile, state: l.state || 'held', acquiredAt: l.acquiredAt, releaseAfter: l.releaseAfter || null,
    ownerAlive: Array.isArray(rows) ? isAlive(rows, l.owner) : null, verdict: decideLease(l, led.entries, rows, nowMs).why }));
  return { config: { file: cfg.file ? posix(cfg.file) : null, machineMaxWorkers: cfg.machineMaxWorkers, classes: cfg.classes, error: cfg.error, warnings: cfg.warnings },
    ceiling, shared: led.ceiling || null, used, limits: { playwright: ceiling.ceiling, ...cfg.classes }, entries, queue: (led.queue || []).map((w) => ({ token: w.token, cls: w.cls, units: w.units, runId: w.owner ? w.owner.runId : null, since: isoOf(w.since) })),
    leases, ledgerError: led.error || null, updatedAt: led.updatedAt };
}

/* ---------------- CLI ---------------- */

const HELP = {
  tool: 'capacity',
  usage: [
    'node capacity.mjs status | config | sweep | reclaim [--dry-run] [--capacity-dir <dir>] [--manifest <qa-manifest.json>] [--pretty]',
    'node capacity.mjs lease acquire --env <url,…> [--test-data <TEST-DATA md>] [--aliases a=b,…] --run-file <f> [--run-id <id>] [--owner-pid <pid>] [--wait <ms>] [--no-dns] [--dns-timeout <ms>] [--strict]',
    'node capacity.mjs lease status (--env <url,…> | --env-id <id>) [--aliases …] [--no-dns]',
    'node capacity.mjs lease release (--env <url,…> | --env-id <id>) (--run-file <f> | --run-id <id>) [--quiet-ms <ms>] [--force]',
    'node capacity.mjs hold acquire --run-file <f> [--run-id <id>] --session <playwright-cli -s= name> [--workers 1] [--owner-pid <pid>] [--wait <ms>] [--label <text>] [--strict]',
    'node capacity.mjs hold track --token <t>',
    'node capacity.mjs hold release (--token <t> | --run-file <f> [--run-id <id>] [--session <name>]) [--wait <ms>] [--strict]',
    'node capacity.mjs release --token <t> [--wait <ms>] [--force] [--strict]',
  ],
  notes: [
    'The coordination directory is QA_CAPACITY_DIR (absolute) or ~/.link-ai-pro/capacity/; --capacity-dir overrides it for this call.',
    'The machine ceiling is AUTO: computed from the host\'s total memory / CPU and the headed per-worker demand, the same on every run of this machine, never above config.json machineMaxWorkers (absent / "auto" → ' + AUTO_MAX + ', a safety upper bound — not the worker count chosen); unusable readings → ' + AUTO_FALLBACK + '. QA_MAX_WORKERS, the project limit and --workers only lower it; current load is decided at every reservation (memory / CPU after everything committed, host pressure). Every run shares ONE recorded value (ledger `ceiling`), lowered but never raised while anything runs.',
    'lease acquire runs at intake, BEFORE the readiness probe and any test-data preparation; lease release at close-out (after teardown, clean-up and the background quiet period — --quiet-ms keeps it reserved that long).',
    'reclaim terminates only orphaned process trees this ledger recorded (pid + start time) or that carry a recorded browser profile marker; --dry-run lists them.',
    'hold acquire reserves one Playwright slot per playwright-cli session (skills 3c, 5b and 9) BEFORE its open, under the same ceiling, owned by the Claude Code process; the same --session again reuses its hold (never counted twice). With QA_LEDGER=off it is EXCLUSIVE (granted only when nothing else runs). hold track after the open records the session\'s daemon and browser; hold release after the close frees it only when a process table shows the session ended (--wait polls for it).',
    'QA_LEDGER=off never means "uncoordinated": run-stage then runs every command under an EXCLUSIVE reservation (one Playwright command at a time on the machine, ≤ the ceiling); an unusable coordination directory refuses the launch.',
    'Exclusive commands, probes and session holds are released only on a process table that shows none of their processes (incl. a detached or re-parented browser) alive; with no table they stay held — sweep frees them once a table confirms it. release --token <t> --force (user-run, after checking by hand) frees one without confirmation.',
    '--run-id on lease acquire: the run id the lease is recorded under (default: the run file\'s run_id, else a hash of its path); run-stage accepts a lease for its run file under any run id.',
    '--strict: lease / hold acquire 0 acquired · 1 held by another run / no free slot · 2 error; hold release / release 0 released · 1 still running or not confirmed · 2 error; every other command 0 (2 on a command error).',
  ],
};

const csvOf = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

function runIdOf(args) {
  if (typeof args['run-id'] === 'string' && args['run-id'].trim()) return { runId: args['run-id'].trim(), runFile: typeof args['run-file'] === 'string' ? posix(path.resolve(args['run-file'])) : null };
  if (typeof args['run-file'] !== 'string') return { runId: null, runFile: null };
  const abs = path.resolve(args['run-file']);
  const j = readJsonFile(abs).value;
  const fromFile = j && typeof j.run_id === 'string' && j.run_id.trim() ? j.run_id.trim() : null;
  return { runId: fromFile || sha256(posix(abs)).slice(0, 16), runFile: posix(abs) };
}

async function hostsOf(args, warnings) {
  const hosts = csvOf(args.env);
  if (typeof args['test-data'] === 'string') {
    try {
      const { parseTestData } = await import(pathToFileURL(path.join(here, 'tc-hash.mjs')).href);
      const env = parseTestData(fs.readFileSync(path.resolve(args['test-data']), 'utf8')).env;
      const ids = Object.keys(env).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
      for (const id of ids) { const v = String(env[id].value || '').replace(/^[`<]+|[`>]+$/g, '').trim(); if (v && normalizeHost(v)) hosts.push(v); }
    } catch (e) { warnings.push('--test-data could not be read: ' + e.message); }
  }
  const aliases = csvOf(args.aliases).map((g) => g.split('=').map((s) => s.trim()).filter(Boolean)).filter((g) => g.length > 1);
  return { hosts, aliases };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { print(HELP, args); return 0; }
  const dirInfo = typeof args['capacity-dir'] === 'string' ? { dir: path.resolve(args['capacity-dir']), source: '--capacity-dir', warning: null } : describeCapacityDir(process.env);
  const dir = dirInfo.dir;
  const [cmd, sub] = args._;
  const base = { tool: 'capacity', schema: CAPACITY_SCHEMA, capacityDir: posix(dir), capacityDirSource: dirInfo.source };
  const warnings = dirInfo.warning ? [dirInfo.warning] : [];
  let manifest = null;
  if (typeof args.manifest === 'string') { const m = readJsonFile(path.resolve(args.manifest)); if (m.error) warnings.push('--manifest: ' + m.error); else manifest = m.value; }
  const out = (payload, code = 0) => { print({ ...base, ...payload, warnings: warnings.concat(payload.warnings || []) }, args); return args.strict ? code : 0; };
  const table = async () => { const s = await processSnapshot({ timeoutMs: 20000 }); if (!s.rows) warnings.push('process table unavailable: ' + s.error); return s.rows; };

  if (cmd === 'config') {
    const cfg = readConfig(dir);
    return out({ action: 'config', file: posix(configFile(dir)), exists: !!cfg.file, config: cfg, ceiling: resolveCeiling({ dir, manifest, config: cfg, workersFlag: args.workers }),
      reserves: reservesFor({}), host: hostResources({}), template: { machineMaxWorkers: 'auto', classes: { ...DEFAULT_CLASS_LIMITS } },
      note: 'the ceiling is Auto; config.json machineMaxWorkers (written by hand) is only its upper bound (absent / "auto" → ' + AUTO_MAX + '); QA_MAX_WORKERS, the project limit and --workers can only lower it' });
  }
  if (cmd === 'status') return out({ action: 'status', ...capacityStatus({ dir, rows: await table(), manifest }) });
  if (cmd === 'sweep') { const r = await sweep({ dir, rows: await table() }); return out({ action: 'sweep', ...r }, r.error ? 2 : 0); }
  if (cmd === 'reclaim') { const r = await reclaim({ dir, rows: await table(), dryRun: !!args['dry-run'] }); return out({ action: 'reclaim', ...r }, r.error ? 2 : 0); }
  if (cmd === 'lease') {
    if (!['acquire', 'status', 'release'].includes(sub)) return out({ action: 'lease', ok: false, error: 'lease acquire | status | release' }, 2);
    let envId = typeof args['env-id'] === 'string' ? args['env-id'].trim() : null;
    let identity = null;
    if (!envId || sub === 'acquire') {
      const { hosts, aliases } = await hostsOf(args, warnings);
      identity = await environmentIdentity({ hosts, aliases, useDns: !args['no-dns'], timeoutMs: Number(args['dns-timeout']) > 0 ? Number(args['dns-timeout']) : 3000 });
      warnings.push(...identity.warnings);
      if (!envId) envId = identity.id;
    }
    if (!envId) return out({ action: 'lease-' + sub, ok: false, error: 'no environment — pass --env <url,…> (E1 first), --test-data or --env-id' }, 2);
    if (sub === 'status') { const rows = await table(); return out({ action: 'lease-status', envId, members: identity ? identity.members : undefined, ...(await leaseStatus({ dir, envId, rows })) }); }
    const { runId, runFile } = runIdOf(args);
    if (!runId) return out({ action: 'lease-' + sub, ok: false, envId, error: '--run-file <.runs/phase-N.json> or --run-id is required' }, 2);
    if (sub === 'release') {
      const r = await releaseLease({ dir, envId, runId, quietMs: Number(args['quiet-ms']) > 0 ? Number(args['quiet-ms']) : 0, force: !!args.force });
      return out({ action: 'lease-release', envId, runId, ok: r.released, ...r }, r.released ? 0 : 2);
    }
    const rows = await table();
    let owner;
    if (args['owner-pid'] !== undefined && args['owner-pid'] !== true) {
      const pid = Number(args['owner-pid']);
      const row = Array.isArray(rows) ? rows.find((r) => r.pid === pid) : null;
      owner = { pid, start: row ? row.start ?? null : null, how: 'explicit' };
    } else if (Array.isArray(rows)) owner = findHostProcess(rows, process.pid);
    else return out({ action: 'lease-acquire', ok: false, envId, runId, code: 'no-owner', error: 'the process table is unavailable, so the Claude Code process cannot be found — pass --owner-pid <its pid>' }, 2);
    const r = await acquireLease({ dir, envId, members: identity ? identity.members : [], tokens: identity ? identity.tokens : [], runId, runFile, owner, rows, waitMs: Number(args.wait) > 0 ? Number(args.wait) : 0,
      snapshot: () => processSnapshot({ timeoutMs: 20000 }) });
    return out({ action: 'lease-acquire', envId, members: identity ? identity.members : [], groups: identity ? identity.groups : [], runId, runFile, owner, ...r }, r.ok ? 0 : r.code === 'held' ? 1 : 2);
  }
  const tokenArg = typeof args.token === 'string' ? args.token.trim() : null;
  const sessionArg = typeof args.session === 'string' ? args.session.trim() : null;
  const waitArg = Number(args.wait) > 0 ? Number(args.wait) : 0;
  const fresh = async () => { const s = await processSnapshot({ timeoutMs: 20000 }); if (!s.rows) warnings.push('process table unavailable: ' + s.error); return s.rows; };
  if (cmd === 'hold') {
    if (!['acquire', 'track', 'release'].includes(sub)) return out({ action: 'hold', ok: false, error: 'hold acquire | track | release' }, 2);
    const { runId, runFile } = runIdOf(args);
    if (sub === 'track') {
      if (!tokenArg) return out({ action: 'hold-track', ok: false, error: '--token <t> is required' }, 2);
      const rows = await fresh();
      if (!rows) return out({ action: 'hold-track', ok: false, token: tokenArg, error: 'no process table — nothing recorded (the hold stays; release confirms the session later)' }, 2);
      const r = await track({ dir, token: tokenArg, rows });
      return out({ action: 'hold-track', token: tokenArg, ...r }, r.ok ? 0 : 2);
    }
    if (sub === 'release') {
      if (!tokenArg && !runId) return out({ action: 'hold-release', ok: false, error: '--token <t> or --run-file <f> / --run-id <id> is required' }, 2);
      const t0 = Date.now();
      let r;
      for (;;) {
        const rows = await fresh();
        r = await releaseHold({ dir, token: tokenArg, runId: tokenArg ? null : runId, runFile: tokenArg ? null : runFile, session: tokenArg ? null : sessionArg, rows });
        if (r.reason || !(r.held || []).length || Date.now() - t0 >= waitArg) break;
        await sleep(Math.min(2000, Math.max(1, waitArg - (Date.now() - t0))));
      }
      const open = (r.held || []).length;
      return out({ action: 'hold-release', ok: !r.reason && !open, waitedMs: Date.now() - t0, ...r }, r.reason ? 2 : open ? 1 : 0);
    }
    if (!runId) return out({ action: 'hold-acquire', ok: false, error: '--run-file <f> or --run-id is required' }, 2);
    const units = args.workers === undefined || args.workers === true ? 1 : Number(args.workers);
    let owner;
    if (args['owner-pid'] !== undefined && args['owner-pid'] !== true) owner = { pid: Number(args['owner-pid']), start: null, how: 'explicit' };
    else {
      const rows = await table();
      if (!Array.isArray(rows)) return out({ action: 'hold-acquire', ok: false, runId, code: 'no-owner', error: 'the process table is unavailable, so the Claude Code process cannot be found — pass --owner-pid <its pid>' }, 2);
      owner = findHostProcess(rows, process.pid);
    }
    if (!sessionArg) warnings.push('no --session: a legacy hold (it lives as long as the Claude Code process, its browser is never confirmed closed) — pass the playwright-cli -s= name');
    const exclusive = process.env.QA_LEDGER === 'off';
    const r = await acquireHold({ dir, runId, runFile, owner, units, label: typeof args.label === 'string' ? args.label : null, session: sessionArg, exclusive, waitMs: waitArg,
      snapshot: () => processSnapshot({ timeoutMs: 20000 }) });
    return out({ action: 'hold-acquire', runId, runFile, owner, exclusive, session: sessionArg, ...r }, r.ok ? 0 : r.code === 'invalid' || r.code === 'ledger-error' ? 2 : 1);
  }
  if (cmd === 'release') {
    if (!tokenArg) return out({ action: 'release', ok: false, error: '--token <t> is required (capacity.mjs status lists the tokens)' }, 2);
    if (args.force) { const r = await forceRelease({ dir, token: tokenArg }); return out({ action: 'release', token: tokenArg, ok: r.released, ...r, note: 'freed WITHOUT confirmation (user-run --force)' }, r.released ? 0 : 2); }
    const r = await releaseConfirmed({ dir, token: tokenArg, snapshot: () => processSnapshot({ timeoutMs: 20000 }), attempts: Math.max(1, Math.ceil(waitArg / 2000) + 1), delayMs: 2000 });
    return out({ action: 'release', token: tokenArg, ok: r.released, ...r }, r.released ? 0 : 1);
  }
  return out({ action: cmd || null, ok: false, error: 'unknown command — status | config | sweep | reclaim | release | lease acquire|status|release | hold acquire|track|release (--help)' }, 2);
}

const isMain = (() => { try { return fs.realpathSync.native(process.argv[1] || '') === fs.realpathSync.native(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  main().then((code) => process.exit(code), (e) => {
    const args = parseArgs(process.argv.slice(2));
    print({ tool: 'capacity', schema: CAPACITY_SCHEMA, ok: false, error: 'internal error: ' + (e && e.message), stack: e && e.stack ? String(e.stack).split('\n').slice(0, 4) : undefined }, args);
    process.exit(args.strict ? 2 : 0);
  });
}
