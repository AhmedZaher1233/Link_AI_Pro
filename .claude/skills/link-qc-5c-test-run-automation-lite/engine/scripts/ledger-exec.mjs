#!/usr/bin/env node
// ledger-exec.mjs — the wrapper of the capacity ledger's two-phase spawn (optimisation plan Revision 3.1 §4.2).
// Node >= 18, zero dependencies.
//
// run-stage.mjs reserves a ledger entry first (state `spawning`, a unique token — capacity.mjs reserve()), then spawns
// THIS script with the token in its command line. Before the real command starts it registers its OWN pid + start time
// in that entry (registerWrapper), so the reserved capacity stays attributed even when the parent dies before it could
// record the child; an entry whose owner died without any registration is resolved by finding the token in the process
// table (capacity.mjs sweep()). It then runs the command — without a shell, or through one with --shell (a command
// string) —, records the command's pid as a descendant, inherits stdio (the parent still reads the line output), sets
// QA_LEDGER_TOKEN in the command's environment, forwards SIGINT / SIGTERM and exits with the command's exit code.
// It never releases capacity: the parent releases it once the whole tree is gone, or a sweep does.
//
// Usage: node ledger-exec.mjs <token> [--capacity-dir <dir>] [--shell] -- <command> [args…]
// Exit codes: the command's own · 64 bad usage · 70 the token is not in the ledger (not started: the capacity would not
// be counted) · 127 the command could not be started.
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { registerWrapper, noteDescendant, resolveCapacityDir, trace } from './capacity.mjs';

const say = (msg) => { try { process.stderr.write('ledger-exec: ' + msg + '\n'); } catch { /* nothing to report to */ } };

async function main() {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf('--');
  const head = sep < 0 ? argv : argv.slice(0, sep);
  const command = sep < 0 ? [] : argv.slice(sep + 1);
  const token = head[0];
  let dir = null;
  let shell = false;
  for (let i = 1; i < head.length; i++) {
    if (head[i] === '--capacity-dir' && head[i + 1]) dir = head[++i];
    else if (head[i] === '--shell') shell = true;
    else { say('unknown option ' + head[i]); return 64; }
  }
  if (!token || !/^[0-9a-f][0-9a-f-]{7,}$/i.test(token) || !command.length) {
    say('usage: node ledger-exec.mjs <token> [--capacity-dir <dir>] [--shell] -- <command> [args…]');
    return 64;
  }
  dir = dir ? path.resolve(dir) : resolveCapacityDir();

  // register before anything runs; a busy ledger is retried — a missing entry is never run unaccounted
  let reg = null;
  const regT0 = Date.now();
  let attempts = 0;
  for (let i = 0; i < 3 && !(reg && (reg.ok || reg.reason === 'unknown token')); i++) {
    attempts++;
    try { reg = await registerWrapper({ dir, token }); } catch (e) { reg = { ok: false, reason: e.message }; }
  }
  trace('exec-registered', { token, ok: !!(reg && reg.ok), attempts, ms: Date.now() - regT0, reason: reg && !reg.ok ? reg.reason : null });
  if (reg && !reg.ok && reg.reason === 'unknown token') {
    say('token ' + token + ' is not in the capacity ledger (' + dir + ') — not started: its capacity would not be counted');
    return 70;
  }
  if (!reg || !reg.ok) say('could not register in the capacity ledger (' + ((reg && reg.reason) || 'unknown error') + ') — continuing under the parent\'s reservation');

  const env = { ...process.env, QA_LEDGER_TOKEN: token };
  let child;
  try {
    child = shell
      ? spawn(command.join(' '), { shell: true, stdio: 'inherit', env, windowsHide: false })
      : spawn(command[0], command.slice(1), { stdio: 'inherit', env, windowsHide: false });
  } catch (e) { say('the command could not be started: ' + e.message); return 127; }

  let noted = Promise.resolve();
  const startedAt = Date.now();
  if (child.pid !== undefined) noted = noteDescendant({ dir, token, pid: child.pid, start: startedAt }).catch(() => { /* the parent's tree walk records it too */ });

  const forward = (sig) => { try { child.kill(sig); } catch { /* already gone */ } };
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));

  return new Promise((resolve) => {
    child.on('error', (e) => { say('the command could not be started: ' + e.message); noted.finally(() => resolve(127)); });
    child.on('exit', (code, signal) => {
      const status = code !== null && code !== undefined ? code : 128 + ((signal && os.constants.signals[signal]) || 1);
      noted.finally(() => resolve(status));
    });
  });
}

main().then((code) => process.exit(code), (e) => { say('internal error: ' + (e && e.message)); process.exit(70); });
