import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { policyMap } from '../../core/config/file-risk-label-policy.js';

interface LabelRow {
  label: string;
  files: number;
}

async function main(): Promise<void> {
  const neo4j = new Neo4jService();
  try {
    const rows = await neo4j.run(`
      MATCH (sf:SourceFile {projectId: $projectId})
      OPTIONAL MATCH (sf)-[:CONTAINS]->(n)
      UNWIND labels(n) AS lbl
      WITH lbl, count(DISTINCT sf) AS files
      WHERE lbl <> 'CodeNode'
      RETURN lbl AS label, files
      ORDER BY files DESC, label ASC
    `, { projectId: 'proj_c0d3e9a1f200' }) as LabelRow[];

    const policy = policyMap();
    const missing: LabelRow[] = [];

    for (const row of rows ?? []) {
      if (!policy.has(String(row.label))) {
        missing.push(row);
      }
    }

    if (missing.length > 0) {
      console.error(JSON.stringify({
        ok: false,
        reason: 'unaccounted_labels',
        missing,
      }, null, 2));
      process.exit(1);
    }

    console.log(JSON.stringify({
      ok: true,
      observedLabels: (rows ?? []).length,
      policyLabels: policy.size,
      accountedLabels: (rows ?? []).map((r) => r.label),
    }));
  } finally {
    await neo4j.getDriver().close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
