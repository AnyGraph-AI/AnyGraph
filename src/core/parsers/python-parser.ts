/**
 * Python Parser v1 scaffold.
 *
 * Starting-point provenance:
 * - ChrisRoyse/CodeGraph multi-language parser approach (Python AST lane + cross-language graph strategy)
 *   https://github.com/ChrisRoyse/CodeGraph
 *
 * This implementation is adapted to AnythingGraph IR v1 + Neo4j materialization contracts.
 */

import fs from 'fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { glob } from 'glob';

import type { IrDocument, IrEdge, IrNode } from '../ir/ir-v1.schema.js';

interface PythonParserOptions {
  sourceRoot: string;
  projectId: string;
  sourceRevision?: string;
  pyrightCommand?: string;
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

interface AstDef {
  kind: 'function' | 'class';
  name: string;
  qualname?: string;
  line: number;
  col: number;
  endLine?: number;
  endCol?: number;
  parent?: string;
}

interface AstCall {
  name: string;
  line: number;
  col: number;
}

interface AstImport {
  module: string;
  alias?: string;
  line: number;
  col: number;
}

interface AstPayload {
  defs: AstDef[];
  calls: AstCall[];
  imports: AstImport[];
  engine: 'python-ast' | 'regex-fallback';
}

const DEFAULT_EXCLUDES = ['**/.venv/**', '**/venv/**', '**/__pycache__/**', '**/.git/**', '**/node_modules/**'];

export class PythonParser {
  private readonly sourceRoot: string;
  private readonly projectId: string;
  private readonly sourceRevision?: string;
  private readonly pyrightCommand: string;
  private readonly includeGlobs: string[];
  private readonly excludeGlobs: string[];

  constructor(options: PythonParserOptions) {
    this.sourceRoot = options.sourceRoot;
    this.projectId = options.projectId;
    this.sourceRevision = options.sourceRevision;
    this.pyrightCommand = options.pyrightCommand ?? 'pyright';
    this.includeGlobs = options.includeGlobs ?? ['**/*.py'];
    this.excludeGlobs = options.excludeGlobs ?? DEFAULT_EXCLUDES;
  }

  async parseToIr(): Promise<IrDocument> {
    const files = await this.discoverFiles();
    const nodes: IrNode[] = [];
    const edges: IrEdge[] = [];
    const unresolvedSymbols = new Map<string, string>();
    const symbolByName = new Map<string, string>();

    for (const filePath of files) {
      const relPath = path.relative(this.sourceRoot, filePath) || path.basename(filePath);
      const fileAst = await this.parseFile(filePath);

      const artifactId = this.id('py:file', relPath);
      nodes.push(this.makeNode({
        id: artifactId,
        type: 'Artifact',
        kind: 'PythonSourceFile',
        name: relPath,
        sourcePath: filePath,
        parserTier: 1,
        confidence: fileAst.engine === 'python-ast' ? 0.95 : 0.65,
        properties: { parserEngine: fileAst.engine },
      }));

      for (const def of fileAst.defs) {
        const symbolId = this.id('py:def', `${relPath}:${def.kind}:${def.qualname || def.name}:${def.line}`);
        const symbolName = def.qualname || def.name;

        nodes.push(
          this.makeNode({
            id: symbolId,
            type: 'Symbol',
            kind: def.kind === 'class' ? 'PythonClass' : 'PythonFunction',
            name: symbolName,
            sourcePath: filePath,
            parserTier: 1,
            confidence: 0.9,
            range: {
              startLine: def.line,
              startColumn: def.col,
              endLine: def.endLine,
              endColumn: def.endCol,
            },
            properties: {
              parent: def.parent,
            },
          }),
        );

        symbolByName.set(def.name, symbolId);
        edges.push(this.makeEdge('DECLARES', artifactId, symbolId, 0.95));
        edges.push(this.makeEdge('CONTAINS', artifactId, symbolId, 0.9));
      }

      for (const imp of fileAst.imports) {
        const importId = this.id('py:import', `${relPath}:${imp.module}:${imp.alias || ''}:${imp.line}`);
        nodes.push(
          this.makeNode({
            id: importId,
            type: 'Entity',
            kind: 'PythonImport',
            name: imp.alias ? `${imp.module} as ${imp.alias}` : imp.module,
            sourcePath: filePath,
            parserTier: 1,
            confidence: 0.92,
            range: { startLine: imp.line, startColumn: imp.col },
            properties: { module: imp.module, alias: imp.alias },
          }),
        );
        edges.push(this.makeEdge('IMPORTS', artifactId, importId, 0.92));
      }

      for (const call of fileAst.calls) {
        const siteId = this.id('py:callsite', `${relPath}:${call.name}:${call.line}:${call.col}`);
        nodes.push(
          this.makeNode({
            id: siteId,
            type: 'Site',
            kind: 'PythonCallSite',
            name: call.name,
            sourcePath: filePath,
            parserTier: 1,
            confidence: 0.85,
            range: { startLine: call.line, startColumn: call.col },
          }),
        );
        edges.push(this.makeEdge('CONTAINS', artifactId, siteId, 0.8));

        const target = symbolByName.get(call.name) ?? unresolvedSymbols.get(call.name);
        let targetId = target;
        if (!targetId) {
          targetId = this.id('py:unresolved', call.name);
          unresolvedSymbols.set(call.name, targetId);
          nodes.push(
            this.makeNode({
              id: targetId,
              type: 'Symbol',
              kind: 'PythonUnresolvedSymbol',
              name: call.name,
              parserTier: 2,
              confidence: 0.4,
            }),
          );
        }

        edges.push(this.makeEdge('CALLS', siteId, targetId, symbolByName.has(call.name) ? 0.8 : 0.45));
      }
    }

    const pyright = this.runPyright();

    return {
      version: 'ir.v1',
      projectId: this.projectId,
      sourceKind: 'code',
      generatedAt: new Date().toISOString(),
      sourceRoot: this.sourceRoot,
      nodes,
      edges,
      metadata: {
        parser: 'python-parser-v1',
        parserTier: 1,
        fileCount: files.length,
        pyrightAvailable: pyright.available,
        pyrightExitCode: pyright.exitCode,
        pyrightDiagnostics: pyright.diagnostics,
      },
    };
  }

