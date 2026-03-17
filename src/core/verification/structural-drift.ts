import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';

export interface GraphEdge {
  source: string;
  target: string;
}

export interface DegreeDistribution {
  mean: number;
  variance: number;
  skewness: number;
  nodeCount: number;
}

export interface ClusteringCoefficient {
  average: number;
  perNode: Record<string, number>;
}

export interface AveragePathLength {
  average: number;
  diameter: number;
  reachablePairs: number;
}

export interface StructuralMetrics {
  degreeDistribution: DegreeDistribution;
  clusteringCoefficient: ClusteringCoefficient;
  averagePathLength: AveragePathLength;
  timestamp: string;
}

export interface SuppressionWindow {
  start: Date;
  end: Date;
  reason: string;
}

export interface DriftThresholds {
  degreeMeanThreshold?: number;
  degreeVarianceThreshold?: number;
  clusteringThreshold?: number;
  pathLengthThreshold?: number;
  suppressionWindows?: SuppressionWindow[];
}

export interface DriftComparison {
  drifted: boolean;
  suppressed: boolean;
  suppressionReason?: string;
  deltas: {
    degreeMeanDelta: number;
    degreeVarianceDelta: number;
    clusteringDelta: number;
    pathLengthDelta: number;
  };
  thresholds: Required<Omit<DriftThresholds, 'suppressionWindows'>>;
}

const DEFAULT_THRESHOLDS: Required<Omit<DriftThresholds, 'suppressionWindows'>> = {
  degreeMeanThreshold: 0.25,
  degreeVarianceThreshold: 0.5,
  clusteringThreshold: 0.2,
  pathLengthThreshold: 0.3,
};

function toUndirectedAdjacency(edges: GraphEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();

  for (const { source, target } of edges) {
    if (!adj.has(source)) adj.set(source, new Set());
    if (!adj.has(target)) adj.set(target, new Set());
    adj.get(source)!.add(target);
    adj.get(target)!.add(source);
  }

  return adj;
}

export function computeDegreeDistribution(edges: GraphEdge[]): DegreeDistribution {
  const adj = toUndirectedAdjacency(edges);
  const degrees = Array.from(adj.values()).map((neighbors) => neighbors.size);

  if (degrees.length === 0) {
    return { mean: 0, variance: 0, skewness: 0, nodeCount: 0 };
  }

  const n = degrees.length;
  const mean = degrees.reduce((a, b) => a + b, 0) / n;
  const variance = degrees.reduce((acc, d) => acc + (d - mean) ** 2, 0) / n;

  let skewness = 0;
  if (variance > 0) {
    const std = Math.sqrt(variance);
    const thirdMoment = degrees.reduce((acc, d) => acc + ((d - mean) / std) ** 3, 0) / n;
    skewness = thirdMoment;
  }

  return { mean, variance, skewness, nodeCount: n };
}

export function computeClusteringCoefficient(edges: GraphEdge[]): ClusteringCoefficient {
  const adj = toUndirectedAdjacency(edges);
  const perNode: Record<string, number> = {};
  const nodes = Array.from(adj.keys());

  if (nodes.length === 0) {
    return { average: 0, perNode };
  }

  for (const node of nodes) {
    const neighbors = Array.from(adj.get(node) ?? []);
    const k = neighbors.length;

    if (k < 2) {
      perNode[node] = 0;
      continue;
    }

    let links = 0;
    for (let i = 0; i < neighbors.length; i++) {
      for (let j = i + 1; j < neighbors.length; j++) {
        const ni = neighbors[i];
        const nj = neighbors[j];
        if (adj.get(ni)?.has(nj)) links++;
      }
    }

    const possible = (k * (k - 1)) / 2;
    perNode[node] = possible > 0 ? links / possible : 0;
  }

  const average = Object.values(perNode).reduce((a, b) => a + b, 0) / nodes.length;
  return { average, perNode };
}

