/**
 * Scope-Aware Resolver (VG-3)
 *
 * Post-ingestion pass that:
 * 1. Recomputes scopeCompleteness from AnalysisScope metadata
 * 2. Enforces: "no findings" only increases confidence when scope is complete
 * 3. Enforces: critical mappings outside analyzed scope -> UNKNOWN_FOR
 * 4. Caps evidence grade for runs with suppressed internal errors unless corroborated
 * 5. Detects contradictions across static/dynamic/adjudication evidence
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';

export interface ScopeResolverResult {
  scopeRecomputed: number;
  cleanRunsDowngraded: number;
  unknownForEdgesCreated: number;
  evidenceGradeCapped: number;
  contradictionsDetected: number;
}

/**
 * Recompute scopeCompleteness for all AnalysisScope nodes in a project.
 * Uses targetFileCount / analyzedFileCount / analysisErrorCount / skippedFileCount.
 */
async function recomputeScopeCompleteness(
  neo4j: Neo4jService,
  projectId: string,
): Promise<number> {
  // Mark scopes with errors as partial
  const errorResult = await neo4j.run(
    `MATCH (s:AnalysisScope {projectId: $projectId})
     WHERE s.analysisErrorCount > 0 AND s.scopeCompleteness <> 'partial'
     SET s.scopeCompleteness = 'partial', s.updatedAt = toString(datetime())
     RETURN count(s) AS updated`,
    { projectId },
  );
  let updated = (errorResult[0]?.updated as any)?.toNumber?.() ?? errorResult[0]?.updated ?? 0;

  // Mark scopes with all files analyzed and no skips/errors as complete
  const completeResult = await neo4j.run(
    `MATCH (s:AnalysisScope {projectId: $projectId})
     WHERE s.targetFileCount > 0
       AND s.analyzedFileCount >= s.targetFileCount
       AND coalesce(s.skippedFileCount, 0) = 0
       AND coalesce(s.analysisErrorCount, 0) = 0
       AND s.scopeCompleteness <> 'complete'
     SET s.scopeCompleteness = 'complete', s.updatedAt = toString(datetime())
     RETURN count(s) AS updated`,
    { projectId },
  );
  updated += (completeResult[0]?.updated as any)?.toNumber?.() ?? completeResult[0]?.updated ?? 0;

  // Mark scopes with zero analyzed files as unknown
  const unknownResult = await neo4j.run(
    `MATCH (s:AnalysisScope {projectId: $projectId})
     WHERE coalesce(s.analyzedFileCount, 0) = 0
       AND coalesce(s.analysisErrorCount, 0) = 0
       AND s.scopeCompleteness <> 'unknown'
     SET s.scopeCompleteness = 'unknown', s.updatedAt = toString(datetime())
     RETURN count(s) AS updated`,
    { projectId },
  );
  updated += (unknownResult[0]?.updated as any)?.toNumber?.() ?? unknownResult[0]?.updated ?? 0;

  // Mark remaining scopes with partial analyzed as partial
  const partialResult = await neo4j.run(
    `MATCH (s:AnalysisScope {projectId: $projectId})
     WHERE s.targetFileCount > 0
       AND s.analyzedFileCount > 0
       AND s.analyzedFileCount < s.targetFileCount
       AND s.scopeCompleteness <> 'partial'
     SET s.scopeCompleteness = 'partial', s.updatedAt = toString(datetime())
     RETURN count(s) AS updated`,
    { projectId },
  );
  updated += (partialResult[0]?.updated as any)?.toNumber?.() ?? partialResult[0]?.updated ?? 0;

  return updated;
}

/**
 * Enforce: clean runs (status=satisfies, ruleId=__clean_run__) should NOT
 * have confidence > 0.5 unless their scope is 'complete'.
 * If scope is partial/unknown, downgrade status to 'unknown' and confidence to 0.3.
 */
async function downgradeCleanRunsWithIncompleteScope(
  neo4j: Neo4jService,
  projectId: string,
): Promise<number> {
  const result = await neo4j.run(
    `MATCH (r:VerificationRun {projectId: $projectId})
     WHERE r.ruleId = '__clean_run__' AND r.status = 'satisfies'
     MATCH (r)-[:HAS_SCOPE]->(s:AnalysisScope)
     WHERE s.scopeCompleteness IN ['partial', 'unknown']
     SET r.status = 'unknown',
         r.confidence = 0.3,
         r.lifecycleState = 'scope_downgraded',
         r.updatedAt = toString(datetime())
     RETURN count(r) AS downgraded`,
    { projectId },
  );
  return (result[0]?.downgraded as any)?.toNumber?.() ?? result[0]?.downgraded ?? 0;
}

/**
 * Enforce: critical-mapped functions/modules outside analyzed scope → UNKNOWN_FOR.
 * Uses APPLIES_TO (Spec/Invariant → Function) and AnalysisScope.includedPaths.
 *
 * For v1: if there are critical Spec/Invariant nodes with APPLIES_TO targets,
 * and those targets are NOT in any complete AnalysisScope's includedPaths,
 * create UNKNOWN_FOR edges from the target to the Spec/Invariant.
 *
 * If no Spec/Invariant nodes exist yet (pre-VG-5), this is a no-op.
 */
