/**
 * AUD-TC-07-L1-04: grammy-framework-schema.ts behavioral audit tests
 *
 * Spec sources:
 *  - plans/codegraph/PLAN.md §Phase 1 "Grammy framework schema creates CommandHandler/EventListener/CallbackQueryHandler"
 *  - plans/codegraph/PLAN.md §registrations in .codegraph.yml Specification
 *  - plans/codegraph/PLAN.md §Entrypoint node type
 *  - AUD-TC-07.md behaviors (1)-(6)
 *
 * Accept criteria: 6+ behavioral assertions, all green.
 */
import { describe, it, expect } from 'vitest';
import {
  GRAMMY_REGISTRATIONS,
  GRAMMY_REGISTRATION_MAP,
  GRAMMY_FRAMEWORK_SCHEMA,
  detectSessionAccess,
} from '../../config/grammy-framework-schema.js';
import { CoreNodeType, SemanticNodeType } from '../../config/schema.js';

// ============================================================================
// (1) GRAMMY_REGISTRATIONS — 5 entries with correct shape
// ============================================================================
describe('GRAMMY_REGISTRATIONS — 5 entries', () => {
  it('has exactly 5 registration entries', () => {
    expect(GRAMMY_REGISTRATIONS.length).toBe(5);
  });

  it('covers bot.command, bot.on, bot.callbackQuery, bot.hears, bot.use', () => {
    const callees = GRAMMY_REGISTRATIONS.map(r => r.callee);
    expect(callees).toContain('bot.command');
    expect(callees).toContain('bot.on');
    expect(callees).toContain('bot.callbackQuery');
    expect(callees).toContain('bot.hears');
    expect(callees).toContain('bot.use');
  });

  it('each entry has callee, callbackArg, triggerArg, and kind', () => {
    for (const reg of GRAMMY_REGISTRATIONS) {
      expect(typeof reg.callee).toBe('string');
      expect(typeof reg.callbackArg).toBe('number');
      expect(typeof reg.triggerArg).toBe('number');
      expect(typeof reg.kind).toBe('string');
    }
  });

  it('bot.command has callbackArg=1 and triggerArg=0 and kind=command', () => {
    const cmd = GRAMMY_REGISTRATIONS.find(r => r.callee === 'bot.command');
    expect(cmd).toBeDefined();
    expect(cmd!.callbackArg).toBe(1);
    expect(cmd!.triggerArg).toBe(0);
    expect(cmd!.kind).toBe('command');
  });

  it('bot.use has callbackArg=0 and triggerArg=-1 (no trigger) and kind=middleware', () => {
    const use = GRAMMY_REGISTRATIONS.find(r => r.callee === 'bot.use');
    expect(use).toBeDefined();
    expect(use!.callbackArg).toBe(0);
    expect(use!.triggerArg).toBe(-1);
    expect(use!.kind).toBe('middleware');
  });
});

// ============================================================================
// (2) GRAMMY_REGISTRATION_MAP — maps callee strings to registration configs
// ============================================================================
describe('GRAMMY_REGISTRATION_MAP — callee lookup', () => {
  it('is a Map with 5 entries matching GRAMMY_REGISTRATIONS', () => {
    expect(GRAMMY_REGISTRATION_MAP).toBeInstanceOf(Map);
    expect(GRAMMY_REGISTRATION_MAP.size).toBe(5);
  });

  it('can look up bot.command and returns correct config', () => {
    const config = GRAMMY_REGISTRATION_MAP.get('bot.command');
    expect(config).toBeDefined();
    expect(config!.kind).toBe('command');
    expect(config!.callbackArg).toBe(1);
  });

  it('can look up bot.callbackQuery with kind=callback', () => {
    const config = GRAMMY_REGISTRATION_MAP.get('bot.callbackQuery');
    expect(config).toBeDefined();
    expect(config!.kind).toBe('callback');
  });

  it('returns undefined for unknown callee (no false positives)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(GRAMMY_REGISTRATION_MAP.get('bot.unknown' as any)).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(GRAMMY_REGISTRATION_MAP.get('command' as any)).toBeUndefined();
  });
});

