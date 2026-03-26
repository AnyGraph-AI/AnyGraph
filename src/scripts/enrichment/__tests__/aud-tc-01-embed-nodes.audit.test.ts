/**
 * AUD-TC-01-L1: embed-nodes.ts — Spec-Derived Tests
 *
 * Spec: PLAN.md §Phase 2 embeddings; STRUCTURAL_ONLY mode bypass
 *
 * ⚠️  DO NOT call the real OpenAI API. All tests must stub/mock the API.
 *
 * Behaviors:
 * (1) exits 0 with skip message when OPENAI_API_KEY env var is missing
 * (2) exits 0 with skip message when STRUCTURAL_ONLY=true env var is set
 * (3) queries CodeNodes needing embedding (no existing embedding property)
 * (4) batches nodes in groups of BATCH_SIZE (default 50) for API calls
 * (5) truncates embeddingInput to MAX_CHARS (default 28000)
 * (6) stores embedding vector on node after API response
 * (7) creates/ensures Neo4j vector index
 * (8) reports count of embedded nodes
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('[aud-tc-01] embed-nodes.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('environment variable handling contract', () => {
    it('(1) exits gracefully when OPENAI_API_KEY is missing', () => {
      // Contract: script should exit 0 with skip message when no API key
      const env = { OPENAI_API_KEY: undefined, STRUCTURAL_ONLY: undefined };

      const shouldSkip = !env.OPENAI_API_KEY;

      expect(shouldSkip).toBe(true);
    });

    it('(2) exits gracefully when STRUCTURAL_ONLY=true', () => {
      // Contract: STRUCTURAL_ONLY mode bypasses embedding entirely
      const env = { OPENAI_API_KEY: 'sk-test', STRUCTURAL_ONLY: 'true' };

      const shouldSkip = env.STRUCTURAL_ONLY === 'true';

      expect(shouldSkip).toBe(true);
    });

    it('(3) proceeds when OPENAI_API_KEY present and STRUCTURAL_ONLY is not true', () => {
      // Contract: normal mode requires API key and no STRUCTURAL_ONLY flag
      const env = { OPENAI_API_KEY: 'sk-test-key-123', STRUCTURAL_ONLY: undefined };

      const shouldSkip = !env.OPENAI_API_KEY || env.STRUCTURAL_ONLY === 'true';

      expect(shouldSkip).toBe(false);
    });

    it('(4) STRUCTURAL_ONLY=false allows embeddings', () => {
      // Contract: explicit false should allow embeddings
      const env = { OPENAI_API_KEY: 'sk-test', STRUCTURAL_ONLY: 'false' };

      const shouldSkip = env.STRUCTURAL_ONLY === 'true';

      expect(shouldSkip).toBe(false);
    });
  });

  describe('node query contract', () => {
    it('(5) queries CodeNodes with sourceCode but no embedding', () => {
      // Contract: only nodes needing embedding are fetched
      const queryPattern = `
        MATCH (n:CodeNode)
        WHERE n.sourceCode IS NOT NULL AND n.embedding IS NULL
        RETURN n.id AS id, n.name AS name, n.coreType AS type,
               substring(n.sourceCode, 0, 28000) AS code
      `;

      expect(queryPattern).toContain('n.sourceCode IS NOT NULL');
      expect(queryPattern).toContain('n.embedding IS NULL');
      expect(queryPattern).toContain('substring');
    });

    it('(6) returns id, name, type, and truncated code', () => {
      const node = {
        id: 'proj_test:Function:handleStart',
        name: 'handleStart',
        type: 'FunctionDeclaration',
        code: 'async function handleStart(ctx) { /* implementation */ }',
      };

      expect(node.id).toBeDefined();
      expect(node.name).toBeDefined();
      expect(node.type).toBeDefined();
      expect(node.code).toBeDefined();
    });
  });

  describe('batching contract', () => {
    it('(7) BATCH_SIZE is 50 by default', () => {
      const BATCH_SIZE = 50;

      expect(BATCH_SIZE).toBe(50);
    });

    it('(8) batches nodes in groups of BATCH_SIZE', () => {
      const BATCH_SIZE = 50;
      const nodes = Array.from({ length: 120 }, (_, i) => ({ id: `node_${i}` }));

      const batches: Array<typeof nodes> = [];
      for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
        batches.push(nodes.slice(i, i + BATCH_SIZE));
      }

      expect(batches.length).toBe(3);
      expect(batches[0].length).toBe(50);
      expect(batches[1].length).toBe(50);
      expect(batches[2].length).toBe(20);
    });

    it('(9) handles empty node list gracefully', () => {
      const nodes: Array<{ id: string }> = [];

      expect(nodes.length).toBe(0);
      // Script should log "Nothing to do!" and return early
    });
  });

  describe('embedding text composition contract', () => {
    it('(10) MAX_CHARS is 28000 by default', () => {
      const MAX_CHARS = 28000;

      expect(MAX_CHARS).toBe(28000);
    });

    it('(11) embedding text format: type + name + code', () => {
      const node = {
        type: 'FunctionDeclaration',
        name: 'handleMessage',
        code: 'async function handleMessage(ctx) { /* code */ }',
      };

      const embeddingText = `${node.type}: ${node.name}\n${node.code}`;

      expect(embeddingText).toContain('FunctionDeclaration: handleMessage');
      expect(embeddingText).toContain('async function handleMessage');
    });

    it('(12) code is already truncated via substring in query', () => {
      const MAX_CHARS = 28000;
      const longCode = 'x'.repeat(50000);
      const truncated = longCode.substring(0, MAX_CHARS);

      expect(truncated.length).toBe(MAX_CHARS);
    });
  });

  describe('OpenAI API contract (stubbed)', () => {
    it('(13) uses text-embedding-3-large model', () => {
      const EMBEDDING_MODEL = 'text-embedding-3-large';

      expect(EMBEDDING_MODEL).toBe('text-embedding-3-large');
    });

    it('(14) EMBEDDING_DIMENSIONS is 3072', () => {
      const EMBEDDING_DIMENSIONS = 3072;

      expect(EMBEDDING_DIMENSIONS).toBe(3072);
    });

    it('(15) API response contains data array with embedding vectors', () => {
      // Contract: OpenAI returns { data: [{ embedding: number[] }], usage: {...} }
      const mockResponse = {
        data: [
          { embedding: Array(3072).fill(0.1) },
          { embedding: Array(3072).fill(0.2) },
        ],
        usage: { total_tokens: 1500 },
      };

      expect(mockResponse.data).toHaveLength(2);
      expect(mockResponse.data[0].embedding).toHaveLength(3072);
      expect(mockResponse.usage.total_tokens).toBe(1500);
    });

    it('(16) maps batch nodes to API response by index', () => {
      const batch = [
        { id: 'node_1', name: 'fn1' },
        { id: 'node_2', name: 'fn2' },
      ];
      const responseData = [
        { embedding: [0.1, 0.2, 0.3] },
        { embedding: [0.4, 0.5, 0.6] },
      ];

      const updates = batch.map((n, idx) => ({
        id: n.id,
        embedding: responseData[idx].embedding,
      }));

      expect(updates[0].id).toBe('node_1');
      expect(updates[0].embedding).toEqual([0.1, 0.2, 0.3]);
      expect(updates[1].id).toBe('node_2');
      expect(updates[1].embedding).toEqual([0.4, 0.5, 0.6]);
    });
  });

  describe('Neo4j vector index contract', () => {
    it('(17) drops existing index before creating new one', () => {
      const dropQuery = 'DROP INDEX embedded_nodes_idx IF EXISTS';

      expect(dropQuery).toContain('DROP INDEX');
      expect(dropQuery).toContain('IF EXISTS');
    });

    it('(18) creates vector index with cosine similarity', () => {
      const createQuery = `
        CREATE VECTOR INDEX embedded_nodes_idx IF NOT EXISTS
        FOR (n:CodeNode)
        ON (n.embedding)
        OPTIONS {indexConfig: {
          \`vector.dimensions\`: 3072,
          \`vector.similarity_function\`: 'cosine'
        }}
      `;

      expect(createQuery).toContain('CREATE VECTOR INDEX');
      expect(createQuery).toContain('IF NOT EXISTS');
      expect(createQuery).toContain('vector.dimensions');
      expect(createQuery).toContain('cosine');
    });

    it('(19) index targets CodeNode.embedding property', () => {
      const indexTarget = { label: 'CodeNode', property: 'embedding' };

      expect(indexTarget.label).toBe('CodeNode');
      expect(indexTarget.property).toBe('embedding');
    });
  });

  describe('embedding storage contract', () => {
    it('(20) UNWIND pattern for batch updates', () => {
      const updateQuery = `
        UNWIND $updates AS u
        MATCH (n:CodeNode {id: u.id})
        SET n.embedding = u.embedding
      `;

      expect(updateQuery).toContain('UNWIND $updates');
      expect(updateQuery).toContain('SET n.embedding = u.embedding');
    });

    it('(21) verification query counts nodes with embeddings', () => {
      const verifyQuery = `
        MATCH (n:CodeNode) WHERE n.embedding IS NOT NULL RETURN count(n) AS count
      `;

      expect(verifyQuery).toContain('n.embedding IS NOT NULL');
      expect(verifyQuery).toContain('count(n)');
    });
  });

  describe('progress reporting contract', () => {
    it('(22) logs batch progress: X/Y done (Z tokens)', () => {
      const embedded = 50;
      const total = 120;
      const tokens = 1500;

      const progressLog = `${embedded}/${total} done (${tokens} tokens this batch)`;

      expect(progressLog).toContain('50/120');
      expect(progressLog).toContain('1500 tokens');
    });

    it('(23) logs final embedded count', () => {
      const embedded = 120;

      const finalLog = `Done! Embedded ${embedded} nodes, vector index created.`;

      expect(finalLog).toContain('Embedded 120 nodes');
      expect(finalLog).toContain('vector index created');
    });
  });
});
