// Spec source: plans/codegraph/TDD_ROADMAP.md §N3

import { describe, it, expect } from 'vitest';

import type { TestFixture } from '../ephemeral-graph.js';
import {
  PLAN_GRAPH_FIXTURE_VERSION,
  SIMPLE_PLAN,
  PLAN_WITH_DRIFT,
  BLOCKED_CHAIN,
  PLAN_WITH_DECISION,
} from '../fixtures/micro/plan-graph.fixture.js';

function expectFixtureShape(fixture: TestFixture) {
  expect(Array.isArray(fixture.nodes)).toBe(true);
  expect(fixture.nodes.length).toBeGreaterThan(0);

  for (const node of fixture.nodes) {
    expect(Array.isArray(node.labels)).toBe(true);
    expect(node.labels.length).toBeGreaterThan(0);
    expect(typeof node.properties).toBe('object');
    expect(node.properties).not.toBeNull();
  }
}

describe('AUD-TC-11d-21: plan-graph micro fixtures', () => {
  it('pins PLAN_GRAPH_FIXTURE_VERSION to 1.0.0', () => {
    expect(PLAN_GRAPH_FIXTURE_VERSION).toBe('1.0.0');
  });

  it('validates expected fixtures conform to TestFixture shape', () => {
    const fixtures = [SIMPLE_PLAN, PLAN_WITH_DRIFT, BLOCKED_CHAIN, PLAN_WITH_DECISION];
    for (const fixture of fixtures) {
      expectFixtureShape(fixture);
    }
  });

  it('PLAN_WITH_DECISION includes a Decision node', () => {
    const decisionNodes = PLAN_WITH_DECISION.nodes.filter((n) => n.labels.includes('Decision'));
    expect(decisionNodes.length).toBeGreaterThan(0);
  });
});
