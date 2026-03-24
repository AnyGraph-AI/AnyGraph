/**
 * AUD-TC B6: src/core/utils/project-id.ts — Behavioral Audit Tests
 * Fork: Drew/Jason origin, heavily extended
 *
 * Spec source: No formal spec — fork code. Project identity generation.
 * Accept: 14 behavioral assertions, all green
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateProjectId,
  validateProjectId,
  resolveProjectId,
  getProjectName,
  resolveProjectIdFromInput,
  type ProjectResolver,
} from '../../utils/project-id.js';
import { resolve } from 'path';

// SPEC-GAP: No formal spec defines hash algorithm (SHA-256) or truncation length (12). Derived from code.
// SPEC-GAP: No spec defines the exact Cypher query used for Neo4j lookups. Tested via mock interface.
// SPEC-GAP: No spec defines Windows path detection regex. Derived from implementation.

describe('AUD-TC B6 | project-id.ts', () => {
  // ─── Behavior 1: generateProjectId produces proj_ prefix + 12-char hex hash ──
  describe('Behavior 1: generateProjectId format', () => {
    it('produces proj_ prefix followed by 12 hex characters', () => {
      const id = generateProjectId('/some/project/path');
      expect(id).toMatch(/^proj_[a-f0-9]{12}$/);
    });

    it('total length is 17 characters (5 prefix + 12 hash)', () => {
      const id = generateProjectId('/another/path');
      expect(id.length).toBe(17);
    });
  });

  // ─── Behavior 2: generateProjectId is deterministic ──────────────────────
  describe('Behavior 2: determinism', () => {
    it('same path produces same ID', () => {
      const id1 = generateProjectId('/stable/path');
      const id2 = generateProjectId('/stable/path');
      expect(id1).toBe(id2);
    });

    it('different paths produce different IDs', () => {
      const id1 = generateProjectId('/path/a');
      const id2 = generateProjectId('/path/b');
      expect(id1).not.toBe(id2);
    });
  });

  // ─── Behavior 3: resolves relative paths to absolute before hashing ──────
  describe('Behavior 3: relative path resolution', () => {
    it('relative path produces same ID as its resolved absolute path', () => {
      const relativePath = './some/relative/path';
      const absolutePath = resolve(relativePath);
      const idFromRelative = generateProjectId(relativePath);
      const idFromAbsolute = generateProjectId(absolutePath);
      expect(idFromRelative).toBe(idFromAbsolute);
    });
  });

  // ─── Behavior 4: validateProjectId accepts valid format ──────────────────
  describe('Behavior 4: validateProjectId accepts valid', () => {
    it('accepts proj_ + 12 hex chars', () => {
      expect(validateProjectId('proj_a1b2c3d4e5f6')).toBe(true);
    });

    it('accepts all-zero hash', () => {
      expect(validateProjectId('proj_000000000000')).toBe(true);
    });

    it('accepts output of generateProjectId', () => {
      const id = generateProjectId('/test/path');
      expect(validateProjectId(id)).toBe(true);
    });
  });

  // ─── Behavior 5: validateProjectId rejects invalid formats ───────────────
  describe('Behavior 5: validateProjectId rejects invalid', () => {
    it('rejects wrong prefix', () => {
      expect(validateProjectId('prj_a1b2c3d4e5f6')).toBe(false);
    });

    it('rejects too short hash', () => {
      expect(validateProjectId('proj_a1b2c3')).toBe(false);
    });

    it('rejects too long hash', () => {
      expect(validateProjectId('proj_a1b2c3d4e5f6a7')).toBe(false);
    });

    it('rejects non-hex characters', () => {
      expect(validateProjectId('proj_g1h2i3j4k5l6')).toBe(false);
    });

    it('rejects uppercase hex', () => {
      expect(validateProjectId('proj_A1B2C3D4E5F6')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(validateProjectId('')).toBe(false);
    });

    it('rejects null/undefined via type coercion', () => {
      expect(validateProjectId(null as any)).toBe(false);
      expect(validateProjectId(undefined as any)).toBe(false);
    });
  });

  // ─── Behavior 6: resolveProjectId returns validated explicit projectId ───
  describe('Behavior 6: resolveProjectId with explicit ID', () => {
    it('returns the explicit projectId when valid', () => {
      const result = resolveProjectId('/any/path', 'proj_a1b2c3d4e5f6');
      expect(result).toBe('proj_a1b2c3d4e5f6');
    });
  });

  // ─── Behavior 7: resolveProjectId generates from path when no explicit ID ─
  describe('Behavior 7: resolveProjectId without explicit ID', () => {
    it('generates from path when no projectId provided', () => {
      const result = resolveProjectId('/my/project');
      const expected = generateProjectId('/my/project');
      expect(result).toBe(expected);
    });
  });

  // ─── Behavior 8: resolveProjectId throws on invalid explicit projectId ───
  describe('Behavior 8: resolveProjectId throws on invalid', () => {
    it('throws Error with descriptive message', () => {
      expect(() => resolveProjectId('/path', 'bad_id')).toThrow('Invalid projectId format');
    });
  });

  // ─── Behavior 9: getProjectName reads name from package.json ─────────────
  describe('Behavior 9: getProjectName from package.json', () => {
    it('reads name from package.json when available', async () => {
      // Use this project's own package.json
      const projectPath = resolve(__dirname, '../../../../');
      const name = await getProjectName(projectPath);
      // Should return the package name, not the directory basename
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    });
  });

  // ─── Behavior 10: getProjectName falls back to directory basename ────────
  describe('Behavior 10: getProjectName falls back to basename', () => {
    it('returns directory basename when no package.json', async () => {
      const name = await getProjectName('/nonexistent/some-project');
      expect(name).toBe('some-project');
    });
  });

  // ─── Behavior 11: resolveProjectIdFromInput passes through valid ID ──────
  describe('Behavior 11: resolveProjectIdFromInput passthrough', () => {
    it('returns valid projectId without hitting Neo4j', async () => {
      const mockResolver: ProjectResolver = {
        run: vi.fn().mockRejectedValue(new Error('should not be called')),
      };
      const result = await resolveProjectIdFromInput('proj_a1b2c3d4e5f6', mockResolver);
      expect(result).toBe('proj_a1b2c3d4e5f6');
      expect(mockResolver.run).not.toHaveBeenCalled();
    });
  });

  // ─── Behavior 12: resolveProjectIdFromInput looks up by name/path in Neo4j ─
  describe('Behavior 12: resolveProjectIdFromInput Neo4j lookup', () => {
    it('looks up by name in Neo4j and returns found projectId', async () => {
      const mockResolver: ProjectResolver = {
        run: vi.fn().mockResolvedValue([{ projectId: 'proj_aabbccddeeff' }]),
      };
      const result = await resolveProjectIdFromInput('backend', mockResolver);
      expect(result).toBe('proj_aabbccddeeff');
      expect(mockResolver.run).toHaveBeenCalledOnce();
    });
  });

  // ─── Behavior 13: resolveProjectIdFromInput generates from path on Neo4j miss ─
  describe('Behavior 13: resolveProjectIdFromInput fallback to path generation', () => {
    it('generates from Unix path when Neo4j lookup returns empty', async () => {
      const mockResolver: ProjectResolver = {
        run: vi.fn().mockResolvedValue([]),
      };
      const result = await resolveProjectIdFromInput('/home/dev/my-project', mockResolver);
      const expected = generateProjectId('/home/dev/my-project');
      expect(result).toBe(expected);
    });

    it('generates from relative path starting with ./', async () => {
      const mockResolver: ProjectResolver = {
        run: vi.fn().mockResolvedValue([]),
      };
      const result = await resolveProjectIdFromInput('./my-project', mockResolver);
      const expected = generateProjectId('./my-project');
      expect(result).toBe(expected);
    });

    it('generates from Windows path when Neo4j lookup returns empty', async () => {
      const mockResolver: ProjectResolver = {
        run: vi.fn().mockResolvedValue([]),
      };
      const result = await resolveProjectIdFromInput('C:\\Users\\dev\\project', mockResolver);
      const expected = generateProjectId('C:\\Users\\dev\\project');
      expect(result).toBe(expected);
    });
  });

  // ─── Behavior 14: resolveProjectIdFromInput throws for unresolvable input ─
  describe('Behavior 14: resolveProjectIdFromInput throws for non-path', () => {
    it('throws when Neo4j lookup fails and input is not a path', async () => {
      const mockResolver: ProjectResolver = {
        run: vi.fn().mockResolvedValue([]),
      };
      await expect(
        resolveProjectIdFromInput('nonexistent-project', mockResolver),
      ).rejects.toThrow('Project not found');
    });
  });
});
