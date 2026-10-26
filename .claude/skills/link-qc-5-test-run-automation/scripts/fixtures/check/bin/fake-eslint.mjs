#!/usr/bin/env node
// Fake ESLint for selftest-check.mjs: prints the JSON formatter's shape for every file argument. FAKE_ESLINT=floating
// reports one @typescript-eslint/no-floating-promises error on line 9 of the first file (exit 1); otherwise no message
// (exit 0).
const files = process.argv.slice(2).filter((a) => !a.startsWith('--') && a !== 'json');
const floating = process.env.FAKE_ESLINT === 'floating';
const report = files.map((filePath, i) => ({
  filePath,
  messages: floating && i === 0 ? [{ ruleId: '@typescript-eslint/no-floating-promises', severity: 2, line: 9, message: 'Promises must be awaited.' }] : [],
  errorCount: floating && i === 0 ? 1 : 0,
}));
process.stdout.write(JSON.stringify(report));
process.exit(floating ? 1 : 0);
