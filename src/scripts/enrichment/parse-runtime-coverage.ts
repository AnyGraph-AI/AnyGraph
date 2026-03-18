#!/usr/bin/env npx tsx
/**
 * RF-15 Task 3: Parse runtime coverage JSON.
 *
 * Input: Istanbul/V8 coverage-final.json
 * Output: normalized per-file coverage facts:
 *   - line ranges (from statementMap + statement hits)
 *   - branch counts/hits (from branchMap + b)
 *   - function hits (from fnMap + f)
 */
import fs from 'node:fs';

export interface CoverageLineRange {
  statementId: string;
  startLine: number;
  endLine: number;
  hits: number;
}

export interface CoverageFunctionHit {
  functionId: string;
  name: string;
  startLine: number;
  endLine: number;
  hits: number;
}

export interface CoverageBranchSummary {
  branchId: string;
  branchType: string;
  line: number;
  pathCount: number;
  coveredPaths: number;
  totalHits: number;
}

export interface ParsedCoverageFile {
  filePath: string;
  lineRanges: CoverageLineRange[];
  branchCounts: CoverageBranchSummary[];
  functionHits: CoverageFunctionHit[];
}

interface IstanbulLoc {
  start?: { line?: number; column?: number };
  end?: { line?: number; column?: number };
}

interface IstanbulFnMeta {
  name?: string;
  decl?: IstanbulLoc;
  loc?: IstanbulLoc;
  line?: number;
}

interface IstanbulBranchMeta {
  type?: string;
  line?: number;
  locations?: IstanbulLoc[];
}

interface IstanbulFileCoverage {
  path?: string;
  statementMap?: Record<string, IstanbulLoc>;
  fnMap?: Record<string, IstanbulFnMeta>;
  branchMap?: Record<string, IstanbulBranchMeta>;
  s?: Record<string, number>;
  f?: Record<string, number>;
  b?: Record<string, number[]>;
}

export function parseCoverageJson(raw: string): ParsedCoverageFile[] {
  const root = JSON.parse(raw) as Record<string, IstanbulFileCoverage>;
  const files: ParsedCoverageFile[] = [];

  for (const [filePath, entry] of Object.entries(root)) {
    const statementMap = entry.statementMap ?? {};
    const fnMap = entry.fnMap ?? {};
    const branchMap = entry.branchMap ?? {};
    const s = entry.s ?? {};
    const f = entry.f ?? {};
    const b = entry.b ?? {};

    const lineRanges: CoverageLineRange[] = Object.entries(statementMap)
      .map(([statementId, loc]) => {
        const startLine = Number(loc?.start?.line ?? 0);
        const endLine = Number(loc?.end?.line ?? startLine);
        return {
          statementId,
          startLine,
          endLine,
          hits: Number(s[statementId] ?? 0),
        };
      })
      .filter((r) => r.startLine > 0 && r.endLine >= r.startLine);

    const functionHits: CoverageFunctionHit[] = Object.entries(fnMap)
      .map(([functionId, meta]) => {
        const loc = meta.loc ?? meta.decl ?? {};
        const startLine = Number(loc.start?.line ?? meta.line ?? 0);
        const endLine = Number(loc.end?.line ?? startLine);
        return {
          functionId,
          name: String(meta.name ?? `fn_${functionId}`),
          startLine,
          endLine,
          hits: Number(f[functionId] ?? 0),
        };
      })
      .filter((fn) => fn.startLine > 0 && fn.endLine >= fn.startLine);

    const branchCounts: CoverageBranchSummary[] = Object.entries(branchMap).map(
      ([branchId, meta]) => {
        const hits = b[branchId] ?? [];
        const totalHits = hits.reduce((sum, n) => sum + Number(n ?? 0), 0);
        const coveredPaths = hits.filter((n) => Number(n ?? 0) > 0).length;
        return {
          branchId,
          branchType: String(meta.type ?? 'unknown'),
          line: Number(meta.line ?? 0),
          pathCount: hits.length,
          coveredPaths,
          totalHits,
        };
      },
    );

    files.push({
      filePath: entry.path ?? filePath,
      lineRanges,
      branchCounts,
      functionHits,
    });
  }

  return files;
}

export function parseCoverageFile(filePath: string): ParsedCoverageFile[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  return parseCoverageJson(raw);
}

export async function main(): Promise<void> {
  const coveragePath = process.argv[2] ?? './coverage/coverage-final.json';

  if (!fs.existsSync(coveragePath)) {
    throw new Error(`Coverage JSON not found: ${coveragePath}`);
  }

  const parsed = parseCoverageFile(coveragePath);
  const fileCount = parsed.length;
  const statementRanges = parsed.reduce((n, f) => n + f.lineRanges.length, 0);
  const branchEntries = parsed.reduce((n, f) => n + f.branchCounts.length, 0);
  const functionEntries = parsed.reduce((n, f) => n + f.functionHits.length, 0);

  console.log(
    JSON.stringify(
      {
        ok: true,
        coveragePath,
        fileCount,
        statementRanges,
        branchEntries,
        functionEntries,
      },
      null,
      2,
    ),
  );
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('/parse-runtime-coverage.ts') ||
  process.argv[1]?.endsWith('/parse-runtime-coverage.js')
) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
