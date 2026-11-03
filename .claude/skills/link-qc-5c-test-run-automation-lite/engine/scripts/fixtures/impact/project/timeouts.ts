// The one timeout policy of the suite — every number in the automation lives here.
export const TIMEOUTS = {
  test: { default: 90_000, setup: 180_000 },
  expect: { default: 10_000 },
  action: { default: 15_000 },
  navigation: { default: 30_000 },
  step: { default: 45_000 },
  operations: { save: 20_000, search: 12_000 },
} as const;
