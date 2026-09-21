// Case 3 — legitimate project-specific exceptions. Must reach PASS with zero violations,
// three honoured exceptions, and one malformed pragma that is NOT honoured.
import { test, expect } from '@playwright/test';
import { ThingPage } from './pages/thing.page.fixture';
import { captureEvidence } from './helpers/evidence.fixture';

test.describe('REQ-014: justified exceptions', () => {
  test('[TC-01] Validate that the SSO bootstrap reaches the list', async ({ page }, testInfo) => {
    // qa-allow: pom-navigation — SSO bootstrap runs before any page object exists (REQ-014)
    await page.goto('/sso/start');
    // deliberate retry backoff — the identity gateway rate-limits repeated bootstraps (REQ-014)
    await page.waitForTimeout(400);
    const thing = new ThingPage(page);
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Alpha')).toHaveText('Alpha');
  });

  // qa-allow: absolute-url — the identity provider is outside the app under test (REQ-014)
  const IDP = 'https://idp.example.com/authorize';

  test.skip(!IDP, 'identity provider host is not configured in this environment');

  test('[TC-02] Validate that the provider handshake completes', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    await thing.create('Beta');
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Beta')).toHaveText('Beta');
  });
});

// qa-allow: absolute-url — short
