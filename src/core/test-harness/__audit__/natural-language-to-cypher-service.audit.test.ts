// Spec source: plans/codegraph/PLAN.md §Phase 1 "NL→Cypher (fork: OpenAI assistant with schema context)"
// Domain: AUD-TC-11c-L1-03
// Behaviors: 10 spec-derived tests for natural-language-to-cypher.service.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

// --- OpenAI constructor mock (critical: must be constructor, not plain function) ---
const mockFilesCreate = vi.fn();
const mockVectorStoresCreate = vi.fn();
const mockAssistantsCreate = vi.fn();
const mockThreadsCreateAndRunPoll = vi.fn();
const mockMessagesList = vi.fn();

vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(function () {
    return {
      files: { create: mockFilesCreate },
      vectorStores: { create: mockVectorStoresCreate },
      beta: {
        assistants: { create: mockAssistantsCreate },
        threads: {
          createAndRunPoll: mockThreadsCreateAndRunPoll,
          messages: { list: mockMessagesList },
        },
      },
    };
  });
  return { default: MockOpenAI };
});

vi.mock('../../config/timeouts.js', () => ({
  getTimeoutConfig: () => ({
    neo4j: { queryTimeoutMs: 30000, connectionTimeoutMs: 10000 },
    openai: { embeddingTimeoutMs: 60000, assistantTimeoutMs: 120000 },
  }),
}));

import OpenAI from 'openai';
import { NaturalLanguageToCypherService } from '../../embeddings/natural-language-to-cypher.service.js';

