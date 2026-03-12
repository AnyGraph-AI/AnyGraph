import { Neo4jEdge, Neo4jNode } from '../config/schema.js';

import { IrDocument, IrEdge, IrEdgeType, IrNodeType } from './ir-v1.schema.js';

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
    case 'REFERENCES':
    case 'MENTIONS':
    case 'QUOTES':
    case 'REGISTERED_BY':
      return edge.type;
    case 'HAS_PARAMETER':
    case 'HAS_MEMBER':
    case 'EXTENDS':
    case 'IMPLEMENTS':
      return 'DECLARES';
    case 'MENTIONS_PERSON':
      return 'MENTIONS';
    default:
      return 'REFERENCES';
  }
}

function toIrEdge(edge: Neo4jEdge, projectId: string): IrEdge {
  const mappedType = mapIrEdgeType(edge);
  const props = { ...(edge.properties as unknown as Record<string, unknown>) };
  // Preserve original edge type when mapping collapses it
  if (mappedType !== edge.type) {
    props.originalEdgeType = edge.type;
  }
  return {
    id: edge.id,
    type: mappedType,
    from: edge.startNodeId,
    to: edge.endNodeId,
    projectId,
    parserTier: 0,
    confidence: typeof edge.properties.confidence === 'number' ? Number(edge.properties.confidence) : 1,
    provenanceKind: 'parser',
    properties: props,
  };
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
    edges: edges.map((edge) => toIrEdge(edge, projectId)),
    metadata: {
      originalNodeCount: nodes.length,
      originalEdgeCount: edges.length,
      converter: 'convertNeo4jGraphToIrDocument',
    },
  };
}

export function convertNeo4jEdgesToIrDocument(
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
    nodes: [],
    edges: edges.map((edge) => toIrEdge(edge, projectId)),
    metadata: {
      originalNodeCount: 0,
      originalEdgeCount: edges.length,
      converter: 'convertNeo4jEdgesToIrDocument',
      allowExternalEdgeEndpoints: true,
    },
  };
}
