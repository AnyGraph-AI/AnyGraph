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

/**
 * Resolve an includedPath to an absolute SourceFile path.
 * 
 * ESLint paths: file:///home/user/code/a.ts → /home/user/code/a.ts
 * Semgrep paths: src/cli/cli.ts → /home/user/code/src/cli/cli.ts (needs repoRoot)
 */
export function resolveIncludedPath(uri: string, repoRoot: string): string {
  const stripped = stripFileUri(uri);
  if (!stripped) return '';
  // Already absolute
  if (stripped.startsWith('/')) return stripped;
  // Relative — resolve against repo root
  return repoRoot.endsWith('/') ? repoRoot + stripped : repoRoot + '/' + stripped;
}

export async function enrichAnalyzedEdges(
  driver: Driver,
  projectId: string,
): Promise<{ edgesCreated: number; vrCount: number; fileCount: number }> {
  const session = driver.session();

  try {
    // 0a. Pre-run snapshot: count existing ANALYZED edges before any mutation (READ-ONLY, outside transaction)
    const preRunResult = await session.run(`
      MATCH (:VerificationRun {projectId: $projectId})-[r:ANALYZED]->(:SourceFile)
      RETURN count(r) AS preRunCount
    `, { projectId });
    const preRunCount = preRunResult.records[0]?.get('preRunCount')?.toNumber?.() || 0;
    console.log(`[create-analyzed-edges] Pre-run ANALYZED edge count: ${preRunCount}`);

    // 1. Get all SourceFile paths for this project (READ-ONLY, outside transaction)
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

    // Derive repoRoot from longest common prefix of all SourceFile paths
    const pathArray = [...sourceFilePaths];
    let repoRoot = '';
    if (pathArray.length > 0) {
      repoRoot = pathArray[0];
      for (let i = 1; i < pathArray.length; i++) {
        while (!pathArray[i].startsWith(repoRoot)) {
          repoRoot = repoRoot.substring(0, repoRoot.lastIndexOf('/'));
        }
      }
      if (!repoRoot.endsWith('/')) repoRoot += '/';
    }
    console.log(`Derived repoRoot: ${repoRoot}`);

    // 2. Get all VR→AnalysisScope data with sourceFamily (READ-ONLY, outside transaction)
    const scopeResult = await session.run(`
      MATCH (vr:VerificationRun {projectId: $projectId})-[:HAS_SCOPE]->(scope:AnalysisScope)
      WHERE scope.includedPaths IS NOT NULL
      RETURN vr.id AS vrId, vr.sourceFamily AS sourceFamily, scope.includedPaths AS includedPaths
    `, { projectId });

    // 3. Build unique (sourceFamily, filePath) pairs — scope-level dedup
    //    Each tool family gets ONE ANALYZED edge per file, not one per finding.
    //    "ESLint analyzed this file" is true once, not 197 times.
    const familyFilePairs = new Map<string, Set<string>>(); // family → Set<filePath>
    const familyAnchorVr = new Map<string, string>(); // family → representative vrId

    for (const record of scopeResult.records) {
      const vrId = record.get('vrId') as string;
      const family = record.get('sourceFamily') as string;
      const paths = record.get('includedPaths') as string[];
      if (!paths) continue;

      if (!familyAnchorVr.has(family)) familyAnchorVr.set(family, vrId);

      const fileSet = familyFilePairs.get(family) || new Set<string>();
      for (const uri of paths) {
        const resolved = resolveIncludedPath(uri, repoRoot);
        if (sourceFilePaths.has(resolved)) {
          fileSet.add(resolved);
        }
      }
      familyFilePairs.set(family, fileSet);
    }

    // 4. Count VRs without scope data (READ-ONLY, outside transaction)
    const noScopeResult = await session.run(`
      MATCH (vr:VerificationRun {projectId: $projectId})
      WHERE NOT EXISTS { (vr)-[:HAS_SCOPE]->() }
      RETURN vr.sourceFamily AS family, count(vr) AS cnt
    `, { projectId });
    for (const record of noScopeResult.records) {
      console.log(`  ${record.get('family')}: ${record.get('cnt')} VRs without scope (skipped — no file-level data)`);
    }

    // === TRANSACTION BOUNDARY: DELETE + RECREATE must be atomic (SCAR-012 fix) ===
    // If anything throws between delete and recreate, Neo4j rolls back both.
    const tx = session.beginTransaction();
    let totalCreated = 0;
    let totalFiles = 0;
    let deleted = 0;

    try {
      // 0b. Clean old ANALYZED edges (idempotent re-run) — INSIDE TRANSACTION
      const deleteResult = await tx.run(`
        MATCH (:VerificationRun {projectId: $projectId})-[r:ANALYZED]->(:SourceFile)
        DELETE r RETURN count(r) AS deleted
      `, { projectId });
      deleted = deleteResult.records[0]?.get('deleted')?.toNumber?.() || 0;
      if (deleted > 0) console.log(`Cleaned ${deleted} old ANALYZED edges`);

      // 5. Create ANALYZED edges — one per (tool family, SourceFile) — INSIDE TRANSACTION
      //    Uses an anchor VR per family as the edge source.
      //    Edge carries sourceFamily so queries can filter by tool.
      //    Future: per-finding FLAGS edges when importer stores location.
      const BATCH_SIZE = 500;

      for (const [family, fileSet] of familyFilePairs) {
        const anchorVrId = familyAnchorVr.get(family)!;
        const filePaths = [...fileSet];
        totalFiles += filePaths.length;

        for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
          const batch = filePaths.slice(i, i + BATCH_SIZE);
          const result = await tx.run(`
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

        console.log(`  ${family}: ${filePaths.length} files → anchor ${anchorVrId.slice(0, 40)}...`);
      }

      // Commit transaction — delete + all creates are atomic
      await tx.commit();
    } catch (err) {
      // Rollback on any error — graph returns to pre-run state
      await tx.rollback();
      console.error('[create-analyzed-edges] Transaction rolled back due to error:', err);
      throw err;
    }
    // === END TRANSACTION BOUNDARY ===

    const uniqueFiles = new Set([...familyFilePairs.values()].flatMap(s => [...s])).size;

    console.log(`Created ${totalCreated} ANALYZED edges (${familyFilePairs.size} families → ${uniqueFiles} files)`);

    // Post-run verification: count ANALYZED edges after recreation (READ-ONLY, outside transaction)
    const postRunResult = await session.run(`
      MATCH (:VerificationRun {projectId: $projectId})-[r:ANALYZED]->(:SourceFile)
      RETURN count(r) AS postRunCount
    `, { projectId });
    const postRunCount = postRunResult.records[0]?.get('postRunCount')?.toNumber?.() || 0;
    console.log(`[create-analyzed-edges] Post-run ANALYZED edge count: ${postRunCount} (was: ${preRunCount})`);

    // DESTRUCTIVE FAILURE GUARD: If we deleted edges but created 0, graph is corrupted
    // With transaction wrapping, this should NEVER fire (rollback would restore pre-run state)
    // Kept as sanity check for unexpected edge cases
    if (postRunCount === 0 && preRunCount > 0) {
      const errorMessage = `[create-analyzed-edges] DESTRUCTIVE FAILURE: deleted ${preRunCount} edges, recreated 0. ` +
        `Graph state is corrupted. Run recovery: ` +
        `enrich:vr-scope && enrich:composite-risk && enrich:precompute-scores`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }

    return { edgesCreated: totalCreated, vrCount: familyFilePairs.size, fileCount: uniqueFiles };

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
