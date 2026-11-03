// Fixture timeout policy for selftest-check.mjs. Never executed. One named operation of 15 minutes: the A15 report
// must list it as a deadline of 10 minutes or more.
export const TIMEOUTS = {
  test: {
    default: 90_000,
    long: 180_000,
  },
  expect: 10_000,
  action: 15_000,
  navigation: 30_000,
  hook: 60_000,
  step: {
    default: 30_000,
    long: 120_000,
  },
  operations: {
    nightly_import: 900_000, // the nightly import runs server-side for up to 15 minutes
  } as Record<string, number>,
  watchdog_grace: 60_000,
} as const;
