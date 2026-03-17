import { createHash } from 'node:crypto';

export interface BoundaryNode {
  id: string;
  labels: string[];
  props: Record<string, unknown>;
}

export interface BoundaryEdge {
  type: string;
  from: string;
  to: string;
  props: Record<string, unknown>;
}

export interface BoundaryGraph {
  nodes: BoundaryNode[];
  edges: BoundaryEdge[];
}

export interface BoundaryFilterConfig {
  allowedNodeLabels: string[];
  allowedEdgeTypes: string[];
}

export interface ReasoningCycle {
  reads: Array<'data' | 'evidence' | 'trust' | 'confidence' | 'decision'>;
  writes: Array<'data' | 'evidence' | 'trust' | 'confidence' | 'decision'>;
}

export interface BoundaryLineage {
  boundarySnapshotId: string;
  inputHash: string;
  reasoningRunId: string;
  outputHash: string;
}

function stableHash(input: unknown): string {
  const json = JSON.stringify(input);
  return `sha256:${createHash('sha256').update(json).digest('hex')}`;
}

function canonicalGraph(graph: BoundaryGraph): BoundaryGraph {
  return {
    nodes: graph.nodes,
    edges: graph.edges,
  };
}

export function applyBoundaryFilter(graph: BoundaryGraph, config: BoundaryFilterConfig) {
  const allowedNodes = graph.nodes.filter((n) => n.labels.some((l) => config.allowedNodeLabels.includes(l)));
  const allowedIds = new Set(allowedNodes.map((n) => n.id));
  const allowedEdges = graph.edges.filter(
    (e) => config.allowedEdgeTypes.includes(e.type) && allowedIds.has(e.from) && allowedIds.has(e.to),
  );

  const filtered: BoundaryGraph = { nodes: allowedNodes, edges: allowedEdges };
  const snapshotHash = stableHash(canonicalGraph(filtered));
  return { ...filtered, snapshotHash };
}

export function assertSnapshotFrozen(expectedSnapshotHash: string, graph: BoundaryGraph): void {
  const currentHash = stableHash(canonicalGraph(graph));
  if (currentHash !== expectedSnapshotHash) {
    throw new Error(`Boundary snapshot mutated: expected ${expectedSnapshotHash}, got ${currentHash}`);
  }
}

export function validateReasoningCycle(cycle: ReasoningCycle): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  // Block same-cycle write-back into evidence/trust/data when those were read
  const readSet = new Set(cycle.reads);
  for (const target of cycle.writes) {
    if ((target === 'evidence' || target === 'trust' || target === 'data') && readSet.has(target)) {
      violations.push(`circular_loop:${target}`);
    }
  }

  return { valid: violations.length === 0, violations };
}

export function buildBoundaryLineage(lineage: BoundaryLineage): BoundaryLineage {
  return { ...lineage };
}

export function executeReasoningBoundary(input: {
  runId: string;
  dataGraph: BoundaryGraph;
  filter?: Partial<BoundaryFilterConfig>;
}) {
  const filter: BoundaryFilterConfig = {
    allowedNodeLabels: input.filter?.allowedNodeLabels ?? ['VerificationRun', 'Evidence', 'TrustSignal'],
    allowedEdgeTypes: input.filter?.allowedEdgeTypes ?? ['PRECEDES', 'SUPPORTED_BY', 'TRUSTS'],
  };

  const filtered = applyBoundaryFilter(input.dataGraph, filter);
  const inputHash = stableHash(input.dataGraph);
  const outputHash = stableHash({ nodes: filtered.nodes.map((n) => n.id), edges: filtered.edges.map((e) => `${e.type}:${e.from}->${e.to}`) });
  const boundarySnapshotId = `boundary:${input.runId}`;

  return {
    boundarySnapshotId,
    inputHash,
    reasoningRunId: input.runId,
    outputHash,
    filteredNodeCount: filtered.nodes.length,
    filteredEdgeCount: filtered.edges.length,
    snapshotHash: filtered.snapshotHash,
  };
}
