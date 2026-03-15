#!/usr/bin/env npx tsx
/**
 * Universal CodeGraph File Watcher
 *
 * Watches:
 * - code projects (via MCP incremental parser watcher)
 * - document projects (via document adapter + IR materializer)
 * - plan files (plan parser + cross-domain enrichment)
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
import { existsSync, watch as fsWatch, type FSWatcher } from 'fs';
import nodePath from 'node:path';
import { parsePlanDirectory, ingestToNeo4j, enrichCrossDomain } from '../../../src/core/parsers/plan-parser.js';
import { emitPlanParserContracts } from '../../../src/core/parsers/meta/parser-contract-emitter.js';
import { parseDocumentCollection, documentSchemaToIr } from '../../../src/core/adapters/document/document-parser.js';
import { materializeIrDocument } from '../../../src/core/ir/ir-materializer.js';
import { incrementalRecompute } from '../../../src/core/verification/incremental-recompute.js';
import { Neo4jService } from '../../../src/storage/neo4j/neo4j.service.js';

dotenv.config();

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'codegraph';
const RESCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

interface ProjectInfo {
  projectId: string;
  name: string;
  path: string;
  tsconfigPath?: string;
  kind: 'code' | 'document';
}

// Known project paths (fallback when Project nodes don't have path)
const KNOWN_PROJECTS: Record<string, { path: string; tsconfig?: string; kind: 'code' | 'document' }> = {
  proj_60d5feed0001: {
    path: '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed/',
    tsconfig: '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed/tsconfig.json',
    kind: 'code',
  },
  proj_c0d3e9a1f200: {
    path: '/home/jonathan/.openclaw/workspace/codegraph/',
    tsconfig: '/home/jonathan/.openclaw/workspace/codegraph/tsconfig.json',
    kind: 'code',
  },
};

function inferProjectKind(
  projectType: string | null,
  sourceKind: string | null,
  path: string,
  tsconfigPath?: string,
  sampleSourcePath?: string,
): 'code' | 'document' {
  const pt = (projectType ?? '').toLowerCase();
  const sk = (sourceKind ?? '').toLowerCase();

  // Strongest signal: canonical document witness provenance exists for this project.
  if (sampleSourcePath) return 'document';

  if (pt === 'code' || sk === 'code') return 'code';
  if (pt === 'document' || sk === 'document') return 'document';

  if (tsconfigPath && existsSync(tsconfigPath)) return 'code';
  // default fallback for non-tsconfig projects
  return 'document';
}

async function discoverProjects(): Promise<ProjectInfo[]> {
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  const session = driver.session();

  try {
    const result = await session.run(
      `MATCH (p:Project)
       OPTIONAL MATCH (d:DocumentWitness {projectId: p.projectId})
       WHERE d.sourcePath IS NOT NULL
       WITH p, head(collect(d.sourcePath)) AS sampleSourcePath
       WHERE p.path IS NOT NULL OR p.projectId IN $knownIds OR sampleSourcePath IS NOT NULL
       RETURN p.projectId AS pid,
              p.name AS name,
              p.path AS path,
              p.projectType AS projectType,
              p.sourceKind AS sourceKind,
              sampleSourcePath AS sampleSourcePath`,
      { knownIds: Object.keys(KNOWN_PROJECTS) },
    );

    const projects: ProjectInfo[] = [];

    for (const record of result.records) {
      const pid = String(record.get('pid'));
      const name = String(record.get('name') || pid);
      const projectType = record.get('projectType') ? String(record.get('projectType')) : null;
      const sourceKind = record.get('sourceKind') ? String(record.get('sourceKind')) : null;

      let path = record.get('path') ? String(record.get('path')) : '';
      const sampleSourcePath = record.get('sampleSourcePath') ? String(record.get('sampleSourcePath')) : '';
      let tsconfigPath: string | undefined;

      // Use known paths as fallback
      if (!path && KNOWN_PROJECTS[pid]) {
        path = KNOWN_PROJECTS[pid].path;
        tsconfigPath = KNOWN_PROJECTS[pid].tsconfig;
      } else if (!path && sampleSourcePath) {
        const normalized = sampleSourcePath.endsWith('/') ? sampleSourcePath.slice(0, -1) : sampleSourcePath;
        const ext = nodePath.extname(normalized);
        path = ext ? nodePath.dirname(normalized) : normalized;
      } else if (path) {
        const sep = path.endsWith('/') ? '' : '/';
        tsconfigPath = `${path}${sep}tsconfig.json`;
      } else {
        continue; // Skip projects without a path
      }

      if (!existsSync(path)) {
        console.error(`[watch-all] ⚠️  Skipping ${name} (${pid}): path not found: ${path}`);
        continue;
      }

      // Plans handled by dedicated plan watcher below
      if (pid.startsWith('plan_') || projectType === 'plan' || sourceKind === 'plan') {
        continue;
      }

      // Skip corpus projects for this watcher process
      if (pid.includes('bible') || pid.includes('quran') || pid.includes('deutero') || pid.includes('pseudo') || pid.includes('early')) {
        continue;
      }

      const kind =
        KNOWN_PROJECTS[pid]?.kind ?? inferProjectKind(projectType, sourceKind, path, tsconfigPath, sampleSourcePath);

      projects.push({ projectId: pid, name, path, tsconfigPath, kind });
    }

    return projects;
  } finally {
    await session.close();
    await driver.close();
  }
}

async function waitForNeo4j(): Promise<void> {
  console.log('[watch-all] Waiting for Neo4j...');
  const maxRetries = 60; // 5 minutes
  for (let i = 0; i < maxRetries; i++) {
    try {
      const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
      const session = driver.session();
      await session.run('RETURN 1');
      await session.close();
      await driver.close();
      console.log('[watch-all] ✅ Neo4j is ready');
      return;
    } catch {
      if (i % 10 === 0) console.log(`[watch-all] Neo4j not ready yet... (attempt ${i + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw new Error('Neo4j did not become available within 5 minutes');
}

async function ingestDocumentProject(project: ProjectInfo): Promise<void> {
  const started = Date.now();
  const schema = await parseDocumentCollection({
    projectId: project.projectId,
    sourcePath: project.path,
    collectionName: project.name,
  });
  const ir = documentSchemaToIr(schema);
  const materialized = await materializeIrDocument(ir, {
    batchSize: 500,
    clearProjectFirst: true,
  });

  // Preserve canonical document project taxonomy for watcher-managed document projects.
  // Registry and downstream guards rely on this classification.
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  const session = driver.session();
  try {
    await session.run(
      `MERGE (p:Project {projectId: $projectId})
       SET p.name = $name,
           p.displayName = $name,
           p.path = $path,
           p.projectType = 'document',
           p.sourceKind = 'parser',
           p.status = 'active',
           p.nodeCount = toInteger($nodeCount),
           p.edgeCount = toInteger($edgeCount),
           p.updatedAt = toString(datetime())`,
      {
        projectId: project.projectId,
        name: project.name,
        path: project.path,
        nodeCount: materialized.nodesCreated,
        edgeCount: materialized.edgesCreated,
      },
    );
  } finally {
    await session.close();
    await driver.close();
  }

  const elapsedMs = Date.now() - started;
  const time = new Date().toLocaleTimeString();
  console.log(
    `[${time}] 📄 ${project.projectId}: document ingest complete ` +
      `docs=${schema.documents.length}, paragraphs=${schema.paragraphs.length}, entities=${schema.entities.length}, ` +
      `nodes=${materialized.nodesCreated}, edges=${materialized.edgesCreated}, ${elapsedMs}ms`,
  );
}

async function main() {
  console.log('\n🔍 CodeGraph Universal File Watcher');
  console.log('   Watches code, document, and plan projects automatically.\n');

  await waitForNeo4j();

  let projects = await discoverProjects();
  console.log(`   Found ${projects.length} watchable project(s):`);
  for (const p of projects) {
    console.log(`     • [${p.kind}] ${p.name} (${p.projectId}) → ${p.path}`);
  }

  if (projects.length === 0) {
    console.log('   No projects to watch. Will re-scan in 5 minutes...');
  }

  // MCP client for code watchers
  const transport = new StdioClientTransport({
    command: 'node',
    args: [new URL('./dist/mcp/mcp.server.js', import.meta.url).pathname],
  });

  const client = new Client({ name: 'codegraph-watch-all', version: '1.1.0' }, { capabilities: { logging: {} } });
  await client.connect(transport);
  const tools = await client.listTools();
  console.log(`\n   MCP connected. ${tools.tools.length} tools available.`);

  const watchedCodeIds = new Set<string>();
  const documentWatchers = new Map<string, FSWatcher>();
  const documentTimers = new Map<string, NodeJS.Timeout>();

  async function startWatchingCode(project: ProjectInfo) {
    if (watchedCodeIds.has(project.projectId)) return;
    if (!project.tsconfigPath || !existsSync(project.tsconfigPath)) {
      console.error(`   ⚠️  Skipping code watcher for ${project.name}: tsconfig missing (${project.tsconfigPath ?? 'n/a'})`);
      return;
    }

    try {
      console.log(`\n   Starting code watcher: ${project.name} (${project.projectId})`);
      const result = await client.callTool({
        name: 'start_watch_project',
        arguments: {
          projectPath: project.path,
          tsconfigPath: project.tsconfigPath,
          projectId: project.projectId,
          debounceMs: 1000,
        },
      });

      for (const content of result.content as any[]) {
        if (content.type === 'text') {
          console.log(`   ${content.text.split('\n').join('\n   ')}`);
        }
      }

      watchedCodeIds.add(project.projectId);
    } catch (err) {
      console.error(`   ❌ Failed to watch code project ${project.name}: ${err}`);
    }
  }

  async function startWatchingDocument(project: ProjectInfo) {
    if (documentWatchers.has(project.projectId)) return;

    try {
      console.log(`\n   Starting document watcher: ${project.name} (${project.projectId})`);
      // initial ingest
      await ingestDocumentProject(project);

      const watcher = fsWatch(project.path, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;

        // ignore transient tmp files
        if (filename.endsWith('.swp') || filename.endsWith('~')) return;

        const existing = documentTimers.get(project.projectId);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(async () => {
          try {
            const time = new Date().toLocaleTimeString();
            console.log(`[${time}] 📄 ${project.projectId}: change detected (${filename}) — re-ingesting...`);
            await ingestDocumentProject(project);
          } catch (err) {
            console.error(`[document-watcher] ❌ ${project.projectId}: ingest failed: ${err}`);
          }
        }, 3000);

        documentTimers.set(project.projectId, timer);
      });

      documentWatchers.set(project.projectId, watcher);
    } catch (err) {
      console.error(`   ❌ Failed to watch document project ${project.name}: ${err}`);
    }
  }

  async function startWatching(project: ProjectInfo) {
    if (project.kind === 'code') return startWatchingCode(project);
    return startWatchingDocument(project);
  }

  // start all current projects
  for (const p of projects) {
    await startWatching(p);
  }

  // logging notifications from code watchers
  client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
    const data = notification.params?.data as any;
    if (!data?.type) return;

    const time = new Date().toLocaleTimeString();
    const pid = data.projectId || '???';
    switch (data.type) {
      case 'file_change_detected':
        console.log(`[${time}] ⚡ ${pid}: Change detected: ${data.data?.filesChanged?.join(', ')}`);
        break;
      case 'incremental_parse_started':
        console.log(`[${time}] 🔄 ${pid}: Reparsing...`);
        break;
      case 'incremental_parse_completed':
        console.log(
          `[${time}] ✅ ${pid}: Graph updated: ${data.data?.nodesUpdated} nodes, ${data.data?.edgesUpdated} edges (${data.data?.elapsedMs}ms)`,
        );
        // TC-2: Scoped temporal recompute after code change
        {
          const changedFiles = data.data?.filesChanged as string[] | undefined;
          if (changedFiles?.length) {
            const svc = new Neo4jService();
            incrementalRecompute(svc, {
              projectId: pid,
              scope: 'file',
              targets: changedFiles,
              reason: 'code_change',
            }).then(result => {
              if (result.updatedCount > 0) {
                console.log(`[${time}] 🕐 ${pid}: Temporal recompute: ${result.updatedCount} updated`);
              }
            }).catch(err => {
              if (process.env.GTH_DEBUG) console.error(`[code-watcher] temporal recompute error: ${err}`);
            }).finally(() => svc.close());
          }
        }
        break;
      case 'incremental_parse_failed':
        console.log(`[${time}] ❌ ${pid}: Parse failed: ${data.data?.error}`);
        break;
      default:
        console.log(`[${time}] 📋 ${pid}: ${JSON.stringify(data).slice(0, 200)}`);
    }
  });

  // ========================================
  // PLAN GRAPH WATCHER
  // ========================================
  const PLANS_ROOT = '/home/jonathan/.openclaw/workspace/plans';
  let planParseTimer: NodeJS.Timeout | null = null;
  const PLAN_DEBOUNCE_MS = 3000;

  async function reParsePlans() {
    try {
      const time = new Date().toLocaleTimeString();
      console.log(`[${time}] 📋 Plan change detected — reparsing...`);

      const results = await parsePlanDirectory(PLANS_ROOT);
      let totalNodes = 0;
      let totalStale = 0;

      for (const parsed of results) {
        const ingestResult = await ingestToNeo4j(parsed);
        totalNodes += ingestResult.nodesUpserted;
        totalStale += ingestResult.staleRemoved;
      }

      const enrichResult = await enrichCrossDomain(results);
      const contractResult = await emitPlanParserContracts();

      console.log(
        `[${time}] ✅ Plans updated: ${totalNodes} nodes, ${totalStale} stale removed, ${enrichResult.evidenceEdges} evidence edges, contracts ${contractResult.nodesUpserted} nodes/${contractResult.edgesUpserted} edges`,
      );

      if (enrichResult.driftDetected.length > 0) {
        console.log(`[${time}] ⚠️  ${enrichResult.driftDetected.length} drift items detected`);
      }

      // TC-2: Scoped confidence recompute for affected plan projects
      try {
        const planProjectIds = results.map(r => r.projectId).filter(Boolean);
        for (const pid of planProjectIds) {
          const svc = new Neo4jService();
          try {
            const result = await incrementalRecompute(svc, {
              projectId: pid,
              scope: 'full',
              fullOverride: true,
              reason: 'plan_change',
            });
            if (result.updatedCount > 0) {
              console.log(`[${time}] 🕐 ${pid}: Temporal recompute: ${result.updatedCount} updated`);
            }
          } finally {
            await svc.close();
          }
        }
      } catch (err) {
        if (process.env.GTH_DEBUG) console.error(`[plan-watcher] temporal recompute error: ${err}`);
      }
    } catch (err) {
      console.error(`[plan-watcher] ❌ Parse failed: ${err}`);
    }
  }

  const planWatchers: FSWatcher[] = [];

  function watchPlansDir(dir: string) {
    try {
      const watcher = fsWatch(dir, { recursive: true }, (_eventType, filename) => {
        if (!filename?.endsWith('.md')) return;
        if (planParseTimer) clearTimeout(planParseTimer);
        planParseTimer = setTimeout(reParsePlans, PLAN_DEBOUNCE_MS);
      });
      planWatchers.push(watcher);
      console.log(`   📋 Watching plans: ${dir} (recursive)`);
    } catch (err) {
      console.error(`   ❌ Failed to watch plans dir: ${err}`);
    }
  }

  if (existsSync(PLANS_ROOT)) {
    watchPlansDir(PLANS_ROOT);
    await reParsePlans();
  } else {
    console.log('   ℹ️  Plans directory not found, skipping plan watcher');
  }

  // periodic re-scan for new projects
  setInterval(async () => {
    try {
      const currentProjects = await discoverProjects();
      const newProjects = currentProjects.filter(
        (p) => !watchedCodeIds.has(p.projectId) && !documentWatchers.has(p.projectId),
      );

      if (newProjects.length > 0) {
        console.log(`\n[${new Date().toLocaleTimeString()}] 🆕 Found ${newProjects.length} new project(s):`);
        for (const p of newProjects) {
          console.log(`     • [${p.kind}] ${p.name} (${p.projectId})`);
          await startWatching(p);
        }
      }
    } catch (err) {
      console.error(`[watch-all] Re-scan error: ${err}`);
    }
  }, RESCAN_INTERVAL_MS);

  console.log(
    `\n   Watching code=${watchedCodeIds.size}, documents=${documentWatchers.size}, plans=${planWatchers.length}. Re-scanning every 5 min. Press Ctrl+C to stop.\n`,
  );

  const shutdown = async () => {
    console.log('\n🛑 Stopping all watchers...');

    for (const pid of watchedCodeIds) {
      try {
        await client.callTool({ name: 'stop_watch_project', arguments: { projectId: pid } });
      } catch {
        // ignore shutdown errors
      }
    }

    for (const [pid, watcher] of documentWatchers) {
      try {
        watcher.close();
      } catch {
        console.error(`Failed closing document watcher ${pid}`);
      }
    }

    for (const timer of documentTimers.values()) {
      clearTimeout(timer);
    }

    for (const w of planWatchers) {
      try {
        w.close();
      } catch {
        // ignore
      }
    }
    if (planParseTimer) clearTimeout(planParseTimer);

    await client.close();
    console.log('   Done.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
