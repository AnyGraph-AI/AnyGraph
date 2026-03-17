#!/usr/bin/env npx tsx
/**
 * Phase 2.2: Temporal Coupling — git co-change mining
 * 
 * Mines git log for files that change together in the same commit,
 * then creates CO_CHANGES_WITH edges between SourceFile nodes.
 * 
 * Temporal coupling is the strongest predictor of where bugs cluster
 * (CodeScene insight). Files that change together are coupled regardless
 * of whether they have static dependencies.
 * 
 * Usage:
 *   npx tsx temporal-coupling.ts [repoPath] [projectId]
 * 
 * Defaults to CodeGraph if no args provided.
 */
import neo4j from 'neo4j-driver';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

interface CoChangePair {
  file1: string;
  file2: string;
  coChangeCount: number;
  commits: string[];
  lastCoChange: string;
}

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

export function mineCoChanges(repoPath: string): CoChangePair[] {
  // Get git log: each commit with its changed files
  const gitLog = execSync(
    `cd "${repoPath}" && git log --name-only --pretty=format:"COMMIT:%H:%aI" --diff-filter=AMRC -- '*.ts' '*.tsx'`,
    { maxBuffer: 50 * 1024 * 1024 }
  ).toString();

  // Parse into commits → file sets
  const commits: { hash: string; date: string; files: string[] }[] = [];
  let current: { hash: string; date: string; files: string[] } | null = null;

  for (const line of gitLog.split('\n')) {
    if (line.startsWith('COMMIT:')) {
      if (current && current.files.length > 0) {
        commits.push(current);
      }
      const [, hash, date] = line.split(':');
      current = { hash: hash.slice(0, 8), date: date || '', files: [] };
    } else if (line.trim() && current) {
      // Only include .ts/.tsx files that are in src/ or top-level
      const file = line.trim();
      if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        current.files.push(file);
      }
    }
  }
  if (current && current.files.length > 0) {
    commits.push(current);
  }

  console.log(`  Parsed ${commits.length} commits with TypeScript changes`);

  // Count co-changes: for each commit, every pair of files changed together
  const pairMap = new Map<string, CoChangePair>();

  for (const commit of commits) {
    const files = commit.files.sort();
    // Skip commits with too many files (likely bulk refactors, not meaningful coupling)
    if (files.length > 20) continue;
    // Skip single-file commits (no co-change)
    if (files.length < 2) continue;

    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = `${files[i]}||${files[j]}`;
        const existing = pairMap.get(key);
        if (existing) {
          existing.coChangeCount++;
          existing.commits.push(commit.hash);
          if (commit.date > existing.lastCoChange) {
            existing.lastCoChange = commit.date;
          }
        } else {
          pairMap.set(key, {
            file1: files[i],
            file2: files[j],
            coChangeCount: 1,
            commits: [commit.hash],
            lastCoChange: commit.date,
          });
        }
      }
    }
  }

  // Filter: only keep pairs with ≥2 co-changes (reduce noise from one-off commits)
  const pairs = Array.from(pairMap.values())
    .filter(p => p.coChangeCount >= 2)
    .sort((a, b) => b.coChangeCount - a.coChangeCount);

  console.log(`  Found ${pairMap.size} total pairs, ${pairs.length} with ≥2 co-changes`);

  return pairs;
}

