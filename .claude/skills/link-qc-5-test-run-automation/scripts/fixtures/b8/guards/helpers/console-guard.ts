// Fixture console guard for the validator self-test (stands in for helpers/console-guard.ts). Never executed.
export function attachConsoleGuard(page: unknown) {
  return { page, async report(info: unknown) { return info; } };
}
