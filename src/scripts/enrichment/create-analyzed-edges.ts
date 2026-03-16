/**
 * GC-2: Create ANALYZED edges from VerificationRun → SourceFile.
 * 
 * Uses AnalysisScope.includedPaths (file:// URIs) to determine which
 * SourceFiles were in scope for each VR. Creates ANALYZED edges with
 * {derived: true, source: 'vr-scope-enrichment'}.
 * 
 * ANALYZED means "this file was in the tool's analysis scope" — NOT
 * "every function in the file was verified." For function-level
 * granularity, FLAGS edges require per-finding location data (future).
 * 
 * Usage: npx tsx create-analyzed-edges.ts [projectId]
 */
import neo4j, { type Driver } from 'neo4j-driver';
import dotenv from 'dotenv';

dotenv.config();

// --------------- Pure functions (exported for testing) ---------------

export interface AnalyzedPair {
  vrId: string;
  filePath: string;
}

/**
 * Strip file:// prefix from URI.
 * file:///home/user/a.ts → /home/user/a.ts
 * file://relative/a.ts → relative/a.ts
 */
export function stripFileUri(uri: string): string {
  if (!uri) return '';
  if (uri.startsWith('file:///')) return uri.slice(7); // file:///home → /home
  if (uri.startsWith('file://')) return uri.slice(7);  // file://rel → rel
  return uri;
}

/**
 * Extract unique (vrId, filePath) pairs from scope data.
 * Deduplicates: same VR+file pair only appears once.
 * Filters: only includes paths that match a known SourceFile.
 */
export function extractAnalyzedPairs(
  scopes: Array<{ vrId: string; includedPaths: string[] | null }>,
  sourceFilePaths: Set<string>,
): AnalyzedPair[] {
  const seen = new Set<string>();
  const pairs: AnalyzedPair[] = [];

  for (const scope of scopes) {
    if (!scope.includedPaths || !Array.isArray(scope.includedPaths)) continue;

    for (const uri of scope.includedPaths) {
      const filePath = stripFileUri(uri);
      if (!sourceFilePaths.has(filePath)) continue;

      const key = `${scope.vrId}::${filePath}`;
      if (seen.has(key)) continue;
      seen.add(key);

      pairs.push({ vrId: scope.vrId, filePath });
    }
  }

  return pairs;
}

// --------------- Neo4j enrichment ---------------

export async function enrichAnalyzedEdges(
  driver: Driver,
  projectId: string,
): Promise<{ edgesCreated: number; vrCount: number; fileCount: number }> {
  const session = driver.session();

  try {
    // 1. Get all SourceFile paths for this project
    const sfResult = await session.run(`
      MATCH (sf:SourceFile {projectId: $projectId})
      WHERE sf.filePath IS NOT NULL
      RETURN sf.filePath AS filePath
    `, { projectId });

    const sourceFilePaths = new Set<string>();
    for (const record of sfResult.records) {
      sourceFilePaths.add(record.get('filePath') as string);
    }

    console.log(`Found ${sourceFilePaths.size} SourceFiles for project ${projectId}`);

    // 2. Get all VR→AnalysisScope data
    const scopeResult = await session.run(`
      MATCH (vr:VerificationRun {projectId: $projectId})-[:HAS_SCOPE]->(scope:AnalysisScope)
      WHERE scope.includedPaths IS NOT NULL
      RETURN vr.id AS vrId, scope.includedPaths AS includedPaths
    `, { projectId });

    const scopes: Array<{ vrId: string; includedPaths: string[] }> = [];
    for (const record of scopeResult.records) {
      scopes.push({
        vrId: record.get('vrId') as string,
        includedPaths: record.get('includedPaths') as string[],
      });
    }

    console.log(`Found ${scopes.length} VR→Scope pairs`);

    // 3. Compute unique (vrId, filePath) pairs
    const pairs = extractAnalyzedPairs(scopes, sourceFilePaths);
    console.log(`Computed ${pairs.length} unique (VR, SourceFile) pairs`);

    if (pairs.length === 0) {
      return { edgesCreated: 0, vrCount: 0, fileCount: 0 };
    }

    // 4. Batch create ANALYZED edges using UNWIND
    // Process in chunks to avoid OOM on large pair sets
    const BATCH_SIZE = 1000;
    let totalCreated = 0;

    for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
      const batch = pairs.slice(i, i + BATCH_SIZE);
      const result = await session.run(`
        UNWIND $pairs AS pair
        MATCH (vr:VerificationRun {id: pair.vrId, projectId: $projectId})
        MATCH (sf:SourceFile {filePath: pair.filePath, projectId: $projectId})
        MERGE (vr)-[r:ANALYZED]->(sf)
        ON CREATE SET r.derived = true, r.source = 'vr-scope-enrichment', r.createdAt = datetime()
        RETURN count(r) AS created
      `, {
        pairs: batch.map(p => ({ vrId: p.vrId, filePath: p.filePath })),
        projectId,
      });

      totalCreated += result.records[0]?.get('created')?.toNumber?.() || 0;
    }

    // Count unique VRs and files that got edges
    const uniqueVrs = new Set(pairs.map(p => p.vrId)).size;
    const uniqueFiles = new Set(pairs.map(p => p.filePath)).size;

    console.log(`Created ${totalCreated} ANALYZED edges (${uniqueVrs} VRs → ${uniqueFiles} files)`);

    return {
      edgesCreated: totalCreated,
      vrCount: uniqueVrs,
      fileCount: uniqueFiles,
    };

  } finally {
    await session.close();
  }
}

// --------------- CLI entry point ---------------

async function main() {
  const projectId = process.argv[2] || 'proj_c0d3e9a1f200';

  console.log(`Creating ANALYZED edges for ${projectId}`);

  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'codegraph'
    )
  );

  try {
    const result = await enrichAnalyzedEdges(driver, projectId);
    console.log(`\n✅ ANALYZED edges complete: ${result.edgesCreated} edges (${result.vrCount} VRs → ${result.fileCount} files)`);
  } finally {
    await driver.close();
  }
}

const isDirectRun = process.argv[1]?.includes('create-analyzed-edges');
if (isDirectRun) {
  main().catch(console.error);
}
