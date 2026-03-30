#!/usr/bin/env npx tsx
/**
 * Standalone file watcher via MCP client — Phase 2
 * 
 * Spawns the CodeGraph MCP server as a child process, connects as a client,
 * and calls start_watch_project. File changes trigger incremental graph updates.
 *
 * Usage:
 *   npx tsx watch.ts [godspeed|codegraph|/path/to/project]
 * 
 * Defaults to GodSpeed if no args provided.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

const PROJECTS: Record<string, { path: string; id: string; tsconfig: string }> = {
  godspeed: {
    path: '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed/',
    id: 'proj_60d5feed0001',
    tsconfig: '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed/tsconfig.json',
  },
  codegraph: {
    path: '/home/jonathan/.openclaw/workspace/codegraph/',
    id: 'proj_c0d3e9a1f200',
    tsconfig: '/home/jonathan/.openclaw/workspace/codegraph/tsconfig.json',
  },
};

async function main() {
  const arg = process.argv[2] || 'godspeed';
  
  let projectPath: string;
  let projectId: string;
  let tsconfigPath: string;

  if (arg in PROJECTS) {
    const proj = PROJECTS[arg];
    projectPath = proj.path;
    projectId = proj.id;
    tsconfigPath = proj.tsconfig;
  } else {
    projectPath = arg;
    projectId = process.argv[3] || `proj_${Date.now().toString(16).padStart(12, '0')}`;
    tsconfigPath = `${projectPath}/tsconfig.json`;
  }

  console.log(`\n🔍 CodeGraph File Watcher (MCP Client)`);
  console.log(`   Project: ${projectPath}`);
  console.log(`   ID: ${projectId}`);
  console.log(`\n   Connecting to MCP server...`);

  // Create MCP client + transport (spawns server as child process)
  const transport = new StdioClientTransport({
    command: 'node',
    args: [new URL('./dist/mcp/mcp.server.js', import.meta.url).pathname],
  });

  const client = new Client(
    { name: 'codegraph-watcher', version: '1.0.0' },
    { capabilities: { logging: {} } },
  );

  await client.connect(transport);

  try {
  // List available tools
  const tools = await client.listTools();
  console.log(`   Connected. ${tools.tools.length} tools available.`);

  // Start the file watcher via MCP tool
  console.log(`\n   Starting file watcher...`);
  const result = await client.callTool({
    name: 'start_watch_project',
    arguments: {
      projectPath,
      tsconfigPath,
      projectId,
      debounceMs: 1000,
    },
  });

  // Print result
  for (const content of result.content as any[]) {
    if (content.type === 'text') {
      console.log(`\n${content.text}`);
    }
  }

  console.log(`\n   Watching for changes. Press Ctrl+C to stop.\n`);

  // Listen for MCP logging notifications (file change events)
  client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
    const data = notification.params?.data as any;
    if (data?.type) {
      const time = new Date().toLocaleTimeString();
      switch (data.type) {
        case 'file_change_detected':
          console.log(`[${time}] ⚡ Change detected: ${data.data?.filesChanged?.join(', ')}`);
          break;
        case 'incremental_parse_started':
          console.log(`[${time}] 🔄 Reparsing...`);
          break;
        case 'incremental_parse_completed':
          console.log(`[${time}] ✅ Graph updated: ${data.data?.nodesUpdated} nodes, ${data.data?.edgesUpdated} edges (${data.data?.elapsedMs}ms)`);
          break;
        case 'incremental_parse_failed':
          console.log(`[${time}] ❌ Parse failed: ${data.data?.error}`);
          break;
        default:
          console.log(`[${time}] 📋 ${notification.params?.level}: ${JSON.stringify(data).slice(0, 200)}`);
      }
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n🛑 Stopping watcher...');
    try {
      await client.callTool({
        name: 'stop_watch_project',
        arguments: { projectId },
      });
    } catch {}
    await client.close();
    console.log('   Done.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep alive
  await new Promise(() => {});
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
