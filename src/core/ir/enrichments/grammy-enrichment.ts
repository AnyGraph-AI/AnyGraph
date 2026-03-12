/**
 * Grammy IR Enrichment Plugin
 *
 * Detects Function nodes annotated with Grammy framework context by the parser,
 * and creates the framework-specific graph structure:
 *   - Entrypoint nodes (command:start, event::message, callback:buy:*)
 *   - REGISTERED_BY edges (handler → entrypoint)
 *   - Additional framework labels in node properties
 *
 * The parser detects `bot.command('start', ctx => {...})` patterns during AST
 * traversal and annotates the handler Function node with context metadata:
 *   { registrationKind: 'command', registrationTrigger: 'start', framework: 'grammy' }
 *
 * This plugin reads those annotations and creates the structural graph elements
 * that represent the framework architecture — separating detection (parser) from
 * graph structure creation (enrichment).
 */

import type { IrDocument, IrNode, IrEdge } from '../ir-v1.schema.js';
import type { IrEnrichmentPlugin, IrEnrichmentResult } from './ir-enrichment-plugin.js';
import { createHash } from 'node:crypto';

/** Grammy handler context shape as set by the parser */
interface GrammyHandlerContext {
  registrationKind: string;
  registrationTrigger?: string;
  framework: 'grammy';
  parentFunction?: string;
  anonymous?: boolean;
  callee?: string;
}

/** Grammy bot factory context shape */
interface GrammyFactoryContext {
  frameworkRole: 'botFactory';
  registrationCounts?: {
    commands: number;
    events: number;
    callbacks: number;
    hears: number;
    total: number;
  };
}

function generateDeterministicId(...parts: string[]): string {
  return createHash('md5').update(parts.join('|')).digest('hex').slice(0, 16);
}

function isGrammyHandler(node: IrNode): node is IrNode & { properties: { context: GrammyHandlerContext } } {
  const ctx = node.properties?.context;
  return ctx?.framework === 'grammy' && typeof ctx?.registrationKind === 'string';
}

function isGrammyFactory(node: IrNode): node is IrNode & { properties: { context: GrammyFactoryContext } } {
  return node.properties?.context?.frameworkRole === 'botFactory';
}

export class GrammyIrEnrichment implements IrEnrichmentPlugin {
  readonly name = 'grammy';

  shouldEnrich(doc: IrDocument): boolean {
    // Fast check: does any node reference Grammy?
    return doc.nodes.some(
      (n) =>
        n.properties?.context?.framework === 'grammy' ||
        n.properties?.context?.frameworkRole === 'botFactory',
    );
  }

  enrich(doc: IrDocument): IrEnrichmentResult {
    let nodesAdded = 0;
    let edgesAdded = 0;
    let nodesModified = 0;

    const existingNodeIds = new Set(doc.nodes.map((n) => n.id));
    const existingEdgeKeys = new Set(
      doc.edges.map((e) => `${e.type}|${e.from}|${e.to}`),
    );

    // Pass 1: Create Entrypoint nodes and REGISTERED_BY edges for handler functions
    for (const node of [...doc.nodes]) {
      if (!isGrammyHandler(node)) continue;

      const ctx = node.properties.context;
      const kind = ctx.registrationKind;
      const trigger = ctx.registrationTrigger || '*';
      const entrypointName = `${kind}:${trigger}`;

      // Deterministic Entrypoint ID — same algorithm as the parser used to use
      const entrypointId = generateDeterministicId(
        doc.projectId,
        'Entrypoint',
        node.sourcePath || '',
        entrypointName,
        ctx.parentFunction || '',
      );

      // Create Entrypoint node if it doesn't already exist
      if (!existingNodeIds.has(entrypointId)) {
        const entrypointNode: IrNode = {
          id: entrypointId,
          type: 'Site',
          kind: 'Entrypoint',
          name: entrypointName,
          projectId: doc.projectId,
          sourcePath: node.sourcePath,
          parserTier: 1,
          confidence: 0.9,
          provenanceKind: 'enrichment',
          range: node.range
            ? { startLine: node.range.startLine }
            : undefined,
          properties: {
            entrypointKind: kind,
            trigger,
            framework: 'grammy',
            callee: ctx.callee,
            generatedBy: 'grammy-enrichment',
          },
        };

        doc.nodes.push(entrypointNode);
        existingNodeIds.add(entrypointId);
        nodesAdded++;
      }

      // Create REGISTERED_BY edge: handler → entrypoint
      const edgeKey = `REGISTERED_BY|${node.id}|${entrypointId}`;
      if (!existingEdgeKeys.has(edgeKey)) {
        const registeredByEdge: IrEdge = {
          type: 'REGISTERED_BY',
          from: node.id,
          to: entrypointId,
          projectId: doc.projectId,
          parserTier: 1,
          confidence: 0.9,
          provenanceKind: 'enrichment',
          properties: {
            registrationKind: kind,
            trigger,
            framework: 'grammy',
            generatedBy: 'grammy-enrichment',
          },
        };

        doc.edges.push(registeredByEdge);
        existingEdgeKeys.add(edgeKey);
        edgesAdded++;
      }

      // Tag the handler node with framework labels in properties
      if (!node.properties.frameworkLabels) {
        const labelMap: Record<string, string> = {
          command: 'CommandHandler',
          event: 'EventHandler',
          callback: 'CallbackQueryHandler',
          hears: 'HearsHandler',
          middleware: 'Middleware',
        };
        node.properties.frameworkLabels = ['Framework', labelMap[kind] || 'Handler'];
        nodesModified++;
      }
    }

    // Pass 2: Tag bot factory nodes
    for (const node of doc.nodes) {
      if (!isGrammyFactory(node)) continue;
      if (!node.properties.frameworkLabels) {
        node.properties.frameworkLabels = ['Framework', 'BotFactory'];
        nodesModified++;
      }
    }

    return {
      nodesAdded,
      edgesAdded,
      nodesModified,
      pluginName: this.name,
    };
  }
}