// ============================================================================
// (3) GRAMMY_FRAMEWORK_SCHEMA — conforms to FrameworkSchema interface
// ============================================================================
describe('GRAMMY_FRAMEWORK_SCHEMA — FrameworkSchema interface conformance', () => {
  it('has required FrameworkSchema fields: name, version, description, enhances, enhancements, edgeEnhancements, contextExtractors, metadata', () => {
    expect(typeof GRAMMY_FRAMEWORK_SCHEMA.name).toBe('string');
    expect(typeof GRAMMY_FRAMEWORK_SCHEMA.version).toBe('string');
    expect(typeof GRAMMY_FRAMEWORK_SCHEMA.description).toBe('string');
    expect(Array.isArray(GRAMMY_FRAMEWORK_SCHEMA.enhances)).toBe(true);
    expect(typeof GRAMMY_FRAMEWORK_SCHEMA.enhancements).toBe('object');
    expect(typeof GRAMMY_FRAMEWORK_SCHEMA.edgeEnhancements).toBe('object');
    expect(Array.isArray(GRAMMY_FRAMEWORK_SCHEMA.contextExtractors)).toBe(true);
    expect(typeof GRAMMY_FRAMEWORK_SCHEMA.metadata).toBe('object');
  });

  it('enhances only FUNCTION_DECLARATION (Grammy uses function-level enrichment)', () => {
    expect(GRAMMY_FRAMEWORK_SCHEMA.enhances).toHaveLength(1);
    expect(GRAMMY_FRAMEWORK_SCHEMA.enhances).toContain(CoreNodeType.FUNCTION_DECLARATION);
  });

  it('metadata.targetLanguages includes typescript', () => {
    expect(GRAMMY_FRAMEWORK_SCHEMA.metadata.targetLanguages).toContain('typescript');
  });

  it('metadata.dependencies includes grammy package', () => {
    expect(GRAMMY_FRAMEWORK_SCHEMA.metadata.dependencies).toContain('grammy');
  });
});

// ============================================================================
// (4) Node enhancements — 6 Grammy-specific semantic types
// ============================================================================
describe('Grammy node enhancements — semantic type coverage', () => {
  const enhancements = GRAMMY_FRAMEWORK_SCHEMA.enhancements;

  it('has an enhancement for BotFactory (creates BotFactory semantic overlay)', () => {
    const botFactory = Object.values(enhancements).find(
      e => e.semanticType === SemanticNodeType.BOT_FACTORY
    );
    expect(botFactory).toBeDefined();
    expect(botFactory!.neo4j.additionalLabels).toContain('BotFactory');
  });

  it('has an enhancement for CommandHandler', () => {
    const cmdHandler = Object.values(enhancements).find(
      e => e.semanticType === SemanticNodeType.COMMAND_HANDLER
    );
    expect(cmdHandler).toBeDefined();
    expect(cmdHandler!.neo4j.additionalLabels).toContain('CommandHandler');
  });

  it('has an enhancement for EventHandler', () => {
    const eventHandler = Object.values(enhancements).find(
      e => e.semanticType === SemanticNodeType.EVENT_HANDLER
    );
    expect(eventHandler).toBeDefined();
  });

  it('has an enhancement for CallbackQueryHandler', () => {
    const cbHandler = Object.values(enhancements).find(
      e => e.semanticType === SemanticNodeType.CALLBACK_QUERY_HANDLER
    );
    expect(cbHandler).toBeDefined();
    expect(cbHandler!.neo4j.additionalLabels).toContain('CallbackQueryHandler');
  });

  it('has an enhancement for HearsHandler', () => {
    const hearsHandler = Object.values(enhancements).find(
      e => e.semanticType === SemanticNodeType.HEARS_HANDLER
    );
    expect(hearsHandler).toBeDefined();
  });

  it('has an enhancement for Middleware', () => {
    const middleware = Object.values(enhancements).find(
      e => e.semanticType === SemanticNodeType.MIDDLEWARE
    );
    expect(middleware).toBeDefined();
  });

  it('has exactly 6 node enhancements (one per Grammy semantic type)', () => {
    expect(Object.keys(enhancements).length).toBe(6);
  });
});

// ============================================================================
// (5) Edge enhancements — REGISTERED_BY handled by parser (schema delegates to parser)
// ============================================================================
describe('Grammy edge enhancements — parser delegation', () => {
  it('edgeEnhancements is empty because REGISTERED_BY edges are emitted directly by parser', () => {
    // Per spec: "REGISTERED_BY edges are created directly by the parser during callback extraction.
    // No edge enhancement needed — avoids O(n²) false-positive matching."
    expect(Object.keys(GRAMMY_FRAMEWORK_SCHEMA.edgeEnhancements).length).toBe(0);
  });

  it('handler enhancements include REGISTERED_BY in additionalRelationships to declare intent', () => {
    const cmdHandler = Object.values(GRAMMY_FRAMEWORK_SCHEMA.enhancements).find(
      e => e.semanticType === SemanticNodeType.COMMAND_HANDLER
    );
    expect(cmdHandler!.additionalRelationships).toContain('REGISTERED_BY');
  });
});

