/**
 * UI-0: enrichPrecomputeScores integration test
 *
 * Spec-first: tests the Neo4j enrichment function against the live graph.
 * This is the ONLY untested function in precompute-scores.ts.
 *
 * Requirements:
 * 1. Every SourceFile in the project gets a painScore (no nulls)
 * 2. Every SourceFile gets all core + expanded precompute properties
 * 3. Every Function gets downstreamImpact and centralityNormalized
 * 4. Project node gets maxima (maxPainScore, maxAdjustedPain, maxFragility, maxCentrality)
 * 5. Idempotent: running twice produces the same results
 * 6. Files with 0 functions get painScore=0 (not null)
 * 7. Confidence is between 0 and 1 inclusive
 * 8. adjustedPain = painScore * (1 + (1 - confidenceScore)) — uncertainty AMPLIFIES
 *    (DECISION-FORMULA-REVIEW-2026-03-17: DO NOT revert to 0.5+0.5*conf)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import neo4j, { type Driver } from 'neo4j-driver';
import { enrichPrecomputeScores } from '../../../../scripts/enrichment/precompute-scores.js';

const PROJECT_ID = 'proj_c0d3e9a1f200';
let driver: Driver;

beforeAll(() => {
  driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER ?? 'neo4j',
      process.env.NEO4J_PASSWORD ?? 'codegraph',
    ),
  );
});

afterAll(async () => {
  await driver.close();
});

describe('[UI-0] enrichPrecomputeScores integration', () => {
  it('returns counts of updated functions and files', { timeout: 15000 }, async () => {
    const result = await enrichPrecomputeScores(driver, PROJECT_ID);
    expect(result.functionsUpdated).toBeGreaterThan(0);
    expect(result.filesUpdated).toBeGreaterThan(0);
  });

  it('every SourceFile has core + expanded precompute properties (no nulls)', async () => {
    await enrichPrecomputeScores(driver, PROJECT_ID);
    const session = driver.session();
    try {
      const r = await session.run(
        `MATCH (sf:SourceFile {projectId: $pid})
         WHERE sf.painScore IS NULL
            OR sf.adjustedPain IS NULL
            OR sf.basePain IS NULL
            OR sf.fragility IS NULL
            OR sf.confidenceScore IS NULL
            OR sf.downstreamImpact IS NULL
            OR sf.centrality IS NULL
            OR sf.riskTierSummary IS NULL
            OR sf.riskTier IS NULL
            OR sf.riskTierNum IS NULL
            OR sf.importFanInCount IS NULL
            OR sf.importFanOutCount IS NULL
            OR sf.structuralRoutingSurface IS NULL
            OR sf.configRiskClass IS NULL
            OR sf.productionRiskExcluded IS NULL
            OR sf.blastRadiusDepth IS NULL
            OR sf.temporalCouplingCount IS NULL
            OR sf.busFactor IS NULL
            OR sf.stateFieldCount IS NULL
            OR sf.verificationFailCount IS NULL
            OR sf.claimCount IS NULL
            OR sf.hiddenCouplingCount IS NULL
            OR sf.activeInProgressTaskCount IS NULL
            OR sf.activeBlockedTaskCount IS NULL
            OR sf.activeBlockerCount IS NULL
            OR sf.activeCriticalFunctionCount IS NULL
            OR sf.activeGateStatus IS NULL
         RETURN sf.name AS name`,
        { pid: PROJECT_ID },
      );
      const nullFiles = r.records.map((rec) => rec.get('name'));
      expect(nullFiles).toEqual([]);
    } finally {
      await session.close();
    }
  });

  it('activeGateStatus is always one of ALLOW/REQUIRE_APPROVAL/BLOCK', async () => {
    await enrichPrecomputeScores(driver, PROJECT_ID);
    const session = driver.session();
    try {
      const r = await session.run(
        `MATCH (sf:SourceFile {projectId: $pid})
         WHERE NOT sf.activeGateStatus IN ['ALLOW', 'REQUIRE_APPROVAL', 'BLOCK']
         RETURN sf.name AS name, sf.activeGateStatus AS activeGateStatus`,
        { pid: PROJECT_ID },
      );
      const invalid = r.records.map((rec) => ({
        name: rec.get('name'),
        activeGateStatus: rec.get('activeGateStatus'),
      }));
      expect(invalid).toEqual([]);
    } finally {
      await session.close();
    }
  });

  it('riskTier is always canonical and riskTierNum is 0..4', async () => {
    await enrichPrecomputeScores(driver, PROJECT_ID);
    const session = driver.session();
    try {
      const r = await session.run(
        `MATCH (sf:SourceFile {projectId: $pid})
         WHERE NOT sf.riskTier IN ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
            OR sf.riskTierNum < 0 OR sf.riskTierNum > 4
         RETURN sf.name AS name, sf.riskTier AS riskTier, sf.riskTierNum AS riskTierNum`,
        { pid: PROJECT_ID },
      );
      const invalid = r.records.map((rec) => ({
        name: rec.get('name'),
        riskTier: rec.get('riskTier'),
        riskTierNum: rec.get('riskTierNum'),
      }));
      expect(invalid).toEqual([]);
    } finally {
      await session.close();
    }
  });

  it('configRiskClass is always one of NONE/GOVERNANCE_CRITICAL_CONFIG/EXAMPLE_ASSET', async () => {
    await enrichPrecomputeScores(driver, PROJECT_ID);
    const session = driver.session();
    try {
      const r = await session.run(
        `MATCH (sf:SourceFile {projectId: $pid})
         WHERE NOT sf.configRiskClass IN ['NONE', 'GOVERNANCE_CRITICAL_CONFIG', 'EXAMPLE_ASSET']
         RETURN sf.name AS name, sf.configRiskClass AS configRiskClass`,
        { pid: PROJECT_ID },
      );
      const invalid = r.records.map((rec) => ({
        name: rec.get('name'),
        configRiskClass: rec.get('configRiskClass'),
      }));
      expect(invalid).toEqual([]);
    } finally {
      await session.close();
    }
  });

  it('example assets are excluded from production risk tiers by default', async () => {
    await enrichPrecomputeScores(driver, PROJECT_ID);
    const session = driver.session();
    try {
      const r = await session.run(
        `MATCH (sf:SourceFile {projectId: $pid})
         WHERE sf.configRiskClass = 'EXAMPLE_ASSET'
         RETURN count(sf) AS total,
                sum(CASE WHEN sf.productionRiskExcluded = true THEN 1 ELSE 0 END) AS excluded,
                sum(CASE WHEN sf.riskTier = 'UNKNOWN' AND sf.riskTierNum = 0 THEN 1 ELSE 0 END) AS canonicalUnknown`,
        { pid: PROJECT_ID },
      );
      const total = Number(r.records[0]?.get('total') ?? 0);
      const excluded = Number(r.records[0]?.get('excluded') ?? 0);
      const canonicalUnknown = Number(r.records[0]?.get('canonicalUnknown') ?? 0);
      if (total > 0) {
        expect(excluded).toBe(total);
        expect(canonicalUnknown).toBe(total);
      }
    } finally {
      await session.close();
    }
  });

  it('every Function has downstreamImpact and centralityNormalized', { timeout: 60_000 }, async () => {
    await enrichPrecomputeScores(driver, PROJECT_ID);
    const session = driver.session();
    try {
      const r = await session.run(
        `MATCH (f:Function {projectId: $pid})
         WHERE f.downstreamImpact IS NULL
            OR f.centralityNormalized IS NULL
         RETURN f.name AS name, f.filePath AS path`,
        { pid: PROJECT_ID },
      );
      const missing = r.records.map((rec) => rec.get('name'));
      expect(missing).toEqual([]);
    } finally {
      await session.close();
    }
  });

  it('file riskTier matches max contained executable-node riskTier', async () => {
    await enrichPrecomputeScores(driver, PROJECT_ID);
    const session = driver.session();
    try {
      const r = await session.run(
        `MATCH (sf:SourceFile {projectId: $pid})
         OPTIONAL MATCH (sf)-[:CONTAINS]->(fn {projectId: $pid})
         WHERE fn:Function OR fn:Method OR fn:FunctionDeclaration
         WITH sf,
              max(CASE fn.riskTier
                WHEN 'CRITICAL' THEN 4
                WHEN 'HIGH' THEN 3
                WHEN 'MEDIUM' THEN 2
                WHEN 'LOW' THEN 1
                ELSE 0
              END) AS expectedNum
         WITH sf, coalesce(expectedNum, 0) AS expectedNum
         WHERE coalesce(sf.productionRiskExcluded, false) = false
           AND sf.riskTierNum <> expectedNum
         RETURN sf.name AS name, sf.riskTierNum AS actualNum, expectedNum`,
        { pid: PROJECT_ID },
      );
      const mismatches = r.records.map((rec) => ({
        name: rec.get('name'),
        actualNum: rec.get('actualNum'),
        expectedNum: rec.get('expectedNum'),
      }));
      expect(mismatches).toEqual([]);
    } finally {
      await session.close();
    }
  });

  it('structural routing surfaces are flagged for index.ts files', async () => {
    await enrichPrecomputeScores(driver, PROJECT_ID);
    const session = driver.session();
    try {
      const r = await session.run(
        `MATCH (sf:SourceFile {projectId: $pid})
         WHERE sf.filePath ENDS WITH '/index.ts'
         RETURN count(sf) AS total,
                sum(CASE WHEN sf.structuralRoutingSurface = true THEN 1 ELSE 0 END) AS flagged`,
        { pid: PROJECT_ID },
      );
      const total = Number(r.records[0]?.get('total') ?? 0);
      const flagged = Number(r.records[0]?.get('flagged') ?? 0);
      if (total > 0) {
        expect(flagged).toBe(total);
      }
    } finally {
      await session.close();
    }
  });

  it('Project node has core + expanded maxima set', async () => {
    await enrichPrecomputeScores(driver, PROJECT_ID);
    const session = driver.session();
    try {
      const r = await session.run(
        `MATCH (p:Project {projectId: $pid})
         RETURN p.maxPainScore AS maxPain,
                p.maxAdjustedPain AS maxAdj,
                p.maxFragility AS maxFrag,
                p.maxCentrality AS maxCent,
                p.maxBlastRadiusDepth AS maxBlast,
                p.maxTemporalCouplingCount AS maxTemporal,
                p.maxBusFactor AS maxBus,
                p.maxStateFieldCount AS maxState,
                p.maxVerificationFailCount AS maxVFail,
                p.maxClaimCount AS maxClaim,
                p.maxHiddenCouplingCount AS maxHidden,
                p.maxActiveInProgressTaskCount AS maxActiveInProgress,
                p.maxActiveBlockedTaskCount AS maxActiveBlocked,
                p.maxActiveBlockerCount AS maxActiveBlockers,
                p.maxActiveCriticalFunctionCount AS maxActiveCritical`,
        { pid: PROJECT_ID },
      );
      const rec = r.records[0];
      expect(rec).toBeDefined();
      const maxPain = rec.get('maxPain');
      const maxAdj = rec.get('maxAdj');
      const maxFrag = rec.get('maxFrag');
      const maxCent = rec.get('maxCent');
      const maxBlast = rec.get('maxBlast');
      const maxTemporal = rec.get('maxTemporal');
      const maxBus = rec.get('maxBus');
      const maxState = rec.get('maxState');
      const maxVFail = rec.get('maxVFail');
      const maxClaim = rec.get('maxClaim');
      const maxHidden = rec.get('maxHidden');
      const maxActiveInProgress = rec.get('maxActiveInProgress');
      const maxActiveBlocked = rec.get('maxActiveBlocked');
      const maxActiveBlockers = rec.get('maxActiveBlockers');
      const maxActiveCritical = rec.get('maxActiveCritical');
      expect(typeof maxPain).toBe('number');
      expect(typeof maxAdj).toBe('number');
      expect(typeof maxFrag).toBe('number');
      expect(typeof maxCent).toBe('number');
      expect(typeof maxBlast).toBe('number');
      expect(typeof maxTemporal).toBe('number');
      expect(typeof maxBus).toBe('number');
      expect(typeof maxState).toBe('number');
      expect(typeof maxVFail).toBe('number');
      expect(typeof maxClaim).toBe('number');
      expect(typeof maxHidden).toBe('number');
      expect(typeof maxActiveInProgress).toBe('number');
      expect(typeof maxActiveBlocked).toBe('number');
      expect(typeof maxActiveBlockers).toBe('number');
      expect(typeof maxActiveCritical).toBe('number');
      expect(maxPain).toBeGreaterThan(0);
      expect(maxAdj).toBeGreaterThan(0);
      expect(maxCent).toBeGreaterThan(0);
    } finally {
      await session.close();
    }
  });

  it('idempotent: running twice produces same results', async () => {
    const first = await enrichPrecomputeScores(driver, PROJECT_ID);
    const second = await enrichPrecomputeScores(driver, PROJECT_ID);
    expect(first.functionsUpdated).toBe(second.functionsUpdated);
    expect(first.filesUpdated).toBe(second.filesUpdated);

    // Spot-check a specific file's scores
    const session = driver.session();
    try {
      const r = await session.run(
        `MATCH (sf:SourceFile {projectId: $pid})
         WHERE sf.adjustedPain > 0
         RETURN sf.name AS name, sf.painScore AS pain, sf.adjustedPain AS adj
         ORDER BY sf.adjustedPain DESC LIMIT 1`,
        { pid: PROJECT_ID },
      );
      const topFile = r.records[0];
      expect(topFile).toBeDefined();
      // Running a third time shouldn't change the top file
      await enrichPrecomputeScores(driver, PROJECT_ID);
      const r2 = await session.run(
        `MATCH (sf:SourceFile {projectId: $pid})
         WHERE sf.adjustedPain > 0
         RETURN sf.name AS name, sf.painScore AS pain, sf.adjustedPain AS adj
         ORDER BY sf.adjustedPain DESC LIMIT 1`,
        { pid: PROJECT_ID },
      );
      expect(r2.records[0].get('name')).toBe(topFile.get('name'));
      expect(r2.records[0].get('pain')).toBe(topFile.get('pain'));
    } finally {
      await session.close();
    }
  });

  it('confidence is between 0 and 1 for all files', async () => {
    await enrichPrecomputeScores(driver, PROJECT_ID);
    const session = driver.session();
    try {
      const r = await session.run(
        `MATCH (sf:SourceFile {projectId: $pid})
         WHERE sf.confidenceScore < 0 OR sf.confidenceScore > 1
         RETURN sf.name AS name, sf.confidenceScore AS conf`,
        { pid: PROJECT_ID },
      );
      expect(r.records).toEqual([]);
    } finally {
      await session.close();
    }
  });

  it('files with zero functions, zero TESTED_BY, and zero VR evidence do not default to 100% confidence', async () => {
    await enrichPrecomputeScores(driver, PROJECT_ID);
    const session = driver.session();
    try {
      // Files with no functions, no TESTED_BY, AND no VR evidence should have conf ≤ VR baseline
      // (they may still get non-zero confidence from VR ANALYZED edges)
      const r = await session.run(
        `MATCH (sf:SourceFile {projectId: $pid})
         OPTIONAL MATCH (sf)-[:CONTAINS]->(f:Function {projectId: $pid})
         WITH sf, count(f) AS fnCount
         WHERE fnCount = 0
         OPTIONAL MATCH (sf)-[:TESTED_BY]->(tf)
         WITH sf, fnCount, count(tf) AS testedByCount
         WHERE testedByCount = 0
         OPTIONAL MATCH (vr:VerificationRun)-[:ANALYZED]->(sf)
         WITH sf, fnCount, testedByCount, count(vr) AS vrCount
         WHERE vrCount = 0
         RETURN sf.name AS name, sf.confidenceScore AS conf
         LIMIT 50`,
        { pid: PROJECT_ID },
      );

      // Files with truly zero evidence from all sources must have conf = 0
      if (r.records.length > 0) {
        const nonZero = r.records
          .map((rec) => ({ name: rec.get('name') as string, conf: Number(rec.get('conf') ?? 0) }))
          .filter((x) => x.conf > 0.000001);
        expect(nonZero).toEqual([]);
      }
    } finally {
      await session.close();
    }
  });

  it('adjustedPain = painScore * (1 + (1 - confidenceScore)) for all files', async () => {
    await enrichPrecomputeScores(driver, PROJECT_ID);
    const session = driver.session();
    try {
      const r = await session.run(
        `MATCH (sf:SourceFile {projectId: $pid})
         WHERE sf.painScore IS NOT NULL
         WITH sf, sf.painScore * (1.0 + (1.0 - sf.confidenceScore)) AS expected
         WHERE abs(sf.adjustedPain - expected) > 0.001
         RETURN sf.name AS name, sf.adjustedPain AS actual, expected`,
        { pid: PROJECT_ID },
      );
      const mismatches = r.records.map((rec) => ({
        name: rec.get('name'),
        actual: rec.get('actual'),
        expected: rec.get('expected'),
      }));
      expect(mismatches).toEqual([]);
    } finally {
      await session.close();
    }
  });
});