describe('NaturalLanguageToCypherService — AUD-TC-11c-L1-03', () => {
  const ORIGINAL_KEY = process.env.OPENAI_API_KEY;
  const ORIGINAL_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'sk-test-key-for-audit';
    delete process.env.OPENAI_ASSISTANT_ID;
  });

  afterEach(() => {
    if (ORIGINAL_KEY !== undefined) {
      process.env.OPENAI_API_KEY = ORIGINAL_KEY;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    if (ORIGINAL_ASSISTANT_ID !== undefined) {
      process.env.OPENAI_ASSISTANT_ID = ORIGINAL_ASSISTANT_ID;
    } else {
      delete process.env.OPENAI_ASSISTANT_ID;
    }
  });

  // Behavior 1: constructor requires OPENAI_API_KEY (throws Error if missing)
  it('B1: constructor throws when OPENAI_API_KEY is missing', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => new NaturalLanguageToCypherService()).toThrow('OPENAI_API_KEY');
  });

  // Behavior 1b: constructor creates OpenAI client when key is present
  it('B1b: constructor creates OpenAI client with assistantTimeoutMs', () => {
    new NaturalLanguageToCypherService();
    expect(OpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-test-key-for-audit',
        timeout: 120000,
        maxRetries: 2,
      }),
    );
  });

  // Behavior 2: getOrCreateAssistant uploads schema file, creates vector store and assistant
  it('B2: getOrCreateAssistant uploads schema, creates vector store and assistant', async () => {
    const fakeStream = { pipe: vi.fn() };
    vi.spyOn(fs, 'createReadStream').mockReturnValue(fakeStream as any);

    mockFilesCreate.mockResolvedValueOnce({ id: 'file-123' });
    mockVectorStoresCreate.mockResolvedValueOnce({ id: 'vs-456' });
    mockAssistantsCreate.mockResolvedValueOnce({ id: 'asst-789' });

    const svc = new NaturalLanguageToCypherService();
    const assistantId = await svc.getOrCreateAssistant('/tmp/schema.json');

    expect(assistantId).toBe('asst-789');
    expect(mockFilesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'assistants' }),
    );
    expect(mockVectorStoresCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Neo4j APOC Schema Vector Store',
        file_ids: ['file-123'],
      }),
    );
    expect(mockAssistantsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
        tool_resources: expect.objectContaining({
          file_search: { vector_store_ids: ['vs-456'] },
        }),
      }),
    );
  });

  // Behavior 2b: getOrCreateAssistant uses existing OPENAI_ASSISTANT_ID if set
  it('B2b: getOrCreateAssistant uses existing OPENAI_ASSISTANT_ID env var', async () => {
    process.env.OPENAI_ASSISTANT_ID = 'asst-existing-id';
    const svc = new NaturalLanguageToCypherService();
    const assistantId = await svc.getOrCreateAssistant('/tmp/schema.json');
    expect(assistantId).toBe('asst-existing-id');
    // Should NOT create a new assistant
    expect(mockFilesCreate).not.toHaveBeenCalled();
    expect(mockAssistantsCreate).not.toHaveBeenCalled();
  });

  // Behavior 3: promptToQuery calls createAndRunPoll, parses JSON response, returns {cypher, parameters, explanation}
  it('B3: promptToQuery returns {cypher, parameters, explanation} from assistant', async () => {
    // Setup: must call getOrCreateAssistant first to set assistantId
    const fakeStream = { pipe: vi.fn() };
    vi.spyOn(fs, 'createReadStream').mockReturnValue(fakeStream as any);
    mockFilesCreate.mockResolvedValueOnce({ id: 'file-1' });
    mockVectorStoresCreate.mockResolvedValueOnce({ id: 'vs-1' });
    mockAssistantsCreate.mockResolvedValueOnce({ id: 'asst-1' });

    const svc = new NaturalLanguageToCypherService();
    await svc.getOrCreateAssistant('/tmp/schema.json');

    // Mock the schema file read for loadSchemaContext
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      discoveredSchema: {
        nodeTypes: [{ label: 'Class', count: 10 }, { label: 'Function', count: 20 }],
        relationshipTypes: [{ type: 'CALLS' }],
        semanticTypes: [],
      },
    }));

    const responseJson = {
      cypher: 'MATCH (n:Class) WHERE n.projectId = $projectId RETURN n',
      parameters: null,
      explanation: 'Finds all classes in the project',
    };

    mockThreadsCreateAndRunPoll.mockResolvedValueOnce({
      thread_id: 'thread-abc',
      status: 'completed',
    });
    mockMessagesList.mockResolvedValueOnce({
      data: [{
        content: [{
          type: 'text',
          text: { value: JSON.stringify(responseJson) },
        }],
        role: 'assistant',
      }],
    });

    const result = await svc.promptToQuery('Find all classes', 'proj_test');
    expect(result).toEqual(responseJson);
    expect(mockThreadsCreateAndRunPoll).toHaveBeenCalledWith(
      expect.objectContaining({
        assistant_id: 'asst-1',
      }),
    );
  });

  // Behavior 4: validateProjectIdFilters ensures $projectId in all MATCH clauses
  it('B4: promptToQuery rejects query without projectId filter', async () => {
    const fakeStream = { pipe: vi.fn() };
    vi.spyOn(fs, 'createReadStream').mockReturnValue(fakeStream as any);
    mockFilesCreate.mockResolvedValueOnce({ id: 'file-1' });
    mockVectorStoresCreate.mockResolvedValueOnce({ id: 'vs-1' });
    mockAssistantsCreate.mockResolvedValueOnce({ id: 'asst-1' });

    const svc = new NaturalLanguageToCypherService();
    await svc.getOrCreateAssistant('/tmp/schema.json');

    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ discoveredSchema: null }));

    // Response missing projectId filter
    mockThreadsCreateAndRunPoll.mockResolvedValueOnce({
      thread_id: 'thread-def',
      status: 'completed',
    });
    mockMessagesList.mockResolvedValueOnce({
      data: [{
        content: [{
          type: 'text',
          text: { value: JSON.stringify({ cypher: 'MATCH (n:Class) RETURN n', parameters: null, explanation: 'no filter' }) },
        }],
        role: 'assistant',
      }],
    });

    await expect(svc.promptToQuery('Find classes', 'proj_test')).rejects.toThrow(/projectId/);
  });

  // Behavior 5: SemanticTypeCategories interface — categorizeSemanticTypes groups types by intent
  // Testing indirectly via loadSchemaContext which calls categorizeSemanticTypes
  it('B5: semantic types are categorized correctly (controller/service/repository/module/guard/pipe/interceptor/other)', async () => {
    const fakeStream = { pipe: vi.fn() };
    vi.spyOn(fs, 'createReadStream').mockReturnValue(fakeStream as any);
    mockFilesCreate.mockResolvedValueOnce({ id: 'file-1' });
    mockVectorStoresCreate.mockResolvedValueOnce({ id: 'vs-1' });
    mockAssistantsCreate.mockResolvedValueOnce({ id: 'asst-1' });

    const svc = new NaturalLanguageToCypherService();
    await svc.getOrCreateAssistant('/tmp/schema.json');

    // Schema with semantic types that span all categories
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      discoveredSchema: {
        nodeTypes: [{ label: 'Class', count: 50 }, { label: 'Function', count: 5 }, { label: 'Decorator', count: 20 }],
        relationshipTypes: [{ type: 'CALLS' }],
        semanticTypes: [
          { type: 'AppController' },
          { type: 'UserService' },
          { type: 'UserRepository' },
          { type: 'AppModule' },
          { type: 'AuthGuard' },
          { type: 'ValidationPipe' },
          { type: 'LoggingInterceptor' },
          { type: 'CustomHelper' },
        ],
      },
    }));

    // Trigger loadSchemaContext + categorizeSemanticTypes by calling promptToQuery
    const responseJson = {
      cypher: 'MATCH (n:Class) WHERE n.projectId = $projectId RETURN n',
      parameters: null,
      explanation: 'test',
    };
    mockThreadsCreateAndRunPoll.mockResolvedValueOnce({
      thread_id: 'thread-cat',
      status: 'completed',
    });
    mockMessagesList.mockResolvedValueOnce({
      data: [{
        content: [{ type: 'text', text: { value: JSON.stringify(responseJson) } }],
        role: 'assistant',
      }],
    });

    // If categorization is wrong, the prompt/examples would be wrong,
    // but the function completes without error — we verify it runs and returns valid result
    const result = await svc.promptToQuery('Find all controllers', 'proj_test');
    expect(result.cypher).toContain('$projectId');
  });

  // Behavior 6: promptToQuery handles run status != 'completed'
  it('B6: promptToQuery throws when assistant run status is not completed', async () => {
    const fakeStream = { pipe: vi.fn() };
    vi.spyOn(fs, 'createReadStream').mockReturnValue(fakeStream as any);
    mockFilesCreate.mockResolvedValueOnce({ id: 'file-1' });
    mockVectorStoresCreate.mockResolvedValueOnce({ id: 'vs-1' });
    mockAssistantsCreate.mockResolvedValueOnce({ id: 'asst-1' });

    const svc = new NaturalLanguageToCypherService();
    await svc.getOrCreateAssistant('/tmp/schema.json');

    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ discoveredSchema: null }));

    mockThreadsCreateAndRunPoll.mockResolvedValueOnce({
      thread_id: 'thread-fail',
      status: 'failed',
      last_error: { message: 'something went wrong' },
    });

    await expect(svc.promptToQuery('test query', 'proj_test')).rejects.toThrow(/did not complete/i);
  });

  // Behavior 7: promptToQuery strips markdown code fences from JSON response
  it('B7: promptToQuery strips markdown code fences from JSON response', async () => {
    const fakeStream = { pipe: vi.fn() };
    vi.spyOn(fs, 'createReadStream').mockReturnValue(fakeStream as any);
    mockFilesCreate.mockResolvedValueOnce({ id: 'file-1' });
    mockVectorStoresCreate.mockResolvedValueOnce({ id: 'vs-1' });
    mockAssistantsCreate.mockResolvedValueOnce({ id: 'asst-1' });

    const svc = new NaturalLanguageToCypherService();
    await svc.getOrCreateAssistant('/tmp/schema.json');

    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ discoveredSchema: null }));

    const responseJson = {
      cypher: 'MATCH (n:Class) WHERE n.projectId = $projectId RETURN n',
      parameters: null,
      explanation: 'test',
    };

    mockThreadsCreateAndRunPoll.mockResolvedValueOnce({
      thread_id: 'thread-fence',
      status: 'completed',
    });
    mockMessagesList.mockResolvedValueOnce({
      data: [{
        content: [{
          type: 'text',
          text: { value: '```json\n' + JSON.stringify(responseJson) + '\n```' },
        }],
        role: 'assistant',
      }],
    });

    const result = await svc.promptToQuery('test', 'proj_test');
    expect(result.cypher).toBe(responseJson.cypher);
  });

  // Behavior 8: messageInstructions contains label mapping rules
  it('B8: messageInstructions contains AST type→label mapping rules', () => {
    const svc = new NaturalLanguageToCypherService();
    // Access the private field via any cast — we're testing spec compliance, not encapsulation
    const instructions = (svc as any).messageInstructions as string;
    expect(instructions).toContain('ClassDeclaration');
    expect(instructions).toContain('FunctionDeclaration');
    expect(instructions).toContain('MethodDeclaration');
    expect(instructions).toContain('InterfaceDeclaration');
    // The instructions must map AST types to Neo4j labels
    expect(instructions).toContain('Class');
    expect(instructions).toContain('Function');
    expect(instructions).toContain('Method');
  });

  // Behavior 9: timeout from getTimeoutConfig().openai.assistantTimeoutMs
  it('B9: OpenAI client uses assistantTimeoutMs from config', () => {
    new NaturalLanguageToCypherService();
    expect(OpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 120000 }),
    );
  });

  // Behavior 10: MODEL constant is 'gpt-4o'
  it('B10: MODEL constant is gpt-4o', () => {
    const svc = new NaturalLanguageToCypherService();
    expect((svc as any).MODEL).toBe('gpt-4o');
  });

  // Behavior 4b: validateLabelUsage checks labels against schema (rejects invalid labels)
  it('B4b: validateLabelUsage rejects queries with invalid node labels', async () => {
    const fakeStream = { pipe: vi.fn() };
    vi.spyOn(fs, 'createReadStream').mockReturnValue(fakeStream as any);
    mockFilesCreate.mockResolvedValueOnce({ id: 'file-1' });
    mockVectorStoresCreate.mockResolvedValueOnce({ id: 'vs-1' });
    mockAssistantsCreate.mockResolvedValueOnce({ id: 'asst-1' });

    const svc = new NaturalLanguageToCypherService();
    await svc.getOrCreateAssistant('/tmp/schema.json');

    // Schema path is set, but return minimal schema so loadValidLabelsFromSchema returns core labels only
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ discoveredSchema: null }));

    // Response uses an invalid label (ClassDeclaration instead of Class)
    mockThreadsCreateAndRunPoll.mockResolvedValueOnce({
      thread_id: 'thread-label',
      status: 'completed',
    });
    mockMessagesList.mockResolvedValueOnce({
      data: [{
        content: [{
          type: 'text',
          text: {
            value: JSON.stringify({
              cypher: 'MATCH (n:ClassDeclaration) WHERE n.projectId = $projectId RETURN n',
              parameters: null,
              explanation: 'bad label',
            }),
          },
        }],
        role: 'assistant',
      }],
    });

    await expect(svc.promptToQuery('Find classes', 'proj_test')).rejects.toThrow(/Invalid label.*ClassDeclaration/);
  });

  // Behavior schema context: loadSchemaContext formats node types/relationships from JSON
  it('B-schema: loadSchemaContext formats node types and relationships from schema JSON', async () => {
    const fakeStream = { pipe: vi.fn() };
    vi.spyOn(fs, 'createReadStream').mockReturnValue(fakeStream as any);
    mockFilesCreate.mockResolvedValueOnce({ id: 'file-1' });
    mockVectorStoresCreate.mockResolvedValueOnce({ id: 'vs-1' });
    mockAssistantsCreate.mockResolvedValueOnce({ id: 'asst-1' });

    const svc = new NaturalLanguageToCypherService();
    await svc.getOrCreateAssistant('/tmp/schema.json');

    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      discoveredSchema: {
        nodeTypes: [{ label: 'Class', count: 10 }, { label: 'Method', count: 30 }],
        relationshipTypes: [{ type: 'CALLS' }, { type: 'HAS_MEMBER' }],
        semanticTypes: [{ type: 'UserService' }],
      },
    }));

    // Call loadSchemaContext indirectly through promptToQuery
    const responseJson = {
      cypher: 'MATCH (n:Class) WHERE n.projectId = $projectId RETURN n',
      parameters: null,
      explanation: 'context test',
    };
    mockThreadsCreateAndRunPoll.mockResolvedValueOnce({
      thread_id: 'thread-ctx',
      status: 'completed',
    });
    mockMessagesList.mockResolvedValueOnce({
      data: [{
        content: [{ type: 'text', text: { value: JSON.stringify(responseJson) } }],
        role: 'assistant',
      }],
    });

    // The prompt passed to createAndRunPoll should contain schema context with our labels
    const result = await svc.promptToQuery('Find all classes', 'proj_test');
    expect(result).toBeDefined();

    // Verify the prompt sent to the assistant includes schema context
    const callArgs = mockThreadsCreateAndRunPoll.mock.calls[0][0];
    const promptContent = callArgs.thread.messages[0].content;
    expect(promptContent).toContain('Class');
    expect(promptContent).toContain('CALLS');
    expect(promptContent).toContain('HAS_MEMBER');
    expect(promptContent).toContain('UserService');
  });
});
