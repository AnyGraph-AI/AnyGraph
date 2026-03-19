import { NextResponse } from 'next/server';
import { cachedQuery } from '@/lib/neo4j';

const DEFAULT_PROJECT_ID = 'proj_c0d3e9a1f200';
const API_NODE_CAP = 200;
const ABSOLUTE_NODE_CAP = 500;

type GraphNode = {
  id: string;
  name: string | null;
  filePath: string | null;
  labels: string[];
  riskTier: string;
  projectId: string | null;
};

type GraphEdge = {
  source: string;
  target: string;
  type: string;
};

export function normalizeSeed(raw: string): string {
  return decodeURIComponent(raw).trim();
}

export async function resolveRootId(seed: string, projectId: string): Promise<string | null> {
  const rows = await cachedQuery<{ id: string }>(
    `MATCH (n)
     WHERE coalesce(n.projectId, '') = $projectId
       AND (
         n.id = $seed
         OR coalesce(n.filePath, '') = $seed
         OR coalesce(n.filePath, '') ENDS WITH $seed
         OR coalesce(n.name, '') = $seed
       )
     WITH n,
       CASE WHEN n.id = $seed THEN 100 ELSE 0 END +
       CASE WHEN coalesce(n.filePath, '') = $seed THEN 80 ELSE 0 END +
       CASE WHEN coalesce(n.filePath, '') ENDS WITH $seed THEN 40 ELSE 0 END +
       CASE WHEN coalesce(n.name, '') = $seed THEN 20 ELSE 0 END AS score
     RETURN n.id AS id
     ORDER BY score DESC
     LIMIT 1`,
    { seed, projectId },
  );

  return rows[0]?.id ?? null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ nodeId: string }> },
) {
  try {
    const { nodeId } = await context.params;
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId') ?? DEFAULT_PROJECT_ID;

    const seed = normalizeSeed(nodeId);
    const rootId = await resolveRootId(seed, projectId);

    if (!rootId) {
      return NextResponse.json({ error: `Root node not found for seed: ${seed}` }, { status: 404 });
    }

    const nodes = await cachedQuery<GraphNode>(
      `MATCH (root {id: $rootId})
       OPTIONAL MATCH p1 = (root)-[:CONTAINS]->(:Function)-[:CALLS*1..4]->(danger:Function)
       WHERE coalesce(danger.riskTier, 'LOW') IN ['CRITICAL','HIGH']
         AND coalesce(danger.projectId, '') = $projectId
       OPTIONAL MATCH p2 = (root)-[:CALLS*1..4]->(danger2:Function)
       WHERE coalesce(danger2.riskTier, 'LOW') IN ['CRITICAL','HIGH']
         AND coalesce(danger2.projectId, '') = $projectId
       WITH collect(p1) + collect(p2) AS paths, root
       UNWIND paths AS p
       WITH root, p WHERE p IS NOT NULL
       UNWIND nodes(p) AS n
       WITH root, collect(DISTINCT n) + [root] AS rawNodes
       UNWIND rawNodes AS n
       WITH DISTINCT n
       LIMIT $limit
       RETURN
         n.id AS id,
         coalesce(n.name, n.id) AS name,
         coalesce(n.filePath, '') AS filePath,
         labels(n) AS labels,
         coalesce(n.riskTier, 'LOW') AS riskTier,
         coalesce(n.projectId, '') AS projectId`,
      { rootId, projectId, limit: API_NODE_CAP },
    );

    const nodeIds = nodes.map((n) => n.id);

    const edges = nodeIds.length
      ? await cachedQuery<GraphEdge>(
          `UNWIND $nodeIds AS id
           MATCH (a {id: id})-[r]->(b)
           WHERE b.id IN $nodeIds
             AND type(r) IN ['CALLS', 'CONTAINS']
           WITH DISTINCT r
           RETURN startNode(r).id AS source, endNode(r).id AS target, type(r) AS type
           LIMIT 1200`,
          { nodeIds },
        )
      : [];

    return NextResponse.json({
      data: {
        rootId,
        seed,
        mode: 'danger-paths',
        nodes,
        edges,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        apiNodeCap: API_NODE_CAP,
        absoluteNodeCap: ABSOLUTE_NODE_CAP,
        truncated: nodes.length >= API_NODE_CAP,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Danger paths API failed', message: String(error) },
      { status: 500 },
    );
  }
}
