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

export interface ScopeCoveragePair {
  sourceFamily: string;
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

/**
 * Extract unique (sourceFamily, filePath) pairs — scope-level coverage.
 * 
 * Multiple VRs from the same tool scanning the same file produce ONE
 * coverage edge, not N edges. This prevents edge explosion when
 * 197 ESLint findings each claim scope over all 277 files.
 * 
 * Semantics: "ESLint analyzed this file" (once), not "each of 197
 * ESLint findings was detected while scanning this file" (197 times).
 */
export function extractScopeCoveragePairs(
  scopes: Array<{ sourceFamily: string; includedPaths: string[] | null }>,
  sourceFilePaths: Set<string>,
): ScopeCoveragePair[] {
  const seen = new Set<string>();
  const pairs: ScopeCoveragePair[] = [];

  for (const scope of scopes) {
    if (!scope.includedPaths || !Array.isArray(scope.includedPaths)) continue;

    for (const uri of scope.includedPaths) {
      const filePath = stripFileUri(uri);
      if (!sourceFilePaths.has(filePath)) continue;

      const key = `${scope.sourceFamily}::${filePath}`;
      if (seen.has(key)) continue;
      seen.add(key);

      pairs.push({ sourceFamily: scope.sourceFamily, filePath });
    }
  }

  return pairs;
}

// --------------- Neo4j enrichment ---------------

export async function enrichAnalyzedEdges(
  driver: Driver,
  projectId: string,
): Promise<{ edgesCreated: number; familyCount: number; fileCount: number }> {
  const session = driver.session();

  try {
    // 0. Delete old per-VR ANALYZED edges (from pre-dedup run)
    const deleteResult = await session.run(`
      MATCH (:VerificationRun {projectId: $projectId})-[r:ANALYZED]->(:SourceFile)
      DELETE r RETURN count(r) AS deleted
    `, { projectId });
    const deleted = deleteResult.records[0]?.get('deleted')?.toNumber?.() || 0;
    if (deleted > 0) console.log(`Cleaned ${deleted} old per-VR ANALYZED edges`);

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

    // 2. Get all VR→AnalysisScope data with sourceFamily
    const scopeResult = await session.run(`
      MATCH (vr:VerificationRun {projectId: $projectId})-[:HAS_SCOPE]->(scope:AnalysisScope)
      WHERE scope.includedPaths IS NOT NULL
      RETURN vr.sourceFamily AS sourceFamily, scope.includedPaths AS includedPaths
    `, { projectId });

    const scopes: Array<{ sourceFamily: string; includedPaths: string[] }> = [];
    for (const record of scopeResult.records) {
      scopes.push({
        sourceFamily: record.get('sourceFamily') as string,
        includedPaths: record.get('includedPaths') as string[],
      });
    }

    console.log(`Found ${scopes.length} VR→Scope pairs`);

    // 3. Compute unique (sourceFamily, filePath) pairs — scope-level dedup
    const pairs = extractScopeCoveragePairs(scopes, sourceFilePaths);
    console.log(`Computed ${pairs.length} unique (sourceFamily, SourceFile) pairs`);

    if (pairs.length === 0) {
      return { edgesCreated: 0, familyCount: 0, fileCount: 0 };
    }

    // 4. Create scope-level ANALYZED edges on SourceFile nodes
    //    Instead of VR→SF (N×M explosion), store coverage as properties + edges from AnalysisScope
    //    Use Cypher to create one ANALYZED edge per (sourceFamily, SF) via a virtual scope node
    let totalCreated = 0;

    // Group by sourceFamily for batch processing
    const byFamily = new Map<string, string[]>();
    for (const pair of pairs) {
      const files = byFamily.get(pair.sourceFamily) || [];
      files.push(pair.filePath);
      byFamily.set(pair.sourceFamily, files);
    }

    for (const [family, filePaths] of byFamily) {
      // Find one representative VR for this family to serve as the scope anchor
      const anchorResult = await session.run(`
        MATCH (vr:VerificationRun {projectId: $projectId, sourceFamily: $family})
        RETURN vr.id AS vrId LIMIT 1
      `, { projectId, family });

      const anchorVrId = anchorResult.records[0]?.get('vrId') as string;
      if (!anchorVrId) continue;

      // Create ANALYZED edges from this one representative VR to all scoped files
      const BATCH_SIZE = 500;
      for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
        const batch = filePaths.slice(i, i + BATCH_SIZE);
        const result = await session.run(`
          UNWIND $filePaths AS fp
          MATCH (vr:VerificationRun {id: $vrId, projectId: $projectId})
          MATCH (sf:SourceFile {filePath: fp, projectId: $projectId})
          MERGE (vr)-[r:ANALYZED]->(sf)
          ON CREATE SET r.derived = true, 
                        r.source = 'vr-scope-enrichment',
                        r.sourceFamily = $family,
                        r.createdAt = datetime()
          RETURN count(r) AS created
        `, { filePaths: batch, vrId: anchorVrId, projectId, family });

        totalCreated += result.records[0]?.get('created')?.toNumber?.() || 0;
      }

      console.log(`  ${family}: ${filePaths.length} files → ${anchorVrId} (anchor)`);
    }

    const uniqueFamilies = byFamily.size;
    const uniqueFiles = new Set(pairs.map(p => p.filePath)).size;

    console.log(`Created ${totalCreated} ANALYZED edges (${uniqueFamilies} tool families → ${uniqueFiles} files)`);

    return {
      edgesCreated: totalCreated,
      familyCount: uniqueFamilies,
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
