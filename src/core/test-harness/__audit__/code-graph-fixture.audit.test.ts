// Spec source: plans/codegraph/TDD_ROADMAP.md §N3

import { describe, it, expect } from 'vitest';

import type { TestFixture } from '../ephemeral-graph.js';
import {
  CODE_GRAPH_FIXTURE_VERSION,
  SINGLE_FUNCTION,
  CROSS_FILE_CALL,
  HIGH_RISK_HUB,
  STATEFUL_CLASS,
} from '../fixtures/micro/code-graph.fixture.js';

function expectFixtureShape(fixture: TestFixture) {
  expect(Array.isArray(fixture.nodes)).toBe(true);
  expect(fixture.nodes.length).toBeGreaterThan(0);

  for (const node of fixture.nodes) {
    expect(Array.isArray(node.labels)).toBe(true);
    expect(node.labels.length).toBeGreaterThan(0);
    expect(typeof node.properties).toBe('object');
    expect(node.properties).not.toBeNull();
  }

  if (fixture.edges) {
    for (const edge of fixture.edges) {
      expect(typeof edge.fromRef).toBe('string');
      expect(typeof edge.toRef).toBe('string');
      expect(typeof edge.type).toBe('string');
    }
  }
}

describe('AUD-TC-11d-21: code-graph micro fixtures', () => {
  it('pins CODE_GRAPH_FIXTURE_VERSION to 1.0.0', () => {
    expect(CODE_GRAPH_FIXTURE_VERSION).toBe('1.0.0');
  });

  it('validates expected fixtures conform to TestFixture shape', () => {
    const fixtures = [SINGLE_FUNCTION, CROSS_FILE_CALL, HIGH_RISK_HUB, STATEFUL_CLASS];
    for (const fixture of fixtures) {
      expectFixtureShape(fixture);
    }
  });

  it('STATEFUL_CLASS includes READS_STATE and WRITES_STATE edges', () => {
    const edgeTypes = new Set((STATEFUL_CLASS.edges ?? []).map((e) => e.type));
    expect(edgeTypes.has('READS_STATE')).toBe(true);
    expect(edgeTypes.has('WRITES_STATE')).toBe(true);
  });
});
