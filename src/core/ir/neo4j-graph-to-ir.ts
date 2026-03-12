import { Neo4jEdge, Neo4jNode } from '../config/schema.js';

import { IrDocument, IrEdgeType, IrNodeType } from './ir-v1.schema.js';

function mapIrNodeType(node: Neo4jNode): IrNodeType {
  const labels = new Set(node.labels);
  const coreType = String(node.properties.coreType ?? '');

  if (labels.has('SourceFile') || coreType.includes('SOURCE_FILE')) return 'Artifact';
  if (labels.has('Class') || labels.has('Interface')) return 'Container';
  if (labels.has('Function') || labels.has('Method') || labels.has('Variable') || labels.has('TypeAlias')) {
    return 'Symbol';
  }
  if (labels.has('Import') || labels.has('Parameter')) return 'Site';
  if (labels.has('Field') || labels.has('Entrypoint') || labels.has('Author') || labels.has('Project')) return 'Entity';
  return 'Assertion';
}

function mapIrEdgeType(edge: Neo4jEdge): IrEdgeType {
  switch (edge.type) {
    case 'CONTAINS':
    case 'CALLS':
    case 'IMPORTS':
    case 'RESOLVES_TO':
      return edge.type;
    case 'HAS_PARAMETER':
    case 'HAS_MEMBER':
      return 'DECLARES';
    default:
      return 'REFERENCES';
  }
}

export function convertNeo4jGraphToIrDocument(
  nodes: Neo4jNode[],
  edges: Neo4jEdge[],
  projectId: string,
  sourceRoot?: string,
): IrDocument {
  return {
    version: 'ir.v1',
    projectId,
    sourceKind: 'code',
    generatedAt: new Date().toISOString(),
    sourceRoot,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: mapIrNodeType(node),
      kind: String(node.properties.coreType ?? node.labels[0] ?? 'Unknown'),
      name: String(node.properties.name ?? node.id),
      projectId,
      sourcePath: typeof node.properties.filePath === 'string' ? node.properties.filePath : undefined,
      language: 'typescript',
      parserTier: 0,
      confidence: 1,
      provenanceKind: 'parser',
      range:
        typeof node.properties.startLine === 'number'
          ? {
              startLine: Number(node.properties.startLine),
              endLine: typeof node.properties.endLine === 'number' ? Number(node.properties.endLine) : undefined,
            }
          : undefined,
      properties: node.properties as unknown as Record<string, unknown>,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      type: mapIrEdgeType(edge),
      from: edge.startNodeId,
      to: edge.endNodeId,
      projectId,
      parserTier: 0,
      confidence: typeof edge.properties.confidence === 'number' ? Number(edge.properties.confidence) : 1,
      provenanceKind: 'parser',
      properties: edge.properties as unknown as Record<string, unknown>,
    })),
    metadata: {
      originalNodeCount: nodes.length,
      originalEdgeCount: edges.length,
      converter: 'convertNeo4jGraphToIrDocument',
    },
  };
}
