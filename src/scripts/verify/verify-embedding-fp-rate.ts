import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { EmbeddingsService } from '../../../src/core/embeddings/embeddings.service.js';
import { Neo4jService } from '../../../src/storage/neo4j/neo4j.service.js';

interface BenchmarkTask {
  id: string;
  name: string;
  embeddingInput: string;
  expectedFunctionIds: string[];
  expectedFilePaths: string[];
  planProjectId: string;
  codeProjectId: string;
}

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function arg(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit?.split('=').slice(1).join('=');
}

async function main(): Promise<void> {
  const threshold = Number(arg('--threshold') ?? process.env.PLAN_CODE_EMBEDDING_THRESHOLD ?? 0.75);
  const topK = Math.max(1, Math.floor(Number(arg('--topk') ?? process.env.PLAN_CODE_EMBEDDING_TOPK ?? 3)));
  const maxFpRate = Number(arg('--max-fp-rate') ?? process.env.PLAN_CODE_MAX_FP_RATE ?? 0.05);
  const maxTasks = Math.max(1, Math.floor(Number(arg('--max-tasks') ?? process.env.PLAN_CODE_FP_BENCHMARK_TASKS ?? 120)));

  const map = JSON.parse(
    readFileSync(join(process.cwd(), 'config', 'plan-code-project-map.json'), 'utf8'),
  ) as Record<string, string>;

  const neo4j = new Neo4jService();
  const embeddings = new EmbeddingsService();

  try {
    const tasks: BenchmarkTask[] = [];

    for (const [planProjectId, codeProjectId] of Object.entries(map)) {
      const rows = (await neo4j.run(
        `MATCH (t:Task {projectId: $planProjectId})
         WHERE coalesce(t.embeddingInput, '') <> ''
         OPTIONAL MATCH (t)-[rf:HAS_CODE_EVIDENCE {refType: 'function'}]->(fnExp)
         WHERE fnExp.projectId = $codeProjectId
         OPTIONAL MATCH (t)-[rfile:HAS_CODE_EVIDENCE {refType: 'file_path'}]->(sf:SourceFile)
         WHERE sf.projectId = $codeProjectId
         WITH t,
              collect(DISTINCT fnExp.id) AS expectedFunctionIds,
              collect(DISTINCT sf.filePath) AS expectedFilePaths
         WHERE size(expectedFunctionIds) > 0 OR size(expectedFilePaths) > 0
         RETURN t.id AS id,
                t.name AS name,
                t.embeddingInput AS embeddingInput,
                expectedFunctionIds,
                expectedFilePaths
         ORDER BY coalesce(t.line, 999999)
         LIMIT toInteger($maxTasks)`,
        { planProjectId, codeProjectId, maxTasks },
      )) as Array<Record<string, unknown>>;

      for (const row of rows) {
        tasks.push({
          id: String(row.id ?? ''),
          name: String(row.name ?? ''),
          embeddingInput: String(row.embeddingInput ?? ''),
          expectedFunctionIds: ((row.expectedFunctionIds as string[] | undefined) ?? []).map((x) => String(x)),
          expectedFilePaths: ((row.expectedFilePaths as string[] | undefined) ?? []).map((x) => String(x)),
          planProjectId,
          codeProjectId,
        });
      }
    }

    if (tasks.length === 0) {
      throw new Error('No benchmark tasks found with explicit function evidence + embeddingInput.');
    }

    const vectors = await embeddings.embedTextsInBatches(tasks.map((t) => t.embeddingInput.slice(0, 12000)), 40);

    let tp = 0;
    let fp = 0;
    let evaluatedTasks = 0;
    let tasksWithMatches = 0;

    const rows: Array<Record<string, unknown>> = [];

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const embedding = vectors[i];
      if (!embedding) continue;

      evaluatedTasks += 1;

      const matches = (await neo4j.run(
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
         RETURN f.id AS id, f.name AS name, f.filePath AS filePath, score
         ORDER BY score DESC
         LIMIT toInteger($topK)`,
        { codeProjectId: task.codeProjectId, embedding, threshold, topK },
      )) as Array<Record<string, unknown>>;

      if (matches.length > 0) tasksWithMatches += 1;

      const expectedIds = new Set(task.expectedFunctionIds);
      const expectedPaths = task.expectedFilePaths.map((p) => p.toLowerCase()).filter(Boolean);
      const labeled = matches.map((m) => {
        const id = String(m.id ?? '');
        const filePath = String(m.filePath ?? '');
        const filePathLower = filePath.toLowerCase();
        const pathMatch = expectedPaths.some((p) => filePathLower === p || filePathLower.endsWith(p) || p.endsWith(filePathLower));
        const isTp = expectedIds.has(id) || pathMatch;
        if (isTp) tp += 1;
        else fp += 1;
        return {
          id,
          name: String(m.name ?? ''),
          filePath,
          score: Number(toNum(m.score).toFixed(4)),
          label: isTp ? 'TP' : 'FP',
        };
      });

      rows.push({
        taskId: task.id,
        taskName: task.name,
        planProjectId: task.planProjectId,
        codeProjectId: task.codeProjectId,
        expectedFunctionIds: task.expectedFunctionIds,
        expectedFilePaths: task.expectedFilePaths,
        matches: labeled,
      });
    }

    const totalPredictions = tp + fp;
    const fpRate = totalPredictions > 0 ? fp / totalPredictions : 1;
    const precision = totalPredictions > 0 ? tp / totalPredictions : 0;
    const ok = totalPredictions > 0 && fpRate <= maxFpRate;

    const generatedAt = new Date().toISOString();
    const outDir = join(process.cwd(), 'artifacts', 'embedding-matcher');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, `fp-rate-${generatedAt.replace(/[:.]/g, '-')}.json`);
    const latestPath = join(outDir, 'fp-rate-latest.json');

    const report = {
      ok,
      generatedAt,
      threshold,
      topK,
      maxFpRate,
      benchmarkTaskCount: tasks.length,
      evaluatedTasks,
      tasksWithMatches,
      totalPredictions,
      truePositives: tp,
      falsePositives: fp,
      fpRate: Number(fpRate.toFixed(6)),
      precision: Number(precision.toFixed(6)),
      rows,
    };

    writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    writeFileSync(latestPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(
      JSON.stringify({
        ...report,
        outPath,
        latestPath,
      }),
    );

    if (!ok) process.exit(1);
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
