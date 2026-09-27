// Fixture step wrapper for the validator self-test. Never executed by Playwright.
// Stands in for the project's helpers/steps.ts (deadline-owning wrapper around test.step).
export async function step(title: string, body: () => Promise<void>) {
  return { title, result: await body() };
}
