/**
 * AUD-TC-03-L1b-41: hygiene-ownership-sync.ts audit tests
 * Role: B6 (Health Witness)
 *
 * Spec: plans/hygiene-governance/PLAN.md ownership sync
 *
 * Behaviors:
 *   (1) loads CODEOWNERS via hygiene-ownership-lib
 *   (2) MERGEs OwnershipScope nodes with pattern/owners/classification
 *   (3) tracks review cadence (OWNERSHIP_REVIEW_CADENCE_DAYS)
 *   (4) computes deterministic SHA IDs
 *   (5) cross-references critical paths with isCriticalRelativePath
 *   (6) uses direct neo4j-driver
 *   (7) accepts PROJECT_ID/REPO_ROOT from env
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

// ── neo4j-driver mock ──

const mockSessionRun = vi.fn().mockResolvedValue({ records: [] });
const mockSessionClose = vi.fn().mockResolvedValue(undefined);
const mockDriverClose = vi.fn().mockResolvedValue(undefined);

vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(() => ({
      session: vi.fn(() => ({
        run: mockSessionRun,
        close: mockSessionClose,
      })),
      close: mockDriverClose,
    })),
    auth: { basic: vi.fn(() => ({})) },
  },
}));

// ── hygiene-ownership-lib mock ──

const mockLoadCodeowners = vi.fn();
const mockClassifyOwner = vi.fn();
const mockMatchesCodeownersPattern = vi.fn();
const mockIsCriticalRelativePath = vi.fn();
const mockToRelative = vi.fn();

vi.mock('../../../utils/hygiene-ownership-lib.js', () => ({
  loadCodeowners: mockLoadCodeowners,
  classifyOwner: mockClassifyOwner,
  matchesCodeownersPattern: mockMatchesCodeownersPattern,
  isCriticalRelativePath: mockIsCriticalRelativePath,
  toRelative: mockToRelative,
}));

let mockExit: ReturnType<typeof vi.spyOn>;
let mockLog: ReturnType<typeof vi.spyOn>;
let mockError: ReturnType<typeof vi.spyOn>;

const origEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  mockSessionRun.mockReset().mockResolvedValue({ records: [] });
  mockSessionClose.mockReset().mockResolvedValue(undefined);
  mockDriverClose.mockReset().mockResolvedValue(undefined);
  mockLoadCodeowners.mockReset();
  mockClassifyOwner.mockReset().mockReturnValue('person');
  mockMatchesCodeownersPattern.mockReset().mockReturnValue(false);
  mockIsCriticalRelativePath.mockReset().mockReturnValue(false);
  mockToRelative.mockReset().mockImplementation((_root: string, absPath: string) => absPath);
  process.env = { ...origEnv };
  mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  mockError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  mockExit.mockRestore();
  mockLog.mockRestore();
  mockError.mockRestore();
  process.env = origEnv;
});

function setupDefaultCodeowners() {
  mockLoadCodeowners.mockResolvedValue({
    path: '/repo/.github/CODEOWNERS',
    entries: [
      { pattern: 'src/**', owners: ['@alice'], line: 1 },
    ],
  });
}

function setupSourceFiles(files: Array<{ id: string; filePath: string }>) {
  // First call after cleanup is SourceFile query
  const records = files.map((f) => ({
    get: (key: string) => {
      if (key === 'id') return f.id;
      if (key === 'filePath') return f.filePath;
      return null;
    },
  }));
  return records;
}

async function runModule(): Promise<void> {
  await import('../../../utils/hygiene-ownership-sync.js');
  await new Promise((r) => setTimeout(r, 100));
}

describe('hygiene-ownership-sync audit tests (L1b-41)', () => {
  // ─── B1: loads CODEOWNERS via lib ───
  describe('B1: loads CODEOWNERS via hygiene-ownership-lib', () => {
    it('calls loadCodeowners with REPO_ROOT', async () => {
      setupDefaultCodeowners();
      mockMatchesCodeownersPattern.mockReturnValue(false);
      // SourceFile query returns empty
      mockSessionRun.mockImplementation((cypher: string) => {
        if (String(cypher).includes('SourceFile')) return { records: [] };
        return { records: [] };
      });
      await runModule();
      expect(mockLoadCodeowners).toHaveBeenCalled();
    });

    it('throws when CODEOWNERS missing or empty', async () => {
      mockLoadCodeowners.mockResolvedValue({ path: null, entries: [] });
      await runModule();
      expect(mockError).toHaveBeenCalled();
      const errorOutput = mockError.mock.calls.flat().join(' ');
      expect(errorOutput).toContain('CODEOWNERS');
    });
  });

  // ─── B2: MERGEs OwnershipScope nodes ───
  describe('B2: MERGEs OwnershipScope nodes', () => {
    it('creates CodeNode:OwnershipScope with pattern from each CODEOWNERS entry', async () => {
      setupDefaultCodeowners();
      mockSessionRun.mockImplementation((cypher: string) => {
        if (String(cypher).includes('SourceFile') && String(cypher).includes('RETURN')) return { records: [] };
        return { records: [] };
      });
      await runModule();

      const scopeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('OwnershipScope') && String(c[0]).includes('MERGE'),
      );
      expect(scopeCalls.length).toBeGreaterThan(0);
      const cypher = String(scopeCalls[0][0]);
      expect(cypher).toContain('CodeNode:OwnershipScope');
      // source='CODEOWNERS' is a literal in SET, not a parameter
      expect(cypher).toContain("'CODEOWNERS'");
      const params = scopeCalls[0][1] as Record<string, unknown>;
      expect(params.scopePattern).toBe('src/**');
    });

    it('creates Owner nodes with ownerType from classifyOwner', async () => {
      setupDefaultCodeowners();
      mockClassifyOwner.mockReturnValue('person');
      mockSessionRun.mockImplementation((cypher: string) => {
        if (String(cypher).includes('SourceFile') && String(cypher).includes('RETURN')) return { records: [] };
        return { records: [] };
      });
      await runModule();

      const ownerCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => {
          const p = c[1] as Record<string, unknown> | undefined;
          return p?.ownerId !== undefined && p?.ownerType !== undefined;
        },
      );
      expect(ownerCalls.length).toBeGreaterThan(0);
      const params = ownerCalls[0][1] as Record<string, unknown>;
      expect(params.ownerType).toBe('person');
      expect(params.handle).toBe('@alice');
    });
  });

  // ─── B3: tracks review cadence ───
  describe('B3: tracks review cadence (OWNERSHIP_REVIEW_CADENCE_DAYS)', () => {
    it('uses default 30-day review cadence', async () => {
      setupDefaultCodeowners();
      mockSessionRun.mockImplementation((cypher: string) => {
        if (String(cypher).includes('SourceFile')) return { records: [] };
        return { records: [] };
      });
      await runModule();

      const scopeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('OwnershipScope') && String(c[0]).includes('MERGE'),
      );
      const params = scopeCalls[0][1] as Record<string, unknown>;
      expect(params.reviewCadenceDays).toBe(30);
    });

    it('respects OWNERSHIP_REVIEW_CADENCE_DAYS env var', async () => {
      process.env.OWNERSHIP_REVIEW_CADENCE_DAYS = '7';
      setupDefaultCodeowners();
      mockSessionRun.mockImplementation((cypher: string) => {
        if (String(cypher).includes('SourceFile')) return { records: [] };
        return { records: [] };
      });
      await runModule();

      const scopeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('OwnershipScope') && String(c[0]).includes('MERGE'),
      );
      const params = scopeCalls[0][1] as Record<string, unknown>;
      expect(params.reviewCadenceDays).toBe(7);
    });
  });

  // ─── B4: computes deterministic SHA IDs ───
  describe('B4: deterministic SHA IDs', () => {
    it('produces ownership-scope:{projectId}:{sha16} format', async () => {
      setupDefaultCodeowners();
      mockSessionRun.mockImplementation((cypher: string) => {
        if (String(cypher).includes('SourceFile')) return { records: [] };
        return { records: [] };
      });
      await runModule();

      const scopeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('OwnershipScope') && String(c[0]).includes('MERGE'),
      );
      const id = String((scopeCalls[0][1] as Record<string, unknown>).id);
      expect(id).toMatch(/^ownership-scope:proj_c0d3e9a1f200:[0-9a-f]{16}$/);

      // Verify determinism
      const expectedHash = crypto.createHash('sha256').update('src/**:1').digest('hex').slice(0, 16);
      expect(id).toBe(`ownership-scope:proj_c0d3e9a1f200:${expectedHash}`);
    });

    it('produces owner:{projectId}:{sha16} for owner nodes', async () => {
      setupDefaultCodeowners();
      mockSessionRun.mockImplementation((cypher: string) => {
        if (String(cypher).includes('SourceFile') && String(cypher).includes('RETURN')) return { records: [] };
        return { records: [] };
      });
      await runModule();

      const ownerCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => {
          const p = c[1] as Record<string, unknown> | undefined;
          return p?.ownerId !== undefined && p?.ownerType !== undefined;
        },
      );
      expect(ownerCalls.length).toBeGreaterThan(0);
      const ownerId = String((ownerCalls[0][1] as Record<string, unknown>).ownerId);
      expect(ownerId).toMatch(/^owner:proj_c0d3e9a1f200:[0-9a-f]{16}$/);
    });
  });

  // ─── B5: cross-references critical paths ───
  describe('B5: cross-references critical paths with isCriticalRelativePath', () => {
    it('counts criticalMatchCount via isCriticalRelativePath for matched files', async () => {
      setupDefaultCodeowners();
      mockMatchesCodeownersPattern.mockReturnValue(true);
      mockIsCriticalRelativePath.mockImplementation((p: string) => p.includes('core'));
      mockToRelative.mockImplementation((_r: string, abs: string) => abs.replace('/repo/', ''));

      const files = setupSourceFiles([
        { id: 'sf1', filePath: '/repo/src/core/main.ts' },
        { id: 'sf2', filePath: '/repo/src/utils/helper.ts' },
      ]);
      mockSessionRun.mockImplementation((cypher: string) => {
        if (String(cypher).includes('SourceFile') && String(cypher).includes('RETURN')) return { records: files };
        return { records: [] };
      });
      await runModule();

      const scopeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('OwnershipScope') && String(c[0]).includes('MERGE'),
      );
      const params = scopeCalls[0][1] as Record<string, unknown>;
      expect(params.criticalMatchCount).toBe(1); // only core/ file
    });
  });

  // ─── B6: uses direct neo4j-driver ───
  describe('B6: uses direct neo4j-driver (not Neo4jService)', () => {
    it('closes session and driver in finally block', async () => {
      setupDefaultCodeowners();
      mockSessionRun.mockImplementation((cypher: string) => {
        if (String(cypher).includes('SourceFile')) return { records: [] };
        return { records: [] };
      });
      await runModule();
      expect(mockSessionClose).toHaveBeenCalled();
      expect(mockDriverClose).toHaveBeenCalled();
    });

    it('cleans prior OwnershipScope and HAS_OWNER before re-syncing', async () => {
      setupDefaultCodeowners();
      mockSessionRun.mockImplementation((cypher: string) => {
        if (String(cypher).includes('SourceFile') && String(cypher).includes('RETURN')) return { records: [] };
        return { records: [] };
      });
      await runModule();

      const deleteCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('DETACH DELETE') || String(c[0]).includes('DELETE r'),
      );
      expect(deleteCalls.length).toBeGreaterThanOrEqual(2); // scope delete + HAS_OWNER delete
    });
  });

  // ─── B7: accepts PROJECT_ID/REPO_ROOT from env ───
  describe('B7: accepts PROJECT_ID and REPO_ROOT from env', () => {
    it('uses custom PROJECT_ID in all queries', async () => {
      process.env.PROJECT_ID = 'proj_own_test';
      setupDefaultCodeowners();
      mockSessionRun.mockImplementation((cypher: string) => {
        if (String(cypher).includes('SourceFile') && String(cypher).includes('RETURN')) return { records: [] };
        return { records: [] };
      });
      await runModule();

      // SourceFile query should use custom project ID
      const sfCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('SourceFile'),
      );
      const params = sfCalls[0][1] as Record<string, unknown>;
      expect(params.projectId).toBe('proj_own_test');
    });

    it('outputs JSON with ok, scopesCreated, ownerNodesTouched, fileAssignments', async () => {
      setupDefaultCodeowners();
      mockMatchesCodeownersPattern.mockReturnValue(false);
      mockSessionRun.mockImplementation((cypher: string) => {
        if (String(cypher).includes('SourceFile') && String(cypher).includes('RETURN')) return { records: [] };
        return { records: [] };
      });
      await runModule();

      const jsonCall = mockLog.mock.calls.find((c) => {
        try { return JSON.parse(String(c[0])).ok !== undefined; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(String(jsonCall![0]));
      expect(parsed.ok).toBe(true);
      expect(typeof parsed.scopesCreated).toBe('number');
      expect(typeof parsed.ownerNodesTouched).toBe('number');
      expect(typeof parsed.fileAssignments).toBe('number');
    });
  });

  // SPEC-GAP: Spec doesn't define backup owner or escalation path defaults
  // SPEC-GAP: Spec doesn't specify that B2 HygieneControl binding is required after ownership sync
});
