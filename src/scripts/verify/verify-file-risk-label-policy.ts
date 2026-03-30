import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { policyMap } from '../../core/config/file-risk-label-policy.js';

interface LabelRow {
  label: string;
  files: number;
}

interface ConfigClassRow {
  configRiskClass: string;
  files: number;
}

const PROJECT_ID = 'proj_c0d3e9a1f200';
const ALLOWED_CONFIG_CLASSES = new Set(['NONE', 'GOVERNANCE_CRITICAL_CONFIG', 'EXAMPLE_ASSET', 'TEST_FILE']);

function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof (v as { toNumber?: unknown }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v);
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
    `, { projectId: PROJECT_ID }) as LabelRow[];

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

    const configClassRows = await neo4j.run(`
      MATCH (sf:SourceFile {projectId: $projectId})
      WITH coalesce(sf.configRiskClass, '__MISSING__') AS configRiskClass, count(sf) AS files
      RETURN configRiskClass, files
      ORDER BY files DESC, configRiskClass ASC
    `, { projectId: PROJECT_ID }) as ConfigClassRow[];

    const invalidConfigClasses = (configClassRows ?? [])
      .filter((row) => !ALLOWED_CONFIG_CLASSES.has(String(row.configRiskClass)))
      .map((row) => ({ configRiskClass: row.configRiskClass, files: toNum(row.files) }));

    if (invalidConfigClasses.length > 0) {
      console.error(JSON.stringify({
        ok: false,
        reason: 'invalid_config_risk_class',
        invalidConfigClasses,
        allowed: Array.from(ALLOWED_CONFIG_CLASSES),
      }, null, 2));
      process.exit(1);
    }

    const governanceConfigRows = await neo4j.run(`
      MATCH (sf:SourceFile {projectId: $projectId})
      WHERE sf.filePath ENDS WITH '/vitest.config.ts'
      RETURN count(sf) AS total,
             sum(CASE WHEN sf.configRiskClass = 'GOVERNANCE_CRITICAL_CONFIG' THEN 1 ELSE 0 END) AS classified
    `, { projectId: PROJECT_ID }) as Array<{ total: number; classified: number }>;

    const governanceTotals = governanceConfigRows?.[0] ?? { total: 0, classified: 0 };
    if (toNum(governanceTotals.total ?? 0) > 0 && toNum(governanceTotals.classified ?? 0) !== toNum(governanceTotals.total ?? 0)) {
      console.error(JSON.stringify({
        ok: false,
        reason: 'governance_config_not_classified',
        vitestConfigTotal: governanceTotals.total,
        vitestConfigClassified: governanceTotals.classified,
      }, null, 2));
      process.exit(1);
    }

    console.log(JSON.stringify({
      ok: true,
      observedLabels: (rows ?? []).length,
      policyLabels: policy.size,
      accountedLabels: (rows ?? []).map((r) => r.label),
      configRiskClasses: (configClassRows ?? []).map((row) => ({
        configRiskClass: row.configRiskClass,
        files: toNum(row.files),
      })),
    }));
  } finally {
    await neo4j.getDriver().close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
