/**
 * GC-9: graph:metrics — Record graph growth metrics as a GraphMetricsSnapshot node.
 *
 * Metrics:
 * - nodeCount, edgeCount
 * - avgDegree, maxDegree, maxDegreeNode
 * - edgeTypeDistribution (top 20)
 * - derivedEdgeCount, derivedEdgeRatio
 * - codeNodeRatio (CodeNode count / total nodes)
 * - labelDistribution (top 20)
 */
import neo4j from 'neo4j-driver';

export interface GraphMetrics {
  nodeCount: number;
  edgeCount: number;
  avgDegree: number;
  maxDegree: number;
  maxDegreeNodeId: string;
  maxDegreeNodeName: string;
  derivedEdgeCount: number;
  derivedEdgeRatio: number;
  codeNodeCount: number;
  codeNodeRatio: number;
  edgeTypeDistribution: Record<string, number>;
  labelDistribution: Record<string, number>;
  timestamp: string;
}

export async function collectGraphMetrics(
  driver: InstanceType<typeof neo4j.Driver>,
): Promise<GraphMetrics> {
  const session = driver.session();
  try {
    // Node/edge counts
    const countsResult = await session.run(`
      MATCH (n) WITH count(n) AS nc
      MATCH ()-[r]->() WITH nc, count(r) AS ec
      RETURN nc AS nodeCount, ec AS edgeCount
    `);
    const nodeCount = toNum(countsResult.records[0].get('nodeCount'));
    const edgeCount = toNum(countsResult.records[0].get('edgeCount'));

    // Degree stats (Neo4j 5.x: use COUNT {} instead of size())
    const degreeResult = await session.run(`
      MATCH (n)
      WITH n, COUNT { (n)--() } AS deg
      RETURN round(avg(deg) * 100) / 100.0 AS avgDegree,
             max(deg) AS maxDegree
    `);
    const avgDegree = toNum(degreeResult.records[0].get('avgDegree'));
    const maxDegree = toNum(degreeResult.records[0].get('maxDegree'));

    // Max degree node
    const maxNodeResult = await session.run(`
      MATCH (n)
      WITH n, COUNT { (n)--() } AS deg
      ORDER BY deg DESC LIMIT 1
      RETURN n.id AS id, coalesce(n.name, n.id) AS name
    `);
    const maxDegreeNodeId = maxNodeResult.records[0]?.get('id') as string ?? 'unknown';
    const maxDegreeNodeName = maxNodeResult.records[0]?.get('name') as string ?? 'unknown';

    // Derived edges
    const derivedResult = await session.run(`
      MATCH ()-[r]->()
      RETURN sum(CASE WHEN r.derived = true THEN 1 ELSE 0 END) AS derivedCount,
             count(r) AS total
    `);
    const derivedEdgeCount = toNum(derivedResult.records[0].get('derivedCount'));
    const derivedEdgeRatio = edgeCount > 0 ? derivedEdgeCount / edgeCount : 0;

    // Code node ratio
    const codeResult = await session.run(`
      MATCH (n) WITH count(n) AS total
      MATCH (cn:CodeNode) WITH total, count(cn) AS codeCount
      RETURN codeCount, total
    `);
    const codeNodeCount = toNum(codeResult.records[0].get('codeCount'));
    const codeNodeRatio = nodeCount > 0 ? codeNodeCount / nodeCount : 0;

    // Edge type distribution
    const edgeDistResult = await session.run(`
      MATCH ()-[r]->()
      RETURN type(r) AS edgeType, count(r) AS cnt
      ORDER BY cnt DESC LIMIT 20
    `);
    const edgeTypeDistribution: Record<string, number> = {};
    for (const r of edgeDistResult.records) {
      edgeTypeDistribution[r.get('edgeType') as string] = toNum(r.get('cnt'));
    }

    // Label distribution
    const labelResult = await session.run(`
      MATCH (n)
      UNWIND labels(n) AS lbl
      RETURN lbl, count(n) AS cnt
      ORDER BY cnt DESC LIMIT 20
    `);
    const labelDistribution: Record<string, number> = {};
    for (const r of labelResult.records) {
      labelDistribution[r.get('lbl') as string] = toNum(r.get('cnt'));
    }

    const timestamp = new Date().toISOString();

    const metrics: GraphMetrics = {
      nodeCount,
      edgeCount,
      avgDegree,
      maxDegree,
      maxDegreeNodeId,
      maxDegreeNodeName,
      derivedEdgeCount,
      derivedEdgeRatio,
      codeNodeCount,
      codeNodeRatio,
      edgeTypeDistribution,
      labelDistribution,
      timestamp,
    };

    // Store as GraphMetricsSnapshot node
    await session.run(
      `CREATE (s:GraphMetricsSnapshot {
        id: 'gms_' + $timestamp,
        timestamp: datetime($timestamp),
        nodeCount: $nodeCount,
        edgeCount: $edgeCount,
        avgDegree: $avgDegree,
        maxDegree: $maxDegree,
        maxDegreeNodeId: $maxDegreeNodeId,
        maxDegreeNodeName: $maxDegreeNodeName,
        derivedEdgeCount: $derivedEdgeCount,
        derivedEdgeRatio: $derivedEdgeRatio,
        codeNodeCount: $codeNodeCount,
        codeNodeRatio: $codeNodeRatio,
        edgeTypeDistributionJson: $edgeTypeJson,
        labelDistributionJson: $labelJson
      })`,
      {
        timestamp,
        nodeCount,
        edgeCount,
        avgDegree,
        maxDegree,
        maxDegreeNodeId,
        maxDegreeNodeName,
        derivedEdgeCount,
        derivedEdgeRatio,
        codeNodeCount,
        codeNodeRatio,
        edgeTypeJson: JSON.stringify(edgeTypeDistribution),
        labelJson: JSON.stringify(labelDistribution),
      },
    );

    // Print summary
    console.log(`[graph:metrics] 📊 Graph Snapshot`);
    console.log(`  Nodes: ${nodeCount}, Edges: ${edgeCount}`);
    console.log(`  Avg degree: ${avgDegree}, Max degree: ${maxDegree} (${maxDegreeNodeName})`);
    console.log(`  Derived edges: ${derivedEdgeCount} (${(derivedEdgeRatio * 100).toFixed(1)}%)`);
    console.log(`  CodeNodes: ${codeNodeCount} (${(codeNodeRatio * 100).toFixed(1)}%)`);
    console.log(`  Top edge types: ${Object.entries(edgeTypeDistribution).slice(0, 5).map(([k, v]) => `${k}:${v}`).join(', ')}`);

    return metrics;
  } finally {
    await session.close();
  }
}

function toNum(v: any): number {
  if (typeof v === 'number') return v;
  if (v && typeof v.toNumber === 'function') return v.toNumber();
  return Number(v) || 0;
}

// ─── CLI entry point ───────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER ?? 'neo4j',
      process.env.NEO4J_PASSWORD ?? 'codegraph',
    ),
  );
  try {
    await collectGraphMetrics(driver);
  } finally {
    await driver.close();
  }
}
