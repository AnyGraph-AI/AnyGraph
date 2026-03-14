import fs from 'fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

import dotenv from 'dotenv';

import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

dotenv.config();

interface BibleRow {
  id: string;
  name: string;
  book: string;
  chapter: number;
  verseNum: number;
  text: string;
  contentHash: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const withEq = process.argv.find((a) => a.startsWith(`${name}=`));
  if (withEq) return withEq.slice(name.length + 1);
  return undefined;
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function stableHash(parts: Array<string | number>): string {
  return createHash('sha256').update(parts.map((p) => String(p)).join('|')).digest('hex');
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

function parseBibleCsv(content: string): BibleRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const colBook = header.indexOf('book');
  const colChapter = header.indexOf('chapter');
  const colVerse = header.indexOf('verse');
  const colText = header.indexOf('text');

  if (colBook < 0 || colChapter < 0 || colVerse < 0 || colText < 0) {
    throw new Error('CSV missing required columns: Book, Chapter, Verse, Text');
  }

  const rows: BibleRow[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const book = (cols[colBook] ?? '').trim();
    const chapter = Number((cols[colChapter] ?? '').trim());
    const verseNum = Number((cols[colVerse] ?? '').trim());
    const text = (cols[colText] ?? '').trim();

    if (!book || !Number.isFinite(chapter) || !Number.isFinite(verseNum) || !text) continue;

    const id = `verse_${slug(book)}_${chapter}_${verseNum}`;
    const name = `${book} ${chapter}:${verseNum}`;
    const contentHash = stableHash([book, chapter, verseNum, text]);

    rows.push({
      id,
      name,
      book,
      chapter,
      verseNum,
      text,
      contentHash,
    });
  }

  return rows;
}

async function main(): Promise<void> {
  const csvPath = path.resolve(
    arg('--csv') ?? '/home/jonathan/.openclaw/workspace/bible-graph/data/KJV.csv',
  );
  const projectId = arg('--projectId') ?? 'proj_bible_kjv';
  const dryRun = process.argv.includes('--dry-run');
  const pruneMissing = process.argv.includes('--prune-missing');

  const csv = await fs.readFile(csvPath, 'utf8');
  const rows = parseBibleCsv(csv);
  const sourceRevision = createHash('sha256').update(csv).digest('hex');

  const neo4j = new Neo4jService();
  try {
    const existingRows = (await neo4j.run(
      `MATCH (v:Verse {projectId: $projectId})
       RETURN v.id AS id, coalesce(v.contentHash, '') AS contentHash`,
      { projectId },
    )) as Array<{ id: string; contentHash: string }>;

    const existing = new Map(existingRows.map((r) => [String(r.id), String(r.contentHash || '')]));

    const toUpsert: BibleRow[] = [];
    let unchanged = 0;

    for (const row of rows) {
      const prior = existing.get(row.id);
      if (prior && prior === row.contentHash) {
        unchanged += 1;
      } else {
        toUpsert.push(row);
      }
    }

    const incomingIds = new Set(rows.map((r) => r.id));
    const pruneCandidates = Array.from(existing.keys()).filter((id) => !incomingIds.has(id));

    if (!dryRun && pruneMissing && pruneCandidates.length > 0) {
      await neo4j.run(
        `UNWIND $ids AS id
         MATCH (v:Verse {projectId: $projectId, id: id})
         DETACH DELETE v`,
        {
          ids: pruneCandidates,
          projectId,
        },
      );
    }

    if (!dryRun && toUpsert.length > 0) {
      await neo4j.run(
        `UNWIND $rows AS row
         MERGE (v:Verse {id: row.id, projectId: $projectId})
         SET v.name = row.name,
             v.book = row.book,
             v.chapter = toInteger(row.chapter),
             v.verseNum = toInteger(row.verseNum),
             v.text = row.text,
             v.contentHash = row.contentHash,
             v.sourcePath = $csvPath,
             v.sourceRevision = $sourceRevision,
             v.provenanceKind = 'corpus-ingest',
             v.updatedAt = toString(datetime())`,
        {
          rows: toUpsert,
          projectId,
          csvPath,
          sourceRevision,
        },
      );
    }

    if (!dryRun) {
      await neo4j.run(
        `MERGE (p:Project {projectId: $projectId})
         SET p.name = coalesce(p.name, 'KJV Bible'),
             p.displayName = coalesce(p.displayName, 'KJV Bible'),
             p.projectType = 'corpus',
             p.sourceKind = 'corpus-ingest',
             p.path = coalesce(p.path, $csvPath),
             p.status = 'active',
             p.sourceRevision = $sourceRevision,
             p.updatedAt = toString(datetime())`,
        {
          projectId,
          csvPath,
          sourceRevision,
        },
      );

      const cnt = (await neo4j.run(
        `MATCH (v:Verse {projectId: $projectId}) RETURN count(v) AS c`,
        { projectId },
      )) as Array<{ c: number }>;

      await neo4j.run(
        `MATCH (p:Project {projectId: $projectId})
         SET p.nodeCount = toInteger($nodeCount)`,
        {
          projectId,
          nodeCount: Number(cnt[0]?.c ?? rows.length),
        },
      );
    }

    console.log(
      JSON.stringify({
        ok: true,
        projectId,
        csvPath,
        sourceRevision,
        totalRows: rows.length,
        unchanged,
        upserted: toUpsert.length,
        pruneMissing,
        pruned: pruneMissing ? pruneCandidates.length : 0,
        pruneCandidates: pruneCandidates.length,
        dryRun,
      }),
    );
  } finally {
    await neo4j.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
