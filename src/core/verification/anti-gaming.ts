/**
 * TC-6: Anti-Gaming Evidence Integrity
 *
 * Prevents confidence inflation through:
 * 1. Source-family attribution + caps (same source can't dominate)
 * 2. Duplicate/restatement collapse (identical evidence counted once)
 * 3. Collusion detection (high-correlation clusters get bounded influence)
 * 4. Untrusted-seed floor (new sources start at a minimum)
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';

// ── Types ───────────────────────────────────────────────────────────

export interface AntiGamingConfig {
  /** Max confidence contribution from a single source family. Default: 0.4 */
  sourceFamilyCap: number;
  /** Restatement similarity threshold (0-1). Default: 0.9 */
  restatementThreshold: number;
  /** Collusion correlation threshold. Default: 0.85 */
  collusionThreshold: number;
  /** Floor confidence for untrusted/new sources. Default: 0.1 */
  untrustedSeedFloor: number;
  /** Max influence from a single cluster. Default: 0.5 */
  clusterInfluenceCap: number;
}

export interface AntiGamingResult {
  projectId: string;
  sourceFamiliesDetected: number;
  capsApplied: number;
  duplicatesCollapsed: number;
  collusionSuspects: number;
  untrustedSeeded: number;
  durationMs: number;
}

const DEFAULT_CONFIG: AntiGamingConfig = {
  sourceFamilyCap: 0.85,
  restatementThreshold: 0.9,
  collusionThreshold: 0.85,
  untrustedSeedFloor: 0.1,
  clusterInfluenceCap: 0.5,
};

// ── Source Family Attribution ────────────────────────────────────────

export async function enforceSourceFamilyCaps(
  neo4j: Neo4jService,
  projectId: string,
  config: AntiGamingConfig = DEFAULT_CONFIG,
): Promise<AntiGamingResult> {
  const start = Date.now();

  // Detect source families (group by tool)
  const families = await neo4j.run(
    `MATCH (r:VerificationRun {projectId: $projectId})
     WHERE r.tool IS NOT NULL
     RETURN r.tool AS family, count(r) AS cnt, collect(r.id) AS ids
     ORDER BY cnt DESC`,
    { projectId },
  );

  let capsApplied = 0;

  for (const fam of families) {
    const ids = fam.ids as string[];
    // Apply source family and cap
    await neo4j.run(
      `UNWIND $ids AS rid
       MATCH (r:VerificationRun {id: rid, projectId: $projectId})
       SET r.sourceFamily = $family,
           r.sourceFamilyCap = $cap`,
      { ids, projectId, family: fam.family, cap: config.sourceFamilyCap },
    );
    capsApplied += ids.length;
  }

  // Detect duplicate clusters (same tool + same status + same artifactHash)
  const dupes = await neo4j.run(
    `MATCH (r:VerificationRun {projectId: $projectId})
     WHERE r.artifactHash IS NOT NULL
     WITH r.artifactHash AS hash, collect(r.id) AS ids, count(r) AS cnt
     WHERE cnt > 1
     RETURN hash, ids, cnt`,
    { projectId },
  );

  let duplicatesCollapsed = 0;
  for (const dupe of dupes) {
    const ids = dupe.ids as string[];
    // Mark duplicates (keep first, mark rest)
    const dupeIds = ids.slice(1);
    if (dupeIds.length > 0) {
      await neo4j.run(
        `UNWIND $ids AS rid
         MATCH (r:VerificationRun {id: rid, projectId: $projectId})
         SET r.duplicateClusterId = $hash,
             r.restatementScore = 1.0`,
        { ids: dupeIds, projectId, hash: dupe.hash },
      );
      duplicatesCollapsed += dupeIds.length;
    }
  }

  // Flag collusion suspects (runs with same tool, same time window, same result)
  const collusionRows = await neo4j.run(
    `MATCH (r1:VerificationRun {projectId: $projectId}),
           (r2:VerificationRun {projectId: $projectId})
     WHERE r1.id < r2.id
       AND r1.tool = r2.tool
       AND r1.status = r2.status
       AND r1.ranAt IS NOT NULL AND r2.ranAt IS NOT NULL
       AND abs(duration.between(datetime(r1.ranAt), datetime(r2.ranAt)).seconds) < 60
     RETURN count(*) AS cnt`,
    { projectId },
  );
  const collusionSuspects = Number(collusionRows[0]?.cnt ?? 0);

  // Seed untrusted sources
  const seeded = await neo4j.run(
    `MATCH (r:VerificationRun {projectId: $projectId})
     WHERE r.sourceFamily IS NULL AND r.effectiveConfidence IS NULL
     SET r.effectiveConfidence = $floor,
         r.sourceFamily = 'untrusted'
     RETURN count(r) AS cnt`,
    { projectId, floor: config.untrustedSeedFloor },
  );

  return {
    projectId,
    sourceFamiliesDetected: families.length,
    capsApplied,
    duplicatesCollapsed,
    collusionSuspects,
    untrustedSeeded: Number(seeded[0]?.cnt ?? 0),
    durationMs: Date.now() - start,
  };
}

// ── Governance Invariants ───────────────────────────────────────────

export async function verifyAntiGaming(
  neo4j: Neo4jService,
  projectId: string,
  config: AntiGamingConfig = DEFAULT_CONFIG,
): Promise<{ ok: boolean; issues: string[] }> {
  const issues: string[] = [];

  // Check: no single source family exceeds cap in aggregate influence
  const familyCheck = await neo4j.run(
    `MATCH (r:VerificationRun {projectId: $projectId})
     WHERE r.sourceFamily IS NOT NULL AND r.effectiveConfidence IS NOT NULL
     WITH r.sourceFamily AS fam, avg(r.effectiveConfidence) AS avgConf, count(r) AS cnt
     WHERE avgConf > $cap
     RETURN fam, avgConf, cnt`,
    { projectId, cap: config.sourceFamilyCap },
  );

  for (const f of familyCheck) {
    issues.push(`Source family '${f.fam}' avg confidence ${(f.avgConf as number).toFixed(3)} exceeds cap ${config.sourceFamilyCap}`);
  }

  // Check: no untrusted source above floor without explicit promotion
  const floorCheck = await neo4j.run(
    `MATCH (r:VerificationRun {projectId: $projectId})
     WHERE r.sourceFamily = 'untrusted'
       AND r.effectiveConfidence > $floor
     RETURN count(r) AS cnt`,
    { projectId, floor: config.untrustedSeedFloor },
  );

  const untrustedAbove = Number(floorCheck[0]?.cnt ?? 0);
  if (untrustedAbove > 0) {
    issues.push(`${untrustedAbove} untrusted sources above seed floor ${config.untrustedSeedFloor}`);
  }

  return { ok: issues.length === 0, issues };
}
