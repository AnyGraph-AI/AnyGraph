/**
 * AUD-TC-06-L1-04: ir-enrichment-plugin.ts behavioral audit tests
 *
 * Spec sources:
 *  - plans/codegraph/MULTI_LANGUAGE_ASSESSMENT.md §2 "Framework Enrichments"
 *  - plans/codegraph/ADAPTER_ROADMAP.md — M1: "Move Grammy enrichments into IR-level enrichment plugin"
 *
 * Tests assert BEHAVIOR from specs, not implementation details.
 * Accept criteria: 5+ behavioral assertions, all green.
 */
import { describe, it, expect } from 'vitest';
import type { IrDocument } from '../../ir/ir-v1.schema.js';
import {
  applyIrEnrichments,
  type IrEnrichmentPlugin,
  type IrEnrichmentResult,
} from '../../ir/enrichments/ir-enrichment-plugin.js';

// ============================================================================
// Helpers
// ============================================================================

function makeMinimalDoc(): IrDocument {
  return {
    version: 'ir.v1',
    projectId: 'proj_test',
    sourceKind: 'code',
    nodes: [],
    edges: [],
    metadata: {},
  };
}

function makeMockPlugin(
  name: string,
  shouldRun: boolean,
  enrichFn?: (doc: IrDocument) => IrEnrichmentResult,
): IrEnrichmentPlugin {
  return {
    name,
    shouldEnrich: () => shouldRun,
    enrich: enrichFn ?? (() => ({
      nodesAdded: 1,
      edgesAdded: 0,
      nodesModified: 0,
      pluginName: name,
    })),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ir-enrichment-plugin.ts behavioral audit', () => {
  it('(1) applyIrEnrichments runs all plugins that return shouldEnrich(doc) === true', () => {
    const doc = makeMinimalDoc();
    const pluginA = makeMockPlugin('alpha', true);
    const pluginB = makeMockPlugin('beta', true);

    const { results } = applyIrEnrichments(doc, [pluginA, pluginB]);
    expect(results).toHaveLength(2);
    expect(results[0].pluginName).toBe('alpha');
    expect(results[1].pluginName).toBe('beta');
  });

  it('(2) applyIrEnrichments skips plugins that return shouldEnrich(doc) === false', () => {
    const doc = makeMinimalDoc();
    const pluginA = makeMockPlugin('alpha', true);
    const pluginB = makeMockPlugin('beta', false);
    const pluginC = makeMockPlugin('gamma', true);

    const { results } = applyIrEnrichments(doc, [pluginA, pluginB, pluginC]);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.pluginName)).toEqual(['alpha', 'gamma']);
  });

  it('(3) applyIrEnrichments returns combined results array with one entry per applied plugin', () => {
    const doc = makeMinimalDoc();
    const plugins = [
      makeMockPlugin('a', true, () => ({ nodesAdded: 3, edgesAdded: 2, nodesModified: 0, pluginName: 'a' })),
      makeMockPlugin('b', true, () => ({ nodesAdded: 0, edgesAdded: 1, nodesModified: 5, pluginName: 'b' })),
    ];

    const { results } = applyIrEnrichments(doc, plugins);
    expect(results).toHaveLength(2);
    expect(results[0].nodesAdded).toBe(3);
    expect(results[0].edgesAdded).toBe(2);
    expect(results[1].nodesModified).toBe(5);
  });

  it('(4) applyIrEnrichments mutates document in-place (same reference returned)', () => {
    const doc = makeMinimalDoc();
    const plugin = makeMockPlugin('mutator', true, (d) => {
      d.nodes.push({
        id: 'enriched-node',
        type: 'Entity',
        kind: 'Entrypoint',
        name: 'route',
        projectId: d.projectId,
        parserTier: 0,
        confidence: 0.8,
        provenanceKind: 'enrichment',
        properties: {},
      });
      return { nodesAdded: 1, edgesAdded: 0, nodesModified: 0, pluginName: 'mutator' };
    });

    const { doc: returnedDoc } = applyIrEnrichments(doc, [plugin]);
    // Same reference
    expect(returnedDoc).toBe(doc);
    // Mutation visible
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0].id).toBe('enriched-node');
  });

  it('(5) plugins run in array order (deterministic application sequence)', () => {
    const executionOrder: string[] = [];
    const doc = makeMinimalDoc();

    const plugins = ['first', 'second', 'third'].map((name) =>
      makeMockPlugin(name, true, () => {
        executionOrder.push(name);
        return { nodesAdded: 0, edgesAdded: 0, nodesModified: 0, pluginName: name };
      }),
    );

    applyIrEnrichments(doc, plugins);
    expect(executionOrder).toEqual(['first', 'second', 'third']);
  });
});
