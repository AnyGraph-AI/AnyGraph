/**
 * Ephemeral Graph Runtime — Isolated Neo4j Test Environment
 *
 * Since Neo4j CE doesn't support multi-database, we achieve isolation via:
 * 1. Unique test projectId prefix (`__test_<uuid>`) for all test data
 * 2. Schema setup (constraints/indexes) scoped to test namespace
 * 3. Full cleanup on teardown — deletes all nodes/edges with test projectId
 *
 * Every test run gets a fresh, isolated graph slice within the shared Neo4j instance.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N2, Task 2
 */

import neo4j, { type Driver, type Session, type SessionConfig, type QueryResult, Integer } from 'neo4j-driver';
import { randomUUID } from 'node:crypto';

// ============================================================================
// TYPES
// ============================================================================

export interface EphemeralGraphConfig {
  /** Neo4j bolt URI (default: bolt://localhost:7687) */
  uri?: string;
  /** Neo4j username (default: neo4j) */
  user?: string;
  /** Neo4j password (default: codegraph) */
  password?: string;
  /** Custom test namespace prefix (default: auto-generated UUID) */
  testId?: string;
  /** Whether to create standard schema constraints (default: true) */
  setupSchema?: boolean;
  /** Session config overrides */
  sessionConfig?: Partial<SessionConfig>;
}

export interface EphemeralGraphRuntime {
  /** The unique test namespace ID */
  testId: string;
  /** The test projectId (use this for all test data) */
  projectId: string;
  /** Neo4j driver instance */
  driver: Driver;
  /** Get a new session (caller must close) */
  session: () => Session;
  /** Run a Cypher query with auto-session management */
  run: (cypher: string, params?: Record<string, unknown>) => Promise<QueryResult>;
  /** Seed test data from a fixture */
  seed: (fixture: TestFixture) => Promise<void>;
  /** Get node/edge counts for the test namespace */
  stats: () => Promise<{ nodes: number; edges: number }>;
  /** Teardown: delete all test data and close driver */
  teardown: () => Promise<void>;
}

export interface TestFixture {
  /** Nodes to create: [{labels: ['Function'], properties: {name: 'foo', ...}}] */
  nodes: Array<{
    labels: string[];
    properties: Record<string, unknown>;
    /** Optional variable name for edge references */
    ref?: string;
  }>;
  /** Edges to create: [{from: 'ref1', to: 'ref2', type: 'CALLS', properties: {}}] */
  edges?: Array<{
    fromRef: string;
    toRef: string;
    type: string;
    properties?: Record<string, unknown>;
  }>;
}

// ============================================================================
// CORE
// ============================================================================

/**
 * Create an ephemeral graph runtime for testing.
 * All data is isolated via a unique test projectId.
 * Call teardown() when done to clean up.
 */
export async function createEphemeralGraph(
  config: EphemeralGraphConfig = {}
): Promise<EphemeralGraphRuntime> {
  const {
    uri = 'bolt://localhost:7687',
    user = 'neo4j',
    password = 'codegraph',
    testId = randomUUID().slice(0, 8),
    setupSchema = true,
    sessionConfig = {},
  } = config;

  const projectId = `__test_${testId}`;
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

  // Verify connectivity
  try {
    await driver.verifyConnectivity();
  } catch (err) {
    await driver.close();
    throw new Error(`Ephemeral graph: cannot connect to Neo4j at ${uri}: ${(err as Error).message}`);
  }

  const getSession = () => driver.session(sessionConfig);

  const run = async (cypher: string, params: Record<string, unknown> = {}): Promise<QueryResult> => {
    const session = getSession();
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  };

  // Set up schema constraints if requested
  if (setupSchema) {
    await setupTestSchema(run);
  }

  const seed = async (fixture: TestFixture) => {
    await seedFixture(run, projectId, fixture);
  };

  const stats = async () => {
    const result = await run(`
      MATCH (n {projectId: $projectId})
      OPTIONAL MATCH (n)-[r]-()
      RETURN count(DISTINCT n) AS nodes, count(DISTINCT r) AS edges
    `, { projectId });
    const record = result.records[0];
    return {
      nodes: (record.get('nodes') as Integer).toNumber(),
      edges: (record.get('edges') as Integer).toNumber(),
    };
  };

  const teardown = async () => {
    // Delete all test data in batches to avoid OOM on large fixtures
    let deleted = 0;
    let batch: number;
    do {
      const result = await run(`
        MATCH (n {projectId: $projectId})
        WITH n LIMIT 1000
        DETACH DELETE n
        RETURN count(*) AS deleted
      `, { projectId });
      batch = (result.records[0].get('deleted') as Integer).toNumber();
      deleted += batch;
    } while (batch > 0);

    await driver.close();
    return;
  };

  return {
    testId,
    projectId,
    driver,
    session: getSession,
    run,
    seed,
    stats,
    teardown,
  };
}

// ============================================================================
// SCHEMA SETUP
// ============================================================================

/**
 * Create standard constraints/indexes for test data.
 * These are idempotent (IF NOT EXISTS).
 */
