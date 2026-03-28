/**
 * [AUD-TC-13-L1-03] plan-code-embedding-matcher.ts — Behavioral Tests
 *
 * Now importable (main() guarded). Tests mock Neo4jService, EmbeddingsService,
 * and fs to verify query patterns, embedding flow, edge creation, and report output.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs
const mockMkdirSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
vi.mock('fs', () => ({
  mkdirSync: (...args: any[]) => mockMkdirSync(...args),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
  writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
}));

// Mock Neo4jService
const mockRun = vi.fn();
const mockNeoClose = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn(function (this: any) {
    this.run = mockRun;
    this.close = mockNeoClose;
  }),
}));

// Mock EmbeddingsService
const mockEmbedText = vi.fn();
vi.mock('../../../core/embeddings/embeddings.service.js', () => ({
  EmbeddingsService: vi.fn(function (this: any) {
    this.embedText = mockEmbedText;
  }),
}));

import { main } from '../plan-code-embedding-matcher.js';

describe('[aud-tc-13] plan-code-embedding-matcher.ts', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let originalArgv: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    originalArgv = process.argv;
    process.argv = ['node', 'script.js']; // no --apply, no --threshold, no --limit
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Default: project map with one mapping
    mockReadFileSync.mockReturnValue(JSON.stringify({ plan_codegraph: 'proj_c0d3e9a1f200' }));
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('(1) reads plan-code-project-map.json from config/', async () => {
    mockRun.mockResolvedValue([]);
    await main();
    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining('plan-code-project-map.json'),
      'utf8',
    );
  });

  it('(2) queries Task nodes without HAS_CODE_EVIDENCE for each plan project', async () => {
    mockRun.mockResolvedValue([]);
    await main();
    const query = mockRun.mock.calls[0][0] as string;
    expect(query).toContain('MATCH (t:Task {projectId: $planProjectId})');
    expect(query).toContain('hasCodeEvidence');
    expect(query).toContain('embeddingInput');
  });

  it('(3) embeds task text via EmbeddingsService', async () => {
    mockRun
      .mockResolvedValueOnce([{ id: 'task1', name: 'Test task', embeddingInput: 'some text', planProjectId: 'plan_codegraph' }])
      .mockResolvedValueOnce([]); // function query returns no matches
    mockEmbedText.mockResolvedValueOnce([0.1, 0.2, 0.3]);
    await main();
    expect(mockEmbedText).toHaveBeenCalledOnce();
    expect(mockEmbedText).toHaveBeenCalledWith(expect.stringContaining('some text'));
  });

  it('(4) queries Function nodes with embeddings and uses cosine similarity', async () => {
    mockRun
      .mockResolvedValueOnce([{ id: 'task1', name: 'Task', embeddingInput: 'text', planProjectId: 'plan_codegraph' }])
      .mockResolvedValueOnce([]);
    mockEmbedText.mockResolvedValueOnce([0.1, 0.2]);
    await main();
    const fnQuery = mockRun.mock.calls[1][0] as string;
    expect(fnQuery).toContain('f.embedding IS NOT NULL');
    expect(fnQuery).toContain('vector.similarity.cosine');
    expect(fnQuery).toContain('score >= $threshold');
  });

  it('(5) uses default threshold 0.75 and limit 5', async () => {
    mockRun.mockResolvedValue([]);
    await main();
    const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(output.threshold).toBe(0.75);
    expect(output.limit).toBe(5);
  });

  it('(6) respects --threshold and --limit from argv', async () => {
    process.argv = ['node', 'script.js', '--threshold=0.8', '--limit=3'];
    mockRun.mockResolvedValue([]);
    await main();
    const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(output.threshold).toBe(0.8);
    expect(output.limit).toBe(3);
  });

  it('(7) does NOT create HAS_CODE_EVIDENCE edges without --apply', async () => {
    mockRun
      .mockResolvedValueOnce([{ id: 'task1', name: 'Task', embeddingInput: 'text', planProjectId: 'plan_codegraph' }])
      .mockResolvedValueOnce([{ id: 'fn1', name: 'myFunc', score: 0.85 }]);
    mockEmbedText.mockResolvedValueOnce([0.1]);
    await main();
    // Only 2 calls: task query + function query. No MERGE calls.
    expect(mockRun).toHaveBeenCalledTimes(2);
    const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(output.apply).toBe(false);
    expect(output.edgesCreated).toBe(0);
  });

  it('(8) creates HAS_CODE_EVIDENCE edges WITH --apply', async () => {
    process.argv = ['node', 'script.js', '--apply'];
    mockRun
      .mockResolvedValueOnce([{ id: 'task1', name: 'Task', embeddingInput: 'text', planProjectId: 'plan_codegraph' }])
      .mockResolvedValueOnce([{ id: 'fn1', name: 'myFunc', score: 0.85 }])
      .mockResolvedValueOnce(undefined) // MERGE HCE edge
      .mockResolvedValueOnce(undefined); // SET semantic evidence flags
    mockEmbedText.mockResolvedValueOnce([0.1]);
    await main();
    // Call 2: MERGE HAS_CODE_EVIDENCE
    const mergeQuery = mockRun.mock.calls[2][0] as string;
    expect(mergeQuery).toContain('MERGE (t)-[r:HAS_CODE_EVIDENCE]->(fn)');
    expect(mergeQuery).toContain("r.refType = 'semantic_embedding'");
    const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(output.apply).toBe(true);
    expect(output.edgesCreated).toBe(1);
  });

  it('(9) writes report to artifacts/embedding-matcher/', async () => {
    mockRun.mockResolvedValue([]);
    await main();
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('embedding-matcher'),
      { recursive: true },
    );
    expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
    const latestPath = mockWriteFileSync.mock.calls[1][0] as string;
    expect(latestPath).toContain('plan-code-embedding-match-latest.json');
  });

  it('(10) outputs console JSON summary', async () => {
    mockRun.mockResolvedValue([]);
    await main();
    const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(output.ok).toBe(true);
    expect(output).toHaveProperty('tasksScanned');
    expect(output).toHaveProperty('tasksMatched');
    expect(output).toHaveProperty('edgesCreated');
  });

  it('(11) closes Neo4j in finally block even on error', async () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('file not found'); });
    await expect(main()).rejects.toThrow('file not found');
    expect(mockNeoClose).toHaveBeenCalledOnce();
  });

  it('(12) skips tasks with empty id or embeddingInput', async () => {
    mockRun.mockResolvedValueOnce([
      { id: '', name: 'Empty ID', embeddingInput: 'text', planProjectId: 'plan_codegraph' },
      { id: 'task2', name: 'Empty Input', embeddingInput: '', planProjectId: 'plan_codegraph' },
    ]);
    await main();
    expect(mockEmbedText).not.toHaveBeenCalled();
    const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(output.tasksScanned).toBe(0);
  });
});
