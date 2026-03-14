#!/usr/bin/env npx tsx
/**
 * Author Ownership — git blame → OWNED_BY edges
 * 
 * For each SourceFile, runs git blame to find the primary author
 * (most lines attributed). Creates Author nodes and OWNED_BY edges.
 * 
 * Also computes authorEntropy per file: number of distinct authors.
 * High entropy = fragmented ownership = higher change risk.
 * 
 * Usage: npx tsx seed-author-ownership.ts [codegraph|godspeed]
 */
import neo4j from 'neo4j-driver';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

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

interface BlameResult {
  filePath: string;
  authors: Map<string, number>; // author → line count
  totalLines: number;
}

function getBlameForFile(repoPath: string, filePath: string): BlameResult | null {
  try {
    // Get relative path from repo root
    const relativePath = filePath.startsWith(repoPath)
      ? filePath.slice(repoPath.length)
      : filePath;

    const output = execSync(
      `cd "${repoPath}" && git blame --line-porcelain "${relativePath}" 2>/dev/null | grep "^author " | sed 's/^author //'`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );

    const authors = new Map<string, number>();
    let totalLines = 0;

    for (const line of output.trim().split('\n')) {
      if (line) {
        authors.set(line, (authors.get(line) || 0) + 1);
        totalLines++;
      }
    }

    return { filePath, authors, totalLines };
  } catch {
    return null;
  }
}

async function main() {
  const projectKey = process.argv[2] || 'codegraph';
  const project = PROJECTS[projectKey];
  if (!project) {
    console.error(`Unknown project: ${projectKey}. Use: codegraph | godspeed`);
    process.exit(1);
  }

  console.log(`\nSeeding author ownership for ${projectKey}...`);
  console.log(`  Project: ${project.id}`);
  console.log(`  Path: ${project.path}\n`);

  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'codegraph'
    )
  );
  const session = driver.session();

  try {
    // Get all source files from graph
    const filesResult = await session.run(
      'MATCH (sf:SourceFile {projectId: $pid}) RETURN sf.filePath AS filePath',
      { pid: project.id }
    );

    const files = filesResult.records.map(r => r.get('filePath') as string);
    console.log(`Found ${files.length} source files in graph`);

    // Clear existing author data
    await session.run(
      'MATCH (a:Author {projectId: $pid}) DETACH DELETE a',
      { pid: project.id }
    );
    console.log('Cleared existing Author nodes');

    // Process each file
    let processed = 0;
    let skipped = 0;
    const allAuthors = new Map<string, Set<string>>(); // author → files they own

    for (const filePath of files) {
      const blame = getBlameForFile(project.path, filePath);
      if (!blame || blame.totalLines === 0) {
        skipped++;
        continue;
      }

      // Find primary author (most lines)
      let primaryAuthor = '';
      let maxLines = 0;
      for (const [author, lines] of blame.authors) {
        if (lines > maxLines) {
          maxLines = lines;
          primaryAuthor = author;
        }
      }

      const authorEntropy = blame.authors.size;
      const ownershipPct = Math.round((maxLines / blame.totalLines) * 100);

      // Track for Author node creation
      if (!allAuthors.has(primaryAuthor)) {
        allAuthors.set(primaryAuthor, new Set());
      }
      allAuthors.get(primaryAuthor)!.add(filePath);

      // Set authorEntropy on SourceFile
      await session.run(`
        MATCH (sf:SourceFile {filePath: $filePath, projectId: $pid})
        SET sf.authorEntropy = $entropy, sf.primaryAuthor = $author, sf.ownershipPct = $pct
      `, {
        filePath,
        pid: project.id,
        entropy: neo4j.int(authorEntropy),
        author: primaryAuthor,
        pct: neo4j.int(ownershipPct),
      });

      processed++;
    }

    console.log(`\nProcessed ${processed} files, skipped ${skipped}`);

    // Create Author nodes and OWNED_BY edges
    for (const [authorName, ownedFiles] of allAuthors) {
      const authorId = `author_${project.id}_${authorName.replace(/[^a-zA-Z0-9]/g, '_')}`;

      await session.run(`
        MERGE (a:Author {id: $authorId})
        SET a.name = $name, a.projectId = $pid, a.fileCount = $fileCount
      `, {
        authorId,
        name: authorName,
        pid: project.id,
        fileCount: neo4j.int(ownedFiles.size),
      });

      // Create OWNED_BY edges
      for (const filePath of ownedFiles) {
        await session.run(`
          MATCH (sf:SourceFile {filePath: $filePath, projectId: $pid})
          MATCH (a:Author {id: $authorId})
          MERGE (sf)-[:OWNED_BY]->(a)
        `, { filePath, pid: project.id, authorId });
      }
    }

    console.log(`\nCreated ${allAuthors.size} Author nodes:`);
    for (const [author, files] of allAuthors) {
      console.log(`  ${author}: ${files.size} files`);
    }

    // Update risk scoring with author entropy
    const updateResult = await session.run(`
      MATCH (sf:SourceFile {projectId: $pid})
      WHERE sf.authorEntropy IS NOT NULL AND sf.authorEntropy > 1
      MATCH (sf)-[:CONTAINS]->(f)
      WHERE (f:Function OR f:Method) AND f.riskLevel IS NOT NULL
      SET f.riskLevelV2 = f.riskLevel * (1 + (sf.authorEntropy - 1) * 0.15)
      RETURN count(f) AS updated
    `, { pid: project.id });

    const updated = updateResult.records[0]?.get('updated');
    console.log(`\nUpdated riskLevelV2 on ${updated} functions (authorEntropy factor)`);

    // Summary stats
    const statsResult = await session.run(`
      MATCH (sf:SourceFile {projectId: $pid})
      WHERE sf.authorEntropy IS NOT NULL
      RETURN avg(sf.authorEntropy) AS avgEntropy,
             max(sf.authorEntropy) AS maxEntropy,
             count(CASE WHEN sf.authorEntropy > 2 THEN 1 END) AS multiAuthorFiles
    `, { pid: project.id });

    const stats = statsResult.records[0];
    console.log(`\nOwnership stats:`);
    console.log(`  Avg author entropy: ${(stats.get('avgEntropy') as number)?.toFixed(2)}`);
    console.log(`  Max author entropy: ${stats.get('maxEntropy')}`);
    console.log(`  Multi-author files (>2): ${stats.get('multiAuthorFiles')}`);

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
