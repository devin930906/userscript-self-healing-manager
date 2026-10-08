/**
 * Reserved Vitest config for the next bootstrap iteration.
 * Current offline validation uses Node's built-in test runner (see README).
 * The Vitest dependency and its test migration must be completed before
 * claiming the planned Vitest acceptance gate has passed.
 */
export default {
  test: {
    include: ['packages/**/test/**/*.test.ts', 'apps/**/tests/**/*.test.ts'],
    environment: 'node',
  },
};
