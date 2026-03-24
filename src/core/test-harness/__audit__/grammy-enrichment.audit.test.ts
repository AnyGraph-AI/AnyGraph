/**
 * AUD-TC-06-L1-04: grammy-enrichment.ts behavioral audit tests
 *
 * Spec-derived tests from MULTI_LANGUAGE_ASSESSMENT.md §2 "Parser Integration Layer (IR)"
 * and ADAPTER_ROADMAP.md Sprint 1: "Refactor current TS pipeline: parser output → IR → enrichment → graph"
 *
 * Behaviors tested:
 *   (1) shouldEnrich true for Grammy handlers
 *   (2) shouldEnrich false for non-Grammy docs
 *   (3) enrich creates Entrypoint nodes with deterministic IDs
 *   (4) enrich creates REGISTERED_BY edges
 *   (5) Entrypoint node properties correct
 *   (6) handler frameworkLabels tagging
 *   (7) factory frameworkLabels tagging
 *   (8) idempotency (dedup)
 *   (9) accurate stats
 */

import { describe, it, expect } from 'vitest';
import { GrammyIrEnrichment } from '../../ir/enrichments/grammy-enrichment.js';
import type { IrDocument } from '../../ir/ir-v1.schema.js';

// ── Fixture helpers ──

function makeDoc(overrides: Partial<IrDocument> = {}): IrDocument {
  return {
    version: 'ir.v1',
    projectId: 'test-project',
    sourceKind: 'code',
    nodes: [],
    edges: [],
    metadata: {},
    ...overrides,
  } as IrDocument;
}

function handlerNode(id: string, kind: string, trigger: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'Symbol' as const,
    kind: 'Function',
    name: `handle_${trigger}`,
    projectId: 'test-project',
    sourcePath: 'src/bot.ts',
    parserTier: 0 as const,
    confidence: 1,
    provenanceKind: 'parser' as const,
    properties: {
      context: {
        registrationKind: kind,
        registrationTrigger: trigger,
        framework: 'grammy' as const,
        ...extra,
      },
    },
  };
}

function factoryNode(id: string) {
  return {
    id,
    type: 'Symbol' as const,
    kind: 'Function',
    name: 'createBot',
    projectId: 'test-project',
    sourcePath: 'src/bot.ts',
    parserTier: 0 as const,
    confidence: 1,
    provenanceKind: 'parser' as const,
    properties: {
      context: { frameworkRole: 'botFactory' as const },
    },
  };
}

function plainNode(id: string) {
  return {
    id,
    type: 'Symbol' as const,
    kind: 'Function',
    name: 'utilHelper',
    projectId: 'test-project',
    parserTier: 0 as const,
    confidence: 1,
    provenanceKind: 'parser' as const,
    properties: {},
  };
}

// ── Tests ──

