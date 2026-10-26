// Fixture timeout policy (stands in for {automation_root}/timeouts.ts) — the ONE file where inline numbers belong.
export const TIMEOUTS = {
  test: { default: 90_000, long: 180_000 },
  action: 15_000,
  step: { default: 30_000, long: 120_000 },
  expectOptions: { timeout: 10_000 },
} as const;
