/**
 * AUD-TC-07-L1-08: timeouts.ts — Behavioral Audit Tests
 *
 * Spec source: plans/codegraph/PLAN.md §Phase 1 "Neo4j Ingest" (connection)
 *              + §"Vector embeddings + semantic search" (OpenAI timeouts)
 *
 * Accept: 6+ behavioral assertions, all green
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  TIMEOUT_DEFAULTS,
  getTimeoutConfig,
} from '../../../core/config/timeouts.js';

// ─── Env var save/restore ─────────────────────────────────────────────────────

const ENV_KEYS = [
  'NEO4J_QUERY_TIMEOUT_MS',
  'NEO4J_CONNECTION_TIMEOUT_MS',
  'OPENAI_EMBEDDING_TIMEOUT_MS',
  'OPENAI_ASSISTANT_TIMEOUT_MS',
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

describe('AUD-TC-07 | timeouts.ts', () => {

  // ─── Behavior 1: TIMEOUT_DEFAULTS neo4j values ───────────────────────────

  describe('Behavior 1: TIMEOUT_DEFAULTS.neo4j has correct spec values', () => {
    it('neo4j.queryTimeoutMs is 30000', () => {
      expect(TIMEOUT_DEFAULTS.neo4j.queryTimeoutMs).toBe(30_000);
    });

    it('neo4j.connectionTimeoutMs is 10000', () => {
      expect(TIMEOUT_DEFAULTS.neo4j.connectionTimeoutMs).toBe(10_000);
    });
  });

  // ─── Behavior 2: TIMEOUT_DEFAULTS openai values ──────────────────────────

  describe('Behavior 2: TIMEOUT_DEFAULTS.openai has correct spec values', () => {
    it('openai.embeddingTimeoutMs is 60000', () => {
      expect(TIMEOUT_DEFAULTS.openai.embeddingTimeoutMs).toBe(60_000);
    });

    it('openai.assistantTimeoutMs is 120000', () => {
      expect(TIMEOUT_DEFAULTS.openai.assistantTimeoutMs).toBe(120_000);
    });
  });

  // ─── Behavior 3: getTimeoutConfig() returns defaults when no env vars set ─

  describe('Behavior 3: getTimeoutConfig() returns defaults when no env vars set', () => {
    it('returns neo4j.queryTimeoutMs = 30000', () => {
      const cfg = getTimeoutConfig();
      expect(cfg.neo4j.queryTimeoutMs).toBe(30_000);
    });

    it('returns neo4j.connectionTimeoutMs = 10000', () => {
      const cfg = getTimeoutConfig();
      expect(cfg.neo4j.connectionTimeoutMs).toBe(10_000);
    });

    it('returns openai.embeddingTimeoutMs = 60000', () => {
      const cfg = getTimeoutConfig();
      expect(cfg.openai.embeddingTimeoutMs).toBe(60_000);
    });

    it('returns openai.assistantTimeoutMs = 120000', () => {
      const cfg = getTimeoutConfig();
      expect(cfg.openai.assistantTimeoutMs).toBe(120_000);
    });
  });

  // ─── Behavior 4: NEO4J_QUERY_TIMEOUT_MS env var overrides ────────────────

  describe('Behavior 4: getTimeoutConfig() overrides neo4j.queryTimeoutMs from env var', () => {
    it('NEO4J_QUERY_TIMEOUT_MS=5000 overrides queryTimeoutMs', () => {
      process.env.NEO4J_QUERY_TIMEOUT_MS = '5000';
      const cfg = getTimeoutConfig();
      expect(cfg.neo4j.queryTimeoutMs).toBe(5000);
    });

    it('NEO4J_QUERY_TIMEOUT_MS does not affect connectionTimeoutMs', () => {
      process.env.NEO4J_QUERY_TIMEOUT_MS = '5000';
      const cfg = getTimeoutConfig();
      expect(cfg.neo4j.connectionTimeoutMs).toBe(10_000);
    });
  });

  // ─── Behavior 5: all 4 timeout values independently overrideable ──────────

  describe('Behavior 5: getTimeoutConfig() overrides all 4 timeouts independently', () => {
    it('NEO4J_CONNECTION_TIMEOUT_MS overrides connectionTimeoutMs', () => {
      process.env.NEO4J_CONNECTION_TIMEOUT_MS = '3000';
      const cfg = getTimeoutConfig();
      expect(cfg.neo4j.connectionTimeoutMs).toBe(3000);
    });

    it('OPENAI_EMBEDDING_TIMEOUT_MS overrides embeddingTimeoutMs', () => {
      process.env.OPENAI_EMBEDDING_TIMEOUT_MS = '15000';
      const cfg = getTimeoutConfig();
      expect(cfg.openai.embeddingTimeoutMs).toBe(15000);
    });

    it('OPENAI_ASSISTANT_TIMEOUT_MS overrides assistantTimeoutMs', () => {
      process.env.OPENAI_ASSISTANT_TIMEOUT_MS = '90000';
      const cfg = getTimeoutConfig();
      expect(cfg.openai.assistantTimeoutMs).toBe(90000);
    });

    it('all 4 overrides can be set simultaneously', () => {
      process.env.NEO4J_QUERY_TIMEOUT_MS = '1000';
      process.env.NEO4J_CONNECTION_TIMEOUT_MS = '2000';
      process.env.OPENAI_EMBEDDING_TIMEOUT_MS = '3000';
      process.env.OPENAI_ASSISTANT_TIMEOUT_MS = '4000';
      const cfg = getTimeoutConfig();
      expect(cfg.neo4j.queryTimeoutMs).toBe(1000);
      expect(cfg.neo4j.connectionTimeoutMs).toBe(2000);
      expect(cfg.openai.embeddingTimeoutMs).toBe(3000);
      expect(cfg.openai.assistantTimeoutMs).toBe(4000);
    });
  });

  // ─── Behavior 6: invalid env var values fall back to defaults ────────────

  describe('Behavior 6: invalid (non-numeric) env var values fall back to defaults', () => {
    it('non-numeric NEO4J_QUERY_TIMEOUT_MS falls back to 30000', () => {
      process.env.NEO4J_QUERY_TIMEOUT_MS = 'not-a-number';
      const cfg = getTimeoutConfig();
      expect(cfg.neo4j.queryTimeoutMs).toBe(30_000);
    });

    it('empty string NEO4J_QUERY_TIMEOUT_MS falls back to 30000', () => {
      process.env.NEO4J_QUERY_TIMEOUT_MS = '';
      const cfg = getTimeoutConfig();
      expect(cfg.neo4j.queryTimeoutMs).toBe(30_000);
    });

    it('non-numeric OPENAI_EMBEDDING_TIMEOUT_MS falls back to 60000', () => {
      process.env.OPENAI_EMBEDDING_TIMEOUT_MS = 'invalid';
      const cfg = getTimeoutConfig();
      expect(cfg.openai.embeddingTimeoutMs).toBe(60_000);
    });

    it('non-numeric OPENAI_ASSISTANT_TIMEOUT_MS falls back to 120000', () => {
      process.env.OPENAI_ASSISTANT_TIMEOUT_MS = 'foo';
      const cfg = getTimeoutConfig();
      expect(cfg.openai.assistantTimeoutMs).toBe(120_000);
    });
  });
});
