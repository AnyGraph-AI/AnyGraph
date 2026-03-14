import path from 'node:path';

import dotenv from 'dotenv';

import { parsePythonProjectToIr } from '../core/parsers/python-parser.js';
import { materializeIrDocument } from '../core/ir/ir-materializer.js';

dotenv.config();

function arg(name: string): string | undefined {
  const match = process.argv.find((a) => a.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : undefined;
}

async function main(): Promise<void> {
  const sourceRoot = path.resolve(arg('--sourceRoot') ?? process.argv[2] ?? process.cwd());
  const projectId = arg('--projectId') ?? process.argv[3] ?? `proj_py_${Date.now().toString(36)}`;
  const pyrightCommand = arg('--pyright') ?? process.env.PYRIGHT_COMMAND ?? 'pyright';
  const ingest = process.argv.includes('--ingest');

  const ir = await parsePythonProjectToIr({ sourceRoot, projectId, pyrightCommand });

  let materialized: Awaited<ReturnType<typeof materializeIrDocument>> | null = null;
  if (ingest) {
    materialized = await materializeIrDocument(ir, {
      batchSize: 500,
      clearProjectFirst: true,
    });
  }

  console.log(
    JSON.stringify({
      ok: true,
      sourceRoot,
      projectId,
      pyrightCommand,
      nodes: ir.nodes.length,
      edges: ir.edges.length,
      metadata: ir.metadata,
      ingested: ingest,
      materialized,
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
