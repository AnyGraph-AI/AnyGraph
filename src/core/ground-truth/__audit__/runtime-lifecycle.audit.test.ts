// Spec source: _drafts/ground-truth-hook/DESIGN.md
import { describe, it, expect, vi } from 'vitest';
import { GroundTruthRuntime } from '../runtime.js';
import type { GroundTruthPack } from '../pack-interface.js';

function makePack(): GroundTruthPack {
  return {
    domain: 'audit-pack',
    version: '1.0.0',
    queryPlanStatus: vi.fn().mockRejectedValue(new Error('boom during run')),
    queryGovernanceHealth: vi.fn().mockResolvedValue([]),
    queryEvidenceCoverage: vi.fn().mockResolvedValue([]),
    queryRelevantClaims: vi.fn().mockResolvedValue([]),
    queryClaimChainForTask: vi.fn().mockResolvedValue([]),
    queryContradictionsForMilestone: vi.fn().mockResolvedValue([]),
    queryOpenHypothesesForMilestone: vi.fn().mockResolvedValue([]),
    queryIntegritySurfaces: vi.fn().mockResolvedValue([]),
    queryTransitiveImpact: vi.fn().mockResolvedValue([]),
    queryCandidateModifies: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('AUD-TC-11d-07: runtime lifecycle cleanup', () => {
  it('calls pack.close() in cleanup path even after runtime.run error', async () => {
    const neo4j = { run: vi.fn().mockResolvedValue([]), close: vi.fn().mockResolvedValue(undefined) } as any;
    const pack = makePack();
    const runtime = new GroundTruthRuntime(pack, neo4j);

    await expect(runtime.run({ projectId: 'proj_test' })).rejects.toThrow('boom during run');

    await runtime.close();
    expect(pack.close).toHaveBeenCalledTimes(1);
    expect(neo4j.close).toHaveBeenCalledTimes(1);
  });
});
