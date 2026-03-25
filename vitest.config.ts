import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 10000,
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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec-test.ts',
        'src/core/test-harness/**',
        'src/**/*.d.ts',
      ],
    },
  },
});
