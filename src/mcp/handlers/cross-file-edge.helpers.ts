/**
 * Cross-File Edge Helpers
 * Shared utilities for managing cross-file edges during incremental parsing
 */

import type { ExistingNode } from '../../core/parsers/typescript-parser.js';
import { Neo4jService, QUERIES } from '../../storage/neo4j/neo4j.service.js';

export interface CrossFileEdge {
  startNodeId: string;
  endNodeId: string;
  edgeType: string;
  edgeProperties: Record<string, unknown>;
}

/**
 * Enrichment-owned properties that must be preserved across reparse.
 * The parser doesn't set these — enrichment scripts do.
 * If we delete+recreate nodes, these get lost.
 */
const ENRICHMENT_PROPERTIES = [
  'riskTier', 'compositeRisk', 'riskFlags', 'riskLevel', 'riskLevelV2',
  'commitCount', 'commitCountRaw', 'commitCountWindowed', 'churnRelative', 'churnTotal',
  'authorEntropy', 'symbolHash',
  'gitChangeFrequency', 'gitChangeCount',
];

export interface SavedEnrichmentData {
  nodeId: string;
  properties: Record<string, unknown>;
}

/**
 * Save enrichment properties from nodes before deletion.
 * Returns a map of nodeId → enrichment properties.
 */
export const saveEnrichmentProperties = async (
  neo4jService: Neo4jService,
  filePaths: string[],
  projectId: string,
): Promise<SavedEnrichmentData[]> => {
  const propsToReturn = ENRICHMENT_PROPERTIES.map(p => `${p}: n.${p}`).join(', ');
  const result = await neo4jService.run(`
    MATCH (n)
    WHERE n.filePath IN $filePaths AND n.projectId = $projectId
    AND n.id IS NOT NULL
    AND (${ENRICHMENT_PROPERTIES.map(p => `n.${p} IS NOT NULL`).join(' OR ')})
    RETURN n.id AS nodeId, {${propsToReturn}} AS props
  `, { filePaths, projectId });

  return (result as any[]).map(r => ({
    nodeId: r.nodeId,
    properties: Object.fromEntries(
      Object.entries(r.props).filter(([_, v]) => v !== null && v !== undefined),
    ),
  }));
};

/**
 * Restore enrichment properties to nodes after recreation.
 */
export const restoreEnrichmentProperties = async (
  neo4jService: Neo4jService,
  savedData: SavedEnrichmentData[],
  projectId: string,
): Promise<number> => {
  if (savedData.length === 0) return 0;

  let restored = 0;
  for (const { nodeId, properties } of savedData) {
    if (Object.keys(properties).length === 0) continue;
    const result = await neo4jService.run(`
      MATCH (n {id: $nodeId, projectId: $projectId})
      SET n += $props
      RETURN count(n) AS cnt
    `, { nodeId, projectId, props: properties });
    const cnt = (result as any[])[0]?.cnt;
    restored += typeof cnt?.toNumber === 'function' ? cnt.toNumber() : (cnt || 0);
  }
  return restored;
};

export const deleteSourceFileSubgraphs = async (
  neo4jService: Neo4jService,
  filePaths: string[],
  projectId: string,
): Promise<void> => {
  await neo4jService.run(QUERIES.DELETE_SOURCE_FILE_SUBGRAPHS, { filePaths, projectId });
};

export const loadExistingNodesForEdgeDetection = async (
  neo4jService: Neo4jService,
  excludeFilePaths: string[],
  projectId: string,
): Promise<ExistingNode[]> => {
  const queryResult = await neo4jService.run(QUERIES.GET_EXISTING_NODES_FOR_EDGE_DETECTION, {
    excludeFilePaths,
    projectId,
  });
  return queryResult as ExistingNode[];
};

export const getCrossFileEdges = async (
  neo4jService: Neo4jService,
  filePaths: string[],
  projectId: string,
): Promise<CrossFileEdge[]> => {
  const queryResult = await neo4jService.run(QUERIES.GET_CROSS_FILE_EDGES, { filePaths, projectId });
  return queryResult as CrossFileEdge[];
};
