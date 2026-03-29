import { describe, it, expect, vi, beforeEach } from 'vitest';

// Declare mocks BEFORE vi.mock
const mockRun = vi.fn();
const mockClose = vi.fn().mockResolvedValue(undefined);

// Mock Neo4jService constructor — arrow functions are NOT constructible with `new`
vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn(function (this: any) {
    this.run = mockRun;
    this.close = mockClose;
  }),
}));

import { ingestRuntimeGateEvidence, type RuntimeGateEvidenceInput } from '../runtime-evidence-ingest.js';
import { Neo4jService } from '../../../storage/neo4j/neo4j.service.js';

function makeInput(overrides?: Partial<RuntimeGateEvidenceInput>): RuntimeGateEvidenceInput {
  return {
    projectId: 'proj_test',
    verificationRun: {
      runId: 'run-001',
      ranAt: '2026-03-28T00:00:00Z',
      tool: 'vitest',
      toolVersion: '1.0.0',
      ok: true,
      durationMs: 500,
      artifactHash: 'abc123',
      decisionHash: 'dec456',
    },
    gateDecision: {
      gateName: 'integrity',
      result: 'pass',
      evaluatedAt: '2026-03-28T00:00:01Z',
      policyBundleId: 'pb-1',
      externalContextSnapshotRef: 'ext-ref-1',
      decisionHash: 'gdec789',
    },
    commitSnapshot: {
      headSha: 'aabbccdd',
      branch: 'main',
      capturedAt: '2026-03-28T00:00:02Z',
    },
    workingTreeSnapshot: {
      isDirty: false,
      diffHash: 'diff000',
      capturedAt: '2026-03-28T00:00:03Z',
    },
    ...overrides,
  };
}

