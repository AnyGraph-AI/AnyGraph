/**
 * UI-1: Cypher query constants
 *
 * All queries read pre-computed properties from UI-0.
 * No aggregation, no OPTIONAL MATCH, no multi-hop traversal.
 */

export const QUERIES = {
  /** Pain Heatmap — treemap data */
  painHeatmap: `
    MATCH (sf:SourceFile {projectId: $projectId})
    WHERE sf.adjustedPain > 0
    RETURN sf.name AS name, sf.filePath AS filePath,
           sf.adjustedPain AS adjustedPain,
           sf.confidenceScore AS confidenceScore,
           sf.painScore AS painScore,
           sf.fragility AS fragility
    ORDER BY sf.adjustedPain DESC
    LIMIT $limit
  `,

  /** God Files — ranked table */
  godFiles: `
    MATCH (sf:SourceFile {projectId: $projectId})
    WHERE sf.adjustedPain > 0
    RETURN sf.name AS name, sf.filePath AS filePath,
           sf.adjustedPain AS adjustedPain,
           sf.fragility AS fragility,
           sf.confidenceScore AS confidenceScore,
           sf.basePain AS basePain,
           sf.centrality AS centrality,
           sf.downstreamImpact AS downstreamImpact
    ORDER BY sf.adjustedPain DESC
    LIMIT $limit
  `,

  /** Risk distribution by tier */
  riskDistribution: `
    MATCH (f:Function {projectId: $projectId})
    WHERE f.riskTier IS NOT NULL
    WITH f.riskTier AS tier, count(f) AS count,
         CASE f.riskTier
           WHEN 'CRITICAL' THEN 0
           WHEN 'HIGH' THEN 1
           WHEN 'MEDIUM' THEN 2
           WHEN 'LOW' THEN 3
           ELSE 4
         END AS severity
    RETURN tier, count
    ORDER BY severity ASC
  `,

  /** Project summary with maxima for normalization */
  projectSummary: `
    MATCH (p:Project {projectId: $projectId})
    RETURN p.name AS name, p.projectId AS projectId,
           p.nodeCount AS nodeCount, p.edgeCount AS edgeCount,
           p.maxPainScore AS maxPainScore,
           p.maxAdjustedPain AS maxAdjustedPain,
           p.maxFragility AS maxFragility,
           p.maxCentrality AS maxCentrality
  `,

  /** List all projects */
  listProjects: `
    MATCH (p:Project)
    WHERE EXISTS { MATCH (:SourceFile {projectId: p.projectId}) }
    RETURN p.name AS name, p.projectId AS projectId,
           p.nodeCount AS nodeCount, p.edgeCount AS edgeCount
    ORDER BY p.nodeCount DESC
  `,

  /** Function heatmap — treemap data at function level */
  functionHeatmap: `
    MATCH (f:Function {projectId: $projectId})
    WHERE f.compositeRisk IS NOT NULL
    RETURN f.name AS name,
           coalesce(f.filePath, '') AS filePath,
           coalesce(f.compositeRisk, 0) AS compositeRisk,
           coalesce(f.riskTier, 'MEDIUM') AS riskTier,
           coalesce(f.fanInCount, 0) AS fanIn,
           coalesce(f.fanOutCount, 0) AS fanOut,
           coalesce(f.downstreamImpact, 0) AS downstreamImpact,
           coalesce(f.centralityNormalized, 0) AS centrality
    ORDER BY f.compositeRisk DESC
    LIMIT $limit
  `,

  /** Function god files — ranked table at function level */
  functionGodFiles: `
    MATCH (f:Function {projectId: $projectId})
    WHERE f.compositeRisk IS NOT NULL
    MATCH (sf:SourceFile {projectId: $projectId})-[:CONTAINS]->(f)
    RETURN f.name AS name,
           sf.name AS fileName,
           coalesce(f.compositeRisk, 0) AS compositeRisk,
           coalesce(f.riskTier, 'MEDIUM') AS riskTier,
           coalesce(f.fanInCount, 0) AS fanIn,
           coalesce(f.fanOutCount, 0) AS fanOut,
           coalesce(f.downstreamImpact, 0) AS downstreamImpact,
           coalesce(f.centralityNormalized, 0) AS centrality
    ORDER BY f.compositeRisk DESC
    LIMIT $limit
  `,

  /** Plan health — milestone + task status summary */
  planHealth: `
    MATCH (t:Task)-[:PART_OF]->(m:Milestone)
    WHERE m.projectId = $projectId
    WITH m, t,
         CASE WHEN t.status = 'done' THEN 1 ELSE 0 END AS isDone
    WITH m,
         count(t) AS taskCount,
         sum(isDone) AS doneCount
    WITH collect({
           name: m.name,
           total: taskCount,
           done: doneCount,
           status: m.status
         }) AS milestones,
         sum(taskCount) AS totalTasks,
         sum(doneCount) AS doneTasks
    UNWIND milestones AS ms
    WITH milestones, totalTasks, doneTasks,
         sum(CASE WHEN ms.done = ms.total THEN 1 ELSE 0 END) AS doneMilestones,
         size(milestones) AS totalMilestones
    MATCH (t2:Task {status: 'planned'})-[:PART_OF]->(m2:Milestone)
    WHERE m2.projectId = $projectId
    OPTIONAL MATCH (t2)-[:DEPENDS_ON]->(dep:Task)
    WHERE dep.status <> 'done'
    WITH totalTasks, doneTasks, totalMilestones, doneMilestones,
         t2, collect(dep) AS openDeps
    WITH totalTasks, doneTasks, totalMilestones, doneMilestones,
         sum(CASE WHEN size(openDeps) = 0 THEN 1 ELSE 0 END) AS readyTasks,
         sum(CASE WHEN size(openDeps) > 0 THEN 1 ELSE 0 END) AS blockedTasks
    RETURN totalMilestones, doneMilestones,
           totalTasks, doneTasks,
           readyTasks, blockedTasks
  `,

  /** Reality Gap — files where confidence exceeds evidence depth */
  realityGap: `
    MATCH (sf:SourceFile {projectId: $projectId})
    WHERE sf.adjustedPain IS NOT NULL AND sf.adjustedPain > 0
    OPTIONAL MATCH (sf)-[:CONTAINS]->(fn:Function)
    WITH sf,
         count(fn) AS fnCount,
         max(CASE fn.riskTier
           WHEN 'CRITICAL' THEN 4
           WHEN 'HIGH' THEN 3
           WHEN 'MEDIUM' THEN 2
           ELSE 1
         END) AS maxTierNum,
         coalesce(sf.confidenceScore, 0) AS confidence,
         coalesce(sf.adjustedPain, 0) AS adjustedPain,
         coalesce(sf.fragility, 0) AS fragility
    OPTIONAL MATCH (sf)-[:TESTED_BY]->(tf)
    WITH sf, fnCount, maxTierNum, confidence, adjustedPain, fragility,
         count(DISTINCT tf) AS evidenceCount,
         CASE maxTierNum
           WHEN 4 THEN 5
           WHEN 3 THEN 3
           WHEN 2 THEN 2
           ELSE 1
         END AS expectedEvidence
    WITH sf, fnCount, confidence, adjustedPain, fragility,
         evidenceCount, expectedEvidence,
         CASE WHEN expectedEvidence > 0
           THEN toFloat(expectedEvidence - evidenceCount) / expectedEvidence
           ELSE 0
         END AS gapScore
    WHERE gapScore > 0
    RETURN sf.name AS name,
           confidence AS confidenceScore,
           toInteger(evidenceCount) AS evidenceCount,
           toInteger(expectedEvidence) AS expectedEvidence,
           round(gapScore * 1000) / 1000.0 AS gapScore,
           adjustedPain,
           fragility
    ORDER BY gapScore DESC
    LIMIT $limit
  `,

  /** Fragility Index — files ranked by fragility */
  fragilityIndex: `
    MATCH (sf:SourceFile {projectId: $projectId})
    WHERE sf.fragility IS NOT NULL AND sf.fragility > 0
    RETURN sf.name AS name,
           coalesce(sf.fragility, 0) AS fragility,
           coalesce(sf.confidenceScore, 0) AS confidenceScore,
           coalesce(sf.adjustedPain, 0) AS adjustedPain,
           coalesce(sf.painScore, 0) AS painScore,
           coalesce(sf.centrality, 0) AS centrality
    ORDER BY sf.fragility DESC
    LIMIT $limit
  `,

  /** Safest Action — low risk + high confidence files */
  safestAction: `
    MATCH (sf:SourceFile {projectId: $projectId})
    WHERE sf.adjustedPain IS NOT NULL
      AND sf.confidenceScore IS NOT NULL
      AND sf.confidenceScore > 0.5
    RETURN sf.name AS name,
           coalesce(sf.confidenceScore, 0) AS confidenceScore,
           coalesce(sf.adjustedPain, 0) AS adjustedPain,
           coalesce(sf.fragility, 0) AS fragility,
           coalesce(sf.centrality, 0) AS centrality
    ORDER BY sf.adjustedPain ASC, sf.confidenceScore DESC
    LIMIT $limit
  `,

  /** Risk Over Time — governance metric snapshots */
  riskOverTime: `
    MATCH (g:GovernanceMetricSnapshot {projectId: $projectId})
    RETURN g.timestamp AS timestamp,
           coalesce(g.invariantViolations, 0) AS invariantViolations,
           coalesce(g.interceptionRate, 0) AS interceptionRate,
           coalesce(g.verificationRuns, 0) AS verificationRuns,
           coalesce(g.gateFailures, 0) AS gateFailures,
           coalesce(g.totalRegressionEvents, 0) AS regressions
    ORDER BY g.timestamp ASC
    LIMIT $limit
  `,

  /** Milestone progress — all plan projects (uses $projectId with STARTS WITH for plan_ prefix) */
  milestoneProgress: `
    MATCH (t:Task)-[:PART_OF]->(m:Milestone)
    WHERE m.projectId STARTS WITH $projectId
    WITH m,
         count(t) AS total,
         sum(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done
    RETURN m.name AS milestone,
           m.projectId AS projectId,
           toInteger(done) AS done,
           toInteger(total) AS total,
           round(toFloat(done) / total * 100) AS pct
    ORDER BY m.projectId, m.name
  `,

  /** Recently destabilized — CRITICAL functions updated in a rolling window */
  recentlyDestabilized: `
    MATCH (f:Function {projectId: $projectId})
    WHERE f.riskTier = 'CRITICAL'
      AND f.runtimeCoverageUpdatedAt IS NOT NULL
      AND datetime(f.runtimeCoverageUpdatedAt) >= datetime() - duration({days: $days})
    RETURN f.name AS name,
           f.filePath AS filePath,
           f.runtimeCoverageUpdatedAt AS observedAt,
           coalesce(f.compositeRisk, 0) AS compositeRisk
    ORDER BY datetime(f.runtimeCoverageUpdatedAt) DESC
    LIMIT $limit
  `,

  /** Connection test */
  ping: `RETURN 1 AS ok`,
} as const;