// ============================================================================
// (6) Detection patterns — priority ordering (function pattern gets highest priority for handlers)
// ============================================================================
describe('Grammy detection patterns — priority ordering', () => {
  it('CommandHandler detection pattern has highest priority (10) — exact registration kind match', () => {
    const cmdHandler = Object.values(GRAMMY_FRAMEWORK_SCHEMA.enhancements).find(
      e => e.semanticType === SemanticNodeType.COMMAND_HANDLER
    );
    const pattern = cmdHandler!.detectionPatterns[0];
    expect(pattern.type).toBe('function');
    expect(pattern.priority).toBe(10);
    expect(pattern.confidence).toBe(1.0);
  });

  it('BotFactory detection uses function pattern to avoid false positives from simple filename matching', () => {
    const botFactory = Object.values(GRAMMY_FRAMEWORK_SCHEMA.enhancements).find(
      e => e.semanticType === SemanticNodeType.BOT_FACTORY
    );
    const pattern = botFactory!.detectionPatterns[0];
    expect(pattern.type).toBe('function');
  });

  it('CommandHandler detection pattern correctly identifies nodes with registrationKind=command', () => {
    const cmdHandler = Object.values(GRAMMY_FRAMEWORK_SCHEMA.enhancements).find(
      e => e.semanticType === SemanticNodeType.COMMAND_HANDLER
    );
    const pattern = cmdHandler!.detectionPatterns[0];
    // Test the function pattern with a mock ParsedNode
    const mockCommandNode = {
      id: 'test-1',
      coreType: CoreNodeType.FUNCTION_DECLARATION,
      labels: [],
      properties: {
        id: 'test-1',
        projectId: 'proj',
        name: 'handleStart',
        coreType: CoreNodeType.FUNCTION_DECLARATION,
        filePath: 'bot.ts',
        startLine: 1,
        endLine: 10,
        sourceCode: '',
        createdAt: new Date().toISOString(),
        context: { registrationKind: 'command', registrationTrigger: '/start' },
      },
    } as any;
    expect(typeof pattern.pattern).toBe('function');
    expect((pattern.pattern as Function)(mockCommandNode)).toBe(true);
  });

  it('CommandHandler detection pattern does NOT match nodes with wrong registrationKind', () => {
    const cmdHandler = Object.values(GRAMMY_FRAMEWORK_SCHEMA.enhancements).find(
      e => e.semanticType === SemanticNodeType.COMMAND_HANDLER
    );
    const pattern = cmdHandler!.detectionPatterns[0];
    const mockEventNode = {
      id: 'test-2',
      coreType: CoreNodeType.FUNCTION_DECLARATION,
      labels: [],
      properties: {
        id: 'test-2',
        projectId: 'proj',
        name: 'handleMessage',
        coreType: CoreNodeType.FUNCTION_DECLARATION,
        filePath: 'bot.ts',
        startLine: 10,
        endLine: 20,
        sourceCode: '',
        createdAt: new Date().toISOString(),
        context: { registrationKind: 'event' },  // NOT command
      },
    } as any;
    expect((pattern.pattern as Function)(mockEventNode)).toBe(false);
  });
});

// ============================================================================
// Additional: detectSessionAccess behavior
// ============================================================================
describe('detectSessionAccess — read/write discrimination', () => {
  it('detects ctx.session.field write patterns', () => {
    const code = `ctx.session.step = 'buy_amount';`;
    const result = detectSessionAccess(code);
    expect(result.writes).toContain('step');
  });

  it('detects ctx.session.field read patterns', () => {
    const code = `const step = ctx.session.step;`;
    const result = detectSessionAccess(code);
    expect(result.reads).toContain('step');
  });

  it('returns empty arrays for code with no session access', () => {
    const code = `const x = 1 + 2;`;
    const result = detectSessionAccess(code);
    expect(result.reads).toHaveLength(0);
    expect(result.writes).toHaveLength(0);
  });

  it('handles multiple session fields', () => {
    const code = `
      ctx.session.step = 'start';
      const val = ctx.session.amount;
      ctx.session.cart = [];
    `;
    const result = detectSessionAccess(code);
    expect(result.writes.length).toBeGreaterThanOrEqual(1);
    expect(result.reads.length).toBeGreaterThanOrEqual(1);
  });
});
