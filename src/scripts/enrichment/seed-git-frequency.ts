/**
 * GC-1: Seed git frequency signals on SourceFile and Function nodes.
 * 
 * Stores THREE raw signals (never normalized for storage):
 *   - commitCountRaw: total all-time commits touching this file
 *   - commitCountWindowed: commits within the configured window (default 6m)
 *   - churnRelative: (lines added + lines removed) / total lines in file, within window
 *   - windowPeriod: the window used (e.g., "6m")
 * 
 * Propagates file-level stats to contained Function nodes via CONTAINS edges.
 * 
 * Usage: npx tsx seed-git-frequency.ts [repoPath] [projectId] [months]
 *   repoPath defaults to the codegraph directory
 *   projectId defaults to 'proj_c0d3e9a1f200'
 *   months defaults to 6
 */
import { execSync } from 'child_process';
import neo4j, { type Driver } from 'neo4j-driver';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

// --------------- Pure functions (exported for testing) ---------------

export interface GitFileStats {
  commitCountRaw: number;
  commitCountWindowed: number;
  churnRelative: number;
  windowPeriod: string;
}

export interface GitFrequencyResult {
  filesProcessed: number;
  sourceFilesUpdated: number;
  functionsUpdated: number;
  stats: Map<string, GitFileStats>;
}

/**
 * Parse git log --name-only output into a Map of relPath → commit count.
 */
export function parseGitLog(gitOutput: string): Map<string, number> {
  const fileCounts = new Map<string, number>();
  if (!gitOutput || !gitOutput.trim()) return fileCounts;
  
  const lines = gitOutput.split('\n').filter(l => l.trim().length > 0);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      fileCounts.set(trimmed, (fileCounts.get(trimmed) || 0) + 1);
    }
  }
  return fileCounts;
}

/**
 * Parse git log --numstat output into a Map of relPath → { added, removed }.
 */
export function parseGitNumstat(numstatOutput: string): Map<string, { added: number; removed: number }> {
  const churnMap = new Map<string, { added: number; removed: number }>();
  if (!numstatOutput || !numstatOutput.trim()) return churnMap;

  const lines = numstatOutput.split('\n').filter(l => /^\d+\t\d+\t/.test(l));
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const added = parseInt(parts[0]) || 0;
      const removed = parseInt(parts[1]) || 0;
      const filePath = parts[2].trim();
      const existing = churnMap.get(filePath) || { added: 0, removed: 0 };
      churnMap.set(filePath, {
        added: existing.added + added,
        removed: existing.removed + removed,
      });
    }
  }
  return churnMap;
}

/**
 * Compute churn relative: (linesChanged / totalLines), capped at 1.0.
 */
export function computeChurnRelative(linesChanged: number, totalLines: number): number {
  if (totalLines <= 0) return 0;
  return Math.min(linesChanged / totalLines, 1.0);
}

// --------------- Neo4j enrichment (main) ---------------

