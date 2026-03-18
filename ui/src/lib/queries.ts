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
    RETURN f.riskTier AS tier, count(f) AS count
    ORDER BY count DESC
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

  /** Connection test */
  ping: `RETURN 1 AS ok`,
} as const;
