import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { IrDocument, IrEdge, IrNode } from './ir-v1.schema.js';
import { assertValidIrDocument } from './ir-validator.js';

export interface IrMaterializeOptions {
  batchSize?: number;
  clearProjectFirst?: boolean;
}

export interface IrMaterializeResult {
  projectId: string;
  nodesCreated: number;
  edgesCreated: number;
  batches: number;
}

const DEFAULT_BATCH_SIZE = 500;

export class IrMaterializer {
  constructor(private readonly neo4jService: Neo4jService = new Neo4jService()) {}

  async materialize(input: unknown, options: IrMaterializeOptions = {}): Promise<IrMaterializeResult> {
    const doc = assertValidIrDocument(input);
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

    if (options.clearProjectFirst) {
      await this.neo4jService.run(
        `MATCH (n {projectId: $projectId}) DETACH DELETE n`,
        { projectId: doc.projectId },
      );
    }

    const nodeBatches = this.chunk(doc.nodes, batchSize);
    const edgeBatches = this.chunk(doc.edges, batchSize);

    let nodesCreated = 0;
    for (const batch of nodeBatches) {
      const payload = batch.map((n) => this.mapNode(n));
      // MERGE on {id, projectId} to avoid duplicates on re-run without clearProjectFirst.
      // Sets all properties on both CREATE and MATCH to ensure idempotent upserts.
      const result = await this.neo4jService.run(
        `UNWIND $nodes AS nodeData
         CALL apoc.merge.node(nodeData.labels, {id: nodeData.properties.id, projectId: nodeData.properties.projectId}, nodeData.properties) YIELD node
         RETURN count(node) AS created`,
        { nodes: payload },
      );
      nodesCreated += Number(result?.[0]?.created ?? 0);
    }

    let edgesCreated = 0;
    for (const batch of edgeBatches) {
      const payload = batch.map((e) => this.mapEdge(e));
      // Use MERGE-based edge creation to avoid duplicate edges on re-run.
      // Match endpoints by {id, projectId}, merge edge by type + key properties.
      const result = await this.neo4jService.run(
        `UNWIND $edges AS edgeData
         MATCH (start {id: edgeData.startNodeId, projectId: $projectId})
         MATCH (end {id: edgeData.endNodeId, projectId: $projectId})
         CALL apoc.merge.relationship(start, edgeData.type, {projectId: $projectId}, edgeData.properties, end) YIELD rel
         RETURN count(rel) AS created`,
        {
          edges: payload,
          projectId: doc.projectId,
        },
      );
      edgesCreated += Number(result?.[0]?.created ?? 0);
    }

    return {
      projectId: doc.projectId,
      nodesCreated,
      edgesCreated,
      batches: nodeBatches.length + edgeBatches.length,
    };
  }

  private mapNode(node: IrNode): { labels: string[]; properties: Record<string, unknown> } {
    const labels = ['IRNode', node.type];
    return {
      labels,
      properties: {
        id: node.id,
        projectId: node.projectId,
        type: node.type,
        kind: node.kind,
        name: node.name,
        sourcePath: node.sourcePath,
        language: node.language,
        sourceRevision: node.sourceRevision,
        parserTier: node.parserTier,
        confidence: node.confidence,
        provenanceKind: node.provenanceKind,
        range: node.range ? JSON.stringify(node.range) : undefined,
        properties: Object.keys(node.properties ?? {}).length > 0 ? JSON.stringify(node.properties) : undefined,
      },
    };
  }

  private mapEdge(edge: IrEdge): { startNodeId: string; endNodeId: string; type: string; properties: Record<string, unknown> } {
    // Restore original edge type if it was collapsed during IR mapping
    // (e.g., READS_STATE → REFERENCES with originalEdgeType preserved)
    const originalType = edge.properties?.originalEdgeType;
    const edgeType = typeof originalType === 'string' && originalType ? originalType : edge.type;

    return {
      startNodeId: edge.from,
      endNodeId: edge.to,
      type: edgeType,
      properties: {
        id: edge.id,
        projectId: edge.projectId,
        parserTier: edge.parserTier,
        confidence: edge.confidence,
        provenanceKind: edge.provenanceKind,
        properties: Object.keys(edge.properties ?? {}).length > 0 ? JSON.stringify(edge.properties) : undefined,
      },
    };
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  }
}

export async function materializeIrDocument(
  doc: IrDocument,
  options?: IrMaterializeOptions,
): Promise<IrMaterializeResult> {
  const neo4jService = new Neo4jService();
  const materializer = new IrMaterializer(neo4jService);
  try {
    return await materializer.materialize(doc, options);
  } finally {
    await neo4jService.getDriver().close();
  }
}
