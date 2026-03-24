/**
 * AUD-TC-03-L1b-40: hygiene-ownership-lib.ts audit tests
 * Role: B6 (Health Witness)
 *
 * Spec: plans/hygiene-governance/PLAN.md ownership tracking library
 *
 * Behaviors:
 *   (1) classifyOwner returns 'team' for handles with `/`, 'service' for `[bot]`/`-bot`, 'person' otherwise
 *   (2) loadCodeowners reads and parses CODEOWNERS file format (pattern + owners per line, comments/blanks skipped)
 *   (3) matchesCodeownersPattern correctly matches glob patterns against file paths
 *   (4) isCriticalRelativePath identifies critical paths requiring ownership
 *   (5) toRelative converts absolute paths to repo-relative
 *   (6) CodeownersEntry interface has pattern/owners/line
 *
 * PURE FUNCTIONS — no mocks needed, tested directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';

// Direct import — pure functions
import {
  classifyOwner,
  loadCodeowners,
  matchesCodeownersPattern,
  isCriticalRelativePath,
  toRelative,
} from '../../../utils/hygiene-ownership-lib.js';

describe('hygiene-ownership-lib audit tests (L1b-40)', () => {
  // ─── B1: classifyOwner ───
  describe('B1: classifyOwner classification', () => {
    it('returns "team" for handles containing "/"', () => {
      expect(classifyOwner('@org/team-name')).toBe('team');
      expect(classifyOwner('org/team')).toBe('team');
    });

    it('returns "service" for handles with "[bot]"', () => {
      expect(classifyOwner('@dependabot[bot]')).toBe('service');
      expect(classifyOwner('renovate[bot]')).toBe('service');
    });

    it('returns "service" for handles ending with "-bot"', () => {
      expect(classifyOwner('@github-bot')).toBe('service');
      expect(classifyOwner('deploy-bot')).toBe('service');
    });

    it('returns "person" for regular handles', () => {
      expect(classifyOwner('@jonathan')).toBe('person');
      expect(classifyOwner('alice')).toBe('person');
    });

    it('strips @ prefix before classification', () => {
      // @org/team should still detect the /
      expect(classifyOwner('@org/team')).toBe('team');
      // @user without / or bot markers → person
      expect(classifyOwner('@user')).toBe('person');
    });
  });

  // ─── B2: loadCodeowners ───
  describe('B2: loadCodeowners parses CODEOWNERS format', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(path.join(tmpdir(), 'ownership-test-'));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('reads from .github/CODEOWNERS (first candidate)', async () => {
      const ghDir = path.join(tempDir, '.github');
      await mkdir(ghDir, { recursive: true });
      await writeFile(path.join(ghDir, 'CODEOWNERS'), 'src/** @alice\n');

      const result = await loadCodeowners(tempDir);
      expect(result.path).toContain('.github/CODEOWNERS');
      expect(result.entries).toHaveLength(1);
    });

    it('falls back to root CODEOWNERS when .github not present', async () => {
      await writeFile(path.join(tempDir, 'CODEOWNERS'), 'docs/** @bob\n');

      const result = await loadCodeowners(tempDir);
      expect(result.path).toContain('CODEOWNERS');
      expect(result.entries).toHaveLength(1);
    });

    it('returns null path and empty entries when no CODEOWNERS found', async () => {
      const result = await loadCodeowners(tempDir);
      expect(result.path).toBeNull();
      expect(result.entries).toEqual([]);
    });

    it('skips comment lines and blank lines', async () => {
      const content = [
        '# This is a comment',
        '',
        'src/** @alice',
        '  # Another comment',
        '  ',
        'docs/** @bob',
      ].join('\n');
      await mkdir(path.join(tempDir, '.github'), { recursive: true });
      await writeFile(path.join(tempDir, '.github', 'CODEOWNERS'), content);

      const result = await loadCodeowners(tempDir);
      expect(result.entries).toHaveLength(2);
    });

    it('skips lines without @-prefixed owners', async () => {
      const content = 'src/** notat\ndocs/** @valid-owner\n';
      await mkdir(path.join(tempDir, '.github'), { recursive: true });
      await writeFile(path.join(tempDir, '.github', 'CODEOWNERS'), content);

      const result = await loadCodeowners(tempDir);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].owners).toEqual(['@valid-owner']);
    });

    it('parses multiple owners per line', async () => {
      await mkdir(path.join(tempDir, '.github'), { recursive: true });
      await writeFile(path.join(tempDir, '.github', 'CODEOWNERS'), 'src/** @alice @bob @org/team\n');

      const result = await loadCodeowners(tempDir);
      expect(result.entries[0].owners).toEqual(['@alice', '@bob', '@org/team']);
    });

    // B6: CodeownersEntry has pattern/owners/line
    it('entries have pattern, owners array, and 1-based line number', async () => {
      const content = '# header\nsrc/** @alice\ndocs/** @bob\n';
      await mkdir(path.join(tempDir, '.github'), { recursive: true });
      await writeFile(path.join(tempDir, '.github', 'CODEOWNERS'), content);

      const result = await loadCodeowners(tempDir);
      expect(result.entries[0]).toEqual({
        pattern: 'src/**',
        owners: ['@alice'],
        line: 2,
      });
      expect(result.entries[1]).toEqual({
        pattern: 'docs/**',
        owners: ['@bob'],
        line: 3,
      });
    });
  });

  // ─── B3: matchesCodeownersPattern ───
  describe('B3: matchesCodeownersPattern glob matching', () => {
    it('matches wildcard * (everything)', () => {
      expect(matchesCodeownersPattern('*', 'any/file.ts')).toBe(true);
    });

    it('matches directory glob (src/**)', () => {
      expect(matchesCodeownersPattern('src/**', 'src/utils/file.ts')).toBe(true);
      expect(matchesCodeownersPattern('src/**', 'docs/file.ts')).toBe(false);
    });

    it('matches trailing slash as directory prefix', () => {
      expect(matchesCodeownersPattern('src/', 'src/file.ts')).toBe(true);
      expect(matchesCodeownersPattern('src/', 'docs/file.ts')).toBe(false);
    });

    it('matches bare filename pattern against nested paths', () => {
      expect(matchesCodeownersPattern('file.ts', 'src/utils/file.ts')).toBe(true);
      expect(matchesCodeownersPattern('file.ts', 'file.ts')).toBe(true);
    });

    it('matches single-star glob (*.ts)', () => {
      expect(matchesCodeownersPattern('*.ts', 'index.ts')).toBe(true);
    });

    it('strips leading slash from pattern for matching', () => {
      expect(matchesCodeownersPattern('/src/**', 'src/file.ts')).toBe(true);
    });

    it('handles directory prefix without trailing slash', () => {
      expect(matchesCodeownersPattern('src', 'src/file.ts')).toBe(true);
    });
  });

  // ─── B4: isCriticalRelativePath ───
  describe('B4: isCriticalRelativePath identifies critical paths', () => {
    it('package.json is critical', () => {
      expect(isCriticalRelativePath('package.json')).toBe(true);
    });

    it('src/core/ paths are critical', () => {
      expect(isCriticalRelativePath('src/core/verification/gate.ts')).toBe(true);
      expect(isCriticalRelativePath('src/core/utils/shared.ts')).toBe(true);
    });

    it('src/utils/verify-* paths are critical', () => {
      expect(isCriticalRelativePath('src/utils/verify-hygiene-foundation.ts')).toBe(true);
    });

    it('src/core/verification/ paths are critical', () => {
      expect(isCriticalRelativePath('src/core/verification/run-advisory-gate.ts')).toBe(true);
    });

    it('.github/CODEOWNERS is critical', () => {
      expect(isCriticalRelativePath('.github/CODEOWNERS')).toBe(true);
    });

    it('src/mcp/tools/ paths are critical', () => {
      expect(isCriticalRelativePath('src/mcp/tools/some-tool.ts')).toBe(true);
    });

    it('regular source files are NOT critical', () => {
      expect(isCriticalRelativePath('src/utils/some-helper.ts')).toBe(false);
      expect(isCriticalRelativePath('docs/README.md')).toBe(false);
      expect(isCriticalRelativePath('test/something.test.ts')).toBe(false);
    });

    it('strips leading slashes before checking', () => {
      expect(isCriticalRelativePath('/package.json')).toBe(true);
    });
  });

  // ─── B5: toRelative ───
  describe('B5: toRelative converts absolute to repo-relative paths', () => {
    it('converts absolute path to relative', () => {
      const result = toRelative('/repo', '/repo/src/file.ts');
      expect(result).toBe('src/file.ts');
    });

    it('normalizes backslashes to forward slashes', () => {
      const result = toRelative('/repo', '/repo/src\\utils\\file.ts');
      // Should contain forward slashes
      expect(result).not.toContain('\\');
    });

    it('returns absolute path when outside repo root', () => {
      const result = toRelative('/repo', '/other/path/file.ts');
      // When relative starts with .., returns the abs path with normalized slashes
      expect(result).toContain('/other/path/file.ts');
    });
  });
});
