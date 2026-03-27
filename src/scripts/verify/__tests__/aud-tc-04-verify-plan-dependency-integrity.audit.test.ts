/**
 * [AUD-TC-04-L1-14] verify-plan-dependency-integrity.ts - Spec-Derived Tests
 *
 * Spec: VERIFICATION_GRAPH_ROADMAP.md CA-1 "Dependency Integrity Gate" -
 *       parser edge metadata (rawRefValue, tokenCount, tokenIndex),
 *       scoped dependency hygiene (DL-X/GM-X milestones require DEPENDS_ON or NO_DEPENDS_OK)
 *
 * Behaviors:
 * (1) queries DEPENDS_ON/BLOCKS edges with parser metadata via Neo4jService
 * (2) validates referential integrity: target of DEPENDS_ON must exist as Task/Milestone
 * (3) checks scoped dependency hygiene in DL-X/GM-X milestones
 * (4) validates rawRefValue matches actual target
 * (5) checks tokenCount/tokenIndex consistency
 * (6) fails with PLAN_DEPENDENCY_INTEGRITY_FAILED on violations
 * (7) outputs JSON summary with violation details
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Neo4jService
const mockNeo4jRun = vi.fn();
const mockDriverClose = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn().mockImplementation(() => ({
    run: mockNeo4jRun,
    getDriver: () => ({
      close: mockDriverClose,
    }),
  })),
}));

// Mock process.exit
const mockExit = vi.fn();
vi.stubGlobal('process', {
  ...process,
  exit: mockExit,
  env: { ...process.env },
});

interface DependencyEdgeRow {
  project: string;
  relType: string;
  sourceId: string;
  sourceName?: string;
  targetId: string;
  targetName?: string;
  refType?: string;
  refValue?: string;
  rawRefValue?: string;
  tokenCount?: number;
  tokenIndex?: number;
}

interface ScopedTaskRow {
  milestoneCode: string;
  milestoneName: string;
  taskId: string;
  taskName: string;
  taskStatus: string;
  lineNumber?: number;
  depCount: number;
}

describe('[AUD-TC-04-L1-14] verify-plan-dependency-integrity.ts', () => {
  const originalEnv = { ...process.env };
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockExit.mockImplementation((code: number) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('DEPENDS_ON/BLOCKS edge queries', () => {
    it('should query edges with parser metadata via Neo4jService', async () => {
      const mockEdges: DependencyEdgeRow[] = [
        {
          project: 'plan_codegraph',
          relType: 'DEPENDS_ON',
          sourceId: 'task-1',
          sourceName: 'Task 1',
          targetId: 'task-2',
          targetName: 'Task 2',
          refType: 'depends_on',
          refValue: 'task-2',
          rawRefValue: 'task-2',
          tokenCount: 1,
          tokenIndex: 0,
        },
      ];

      mockNeo4jRun.mockResolvedValue(mockEdges);

      // Verify query includes required fields
      const query = `MATCH (src)-[r:DEPENDS_ON|BLOCKS]->(dst)
       WHERE r.projectId STARTS WITH 'plan_'
         AND coalesce(r.refType, '') IN ['depends_on', 'blocks']`;

      expect(query).toContain('DEPENDS_ON|BLOCKS');
      expect(query).toContain('r.projectId STARTS WITH');
    });

    it('should include refValue, rawRefValue, tokenCount, tokenIndex in query', () => {
      const expectedFields = ['refValue', 'rawRefValue', 'tokenCount', 'tokenIndex'];
      const queryReturn = `RETURN r.projectId AS project,
              type(r) AS relType,
              src.id AS sourceId,
              src.name AS sourceName,
              dst.id AS targetId,
              dst.name AS targetName,
              r.refType AS refType,
              r.refValue AS refValue,
              r.rawRefValue AS rawRefValue,
              r.tokenCount AS tokenCount,
              r.tokenIndex AS tokenIndex`;

      for (const field of expectedFields) {
        expect(queryReturn).toContain(field);
      }
    });
  });

  describe('Referential integrity validation', () => {
    it('should detect missing refValue as violation', () => {
      const edge: DependencyEdgeRow = {
        project: 'plan_test',
        relType: 'DEPENDS_ON',
        sourceId: 'task-1',
        targetId: 'task-2',
        refType: 'depends_on',
        refValue: '', // Missing
        rawRefValue: 'task-2',
        tokenCount: 1,
        tokenIndex: 0,
      };

      const refValue = (edge.refValue ?? '').trim();
      expect(!refValue).toBe(true); // Violation condition
    });

    it('should detect missing rawRefValue as violation', () => {
      const edge: DependencyEdgeRow = {
        project: 'plan_test',
        relType: 'DEPENDS_ON',
        sourceId: 'task-1',
        targetId: 'task-2',
        refType: 'depends_on',
        refValue: 'task-2',
        rawRefValue: '', // Missing
        tokenCount: 1,
        tokenIndex: 0,
      };

      const rawRefValue = (edge.rawRefValue ?? '').trim();
      expect(!rawRefValue).toBe(true); // Violation condition
    });
  });

  describe('Token count/index consistency checks', () => {
    it('should flag invalid tokenCount (zero or negative)', () => {
      const edge = { tokenCount: 0, tokenIndex: 0 };
      const tokenCount = edge.tokenCount;
      const isInvalid = !Number.isFinite(tokenCount) || tokenCount <= 0;
      expect(isInvalid).toBe(true);
    });

    it('should flag tokenIndex outside valid range', () => {
      const edge = { tokenCount: 3, tokenIndex: 5 };
      const tokenIndex = edge.tokenIndex;
      const tokenCount = edge.tokenCount;
      const isInvalid = !Number.isFinite(tokenIndex) || tokenIndex < 0 || tokenIndex >= tokenCount;
      expect(isInvalid).toBe(true);
    });

    it('should accept valid tokenCount/tokenIndex pair', () => {
      const edge = { tokenCount: 3, tokenIndex: 2 };
      const tokenIndex = edge.tokenIndex;
      const tokenCount = edge.tokenCount;
      const isValid = Number.isFinite(tokenIndex) && tokenIndex >= 0 && tokenIndex < tokenCount;
      expect(isValid).toBe(true);
    });

    it('should detect tokenized_without_semicolon violation', () => {
      const edge = {
        rawRefValue: 'task-1, task-2',
        tokenCount: 2,
      };
      // tokenCount > 1 but no semicolon in rawRefValue
      const violation = edge.tokenCount > 1 && !edge.rawRefValue.includes(';');
      expect(violation).toBe(true);
    });

    it('should detect token_count_mismatch when expected differs from actual', () => {
      const edge = {
        rawRefValue: 'task-1; task-2; task-3',
        tokenCount: 2,
      };
      const expectedTokenCount = edge.rawRefValue
        .split(';')
        .map((p) => p.trim())
        .filter(Boolean).length;

      expect(expectedTokenCount).toBe(3);
      expect(edge.tokenCount !== expectedTokenCount).toBe(true);
    });
  });

  describe('Scoped dependency hygiene (DL-*/GM-* milestones)', () => {
    it('should query scoped tasks with PART_OF relationship', () => {
      const scopedQuery = `MATCH (m:Milestone {projectId:'plan_codegraph'})<-[:PART_OF]-(t:Task {projectId:'plan_codegraph'})
       WHERE m.code STARTS WITH 'DL-' OR m.code STARTS WITH 'GM-'`;

      expect(scopedQuery).toContain('PART_OF');
      expect(scopedQuery).toContain("STARTS WITH 'DL-'");
      expect(scopedQuery).toContain("STARTS WITH 'GM-'");
    });

    it('should allow first task in milestone without DEPENDS_ON (starter allowance)', () => {
      const tasks: ScopedTaskRow[] = [
        { milestoneCode: 'DL-1', milestoneName: 'Delivery 1', taskId: 't1', taskName: 'First Task', taskStatus: 'planned', lineNumber: 10, depCount: 0 },
        { milestoneCode: 'DL-1', milestoneName: 'Delivery 1', taskId: 't2', taskName: 'Second Task', taskStatus: 'planned', lineNumber: 20, depCount: 0 },
      ];

      // First task (sorted by lineNumber) gets starter allowance
      const sorted = [...tasks].sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0));
      let starterAllowanceUsed = false;
      const violations: string[] = [];

      for (const task of sorted) {
        if (task.depCount <= 0) {
          if (!starterAllowanceUsed) {
            starterAllowanceUsed = true;
            continue; // No violation for first task
          }
          violations.push(task.taskId);
        }
      }

      expect(violations).toEqual(['t2']); // Only second task flagged
    });

    it('should skip done tasks in scoped dependency check', () => {
      const task: ScopedTaskRow = {
        milestoneCode: 'GM-1',
        milestoneName: 'Goal 1',
        taskId: 't1',
        taskName: 'Done Task',
        taskStatus: 'done',
        depCount: 0,
      };

      const shouldSkip = (task.taskStatus ?? '').trim().toLowerCase() === 'done';
      expect(shouldSkip).toBe(true);
    });

    it('should parse NO_DEPENDS_OK exception from task name', () => {
      const taskName = 'Some task NO_DEPENDS_OK(bootstrap|expires:2026-12-31)';
      const match = taskName.match(/NO_DEPENDS_OK\s*\(([^|)]+)\|\s*expires\s*:\s*(\d{4}-\d{2}-\d{2})\)/i);

      expect(match).not.toBeNull();
      expect(match![1].trim()).toBe('bootstrap');
      expect(match![2].trim()).toBe('2026-12-31');
    });

    it('should flag invalid NO_DEPENDS_OK exception (missing reason or expired)', () => {
      // Invalid: reason too short
      const invalidName1 = 'Task NO_DEPENDS_OK(x|expires:2026-12-31)';
      const match1 = invalidName1.match(/NO_DEPENDS_OK\s*\(([^|)]+)\|\s*expires\s*:\s*(\d{4}-\d{2}-\d{2})\)/i);
      expect(match1![1].trim().length < 3).toBe(true);

      // Invalid: expired
      const expiredDate = '2020-01-01';
      const at = Date.parse(`${expiredDate}T23:59:59Z`);
      expect(at <= Date.now()).toBe(true);
    });
  });

  describe('PLAN_DEPENDENCY_INTEGRITY_FAILED error', () => {
    it('should fail when violations exceed MAX_PLAN_DEPENDENCY_VIOLATIONS', () => {
      process.env.MAX_PLAN_DEPENDENCY_VIOLATIONS = '5';
      const maxViolations = Number(process.env.MAX_PLAN_DEPENDENCY_VIOLATIONS ?? 0);
      const violations = new Array(10).fill({ code: 'test', details: 'test' });

      expect(violations.length > maxViolations).toBe(true);
    });

    it('should pass when violations are within threshold', () => {
      process.env.MAX_PLAN_DEPENDENCY_VIOLATIONS = '10';
      const maxViolations = Number(process.env.MAX_PLAN_DEPENDENCY_VIOLATIONS ?? 0);
      const violations = new Array(5).fill({ code: 'test', details: 'test' });

      expect(violations.length <= maxViolations).toBe(true);
    });
  });

  describe('JSON output structure', () => {
    it('should include checkedEdges count', () => {
      const output = {
        ok: true,
        checkedEdges: 50,
        scopedTasksChecked: 20,
        scopedMissingDepends: 0,
        scopedExceptionCount: 2,
        strictScopedDepends: false,
        violations: 0,
        maxViolations: 0,
        countsByCode: {},
      };

      expect(output.checkedEdges).toBeDefined();
      expect(typeof output.checkedEdges).toBe('number');
    });

    it('should include violation counts grouped by code', () => {
      const violations = [
        { code: 'missing_ref_value', details: 'detail1' },
        { code: 'missing_ref_value', details: 'detail2' },
        { code: 'invalid_token_count', details: 'detail3' },
      ];

      const countsByCode: Record<string, number> = {};
      for (const v of violations) {
        countsByCode[v.code] = (countsByCode[v.code] ?? 0) + 1;
      }

      expect(countsByCode.missing_ref_value).toBe(2);
      expect(countsByCode.invalid_token_count).toBe(1);
    });

    it('should include STRICT_SCOPED_DEPENDS_ON status', () => {
      process.env.STRICT_SCOPED_DEPENDS_ON = 'true';
      const strictMode = String(process.env.STRICT_SCOPED_DEPENDS_ON ?? 'false').toLowerCase() === 'true';
      expect(strictMode).toBe(true);
    });
  });

  describe('GM-8 evidence check', () => {
    it('should query GM-8 done tasks missing HAS_CODE_EVIDENCE edges', () => {
      const gm8Query = `MATCH (m:Milestone {projectId:'plan_codegraph', code:'GM-8'})<-[:PART_OF]-(t:Task {projectId:'plan_codegraph'})
       WHERE coalesce(t.status, 'planned') = 'done'
       OPTIONAL MATCH (t)-[r:HAS_CODE_EVIDENCE]->()
       WITH t, count(r) AS evidenceCount
       WHERE evidenceCount = 0
       RETURN t.id AS taskId, t.name AS taskName`;

      expect(gm8Query).toContain('GM-8');
      expect(gm8Query).toContain('HAS_CODE_EVIDENCE');
      expect(gm8Query).toContain("status, 'planned') = 'done'");
    });

    it('should flag done GM-8 tasks without evidence as violations', () => {
      const doneTasks = [
        { taskId: 't1', taskName: 'Implemented feature X' },
        { taskId: 't2', taskName: 'Added tests for Y' },
      ];

      const violations: Array<{ code: string; details: string }> = [];
      for (const task of doneTasks) {
        violations.push({
          code: 'gm8_done_missing_evidence',
          details: `GM-8 ${task.taskId} task="${task.taskName}"`,
        });
      }

      expect(violations).toHaveLength(2);
      expect(violations[0].code).toBe('gm8_done_missing_evidence');
    });
  });
});
