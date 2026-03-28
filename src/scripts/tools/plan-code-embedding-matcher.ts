import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { EmbeddingsService } from '../../../src/core/embeddings/embeddings.service.js';
import { Neo4jService } from '../../../src/storage/neo4j/neo4j.service.js';

interface TaskRow {
  id: string;
  name: string;
  embeddingInput: string;
  planProjectId: string;
}

interface MatchRow {
  id: string;
  name: string;
  score: number;
}

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function argValue(flag: string): string | undefined {
  const p = process.argv.find((v) => v.startsWith(`${flag}=`));
  return p?.split('=').slice(1).join('=');
}

export async function main(): Promise<void> {
  const threshold = Number(argValue('--threshold') ?? process.env.PLAN_CODE_EMBEDDING_THRESHOLD ?? 0.75);
  const limit = Math.max(1, Math.floor(Number(argValue('--limit') ?? process.env.PLAN_CODE_EMBEDDING_LIMIT ?? 5)));
  const apply = process.argv.includes('--apply');

  const neo4j = new Neo4jService();
  const embeddings = new EmbeddingsService();

  try {
    const mapPath = join(process.cwd(), 'config', 'plan-code-project-map.json');
    const map = JSON.parse(readFileSync(mapPath, 'utf8')) as Record<string, string>;

    const reportRows: Array<{
      taskId: string;
      taskName: string;
      planProjectId: string;
      codeProjectId: string;
      appliedCount: number;
      matches: Array<{ fnId: string; fnName: string; score: number }>;
    }> = [];

    let tasksScanned = 0;
    let tasksMatched = 0;
    let edgesCreated = 0;

    for (const [planProjectId, codeProjectId] of Object.entries(map)) {
      const taskRows = (await neo4j.run(
        `MATCH (t:Task {projectId: $planProjectId})
         WHERE (t.hasCodeEvidence IS NULL OR t.hasCodeEvidence = false)
           AND coalesce(t.embeddingInput, '') <> ''
         RETURN t.id AS id, t.name AS name, t.embeddingInput AS embeddingInput, t.projectId AS planProjectId`,
        { planProjectId },
      )) as Array<Record<string, unknown>>;

      for (const raw of taskRows) {
        const task = {
          id: String(raw.id ?? ''),
          name: String(raw.name ?? ''),
          embeddingInput: String(raw.embeddingInput ?? ''),
          planProjectId: String(raw.planProjectId ?? planProjectId),
        } as TaskRow;

        if (!task.id || !task.embeddingInput) continue;
        tasksScanned += 1;

        const embedding = await embeddings.embedText(task.embeddingInput.slice(0, 12000));
        const fnRows = (await neo4j.run(
          `MATCH (f)
           WHERE f.projectId = $codeProjectId
             AND (
               f:Function OR f:Method
               OR f.coreType IN ['FunctionDeclaration', 'MethodDeclaration', 'ArrowFunction']
               OR f.semanticType IN ['function', 'method']
             )
             AND f.embedding IS NOT NULL
           WITH f, vector.similarity.cosine(f.embedding, $embedding) AS score
           WHERE score >= $threshold
           RETURN f.id AS id, f.name AS name, score
           ORDER BY score DESC
           LIMIT toInteger($limit)`,
          { codeProjectId, embedding, threshold, limit },
        )) as Array<Record<string, unknown>>;

        const matches: MatchRow[] = fnRows.map((r) => ({
          id: String(r.id ?? ''),
          name: String(r.name ?? ''),
          score: toNum(r.score),
        }));

        if (matches.length > 0) {
          tasksMatched += 1;
        }

        let appliedCount = 0;
        if (apply && matches.length > 0) {
          for (const m of matches) {
            await neo4j.run(
              `MATCH (t {id: $taskId}), (fn {id: $fnId})
               MERGE (t)-[r:HAS_CODE_EVIDENCE]->(fn)
               ON CREATE SET r.refType = 'semantic_embedding',
                             r.refValue = $refValue,
                             r.codeProjectId = $codeProjectId,
                             r.similarity = $score,
                             r.resolvedAt = datetime()`,
              {
                taskId: task.id,
                fnId: m.id,
                refValue: `embedding:${threshold}`,
                codeProjectId,
                score: m.score,
              },
            );
            appliedCount += 1;
            edgesCreated += 1;
          }

          await neo4j.run(
            `MATCH (t {id: $taskId})
             SET t.hasSemanticEvidence = true,
                 t.semanticEvidenceCount = coalesce(t.semanticEvidenceCount, 0) + $count,
                 t.semanticEvidenceThreshold = $threshold`,
            { taskId: task.id, count: appliedCount, threshold },
          );
        }

        reportRows.push({
          taskId: task.id,
          taskName: task.name,
          planProjectId,
          codeProjectId,
          appliedCount,
          matches: matches.map((m) => ({ fnId: m.id, fnName: m.name, score: Number(m.score.toFixed(4)) })),
        });
      }
    }

    const outDir = join(process.cwd(), 'artifacts', 'embedding-matcher');
    mkdirSync(outDir, { recursive: true });
    const generatedAt = new Date().toISOString();
    const outPath = join(outDir, `plan-code-embedding-match-${generatedAt.replace(/[:.]/g, '-')}.json`);
    const latestPath = join(outDir, 'plan-code-embedding-match-latest.json');

    const report = {
      ok: true,
      generatedAt,
      threshold,
      limit,
      apply,
      tasksScanned,
      tasksMatched,
      edgesCreated,
      rows: reportRows,
    };

    writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    writeFileSync(latestPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(
      JSON.stringify({
        ok: true,
        threshold,
        limit,
        apply,
        tasksScanned,
        tasksMatched,
        edgesCreated,
        outPath,
        latestPath,
      }),
    );
  } finally {
    await neo4j.close();
  }
}

// Guard: only run when executed directly (not imported by tests)
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exit(1);
  });
}