  private async discoverFiles(): Promise<string[]> {
    const files = await glob(this.includeGlobs, {
      cwd: this.sourceRoot,
      absolute: true,
      nodir: true,
      ignore: this.excludeGlobs,
    });
    return files.sort();
  }

  private async parseFile(filePath: string): Promise<AstPayload> {
    const pyAst = this.parseViaPythonAst(filePath);
    if (pyAst) return pyAst;
    return this.parseViaRegex(filePath);
  }

  private parseViaPythonAst(filePath: string): AstPayload | null {
    const script = `
import ast, json, sys
p = sys.argv[1]
src = open(p, 'r', encoding='utf-8').read()
tree = ast.parse(src)

defs=[]
imports=[]
calls=[]

class V(ast.NodeVisitor):
  def __init__(self):
    self.parents=[]

  def visit_FunctionDef(self, n):
    defs.append({'kind':'function','name':n.name,'qualname':'.'.join(self.parents+[n.name]),'line':n.lineno,'col':n.col_offset,'endLine':getattr(n,'end_lineno',None),'endCol':getattr(n,'end_col_offset',None),'parent':'.'.join(self.parents) if self.parents else None})
    self.parents.append(n.name)
    self.generic_visit(n)
    self.parents.pop()

  def visit_AsyncFunctionDef(self, n):
    self.visit_FunctionDef(n)

  def visit_ClassDef(self, n):
    defs.append({'kind':'class','name':n.name,'qualname':'.'.join(self.parents+[n.name]),'line':n.lineno,'col':n.col_offset,'endLine':getattr(n,'end_lineno',None),'endCol':getattr(n,'end_col_offset',None),'parent':'.'.join(self.parents) if self.parents else None})
    self.parents.append(n.name)
    self.generic_visit(n)
    self.parents.pop()

  def visit_Import(self, n):
    for a in n.names:
      imports.append({'module':a.name,'alias':a.asname,'line':n.lineno,'col':n.col_offset})

  def visit_ImportFrom(self, n):
    mod = n.module or ''
    imports.append({'module':mod,'alias':None,'line':n.lineno,'col':n.col_offset})

  def visit_Call(self, n):
    name = None
    if isinstance(n.func, ast.Name):
      name = n.func.id
    elif isinstance(n.func, ast.Attribute):
      name = n.func.attr
    if name:
      calls.append({'name':name,'line':n.lineno,'col':n.col_offset})
    self.generic_visit(n)

V().visit(tree)
print(json.dumps({'defs':defs,'calls':calls,'imports':imports,'engine':'python-ast'}))
`;

    const result = spawnSync('python3', ['-c', script, filePath], {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.status !== 0 || !result.stdout?.trim()) return null;

    try {
      const parsed = JSON.parse(result.stdout) as AstPayload;
      return parsed;
    } catch {
      return null;
    }
  }

  private async parseViaRegex(filePath: string): Promise<AstPayload> {
    const text = await fs.readFile(filePath, 'utf-8');
    const lines = text.split('\n');
    const defs: AstDef[] = [];
    const imports: AstImport[] = [];
    const calls: AstCall[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const ln = i + 1;

      const def = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
      if (def) defs.push({ kind: 'function', name: def[1], line: ln, col: 0 });

      const cls = line.match(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (cls) defs.push({ kind: 'class', name: cls[1], line: ln, col: 0 });

      const imp = line.match(/^\s*import\s+([A-Za-z0-9_\.]+)/);
      if (imp) imports.push({ module: imp[1], line: ln, col: 0 });

      const impFrom = line.match(/^\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+/);
      if (impFrom) imports.push({ module: impFrom[1], line: ln, col: 0 });

      for (const m of line.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
        calls.push({ name: m[1], line: ln, col: m.index ?? 0 });
      }
    }

    return { defs, calls, imports, engine: 'regex-fallback' };
  }

  private runPyright(): { available: boolean; exitCode: number | null; diagnostics: number } {
    const result = spawnSync(this.pyrightCommand, ['--outputjson', this.sourceRoot], {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error || (!result.stdout && !result.stderr)) {
      return { available: false, exitCode: null, diagnostics: 0 };
    }

    const output = `${result.stdout || ''}${result.stderr || ''}`;
    let diagnostics = 0;
    try {
      const parsed = JSON.parse(result.stdout || '{}') as { generalDiagnostics?: unknown[] };
      diagnostics = Array.isArray(parsed.generalDiagnostics) ? parsed.generalDiagnostics.length : 0;
    } catch {
      diagnostics = 0;
    }

    return { available: true, exitCode: result.status, diagnostics };
  }

  private makeNode(input: {
    id: string;
    type: IrNode['type'];
    kind: string;
    name: string;
    sourcePath?: string;
    parserTier: number;
    confidence: number;
    range?: IrNode['range'];
    properties?: Record<string, unknown>;
  }): IrNode {
    return {
      id: input.id,
      type: input.type,
      kind: input.kind,
      name: input.name,
      projectId: this.projectId,
      sourcePath: input.sourcePath,
      language: 'python',
      sourceRevision: this.sourceRevision,
      /**
       * FIND-11a-01: parserTier is numeric in implementation (0/1/2).
       * Spec strings like "tier-0" are human-readable aliases only.
       */
      parserTier: input.parserTier as 0 | 1 | 2,
      confidence: input.confidence,
      provenanceKind: 'parser',
      range: input.range,
      properties: input.properties ?? {},
    };
  }

  private makeEdge(type: IrEdge['type'], from: string, to: string, confidence: number): IrEdge {
    return {
      id: this.id('py:edge', `${type}:${from}:${to}`),
      type,
      from,
      to,
      projectId: this.projectId,
      parserTier: 1,
      confidence,
      provenanceKind: 'parser',
      properties: {},
    };
  }

  /**
   * FIND-11a-02: ID hash input is `${projectId}:${value}` where `value` is the
   * caller-provided composite token (e.g., `relPath:kind:qualname:line`).
   * The parser does not hash `filePath+name+kind` as separate fixed fields.
   */
  private id(prefix: string, value: string): string {
    const h = createHash('sha256').update(`${this.projectId}:${value}`).digest('hex').slice(0, 16);
    return `${this.projectId}:${prefix}:${h}`;
  }
}

export async function parsePythonProjectToIr(options: PythonParserOptions): Promise<IrDocument> {
  const parser = new PythonParser(options);
  return parser.parseToIr();
}
