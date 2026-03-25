// Spec source: plans/codegraph/PLAN.md §Phase 1 "Vector embeddings + semantic search (fork: OpenAI text-embedding-3-large)"
// Domain: AUD-TC-11c-L1-02
// Behaviors: 10 spec-derived tests for embeddings.service.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- OpenAI constructor mock (critical: must be constructor, not plain function) ---
const mockEmbeddingsCreate = vi.fn();

vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(function () {
    return {
      embeddings: { create: mockEmbeddingsCreate },
    };
  });
  return { default: MockOpenAI };
});

// Mock getTimeoutConfig before importing the service
vi.mock('../../config/timeouts.js', () => ({
  getTimeoutConfig: () => ({
    neo4j: { queryTimeoutMs: 30000, connectionTimeoutMs: 10000 },
    openai: { embeddingTimeoutMs: 60000, assistantTimeoutMs: 120000 },
  }),
}));

vi.mock('../../../mcp/utils.js', () => ({
  debugLog: vi.fn(),
}));

import OpenAI from 'openai';
import {
  EmbeddingsService,
  OpenAIConfigError,
  OpenAIAPIError,
  EMBEDDING_BATCH_CONFIG,
} from '../../embeddings/embeddings.service.js';

describe('EmbeddingsService — AUD-TC-11c-L1-02', () => {
  const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'sk-test-key-for-audit';
  });

  afterEach(() => {
    if (ORIGINAL_KEY !== undefined) {
      process.env.OPENAI_API_KEY = ORIGINAL_KEY;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  // Behavior 1: constructor throws OpenAIConfigError when OPENAI_API_KEY env var is missing
  it('B1: constructor throws OpenAIConfigError when OPENAI_API_KEY is missing', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => new EmbeddingsService()).toThrow(OpenAIConfigError);
  });

  // Behavior 1 (continued): error message contains helpful guidance
  it('B1b: OpenAIConfigError message contains guidance about setting the key', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => new EmbeddingsService()).toThrow(/OPENAI_API_KEY/);
  });

  // Behavior 2: constructor creates OpenAI client with timeout from getTimeoutConfig().openai.embeddingTimeoutMs
  it('B2: constructor creates OpenAI client with embeddingTimeoutMs and maxRetries', () => {
    new EmbeddingsService();
    expect(OpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-test-key-for-audit',
        timeout: 60000,
        maxRetries: 2,
      }),
    );
  });

  // Behavior 3: embedText returns number[] embedding vector for a single input string
  it('B3: embedText returns number[] embedding vector', async () => {
    mockEmbeddingsCreate.mockResolvedValueOnce({
      data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
    });
    const svc = new EmbeddingsService();
    const result = await svc.embedText('hello world');
    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
      model: 'text-embedding-3-large',
      input: 'hello world',
    });
  });

  // Behavior 4: embedText throws OpenAIAPIError on timeout with message referencing OPENAI_EMBEDDING_TIMEOUT_MS
  it('B4: embedText throws OpenAIAPIError on timeout', async () => {
    mockEmbeddingsCreate.mockRejectedValue({ code: 'ETIMEDOUT', message: 'timeout' });
    const svc = new EmbeddingsService();
    await expect(svc.embedText('test')).rejects.toThrow(OpenAIAPIError);
    await expect(svc.embedText('test')).rejects.toThrow(/OPENAI_EMBEDDING_TIMEOUT_MS/);
  });

  // Behavior 5: embedText throws OpenAIAPIError with statusCode=429 on rate limit
  it('B5: embedText throws OpenAIAPIError with statusCode=429 on rate limit', async () => {
    mockEmbeddingsCreate.mockRejectedValueOnce({ status: 429 });
    const svc = new EmbeddingsService();
    try {
      await svc.embedText('test');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(OpenAIAPIError);
      expect((err as InstanceType<typeof OpenAIAPIError>).statusCode).toBe(429);
    }
  });

  // Behavior 5b: embedText throws OpenAIAPIError with statusCode=401 on auth failure
  it('B5b: embedText throws OpenAIAPIError with statusCode=401 on auth failure', async () => {
    mockEmbeddingsCreate.mockRejectedValueOnce({ status: 401 });
    const svc = new EmbeddingsService();
    try {
      await svc.embedText('test');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(OpenAIAPIError);
      expect((err as InstanceType<typeof OpenAIAPIError>).statusCode).toBe(401);
    }
  });

  // Behavior 6: embedTextsInBatches processes items in chunks of EMBEDDING_BATCH_CONFIG.maxBatchSize (100)
  it('B6: embedTextsInBatches chunks by maxBatchSize=100', async () => {
    // Create 150 texts — should produce 2 batches (100 + 50)
    const texts = Array.from({ length: 150 }, (_, i) => `text-${i}`);
    mockEmbeddingsCreate.mockImplementation(async ({ input }: { input: string[] }) => ({
      data: input.map((_: string, i: number) => ({ embedding: [i], index: i })),
    }));
    const svc = new EmbeddingsService();
    const result = await svc.embedTextsInBatches(texts);
    expect(result).toHaveLength(150);
    // Should have been called twice: once with 100, once with 50
    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(2);
  });

  // Behavior 7: embedTextsInBatches delays between batches by delayBetweenBatchesMs (500ms)
  it('B7: embedTextsInBatches delays between batches', async () => {
    const texts = Array.from({ length: 150 }, (_, i) => `text-${i}`);
    const callTimes: number[] = [];
    mockEmbeddingsCreate.mockImplementation(async ({ input }: { input: string[] }) => {
      callTimes.push(Date.now());
      return { data: input.map((_: string, i: number) => ({ embedding: [i], index: i })) };
    });
    const svc = new EmbeddingsService();
    await svc.embedTextsInBatches(texts);
    expect(callTimes).toHaveLength(2);
    // The delay between batches should be >= 400ms (allowing some timing slack from 500ms)
    const delta = callTimes[1] - callTimes[0];
    expect(delta).toBeGreaterThanOrEqual(400);
  });

  // Behavior 8: EMBEDDING_BATCH_CONFIG has maxBatchSize=100 and delayBetweenBatchesMs=500
  it('B8: EMBEDDING_BATCH_CONFIG has correct values', () => {
    expect(EMBEDDING_BATCH_CONFIG.maxBatchSize).toBe(100);
    expect(EMBEDDING_BATCH_CONFIG.delayBetweenBatchesMs).toBe(500);
  });

  // Behavior 9: default model is 'text-embedding-3-large'
  it('B9: default model is text-embedding-3-large', async () => {
    mockEmbeddingsCreate.mockResolvedValueOnce({
      data: [{ embedding: [0.1], index: 0 }],
    });
    const svc = new EmbeddingsService();
    await svc.embedText('test');
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'text-embedding-3-large' }),
    );
  });

  // Behavior 9b: constructor accepts custom model string
  it('B9b: constructor accepts custom model string', async () => {
    mockEmbeddingsCreate.mockResolvedValueOnce({
      data: [{ embedding: [0.5], index: 0 }],
    });
    const svc = new EmbeddingsService('text-embedding-3-small');
    await svc.embedText('test');
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'text-embedding-3-small' }),
    );
  });

  // Behavior 10: OpenAI client maxRetries=2 for built-in transient retry
  it('B10: OpenAI client configured with maxRetries=2', () => {
    new EmbeddingsService();
    expect(OpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 2 }),
    );
  });
});
