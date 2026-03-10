/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Grammy Bot Framework Schema
 * 
 * Detects Grammy/grammY bot registration patterns:
 *   bot.command('start', async ctx => { ... })
 *   bot.on(':message', async ctx => { ... })
 *   bot.callbackQuery(/^buy:/, async ctx => { ... })
 *   bot.hears(/pattern/, async ctx => { ... })
 * 
 * Creates:
 *   - Entrypoint nodes (command:/start, event::message, callback:buy:*)
 *   - Function nodes for callback handlers (with registration properties)
 *   - REGISTERED_BY edges (handler → entrypoint)
 *   - READS_STATE / WRITES_STATE edges for ctx.session.* access
 * 
 * Architecture: This extends the core parser via CallbackRegistration patterns.
 * The framework schema only handles semantic enrichment of nodes that the parser
 * creates. The actual node emission happens in the parser's extractCallbackHandlers().
 */

import {
  CoreNodeType,
  FrameworkSchema,
  ParsedNode,
  SemanticNodeType,
} from './schema.js';

// ============================================================================
// GRAMMY CONSTANTS
// ============================================================================

/**
 * Grammy registration methods that take a callback handler.
 * Format: { callee, callbackArgIndex, triggerArgIndex, entrypointKind }
 */
export const GRAMMY_REGISTRATIONS = [
  { callee: 'bot.command', callbackArg: 1, triggerArg: 0, kind: 'command' },
  { callee: 'bot.on', callbackArg: 1, triggerArg: 0, kind: 'event' },
  { callee: 'bot.callbackQuery', callbackArg: 1, triggerArg: 0, kind: 'callback' },
  { callee: 'bot.hears', callbackArg: 1, triggerArg: 0, kind: 'hears' },
  { callee: 'bot.use', callbackArg: 0, triggerArg: -1, kind: 'middleware' },
] as const;

/**
 * Map of callee expressions to registration config.
 */
export const GRAMMY_REGISTRATION_MAP = new Map(
  GRAMMY_REGISTRATIONS.map(r => [r.callee, r])
);

// ============================================================================
// GRAMMY HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a parsed node represents a Grammy bot instance.
 * Looks for: Bot<T> type, grammY import, bot.command/on/callbackQuery calls in body.
 */
