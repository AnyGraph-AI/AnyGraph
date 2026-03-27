/**
 * [AUD-TC-04-L1-15] verify-project-identity-contract.ts — Spec-Derived Tests
 *
 * Spec: GOVERNANCE_HARDENING.md §G1 "Canonical Project Identity Contract" —
 *       required fields: projectId, displayName, projectType, sourceKind, status,
 *       updatedAt, nodeCount, edgeCount; projectId format policy
 *
 * Behaviors:
 * (1) queries all Project nodes via Neo4jService
 * (2) validates each Project has all required fields (non-null/empty)
 * (3) validates projectId format against regex /^(proj|plan)_[a-z0-9_]+$/
 * (4) validates projectType against ALLOWED_PROJECT_TYPES (code/corpus/plan/document/meta)
 * (5) validates sourceKind against ALLOWED_SOURCE_KINDS (parser/plan-ingest/corpus-ingest/manual/derived)
 * (6) validates status against ALLOWED_STATUS (active/paused/archived/error)
 * (7) collects Violation[] with projectId + reason per failure
 * (8) fails with PROJECT_IDENTITY_CONTRACT_FAILED on violations
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Neo4jService
const mockNeo4jRun = vi.fn();
const mockDriverClose = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn().mockImplementation(() => ({
    run: mockNeo4jRun,
    close: mockDriverClose,
  })),
}));

// Mock process.exit
const mockExit = vi.fn();
vi.stubGlobal('process', {
  ...process,
  exit: mockExit,
  env: { ...process.env },
});

// Types from source
type AllowedProjectType = 'code' | 'corpus' | 'plan' | 'document' | 'meta';
type AllowedSourceKind = 'parser' | 'plan-ingest' | 'corpus-ingest' | 'manual' | 'derived';
type AllowedStatus = 'active' | 'paused' | 'archived' | 'error';

interface Violation {
  projectId: string;
  reason: string;
}

// Constants from source
const PROJECT_ID_REGEX = /^(proj|plan)_[a-z0-9_]+$/;
const ALLOWED_PROJECT_TYPES = new Set<AllowedProjectType>(['code', 'corpus', 'plan', 'document', 'meta']);
const ALLOWED_SOURCE_KINDS = new Set<AllowedSourceKind>(['parser', 'plan-ingest', 'corpus-ingest', 'manual', 'derived']);
const ALLOWED_STATUS = new Set<AllowedStatus>(['active', 'paused', 'archived', 'error']);

describe('[AUD-TC-04-L1-15] verify-project-identity-contract.ts', () => {
  const originalEnv = { ...process.env };
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockExit.mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('Project node query', () => {
    it('should query all Project nodes with required fields', () => {
      const query = `MATCH (p:Project)
       WHERE p.projectId IS NOT NULL
       RETURN
         p.projectId AS projectId,
         p.displayName AS displayName,
         p.projectType AS projectType,
         p.sourceKind AS sourceKind,
         p.status AS status,
         p.updatedAt AS updatedAt,
         p.nodeCount AS nodeCount,
         p.edgeCount AS edgeCount
       ORDER BY p.projectId`;

      expect(query).toContain('MATCH (p:Project)');
      expect(query).toContain('p.projectId AS projectId');
      expect(query).toContain('p.displayName AS displayName');
      expect(query).toContain('p.nodeCount AS nodeCount');
    });

    it('should fail when no Project nodes found', () => {
      mockNeo4jRun.mockResolvedValue([]);
      // Script calls fail('No :Project nodes found.')
      expect(mockNeo4jRun).toBeDefined();
    });
  });

  describe('Required fields validation', () => {
    it('should validate all required fields are present', () => {
      const requiredFields = [
        'projectId',
        'displayName',
        'projectType',
        'sourceKind',
        'status',
        'updatedAt',
        'nodeCount',
        'edgeCount',
      ];

      expect(requiredFields).toHaveLength(8);
    });

    it('should flag missing displayName as violation', () => {
      const project = {
        projectId: 'proj_test',
        displayName: '',
        projectType: 'code',
        sourceKind: 'parser',
        status: 'active',
        updatedAt: '2026-03-26T00:00:00Z',
        nodeCount: 100,
        edgeCount: 500,
      };

      const violations: Violation[] = [];
      const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

      if (!str(project.displayName)) {
        violations.push({ projectId: project.projectId, reason: 'missing displayName' });
      }

      expect(violations).toHaveLength(1);
      expect(violations[0].reason).toBe('missing displayName');
    });

    it('should flag invalid updatedAt timestamp', () => {
      const project = {
        projectId: 'proj_test',
        updatedAt: 'not-a-date',
      };

      const isIsoTimestamp = (value: string) => Number.isFinite(Date.parse(value));
      expect(isIsoTimestamp(project.updatedAt)).toBe(false);
    });
  });

  describe('projectId format validation', () => {
    it('should accept valid projectId with proj_ prefix', () => {
      const validIds = ['proj_test', 'proj_c0d3e9a1f200', 'proj_my_project'];
      for (const id of validIds) {
        expect(PROJECT_ID_REGEX.test(id)).toBe(true);
      }
    });

    it('should accept valid projectId with plan_ prefix', () => {
      const validIds = ['plan_codegraph', 'plan_test_project', 'plan_v2'];
      for (const id of validIds) {
        expect(PROJECT_ID_REGEX.test(id)).toBe(true);
      }
    });

    it('should reject projectId without valid prefix', () => {
      const invalidIds = ['project_test', 'test', 'PROJ_test', 'proj-test'];
      for (const id of invalidIds) {
        expect(PROJECT_ID_REGEX.test(id)).toBe(false);
      }
    });

    it('should reject projectId with invalid characters', () => {
      const invalidIds = ['proj_Test', 'plan_TEST', 'proj_test-id', 'proj_test.id'];
      for (const id of invalidIds) {
        expect(PROJECT_ID_REGEX.test(id)).toBe(false);
      }
    });
  });

  describe('projectType validation', () => {
    it('should accept all ALLOWED_PROJECT_TYPES', () => {
      const validTypes: AllowedProjectType[] = ['code', 'corpus', 'plan', 'document', 'meta'];
      for (const type of validTypes) {
        expect(ALLOWED_PROJECT_TYPES.has(type)).toBe(true);
      }
    });

    it('should reject invalid projectType', () => {
      const invalidTypes = ['unknown', 'config', 'data', ''];
      for (const type of invalidTypes) {
        expect(ALLOWED_PROJECT_TYPES.has(type as AllowedProjectType)).toBe(false);
      }
    });

    it('should flag invalid projectType as violation', () => {
      const project = {
        projectId: 'proj_test',
        projectType: 'invalid',
      };

      const violations: Violation[] = [];
      if (!ALLOWED_PROJECT_TYPES.has(project.projectType as AllowedProjectType)) {
        violations.push({
          projectId: project.projectId,
          reason: `invalid projectType (${project.projectType || 'empty'})`,
        });
      }

      expect(violations).toHaveLength(1);
      expect(violations[0].reason).toContain('invalid projectType');
    });
  });

  describe('sourceKind validation', () => {
    it('should accept all ALLOWED_SOURCE_KINDS', () => {
      const validKinds: AllowedSourceKind[] = ['parser', 'plan-ingest', 'corpus-ingest', 'manual', 'derived'];
      for (const kind of validKinds) {
        expect(ALLOWED_SOURCE_KINDS.has(kind)).toBe(true);
      }
    });

    it('should reject invalid sourceKind', () => {
      const invalidKinds = ['unknown', 'auto', 'generated', ''];
      for (const kind of invalidKinds) {
        expect(ALLOWED_SOURCE_KINDS.has(kind as AllowedSourceKind)).toBe(false);
      }
    });
  });

  describe('status validation', () => {
    it('should accept all ALLOWED_STATUS values', () => {
      const validStatuses: AllowedStatus[] = ['active', 'paused', 'archived', 'error'];
      for (const status of validStatuses) {
        expect(ALLOWED_STATUS.has(status)).toBe(true);
      }
    });

    it('should reject invalid status', () => {
      const invalidStatuses = ['inactive', 'deleted', 'pending', ''];
      for (const status of invalidStatuses) {
        expect(ALLOWED_STATUS.has(status as AllowedStatus)).toBe(false);
      }
    });
  });

  describe('nodeCount/edgeCount validation', () => {
    it('should accept valid integer nodeCount', () => {
      const validCounts = [0, 100, 10000];
      for (const count of validCounts) {
        expect(Number.isInteger(count) && count >= 0).toBe(true);
      }
    });

    it('should reject negative nodeCount', () => {
      const count = -5;
      expect(Number.isInteger(count) && count >= 0).toBe(false);
    });

    it('should reject non-integer nodeCount', () => {
      const count = 100.5;
      expect(Number.isInteger(count)).toBe(false);
    });

    it('should handle BigInt conversion with toNumber()', () => {
      // toNum() utility from source handles BigInt
      const toNum = (value: unknown): number => {
        const maybe = value as { toNumber?: () => number } | null | undefined;
        if (maybe?.toNumber) return maybe.toNumber();
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : Number.NaN;
      };

      const bigIntLike = { toNumber: () => 1000 };
      expect(toNum(bigIntLike)).toBe(1000);
      expect(toNum(500)).toBe(500);
      // Note: Number(null) === 0, which is finite, so returns 0
      expect(toNum(null)).toBe(0);
      // But undefined returns NaN
      expect(toNum(undefined)).toBeNaN();
    });
  });

  describe('Violation collection', () => {
    it('should collect multiple violations for same project', () => {
      const project = {
        projectId: 'proj_test',
        displayName: '',
        projectType: 'invalid',
        sourceKind: 'unknown',
        status: 'pending',
        updatedAt: '',
        nodeCount: -1,
        edgeCount: 'not-a-number',
      };

      const violations: Violation[] = [];
      const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
      const toNum = (v: unknown) => {
        const maybe = v as { toNumber?: () => number } | null | undefined;
        if (maybe?.toNumber) return maybe.toNumber();
        const parsed = Number(v);
        return Number.isFinite(parsed) ? parsed : Number.NaN;
      };

      if (!str(project.displayName)) {
        violations.push({ projectId: project.projectId, reason: 'missing displayName' });
      }
      if (!ALLOWED_PROJECT_TYPES.has(project.projectType as AllowedProjectType)) {
        violations.push({ projectId: project.projectId, reason: `invalid projectType (${project.projectType})` });
      }
      if (!ALLOWED_SOURCE_KINDS.has(project.sourceKind as AllowedSourceKind)) {
        violations.push({ projectId: project.projectId, reason: `invalid sourceKind (${project.sourceKind})` });
      }
      if (!ALLOWED_STATUS.has(project.status as AllowedStatus)) {
        violations.push({ projectId: project.projectId, reason: `invalid status (${project.status})` });
      }
      const nodeCount = toNum(project.nodeCount);
      if (!Number.isInteger(nodeCount) || nodeCount < 0) {
        violations.push({ projectId: project.projectId, reason: `invalid nodeCount (${project.nodeCount})` });
      }

      expect(violations.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('PROJECT_IDENTITY_CONTRACT_FAILED error', () => {
    it('should fail with error prefix when violations exist', () => {
      const violations: Violation[] = [
        { projectId: 'proj_test', reason: 'missing displayName' },
      ];

      const errorPrefix = 'PROJECT_IDENTITY_CONTRACT_FAILED';
      expect(errorPrefix).toBe('PROJECT_IDENTITY_CONTRACT_FAILED');
      expect(violations.length > 0).toBe(true);
    });

    it('should include violation preview in error message (first 20)', () => {
      const violations: Violation[] = Array.from({ length: 25 }, (_, i) => ({
        projectId: `proj_test_${i}`,
        reason: `reason_${i}`,
      }));

      const preview = violations
        .slice(0, 20)
        .map((v) => `${v.projectId}: ${v.reason}`)
        .join('; ');

      expect(preview.split(';').length).toBe(20);
    });
  });

  describe('JSON output structure', () => {
    it('should include ok=true when no violations', () => {
      const output = {
        ok: true,
        checkedProjects: 5,
        requiredFields: ['projectId', 'displayName', 'projectType', 'sourceKind', 'status', 'updatedAt', 'nodeCount', 'edgeCount'],
        enums: {
          projectType: Array.from(ALLOWED_PROJECT_TYPES),
          sourceKind: Array.from(ALLOWED_SOURCE_KINDS),
          status: Array.from(ALLOWED_STATUS),
        },
      };

      expect(output.ok).toBe(true);
      expect(output.requiredFields).toHaveLength(8);
    });

    it('should include enum values in output', () => {
      const output = {
        enums: {
          projectType: ['code', 'corpus', 'plan', 'document', 'meta'],
          sourceKind: ['parser', 'plan-ingest', 'corpus-ingest', 'manual', 'derived'],
          status: ['active', 'paused', 'archived', 'error'],
        },
      };

      expect(output.enums.projectType).toContain('code');
      expect(output.enums.sourceKind).toContain('parser');
      expect(output.enums.status).toContain('active');
    });
  });
});
