// Fixture lint configuration for selftest-check.mjs: the floating-promise rule WITHOUT type information — Check 27
// stays a semantic review item.
export default [
  { files: ['**/*.ts'], rules: { '@typescript-eslint/no-floating-promises': 'error' } },
];