export async function enrichGitFrequency(
  driver: Driver,
  repoPath: string,
  projectId: string,
  months: number = 6,
): Promise<GitFrequencyResult> {
  const windowPeriod = `${months}m`;

  // 1. Get all-time commit counts
  let rawOutput: string;
  try {
    rawOutput = execSync('git log --name-only --pretty=format:', {
      cwd: repoPath,
      encoding: 'utf-8',
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    console.log('⚠️  No git history or git not available at', repoPath);
    rawOutput = '';
  }
  const rawCounts = parseGitLog(rawOutput);

  // 2. Get windowed commit counts
  let windowedOutput: string;
  try {
    windowedOutput = execSync(`git log --name-only --pretty=format: --since=${months}.months`, {
      cwd: repoPath,
      encoding: 'utf-8',
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    windowedOutput = '';
  }
  const windowedCounts = parseGitLog(windowedOutput);

  // 3. Get line-level churn (numstat) for the window
  let numstatOutput: string;
  try {
    numstatOutput = execSync(`git log --numstat --pretty=format: --since=${months}.months`, {
      cwd: repoPath,
      encoding: 'utf-8',
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    numstatOutput = '';
  }
  const churnData = parseGitNumstat(numstatOutput);

  // 4. Get file line counts from disk (wc -l) for churn computation
  //    Graph's SourceFile.lineCount is often NULL; disk is ground truth
  const session = driver.session();
  const statsMap = new Map<string, GitFileStats>();

  try {
    // Get all SourceFile paths for this project
    const sfResult = await session.run(`
      MATCH (sf:SourceFile {projectId: $projectId})
      WHERE sf.filePath IS NOT NULL
      RETURN sf.filePath AS filePath
    `, { projectId });

    const fileLineCounts = new Map<string, number>();
    for (const record of sfResult.records) {
      const fp = record.get('filePath') as string;
      try {
        const wcOutput = execSync(`wc -l < "${fp}"`, { encoding: 'utf-8' }).trim();
        fileLineCounts.set(fp, parseInt(wcOutput) || 0);
      } catch {
        fileLineCounts.set(fp, 0);
      }
    }

    // Build all unique files from git data
    const allRelPaths = new Set([...rawCounts.keys(), ...windowedCounts.keys(), ...churnData.keys()]);

    console.log(`Git: ${rawCounts.size} files all-time, ${windowedCounts.size} in ${windowPeriod} window, ${churnData.size} with numstat`);

    // 5. Match git relative paths to absolute SourceFile paths and store stats
    let sourceFilesUpdated = 0;
    for (const relPath of allRelPaths) {
      const commitCountRaw = rawCounts.get(relPath) || 0;
      const commitCountWindowed = windowedCounts.get(relPath) || 0;
      const churn = churnData.get(relPath);
      const linesChanged = churn ? churn.added + churn.removed : 0;

      // Match SourceFile by ENDS WITH (relative path → absolute path)
      // Look up disk line count for the matched file to compute churnRelative
      const result = await session.run(`
        MATCH (sf:SourceFile {projectId: $projectId})
        WHERE sf.filePath ENDS WITH $relPath
        SET sf.commitCountRaw = $commitCountRaw,
            sf.commitCountWindowed = $commitCountWindowed,
            sf.churnRelative = $churnRelative,
            sf.windowPeriod = $windowPeriod
        RETURN count(sf) AS matched, collect(sf.filePath) AS paths
      `, {
        relPath,
        commitCountRaw: neo4j.int(commitCountRaw),
        commitCountWindowed: neo4j.int(commitCountWindowed),
        churnRelative: (() => {
          // Find the absolute path that matches this relPath
          for (const [absPath, lineCount] of fileLineCounts) {
            if (absPath.endsWith(relPath)) {
              return computeChurnRelative(linesChanged, lineCount);
            }
          }
          return 0.0;
        })(),
        windowPeriod,
        projectId,
      });

      const matched = result.records[0]?.get('matched')?.toNumber?.() || 0;
      sourceFilesUpdated += matched;

      if (matched > 0) {
        const absPath = [...fileLineCounts.keys()].find(p => p.endsWith(relPath));
        const totalLines = absPath ? fileLineCounts.get(absPath) || 0 : 0;
        statsMap.set(relPath, {
          commitCountRaw,
          commitCountWindowed,
          churnRelative: computeChurnRelative(linesChanged, totalLines),
          windowPeriod,
        });
      }
    }

    // 6. Set zero for files with no git history
    await session.run(`
      MATCH (sf:SourceFile {projectId: $projectId})
      WHERE sf.commitCountRaw IS NULL
      SET sf.commitCountRaw = 0,
          sf.commitCountWindowed = 0,
          sf.churnRelative = 0.0,
          sf.windowPeriod = $windowPeriod
    `, { projectId, windowPeriod });

    // 7. Propagate to Functions via CONTAINS
    const propResult = await session.run(`
      MATCH (sf:SourceFile {projectId: $projectId})-[:CONTAINS*1..2]->(fn:Function)
      SET fn.commitCountRaw = sf.commitCountRaw,
          fn.commitCountWindowed = sf.commitCountWindowed,
          fn.churnRelative = sf.churnRelative,
          fn.windowPeriod = sf.windowPeriod
      RETURN count(fn) AS propagated
    `, { projectId });

    const functionsUpdated = propResult.records[0]?.get('propagated')?.toNumber?.() || 0;

    // 8. Recompute riskLevel with git change factor
    // Uses (1.0 + churnRelative) as a multiplier — files with higher churn get boosted risk
    await session.run(`
      MATCH (fn:Function {projectId: $projectId})
      WHERE fn.fanInCount IS NOT NULL AND fn.fanOutCount IS NOT NULL
      SET fn.riskLevel = fn.fanInCount * fn.fanOutCount 
        * log(toFloat(coalesce(fn.lineCount, 1)) + 1.0)
        * (1.0 + coalesce(fn.churnRelative, 0.0))
    `, { projectId });

    // 9. Recompute risk tiers
    await session.run(`
      MATCH (fn:Function {projectId: $projectId})
      SET fn.riskTier = CASE
        WHEN fn.riskLevel > 500 THEN 'CRITICAL'
        WHEN fn.riskLevel > 100 THEN 'HIGH'
        WHEN fn.riskLevel > 20 THEN 'MEDIUM'
        ELSE 'LOW'
      END
    `, { projectId });

    console.log(`Updated ${sourceFilesUpdated} SourceFiles, propagated to ${functionsUpdated} Functions`);

    return {
      filesProcessed: allRelPaths.size,
      sourceFilesUpdated,
      functionsUpdated,
      stats: statsMap,
    };

  } finally {
    await session.close();
  }
}

// --------------- CLI entry point ---------------

const DEFAULT_REPO = '/home/jonathan/.openclaw/workspace/codegraph';
const DEFAULT_PROJECT = 'proj_c0d3e9a1f200';

async function main() {
  const repoPath = process.argv[2] || DEFAULT_REPO;
  const projectId = process.argv[3] || DEFAULT_PROJECT;
  const months = parseInt(process.argv[4] || '6');

  console.log(`Seeding git frequency for ${projectId} from ${repoPath} (${months}m window)`);

  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'codegraph'
    )
  );

  try {
    const result = await enrichGitFrequency(driver, repoPath, projectId, months);
    console.log(`\n✅ Git frequency seeding complete!`);
    console.log(`   ${result.filesProcessed} git files → ${result.sourceFilesUpdated} SourceFiles → ${result.functionsUpdated} Functions`);
    
    // Print top 10
    const sorted = [...result.stats.entries()]
      .sort((a, b) => b[1].commitCountRaw - a[1].commitCountRaw)
      .slice(0, 10);
    console.log('\nTop 10 most-changed files:');
    for (const [file, stats] of sorted) {
      console.log(`  ${stats.commitCountRaw} commits (${stats.commitCountWindowed} in ${stats.windowPeriod}) churn=${stats.churnRelative.toFixed(2)} — ${file}`);
    }
  } finally {
    await driver.close();
  }
}

// Run if called directly
const isDirectRun = process.argv[1]?.includes('seed-git-frequency');
if (isDirectRun) {
  main().catch(console.error);
}