async function enforceUnknownForUncoveredCritical(
  neo4j: Neo4jService,
  projectId: string,
): Promise<number> {
  // Check if any Spec/Invariant nodes exist
  const specCheck = await neo4j.run(
    `MATCH (s {projectId: $projectId})
     WHERE s:Spec OR s:Invariant
     RETURN count(s) AS c`,
    { projectId },
  );
  const specCount = (specCheck[0]?.c as any)?.toNumber?.() ?? specCheck[0]?.c ?? 0;
  if (specCount === 0) return 0; // no specs yet, nothing to enforce

  // Find critical APPLIES_TO targets not in any complete scope
  const result = await neo4j.run(
    `MATCH (spec)-[:APPLIES_TO]->(target)
     WHERE spec.projectId = $projectId
       AND spec.criticality IN ['high', 'safety_critical']
       AND (spec:Spec OR spec:Invariant)
     WITH DISTINCT target, spec
     OPTIONAL MATCH (r:VerificationRun {projectId: $projectId})-[:HAS_SCOPE]->(scope:AnalysisScope {scopeCompleteness: 'complete'})
     WHERE target.name IN scope.includedPaths OR target.filePath IN scope.includedPaths
     WITH target, spec, count(scope) AS coveredScopes
     WHERE coveredScopes = 0
     MERGE (target)-[u:UNKNOWN_FOR]->(spec)
     SET u.projectId = $projectId,
         u.reason = 'critical_target_outside_complete_scope',
         u.createdAt = toString(datetime())
     RETURN count(u) AS created`,
    { projectId },
  );
  return (result[0]?.created as any)?.toNumber?.() ?? result[0]?.created ?? 0;
}

/**
 * Cap evidence grade for runs whose AnalysisScope has suppressedErrors=true,
 * unless another run (different tool) corroborates the same finding.
 * Cap: A2 → A3 max.
 */
async function capGradeForSuppressedErrors(
  neo4j: Neo4jService,
  projectId: string,
): Promise<number> {
  const result = await neo4j.run(
    `MATCH (r:VerificationRun {projectId: $projectId})-[:HAS_SCOPE]->(s:AnalysisScope {suppressedErrors: true})
     WHERE r.evidenceGrade IN ['A1', 'A2']
     // Check for corroborating run from different tool on same fingerprint
     OPTIONAL MATCH (r2:VerificationRun {projectId: $projectId, resultFingerprint: r.resultFingerprint})
     WHERE r2.tool <> r.tool AND r2.id <> r.id
     WITH r, count(r2) AS corroborations
     WHERE corroborations = 0
     SET r.evidenceGrade = 'A3',
         r.updatedAt = toString(datetime())
     RETURN count(r) AS capped`,
    { projectId },
  );
  return (result[0]?.capped as any)?.toNumber?.() ?? result[0]?.capped ?? 0;
}

/**
 * Detect contradictions: same target (by resultFingerprint or ruleId+location)
 * has both 'satisfies' and 'violates' status from different runs.
 * Does NOT auto-resolve — flags as contradiction for human review.
 */
async function detectContradictions(
  neo4j: Neo4jService,
  projectId: string,
): Promise<number> {
  const result = await neo4j.run(
    `MATCH (r1:VerificationRun {projectId: $projectId, status: 'satisfies'})
     MATCH (r2:VerificationRun {projectId: $projectId, status: 'violates'})
     WHERE r1.resultFingerprint = r2.resultFingerprint
       AND r1.id <> r2.id
     WITH r1, r2
     SET r1.hasContradiction = true,
         r2.hasContradiction = true,
         r1.updatedAt = toString(datetime()),
         r2.updatedAt = toString(datetime())
     WITH collect(DISTINCT r1.id) + collect(DISTINCT r2.id) AS allIds
     UNWIND allIds AS uid
     WITH collect(DISTINCT uid) AS uniqueIds
     RETURN size(uniqueIds) AS flagged`,
    { projectId },
  );
  return (result[0]?.flagged as any)?.toNumber?.() ?? result[0]?.flagged ?? 0;
}

/**
 * Run the full scope-aware resolver pass for a project.
 */
export async function runScopeResolver(projectId: string): Promise<ScopeResolverResult> {
  const neo4j = new Neo4jService();

  try {
    const scopeRecomputed = await recomputeScopeCompleteness(neo4j, projectId);
    const cleanRunsDowngraded = await downgradeCleanRunsWithIncompleteScope(neo4j, projectId);
    const unknownForEdgesCreated = await enforceUnknownForUncoveredCritical(neo4j, projectId);
    const evidenceGradeCapped = await capGradeForSuppressedErrors(neo4j, projectId);
    const contradictionsDetected = await detectContradictions(neo4j, projectId);

    return {
      scopeRecomputed,
      cleanRunsDowngraded,
      unknownForEdgesCreated,
      evidenceGradeCapped,
      contradictionsDetected,
    };
  } finally {
    await neo4j.close();
  }
}
