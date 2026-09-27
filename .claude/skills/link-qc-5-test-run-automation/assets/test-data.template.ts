// helpers/test-data.ts — unique test data per phase, worker, retry and run (skill 5, references/code-craft.md §7).
//
// Copied by link-qc-5-test-run-automation into {automation_root}/helpers/test-data.ts when absent.
//
// Every record a test CREATES carries a name / code built here, so two workers, a retry, a
// repeat-each variant or a re-run of the same phase never collide on "Order Alpha", and cleanup
// can select everything a run created by prefix.
//
//   const name = uniqueName('order');            // order-p3-w1-r0-k7q2
//   await orders.create(name);
//   … afterAll: await deleteByPrefix(runPrefix('order'))   // order-p3-
import { test, type TestInfo } from '@playwright/test';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function shortRandom(length = 4): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

/** The phase this run belongs to — set per stage command by the skill (PW_PHASE); `0` outside a skill run. */
export function phase(): string {
  return process.env.PW_PHASE ?? '0';
}

/** Prefix shared by everything THIS phase creates under `prefix` — the key for cleanup sweeps. */
export function runPrefix(prefix: string): string {
  return `${prefix}-p${phase()}-`;
}

/** `{prefix}-p{phase}-w{worker}-r{retry}-{4 random}` — unique across workers, retries, repeats and re-runs. */
export function uniqueName(prefix: string, info: TestInfo = test.info()): string {
  const repeat = info.repeatEachIndex ? `-e${info.repeatEachIndex}` : '';
  return `${runPrefix(prefix)}w${info.parallelIndex}-r${info.retry}${repeat}-${shortRandom()}`;
}

/** Same shape for numeric-only fields (codes, references): digits only, still unique per worker / retry. */
export function uniqueCode(info: TestInfo = test.info(), digits = 6): string {
  const stamp = Date.now().toString().slice(-digits);
  return `${phase()}${info.parallelIndex}${info.retry}${stamp}`.slice(-digits - 3);
}
