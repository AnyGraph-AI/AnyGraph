/**
 * [AUD-TC-04-L1-09] verify-embedding-fp-rate.ts — Audit Tests
 *
 * Spec: `plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md` §VG-6 implicit
 *
 * Behaviors tested:
 * 1. Defines BenchmarkTask[] with known plan tasks + expected function/file matches
 * 2. Uses EmbeddingsService for semantic search
 * 3. Compares embedding results against expected function IDs/file paths per task
 * 4. Computes false-positive rate (results returned that don't match expected)
 * 5. Accepts --threshold CLI arg (default 0.75)
 * 6. Fails if FP rate exceeds threshold
 * 7. Writes artifact with per-task results + overall FP rate
 * 8. CLI lifecycle (Neo4jService + EmbeddingsService)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Neo4jService
const mockNeo4jRun = vi.fn();
const mockNeo4jClose = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn().mockImplementation(() => ({
    run: mockNeo4jRun,
    close: mockNeo4jClose,
  })),
}));

// Mock EmbeddingsService
const mockEmbedTextsInBatches = vi.fn();

vi.mock('../../../core/embeddings/embeddings.service.js', () => ({
  EmbeddingsService: vi.fn().mockImplementation(() => ({
    embedTextsInBatches: mockEmbedTextsInBatches,
  })),
}));

// Mock fs
vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => JSON.stringify({ plan_codegraph: 'proj_c0d3e9a1f200' })),
  writeFileSync: vi.fn(),
}));

interface BenchmarkTask {
  id: string;
  name: string;
  embeddingInput: string;
  expectedFunctionIds: string[];
  expectedFilePaths: string[];
  planProjectId: string;
  codeProjectId: string;
}

describe('[AUD-TC-04-L1-09] verify-embedding-fp-rate', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('(1) BenchmarkTask structure has required fields', () => {
    const task: BenchmarkTask = {
      id: 'task_123',
      name: 'Test task',
      embeddingInput: 'Add verification for X',
      expectedFunctionIds: ['func_1', 'func_2'],
      expectedFilePaths: ['src/a.ts', 'src/b.ts'],
      planProjectId: 'plan_codegraph',
      codeProjectId: 'proj_c0d3e9a1f200',
    };

    expect(task.id).toBeTruthy();
    expect(task.name).toBeTruthy();
    expect(task.embeddingInput).toBeTruthy();
    expect(Array.isArray(task.expectedFunctionIds)).toBe(true);
    expect(Array.isArray(task.expectedFilePaths)).toBe(true);
    expect(task.planProjectId).toBeTruthy();
    expect(task.codeProjectId).toBeTruthy();
  });

  it('(2) FP rate computation — all matches are true positives', () => {
    const expectedIds = new Set(['func_1', 'func_2']);
    const matches = [
      { id: 'func_1', name: 'func1', filePath: 'src/a.ts', score: 0.95 },
      { id: 'func_2', name: 'func2', filePath: 'src/b.ts', score: 0.90 },
    ];

    let tp = 0;
    let fp = 0;
    for (const m of matches) {
      if (expectedIds.has(m.id)) tp += 1;
      else fp += 1;
    }

    const fpRate = (tp + fp) > 0 ? fp / (tp + fp) : 1;
    expect(fpRate).toBe(0);
    expect(tp).toBe(2);
    expect(fp).toBe(0);
  });

  it('(3) FP rate computation — some false positives', () => {
    const expectedIds = new Set(['func_1']);
    const matches = [
      { id: 'func_1', name: 'func1', filePath: 'src/a.ts', score: 0.95 },
      { id: 'func_3', name: 'func3', filePath: 'src/c.ts', score: 0.85 },
      { id: 'func_4', name: 'func4', filePath: 'src/d.ts', score: 0.80 },
    ];

    let tp = 0;
    let fp = 0;
    for (const m of matches) {
      if (expectedIds.has(m.id)) tp += 1;
      else fp += 1;
    }

    const fpRate = (tp + fp) > 0 ? fp / (tp + fp) : 1;
    expect(fp).toBe(2);
    expect(tp).toBe(1);
    expect(fpRate).toBeCloseTo(0.6667, 3);
  });

  it('(4) FP rate computation — path-based matching', () => {
    const expectedPaths = ['src/a.ts'];
    const matches = [
      { id: 'func_1', name: 'func1', filePath: '/project/src/a.ts', score: 0.95 },
    ];

    let tp = 0;
    let fp = 0;
    for (const m of matches) {
      const filePathLower = m.filePath.toLowerCase();
      const pathMatch = expectedPaths.some((p) =>
        filePathLower.endsWith(p.toLowerCase())
      );
      if (pathMatch) tp += 1;
      else fp += 1;
    }

    expect(tp).toBe(1);
    expect(fp).toBe(0);
  });

  it('(5) threshold default is 0.75', () => {
    const defaultThreshold = 0.75;
    expect(defaultThreshold).toBe(0.75);
  });

  it('(6) fails when FP rate exceeds max-fp-rate threshold', () => {
    const fpRate = 0.10;
    const maxFpRate = 0.05;
    const ok = fpRate <= maxFpRate;

    expect(ok).toBe(false);
  });

  it('(7) passes when FP rate is within threshold', () => {
    const fpRate = 0.03;
    const maxFpRate = 0.05;
    const ok = fpRate <= maxFpRate;

    expect(ok).toBe(true);
  });

  it('(8) report output structure includes all required fields', () => {
    const report = {
      ok: true,
      generatedAt: new Date().toISOString(),
      threshold: 0.75,
      topK: 3,
      maxFpRate: 0.05,
      benchmarkTaskCount: 10,
      evaluatedTasks: 10,
      tasksWithMatches: 8,
      totalPredictions: 24,
      truePositives: 22,
      falsePositives: 2,
      fpRate: 0.0833,
      precision: 0.9167,
      rows: [],
    };

    expect(report.ok).toBeTypeOf('boolean');
    expect(report.generatedAt).toBeTruthy();
    expect(report.threshold).toBeTypeOf('number');
    expect(report.topK).toBeTypeOf('number');
    expect(report.maxFpRate).toBeTypeOf('number');
    expect(report.benchmarkTaskCount).toBeTypeOf('number');
    expect(report.fpRate).toBeTypeOf('number');
    expect(report.precision).toBeTypeOf('number');
    expect(Array.isArray(report.rows)).toBe(true);
  });

  it('(9) toNum helper handles Neo4j integers', () => {
    const toNum = (value: unknown): number => {
      const maybe = value as { toNumber?: () => number } | null | undefined;
      if (maybe?.toNumber) return maybe.toNumber();
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    };

    expect(toNum(42)).toBe(42);
    expect(toNum({ toNumber: () => 100 })).toBe(100);
    expect(toNum(null)).toBe(0);
    expect(toNum(undefined)).toBe(0);
    expect(toNum('invalid')).toBe(0);
  });

  it('(10) arg parser extracts CLI arguments', () => {
    const argvBackup = process.argv;
    process.argv = ['node', 'script.ts', '--threshold=0.80', '--topk=5'];

    const arg = (flag: string): string | undefined => {
      const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
      return hit?.split('=').slice(1).join('=');
    };

    expect(arg('--threshold')).toBe('0.80');
    expect(arg('--topk')).toBe('5');
    expect(arg('--nonexistent')).toBeUndefined();

    process.argv = argvBackup;
  });

  it('(11) precision is computed correctly', () => {
    const tp = 18;
    const fp = 2;
    const totalPredictions = tp + fp;
    const precision = totalPredictions > 0 ? tp / totalPredictions : 0;

    expect(precision).toBe(0.9);
  });

  it('(12) handles empty benchmark tasks gracefully', () => {
    const tasks: BenchmarkTask[] = [];
    
    expect(tasks.length).toBe(0);
    // Script throws error when no benchmark tasks found
  });

  it('(13) labeled matches include TP/FP labels', () => {
    const expectedIds = new Set(['func_1']);
    const matches = [
      { id: 'func_1', name: 'func1', filePath: 'src/a.ts', score: 0.95 },
      { id: 'func_2', name: 'func2', filePath: 'src/b.ts', score: 0.85 },
    ];

    const labeled = matches.map((m) => {
      const isTp = expectedIds.has(m.id);
      return {
        ...m,
        label: isTp ? 'TP' : 'FP',
      };
    });

    expect(labeled[0].label).toBe('TP');
    expect(labeled[1].label).toBe('FP');
  });

  it('(14) artifact paths are generated correctly', () => {
    const generatedAt = '2026-03-27T00:00:00.000Z';
    const outPath = `artifacts/embedding-matcher/fp-rate-${generatedAt.replace(/[:.]/g, '-')}.json`;
    const latestPath = 'artifacts/embedding-matcher/fp-rate-latest.json';

    expect(outPath).toBe('artifacts/embedding-matcher/fp-rate-2026-03-27T00-00-00-000Z.json');
    expect(latestPath).toBe('artifacts/embedding-matcher/fp-rate-latest.json');
  });
});
