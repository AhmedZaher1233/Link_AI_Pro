// Fixture evidence helper for the validator self-test. Never executed by Playwright.
export async function captureEvidence(page: unknown, testInfo: unknown) {
  return { page, testInfo };
}
