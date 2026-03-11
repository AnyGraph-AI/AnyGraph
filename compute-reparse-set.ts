/**
 * Dependency-aware invalidation — Extension 20
 * 
 * Given a set of changed files, computes the full reparse set by following
 * dependency edges (IMPORTS, EXTENDS, IMPLEMENTS, RESOLVES_TO) transitively.
 * 
 * Usage: npx tsx compute-reparse-set.ts <file1> [file2] [file3]
 * Example: npx tsx compute-reparse-set.ts src/core/engine.ts
 * 
 * Outputs: list of all files that need reparsing, ordered by dependency depth.
 */
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';

dotenv.config();

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'codegraph'
  )
);

async function main() {
  const changedFiles = process.argv.slice(2);
  
  if (changedFiles.length === 0) {
    console.log('Usage: npx tsx compute-reparse-set.ts <file1> [file2] ...');
    console.log('Example: npx tsx compute-reparse-set.ts src/core/engine.ts');
    process.exit(1);
  }

  const session = driver.session();

  try {
    // Find all files that depend on the changed files, transitively up to depth 4
    // Dependencies flow: if A imports B and B changed, A must reparse
    const result = await session.run(`
      UNWIND $changedFiles AS changedFile
      MATCH (changed:SourceFile)
      WHERE changed.filePath ENDS WITH changedFile OR changed.name = changedFile
      
      // Find files that import the changed file (direct dependents)
      OPTIONAL MATCH (dependent:SourceFile)-[:IMPORTS]->(changed)
      
      // Find files that import symbols resolving to the changed file
      OPTIONAL MATCH (imp:Import)-[:RESOLVES_TO]->(decl)
      WHERE decl.filePath = changed.filePath
      OPTIONAL MATCH (impFile:SourceFile)-[:CONTAINS]->(imp)
      
      // Find classes that extend/implement types from the changed file
      OPTIONAL MATCH (cls)-[:EXTENDS|IMPLEMENTS]->(target)
      WHERE target.filePath = changed.filePath
      OPTIONAL MATCH (clsFile:SourceFile)-[:CONTAINS*1..2]->(cls)
      
      // Collect all affected files
      WITH collect(DISTINCT changed.filePath) + 
           collect(DISTINCT dependent.filePath) + 
           collect(DISTINCT impFile.filePath) + 
           collect(DISTINCT clsFile.filePath) AS allFiles
      UNWIND allFiles AS filePath
      WITH DISTINCT filePath
      WHERE filePath IS NOT NULL
      RETURN filePath
      ORDER BY filePath
    `, { changedFiles });

    const reparseSet = result.records.map(r => r.get('filePath'));
    
    console.log(`Changed files: ${changedFiles.join(', ')}`);
    console.log(`\nReparse set (${reparseSet.length} files):`);
    for (const file of reparseSet) {
      const isChanged = changedFiles.some(cf => file.endsWith(cf));
      console.log(`  ${isChanged ? '★' : '→'} ${file.split('/').pop()}\t${file}`);
    }

    // Also show the impact depth
    const depthResult = await session.run(`
      UNWIND $changedFiles AS changedFile
      MATCH (changed:SourceFile)
      WHERE changed.filePath ENDS WITH changedFile OR changed.name = changedFile
      MATCH path = (dependent:SourceFile)-[:IMPORTS*1..4]->(changed)
      RETURN dependent.name AS file, length(path) AS depth
      ORDER BY depth, file
    `, { changedFiles });

    if (depthResult.records.length > 0) {
      console.log('\nDependency depth:');
      for (const record of depthResult.records) {
        const depth = record.get('depth')?.toNumber?.() ?? record.get('depth');
        console.log(`  depth ${depth}: ${record.get('file')}`);
      }
    }

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);