async function setupTestSchema(
  run: (cypher: string, params?: Record<string, unknown>) => Promise<QueryResult>
): Promise<void> {
  // Core node uniqueness constraints — match production schema
  const constraints = [
    'CREATE CONSTRAINT test_source_file IF NOT EXISTS FOR (n:SourceFile) REQUIRE (n.projectId, n.filePath) IS UNIQUE',
    'CREATE CONSTRAINT test_function IF NOT EXISTS FOR (n:Function) REQUIRE (n.projectId, n.name, n.filePath) IS UNIQUE',
    'CREATE CONSTRAINT test_task IF NOT EXISTS FOR (n:Task) REQUIRE (n.projectId, n.name) IS UNIQUE',
    'CREATE CONSTRAINT test_milestone IF NOT EXISTS FOR (n:Milestone) REQUIRE (n.projectId, n.name) IS UNIQUE',
  ];

  for (const constraint of constraints) {
    try {
      await run(constraint);
    } catch {
      // Constraint may already exist with a different name — that's fine
    }
  }
}

// ============================================================================
// FIXTURE SEEDING
// ============================================================================

/**
 * Seed test data from a fixture definition.
 * All nodes get the test projectId injected automatically.
 */
async function seedFixture(
  run: (cypher: string, params?: Record<string, unknown>) => Promise<QueryResult>,
  projectId: string,
  fixture: TestFixture
): Promise<void> {
  // Build a single Cypher CREATE statement for all nodes + edges
  const lines: string[] = [];
  const params: Record<string, unknown> = { projectId };

  // Create nodes
  for (let i = 0; i < fixture.nodes.length; i++) {
    const node = fixture.nodes[i];
    const ref = node.ref ?? `n${i}`;
    const labels = node.labels.join(':');
    const paramKey = `props_${i}`;
    params[paramKey] = { ...node.properties, projectId };
    lines.push(`CREATE (${ref}:${labels} $${paramKey})`);
  }

  // Create edges
  if (fixture.edges) {
    for (let i = 0; i < fixture.edges.length; i++) {
      const edge = fixture.edges[i];
      const propKey = `eprops_${i}`;
      params[propKey] = edge.properties ?? {};
      lines.push(`CREATE (${edge.fromRef})-[:${edge.type} $${propKey}]->(${edge.toRef})`);
    }
  }

  if (lines.length > 0) {
    await run(lines.join('\n'), params);
  }
}

// ============================================================================
// CONVENIENCE — FIXTURE BUILDERS
// ============================================================================

/**
 * Build a minimal code graph fixture for testing.
 */
export function codeGraphFixture(opts: {
  files?: Array<{ name: string; path?: string }>;
  functions?: Array<{ name: string; file: string; riskLevel?: number; riskTier?: string }>;
  calls?: Array<{ from: string; to: string }>;
} = {}): TestFixture {
  const nodes: TestFixture['nodes'] = [];
  const edges: TestFixture['edges'] = [];

  const files = opts.files ?? [{ name: 'test.ts', path: '/test/test.ts' }];
  const functions = opts.functions ?? [];
  const calls = opts.calls ?? [];

  // Files
  for (const f of files) {
    nodes.push({
      labels: ['SourceFile'],
      properties: { name: f.name, filePath: f.path ?? `/test/${f.name}` },
      ref: `file_${f.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
    });
  }

  // Functions
  for (const fn of functions) {
    const fileRef = `file_${fn.file.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const fnRef = `fn_${fn.name}`;
    nodes.push({
      labels: ['Function'],
      properties: {
        name: fn.name,
        filePath: `/test/${fn.file}`,
        riskLevel: fn.riskLevel ?? 1,
        riskTier: fn.riskTier ?? 'LOW',
        fanInCount: 0,
        fanOutCount: 0,
      },
      ref: fnRef,
    });
    edges.push({ fromRef: fileRef, toRef: fnRef, type: 'CONTAINS' });
  }

  // Calls
  for (const call of calls) {
    edges.push({
      fromRef: `fn_${call.from}`,
      toRef: `fn_${call.to}`,
      type: 'CALLS',
      properties: { crossFile: false },
    });
  }

  return { nodes, edges };
}

/**
 * Build a minimal plan graph fixture for testing.
 */
export function planGraphFixture(opts: {
  milestones?: Array<{ name: string; status?: string }>;
  tasks?: Array<{ name: string; milestone: string; status?: string; hasEvidence?: boolean }>;
  dependencies?: Array<{ from: string; to: string }>;
} = {}): TestFixture {
  const nodes: TestFixture['nodes'] = [];
  const edges: TestFixture['edges'] = [];

  const milestones = opts.milestones ?? [{ name: 'Milestone T1: Test' }];
  const tasks = opts.tasks ?? [];
  const dependencies = opts.dependencies ?? [];

  // Milestones
  for (const m of milestones) {
    const ref = `ms_${m.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    nodes.push({
      labels: ['Milestone'],
      properties: { name: m.name, status: m.status ?? 'planned' },
      ref,
    });
  }

  // Tasks
  for (const t of tasks) {
    const ref = `task_${t.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const msRef = `ms_${t.milestone.replace(/[^a-zA-Z0-9]/g, '_')}`;
    nodes.push({
      labels: ['Task'],
      properties: {
        name: t.name,
        status: t.status ?? 'planned',
        hasCodeEvidence: t.hasEvidence ?? false,
      },
      ref,
    });
    edges.push({ fromRef: ref, toRef: msRef, type: 'PART_OF' });
  }

  // Dependencies
  for (const dep of dependencies) {
    const fromRef = `task_${dep.from.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const toRef = `task_${dep.to.replace(/[^a-zA-Z0-9]/g, '_')}`;
    edges.push({ fromRef, toRef, type: 'DEPENDS_ON' });
  }

  return { nodes, edges };
}
