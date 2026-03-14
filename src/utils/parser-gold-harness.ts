import fs from 'fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ParserFactory } from '../core/parsers/parser-factory.js';
import { parsePythonProjectToIr } from '../core/parsers/python-parser.js';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`PARSER_GOLD_ASSERTION_FAILED: ${message}`);
}

async function makeTsFixture(): Promise<{ dir: string; tsconfig: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gold-ts-'));
  const tsconfig = path.join(dir, 'tsconfig.json');
  const srcDir = path.join(dir, 'src');
  await fs.mkdir(srcDir, { recursive: true });

  await fs.writeFile(
    tsconfig,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'node',
          strict: false,
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    ),
    'utf8',
  );

  await fs.writeFile(
    path.join(srcDir, 'index.ts'),
    `export function add(a: number, b: number): number { return a + b; }

export class MathBox {
  sum(values: number[]): number {
    return values.reduce((acc, n) => add(acc, n), 0);
  }
}
`,
    'utf8',
  );

  return { dir, tsconfig };
}

async function makePythonFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gold-py-'));
  await fs.writeFile(
    path.join(dir, 'main.py'),
    `import math

class Worker:
    def run(self, x):
        return math.sqrt(x)

def helper(y):
    w = Worker()
    return w.run(y)
`,
    'utf8',
  );
  return dir;
}

async function runTypeScriptGold(): Promise<{ nodeCount: number; edgeCount: number }> {
  const fixture = await makeTsFixture();
  const parser = await ParserFactory.createParserWithAutoDetection(fixture.dir, fixture.tsconfig, 'proj_a11ce0000001', true);
  parser.setIrMode(true);
  await parser.parseWorkspace();
  const ir = parser.exportToIrDocument(fixture.dir);

  assert(ir.version === 'ir.v1', 'TypeScript IR version must be ir.v1');
  assert(ir.sourceKind === 'code', 'TypeScript sourceKind must be code');
  assert(ir.nodes.some((n) => n.type === 'Artifact'), 'TypeScript IR must contain Artifact node');
  assert(ir.nodes.some((n) => n.type === 'Symbol'), 'TypeScript IR must contain Symbol node');
  assert(ir.edges.some((e) => e.type === 'DECLARES'), 'TypeScript IR must contain DECLARES edge');

  return { nodeCount: ir.nodes.length, edgeCount: ir.edges.length };
}

async function runPythonGold(): Promise<{ nodeCount: number; edgeCount: number; pyrightAvailable: boolean }> {
  const fixtureDir = await makePythonFixture();
  const ir = await parsePythonProjectToIr({
    sourceRoot: fixtureDir,
    projectId: 'proj_a11ce0000002',
  });

  assert(ir.version === 'ir.v1', 'Python IR version must be ir.v1');
  assert(ir.sourceKind === 'code', 'Python sourceKind must be code');
  assert(ir.nodes.some((n) => n.type === 'Artifact'), 'Python IR must contain Artifact node');
  assert(ir.nodes.some((n) => n.type === 'Symbol'), 'Python IR must contain Symbol node');
  assert(ir.edges.some((e) => e.type === 'CALLS'), 'Python IR must contain CALLS edge');

  const pyrightAvailable = ir.metadata?.pyrightAvailable === true;

  return { nodeCount: ir.nodes.length, edgeCount: ir.edges.length, pyrightAvailable };
}

async function main(): Promise<void> {
  const ts = await runTypeScriptGold();
  const py = await runPythonGold();

  console.log(
    JSON.stringify({
      ok: true,
      suites: {
        typescript: ts,
        python: py,
      },
      note: 'Gold harness validates parser IR invariants for TypeScript + Python fixtures.',
    }),
  );
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
