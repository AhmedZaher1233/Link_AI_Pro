// Fixture evidence helper for selftest-check.mjs. Never executed by Playwright.
export async function captureEvidence(page: unknown, testInfo: unknown) {
  return { page, testInfo };
}
