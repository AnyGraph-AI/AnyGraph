#!/usr/bin/env npx tsx
/**
 * Architecture Layers — directory inference → BELONGS_TO_LAYER edges
 * 
 * Infers layers from directory structure or .codegraph.yml config.
 * Creates ArchitectureLayer nodes and BELONGS_TO_LAYER edges.
 * Detects layer violations (e.g., Presentation calling Data directly).
 * 
 * Usage: npx tsx seed-architecture-layers.ts [codegraph|godspeed]
 */
import neo4j from 'neo4j-driver';
import { readFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';
import { parse as parseYaml } from 'yaml';

dotenv.config();

const PROJECTS: Record<string, { path: string; id: string }> = {
  codegraph: {
    path: '/home/jonathan/.openclaw/workspace/codegraph/',
    id: 'proj_c0d3e9a1f200',
  },
  godspeed: {
    path: '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed/',
    id: 'proj_60d5feed0001',
  },
};

// Default layer rules by directory pattern (used when no .codegraph.yml)
const DEFAULT_LAYERS: Record<string, { match: string[]; layer: string; order: number }> = {
  entry: { match: ['src/index.ts', 'index.ts'], layer: 'Entry', order: 0 },
  presentation: { match: ['src/bot/', 'src/ui/', 'src/routes/', 'src/controllers/'], layer: 'Presentation', order: 1 },
  api: { match: ['src/api/', 'src/mcp/', 'src/handlers/'], layer: 'API', order: 2 },
  domain: { match: ['src/core/', 'src/domain/', 'src/services/', 'src/lib/'], layer: 'Domain', order: 3 },
  data: { match: ['src/core/db/', 'src/db/', 'src/storage/', 'src/data/'], layer: 'Data', order: 4 },
  shared: { match: ['src/constants.ts', 'src/types.ts', 'src/types/', 'src/shared/'], layer: 'Shared', order: 5 },
  infra: { match: ['src/infra/', 'src/config/', 'src/utils/'], layer: 'Infrastructure', order: 5 },
  test: { match: ['test/', 'tests/', '__tests__/', 'spec/'], layer: 'Test', order: 6 },
};

// Layer ordering for violation detection (lower number = higher layer)
// Violations: higher-layer files importing from lower-layer files is OK
// Violations: lower-layer files importing from higher-layer files is BAD
// e.g., Data (4) importing from Presentation (1) is a violation
const ALLOWED_DEPENDENCIES: Record<string, string[]> = {
  'Entry': ['Presentation', 'API', 'Domain', 'Data', 'Shared', 'Infrastructure'],
  'Presentation': ['API', 'Domain', 'Data', 'Shared', 'Infrastructure'],
  'API': ['Domain', 'Data', 'Shared', 'Infrastructure'],
  'Domain': ['Data', 'Shared', 'Infrastructure'],
  'Data': ['Shared', 'Infrastructure'],
  'Shared': ['Infrastructure'],
  'Infrastructure': ['Shared'],
  'Test': ['Entry', 'Presentation', 'API', 'Domain', 'Data', 'Shared', 'Infrastructure'],
  'Scripts': ['Entry', 'Presentation', 'API', 'Domain', 'Data', 'Shared', 'Infrastructure'],
};

interface LayerRule {
  match: string;
  layer: string;
}

function loadLayerRules(projectPath: string): LayerRule[] {
  try {
    const configPath = join(projectPath, '.codegraph.yml');
    const content = readFileSync(configPath, 'utf-8');
    const config = parseYaml(content);
    if (config?.layers && Array.isArray(config.layers)) {
      return config.layers.map((l: any) => ({
        match: l.match,
        layer: l.layer,
      }));
    }
  } catch {
    // No config file, use defaults
  }

  // Convert defaults to rules
  const rules: LayerRule[] = [];
  for (const def of Object.values(DEFAULT_LAYERS)) {
    for (const match of def.match) {
      rules.push({ match, layer: def.layer });
    }
  }
  return rules;
}

function classifyFile(filePath: string, projectPath: string, rules: LayerRule[]): string {
  const relative = filePath.startsWith(projectPath)
    ? filePath.slice(projectPath.length)
    : filePath;

  // Most specific match wins (longer match = more specific)
  let bestMatch = '';
  let bestLayer = 'Unclassified';

  for (const rule of rules) {
    if (relative.startsWith(rule.match) || relative.includes('/' + rule.match)) {
      if (rule.match.length > bestMatch.length) {
        bestMatch = rule.match;
        bestLayer = rule.layer;
      }
    }
  }

  // Special case: root-level .ts files
  if (bestLayer === 'Unclassified' && !relative.includes('/') && relative.endsWith('.ts')) {
    bestLayer = 'Scripts';
  }

  return bestLayer;
}

async function main() {
  const projectKey = process.argv[2] || 'codegraph';
  const project = PROJECTS[projectKey];
  if (!project) {
    console.error(`Unknown project: ${projectKey}. Use: codegraph | godspeed`);
    process.exit(1);
  }

  console.log(`\nSeeding architecture layers for ${projectKey}...`);
  console.log(`  Project: ${project.id}`);
  console.log(`  Path: ${project.path}\n`);

  const rules = loadLayerRules(project.path);
  console.log(`Loaded ${rules.length} layer rules`);

  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'codegraph'
    )
  );
  const session = driver.session();

  try {
    // Get all source files
    const filesResult = await session.run(
      'MATCH (sf:SourceFile {projectId: $pid}) RETURN sf.filePath AS filePath',
      { pid: project.id }
    );
    const files = filesResult.records.map(r => r.get('filePath') as string);
    console.log(`Found ${files.length} source files\n`);

    // Clear existing layer data
    await session.run(
      'MATCH (l:ArchitectureLayer {projectId: $pid}) DETACH DELETE l',
      { pid: project.id }
    );

    // Classify all files
    const layerCounts = new Map<string, number>();
    const fileLayerMap = new Map<string, string>();

    for (const filePath of files) {
      const layer = classifyFile(filePath, project.path, rules);
      layerCounts.set(layer, (layerCounts.get(layer) || 0) + 1);
      fileLayerMap.set(filePath, layer);

      // Set layer on SourceFile
      await session.run(`
        MATCH (sf:SourceFile {filePath: $filePath, projectId: $pid})
        SET sf.architectureLayer = $layer
      `, { filePath, pid: project.id, layer });
    }

    // Create ArchitectureLayer nodes
    for (const [layer, count] of layerCounts) {
      const layerId = `layer_${project.id}_${layer.replace(/[^a-zA-Z0-9]/g, '_')}`;
      await session.run(`
        MERGE (l:ArchitectureLayer {id: $layerId})
        SET l.name = $name, l.projectId = $pid, l.fileCount = $count
      `, { layerId, name: layer, pid: project.id, count: neo4j.int(count) });

      // Create BELONGS_TO_LAYER edges
      await session.run(`
        MATCH (sf:SourceFile {projectId: $pid})
        WHERE sf.architectureLayer = $layer
        MATCH (l:ArchitectureLayer {id: $layerId})
        MERGE (sf)-[:BELONGS_TO_LAYER]->(l)
      `, { pid: project.id, layer, layerId });
    }

    console.log('Layer distribution:');
    for (const [layer, count] of [...layerCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${layer}: ${count} files`);
    }

    // Detect layer violations
    console.log('\nDetecting layer violations...');
    const violationsResult = await session.run(`
      MATCH (sf1:SourceFile {projectId: $pid})-[:IMPORTS]->(sf2:SourceFile {projectId: $pid})
      WHERE sf1.architectureLayer IS NOT NULL AND sf2.architectureLayer IS NOT NULL
        AND sf1.architectureLayer <> sf2.architectureLayer
      RETURN sf1.filePath AS importer, sf1.architectureLayer AS importerLayer,
             sf2.filePath AS imported, sf2.architectureLayer AS importedLayer
    `, { pid: project.id });

    let violationCount = 0;
    const violations: string[] = [];

    for (const record of violationsResult.records) {
      const importerLayer = record.get('importerLayer') as string;
      const importedLayer = record.get('importedLayer') as string;
      const allowed = ALLOWED_DEPENDENCIES[importerLayer] || [];

      if (!allowed.includes(importedLayer)) {
        violationCount++;
        const importer = (record.get('importer') as string).replace(project.path, '');
        const imported = (record.get('imported') as string).replace(project.path, '');
        violations.push(`  ❌ ${importerLayer} → ${importedLayer}: ${importer} imports ${imported}`);
      }
    }

    if (violations.length > 0) {
      console.log(`\n🔴 ${violationCount} layer violations found:`);
      for (const v of violations) {
        console.log(v);
      }
    } else {
      console.log('✅ No layer violations detected');
    }

    // Cross-layer call summary
    const crossLayerResult = await session.run(`
      MATCH (sf1:SourceFile {projectId: $pid})-[:CONTAINS]->(caller)-[:CALLS]->(callee)<-[:CONTAINS]-(sf2:SourceFile {projectId: $pid})
      WHERE sf1.architectureLayer IS NOT NULL AND sf2.architectureLayer IS NOT NULL
        AND sf1.architectureLayer <> sf2.architectureLayer
      RETURN sf1.architectureLayer AS fromLayer, sf2.architectureLayer AS toLayer, count(*) AS callCount
      ORDER BY callCount DESC
    `, { pid: project.id });

    if (crossLayerResult.records.length > 0) {
      console.log('\nCross-layer call flow:');
      for (const record of crossLayerResult.records) {
        const from = record.get('fromLayer');
        const to = record.get('toLayer');
        const count = record.get('callCount');
        const countNum = typeof count === 'object' ? (count as any).toNumber() : count;
        console.log(`  ${from} → ${to}: ${countNum} calls`);
      }
    }

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
