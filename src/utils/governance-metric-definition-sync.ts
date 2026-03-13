import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

type SurfaceType = 'Script' | 'DashboardQuery' | 'MCPTool' | 'QueryContract';

interface MetricDefinition {
  name: string;
  unit: string;
  role: 'primary' | 'diagnostic';
  definition: string;
  surfaces: Array<{ type: SurfaceType; name: string }>;
}

const DEFINITIONS: MetricDefinition[] = [
  {
    name: 'preventedRuns',
    unit: 'count',
    role: 'primary',
    definition: 'count(distinct run) where (:VerificationRun)-[:PREVENTED]->(:RegressionEvent)',
    surfaces: [
      { type: 'Script', name: 'src/utils/governance-metrics-snapshot.ts' },
      { type: 'Script', name: 'src/utils/governance-metrics-report.ts' },
      { type: 'Script', name: 'src/utils/verify-governance-metrics-integrity.ts' },
      { type: 'DashboardQuery', name: 'verification_status_dashboard.governanceMetricsLatest' },
      { type: 'MCPTool', name: 'governance_metrics_status' },
      { type: 'QueryContract', name: 'CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST' },
      { type: 'QueryContract', name: 'CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND' },
    ],
  },
  {
    name: 'preventedEdgesDiagnostic',
    unit: 'count',
    role: 'diagnostic',
    definition: 'count(distinct rel) where (:VerificationRun)-[rel:PREVENTED]->(:RegressionEvent)',
    surfaces: [
      { type: 'Script', name: 'src/utils/governance-metrics-snapshot.ts' },
      { type: 'Script', name: 'src/utils/governance-metrics-report.ts' },
      { type: 'Script', name: 'src/utils/verify-governance-metrics-integrity.ts' },
      { type: 'DashboardQuery', name: 'verification_status_dashboard.governanceMetricsLatest' },
      { type: 'MCPTool', name: 'governance_metrics_status' },
      { type: 'QueryContract', name: 'CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST' },
      { type: 'QueryContract', name: 'CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND' },
    ],
  },
  {
    name: 'interceptionRate',
    unit: 'ratio',
    role: 'primary',
    definition: 'failuresResolvedBeforeCommit / gateFailures (strict); operational variant uses preventedRuns / totalRegressionEvents',
    surfaces: [
      { type: 'Script', name: 'src/utils/governance-metrics-snapshot.ts' },
      { type: 'Script', name: 'src/utils/governance-metrics-report.ts' },
      { type: 'Script', name: 'src/utils/verify-governance-metrics-integrity.ts' },
      { type: 'DashboardQuery', name: 'verification_status_dashboard.governanceMetricsLatest' },
      { type: 'MCPTool', name: 'governance_metrics_status' },
      { type: 'QueryContract', name: 'CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST' },
      { type: 'QueryContract', name: 'CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND' },
    ],
  },
];

async function main(): Promise<void> {
  const projectId = process.argv[2] ?? 'proj_c0d3e9a1f200';
  const neo4j = new Neo4jService();

  try {
    let defsUpserted = 0;
    let surfacesUpserted = 0;
    let linksUpserted = 0;

    for (const def of DEFINITIONS) {
      await neo4j.run(
        `MERGE (m:CodeNode:MetricDefinition {id: $id})
         SET m.projectId = $projectId,
             m.coreType = 'MetricDefinition',
             m.name = $name,
             m.unit = $unit,
             m.role = $role,
             m.definition = $definition,
             m.updatedAt = toString(datetime())`,
        {
          id: `metric:${def.name}`,
          projectId,
          name: def.name,
          unit: def.unit,
          role: def.role,
          definition: def.definition,
        },
      );
      defsUpserted += 1;

      for (const surface of def.surfaces) {
        await neo4j.run(
          `MERGE (s:CodeNode:MetricSurface {id: $surfaceId})
           SET s.projectId = $projectId,
               s.coreType = 'MetricSurface',
               s.surfaceType = $surfaceType,
               s.name = $surfaceName,
               s.updatedAt = toString(datetime())
           WITH s
           MATCH (m:MetricDefinition {id: $metricId, projectId: $projectId})
           MERGE (m)-[u:USED_BY]->(s)
           SET u.projectId = $projectId,
               u.updatedAt = toString(datetime())`,
          {
            projectId,
            metricId: `metric:${def.name}`,
            surfaceId: `surface:${surface.type}:${surface.name}`,
            surfaceType: surface.type,
            surfaceName: surface.name,
          },
        );
        surfacesUpserted += 1;
        linksUpserted += 1;
      }
    }

    console.log(
      JSON.stringify({
        ok: true,
        projectId,
        metricDefinitions: DEFINITIONS.length,
        defsUpserted,
        surfacesUpserted,
        linksUpserted,
      }),
    );
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