export function computeAveragePathLength(edges: GraphEdge[]): AveragePathLength {
  const adj = toUndirectedAdjacency(edges);
  const nodes = Array.from(adj.keys());

  if (nodes.length < 2) {
    return { average: 0, diameter: 0, reachablePairs: 0 };
  }

  let totalDist = 0;
  let pairCount = 0;
  let diameter = 0;

  for (let i = 0; i < nodes.length; i++) {
    const start = nodes[i];
    const distances = new Map<string, number>([[start, 0]]);
    const queue: string[] = [start];

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const d = distances.get(cur)!;
      for (const next of adj.get(cur) ?? []) {
        if (!distances.has(next)) {
          distances.set(next, d + 1);
          queue.push(next);
        }
      }
    }

    for (let j = i + 1; j < nodes.length; j++) {
      const target = nodes[j];
      const dist = distances.get(target);
      if (dist !== undefined) {
        totalDist += dist;
        pairCount++;
        if (dist > diameter) diameter = dist;
      }
    }
  }

  if (pairCount === 0) {
    return { average: 0, diameter: 0, reachablePairs: 0 };
  }

  return {
    average: totalDist / pairCount,
    diameter,
    reachablePairs: pairCount,
  };
}

export function computeStructuralMetrics(edges: GraphEdge[]): StructuralMetrics {
  return {
    degreeDistribution: computeDegreeDistribution(edges),
    clusteringCoefficient: computeClusteringCoefficient(edges),
    averagePathLength: computeAveragePathLength(edges),
    timestamp: new Date().toISOString(),
  };
}

export function compareToBaseline(
  baseline: StructuralMetrics,
  current: StructuralMetrics,
  thresholds: DriftThresholds = {},
): DriftComparison {
  const merged = {
    ...DEFAULT_THRESHOLDS,
    ...thresholds,
  };

  const deltas = {
    degreeMeanDelta: current.degreeDistribution.mean - baseline.degreeDistribution.mean,
    degreeVarianceDelta: current.degreeDistribution.variance - baseline.degreeDistribution.variance,
    clusteringDelta: current.clusteringCoefficient.average - baseline.clusteringCoefficient.average,
    pathLengthDelta: current.averagePathLength.average - baseline.averagePathLength.average,
  };

  const inSuppressionWindow = (thresholds.suppressionWindows ?? []).find((w) => {
    const now = Date.now();
    return now >= w.start.getTime() && now <= w.end.getTime();
  });

  const driftDetected =
    Math.abs(deltas.degreeMeanDelta) > merged.degreeMeanThreshold ||
    Math.abs(deltas.degreeVarianceDelta) > merged.degreeVarianceThreshold ||
    Math.abs(deltas.clusteringDelta) > merged.clusteringThreshold ||
    Math.abs(deltas.pathLengthDelta) > merged.pathLengthThreshold;

  return {
    drifted: driftDetected && !inSuppressionWindow,
    suppressed: Boolean(inSuppressionWindow),
    suppressionReason: inSuppressionWindow?.reason,
    deltas,
    thresholds: {
      degreeMeanThreshold: merged.degreeMeanThreshold,
      degreeVarianceThreshold: merged.degreeVarianceThreshold,
      clusteringThreshold: merged.clusteringThreshold,
      pathLengthThreshold: merged.pathLengthThreshold,
    },
  };
}

export const STRUCTURAL_DRIFT_INVARIANT = {
  id: 'structural_drift_threshold',
  scope: 'project',
  severity: 'ENFORCED',
  description: 'Fail governance gate on unexplained structural drift beyond threshold',
} as const;

export async function evaluateStructuralDrift(params: {
  projectId: string;
  baseline: StructuralMetrics;
  thresholds?: DriftThresholds;
}): Promise<DriftComparison> {
  const neo4j = new Neo4jService();
  try {
    const rows = await neo4j.run(
      `MATCH (a:CodeNode {projectId: $projectId})-[r]->(b:CodeNode {projectId: $projectId})
       RETURN coalesce(a.id, a.nodeId, a.name) AS source,
              coalesce(b.id, b.nodeId, b.name) AS target
       LIMIT 100000`,
      { projectId: params.projectId },
    );

    const edges: GraphEdge[] = rows
      .map((r) => ({ source: String(r.source), target: String(r.target) }))
      .filter((e) => e.source && e.target && e.source !== 'null' && e.target !== 'null');

    const current = computeStructuralMetrics(edges);
    return compareToBaseline(params.baseline, current, params.thresholds);
  } finally {
    await neo4j.close();
  }
}
