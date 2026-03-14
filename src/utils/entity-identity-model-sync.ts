import { createHash } from 'node:crypto';

import dotenv from 'dotenv';

import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

dotenv.config();

const META_PROJECT_ID = 'proj_e17e17e17e17';

interface ObservedRow {
  observedId: string;
  observedProjectId: string;
  kind: string;
  normalized: string;
  value: string;
}

interface PersonRow {
  personId: string;
  normalized: string;
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function canonicalId(kind: string, normalized: string): string {
  const h = createHash('sha256').update(`${kind}|${normalized}`).digest('hex').slice(0, 24);
  return `${META_PROJECT_ID}:CanonicalEntity:${h}`;
}

async function main(): Promise<void> {
  const runId = `entity-sync:${Date.now().toString(36)}`;
  const neo4j = new Neo4jService();
  try {
    await neo4j.run(
      `MERGE (p:Project {projectId: $projectId})
       SET p.name = coalesce(p.name, 'Entity Identity Model'),
           p.displayName = coalesce(p.displayName, 'Entity Identity Model'),
           p.projectType = 'meta',
           p.sourceKind = 'manual',
           p.status = 'active',
           p.updatedAt = toString(datetime())`,
      { projectId: META_PROJECT_ID },
    );

    await neo4j.run(
      `MATCH (e:ExtractedEntity)
       SET e:ObservedEntity,
           e.observedKind = coalesce(e.kind, 'Entity'),
           e.observedNormalized = toLower(trim(coalesce(e.normalized, e.name, ''))),
           e.identityModelVersion = 'entity-model.v1'`,
    );

    await neo4j.run(
      `MATCH (p:Person)
       SET p:CanonicalEntity,
           p.canonicalKind = 'Person',
           p.canonicalName = coalesce(p.name, ''),
           p.canonicalNormalized = toLower(trim(coalesce(p.name, ''))),
           p.identityModelVersion = 'entity-model.v1'`,
    );

    const observed = (await neo4j.run(
      `MATCH (o:ObservedEntity)
       RETURN o.id AS observedId,
              o.projectId AS observedProjectId,
              coalesce(o.kind, 'Entity') AS kind,
              toLower(trim(coalesce(o.normalized, o.name, ''))) AS normalized,
              coalesce(o.name, '') AS value`,
    )) as ObservedRow[];

    const persons = (await neo4j.run(
      `MATCH (p:Person)
       RETURN p.id AS personId,
              toLower(trim(coalesce(p.name, ''))) AS normalized`,
    )) as PersonRow[];

    const personByNormalized = new Map<string, string>();
    for (const p of persons) {
      if (!p.normalized) continue;
      if (!personByNormalized.has(p.normalized)) personByNormalized.set(p.normalized, p.personId);
    }

    let canonicalCreated = 0;
    let resolveEdges = 0;

    for (const row of observed) {
      const kind = row.kind || 'Entity';
      const normalized = norm(row.normalized || row.value || '');
      if (!normalized) continue;

      let targetCanonicalId: string;
      const personCanonical = kind.toLowerCase() === 'person' ? personByNormalized.get(normalized) : undefined;

      if (personCanonical) {
        targetCanonicalId = personCanonical;
      } else {
        targetCanonicalId = canonicalId(kind, normalized);
        const created = (await neo4j.run(
          `MERGE (c:CanonicalEntity {id: $id, projectId: $projectId})
           ON CREATE SET c.name = $name,
                         c.canonicalName = $name,
                         c.canonicalKind = $kind,
                         c.canonicalNormalized = $normalized,
                         c.identityModelVersion = 'entity-model.v1',
                         c.sourceKind = 'manual',
                         c.createdAt = toString(datetime()),
                         c._identitySyncRunId = $runId
           ON MATCH SET c.canonicalKind = coalesce(c.canonicalKind, $kind),
                        c.canonicalNormalized = coalesce(c.canonicalNormalized, $normalized),
                        c.identityModelVersion = 'entity-model.v1'
           RETURN CASE WHEN coalesce(c._identitySyncRunId, '') = $runId THEN 1 ELSE 0 END AS createdNow`,
          {
            id: targetCanonicalId,
            projectId: META_PROJECT_ID,
            name: row.value || normalized,
            kind,
            normalized,
            runId,
          },
        )) as Array<{ createdNow: number }>;
        canonicalCreated += Number(created[0]?.createdNow ?? 0);
      }

      const res = (await neo4j.run(
        `MATCH (o {id: $observedId})
         MATCH (c {id: $canonicalId})
         MERGE (o)-[r:RESOLVES_TO {projectId: $edgeProjectId, resolutionKind: 'entity_identity'}]->(c)
         ON CREATE SET r.confidence = $confidence,
                       r.provenanceKind = 'heuristic',
                       r.updatedAt = toString(datetime())
         ON MATCH SET r.confidence = coalesce(r.confidence, $confidence),
                      r.updatedAt = toString(datetime())
         RETURN count(r) AS count`,
        {
          observedId: row.observedId,
          canonicalId: targetCanonicalId,
          edgeProjectId: row.observedProjectId,
          confidence: personCanonical ? 0.95 : 0.7,
        },
      )) as Array<{ count: number }>;
      resolveEdges += Number(res[0]?.count ?? 0);
    }

    await neo4j.run(
      `MATCH (c:CanonicalEntity {projectId: $projectId})
       WHERE coalesce(c._identitySyncRunId, '') = $runId
       REMOVE c._identitySyncRunId`,
      {
        projectId: META_PROJECT_ID,
        runId,
      },
    );

    const canonicalCount = (await neo4j.run(`MATCH (c:CanonicalEntity) RETURN count(c) AS c`)) as Array<{ c: number }>;
    const observedCount = (await neo4j.run(`MATCH (o:ObservedEntity) RETURN count(o) AS c`)) as Array<{ c: number }>;

    console.log(
      JSON.stringify({
        ok: true,
        modelVersion: 'entity-model.v1',
        runId,
        metaProjectId: META_PROJECT_ID,
        observedProcessed: observed.length,
        canonicalCreated,
        resolveEdges,
        observedCount: Number(observedCount[0]?.c ?? 0),
        canonicalCount: Number(canonicalCount[0]?.c ?? 0),
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
