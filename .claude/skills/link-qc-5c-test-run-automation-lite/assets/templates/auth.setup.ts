// tests/auth.setup.ts — Lite template (P1): sign in ONCE per role (× language when the language lives in the session or a
// cookie) and save the signed-in state, so no test pays a UI sign-in for a precondition. Used when `lite auth` recorded
// strategy `setup-project` (sessions survive the environment reset, or there is no reset).
//
// Wiring (shared config): a project `setup` with `testMatch: /auth\.setup\.ts/`, and the browser project lists
// `dependencies: ['setup']`. Specs then take a state per role: `test.use({ storageState: storageStateFor('approver') })`.
// Roles and languages come from the TEST-DATA file (never from this template); credentials by SECRET NAME only (fixtures/auth.ts).
//
// It is a JOURNEY, never a result: annotation `{ type: 'journey', description: 'setup' }`, no [TC-ID] in a title, listed with
// `lite journey --run-file {rf} --spec tests/auth.setup.ts`.
//
// Probe mode (`lite auth --run-file {rf} --probe-spec tests/auth.setup.ts` sets PW_AUTH_PROBE=1): instead of saving states it
// signs in as the first role, records HOW the app keeps the session and whether it survives the environment reset, and writes
// .auth/probe.json — NAMES and BOOLEANS only, never a cookie or token value.
import { test as setup, expect } from '@playwright/test';
import { ROLES, LANGUAGES, saveState, writeProbe } from '../fixtures/auth';
import { SignInPage } from '../pages/SignInPage'; // the project's own sign-in page object (rename to yours)
import { resetEnvironment } from '../prerequest/reset'; // the project's LEDGERED environment reset (recordChange), if it has one; else pass null

const JOURNEY = { annotation: { type: 'journey', description: 'setup' } } as const;

if (process.env.PW_AUTH_PROBE === '1') {
  setup('Probe how the session is kept', JOURNEY, async ({ page }) => {
    const signIn = new SignInPage(page);
    await signIn.signInAs(ROLES[0]);
    await expect(signIn.signedInMarker()).toBeVisible();
    const probe = await writeProbe(page, () => signIn.stillSignedIn(), resetEnvironment);
    expect(['cookie', 'token', 'other']).toContain(probe.mechanism);
  });
} else {
  for (const role of ROLES) {
    for (const lang of LANGUAGES) {
      setup(`Sign in once as ${role}${lang ? ' (' + lang + ')' : ''}`, JOURNEY, async ({ page }) => {
        const signIn = new SignInPage(page);
        await signIn.signInAs(role, lang);
        await expect(signIn.signedInMarker()).toBeVisible();
        await saveState(page, role, lang); // under .auth/ — git-ignored, removed at close-out
      });
    }
  }
}
