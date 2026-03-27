import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
    projects: [
      {
        // Unit tests — fully parallel, no Neo4j contention risk
        test: {
          name: 'unit',
          testTimeout: 10000,
          include: [
            'tests/**/*.test.ts',
            'src/**/*.test.ts',
          ],
          exclude: [
            'dist/**',
            'node_modules/**',
          ],
        },
      },
      {
        // Integration tests — serialized to prevent Neo4j deadlocks
        // spec-test.ts files hit real Neo4j; running them concurrently causes
        // ForsetiClient lock collisions and ANALYZED edge destruction (SCAR-012/013)
        test: {
          name: 'integration',
          testTimeout: 60000,
          include: [
            'src/**/*.spec-test.ts',
          ],
          exclude: [
            'dist/**',
            'node_modules/**',
          ],
          pool: 'forks',
          poolOptions: {
            forks: {
              maxForks: 1,
            },
          },
        },
      },
    ],
  },
});