describe('AUD-TC-06-L1-04: GrammyIrEnrichment behavioral audit', () => {
  const plugin = new GrammyIrEnrichment();

  // ── (1) shouldEnrich returns true for Grammy handler context ──
  it('(1) shouldEnrich returns true when any node has context.framework === "grammy"', () => {
    const doc = makeDoc({ nodes: [handlerNode('h1', 'command', 'start')] });
    expect(plugin.shouldEnrich(doc)).toBe(true);
  });

  it('(1b) shouldEnrich returns true when any node has context.frameworkRole === "botFactory"', () => {
    const doc = makeDoc({ nodes: [factoryNode('f1')] });
    expect(plugin.shouldEnrich(doc)).toBe(true);
  });

  // ── (2) shouldEnrich returns false for non-Grammy documents ──
  it('(2) shouldEnrich returns false for documents with no Grammy nodes', () => {
    const doc = makeDoc({ nodes: [plainNode('p1')] });
    expect(plugin.shouldEnrich(doc)).toBe(false);
  });

  it('(2b) shouldEnrich returns false for empty document', () => {
    const doc = makeDoc();
    expect(plugin.shouldEnrich(doc)).toBe(false);
  });

  // ── (3) enrich creates Entrypoint nodes with deterministic IDs ──
  it('(3) enrich creates Entrypoint nodes for each Grammy handler with deterministic IDs', () => {
    const doc = makeDoc({ nodes: [handlerNode('h1', 'command', 'start')] });
    plugin.enrich(doc);

    const entrypoints = doc.nodes.filter((n) => n.kind === 'Entrypoint');
    expect(entrypoints).toHaveLength(1);

    // Deterministic: running again on same input should produce same ID
    const doc2 = makeDoc({ nodes: [handlerNode('h1', 'command', 'start')] });
    plugin.enrich(doc2);
    const entrypoints2 = doc2.nodes.filter((n) => n.kind === 'Entrypoint');
    expect(entrypoints2[0].id).toBe(entrypoints[0].id);
  });

  // ── (4) enrich creates REGISTERED_BY edges from handler to Entrypoint ──
  it('(4) enrich creates REGISTERED_BY edges from handler to Entrypoint', () => {
    const doc = makeDoc({ nodes: [handlerNode('h1', 'command', 'start')] });
    plugin.enrich(doc);

    const regEdges = doc.edges.filter((e) => e.type === 'REGISTERED_BY');
    expect(regEdges).toHaveLength(1);
    expect(regEdges[0].from).toBe('h1');

    const entrypoint = doc.nodes.find((n) => n.kind === 'Entrypoint')!;
    expect(regEdges[0].to).toBe(entrypoint.id);
  });

  // ── (5) Entrypoint nodes have correct properties ──
  it('(5) Entrypoint nodes have type=Site, kind=Entrypoint, entrypointKind, trigger, framework=grammy', () => {
    const doc = makeDoc({ nodes: [handlerNode('h1', 'command', 'start')] });
    plugin.enrich(doc);

    const ep = doc.nodes.find((n) => n.kind === 'Entrypoint')!;
    expect(ep.type).toBe('Site');
    expect(ep.kind).toBe('Entrypoint');
    expect(ep.properties.entrypointKind).toBe('command');
    expect(ep.properties.trigger).toBe('start');
    expect(ep.properties.framework).toBe('grammy');
    expect(ep.provenanceKind).toBe('enrichment');
  });

  // ── (6) handler nodes tagged with frameworkLabels ──
  it('(6) enrich tags handler nodes with correct frameworkLabels per registrationKind', () => {
    const kinds = [
      { kind: 'command', expected: 'CommandHandler' },
      { kind: 'event', expected: 'EventHandler' },
      { kind: 'callback', expected: 'CallbackQueryHandler' },
      { kind: 'hears', expected: 'HearsHandler' },
      { kind: 'middleware', expected: 'Middleware' },
    ];

    for (const { kind, expected } of kinds) {
      const doc = makeDoc({ nodes: [handlerNode(`h-${kind}`, kind, 'test')] });
      plugin.enrich(doc);
      const handler = doc.nodes.find((n) => n.id === `h-${kind}`)!;
      expect(handler.properties.frameworkLabels).toContain('Framework');
      expect(handler.properties.frameworkLabels).toContain(expected);
    }
  });

  // ── (7) factory nodes tagged with frameworkLabels ──
  it('(7) enrich tags factory nodes with frameworkLabels [Framework, BotFactory]', () => {
    const doc = makeDoc({ nodes: [factoryNode('f1')] });
    plugin.enrich(doc);

    const factory = doc.nodes.find((n) => n.id === 'f1')!;
    expect(factory.properties.frameworkLabels).toEqual(['Framework', 'BotFactory']);
  });

  // ── (8) idempotency ──
  it('(8) enrich is idempotent — running twice produces same result', () => {
    const doc = makeDoc({
      nodes: [handlerNode('h1', 'command', 'start'), factoryNode('f1')],
    });

    const result1 = plugin.enrich(doc);
    const nodesAfterFirst = doc.nodes.length;
    const edgesAfterFirst = doc.edges.length;

    const result2 = plugin.enrich(doc);
    expect(doc.nodes.length).toBe(nodesAfterFirst);
    expect(doc.edges.length).toBe(edgesAfterFirst);
    expect(result2.nodesAdded).toBe(0);
    expect(result2.edgesAdded).toBe(0);
    expect(result2.nodesModified).toBe(0);
  });

  // ── (9) accurate stats ──
  it('(9) enrich returns accurate stats (nodesAdded, edgesAdded, nodesModified)', () => {
    const doc = makeDoc({
      nodes: [
        handlerNode('h1', 'command', 'start'),
        handlerNode('h2', 'event', 'message'),
        factoryNode('f1'),
      ],
    });

    const result = plugin.enrich(doc);
    expect(result.nodesAdded).toBe(2); // 2 entrypoint nodes
    expect(result.edgesAdded).toBe(2); // 2 REGISTERED_BY edges
    expect(result.nodesModified).toBe(3); // 2 handlers + 1 factory tagged
    expect(result.pluginName).toBe('grammy');
  });

  // ── (bonus) multiple handlers create distinct entrypoints ──
  it('(3b) multiple handlers create distinct Entrypoint nodes', () => {
    const doc = makeDoc({
      nodes: [
        handlerNode('h1', 'command', 'start'),
        handlerNode('h2', 'command', 'help'),
        handlerNode('h3', 'event', 'message'),
      ],
    });

    plugin.enrich(doc);
    const entrypoints = doc.nodes.filter((n) => n.kind === 'Entrypoint');
    expect(entrypoints).toHaveLength(3);
    const ids = new Set(entrypoints.map((e) => e.id));
    expect(ids.size).toBe(3); // all distinct
  });
});
