#!/usr/bin/env npx tsx
/**
 * Universal CodeGraph File Watcher
 * 
 * Discovers ALL projects from Neo4j and watches them all simultaneously.
 * New projects are picked up on periodic re-scan (every 5 minutes).
 * 
 * Usage:
 *   npx tsx watch-all.ts
 * 
 * Designed to run as a systemd service — watches everything, always.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
import { existsSync } from 'fs';

dotenv.config();

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'codegraph';
const RESCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

interface ProjectInfo {
  projectId: string;
  name: string;
  path: string;
  tsconfigPath: string;
}

// Known project paths (fallback when Project nodes don't have path)
const KNOWN_PROJECTS: Record<string, { path: string; tsconfig: string }> = {
  proj_60d5feed0001: {
    path: '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed/',
    tsconfig: '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed/tsconfig.json',
  },
  proj_c0d3e9a1f200: {
    path: '/home/jonathan/.openclaw/workspace/codegraph/',
    tsconfig: '/home/jonathan/.openclaw/workspace/codegraph/tsconfig.json',
  },
};

async function discoverProjects(): Promise<ProjectInfo[]> {
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  const session = driver.session();
  
  try {
    const result = await session.run(`
      MATCH (p:Project)
      WHERE p.path IS NOT NULL OR p.projectId IN $knownIds
      RETURN p.projectId AS pid, p.name AS name, p.path AS path
    `, { knownIds: Object.keys(KNOWN_PROJECTS) });
    
    const projects: ProjectInfo[] = [];
    
    for (const record of result.records) {
      const pid = record.get('pid');
      const name = record.get('name') || pid;
      let path = record.get('path');
      let tsconfigPath: string;
      
      // Use known paths as fallback
      if (!path && KNOWN_PROJECTS[pid]) {
        path = KNOWN_PROJECTS[pid].path;
        tsconfigPath = KNOWN_PROJECTS[pid].tsconfig;
      } else if (path) {
        const sep = path.endsWith('/') ? '' : '/';
        tsconfigPath = `${path}${sep}tsconfig.json`;
      } else {
        continue; // Skip projects without a path
      }
      
      // Only watch TypeScript projects with valid paths
      if (!existsSync(path)) {
        console.error(`[watch-all] ⚠️  Skipping ${name} (${pid}): path not found: ${path}`);
        continue;
      }
      
      // Skip non-code projects (Bible, Quran, etc.)
      if (pid.includes('bible') || pid.includes('quran') || pid.includes('deutero') || 
          pid.includes('pseudo') || pid.includes('early')) {
        continue;
      }
      
      projects.push({ projectId: pid, name, path, tsconfigPath });
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
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  throw new Error('Neo4j did not become available within 5 minutes');
}

async function main() {
  console.log('\n🔍 CodeGraph Universal File Watcher');
  console.log('   Watches ALL registered projects automatically.\n');
  
  // Wait for Neo4j
  await waitForNeo4j();
  
  // Discover projects
  let projects = await discoverProjects();
  console.log(`   Found ${projects.length} watchable project(s):`);
  for (const p of projects) {
    console.log(`     • ${p.name} (${p.projectId}) → ${p.path}`);
  }
  
  if (projects.length === 0) {
    console.log('   No projects to watch. Will re-scan in 5 minutes...');
  }
  
  // Create MCP client
  const transport = new StdioClientTransport({
    command: 'node',
    args: [new URL('./dist/mcp/mcp.server.js', import.meta.url).pathname],
  });
  
  const client = new Client(
    { name: 'codegraph-watch-all', version: '1.0.0' },
    { capabilities: { logging: {} } },
  );
  
  await client.connect(transport);
  const tools = await client.listTools();
  console.log(`\n   MCP connected. ${tools.tools.length} tools available.`);
  
  // Start watching each project
  const watchedIds = new Set<string>();
  
  async function startWatching(project: ProjectInfo) {
    if (watchedIds.has(project.projectId)) return;
    
    try {
      console.log(`\n   Starting watcher: ${project.name} (${project.projectId})`);
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
      
      watchedIds.add(project.projectId);
    } catch (err) {
      console.error(`   ❌ Failed to watch ${project.name}: ${err}`);
    }
  }
  
  // Start all current projects
  for (const p of projects) {
    await startWatching(p);
  }
  
  // Listen for file change notifications
  client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
    const data = notification.params?.data as any;
    if (data?.type) {
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
          console.log(`[${time}] ✅ ${pid}: Graph updated: ${data.data?.nodesUpdated} nodes, ${data.data?.edgesUpdated} edges (${data.data?.elapsedMs}ms)`);
          break;
        case 'incremental_parse_failed':
          console.log(`[${time}] ❌ ${pid}: Parse failed: ${data.data?.error}`);
          break;
        default:
          console.log(`[${time}] 📋 ${pid}: ${JSON.stringify(data).slice(0, 200)}`);
      }
    }
  });
  
  // Periodic re-scan for new projects
  setInterval(async () => {
    try {
      const currentProjects = await discoverProjects();
      const newProjects = currentProjects.filter(p => !watchedIds.has(p.projectId));
      if (newProjects.length > 0) {
        console.log(`\n[${new Date().toLocaleTimeString()}] 🆕 Found ${newProjects.length} new project(s):`);
        for (const p of newProjects) {
          console.log(`     • ${p.name} (${p.projectId})`);
          await startWatching(p);
        }
      }
    } catch (err) {
      console.error(`[watch-all] Re-scan error: ${err}`);
    }
  }, RESCAN_INTERVAL_MS);
  
  console.log(`\n   Watching ${watchedIds.size} project(s). Re-scanning every 5 min. Press Ctrl+C to stop.\n`);
  
  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n🛑 Stopping all watchers...');
    for (const pid of watchedIds) {
      try {
        await client.callTool({ name: 'stop_watch_project', arguments: { projectId: pid } });
      } catch {}
    }
    await client.close();
    console.log('   Done.');
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  // Keep alive
  await new Promise(() => {});
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
