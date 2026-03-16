import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/**/*.test.ts',
      'src/**/*.test.ts',
      'src/**/*.spec-test.ts',
    ],
    exclude: [
      'dist/**',
      'node_modules/**',
    ],
    globalSetup: './src/core/test-harness/vitest-global-teardown.ts',
  },
});
