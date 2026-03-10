/**
 * Seed gitChangeFrequency on SourceFile and Function nodes from git log.
 * 
 * Runs `git log --name-only` on the target repo and counts commits per file.
 * Normalizes to 0.0-1.0 range. Propagates file frequency to contained functions.
 * 
 * Usage: npx tsx seed-git-frequency.ts [repoPath] [months]
 */
import { execSync } from 'child_process';
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';

dotenv.config();

const REPO_PATH = process.argv[2] || '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed';
const MONTHS = parseInt(process.argv[3] || '6');

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'codegraph'
  )
);

async function main() {
  // Get git log — count commits per file
  let gitOutput: string;
  try {
    gitOutput = execSync(
      `git log --name-only --pretty=format: --since=${MONTHS}.months`,
      { cwd: REPO_PATH, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
  } catch {
    console.log('⚠️  No git history or git not available. Setting all frequencies to 0.');
    gitOutput = '';
  }

  // Count commits per file
  const fileCounts = new Map<string, number>();
  const lines = gitOutput.split('\n').filter(l => l.trim().length > 0);
  
  for (const line of lines) {
    const count = fileCounts.get(line) || 0;
    fileCounts.set(line, count + 1);
  }

  // Find max for normalization
  const maxCount = Math.max(1, ...fileCounts.values());
  
  console.log(`Git log: ${fileCounts.size} files changed in last ${MONTHS} months`);
  console.log(`Max commits per file: ${maxCount}`);

  // Top 10
  const sorted = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log('\nTop 10 most-changed files:');
  for (const [file, count] of sorted.slice(0, 10)) {
    console.log(`  ${count} commits — ${file} (freq: ${(count / maxCount).toFixed(2)})`);
  }

  const session = driver.session();
  try {
    // Set frequency on SourceFile nodes
    let updated = 0;
    for (const [relPath, count] of fileCounts) {
      const freq = count / maxCount;
      const result = await session.run(`
        MATCH (sf:SourceFile)
        WHERE sf.filePath ENDS WITH $relPath
        SET sf.gitChangeFrequency = $freq, sf.gitCommitCount = $count
        RETURN count(sf) AS matched
      `, { relPath, freq, count: neo4j.int(count) });
      updated += result.records[0]?.get('matched')?.toNumber() || 0;
    }
    console.log(`\nUpdated ${updated} SourceFile nodes with gitChangeFrequency`);

    // Set 0 for files with no changes
    const zeroResult = await session.run(`
      MATCH (sf:SourceFile)
      WHERE sf.gitChangeFrequency IS NULL
      SET sf.gitChangeFrequency = 0.0, sf.gitCommitCount = 0
      RETURN count(sf) AS zeroed
    `);
    console.log(`Set ${zeroResult.records[0]?.get('zeroed')?.toNumber() || 0} unchanged files to 0`);

    // Propagate to contained functions: function inherits its file's frequency
    const propResult = await session.run(`
      MATCH (sf:SourceFile)-[:CONTAINS*1..2]->(fn:Function)
      WHERE sf.gitChangeFrequency IS NOT NULL
      SET fn.gitChangeFrequency = sf.gitChangeFrequency
      RETURN count(fn) AS propagated
    `);
    console.log(`Propagated frequency to ${propResult.records[0]?.get('propagated')?.toNumber() || 0} Function nodes`);

    // Recompute riskLevel with git frequency factor
    const riskResult = await session.run(`
      MATCH (fn:Function)
      WHERE fn.fanInCount IS NOT NULL AND fn.fanOutCount IS NOT NULL
      SET fn.riskLevel = fn.fanInCount * fn.fanOutCount 
        * log(toFloat(coalesce(fn.lineCount, 1)) + 1.0)
        * (1.0 + coalesce(fn.gitChangeFrequency, 0.0))
      RETURN count(fn) AS recomputed
    `);
    console.log(`Recomputed riskLevel with git factor for ${riskResult.records[0]?.get('recomputed')?.toNumber() || 0} functions`);

    // Recompute risk tiers
    await session.run(`
      MATCH (fn:Function)
      SET fn.riskTier = CASE
        WHEN fn.riskLevel > 500 THEN 'CRITICAL'
        WHEN fn.riskLevel > 100 THEN 'HIGH'
        WHEN fn.riskLevel > 20 THEN 'MEDIUM'
        ELSE 'LOW'
      END
    `);
    console.log('Risk tiers recomputed');

  } finally {
    await session.close();
    await driver.close();
  }

  console.log('\n✅ Git frequency seeding complete!');
}

main().catch(console.error);