describe('[aud-tc-09] runtime-evidence-ingest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: neo4j.run returns empty array (except PRECEDES which needs [{created:0}])
    mockRun.mockResolvedValue([]);
  });

  it('creates a Neo4jService instance on invocation', async () => {
    mockRun.mockResolvedValue([{ created: 0 }]);
    await ingestRuntimeGateEvidence(makeInput());
    expect(Neo4jService).toHaveBeenCalledTimes(1);
  });

  it('MERGEs VerificationRun with correct runId and projectId', async () => {
    mockRun.mockResolvedValue([{ created: 0 }]);
    await ingestRuntimeGateEvidence(makeInput());

    const firstCall = mockRun.mock.calls[0];
    const params = firstCall[1];

    expect(params.runId).toBe('run-001');
    expect(params.projectId).toBe('proj_test');
  });

  it('MERGEs GateDecision with composite id gate:{runId}:{gateName}', async () => {
    mockRun.mockResolvedValue([{ created: 0 }]);
    await ingestRuntimeGateEvidence(makeInput());

    const secondCall = mockRun.mock.calls[1];
    const params = secondCall[1];

    expect(params.gateDecisionId).toBe('gate:run-001:integrity');
  });

  it('MERGEs CommitSnapshot with correct headSha', async () => {
    mockRun.mockResolvedValue([{ created: 0 }]);
    await ingestRuntimeGateEvidence(makeInput());

    const thirdCall = mockRun.mock.calls[2];
    const params = thirdCall[1];

    expect(params.headSha).toBe('aabbccdd');
  });

  it('MERGEs WorkingTreeSnapshot with correct isDirty and diffHash', async () => {
    mockRun.mockResolvedValue([{ created: 0 }]);
    await ingestRuntimeGateEvidence(makeInput());

    const fourthCall = mockRun.mock.calls[3];
    const params = fourthCall[1];

    expect(params.isDirty).toBe(false);
    expect(params.diffHash).toBe('diff000');
  });

  it('MERGEs Artifact with truncated sha256 id when artifact provided', async () => {
    mockRun.mockResolvedValue([{ created: 0 }]);
    const sha = 'abcdef1234567890abcdef1234567890extrabytes';
    const input = makeInput({
      artifact: { path: '/out/report.json', sha256: sha, createdAt: '2026-03-28T00:00:04Z' },
    });

    await ingestRuntimeGateEvidence(input);

    // Artifact MERGE is 5th call (index 4)
    const artifactCall = mockRun.mock.calls[4];
    const params = artifactCall[1];

    expect(params.artifactId).toBe(`artifact:${sha.slice(0, 32)}`);
    expect(params.sha256).toBe(sha);
    expect(params.path).toBe('/out/report.json');
  });

  it('skips Artifact MERGE when no artifact — fewer neo4j.run calls', async () => {
    mockRun.mockResolvedValue([{ created: 0 }]);
    await ingestRuntimeGateEvidence(makeInput()); // no artifact

    // Without artifact: 4 node MERGEs + 1 edge batch + 1 PRECEDES = 6 calls
    // With artifact: 5 node MERGEs + 1 edge batch + 1 GENERATED_ARTIFACT edge + 1 PRECEDES = 8 calls
    const callCountWithout = mockRun.mock.calls.length;
    expect(callCountWithout).toBe(6);

    vi.clearAllMocks();
    mockRun.mockResolvedValue([{ created: 0 }]);
    const input = makeInput({
      artifact: { path: '/a.json', sha256: 'a'.repeat(64), createdAt: '2026-03-28T00:00:00Z' },
    });
    await ingestRuntimeGateEvidence(input);
    expect(mockRun.mock.calls.length).toBe(8);
  });

  it('creates 5-edge batch — result reflects 5 edges without artifact', async () => {
    mockRun.mockResolvedValue([{ created: 0 }]);
    const result = await ingestRuntimeGateEvidence(makeInput());

    // Edge batch is 5th call (index 4) when no artifact — verify params carry projectId
    const edgeBatchCall = mockRun.mock.calls[4];
    const params = edgeBatchCall[1];
    expect(params.projectId).toBe('proj_test');
    expect(params.runId).toBe('run-001');
    // 5 edges from batch + 0 PRECEDES = 5
    expect(result.edgesCreated).toBe(5);
  });

  it('creates GENERATED_ARTIFACT edge when artifact provided and counts it', async () => {
    mockRun.mockResolvedValue([{ created: 0 }]);
    const input = makeInput({
      artifact: { path: '/a.json', sha256: 'b'.repeat(64), createdAt: '2026-03-28T00:00:00Z' },
    });

    const result = await ingestRuntimeGateEvidence(input);

    // GENERATED_ARTIFACT edge call is index 6 (after 5 nodes + 1 edge batch)
    const genArtifactCall = mockRun.mock.calls[6];
    const params = genArtifactCall[1];
    expect(params.runId).toBe('run-001');
    expect(params.artifactId).toBe(`artifact:${'b'.repeat(32)}`);

    // edgesCreated = 5 (batch) + 1 (GENERATED_ARTIFACT) + 0 (PRECEDES returned 0)
    expect(result.edgesCreated).toBe(6);
  });

  it('returns correct RuntimeGateEvidenceResult shape without artifact', async () => {
    mockRun.mockResolvedValue([{ created: 0 }]);
    const result = await ingestRuntimeGateEvidence(makeInput());

    expect(result).toEqual({
      runNodeUpserted: 1,
      gateDecisionNodeUpserted: 1,
      commitSnapshotNodeUpserted: 1,
      workingTreeSnapshotNodeUpserted: 1,
      artifactNodeUpserted: 0,
      edgesCreated: 5,
    });
  });

  it('returns artifactNodeUpserted=1 when artifact provided', async () => {
    mockRun.mockResolvedValue([{ created: 0 }]);
    const input = makeInput({
      artifact: { path: '/x', sha256: 'c'.repeat(64), createdAt: '2026-03-28T00:00:00Z' },
    });
    const result = await ingestRuntimeGateEvidence(input);
    expect(result.artifactNodeUpserted).toBe(1);
  });

  it('calls neo4j.close() in finally block even on error', async () => {
    mockRun.mockRejectedValueOnce(new Error('db failure'));

    await expect(ingestRuntimeGateEvidence(makeInput())).rejects.toThrow('db failure');
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('executes PRECEDES edge query with correct projectId and runId', async () => {
    mockRun.mockResolvedValue([{ created: 0 }]);
    await ingestRuntimeGateEvidence(makeInput());

    // PRECEDES is the last call (index 5 without artifact)
    const precedesCall = mockRun.mock.calls[5];
    const params = precedesCall[1];

    expect(params.projectId).toBe('proj_test');
    expect(params.runId).toBe('run-001');
  });

  it('passes ok=true param for VerificationRun — source maps to status via CASE', async () => {
    mockRun.mockResolvedValue([{ created: 0 }]);
    await ingestRuntimeGateEvidence(makeInput());

    const vrCall = mockRun.mock.calls[0];
    const params = vrCall[1];

    expect(params.ok).toBe(true);
  });

  it('maps ok=false — param is passed as false', async () => {
    mockRun.mockResolvedValue([{ created: 0 }]);
    const input = makeInput();
    input.verificationRun.ok = false;

    await ingestRuntimeGateEvidence(input);

    const vrCall = mockRun.mock.calls[0];
    expect(vrCall[1].ok).toBe(false);
  });

  it('counts PRECEDES edges when created', async () => {
    // All calls return empty except PRECEDES returns created=1
    mockRun.mockResolvedValue([]);
    // PRECEDES is call index 5 (no artifact)
    mockRun.mockResolvedValueOnce([]); // VR
    mockRun.mockResolvedValueOnce([]); // GD
    mockRun.mockResolvedValueOnce([]); // CS
    mockRun.mockResolvedValueOnce([]); // WTS
    mockRun.mockResolvedValueOnce([]); // edge batch
    mockRun.mockResolvedValueOnce([{ created: 1 }]); // PRECEDES

    const result = await ingestRuntimeGateEvidence(makeInput());
    // 5 from batch + 1 from PRECEDES
    expect(result.edgesCreated).toBe(6);
  });
});
