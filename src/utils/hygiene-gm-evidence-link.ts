/**
 * One-shot script: link GM-0..GM-7 done tasks to their implementing SourceFile nodes
 * via HAS_CODE_EVIDENCE edges. These tasks have implementations but the keyword matcher
 * couldn't connect them due to long descriptive task names.
 *
 * Safe: advisory-only, creates edges, does not modify task status or plan files.
 */
import dotenv from 'dotenv';
import neo4j from 'neo4j-driver';

dotenv.config();

const PROJECT_ID = process.env.PROJECT_ID ?? 'proj_c0d3e9a1f200';
const PLAN_PROJECT_ID = 'plan_codegraph';

// Manual mapping: milestone code → implementing file name patterns
const GM_EVIDENCE_MAP: Record<string, string[]> = {
  'GM-0': [
    'verify-plan-dependency-integrity.ts',
    'plan-parser.ts',
  ],
  'GM-1': [
    'governance-metrics-snapshot.ts',
    'verification-schema.ts',
    'verify-governance-stale-check.ts',
  ],
  'GM-2': [
    'governance-attribution-backfill.ts',
    'governance-metrics-snapshot.ts',
  ],
  'GM-3': [
    'governance-metrics-snapshot.ts',
    'governance-metrics-report.ts',
  ],
  'GM-4': [
    'governance-metrics-report.ts',
    'verification-status-dashboard.ts',
    'governance-metrics.tool.ts',
  ],
  'GM-5': [
    'verify-governance-metrics-integrity.ts',
    'verify-governance-stale-check.ts',
  ],
  'GM-6': [
    'governance-metric-definition-sync.ts',
    'verify-governance-metric-definition-lineage.ts',
  ],
  'GM-7': [
    'plan-refresh-for-gates.ts',
    'verification-done-check-capture.ts',
  ],
};

async function main(): Promise<void> {
  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'codegraph'),
  );
  const session = driver.session();

  try {
    let totalLinked = 0;
    let totalSkipped = 0;

    for (const [milestoneCode, filePatterns] of Object.entries(GM_EVIDENCE_MAP)) {
      // Get all done tasks in this milestone without evidence
      const tasksRes = await session.run(
        `MATCH (m:Milestone {projectId: $planProjectId})<-[:PART_OF]-(t:Task)
         WHERE t.status = 'done'
           AND m.code = $milestoneCode
         OPTIONAL MATCH (t)-[e:HAS_CODE_EVIDENCE]->()
         WITH t, count(e) AS existing
         WHERE existing = 0
         RETURN t.id AS taskId, t.name AS taskName`,
        { planProjectId: PLAN_PROJECT_ID, milestoneCode },
      );

      if (tasksRes.records.length === 0) {
        console.log(`${milestoneCode}: no unlinked done tasks`);
        continue;
      }

      // Find implementing SourceFile nodes
      const filesRes = await session.run(
        `MATCH (sf:SourceFile {projectId: $projectId})
         WHERE any(pat IN $patterns WHERE sf.name = pat)
         RETURN sf.id AS fileId, sf.name AS fileName`,
        { projectId: PROJECT_ID, patterns: filePatterns },
      );

      if (filesRes.records.length === 0) {
        console.log(`${milestoneCode}: no matching SourceFile nodes for patterns ${filePatterns.join(', ')}`);
        totalSkipped += tasksRes.records.length;
        continue;
      }

      const fileIds = filesRes.records.map((r) => ({
        id: String(r.get('fileId')),
        name: String(r.get('fileName')),
      }));

      for (const taskRec of tasksRes.records) {
        const taskId = String(taskRec.get('taskId'));

        for (const file of fileIds) {
          await session.run(
            `MATCH (t:Task {id: $taskId})
             MATCH (sf:SourceFile {id: $fileId})
             MERGE (t)-[e:HAS_CODE_EVIDENCE]->(sf)
             SET e.source = 'hygiene-gm-evidence-link',
                 e.refType = 'file_path',
                 e.linkedAt = datetime($linkedAt),
                 e.milestoneCode = $milestoneCode`,
            {
              taskId,
              fileId: file.id,
              linkedAt: new Date().toISOString(),
              milestoneCode,
            },
          );
        }
        totalLinked += 1;
      }

      console.log(`${milestoneCode}: linked ${tasksRes.records.length} tasks to ${fileIds.length} files`);
    }

    console.log(JSON.stringify({
      ok: true,
      totalLinked,
      totalSkipped,
      milestones: Object.keys(GM_EVIDENCE_MAP),
    }));
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
