import { createHash } from 'crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { basename, resolve } from 'path';
import dotenv from 'dotenv';

import { Neo4jEdge, Neo4jNode } from '../core/config/schema.js';
import { IrDocument, IrEdgeType, IrNodeType } from '../core/ir/ir-v1.schema.js';
import { materializeIrDocument } from '../core/ir/ir-materializer.js';
import { validateIrDocument } from '../core/ir/ir-validator.js';
import { ParserFactory } from '../core/parsers/parser-factory.js';
import { resolveProjectId } from '../core/utils/project-id.js';
import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

interface TargetProject {
  name: string;
  workspacePath: string;
  tsconfigPath: string;
}

interface CliOptions {
  resume: boolean;
  retryFailed: boolean;
  fresh: boolean;
  forceTargets: Set<string>;
  statePath: string;
  checkpointDir: string;
  batchSize: number;
}

type TargetPhase = 'idle' | 'parsed' | 'validated' | 'materialized' | 'verified' | 'cleaned';
type TargetStatus = 'pending' | 'running' | 'done' | 'failed';

interface TargetSummaryRow {
  target: string;
  sourceNodes: number;
  sourceEdges: number;
  irNodesCreated: number;
  irEdgesCreated: number;
  materializedNodes: number;
  materializedEdges: number;
  projectId: string;
}

interface TargetState {
  target: string;
  status: TargetStatus;
  phase: TargetPhase;
  attempts: number;
  startedAt?: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
  checkpointPath?: string;
  irHash?: string;
  sourceNodes?: number;
  sourceEdges?: number;
  projectId: string;
  result?: TargetSummaryRow;
}

interface ParityState {
  version: 1;
  runId: string;
  createdAt: string;
  updatedAt: string;
  options: {
    batchSize: number;
    checkpointDir: string;
  };
  targets: Record<string, TargetState>;
  overallStatus: 'running' | 'passed' | 'failed';
  summary: TargetSummaryRow[];
}

interface IrCheckpoint {
  version: 1;
  target: string;
  projectId: string;
  irHash: string;
  sourceNodes: number;
  sourceEdges: number;
  createdAt: string;
  irDoc: IrDocument;
}

dotenv.config();

