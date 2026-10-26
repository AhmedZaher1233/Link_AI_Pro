#!/usr/bin/env node
// Fake TypeScript compiler for selftest-check.mjs. FAKE_TSC=fail prints one module-resolution error (relative to the
// working directory, like tsc --pretty false) and exits 2; anything else exits 0 with no output.
if (process.env.FAKE_TSC === 'fail') {
  process.stdout.write("tests/orders.spec.ts(3,28): error TS2307: Cannot find module '../pages/Missing' or its corresponding type declarations.\n");
  process.exit(2);
}
process.exit(0);
