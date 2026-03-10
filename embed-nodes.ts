#!/usr/bin/env npx tsx
/**
 * Post-ingest embedding pass: embeds all code nodes with OpenAI text-embedding-3-large
 * and creates the vector index for semantic search.
 */
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });

import neo4j from 'neo4j-driver';
import OpenAI from 'openai';

const EMBEDDING_MODEL = 'text-embedding-3-large';
const EMBEDDING_DIMENSIONS = 3072;
const BATCH_SIZE = 50; // OpenAI supports up to 2048 per batch
const MAX_CHARS = 28000; // ~7000 tokens, safely under 8192 token limit

const driver = neo4j.driver(
  process.env.NEO4J_URI ?? 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'codegraph')
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function main() {
  const session = driver.session();

  try {
    // 1. Get all nodes with sourceCode but no embedding
    console.log('Fetching nodes needing embeddings...');
    const result = await session.run(`
      MATCH (n:CodeNode)
      WHERE n.sourceCode IS NOT NULL AND n.embedding IS NULL
      RETURN n.id AS id, n.name AS name, n.coreType AS type,
             substring(n.sourceCode, 0, ${MAX_CHARS}) AS code
    `);

    const nodes = result.records.map(r => ({
      id: r.get('id') as string,
      name: r.get('name') as string,
      type: r.get('type') as string,
      code: r.get('code') as string,
    }));

    console.log(`Found ${nodes.length} nodes to embed`);
    if (nodes.length === 0) {
      console.log('Nothing to do!');
      return;
    }

    // 2. Embed in batches
    let embedded = 0;
    for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
      const batch = nodes.slice(i, i + BATCH_SIZE);
      const texts = batch.map(n => {
        const meta = `${n.type}: ${n.name}`;
        return `${meta}\n${n.code}`;
      });

      console.log(`Embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(nodes.length / BATCH_SIZE)} (${batch.length} nodes)...`);

      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
      });

      // 3. Write embeddings back to Neo4j
      const updates = batch.map((n, idx) => ({
        id: n.id,
        embedding: response.data[idx].embedding,
      }));

      await session.run(`
        UNWIND $updates AS u
        MATCH (n:CodeNode {id: u.id})
        SET n.embedding = u.embedding
      `, { updates });

      embedded += batch.length;
      console.log(`  ${embedded}/${nodes.length} done (${response.usage.total_tokens} tokens this batch)`);
    }

    // 4. Create vector index
    console.log('Creating vector index...');
    try {
      await session.run(`
        DROP INDEX embedded_nodes_idx IF EXISTS
      `);
    } catch { /* index might not exist */ }

    await session.run(`
      CREATE VECTOR INDEX embedded_nodes_idx IF NOT EXISTS
      FOR (n:CodeNode)
      ON (n.embedding)
      OPTIONS {indexConfig: {
        \`vector.dimensions\`: ${EMBEDDING_DIMENSIONS},
        \`vector.similarity_function\`: 'cosine'
      }}
    `);

    console.log(`Done! Embedded ${embedded} nodes, vector index created.`);

    // 5. Verify
    const verify = await session.run(`
      MATCH (n:CodeNode) WHERE n.embedding IS NOT NULL RETURN count(n) AS count
    `);
    console.log(`Verification: ${verify.records[0].get('count')} nodes have embeddings`);

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);
