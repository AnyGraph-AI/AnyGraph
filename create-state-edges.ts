#!/usr/bin/env npx tsx
/**
 * Post-ingest pass: Create Field nodes + READS_STATE/WRITES_STATE edges
 * from sessionReads/sessionWrites arrays in handler node context.
 * 
 * This turns JSON-stringified context data into first-class graph structure.
 */
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  process.env.NEO4J_URI ?? 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'codegraph')
);

async function main() {
  const session = driver.session();

  try {
    // 1. Extract all handlers with session access from JSON context
    console.log('Extracting session access patterns from handler context...');
    const result = await session.run(`
      MATCH (n:CodeNode)
      WHERE n.context IS NOT NULL
        AND (n.context CONTAINS '"sessionReads"' OR n.context CONTAINS '"sessionWrites"')
      RETURN n.id AS id, n.name AS name, n.context AS context, n.projectId AS projectId
    `);

    const handlers = result.records.map(r => {
      const ctx = JSON.parse(r.get('context') as string);
      return {
        id: r.get('id') as string,
        name: r.get('name') as string,
        projectId: r.get('projectId') as string,
        reads: (ctx.sessionReads || []) as string[],
        writes: (ctx.sessionWrites || []) as string[],
      };
    }).filter(h => h.reads.length > 0 || h.writes.length > 0);

    console.log(`Found ${handlers.length} handlers with session access`);

    // 2. Collect all unique field names
    const allFields = new Set<string>();
    for (const h of handlers) {
      h.reads.forEach(f => allFields.add(f));
      h.writes.forEach(f => allFields.add(f));
    }
    console.log(`Unique session fields: ${allFields.size} — ${[...allFields].join(', ')}`);

    // 3. Get projectId from first handler
    const projectId = handlers[0]?.projectId ?? 'proj_60d5feed0001';

    // 4. Create Field nodes
    console.log('Creating Field nodes...');
    const fieldNodes = [...allFields].map(name => ({
      id: `${projectId}:Field:session:${name}`,
      name,
      semanticRole: 'session',
      stateRoot: 'ctx.session',
      projectId,
    }));

    await session.run(`
      UNWIND $fields AS f
      MERGE (n:CodeNode:Field {id: f.id})
      SET n.name = f.name,
          n.semanticRole = f.semanticRole,
          n.stateRoot = f.stateRoot,
          n.projectId = f.projectId,
          n.coreType = 'Field'
    `, { fields: fieldNodes });

    console.log(`Created ${fieldNodes.length} Field nodes`);

    // 5. Create READS_STATE edges
    const readEdges: { handlerId: string; fieldId: string }[] = [];
    const writeEdges: { handlerId: string; fieldId: string }[] = [];

    for (const h of handlers) {
      for (const field of h.reads) {
        readEdges.push({
          handlerId: h.id,
          fieldId: `${projectId}:Field:session:${field}`,
        });
      }
      for (const field of h.writes) {
        writeEdges.push({
          handlerId: h.id,
          fieldId: `${projectId}:Field:session:${field}`,
        });
      }
    }

    console.log(`Creating ${readEdges.length} READS_STATE edges...`);
    await session.run(`
      UNWIND $edges AS e
      MATCH (h:CodeNode {id: e.handlerId})
      MATCH (f:Field {id: e.fieldId})
      MERGE (h)-[:READS_STATE]->(f)
    `, { edges: readEdges });

    console.log(`Creating ${writeEdges.length} WRITES_STATE edges...`);
    await session.run(`
      UNWIND $edges AS e
      MATCH (h:CodeNode {id: e.handlerId})
      MATCH (f:Field {id: e.fieldId})
      MERGE (h)-[:WRITES_STATE]->(f)
    `, { edges: writeEdges });

    // 6. Verify
    const stats = await session.run(`
      MATCH (f:Field) WITH count(f) AS fields
      OPTIONAL MATCH ()-[r:READS_STATE]->() WITH fields, count(r) AS reads
      OPTIONAL MATCH ()-[w:WRITES_STATE]->() 
      RETURN fields, reads, count(w) AS writes
    `);
    const s = stats.records[0];
    console.log(`\nDone! Field nodes: ${s.get('fields')}, READS_STATE: ${s.get('reads')}, WRITES_STATE: ${s.get('writes')}`);

    // 7. Show the state impact query working
    console.log('\n--- Query 7: State Object Impact ---');
    const q7 = await session.run(`
      MATCH (f:Field {semanticRole: 'session'})<-[r:READS_STATE|WRITES_STATE]-(h:CodeNode)
      RETURN f.name AS field, type(r) AS access, h.name AS handler
      ORDER BY f.name, access
    `);
    const byField = new Map<string, { readers: string[], writers: string[] }>();
    for (const rec of q7.records) {
      const field = rec.get('field') as string;
      const access = rec.get('access') as string;
      const handler = rec.get('handler') as string;
      if (!byField.has(field)) byField.set(field, { readers: [], writers: [] });
      const entry = byField.get(field)!;
      if (access === 'READS_STATE') entry.readers.push(handler);
      else entry.writers.push(handler);
    }
    for (const [field, { readers, writers }] of byField) {
      console.log(`  ${field}: ${writers.length} writers, ${readers.length} readers`);
    }

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);
