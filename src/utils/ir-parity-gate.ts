import { createHash } from 'crypto';
import { basename } from 'path';

import { Neo4jEdge, Neo4jNode } from '../core/config/schema.js';
import { ParserFactory } from '../core/parsers/parser-factory.js';
import { resolveProjectId } from '../core/utils/project-id.js';
import { Neo4jService } from '../storage/neo4j/neo4j.service.js';
import { IrDocument, IrEdgeType, IrNodeType } from '../core/ir/ir-v1.schema.js';
import { validateIrDocument } from '../core/ir/ir-validator.js';
import { materializeIrDocument } from '../core/ir/ir-materializer.js';

interface TargetProject {
  name: string;
  workspacePath: string;
  tsconfigPath: string;
}

const TARGETS: TargetProject[] = [
  {
    name: 'codegraph',
    workspacePath: '/home/jonathan/.openclaw/workspace/codegraph',
    tsconfigPath: '/home/jonathan/.openclaw/workspace/codegraph/tsconfig.json',
  },
  {
    name: 'godspeed',
    workspacePath: '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed',
    tsconfigPath: '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed/tsconfig.json',
  },
  {
    name: 'bible-graph',
    workspacePath: '/home/jonathan/.openclaw/workspace/bible-graph',
    tsconfigPath: '/home/jonathan/.openclaw/workspace/bible-graph/tsconfig.json',
  },
];

function mapIrNodeType(node: Neo4jNode): IrNodeType {
  const labels = new Set(node.labels);
  const coreType = String(node.properties.coreType ?? '');

  if (labels.has('SourceFile') || coreType.includes('SOURCE_FILE')) return 'Artifact';
  if (labels.has('Class') || labels.has('Interface')) return 'Container';
  if (labels.has('Function') || labels.has('Method') || labels.has('Variable') || labels.has('TypeAlias')) return 'Symbol';
  if (labels.has('Import') || labels.has('Parameter')) return 'Site';
  if (labels.has('Field') || labels.has('Entrypoint') || labels.has('Author')) return 'Entity';
  return 'Assertion';
}

function mapIrEdgeType(edge: Neo4jEdge): IrEdgeType {
  switch (edge.type) {
    case 'CONTAINS':
    case 'CALLS':
    case 'IMPORTS':
    case 'RESOLVES_TO':
    case 'MENTIONS':
      return edge.type;
    case 'HAS_PARAMETER':
    case 'HAS_MEMBER':
      return 'DECLARES';
    case 'REGISTERED_BY':
    case 'READS_STATE':
    case 'WRITES_STATE':
    case 'POSSIBLE_CALL':
    case 'CO_CHANGES_WITH':
    case 'OWNED_BY':
    case 'BELONGS_TO_LAYER':
    case 'ORIGINATES_IN':
    case 'FOUND':
    case 'MEASURED':
      return 'REFERENCES';
    default:
      return 'REFERENCES';
  }
}

function toIrDocument(nodes: Neo4jNode[], edges: Neo4jEdge[], projectId: string): IrDocument {
  return {
    version: 'ir.v1',
    projectId,
    sourceKind: 'code',
    generatedAt: new Date().toISOString(),
    nodes: nodes.map((node) => ({
      id: node.id,
      type: mapIrNodeType(node),
      kind: String(node.properties.coreType ?? node.labels[0] ?? 'Unknown'),
      name: String(node.properties.name ?? basename(String(node.properties.filePath ?? node.id))),
      projectId,
      sourcePath: node.properties.filePath ? String(node.properties.filePath) : undefined,
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
      properties: {
        coreType: node.properties.coreType,
        semanticType: node.properties.semanticType,
        filePath: node.properties.filePath,
        isExported: node.properties.isExported,
      } as Record<string, unknown>,
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
      properties: {
        resolutionKind: (edge.properties as unknown as Record<string, unknown>).resolutionKind,
        conditional: (edge.properties as unknown as Record<string, unknown>).conditional,
        isAsync: (edge.properties as unknown as Record<string, unknown>).isAsync,
      } as Record<string, unknown>,
    })),
    metadata: {
      originalNodeCount: nodes.length,
      originalEdgeCount: edges.length,
    },
  };
}

async function run(): Promise<void> {
  const neo4j = new Neo4jService();
  const summary: Array<Record<string, unknown>> = [];

  for (const target of TARGETS) {
    console.log(`\n=== IR parity: ${target.name} ===`);
    const baseProjectId = resolveProjectId(target.workspacePath);
    const testHash = createHash('md5').update(`${baseProjectId}:ir-parity`).digest('hex').slice(0, 12);
    const testProjectId = `proj_${testHash}`;

    const parser = await ParserFactory.createParserWithAutoDetection(
      target.workspacePath,
      target.tsconfigPath,
      testProjectId,
      true,
    );

    await parser.parseWorkspace();
    const graph = parser.exportToJson();

    const irDoc = toIrDocument(graph.nodes, graph.edges, testProjectId);
    const validation = validateIrDocument(irDoc);

    if (!validation.ok) {
      throw new Error(`IR validation failed for ${target.name}:\n${validation.errors.join('\n')}`);
    }

    const result = await materializeIrDocument(irDoc, { batchSize: 100, clearProjectFirst: true });

    const counts = await neo4j.run(
      `MATCH (n {projectId: $projectId})
       OPTIONAL MATCH ()-[r]->()
       WHERE r.projectId = $projectId
       RETURN count(DISTINCT n) AS nodeCount, count(DISTINCT r) AS edgeCount`,
      { projectId: testProjectId },
    );

    summary.push({
      target: target.name,
      sourceNodes: graph.nodes.length,
      sourceEdges: graph.edges.length,
      irNodesCreated: result.nodesCreated,
      irEdgesCreated: result.edgesCreated,
      materializedNodes: Number(counts?.[0]?.nodeCount ?? 0),
      materializedEdges: Number(counts?.[0]?.edgeCount ?? 0),
      projectId: testProjectId,
    });

    // cleanup temp validation project
    await neo4j.run(`MATCH (n {projectId: $projectId}) DETACH DELETE n`, { projectId: testProjectId });
  }

  console.log('\n=== IR PARITY SUMMARY ===');
  for (const row of summary) {
    console.log(JSON.stringify(row));
  }

  // Basic gate: no data loss during materialization
  const failed = summary.filter(
    (row) =>
      Number(row.sourceNodes) !== Number(row.irNodesCreated) ||
      Number(row.sourceEdges) !== Number(row.irEdgesCreated),
  );

  if (failed.length > 0) {
    console.error('\nIR parity gate FAILED');
    process.exit(1);
  }

  console.log('\nIR parity gate PASSED');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
