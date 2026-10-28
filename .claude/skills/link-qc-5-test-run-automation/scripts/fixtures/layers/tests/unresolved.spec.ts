// A test whose layer no scan can establish — layer-unresolved, the scanner gate BLOCKED. Never executed.
import { test } from '../fixtures/test';

test.describe('REQ-014: unresolved layer', () => {
  test('[TC-05] nothing a scan can resolve', async ({ helperThing }) => { // expect: layer-unresolved
    await helperThing.run();
  });
});
