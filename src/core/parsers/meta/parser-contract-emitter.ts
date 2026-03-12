import neo4j from 'neo4j-driver';

import {
  type ParserContractGraph,
  type ParserContractNode,
  type ParserContractEdge,
} from './parser-contract-schema.js';

function makePlanParserContractGraph(projectId = 'plan_codegraph'): ParserContractGraph {
  const parserName = 'plan-parser';
  const sourcePath = '/home/jonathan/.openclaw/workspace/codegraph/src/core/parsers/plan-parser.ts';

  const n1: ParserContractNode = {
    id: `${projectId}:parser:${parserName}:stage:parse`,
    projectId,
    parserName,
    stage: 'parse',
    name: 'parse markdown plan files',
    sourcePath,
    functionName: 'parsePlanDirectory',
    emitsNodeTypes: ['PlanProject', 'Milestone', 'Sprint', 'Task', 'Decision'],
    emitsEdgeTypes: ['PART_OF', 'BLOCKS', 'DEPENDS_ON', 'MODIFIES', 'TARGETS', 'BASED_ON', 'SUPERSEDES'],
    readsPlanFields: ['checkbox', 'header', 'table_row', 'status_line'],
    mutatesTaskFields: [],
    confidence: 1,
    createdAt: new Date().toISOString(),
  };

  const n2: ParserContractNode = {
    id: `${projectId}:parser:${parserName}:stage:enrich`,
    projectId,
    parserName,
    stage: 'enrich',
    name: 'cross-domain evidence enrichment',
    sourcePath,
    functionName: 'enrichCrossDomain',
    emitsNodeTypes: [],
    emitsEdgeTypes: ['HAS_CODE_EVIDENCE'],
    readsPlanFields: ['task_name', 'status', 'crossRef'],
    mutatesTaskFields: ['hasCodeEvidence', 'codeEvidenceCount', 'hasSemanticEvidence', 'semanticEvidenceCount'],
    confidence: 1,
    createdAt: new Date().toISOString(),
  };

  const n3: ParserContractNode = {
    id: `${projectId}:parser:${parserName}:stage:materialize`,
    projectId,
    parserName,
    stage: 'materialize',
    name: 'neo4j upsert ingest',
    sourcePath,
    functionName: 'ingestToNeo4j',
    emitsNodeTypes: ['Project'],
    emitsEdgeTypes: ['PART_OF', 'BLOCKS', 'DEPENDS_ON', 'MODIFIES', 'TARGETS', 'BASED_ON', 'SUPERSEDES', 'HAS_CODE_EVIDENCE'],
    readsPlanFields: [],
    mutatesTaskFields: [],
    confidence: 1,
    createdAt: new Date().toISOString(),
  };

  const nodes: ParserContractNode[] = [n1, n2, n3];

  const edges: ParserContractEdge[] = [
    { type: 'NEXT_STAGE', from: n1.id, to: n2.id, projectId, confidence: 1 },
    { type: 'NEXT_STAGE', from: n2.id, to: n3.id, projectId, confidence: 1 },
  ];

  for (const nt of n1.emitsNodeTypes) {
    edges.push({ type: 'EMITS_NODE_TYPE', from: n1.id, to: `${projectId}:meta:nodeType:${nt}`, projectId, confidence: 1 });
  }
  for (const et of n1.emitsEdgeTypes) {
    edges.push({ type: 'EMITS_EDGE_TYPE', from: n1.id, to: `${projectId}:meta:edgeType:${et}`, projectId, confidence: 1 });
  }

  for (const et of n2.emitsEdgeTypes) {
    edges.push({ type: 'EMITS_EDGE_TYPE', from: n2.id, to: `${projectId}:meta:edgeType:${et}`, projectId, confidence: 1 });
  }
  for (const f of n2.readsPlanFields) {
    edges.push({ type: 'READS_PLAN_FIELD', from: n2.id, to: `${projectId}:meta:planField:${f}`, projectId, confidence: 1 });
  }
  for (const f of n2.mutatesTaskFields) {
    edges.push({ type: 'MUTATES_TASK_FIELD', from: n2.id, to: `${projectId}:meta:taskField:${f}`, projectId, confidence: 1 });
  }

  for (const et of n3.emitsEdgeTypes) {
    edges.push({ type: 'EMITS_EDGE_TYPE', from: n3.id, to: `${projectId}:meta:edgeType:${et}`, projectId, confidence: 1 });
  }

  return {
    version: 'parser-contract.v1',
    projectId,
    parserName,
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
  };
}

export async function emitPlanParserContracts(
  neo4jUri: string = process.env.NEO4J_URI ?? 'bolt://localhost:7687',
  neo4jUser: string = process.env.NEO4J_USER ?? 'neo4j',
  neo4jPassword: string = process.env.NEO4J_PASSWORD ?? 'codegraph',
): Promise<{ nodesUpserted: number; edgesUpserted: number }> {
  const graph = makePlanParserContractGraph();

  const driver = neo4j.driver(neo4jUri, neo4j.auth.basic(neo4jUser, neo4jPassword));
  const session = driver.session();

  let nodesUpserted = 0;
  let edgesUpserted = 0;

  try {
    // Contract stage nodes
    for (const node of graph.nodes) {
      await session.run(
        `MERGE (n:ParserContract:CodeNode {id: $id})
         SET n += $props,
             n.coreType = 'ParserContract',
             n.projectId = $projectId`,
        {
          id: node.id,
          projectId: node.projectId,
          props: {
            id: node.id,
            parserName: node.parserName,
            stage: node.stage,
            name: node.name,
            sourcePath: node.sourcePath,
            functionName: node.functionName,
            emitsNodeTypes: node.emitsNodeTypes,
            emitsEdgeTypes: node.emitsEdgeTypes,
            readsPlanFields: node.readsPlanFields,
            mutatesTaskFields: node.mutatesTaskFields,
            confidence: node.confidence,
            createdAt: node.createdAt,
            updatedAt: new Date().toISOString(),
          },
        },
      );
      nodesUpserted += 1;
    }

    // Meta target nodes (type/field dictionaries)
    const metaTargets = new Set(graph.edges.map((e) => e.to));
    for (const targetId of metaTargets) {
      await session.run(
        `MERGE (n:ParserMeta:CodeNode {id: $id})
         SET n.projectId = $projectId,
             n.coreType = 'ParserMeta',
             n.name = $name,
             n.updatedAt = toString(datetime())`,
        {
          id: targetId,
          projectId: graph.projectId,
          name: targetId.split(':').slice(-1)[0],
        },
      );
      nodesUpserted += 1;
    }

    for (const edge of graph.edges) {
      await session.run(
        `MATCH (a:CodeNode {id: $from}), (b:CodeNode {id: $to})
         MERGE (a)-[r:${edge.type}]->(b)
         SET r.projectId = $projectId,
             r.confidence = $confidence,
             r.updatedAt = toString(datetime())`,
        {
          from: edge.from,
          to: edge.to,
          projectId: edge.projectId,
          confidence: edge.confidence,
        },
      );
      edgesUpserted += 1;
    }

    return { nodesUpserted, edgesUpserted };
  } finally {
    await session.close();
    await driver.close();
  }
}
