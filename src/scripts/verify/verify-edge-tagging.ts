import { Neo4jService } from '../../../src/storage/neo4j/neo4j.service.js';

interface EdgeCountRow {
  edgeType: string;
  count: number;
}

const EXPECTED_GLOBAL_EDGE_TYPES = new Set<string>([
  'MENTIONS_PERSON',
  'NEXT_VERSE',
  'PART_OF',
  'SUPPORTED_BY',
  'CONTRADICTED_BY',
  'HAS_CODE_EVIDENCE',
  'BLOCKS',
]);

const KNOWN_SCOPE_DEBT_EDGE_TYPES = new Set<string>([
  'ORIGINATES_IN',
  'READS_STATE',
  'WRITES_STATE',
  'FOUND',
  'OWNED_BY',
  'BELONGS_TO_LAYER',
  'MEASURED',
  'POSSIBLE_CALL',
  'TESTED_BY',
]);

function fail(message: string): never {
  console.error(`EDGE_TAGGING_CHECK_FAILED: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const neo4j = new Neo4jService();

  try {
    const rows = (await neo4j.run(
      `MATCH ()-[r]->()
       WHERE r.projectId IS NULL
       RETURN type(r) AS edgeType, count(*) AS count
       ORDER BY count DESC`,
    )) as EdgeCountRow[];

    const globalRows = rows.filter((r) => EXPECTED_GLOBAL_EDGE_TYPES.has(r.edgeType));
    const scopeDebtRows = rows.filter((r) => KNOWN_SCOPE_DEBT_EDGE_TYPES.has(r.edgeType));
    const unknownRows = rows.filter(
      (r) => !EXPECTED_GLOBAL_EDGE_TYPES.has(r.edgeType) && !KNOWN_SCOPE_DEBT_EDGE_TYPES.has(r.edgeType),
    );

    if (unknownRows.length > 0) {
      fail(
        `Unknown unscoped edge types detected: ${unknownRows
          .map((r) => `${r.edgeType}:${r.count}`)
          .join(', ')}`,
      );
    }

    const scopeDebtTotal = scopeDebtRows.reduce((sum, row) => sum + Number(row.count ?? 0), 0);
    const maxScopeDebt = Number(process.env.MAX_UNSCOPED_SCOPE_DEBT ?? 0);

    if (scopeDebtTotal > maxScopeDebt) {
      fail(`Known scope-debt edges exceeded threshold (${scopeDebtTotal} > ${maxScopeDebt})`);
    }

    console.log(
      JSON.stringify({
        ok: true,
        unscopedEdgeTypes: rows.length,
        expectedGlobal: globalRows,
        knownScopeDebt: scopeDebtRows,
        scopeDebtTotal,
        maxScopeDebt,
      }),
    );
  } finally {
    await neo4j.getDriver().close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
