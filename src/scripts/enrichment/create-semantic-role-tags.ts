import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimatch } from 'minimatch';
import neo4j, { type Driver } from 'neo4j-driver';

type SemanticRole =
  | 'parser'
  | 'adapter'
  | 'enrichment'
  | 'mcp-tool'
  | 'handler'
  | 'service'
  | 'verification'
  | 'ir'
  | 'cli'
  | 'storage'
  | 'entry-script'
  | 'verification-script'
  | 'unclassified';

interface SemanticRoleRule {
  pattern: string;
  role: SemanticRole;
}

interface SemanticRoleMap {
  version: string;
  defaultRole: SemanticRole;
  rules: SemanticRoleRule[];
}

interface SourceFileRow {
  filePath: string;
  sourceCode?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_ROLE_MAP_PATH = path.resolve(__dirname, '../../../config/semantic-role-map.json');

export function normalizePath(input: string): string {
  return input.replace(/\\/g, '/');
}

export async function loadSemanticRoleMap(configPath = DEFAULT_ROLE_MAP_PATH): Promise<SemanticRoleMap> {
  const raw = await fs.readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw) as SemanticRoleMap;

  if (!parsed?.rules || !Array.isArray(parsed.rules) || !parsed.defaultRole) {
    throw new Error(`Invalid semantic role map at ${configPath}`);
  }

  return parsed;
}

export function inferRoleFromPath(filePath: string, roleMap: SemanticRoleMap): SemanticRole | null {
  const normalized = normalizePath(filePath);

  for (const rule of roleMap.rules) {
    if (minimatch(normalized, rule.pattern, { nocase: true, dot: true })) {
      return rule.role;
    }
  }

  return null;
}

export function inferRoleFromInterface(filePath: string, sourceCode?: string): SemanticRole | null {
  const normalized = normalizePath(filePath);
  const code = sourceCode ?? '';

  if (/export\s+(class|function)\s+\w*Parser\b/.test(code)) return 'parser';
  if (/export\s+(class|function)\s+\w*Adapter\b/.test(code)) return 'adapter';
  if (/server\.(tool|registerTool)\(/.test(code)) return 'mcp-tool';
  if (/program\.command\(/.test(code)) return 'cli';
  if (/MATCH\s*\(/.test(code) && normalized.includes('/scripts/verify/')) return 'verification-script';

  return null;
}

export function assignSemanticRole(filePath: string, sourceCode: string | undefined, roleMap: SemanticRoleMap): { role: SemanticRole; source: 'path' | 'interface' | 'default'; matchedPattern?: string } {
  const normalized = normalizePath(filePath);

  for (const rule of roleMap.rules) {
    if (minimatch(normalized, rule.pattern, { nocase: true, dot: true })) {
      return { role: rule.role, source: 'path', matchedPattern: rule.pattern };
    }
  }

  const inferred = inferRoleFromInterface(filePath, sourceCode);
  if (inferred) {
    return { role: inferred, source: 'interface' };
  }

  return { role: roleMap.defaultRole, source: 'default' };
}

export async function enrichSemanticRoleTags(driver: Driver, opts: { projectId?: string; configPath?: string } = {}): Promise<{ tagged: number; roleDistribution: Record<string, number>; unclassified: number }> {
  const projectId = opts.projectId ?? 'proj_c0d3e9a1f200';
  const roleMap = await loadSemanticRoleMap(opts.configPath);

  const session = driver.session();
  try {
    const rows = (await session.run(
      `MATCH (sf:SourceFile {projectId: $projectId})
       RETURN sf.filePath AS filePath, sf.sourceCode AS sourceCode`,
      { projectId },
    )).records.map((record) => ({
      filePath: String(record.get('filePath') ?? ''),
      sourceCode: record.get('sourceCode') == null ? undefined : String(record.get('sourceCode')),
    })) as SourceFileRow[];

    const updates = rows
      .filter((row) => row.filePath)
      .map((row) => {
        const assigned = assignSemanticRole(row.filePath, row.sourceCode, roleMap);
        return {
          filePath: row.filePath,
          role: assigned.role,
          roleSource: assigned.source,
          matchedPattern: assigned.matchedPattern ?? null,
          mapVersion: roleMap.version,
        };
      });

    if (updates.length > 0) {
      await session.run(
        `UNWIND $updates AS u
         MATCH (sf:SourceFile {projectId: $projectId, filePath: u.filePath})
         SET sf.semanticRole = u.role,
             sf.semanticRoleSource = u.roleSource,
             sf.semanticRoleRule = u.matchedPattern,
             sf.semanticRoleMapVersion = u.mapVersion,
             sf.semanticRoleUpdatedAt = toString(datetime())`,
        { projectId, updates },
      );
    }

    const distributionRows = await session.run(
      `MATCH (sf:SourceFile {projectId: $projectId})
       RETURN sf.semanticRole AS role, count(sf) AS cnt
       ORDER BY cnt DESC`,
      { projectId },
    );

    const roleDistribution: Record<string, number> = {};
    for (const r of distributionRows.records) {
      roleDistribution[String(r.get('role') ?? 'null')] = Number((r.get('cnt') as any)?.toNumber?.() ?? r.get('cnt') ?? 0);
    }

    return {
      tagged: updates.length,
      roleDistribution,
      unclassified: roleDistribution.unclassified ?? 0,
    };
  } finally {
    await session.close();
  }
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const projectId = args.find((a) => a.startsWith('--project-id='))?.split('=')[1] ?? 'proj_c0d3e9a1f200';
  const configPath = args.find((a) => a.startsWith('--config='))?.split('=')[1];

  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER ?? 'neo4j',
      process.env.NEO4J_PASSWORD ?? 'codegraph',
    ),
  );

  try {
    const result = await enrichSemanticRoleTags(driver, { projectId, configPath });
    console.log(`[RF-13] Tagged ${result.tagged} SourceFile nodes with semanticRole`);
    console.log(`[RF-13] Role distribution: ${JSON.stringify(result.roleDistribution)}`);
    console.log(`[RF-13] Unclassified: ${result.unclassified}`);
  } finally {
    await driver.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/create-semantic-role-tags.ts') || process.argv[1]?.endsWith('/create-semantic-role-tags.js')) {
  main().catch((error) => {
    console.error('[RF-13] Error:', error);
    process.exit(1);
  });
}
