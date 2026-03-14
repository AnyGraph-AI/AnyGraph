/**
 * Immutable Snapshot Digests — Graph State Verification for Replay
 *
 * Takes a deterministic snapshot of graph state within a test namespace,
 * computes its digest, and stores it for comparison during replay.
 * If a replay produces a different digest, the test is non-deterministic.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N2, Task 5
 */

import { createHash } from 'node:crypto';
import type { EphemeralGraphRuntime } from './ephemeral-graph.js';

// ============================================================================
// TYPES
// ============================================================================

export interface GraphSnapshot {
  /** Nodes sorted by label + name for determinism */
  nodes: Array<{
    labels: string[];
    name: string;
    properties: Record<string, unknown>;
  }>;
  /** Edges sorted by type + from + to for determinism */
  edges: Array<{
    type: string;
    fromName: string;
    toName: string;
    properties: Record<string, unknown>;
  }>;
  /** Counts */
  nodeCount: number;
  edgeCount: number;
}

export interface SnapshotDigest {
  /** SHA-256 of canonical snapshot JSON */
  sha256: string;
  /** Node count at snapshot time */
  nodeCount: number;
  /** Edge count at snapshot time */
  edgeCount: number;
  /** When the snapshot was taken */
  takenAt: string;
  /** The test projectId this snapshot belongs to */
  projectId: string;
}

// ============================================================================
// CORE
// ============================================================================

/**
 * Take a deterministic snapshot of all graph data in the test namespace.
 * Nodes and edges are sorted canonically for digest stability.
 */
export async function takeGraphSnapshot(graph: EphemeralGraphRuntime): Promise<GraphSnapshot> {
  // Fetch all nodes
  const nodeResult = await graph.run(`
    MATCH (n {projectId: $projectId})
    RETURN labels(n) AS labels, properties(n) AS props
    ORDER BY labels(n)[0], n.name
  `, { projectId: graph.projectId });

  const nodes = nodeResult.records.map(r => {
    const props = r.get('props') as Record<string, unknown>;
    const { projectId: _, ...cleanProps } = props;
    return {
      labels: (r.get('labels') as string[]).sort(),
      name: (props.name as string) ?? '',
      properties: sortObjectKeys(cleanProps),
    };
  });

  // Fetch all edges
  const edgeResult = await graph.run(`
    MATCH (a {projectId: $projectId})-[r]->(b {projectId: $projectId})
    RETURN type(r) AS type, a.name AS fromName, b.name AS toName, properties(r) AS props
    ORDER BY type(r), a.name, b.name
  `, { projectId: graph.projectId });

  const edges = edgeResult.records.map(r => {
    const props = r.get('props') as Record<string, unknown>;
    return {
      type: r.get('type') as string,
      fromName: (r.get('fromName') as string) ?? '',
      toName: (r.get('toName') as string) ?? '',
      properties: sortObjectKeys(props),
    };
  });

  return {
    nodes,
    edges,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };
}

/**
 * Compute a digest from a graph snapshot.
 */
export function computeSnapshotDigest(
  snapshot: GraphSnapshot,
  projectId: string
): SnapshotDigest {
  const canonical = JSON.stringify({
    nodes: snapshot.nodes,
    edges: snapshot.edges,
  });

  return {
    sha256: createHash('sha256').update(canonical).digest('hex'),
    nodeCount: snapshot.nodeCount,
    edgeCount: snapshot.edgeCount,
    takenAt: new Date().toISOString(),
    projectId,
  };
}

/**
 * Compare two snapshot digests. Returns true if they match.
 */
export function compareDigests(a: SnapshotDigest, b: SnapshotDigest): {
  match: boolean;
  details: string;
} {
  if (a.sha256 === b.sha256) {
    return { match: true, details: 'Digests match — test is deterministic.' };
  }

  const diffs: string[] = [];
  if (a.nodeCount !== b.nodeCount) {
    diffs.push(`nodeCount: ${a.nodeCount} → ${b.nodeCount}`);
  }
  if (a.edgeCount !== b.edgeCount) {
    diffs.push(`edgeCount: ${a.edgeCount} → ${b.edgeCount}`);
  }
  if (diffs.length === 0) {
    diffs.push('Same counts but different content — non-deterministic properties detected.');
  }

  return {
    match: false,
    details: `Digests differ. ${diffs.join(', ')}`,
  };
}

/**
 * Assert that two replay runs produce identical graph state.
 * Throws if digests don't match.
 */
export function assertDeterministic(
  original: SnapshotDigest,
  replay: SnapshotDigest
): void {
  const { match, details } = compareDigests(original, replay);
  if (!match) {
    throw new Error(
      `Non-deterministic test detected! ${details}\n` +
      `Original: ${original.sha256.slice(0, 16)}... (${original.nodeCount}n/${original.edgeCount}e)\n` +
      `Replay:   ${replay.sha256.slice(0, 16)}... (${replay.nodeCount}n/${replay.edgeCount}e)`
    );
  }
}

// ============================================================================
// INTERNALS
// ============================================================================

/**
 * Sort object keys for canonical JSON serialization.
 * Converts neo4j Integer objects to numbers.
 */
function sortObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    let val = obj[key];
    // Handle neo4j Integer objects
    if (val && typeof val === 'object' && 'low' in (val as Record<string, unknown>) && 'high' in (val as Record<string, unknown>)) {
      val = (val as { low: number; high: number }).low;
    }
    sorted[key] = val;
  }
  return sorted;
}
