#!/usr/bin/env npx tsx
/**
 * RF-15 Task 5: Persist runtime coverage metrics on Function nodes.
 *
 * Writes:
 *  - Function.lineCoverage   (0.0 - 1.0)
 *  - Function.branchCoverage (0.0 - 1.0)
 */
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
import {
  parseCoverageFile,
  type ParsedCoverageFile,
  type CoverageBranchSummary,
} from './parse-runtime-coverage.js';
import {
  mapStatementsToFunctions,
  rangesOverlap,
} from './map-runtime-coverage-to-functions.js';

dotenv.config();

interface FunctionSpan {
  id: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
}

export function computeLineCoverage(
  matchedStatementCount: number,
  coveredStatementCount: number,
): number {
  if (matchedStatementCount <= 0) return 0;
  return coveredStatementCount / matchedStatementCount;
}

export function computeBranchCoverageForFunction(
  fn: FunctionSpan,
  branches: CoverageBranchSummary[],
): number {
  const relevant = branches.filter((b) =>
    rangesOverlap(fn.startLine, fn.endLine, b.line, b.line),
  );
  const totalPaths = relevant.reduce((sum, b) => sum + b.pathCount, 0);
  const coveredPaths = relevant.reduce((sum, b) => sum + b.coveredPaths, 0);
  if (totalPaths <= 0) return 0;
  return coveredPaths / totalPaths;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

async function queryFunctionsForFile(
  session: any,
  projectId: string,
  filePath: string,
): Promise<FunctionSpan[]> {
  const result = await session.run(
    `MATCH (f:Function {projectId: $projectId, filePath: $filePath})
     WHERE f.startLine IS NOT NULL AND f.endLine IS NOT NULL
     RETURN f.id AS id, f.name AS name, f.filePath AS filePath,
            toInteger(f.startLine) AS startLine,
            toInteger(f.endLine) AS endLine
     ORDER BY toInteger(f.startLine) ASC`,
    { projectId, filePath },
  );

  return result.records.map((r) => ({
    id: String(r.get('id')),
    name: String(r.get('name')),
    filePath: String(r.get('filePath')),
    startLine: Number(r.get('startLine')),
    endLine: Number(r.get('endLine')),
  }));
}

export async function storeRuntimeCoverage(opts?: {
  coveragePath?: string;
  projectId?: string;
}): Promise<{ updatedFunctions: number; filesParsed: number }> {
  const coveragePath = opts?.coveragePath ?? './coverage/coverage-final.json';
  const projectId = opts?.projectId ?? 'proj_c0d3e9a1f200';
  const parsed = parseCoverageFile(coveragePath);

  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'codegraph',
    ),
  );
  const session = driver.session();

  let updatedFunctions = 0;

  try {
    // Reset values first for deterministic writes.
    await session.run(
      `MATCH (f:Function {projectId: $projectId})
       SET f.lineCoverage = 0.0,
           f.branchCoverage = 0.0`,
      { projectId },
    );

    for (const file of parsed) {
      const filePath = normalizePath(file.filePath);
      const functions = await queryFunctionsForFile(session, projectId, filePath);
      if (functions.length === 0) continue;

      const statementMap = mapStatementsToFunctions(functions, file.lineRanges);

      for (const mapped of statementMap) {
        const fn = functions.find((f) => f.id === mapped.functionId);
        if (!fn) continue;

        const lineCoverage = computeLineCoverage(
          mapped.matchedStatementCount,
          mapped.coveredStatementCount,
        );
        const branchCoverage = computeBranchCoverageForFunction(
          fn,
          file.branchCounts,
        );

        await session.run(
          `MATCH (f:Function {projectId: $projectId, id: $functionId})
           SET f.lineCoverage = $lineCoverage,
               f.branchCoverage = $branchCoverage,
               f.runtimeCoverageUpdatedAt = datetime()
           RETURN f.id AS id`,
          {
            projectId,
            functionId: mapped.functionId,
            lineCoverage,
            branchCoverage,
          },
        );

        updatedFunctions++;
      }
    }

    return { updatedFunctions, filesParsed: parsed.length };
  } finally {
    await session.close();
    await driver.close();
  }
}

export async function main(): Promise<void> {
  const coveragePath = process.argv[2] ?? './coverage/coverage-final.json';
  const projectId = process.argv[3] ?? 'proj_c0d3e9a1f200';
  const result = await storeRuntimeCoverage({ coveragePath, projectId });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('/store-runtime-coverage.ts') ||
  process.argv[1]?.endsWith('/store-runtime-coverage.js')
) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
