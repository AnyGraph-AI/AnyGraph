/**
 * RF-2: Graph Resolver — resolves file paths to AffectedNode[] via Neo4j
 *
 * Queries:
 *   1. Match SourceFile nodes by filePath
 *   2. Get contained Functions with riskTier + compositeRisk
 *   3. Check TESTED_BY edges for test coverage
 *   4. Return AffectedNode[] for the enforcement gate
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import type { AffectedNode } from './enforcement-gate.js';

/**
 * Resolve file paths to affected nodes via graph queries.
 *
 * Cypher pattern:
 *   MATCH (sf:SourceFile)-[:CONTAINS]->(f:Function)
 *   WHERE sf.filePath IN $filePaths AND sf.projectId = $projectId
 *   OPTIONAL MATCH (sf)-[:TESTED_BY]->(tf)
 *   RETURN f.id, f.name, sf.filePath, f.riskTier, f.compositeRisk, tf IS NOT NULL AS hasTests
 */
export async function resolveAffectedNodes(
  neo4j: Neo4jService,
  filePaths: string[],
  projectId: string,
): Promise<AffectedNode[]> {
  if (filePaths.length === 0) return [];

  const result = await neo4j.run(`
    MATCH (sf:SourceFile {projectId: $projectId})-[:CONTAINS]->(f)
    WHERE sf.filePath IN $filePaths
      AND (f:Function OR f:Method)
    OPTIONAL MATCH (sf)-[:TESTED_BY]->(tf)
    WITH f, sf, count(tf) > 0 AS hasTests
    RETURN
      f.id AS id,
      f.name AS name,
      sf.filePath AS filePath,
      coalesce(f.riskTier, 'LOW') AS riskTier,
      coalesce(f.compositeRisk, 0.0) AS compositeRisk,
      hasTests
    ORDER BY f.compositeRisk DESC
  `, { filePaths, projectId });

  return (result as any[]).map(r => ({
    id: r.id,
    name: r.name,
    filePath: r.filePath,
    riskTier: r.riskTier,
    compositeRisk: typeof r.compositeRisk?.toNumber === 'function'
      ? r.compositeRisk.toNumber()
      : Number(r.compositeRisk) || 0,
    hasTests: Boolean(r.hasTests),
  }));
}

/**
 * Get blast radius: all functions transitively reachable from affected functions.
 * Uses CALLS edges to find downstream impact.
 */
export async function resolveBlastRadius(
  neo4j: Neo4jService,
  functionIds: string[],
  projectId: string,
  maxDepth: number = 3,
): Promise<AffectedNode[]> {
  if (functionIds.length === 0) return [];

  const result = await neo4j.run(`
    MATCH (root {projectId: $projectId})
    WHERE root.id IN $functionIds
    MATCH (root)-[:CALLS*1..${maxDepth}]->(downstream {projectId: $projectId})
    WHERE NOT downstream.id IN $functionIds
    WITH DISTINCT downstream
    OPTIONAL MATCH (sf:SourceFile {projectId: $projectId})-[:CONTAINS]->(downstream)
    OPTIONAL MATCH (sf)-[:TESTED_BY]->(tf)
    WITH downstream, sf, count(tf) > 0 AS hasTests
    RETURN
      downstream.id AS id,
      downstream.name AS name,
      coalesce(sf.filePath, downstream.filePath) AS filePath,
      coalesce(downstream.riskTier, 'LOW') AS riskTier,
      coalesce(downstream.compositeRisk, 0.0) AS compositeRisk,
      hasTests
    ORDER BY compositeRisk DESC
  `, { functionIds, projectId });

  return (result as any[]).map(r => ({
    id: r.id,
    name: r.name,
    filePath: r.filePath || 'unknown',
    riskTier: r.riskTier,
    compositeRisk: typeof r.compositeRisk?.toNumber === 'function'
      ? r.compositeRisk.toNumber()
      : Number(r.compositeRisk) || 0,
    hasTests: Boolean(r.hasTests),
  }));
}
