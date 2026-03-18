#!/usr/bin/env npx tsx
/**
 * RF-15 Task 4: Map runtime coverage line ranges to Function nodes.
 *
 * Uses parser line spans (Function.startLine/endLine) to associate
 * coverage statement ranges with function nodes.
 */
import fs from 'node:fs';
import path from 'node:path';
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
import {
  parseCoverageFile,
  type ParsedCoverageFile,
  type CoverageLineRange,
} from './parse-runtime-coverage.js';

dotenv.config();

interface FunctionSpan {
  id: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface FunctionCoverageMapping {
  functionId: string;
  functionName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  matchedStatementCount: number;
  coveredStatementCount: number;
  statementHitTotal: number;
}

export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function mapStatementsToFunctions(
  functions: FunctionSpan[],
  statements: CoverageLineRange[],
): FunctionCoverageMapping[] {
  const mappings: FunctionCoverageMapping[] = [];

  for (const fn of functions) {
    const matched = statements.filter((s) =>
      rangesOverlap(fn.startLine, fn.endLine, s.startLine, s.endLine),
    );

    const covered = matched.filter((m) => m.hits > 0);
    const hitTotal = matched.reduce((sum, m) => sum + m.hits, 0);

    mappings.push({
      functionId: fn.id,
      functionName: fn.name,
      filePath: fn.filePath,
      startLine: fn.startLine,
      endLine: fn.endLine,
      matchedStatementCount: matched.length,
      coveredStatementCount: covered.length,
      statementHitTotal: hitTotal,
    });
  }

  return mappings;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

async function queryFunctionsForFile(
  session: neo4j.Session,
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

export async function mapRuntimeCoverageToFunctions(opts?: {
  coveragePath?: string;
  projectId?: string;
  outPath?: string;
}): Promise<{ files: number; mappings: number; outPath: string }> {
  const coveragePath = opts?.coveragePath ?? './coverage/coverage-final.json';
  const projectId = opts?.projectId ?? 'proj_c0d3e9a1f200';
  const outPath =
    opts?.outPath ?? './artifacts/coverage/runtime-coverage-function-map.json';

  if (!fs.existsSync(coveragePath)) {
    throw new Error(`Coverage file not found: ${coveragePath}`);
  }

  const parsed = parseCoverageFile(coveragePath);
  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'codegraph',
    ),
  );
  const session = driver.session();

  try {
    const allMappings: FunctionCoverageMapping[] = [];

    for (const file of parsed) {
      const filePath = normalizePath(file.filePath);
      const functions = await queryFunctionsForFile(session, projectId, filePath);
      if (functions.length === 0) continue;

      const mappings = mapStatementsToFunctions(functions, file.lineRanges);
      allMappings.push(...mappings);
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      projectId,
      coveragePath,
      filesParsed: parsed.length,
      mappings: allMappings,
    };

    const absOut = path.resolve(outPath);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    fs.writeFileSync(absOut, JSON.stringify(payload, null, 2));

    return { files: parsed.length, mappings: allMappings.length, outPath: absOut };
  } finally {
    await session.close();
    await driver.close();
  }
}

export async function main(): Promise<void> {
  const coveragePath = process.argv[2] ?? './coverage/coverage-final.json';
  const projectId = process.argv[3] ?? 'proj_c0d3e9a1f200';

  const result = await mapRuntimeCoverageToFunctions({ coveragePath, projectId });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('/map-runtime-coverage-to-functions.ts') ||
  process.argv[1]?.endsWith('/map-runtime-coverage-to-functions.js')
) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
