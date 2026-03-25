/**
 * AUD-TC-11c-L1-01: self-audit.ts — Behavioral Audit Tests
 *
 * Spec source: MEMORY.md §"Self-audit proven: false positives 37% → ~0%"
 *              plans/codegraph/TODO_BUCKET.md §TODO-2 Evidence Linker Robustness
 *
 * The self-audit engine queries the graph for drift items (tasks with code evidence
 * but checkbox unchecked), builds audit questions, applies agent verdicts, and
 * updates plan files. Tests assert 11 spec-derived behaviors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Neo4j mock (module-level) ──────────────────────────────────────────────

const mockRun = vi.fn();
const mockSessionClose = vi.fn();
const mockDriverClose = vi.fn();

vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(() => ({
      session: vi.fn(() => ({ run: mockRun, close: mockSessionClose })),
      close: mockDriverClose,
    })),
    auth: { basic: vi.fn() },
  },
}));

import {
  SelfAuditEngine,
  type DriftItem,
  type AuditQuestion,
  type AuditVerdictRecord,
  type AuditReport,
  type AuditVerdict,
} from '../../../core/claims/self-audit.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeDriftItem(overrides: Partial<DriftItem> = {}): DriftItem {
  return {
    taskId: 'task_001',
    taskName: 'Implement parser for TypeScript AST',
    taskStatus: 'in_progress',
    projectName: 'codegraph',
    planProjectId: 'plan_codegraph',
    codeProjectId: 'proj_c0d3e9a1f200',
    matchedFunctions: [
      {
        name: 'parseTypeScript',
        filePath: '/home/user/codegraph/src/parsers/ts-parser.ts',
        refType: 'semantic_keyword',
        keyword: 'parser',
      },
    ],
    ...overrides,
  };
}

function makeNeo4jRecord(fields: Record<string, unknown>) {
  return {
    get: (key: string) => fields[key],
  };
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'self-audit-'));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AUD-TC-11c | self-audit.ts', () => {
  let engine: SelfAuditEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new SelfAuditEngine();
  });

  afterEach(async () => {
    await engine.close();
  });

  // ── Behavior 1: getDriftItems returns DriftItem[] from Neo4j ──────────

  describe('Behavior 1: getDriftItems returns DriftItem[] from Neo4j — tasks with HAS_CODE_EVIDENCE but status≠done', () => {
    it('returns mapped DriftItem array from Neo4j query results', async () => {
      mockRun.mockResolvedValueOnce({
        records: [
          makeNeo4jRecord({
            taskId: 'task_001',
            taskName: 'Add parser',
            taskStatus: 'in_progress',
            projectName: 'codegraph',
            planPid: 'plan_cg',
            codePid: 'proj_abc',
            funcs: [{ name: 'parse', filePath: '/src/parse.ts', refType: 'explicit_ref', keyword: null }],
          }),
        ],
      });

      const items = await engine.getDriftItems();

      expect(items).toHaveLength(1);
      expect(items[0].taskId).toBe('task_001');
      expect(items[0].taskName).toBe('Add parser');
      expect(items[0].taskStatus).toBe('in_progress');
      expect(items[0].projectName).toBe('codegraph');
      expect(items[0].planProjectId).toBe('plan_cg');
      expect(items[0].codeProjectId).toBe('proj_abc');
      expect(items[0].matchedFunctions).toEqual([
        { name: 'parse', filePath: '/src/parse.ts', refType: 'explicit_ref', keyword: null },
      ]);
    });

    it('filters by planProjectId when provided', async () => {
      mockRun.mockResolvedValueOnce({ records: [] });

      await engine.getDriftItems('plan_codegraph');

      const query = mockRun.mock.calls[0][0] as string;
      expect(query).toContain('t.projectId = $planProjectId');
      expect(mockRun.mock.calls[0][1]).toEqual({ planProjectId: 'plan_codegraph' });
    });

    it('omits projectId filter when no planProjectId given', async () => {
      mockRun.mockResolvedValueOnce({ records: [] });

      await engine.getDriftItems();

      const query = mockRun.mock.calls[0][0] as string;
      expect(query).not.toContain('$planProjectId');
    });

    it('always closes the Neo4j session', async () => {
      mockRun.mockRejectedValueOnce(new Error('Neo4j down'));

      await expect(engine.getDriftItems()).rejects.toThrow('Neo4j down');
      expect(mockSessionClose).toHaveBeenCalled();
    });
  });

  // ── Behavior 2: DriftItem shape ───────────────────────────────────────

  describe('Behavior 2: DriftItem contains taskId/taskName/taskStatus/projectName/planProjectId/codeProjectId/matchedFunctions', () => {
    it('matchedFunctions entries have name, filePath, refType, keyword fields', async () => {
      mockRun.mockResolvedValueOnce({
        records: [
          makeNeo4jRecord({
            taskId: 't1',
            taskName: 'Test',
            taskStatus: 'planned',
            projectName: 'proj',
            planPid: 'pp1',
            codePid: 'cp1',
            funcs: [
              { name: 'fn1', filePath: '/a.ts', refType: 'semantic_keyword', keyword: 'test' },
              { name: 'fn2', filePath: '/b.ts', refType: 'explicit_ref', keyword: undefined },
            ],
          }),
        ],
      });

      const items = await engine.getDriftItems();
      const funcs = items[0].matchedFunctions;

      expect(funcs).toHaveLength(2);
      expect(funcs[0]).toHaveProperty('name', 'fn1');
      expect(funcs[0]).toHaveProperty('filePath', '/a.ts');
      expect(funcs[0]).toHaveProperty('refType', 'semantic_keyword');
      expect(funcs[0]).toHaveProperty('keyword', 'test');
      expect(funcs[1]).toHaveProperty('refType', 'explicit_ref');
    });
  });

  // ── Behavior 3: buildAuditQuestions transforms DriftItem[] → AuditQuestion[] ──

  describe('Behavior 3: buildAuditQuestions transforms DriftItem[] into AuditQuestion[] with question, filesToRead, context', () => {
    it('produces one AuditQuestion per DriftItem', () => {
      const items = [makeDriftItem(), makeDriftItem({ taskId: 'task_002', taskName: 'Second task' })];
      const questions = engine.buildAuditQuestions(items);

      expect(questions).toHaveLength(2);
    });

    it('question is human-readable and references task name', () => {
      const questions = engine.buildAuditQuestions([makeDriftItem()]);

      expect(questions[0].question).toContain('Implement parser for TypeScript AST');
      expect(typeof questions[0].question).toBe('string');
      expect(questions[0].question.length).toBeGreaterThan(10);
    });

    it('filesToRead contains unique absolute paths from matchedFunctions', () => {
      const item = makeDriftItem({
        matchedFunctions: [
          { name: 'fn1', filePath: '/src/a.ts', refType: 'explicit_ref' },
          { name: 'fn2', filePath: '/src/b.ts', refType: 'semantic_keyword' },
          { name: 'fn3', filePath: '/src/a.ts', refType: 'explicit_ref' }, // duplicate
        ],
      });
      const questions = engine.buildAuditQuestions([item]);

      expect(questions[0].filesToRead).toEqual(['/src/a.ts', '/src/b.ts']);
    });

    it('context includes project name, task name, status, function list, and verdict options', () => {
      const questions = engine.buildAuditQuestions([makeDriftItem()]);
      const ctx = questions[0].context;

      expect(ctx).toContain('codegraph');
      expect(ctx).toContain('Implement parser for TypeScript AST');
      expect(ctx).toContain('in_progress');
      expect(ctx).toContain('parseTypeScript');
      expect(ctx).toContain('CONFIRMED');
      expect(ctx).toContain('FALSE_POSITIVE');
      expect(ctx).toContain('PARTIAL');
    });

    it('retains driftItem reference in each question', () => {
      const item = makeDriftItem();
      const questions = engine.buildAuditQuestions([item]);

      expect(questions[0].driftItem).toBe(item);
    });
  });

  // ── Behavior 4: applyVerdict writes verdicts back to Neo4j as Claims ──

  describe('Behavior 4: applyVerdict writes AuditVerdictRecord to Neo4j as Claim nodes with evidence', () => {
    it('CONFIRMED verdict creates Claim node and sets task status to done', async () => {
      mockRun.mockResolvedValueOnce({ records: [] });

      await engine.applyVerdict({
        taskId: 'task_001',
        verdict: 'CONFIRMED',
        confidence: 0.95,
        reasoning: 'Code implements the parser',
        implementedBy: ['parseTypeScript'],
      });

      expect(mockRun).toHaveBeenCalledOnce();
      const query = mockRun.mock.calls[0][0] as string;
      expect(query).toContain("t.status = 'done'");
      expect(query).toContain("auditVerdict = 'CONFIRMED'");
      expect(query).toContain('Claim');
      expect(query).toContain('SUPPORTED_BY');
    });

    it('CONFIRMED verdict passes confidence to Claim', async () => {
      mockRun.mockResolvedValueOnce({ records: [] });

      await engine.applyVerdict({
        taskId: 'task_x',
        verdict: 'CONFIRMED',
        confidence: 0.88,
        reasoning: 'matches',
      });

      const params = mockRun.mock.calls[0][1];
      expect(params.confidence).toBe(0.88);
      expect(params.taskId).toBe('task_x');
    });
  });

  // ── Behavior 5: AuditVerdict is union: CONFIRMED | FALSE_POSITIVE | PARTIAL ──

  describe('Behavior 5: AuditVerdict is union type CONFIRMED | FALSE_POSITIVE | PARTIAL', () => {
    it('all three verdict types are accepted by the type system', () => {
      const verdicts: AuditVerdict[] = ['CONFIRMED', 'FALSE_POSITIVE', 'PARTIAL'];
      expect(verdicts).toHaveLength(3);
      expect(verdicts).toContain('CONFIRMED');
      expect(verdicts).toContain('FALSE_POSITIVE');
      expect(verdicts).toContain('PARTIAL');
    });
  });

  // ── Behavior 6: CONFIRMED creates Claim with claimType audit_verification ──

  describe('Behavior 6: CONFIRMED verdict creates Claim with audit verification type and confidence', () => {
    it('query references audit_verification claimType', async () => {
      mockRun.mockResolvedValueOnce({ records: [] });

      await engine.applyVerdict({
        taskId: 'task_002',
        verdict: 'CONFIRMED',
        confidence: 0.92,
        reasoning: 'Fully implemented',
      });

      const query = mockRun.mock.calls[0][0] as string;
      expect(query).toContain('audit_verification');
      expect(query).toContain('supported');
    });
  });

  // ── Behavior 7: FALSE_POSITIVE removes/downgrades HAS_CODE_EVIDENCE ──

  describe('Behavior 7: FALSE_POSITIVE verdict removes bad HAS_CODE_EVIDENCE edges', () => {
    it('deletes semantic_keyword evidence edges and resets hasCodeEvidence', async () => {
      mockRun.mockResolvedValueOnce({ records: [] });

      await engine.applyVerdict({
        taskId: 'task_003',
        verdict: 'FALSE_POSITIVE',
        confidence: 0.85,
        reasoning: 'Keyword collision, not implementation',
      });

      const query = mockRun.mock.calls[0][0] as string;
      expect(query).toContain('DELETE r');
      expect(query).toContain('semantic_keyword');
      expect(query).toContain('hasCodeEvidence = false');
      expect(query).toContain("auditVerdict = 'FALSE_POSITIVE'");
    });
  });

  // ── Behavior 8: PARTIAL creates Claim with missingParts metadata ──

  describe('Behavior 8: PARTIAL verdict stores missing parts metadata', () => {
    it('writes auditMissing as semicolon-joined string', async () => {
      mockRun.mockResolvedValueOnce({ records: [] });

      await engine.applyVerdict({
        taskId: 'task_004',
        verdict: 'PARTIAL',
        confidence: 0.6,
        reasoning: 'Only half done',
        missingParts: ['error handling', 'retry logic'],
      });

      const query = mockRun.mock.calls[0][0] as string;
      expect(query).toContain("auditVerdict = 'PARTIAL'");
      expect(query).toContain('auditMissing');

      const params = mockRun.mock.calls[0][1];
      expect(params.missing).toBe('error handling; retry logic');
      expect(params.confidence).toBe(0.6);
    });
  });

  // ── Behavior 9: updatePlanFiles checks boxes for CONFIRMED verdicts ──

  describe('Behavior 9: updatePlanFiles modifies plan markdown — checks boxes for CONFIRMED', () => {
    it('replaces "- [ ]" with "- [x]" for CONFIRMED task name in plan file', async () => {
      const tmpDir = makeTempDir();
      try {
        const planContent = `# Plan\n\n- [ ] Implement parser for TypeScript AST\n- [ ] Other task\n`;
        fs.writeFileSync(path.join(tmpDir, 'PLAN.md'), planContent);

        mockRun.mockResolvedValueOnce({
          records: [
            makeNeo4jRecord({
              file: 'PLAN.md',
              line: 3,
              name: 'Implement parser for TypeScript AST',
            }),
          ],
        });

        const updated = await engine.updatePlanFiles(
          [{
            taskId: 'task_001',
            verdict: 'CONFIRMED',
            confidence: 0.95,
            reasoning: 'Done',
          }],
          tmpDir,
        );

        expect(updated).toHaveLength(1);
        expect(updated[0]).toContain('Implement parser for TypeScript AST');

        const result = fs.readFileSync(path.join(tmpDir, 'PLAN.md'), 'utf-8');
        expect(result).toContain('- [x] Implement parser for TypeScript AST');
        expect(result).toContain('- [ ] Other task'); // unchanged
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('skips non-CONFIRMED verdicts', async () => {
      const tmpDir = makeTempDir();
      try {
        const updated = await engine.updatePlanFiles(
          [{
            taskId: 'task_002',
            verdict: 'FALSE_POSITIVE',
            confidence: 0.9,
            reasoning: 'Not real',
          }],
          tmpDir,
        );

        expect(updated).toHaveLength(0);
        expect(mockRun).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('skips when source file not found on disk', async () => {
      const tmpDir = makeTempDir();
      try {
        mockRun.mockResolvedValueOnce({
          records: [
            makeNeo4jRecord({
              file: 'NONEXISTENT.md',
              line: 1,
              name: 'Ghost task',
            }),
          ],
        });

        const updated = await engine.updatePlanFiles(
          [{ taskId: 'task_x', verdict: 'CONFIRMED', confidence: 0.9, reasoning: 'ok' }],
          tmpDir,
        );

        expect(updated).toHaveLength(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // ── Behavior 10: project-aware noise filtering via planProjectId↔codeProjectId ──

  describe('Behavior 10: project-aware noise filtering uses planProjectId↔codeProjectId mapping', () => {
    it('getDriftItems query joins PlanProject to get linked code project', async () => {
      mockRun.mockResolvedValueOnce({ records: [] });

      await engine.getDriftItems();

      const query = mockRun.mock.calls[0][0] as string;
      expect(query).toContain('PlanProject');
      expect(query).toContain('linkedCodeProject');
      expect(query).toContain('t.projectId');
    });

    it('buildAuditQuestions context warns about cross-project false matches', () => {
      const item = makeDriftItem({ projectName: 'codegraph' });
      const questions = engine.buildAuditQuestions([item]);
      const ctx = questions[0].context;

      // Spec: "project-aware noise filtering: uses planProjectId↔codeProjectId mapping
      // to avoid cross-project false matches"
      // The context includes project identity and warns about keyword collisions
      expect(ctx).toContain('THIS PROJECT');
      expect(ctx).toContain('codegraph');
    });
  });

  // ── Behavior 11: generateReport produces AuditReport summary ──────────

  describe('Behavior 11: generateReport produces AuditReport with correct counts', () => {
    it('tallies confirmed, falsePositive, partial from verdicts array', () => {
      const verdicts: AuditVerdictRecord[] = [
        { taskId: 't1', verdict: 'CONFIRMED', confidence: 0.9, reasoning: 'yes' },
        { taskId: 't2', verdict: 'FALSE_POSITIVE', confidence: 0.8, reasoning: 'no' },
        { taskId: 't3', verdict: 'CONFIRMED', confidence: 0.95, reasoning: 'yes' },
        { taskId: 't4', verdict: 'PARTIAL', confidence: 0.5, reasoning: 'half', missingParts: ['x'] },
      ];

      const report = engine.generateReport('codegraph', verdicts);

      expect(report.projectName).toBe('codegraph');
      expect(report.totalDrift).toBe(4);
      expect(report.confirmed).toBe(2);
      expect(report.falsePositive).toBe(1);
      expect(report.partial).toBe(1);
      expect(report.verdicts).toBe(verdicts);
      expect(report.timestamp).toBeTruthy();
      // Verify timestamp is ISO format
      expect(() => new Date(report.timestamp)).not.toThrow();
      expect(new Date(report.timestamp).toISOString()).toBe(report.timestamp);
    });

    it('handles empty verdicts array', () => {
      const report = engine.generateReport('empty-project', []);

      expect(report.totalDrift).toBe(0);
      expect(report.confirmed).toBe(0);
      expect(report.falsePositive).toBe(0);
      expect(report.partial).toBe(0);
    });
  });

  // ── Constructor / close lifecycle ─────────────────────────────────────

  describe('Lifecycle: constructor creates driver, close() closes it', () => {
    it('close() delegates to driver.close()', async () => {
      const eng = new SelfAuditEngine();
      await eng.close();

      expect(mockDriverClose).toHaveBeenCalled();
    });
  });

  // ── generateAgentPrompts groups by project ────────────────────────────

  describe('generateAgentPrompts groups audit questions by project', () => {
    it('returns questions and batchPrompt with project grouping', async () => {
      mockRun.mockResolvedValueOnce({
        records: [
          makeNeo4jRecord({
            taskId: 't1', taskName: 'Task A', taskStatus: 'planned',
            projectName: 'projA', planPid: 'pp1', codePid: 'cp1',
            funcs: [{ name: 'fn1', filePath: '/a.ts', refType: 'explicit_ref', keyword: null }],
          }),
          makeNeo4jRecord({
            taskId: 't2', taskName: 'Task B', taskStatus: 'in_progress',
            projectName: 'projB', planPid: 'pp2', codePid: 'cp2',
            funcs: [{ name: 'fn2', filePath: '/b.ts', refType: 'semantic_keyword', keyword: 'test' }],
          }),
        ],
      });

      const result = await engine.generateAgentPrompts();

      expect(result.questions).toHaveLength(2);
      expect(result.batchPrompt).toContain('projA');
      expect(result.batchPrompt).toContain('projB');
      expect(result.batchPrompt).toContain('2 drift items');
      expect(result.batchPrompt).toContain('2 projects');
    });
  });

  // ── getAuditSummary returns per-project stats ─────────────────────────

  describe('getAuditSummary returns per-project audit statistics', () => {
    it('aggregates drift/audited/confirmed/falsePositive/partial per project', async () => {
      // First call: getAuditSummary's own query
      mockRun.mockResolvedValueOnce({
        records: [
          makeNeo4jRecord({
            project: 'codegraph',
            drift: { toNumber: () => 5 },
            audited: { toNumber: () => 3 },
            confirmed: { toNumber: () => 2 },
            falsePositive: { toNumber: () => 1 },
            partial: { toNumber: () => 0 },
          }),
        ],
      });
      // Second call: getDriftItems inside getAuditSummary
      mockRun.mockResolvedValueOnce({ records: [] });

      const summary = await engine.getAuditSummary();

      expect(summary.total).toBe(5);
      expect(summary.byProject['codegraph']).toBeDefined();
      expect(summary.byProject['codegraph'].drift).toBe(5);
      expect(summary.byProject['codegraph'].audited).toBe(3);
      expect(summary.byProject['codegraph'].confirmed).toBe(2);
      expect(summary.byProject['codegraph'].falsePositive).toBe(1);
      expect(summary.byProject['codegraph'].partial).toBe(0);
    });

    it('handles Neo4j Integer objects with .toNumber()', async () => {
      mockRun.mockResolvedValueOnce({
        records: [
          makeNeo4jRecord({
            project: 'proj',
            drift: { toNumber: () => 10 },
            audited: { toNumber: () => 7 },
            confirmed: { toNumber: () => 5 },
            falsePositive: { toNumber: () => 1 },
            partial: { toNumber: () => 1 },
          }),
        ],
      });
      mockRun.mockResolvedValueOnce({ records: [] });

      const summary = await engine.getAuditSummary();
      expect(summary.byProject['proj'].drift).toBe(10);
      expect(typeof summary.byProject['proj'].drift).toBe('number');
    });

    it('handles plain number values (no .toNumber())', async () => {
      mockRun.mockResolvedValueOnce({
        records: [
          makeNeo4jRecord({
            project: 'plain',
            drift: 3,
            audited: 2,
            confirmed: 1,
            falsePositive: 1,
            partial: 0,
          }),
        ],
      });
      mockRun.mockResolvedValueOnce({ records: [] });

      const summary = await engine.getAuditSummary();
      expect(summary.byProject['plain'].drift).toBe(3);
    });
  });
});
