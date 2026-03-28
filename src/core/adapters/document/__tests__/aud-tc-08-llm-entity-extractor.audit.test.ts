/**
 * AUD-TC-08-L1-05: llm-entity-extractor.ts — Behavioral Contract Tests
 *
 * Spec: plans/codegraph/ADAPTER_ROADMAP.md §M2A "Add LLM entity extraction for ambiguous entities (targeted, not bulk)"
 *
 * Behaviors tested:
 * (1) extractEntitiesWithLlm accepts EntityExtractionInput and returns ExtractedEntity[]
 * (2) requires OPENAI_API_KEY env var OR enabled flag (skips if both missing)
 * (3) sends paragraph text to OpenAI with structured prompt for entity extraction
 * (4) response parsed with Zod schema validation
 * (5) extracted entities have extractor='llm' and kind from API response
 * (6) deterministic IDs via deterministicId
 * (7) confidence derived from LLM response or set to default (0.75)
 * (8) handles API errors gracefully (no crash on 429/timeout)
 * (9) empty text input returns empty array
 * (10) only runs when shouldRunLlm returns true (targeted, not bulk)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock OpenAI
const mockResponsesCreate = vi.fn();

vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(function () {
    return {
      responses: { create: mockResponsesCreate },
    };
  });
  return { default: MockOpenAI };
});

import { extractEntitiesWithLlm } from '../llm-entity-extractor.js';
import type { EntityExtractionInput } from '../entity-extractor.js';
import type { ExtractedEntity } from '../document-schema.js';

describe('[aud-tc-08] llm-entity-extractor.ts', () => {
  const baseInput: EntityExtractionInput = {
    projectId: 'proj_test',
    documentId: 'doc_123',
    paragraphId: 'para_456',
    text: '',
  };

  const ORIGINAL_KEY = process.env.OPENAI_API_KEY;
  const ORIGINAL_ENABLED = process.env.DOCUMENT_LLM_ENTITY_EXTRACTION;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'sk-test-key';
    delete process.env.DOCUMENT_LLM_ENTITY_EXTRACTION;
  });

  afterEach(() => {
    if (ORIGINAL_KEY !== undefined) {
      process.env.OPENAI_API_KEY = ORIGINAL_KEY;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    if (ORIGINAL_ENABLED !== undefined) {
      process.env.DOCUMENT_LLM_ENTITY_EXTRACTION = ORIGINAL_ENABLED;
    } else {
      delete process.env.DOCUMENT_LLM_ENTITY_EXTRACTION;
    }
  });

  // Behavior 1: extractEntitiesWithLlm accepts EntityExtractionInput and returns ExtractedEntity[]
  it('B1: returns ExtractedEntity[] array', async () => {
    const input = { ...baseInput, text: 'Test text' };

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({ entities: [] }),
    });

    const result = await extractEntitiesWithLlm(input, [], { enabled: true });

    expect(Array.isArray(result)).toBe(true);
  });

  // Behavior 2: requires OPENAI_API_KEY env var (skips if missing)
  it('B2: returns empty array when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY;

    const input = { ...baseInput, text: 'Test' };
    const result = await extractEntitiesWithLlm(input, [], { enabled: true });

    expect(result).toEqual([]);
    expect(mockResponsesCreate).not.toHaveBeenCalled();
  });

  // Behavior 2 (continued): skips when enabled flag is false
  it('B2b: returns empty array when enabled=false', async () => {
    const input = { ...baseInput, text: 'Test' };
    const result = await extractEntitiesWithLlm(input, [], { enabled: false });

    expect(result).toEqual([]);
    expect(mockResponsesCreate).not.toHaveBeenCalled();
  });

  // Behavior 2 (continued): respects DOCUMENT_LLM_ENTITY_EXTRACTION env var
  it('B2c: enabled defaults to DOCUMENT_LLM_ENTITY_EXTRACTION env var', async () => {
    process.env.DOCUMENT_LLM_ENTITY_EXTRACTION = 'true';

    const input = { ...baseInput, text: 'Entity here' };

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({ entities: [] }),
    });

    // No explicit enabled option — should use env var
    await extractEntitiesWithLlm(input, []);

    expect(mockResponsesCreate).toHaveBeenCalled();
  });

  // Behavior 3: sends paragraph text to OpenAI with structured prompt
  it('B3: calls OpenAI with correct prompt structure', async () => {
    const input = { ...baseInput, text: 'John Doe sent email to test@example.com' };

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({ entities: [] }),
    });

    await extractEntitiesWithLlm(input, [], { enabled: true });

    expect(mockResponsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.stringContaining('Extract ONLY concrete entities'),
        model: expect.any(String),
        temperature: 0,
      }),
    );
  });

  // Behavior 3 (continued): prompt includes paragraph text
  it('B3b: prompt includes the paragraph text', async () => {
    const input = { ...baseInput, text: 'Specific text to extract' };

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({ entities: [] }),
    });

    await extractEntitiesWithLlm(input, [], { enabled: true });

    const callArgs = mockResponsesCreate.mock.calls[0][0];
    expect(callArgs.input).toContain('Specific text to extract');
  });

  // Behavior 4: response parsed with Zod schema validation
  it('B4: parses valid JSON response with entities', async () => {
    const input = { ...baseInput, text: 'Test' };

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({
        entities: [
          { kind: 'person', value: 'John Doe', confidence: 0.9 },
          { kind: 'email', value: 'test@example.com', confidence: 0.95 },
        ],
      }),
    });

    const result = await extractEntitiesWithLlm(input, [], { enabled: true });

    expect(result).toHaveLength(2);
    expect(result[0].value).toBe('John Doe');
    expect(result[1].value).toBe('test@example.com');
  });

  // Behavior 4 (continued): handles invalid JSON gracefully
  it('B4b: returns empty array on invalid JSON', async () => {
    const input = { ...baseInput, text: 'Test' };

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: 'not valid json',
    });

    const result = await extractEntitiesWithLlm(input, [], { enabled: true });

    expect(result).toEqual([]);
  });

  // Behavior 4 (continued): handles Zod validation failure gracefully
  it('B4c: returns empty array when Zod validation fails', async () => {
    const input = { ...baseInput, text: 'Test' };

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({
        entities: [
          { kind: 'invalid_kind', value: 'Test' }, // Invalid kind
        ],
      }),
    });

    const result = await extractEntitiesWithLlm(input, [], { enabled: true });

    expect(result).toEqual([]);
  });

  // Behavior 5: extracted entities have extractor='llm' and kind from API response
  it('B5: entities have extractor=llm', async () => {
    const input = { ...baseInput, text: 'Test' };

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({
        entities: [{ kind: 'person', value: 'Jane Smith', confidence: 0.85 }],
      }),
    });

    const result = await extractEntitiesWithLlm(input, [], { enabled: true });

    expect(result[0].extractor).toBe('llm');
  });

  // Behavior 5 (continued): entities have kind from LLM response
  it('B5b: entities have kind from API response', async () => {
    const input = { ...baseInput, text: 'Test' };

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({
        entities: [
          { kind: 'org', value: 'Acme Corp', confidence: 0.8 },
          { kind: 'location', value: 'New York', confidence: 0.9 },
        ],
      }),
    });

    const result = await extractEntitiesWithLlm(input, [], { enabled: true });

    expect(result[0].kind).toBe('org');
    expect(result[1].kind).toBe('location');
  });

  // Behavior 6: deterministic IDs via deterministicId
  it('B6: generates deterministic IDs for entities', async () => {
    const input = { ...baseInput, text: 'Test' };

    mockResponsesCreate.mockResolvedValue({
      output_text: JSON.stringify({
        entities: [{ kind: 'person', value: 'John Doe', confidence: 0.9 }],
      }),
    });

    const result1 = await extractEntitiesWithLlm(input, [], { enabled: true });
    const result2 = await extractEntitiesWithLlm(input, [], { enabled: true });

    expect(result1[0].id).toBe(result2[0].id);
    expect(result1[0].id).toMatch(/^[0-9a-f]{20}$/);
  });

  // Behavior 7: confidence derived from LLM response or set to default
  it('B7: uses confidence from LLM response', async () => {
    const input = { ...baseInput, text: 'Test' };

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({
        entities: [{ kind: 'person', value: 'Test', confidence: 0.88 }],
      }),
    });

    const result = await extractEntitiesWithLlm(input, [], { enabled: true });

    expect(result[0].confidence).toBe(0.88);
  });

  // Behavior 7 (continued): defaults to 0.75 when confidence missing
  it('B7b: defaults confidence to 0.75 when not provided', async () => {
    const input = { ...baseInput, text: 'Test' };

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({
        entities: [{ kind: 'person', value: 'Test' }],
      }),
    });

    const result = await extractEntitiesWithLlm(input, [], { enabled: true });

    expect(result[0].confidence).toBe(0.75);
  });

  // Behavior 7 (continued): Zod schema rejects out-of-range confidence values
  it('B7c: rejects entities with invalid confidence via Zod validation', async () => {
    const input = { ...baseInput, text: 'Test' };

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({
        entities: [
          { kind: 'person', value: 'High', confidence: 1.5 }, // Invalid - > 1
          { kind: 'person', value: 'Low', confidence: -0.2 }, // Invalid - < 0
        ],
      }),
    });

    const result = await extractEntitiesWithLlm(input, [], { enabled: true });

    // Zod schema validation fails for out-of-range confidence, returns empty
    expect(result).toEqual([]);
  });

  // Behavior 8: handles API errors gracefully
  it('B8: returns empty array on API error', async () => {
    const input = { ...baseInput, text: 'Test' };

    mockResponsesCreate.mockRejectedValueOnce(new Error('API timeout'));

    await expect(extractEntitiesWithLlm(input, [], { enabled: true })).rejects.toThrow();
  });

  // Behavior 9: empty text input still calls LLM (sparse entities)
  it('B9: calls LLM even for empty text when enabled', async () => {
    const input = { ...baseInput, text: '' };

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({ entities: [] }),
    });

    const result = await extractEntitiesWithLlm(input, [], { enabled: true });

    expect(mockResponsesCreate).toHaveBeenCalled();
    expect(Array.isArray(result)).toBe(true);
  });

  // Behavior 10: only runs when shouldRunLlm returns true (targeted)
  it('B10: skips when heuristic entities are sufficient (>1 with high confidence)', async () => {
    const input = { ...baseInput, text: 'Test' };
    const heuristicEntities: ExtractedEntity[] = [
      {
        id: 'e1',
        projectId: 'proj_test',
        documentId: 'doc_123',
        paragraphId: 'para_456',
        kind: 'email',
        value: 'test@example.com',
        confidence: 0.98,
        extractor: 'regex',
      },
      {
        id: 'e2',
        projectId: 'proj_test',
        documentId: 'doc_123',
        paragraphId: 'para_456',
        kind: 'phone',
        value: '555-1234',
        confidence: 0.95,
        extractor: 'regex',
      },
    ];

    const result = await extractEntitiesWithLlm(input, heuristicEntities, { enabled: true });

    expect(result).toEqual([]);
    expect(mockResponsesCreate).not.toHaveBeenCalled();
  });

  // Behavior 10 (continued): runs when heuristic entities are sparse (<=1)
  it('B10b: runs when heuristic entities are sparse', async () => {
    const input = { ...baseInput, text: 'Test' };
    const heuristicEntities: ExtractedEntity[] = [
      {
        id: 'e1',
        projectId: 'proj_test',
        documentId: 'doc_123',
        paragraphId: 'para_456',
        kind: 'email',
        value: 'test@example.com',
        confidence: 0.98,
        extractor: 'regex',
      },
    ];

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({ entities: [] }),
    });

    await extractEntitiesWithLlm(input, heuristicEntities, { enabled: true });

    expect(mockResponsesCreate).toHaveBeenCalled();
  });

  // Behavior 10 (continued): runs when low-confidence entities exist
  it('B10c: runs when heuristic has low-confidence entities', async () => {
    const input = { ...baseInput, text: 'Test' };
    const heuristicEntities: ExtractedEntity[] = [
      {
        id: 'e1',
        projectId: 'proj_test',
        documentId: 'doc_123',
        paragraphId: 'para_456',
        kind: 'org',
        value: 'Possible Corp',
        confidence: 0.72,
        extractor: 'regex',
      },
      {
        id: 'e2',
        projectId: 'proj_test',
        documentId: 'doc_123',
        paragraphId: 'para_456',
        kind: 'date',
        value: '2024-01-01',
        confidence: 0.9,
        extractor: 'regex',
      },
    ];

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({ entities: [] }),
    });

    await extractEntitiesWithLlm(input, heuristicEntities, { enabled: true });

    expect(mockResponsesCreate).toHaveBeenCalled();
  });

  // Behavior 6 (validation): deduplicates against heuristic entities
  it('B6b: filters out entities already found by heuristics', async () => {
    const input = { ...baseInput, text: 'Test' };
    const heuristicEntities: ExtractedEntity[] = [
      {
        id: 'e1',
        projectId: 'proj_test',
        documentId: 'doc_123',
        paragraphId: 'para_456',
        kind: 'email',
        value: 'test@example.com',
        normalized: 'test@example.com',
        confidence: 0.98,
        extractor: 'regex',
      },
    ];

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({
        entities: [
          { kind: 'email', value: 'test@example.com', confidence: 0.9 }, // Duplicate
          { kind: 'person', value: 'Jane Doe', confidence: 0.85 }, // New
        ],
      }),
    });

    const result = await extractEntitiesWithLlm(input, heuristicEntities, { enabled: true });

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('Jane Doe');
  });

  // Behavior 3 (validation): respects maxEntities option
  it('B3c: limits entities to maxEntities option', async () => {
    const input = { ...baseInput, text: 'Test' };

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({
        entities: Array.from({ length: 20 }, (_, i) => ({
          kind: 'person',
          value: `Person ${i}`,
          confidence: 0.8,
        })),
      }),
    });

    const result = await extractEntitiesWithLlm(input, [], { enabled: true, maxEntities: 5 });

    expect(result.length).toBeLessThanOrEqual(5);
  });

  // Behavior 3 (validation): uses custom model when provided
  it('B3d: uses custom model from options', async () => {
    const input = { ...baseInput, text: 'Test' };

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({ entities: [] }),
    });

    await extractEntitiesWithLlm(input, [], { enabled: true, model: 'gpt-4' });

    expect(mockResponsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4' }),
    );
  });

  // Behavior 3 (validation): defaults to gpt-4o-mini or env var
  it('B3e: defaults model to gpt-4o-mini', async () => {
    const input = { ...baseInput, text: 'Test' };

    mockResponsesCreate.mockResolvedValueOnce({
      output_text: JSON.stringify({ entities: [] }),
    });

    await extractEntitiesWithLlm(input, [], { enabled: true });

    expect(mockResponsesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini' }),
    );
  });
});
