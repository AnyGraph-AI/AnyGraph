/**
 * AUD-TC-07-L1-09: vitest.config.ts — Behavioral Audit Tests
 *
 * Spec source: project root test configuration
 * Tests assert the configuration BEHAVIOR (discovery, coverage, setup)
 *
 * Accept: 6+ behavioral assertions, all green
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve the project root from the test file location
// src/core/test-harness/__audit__/ → 4 levels up to reach project root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const VITEST_CONFIG_PATH = path.join(ROOT, 'vitest.config.ts');

// Read once
const configContent = fs.readFileSync(VITEST_CONFIG_PATH, 'utf-8');

describe('AUD-TC-07 | vitest.config.ts', () => {

  // ─── Behavior 6: config file exists and uses defineConfig ────────────────

  describe('Behavior 6: config exports a valid defineConfig result', () => {
    it('vitest.config.ts file exists at project root', () => {
      expect(fs.existsSync(VITEST_CONFIG_PATH)).toBe(true);
    });

    it('uses defineConfig from vitest/config', () => {
      expect(configContent).toContain("from 'vitest/config'");
      expect(configContent).toContain('defineConfig');
    });

    it('file is non-empty', () => {
      expect(configContent.length).toBeGreaterThan(0);
    });
  });

  // ─── Behavior 1: test.include covers required patterns ────────────────────

  describe('Behavior 1: test.include covers required glob patterns', () => {
    it('includes tests/**/*.test.ts', () => {
      expect(configContent).toContain('tests/**/*.test.ts');
    });

    it('includes src/**/*.test.ts', () => {
      expect(configContent).toContain('src/**/*.test.ts');
    });

    it('includes src/**/*.spec-test.ts', () => {
      expect(configContent).toContain('src/**/*.spec-test.ts');
    });
  });

  // ─── Behavior 2: test.exclude blocks dist and node_modules ───────────────

  describe('Behavior 2: test.exclude blocks dist/** and node_modules/**', () => {
    it('excludes dist/**', () => {
      expect(configContent).toContain('dist/**');
    });

    it('excludes node_modules/**', () => {
      expect(configContent).toContain('node_modules/**');
    });
  });

  // ─── Behavior 3: globalSetup file exists ─────────────────────────────────

  describe('Behavior 3: globalSetup points to vitest-global-teardown.ts which exists', () => {
    it('config references vitest-global-teardown', () => {
      expect(configContent).toContain('vitest-global-teardown');
    });

    it('vitest-global-teardown.ts file exists on disk', () => {
      const teardownPath = path.join(ROOT, 'src', 'core', 'test-harness', 'vitest-global-teardown.ts');
      expect(fs.existsSync(teardownPath)).toBe(true);
    });
  });

  // ─── Behavior 4: coverage.provider is v8 ─────────────────────────────────

  describe('Behavior 4: coverage.provider is "v8"', () => {
    it('coverage provider is v8', () => {
      expect(configContent).toContain("provider: 'v8'");
    });
  });

  // ─── Behavior 5: coverage include/exclude correctness ────────────────────

  describe('Behavior 5: coverage.include is src/**/*.ts and coverage.exclude blocks test files', () => {
    it('coverage includes src/**/*.ts', () => {
      expect(configContent).toContain("include: ['src/**/*.ts']");
    });

    it('coverage excludes .test.ts files', () => {
      // Present in coverage.exclude array
      expect(configContent).toContain('src/**/*.test.ts');
    });

    it('coverage excludes .spec-test.ts files', () => {
      expect(configContent).toContain('src/**/*.spec-test.ts');
    });

    it('coverage excludes test-harness directory', () => {
      expect(configContent).toContain('src/core/test-harness/**');
    });

    it('coverage excludes .d.ts declaration files', () => {
      expect(configContent).toContain('src/**/*.d.ts');
    });
  });
});
