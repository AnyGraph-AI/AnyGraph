import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock computeTemporalFactors before import
const mockComputeTemporalFactors = vi.fn();
vi.mock('../temporal-confidence.js', () => ({
  computeTemporalFactors: (...args: any[]) => mockComputeTemporalFactors(...args),
}));

import { runClaimBridge, type ClaimBridgeResult } from '../tc-claim-bridge.js';

// Create a mock Neo4jService-like object (runClaimBridge takes it as param, not constructing internally)
function makeMockNeo4j() {
  return {
    run: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('[aud-tc-09] tc-claim-bridge', () => {
  let mockNeo4j: ReturnType<typeof makeMockNeo4j>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockNeo4j = makeMockNeo4j();
  });

  it('executes Cypher to stamp observedAt/lastVerifiedAt on claims missing them', async () => {
    // stamp → orphan → decay fetch
    mockNeo4j.run
      .mockResolvedValueOnce([{ stamped: 3 }])   // stamp
      .mockResolvedValueOnce([{ contested: 0 }])  // orphan
      .mockResolvedValueOnce([]);                  // decay fetch (no claims)

    const result = await runClaimBridge(mockNeo4j as any);

    // First call is the stamp query — verify it ran and returned count
    expect(mockNeo4j.run).toHaveBeenCalled();
    expect(result.stamped).toBe(3);
  });

  it('executes Cypher to detect orphaned claims and mark them contested', async () => {
    mockNeo4j.run
      .mockResolvedValueOnce([{ stamped: 0 }])
      .mockResolvedValueOnce([{ contested: 5 }])
      .mockResolvedValueOnce([]);

    const result = await runClaimBridge(mockNeo4j as any);

    // Second call is orphan detection — verify it ran and returned count
    expect(mockNeo4j.run).toHaveBeenCalledTimes(3); // stamp + orphan + decay fetch
    expect(result.orphansContested).toBe(5);
  });

  it('fetches claims and calls computeTemporalFactors for each, batches UNWIND update', async () => {
    const claims = [
      { id: 'c1', observedAt: '2026-03-01T00:00:00Z', confidence: 0.8 },
      { id: 'c2', observedAt: '2026-03-10T00:00:00Z', confidence: 0.6 },
    ];

    // Return a decay factor that causes >1% change
    mockComputeTemporalFactors.mockReturnValue({ timeConsistencyFactor: 0.5 });

    mockNeo4j.run
      .mockResolvedValueOnce([{ stamped: 0 }])
      .mockResolvedValueOnce([{ contested: 0 }])
      .mockResolvedValueOnce(claims)           // decay fetch
      .mockResolvedValueOnce([]);              // UNWIND update

    const result = await runClaimBridge(mockNeo4j as any);

    // computeTemporalFactors called once per claim
    expect(mockComputeTemporalFactors).toHaveBeenCalledTimes(2);
    // First claim args: observedAt, observedAt (validFrom=observedAt for claims), null, null, now, config
    const firstCallArgs = mockComputeTemporalFactors.mock.calls[0];
    expect(firstCallArgs[0]).toBe('2026-03-01T00:00:00Z'); // observedAt
    expect(firstCallArgs[1]).toBe('2026-03-01T00:00:00Z'); // validFrom = observedAt

    // UNWIND update was called (4th call) — verify batch write happened
    expect(mockNeo4j.run).toHaveBeenCalledTimes(4); // stamp + orphan + fetch + UNWIND
    expect(result.decayed).toBe(2);
  });

  it('skips decay update when change is insignificant (<1%)', async () => {
    const claims = [
      { id: 'c1', observedAt: '2026-03-28T00:00:00Z', confidence: 0.5 },
    ];

    // factor of ~1.0 means decayed ≈ baseConf, less than 1% change
    mockComputeTemporalFactors.mockReturnValue({ timeConsistencyFactor: 1.0 });

    mockNeo4j.run
      .mockResolvedValueOnce([{ stamped: 0 }])
      .mockResolvedValueOnce([{ contested: 0 }])
      .mockResolvedValueOnce(claims);

    const result = await runClaimBridge(mockNeo4j as any);

    // No UNWIND update call — only 3 calls total (stamp, orphan, fetch)
    expect(mockNeo4j.run).toHaveBeenCalledTimes(3);
    expect(result.decayed).toBe(0);
  });

  it('returns ClaimBridgeResult with all 4 fields', async () => {
    mockNeo4j.run
      .mockResolvedValueOnce([{ stamped: 2 }])
      .mockResolvedValueOnce([{ contested: 1 }])
      .mockResolvedValueOnce([]);

    const result = await runClaimBridge(mockNeo4j as any);

    expect(result).toHaveProperty('stamped');
    expect(result).toHaveProperty('orphansContested');
    expect(result).toHaveProperty('decayed');
    expect(result).toHaveProperty('durationMs');
    expect(typeof result.stamped).toBe('number');
    expect(typeof result.orphansContested).toBe('number');
    expect(typeof result.decayed).toBe('number');
    expect(typeof result.durationMs).toBe('number');
  });

  it('durationMs is non-negative (measures real elapsed time)', async () => {
    mockNeo4j.run
      .mockResolvedValueOnce([{ stamped: 0 }])
      .mockResolvedValueOnce([{ contested: 0 }])
      .mockResolvedValueOnce([]);

    const result = await runClaimBridge(mockNeo4j as any);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('handles empty graph gracefully — all counts return 0', async () => {
    mockNeo4j.run
      .mockResolvedValueOnce([{ stamped: 0 }])
      .mockResolvedValueOnce([{ contested: 0 }])
      .mockResolvedValueOnce([]);

    const result = await runClaimBridge(mockNeo4j as any);

    expect(result.stamped).toBe(0);
    expect(result.orphansContested).toBe(0);
    expect(result.decayed).toBe(0);
  });

  it('passes custom TemporalDecayConfig through to computeTemporalFactors', async () => {
    const customConfig = {
      decayWindowHours: 100,
      minimumFactor: 0.5,
      defaultValidityHours: 500,
    };

    mockComputeTemporalFactors.mockReturnValue({ timeConsistencyFactor: 0.3 });

    mockNeo4j.run
      .mockResolvedValueOnce([{ stamped: 0 }])
      .mockResolvedValueOnce([{ contested: 0 }])
      .mockResolvedValueOnce([{ id: 'c1', observedAt: '2026-01-01T00:00:00Z', confidence: 0.9 }])
      .mockResolvedValueOnce([]);

    await runClaimBridge(mockNeo4j as any, customConfig);

    // Last arg to computeTemporalFactors should be our custom config
    const callArgs = mockComputeTemporalFactors.mock.calls[0];
    const configArg = callArgs[callArgs.length - 1];
    expect(configArg.decayWindowHours).toBe(100);
    expect(configArg.minimumFactor).toBe(0.5);
    expect(configArg.defaultValidityHours).toBe(500);
  });

  it('uses default config with 720h decay window, 0.1 min factor, 2160h validity when none provided', async () => {
    mockComputeTemporalFactors.mockReturnValue({ timeConsistencyFactor: 0.4 });

    mockNeo4j.run
      .mockResolvedValueOnce([{ stamped: 0 }])
      .mockResolvedValueOnce([{ contested: 0 }])
      .mockResolvedValueOnce([{ id: 'c1', observedAt: '2026-01-01T00:00:00Z', confidence: 0.8 }])
      .mockResolvedValueOnce([]);

    await runClaimBridge(mockNeo4j as any); // no config param

    const callArgs = mockComputeTemporalFactors.mock.calls[0];
    const configArg = callArgs[callArgs.length - 1];
    expect(configArg.decayWindowHours).toBe(720);
    expect(configArg.minimumFactor).toBe(0.1);
    expect(configArg.defaultValidityHours).toBe(2160);
  });

  it('uses 0.5 as default confidence when claim.confidence is null', async () => {
    mockComputeTemporalFactors.mockReturnValue({ timeConsistencyFactor: 0.5 });

    mockNeo4j.run
      .mockResolvedValueOnce([{ stamped: 0 }])
      .mockResolvedValueOnce([{ contested: 0 }])
      .mockResolvedValueOnce([{ id: 'c1', observedAt: '2026-03-01T00:00:00Z', confidence: null }])
      .mockResolvedValueOnce([]);

    const result = await runClaimBridge(mockNeo4j as any);

    // baseConf = 0.5 (default), decayed = 0.5 * 0.5 = 0.25
    // |0.25 - 0.5| = 0.25 > 0.01 → should be decayed
    expect(result.decayed).toBe(1);

    // Check the UNWIND update params
    const unwindCall = mockNeo4j.run.mock.calls[3];
    const updates = unwindCall[1].updates;
    expect(updates[0].decayedConfidence).toBe(0.25);
  });
});
