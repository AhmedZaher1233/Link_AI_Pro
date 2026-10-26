// Fixture network guard for the validator self-test (stands in for helpers/network-guard.ts). Never executed.
export async function attachNetworkGuard(page: unknown, info: unknown) {
  return { page, info, async report(i: unknown) { return i; } };
}