function isGrammyBotFunction(node: ParsedNode): boolean {
  // Only match top-level factory functions, NOT callback handlers
  // Handlers already have registrationKind set by the parser
  if (node.properties?.context?.registrationKind) return false;
  
  const sourceCode = node.properties?.sourceCode || '';
  // Must contain multiple registration patterns (not just one mention)
  const registrationCount = 
    (sourceCode.match(/bot\.command\(/g) || []).length +
    (sourceCode.match(/bot\.callbackQuery\(/g) || []).length +
    (sourceCode.match(/bot\.on\(/g) || []).length;
  
  // A bot factory has many registrations, not just one
  return registrationCount >= 3;
}

/**
 * Check if a parsed node is a Grammy command handler (enriched by parser).
 */
function isGrammyHandler(node: ParsedNode): boolean {
  return node.properties?.context?.registrationKind !== undefined;
}

/**
 * Detect ctx.session.* read/write patterns in a handler's source code.
 * Returns { reads: string[], writes: string[] }
 */
export function detectSessionAccess(sourceCode: string): { reads: string[], writes: string[] } {
  const reads: string[] = [];
  const writes: string[] = [];
  const seen = new Set<string>();

  // Match ctx.session.FIELD patterns
  // Write: ctx.session.field = ... or ctx.session.field.push(...) etc.
  const writePattern = /ctx\.session\.(\w+)\s*[=!]/g;
  const deletePattern = /(?:delete\s+)?ctx\.session\.(\w+)/g;
  
  // Read: any ctx.session.field that isn't an assignment target
  const readPattern = /ctx\.session\.(\w+)/g;

  // First pass: find writes
  let match;
  while ((match = writePattern.exec(sourceCode)) !== null) {
    const field = match[1];
    if (!seen.has(`w:${field}`)) {
      writes.push(field);
      seen.add(`w:${field}`);
    }
  }

  // Second pass: find reads (anything not in writes set)
  while ((match = readPattern.exec(sourceCode)) !== null) {
    const field = match[1];
    if (!seen.has(`r:${field}`)) {
      reads.push(field);
      seen.add(`r:${field}`);
    }
  }

  return { reads, writes };
}

// ============================================================================
// GRAMMY FRAMEWORK SCHEMA
// ============================================================================

export const GRAMMY_FRAMEWORK_SCHEMA: FrameworkSchema = {
  name: 'Grammy Bot Framework Schema',
  version: '1.0.0',
  description: 'grammY Telegram bot framework — command handlers, event listeners, callback queries, session state tracking',
  enhances: [CoreNodeType.FUNCTION_DECLARATION],

  enhancements: {
    // Detect the main bot factory function (e.g., createBot)
    GrammyBotFactory: {
      name: 'GrammyBotFactory',
      targetCoreType: CoreNodeType.FUNCTION_DECLARATION,
      semanticType: SemanticNodeType.BOT_FACTORY,
      detectionPatterns: [
        {
          type: 'function' as const,
          pattern: isGrammyBotFunction,
          confidence: 0.9,
          priority: 5,
        },
      ],
      contextExtractors: [
        {
          nodeType: CoreNodeType.FUNCTION_DECLARATION,
          semanticType: SemanticNodeType.BOT_FACTORY,
          priority: 10,
          extractor: (parsedNode: ParsedNode) => {
            const sourceCode = parsedNode.properties?.sourceCode || '';
            // Count registration calls
            const commandCount = (sourceCode.match(/bot\.command\(/g) || []).length;
            const eventCount = (sourceCode.match(/bot\.on\(/g) || []).length;
            const callbackCount = (sourceCode.match(/bot\.callbackQuery\(/g) || []).length;
            const hearsCount = (sourceCode.match(/bot\.hears\(/g) || []).length;
            return {
              frameworkRole: 'botFactory',
              registrationCounts: {
                commands: commandCount,
                events: eventCount,
                callbacks: callbackCount,
                hears: hearsCount,
                total: commandCount + eventCount + callbackCount + hearsCount,
              },
            };
          },
        },
      ],
      additionalRelationships: [],
      neo4j: {
        additionalLabels: ['Framework', 'BotFactory'],
      },
      priority: 5,
    },

    // Semantic enrichment for callback handler nodes (emitted by parser)
    GrammyCommandHandler: {
      name: 'GrammyCommandHandler',
      targetCoreType: CoreNodeType.FUNCTION_DECLARATION,
      semanticType: SemanticNodeType.COMMAND_HANDLER,
      detectionPatterns: [
        {
          type: 'function' as const,
          pattern: (node: ParsedNode) => node.properties?.context?.registrationKind === 'command',
          confidence: 1.0,
          priority: 10,
        },
      ],
      contextExtractors: [
        {
          nodeType: CoreNodeType.FUNCTION_DECLARATION,
          semanticType: SemanticNodeType.COMMAND_HANDLER,
          priority: 10,
          extractor: (parsedNode: ParsedNode) => {
            const { reads, writes } = detectSessionAccess(parsedNode.properties?.sourceCode || '');
            return {
              ...parsedNode.properties?.context,
              sessionReads: reads,
              sessionWrites: writes,
            };
          },
        },
      ],
      additionalRelationships: ['REGISTERED_BY'],
      neo4j: {
        additionalLabels: ['Framework', 'CommandHandler'],
      },
      priority: 10,
    },

    GrammyEventHandler: {
      name: 'GrammyEventHandler',
      targetCoreType: CoreNodeType.FUNCTION_DECLARATION,
      semanticType: SemanticNodeType.EVENT_HANDLER,
      detectionPatterns: [
        {
          type: 'function' as const,
          pattern: (node: ParsedNode) => node.properties?.context?.registrationKind === 'event',
          confidence: 1.0,
          priority: 10,
        },
      ],
      contextExtractors: [
        {
          nodeType: CoreNodeType.FUNCTION_DECLARATION,
          semanticType: SemanticNodeType.EVENT_HANDLER,
          priority: 10,
          extractor: (parsedNode: ParsedNode) => {
            const { reads, writes } = detectSessionAccess(parsedNode.properties?.sourceCode || '');
            return {
              ...parsedNode.properties?.context,
              sessionReads: reads,
              sessionWrites: writes,
            };
          },
        },
      ],
      additionalRelationships: ['REGISTERED_BY'],
      neo4j: {
        additionalLabels: ['Framework', 'EventHandler'],
      },
      priority: 10,
    },

    GrammyCallbackQueryHandler: {
      name: 'GrammyCallbackQueryHandler',
      targetCoreType: CoreNodeType.FUNCTION_DECLARATION,
      semanticType: SemanticNodeType.CALLBACK_QUERY_HANDLER,
      detectionPatterns: [
        {
          type: 'function' as const,
          pattern: (node: ParsedNode) => node.properties?.context?.registrationKind === 'callback',
          confidence: 1.0,
          priority: 10,
        },
      ],
      contextExtractors: [
        {
          nodeType: CoreNodeType.FUNCTION_DECLARATION,
          semanticType: SemanticNodeType.CALLBACK_QUERY_HANDLER,
          priority: 10,
          extractor: (parsedNode: ParsedNode) => {
            const { reads, writes } = detectSessionAccess(parsedNode.properties?.sourceCode || '');
            return {
              ...parsedNode.properties?.context,
              sessionReads: reads,
              sessionWrites: writes,
            };
          },
        },
      ],
      additionalRelationships: ['REGISTERED_BY'],
      neo4j: {
        additionalLabels: ['Framework', 'CallbackQueryHandler'],
      },
      priority: 10,
    },

    GrammyHearsHandler: {
      name: 'GrammyHearsHandler',
      targetCoreType: CoreNodeType.FUNCTION_DECLARATION,
      semanticType: SemanticNodeType.HEARS_HANDLER,
      detectionPatterns: [
        {
          type: 'function' as const,
          pattern: (node: ParsedNode) => node.properties?.context?.registrationKind === 'hears',
          confidence: 1.0,
          priority: 10,
        },
      ],
      contextExtractors: [
        {
          nodeType: CoreNodeType.FUNCTION_DECLARATION,
          semanticType: SemanticNodeType.HEARS_HANDLER,
          priority: 10,
          extractor: (parsedNode: ParsedNode) => {
            const { reads, writes } = detectSessionAccess(parsedNode.properties?.sourceCode || '');
            return {
              ...parsedNode.properties?.context,
              sessionReads: reads,
              sessionWrites: writes,
            };
          },
        },
      ],
      additionalRelationships: ['REGISTERED_BY'],
      neo4j: {
        additionalLabels: ['Framework', 'HearsHandler'],
      },
      priority: 10,
    },

    GrammyMiddleware: {
      name: 'GrammyMiddleware',
      targetCoreType: CoreNodeType.FUNCTION_DECLARATION,
      semanticType: SemanticNodeType.MIDDLEWARE,
      detectionPatterns: [
        {
          type: 'function' as const,
          pattern: (node: ParsedNode) => node.properties?.context?.registrationKind === 'middleware',
          confidence: 1.0,
          priority: 10,
        },
      ],
      contextExtractors: [
        {
          nodeType: CoreNodeType.FUNCTION_DECLARATION,
          semanticType: SemanticNodeType.MIDDLEWARE,
          priority: 10,
          extractor: (parsedNode: ParsedNode) => {
            return {
              ...parsedNode.properties?.context,
              isMiddleware: true,
            };
          },
        },
      ],
      additionalRelationships: [],
      neo4j: {
        additionalLabels: ['Framework', 'Middleware'],
      },
      priority: 10,
    },
  },

  // REGISTERED_BY edges are created directly by the parser during callback extraction.
  // No edge enhancement needed — avoids O(n²) false-positive matching.
  edgeEnhancements: {},

  contextExtractors: [],

  metadata: {
    targetLanguages: ['typescript', 'javascript'],
    dependencies: ['grammy', '@grammyjs/conversations', '@grammyjs/session'],
  },
};