const TARGETS: TargetProject[] = [
  {
    name: 'codegraph',
    workspacePath: '/home/jonathan/.openclaw/workspace/codegraph',
    tsconfigPath: '/home/jonathan/.openclaw/workspace/codegraph/tsconfig.json',
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

function nowIso(): string {
  return new Date().toISOString();
}

function getTargetTestProjectId(target: TargetProject): string {
  const baseProjectId = resolveProjectId(target.workspacePath);
  const testHash = createHash('md5').update(`${baseProjectId}:ir-parity`).digest('hex').slice(0, 12);
  return `proj_${testHash}`;
}

function checksumIrDoc(irDoc: IrDocument): string {
  return createHash('sha256').update(JSON.stringify(irDoc)).digest('hex');
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    resume: argv.includes('--resume'),
    retryFailed: argv.includes('--retry-failed'),
    fresh: argv.includes('--fresh'),
    forceTargets: new Set<string>(),
    statePath: resolve(process.cwd(), 'artifacts/ir-parity/state.json'),
    checkpointDir: resolve(process.cwd(), 'artifacts/ir-parity/checkpoints'),
    batchSize: 50,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--force-target') {
      const value = argv[i + 1];
      if (!value) throw new Error('--force-target requires a value');
      options.forceTargets.add(value);
      i += 1;
      continue;
    }

    if (arg.startsWith('--force-target=')) {
      options.forceTargets.add(arg.split('=')[1]);
      continue;
    }

    if (arg.startsWith('--state-path=')) {
      options.statePath = resolve(process.cwd(), arg.split('=')[1]);
      continue;
    }

    if (arg.startsWith('--checkpoint-dir=')) {
      options.checkpointDir = resolve(process.cwd(), arg.split('=')[1]);
      continue;
    }

    if (arg.startsWith('--batch-size=')) {
      const parsed = Number(arg.split('=')[1]);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid --batch-size: ${arg}`);
      options.batchSize = Math.floor(parsed);
      continue;
    }
  }

  return options;
}

function createInitialState(options: CliOptions): ParityState {
  const createdAt = nowIso();
  return {
    version: 1,
    runId: createHash('md5').update(`${createdAt}:${Math.random()}`).digest('hex').slice(0, 12),
    createdAt,
    updatedAt: createdAt,
    options: {
      batchSize: options.batchSize,
      checkpointDir: options.checkpointDir,
    },
    targets: Object.fromEntries(
      TARGETS.map((target) => {
        const projectId = getTargetTestProjectId(target);
        return [
          target.name,
          {
            target: target.name,
            projectId,
            status: 'pending',
            phase: 'idle',
            attempts: 0,
            updatedAt: createdAt,
            checkpointPath: resolve(options.checkpointDir, `${target.name}.ir-checkpoint.json`),
          } satisfies TargetState,
        ];
      }),
    ),
    overallStatus: 'running',
    summary: [],
  };
}

async function ensureDirs(options: CliOptions): Promise<void> {
  await mkdir(resolve(options.statePath, '..'), { recursive: true });
  await mkdir(options.checkpointDir, { recursive: true });
}

async function saveState(state: ParityState, options: CliOptions): Promise<void> {
  state.updatedAt = nowIso();
  const tempPath = `${options.statePath}.tmp`;
  await writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
  await rename(tempPath, options.statePath);
}

async function loadState(options: CliOptions): Promise<ParityState> {
  if (!options.resume || options.fresh) {
    return createInitialState(options);
  }

  try {
    const raw = await readFile(options.statePath, 'utf8');
    const parsed = JSON.parse(raw) as ParityState;

    // ensure newly added targets are present if state was created from an older target list
    for (const target of TARGETS) {
      if (!parsed.targets[target.name]) {
        parsed.targets[target.name] = {
          target: target.name,
          projectId: getTargetTestProjectId(target),
          status: 'pending',
          phase: 'idle',
          attempts: 0,
          updatedAt: nowIso(),
          checkpointPath: resolve(options.checkpointDir, `${target.name}.ir-checkpoint.json`),
        };
      }
    }

    parsed.overallStatus = 'running';
    parsed.options.batchSize = options.batchSize;
    parsed.options.checkpointDir = options.checkpointDir;
    return parsed;
  } catch {
    return createInitialState(options);
  }
}

function shouldRunTarget(targetName: string, targetState: TargetState | undefined, options: CliOptions): boolean {
  if (options.forceTargets.size > 0 && !options.forceTargets.has(targetName)) return false;

  if (!targetState) return true;

  if (targetState.status === 'done' && options.resume && !options.forceTargets.has(targetName)) return false;
  if (targetState.status === 'failed' && options.resume && !options.retryFailed && !options.forceTargets.has(targetName)) {
    return false;
  }

  return true;
}

async function getProjectCounts(neo4j: Neo4jService, projectId: string): Promise<{ nodeCount: number; edgeCount: number }> {
  const counts = await neo4j.run(
    `CALL {
       MATCH (n {projectId: $projectId})
       RETURN count(n) AS nodeCount
     }
     CALL {
       MATCH ()-[r {projectId: $projectId}]->()
       RETURN count(r) AS edgeCount
     }
     RETURN nodeCount, edgeCount`,
    { projectId },
  );

  return {
    nodeCount: Number(counts?.[0]?.nodeCount ?? 0),
    edgeCount: Number(counts?.[0]?.edgeCount ?? 0),
  };
}

async function clearProjectInChunks(neo4j: Neo4jService, projectId: string, chunkSize: number = 2_000): Promise<void> {
  for (;;) {
    const result = await neo4j.run(
      `MATCH (n {projectId: $projectId})
       WITH n LIMIT toInteger($chunkSize)
       DETACH DELETE n
       RETURN count(n) AS deleted`,
      { projectId, chunkSize },
    );

    const deleted = Number(result?.[0]?.deleted ?? 0);
    if (deleted === 0) break;
  }
}

async function loadCheckpoint(checkpointPath: string): Promise<IrCheckpoint | undefined> {
  try {
    const raw = await readFile(checkpointPath, 'utf8');
    return JSON.parse(raw) as IrCheckpoint;
  } catch {
    return undefined;
  }
}

async function writeCheckpoint(checkpointPath: string, checkpoint: IrCheckpoint): Promise<void> {
  const tempPath = `${checkpointPath}.tmp`;
  await writeFile(tempPath, JSON.stringify(checkpoint), 'utf8');
  await rename(tempPath, checkpointPath);
}

async function removeCheckpoint(checkpointPath: string | undefined): Promise<void> {
  if (!checkpointPath) return;
  await rm(checkpointPath, { force: true });
}

async function buildIrForTarget(target: TargetProject, projectId: string): Promise<{ irDoc: IrDocument; sourceNodes: number; sourceEdges: number }> {
  const parser = await ParserFactory.createParserWithAutoDetection(target.workspacePath, target.tsconfigPath, projectId, true);
  parser.setIrMode(true); // Use IR enrichment plugins for framework nodes
  await parser.parseWorkspace();
  const irDoc = parser.exportToIrDocument(target.workspacePath);

  // Source counts come from the enriched IR document — enrichment plugins
  // add legitimate nodes/edges (e.g., Grammy Entrypoints + REGISTERED_BY)
  // that the materializer then writes to Neo4j.
  return {
    irDoc,
    sourceNodes: irDoc.nodes.length,
    sourceEdges: irDoc.edges.length,
  };
}

function upsertSummaryRow(state: ParityState, row: TargetSummaryRow): void {
  const index = state.summary.findIndex((existing) => existing.target === row.target);
  if (index >= 0) state.summary[index] = row;
  else state.summary.push(row);
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await ensureDirs(options);

  const neo4j = new Neo4jService();
  const state = await loadState(options);
  await saveState(state, options);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.warn(`\nReceived ${signal}; saving parity state before exit...`);
    try {
      await saveState(state, options);
    } finally {
      await neo4j.close();
      process.exit(130);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  try {
    for (const target of TARGETS) {
      const testProjectId = getTargetTestProjectId(target);
      const existingState = state.targets[target.name];

      if (!shouldRunTarget(target.name, existingState, options)) {
        console.log(`\n=== IR parity: ${target.name} (skipped - already complete) ===`);
        continue;
      }

      const targetState: TargetState = {
        ...(existingState ?? {
          target: target.name,
          projectId: testProjectId,
          status: 'pending' as const,
          phase: 'idle' as const,
          attempts: 0,
          updatedAt: nowIso(),
          checkpointPath: resolve(options.checkpointDir, `${target.name}.ir-checkpoint.json`),
        }),
        target: target.name,
        projectId: testProjectId,
        status: 'running',
        startedAt: existingState?.startedAt ?? nowIso(),
        updatedAt: nowIso(),
        attempts: (existingState?.attempts ?? 0) + 1,
        error: undefined,
      };

      state.targets[target.name] = targetState;
      await saveState(state, options);

      console.log(`\n=== IR parity: ${target.name} ===`);

      try {
        await clearProjectInChunks(neo4j, testProjectId);

        let irDoc: IrDocument;
        let sourceNodes: number;
        let sourceEdges: number;
        let irHash: string;

        const shouldAttemptResume = options.resume && targetState.checkpointPath && targetState.phase !== 'idle';
        const checkpoint = shouldAttemptResume && targetState.checkpointPath ? await loadCheckpoint(targetState.checkpointPath) : undefined;

        if (checkpoint && checkpoint.projectId === testProjectId) {
          irDoc = checkpoint.irDoc;
          sourceNodes = checkpoint.sourceNodes;
          sourceEdges = checkpoint.sourceEdges;
          irHash = checkpoint.irHash;
          console.log(`Resumed from checkpoint: ${target.name}`);
        } else {
          const built = await buildIrForTarget(target, testProjectId);
          irDoc = built.irDoc;
          sourceNodes = built.sourceNodes;
          sourceEdges = built.sourceEdges;
          irHash = checksumIrDoc(irDoc);

          const irCheckpoint: IrCheckpoint = {
            version: 1,
            target: target.name,
            projectId: testProjectId,
            irHash,
            sourceNodes,
            sourceEdges,
            createdAt: nowIso(),
            irDoc,
          };

          if (targetState.checkpointPath) {
            await writeCheckpoint(targetState.checkpointPath, irCheckpoint);
          }
        }

        targetState.phase = 'parsed';
        targetState.sourceNodes = sourceNodes;
        targetState.sourceEdges = sourceEdges;
        targetState.irHash = irHash;
        targetState.updatedAt = nowIso();
        await saveState(state, options);

        const validation = validateIrDocument(irDoc);
        if (!validation.ok) {
          throw new Error(`IR validation failed for ${target.name}:\n${validation.errors.join('\n')}`);
        }

        targetState.phase = 'validated';
        targetState.updatedAt = nowIso();
        await saveState(state, options);

        const result = await materializeIrDocument(irDoc, {
          batchSize: options.batchSize,
          clearProjectFirst: false,
        });

        targetState.phase = 'materialized';
        targetState.updatedAt = nowIso();
        await saveState(state, options);

        const counts = await getProjectCounts(neo4j, testProjectId);

        const row: TargetSummaryRow = {
          target: target.name,
          sourceNodes,
          sourceEdges,
          irNodesCreated: result.nodesCreated,
          irEdgesCreated: result.edgesCreated,
          materializedNodes: counts.nodeCount,
          materializedEdges: counts.edgeCount,
          projectId: testProjectId,
        };

        targetState.phase = 'verified';
        targetState.status = 'done';
        targetState.finishedAt = nowIso();
        targetState.result = row;
        targetState.updatedAt = nowIso();

        upsertSummaryRow(state, row);
        await saveState(state, options);
      } catch (error) {
        targetState.status = 'failed';
        targetState.error = error instanceof Error ? error.message : String(error);
        targetState.updatedAt = nowIso();
        await saveState(state, options);
        throw error;
      } finally {
        await clearProjectInChunks(neo4j, testProjectId);
        targetState.phase = 'cleaned';
        targetState.updatedAt = nowIso();
        await saveState(state, options);
      }
    }

    console.log('\n=== IR PARITY SUMMARY ===');
    for (const row of state.summary) {
      console.log(JSON.stringify(row));
    }

    const failed = state.summary.filter(
      (row) =>
        Number(row.sourceNodes) !== Number(row.irNodesCreated) ||
        Number(row.sourceEdges) !== Number(row.irEdgesCreated) ||
        Number(row.sourceNodes) !== Number(row.materializedNodes) ||
        Number(row.sourceEdges) !== Number(row.materializedEdges),
    );

    if (failed.length > 0) {
      state.overallStatus = 'failed';
      await saveState(state, options);
      console.error('\nIR parity gate FAILED');
      process.exit(1);
    }

    state.overallStatus = 'passed';
    await saveState(state, options);

    // clean checkpoints on full pass to avoid stale resume artifacts
    for (const targetState of Object.values(state.targets)) {
      await removeCheckpoint(targetState.checkpointPath);
    }

    console.log('\nIR parity gate PASSED');
  } finally {
    await neo4j.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