export async function ingestCoChanges(pairs: CoChangePair[], projectId: string) {
  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'codegraph'
    )
  );
  const session = driver.session();

  try {
    // Clear existing CO_CHANGES_WITH edges for this project
    const deleted = await session.run(`
      MATCH (s1:SourceFile {projectId: $pid})-[r:CO_CHANGES_WITH]-(s2:SourceFile {projectId: $pid})
      DELETE r
      RETURN count(r) AS deleted
    `, { pid: projectId });
    const deletedCount = deleted.records[0]?.get('deleted')?.toNumber?.() ?? 0;
    if (deletedCount > 0) {
      console.log(`  Cleared ${deletedCount} existing CO_CHANGES_WITH edges`);
    }

    // Create edges in batches
    let created = 0;
    const BATCH_SIZE = 100;

    for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
      const batch = pairs.slice(i, i + BATCH_SIZE);
      const result = await session.run(`
        UNWIND $pairs AS pair
        MATCH (s1:SourceFile {projectId: $pid})
        WHERE s1.filePath ENDS WITH pair.file1 OR s1.name = pair.file1
        MATCH (s2:SourceFile {projectId: $pid})
        WHERE s2.filePath ENDS WITH pair.file2 OR s2.name = pair.file2
        AND s1 <> s2
        MERGE (s1)-[r:CO_CHANGES_WITH]-(s2)
        SET r.projectId = $pid,
            r.coChangeCount = pair.coChangeCount,
            r.commits = pair.commits,
            r.lastCoChange = pair.lastCoChange,
            r.couplingStrength = CASE 
              WHEN pair.coChangeCount >= 10 THEN 'STRONG'
              WHEN pair.coChangeCount >= 5 THEN 'MODERATE'
              ELSE 'WEAK'
            END
        RETURN count(r) AS created
      `, { pairs: batch, pid: projectId });
      created += result.records[0]?.get('created')?.toNumber?.() ?? 0;
    }

    console.log(`  Created ${created} CO_CHANGES_WITH edges`);

    // Update risk scoring to include temporal coupling
    const riskUpdate = await session.run(`
      MATCH (f:Function {projectId: $pid})
      WHERE f.riskLevel IS NOT NULL
      OPTIONAL MATCH (sf:SourceFile)-[:CONTAINS]->(f)
      OPTIONAL MATCH (sf)-[cc:CO_CHANGES_WITH]-(other:SourceFile)
      WITH f, sf, sum(cc.coChangeCount) AS totalCoupling
      SET f.temporalCoupling = totalCoupling,
          f.riskLevelV2 = f.riskLevel * (1.0 + toFloat(totalCoupling) * 0.1)
      RETURN count(f) AS updated
    `, { pid: projectId });
    const updated = riskUpdate.records[0]?.get('updated')?.toNumber?.() ?? 0;
    console.log(`  Updated riskLevelV2 on ${updated} functions`);

    // Show top coupled pairs
    console.log('\n=== TOP 15 TEMPORALLY COUPLED FILE PAIRS ===');
    const top = await session.executeRead(tx => tx.run(`
      MATCH (s1:SourceFile {projectId: $pid})-[r:CO_CHANGES_WITH]-(s2:SourceFile {projectId: $pid})
      WHERE id(s1) < id(s2)
      RETURN s1.name AS file1, s2.name AS file2, 
             r.coChangeCount AS coChanges, r.couplingStrength AS strength
      ORDER BY r.coChangeCount DESC
      LIMIT 15
    `, { pid: projectId }));

    for (const r of top.records) {
      const strength = r.get('strength');
      const icon = strength === 'STRONG' ? '🔥' : strength === 'MODERATE' ? '⚡' : '·';
      console.log(`  ${icon} ${r.get('file1')} ↔ ${r.get('file2')}: ${r.get('coChanges')} co-changes (${strength})`);
    }

    // Show functions with highest temporal coupling impact
    console.log('\n=== FUNCTIONS WITH HIGHEST TEMPORAL COUPLING ===');
    const hotFuncs = await session.executeRead(tx => tx.run(`
      MATCH (f:Function {projectId: $pid})
      WHERE f.temporalCoupling > 0
      RETURN f.name, f.riskTier, f.riskLevel, f.riskLevelV2, f.temporalCoupling
      ORDER BY f.riskLevelV2 DESC
      LIMIT 10
    `, { pid: projectId }));

    for (const r of hotFuncs.records) {
      const v1 = r.get('f.riskLevel')?.toFixed?.(1) ?? r.get('f.riskLevel');
      const v2 = r.get('f.riskLevelV2')?.toFixed?.(1) ?? r.get('f.riskLevelV2');
      console.log(`  ${r.get('f.name')}: risk ${v1} → ${v2} (coupling: ${r.get('f.temporalCoupling')})`);
    }

    // Check if there are hidden couplings (co-change but no static dependency)
    console.log('\n=== HIDDEN COUPLINGS (co-change but NO static import) ===');
    const hidden = await session.executeRead(tx => tx.run(`
      MATCH (s1:SourceFile {projectId: $pid})-[cc:CO_CHANGES_WITH]-(s2:SourceFile {projectId: $pid})
      WHERE id(s1) < id(s2)
      AND NOT (s1)-[:IMPORTS]-(s2)
      AND cc.coChangeCount >= 3
      RETURN s1.name AS file1, s2.name AS file2, cc.coChangeCount AS coChanges
      ORDER BY cc.coChangeCount DESC
      LIMIT 10
    `, { pid: projectId }));

    if (hidden.records.length > 0) {
      for (const r of hidden.records) {
        console.log(`  ⚠️  ${r.get('file1')} ↔ ${r.get('file2')}: ${r.get('coChanges')} co-changes, NO import relationship`);
      }
    } else {
      console.log('  None found — all coupled files also have static dependencies.');
    }

  } finally {
    await session.close();
    await driver.close();
  }
}

export async function main() {
  const arg = process.argv[2] || 'codegraph';

  let repoPath: string;
  let projectId: string;

  if (arg in PROJECTS) {
    repoPath = PROJECTS[arg].path;
    projectId = PROJECTS[arg].id;
  } else {
    repoPath = arg;
    projectId = process.argv[3] || 'unknown';
  }

  console.log(`\n📊 Temporal Coupling Analysis`);
  console.log(`   Repo: ${repoPath}`);
  console.log(`   Project: ${projectId}\n`);

  console.log('1. Mining git co-change history...');
  const pairs = mineCoChanges(repoPath);

  console.log('\n2. Ingesting CO_CHANGES_WITH edges into Neo4j...');
  await ingestCoChanges(pairs, projectId);

  console.log('\n✅ Temporal coupling analysis complete!');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/temporal-coupling.ts') || process.argv[1]?.endsWith('/temporal-coupling.js')) {
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
