// Fixture lint configuration for selftest-check.mjs: the floating-promise rule with type information — Check 27
// becomes deterministic (tool:lint).
export default [
  {
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { projectService: true } },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
];
