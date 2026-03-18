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

  /** Reality Gap — high pain, low confidence */
  realityGap: `
    MATCH (sf:SourceFile {projectId: $projectId})
    WHERE sf.fragility > 0
    RETURN sf.name AS name, sf.filePath AS filePath,
           sf.fragility AS fragility,
           sf.painScore AS painScore,
           sf.confidenceScore AS confidenceScore
    ORDER BY sf.fragility DESC
    LIMIT $limit
  `,

  /** Safest Next Action — low risk, high confidence */
  safestAction: `
    MATCH (sf:SourceFile {projectId: $projectId})
    WHERE sf.confidenceScore >= 0.5 AND sf.painScore < $painThreshold
    RETURN sf.name AS name, sf.filePath AS filePath,
           sf.painScore AS painScore,
           sf.confidenceScore AS confidenceScore,
           sf.fragility AS fragility
    ORDER BY sf.fragility ASC
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

  /** Connection test */
  ping: `RETURN 1 AS ok`,
} as const;
