// Spec source: plans/codegraph/TDD_ROADMAP.md §N3

import { describe, it, expect } from 'vitest';

import {
  SCENARIO_FIXTURE_VERSION,
  CODE_PLAN_CROSS_DOMAIN,
  ENRICHED_CODE_GRAPH,
} from '../fixtures/scenario/index.js';

describe('AUD-TC-11d-21: scenario fixtures', () => {
  it('pins SCENARIO_FIXTURE_VERSION to 1.0.0', () => {
    expect(SCENARIO_FIXTURE_VERSION).toBe('1.0.0');
  });

  it('CODE_PLAN_CROSS_DOMAIN includes HAS_CODE_EVIDENCE edge', () => {
    const edgeTypes = new Set((CODE_PLAN_CROSS_DOMAIN.edges ?? []).map((e) => e.type));
    expect(edgeTypes.has('HAS_CODE_EVIDENCE')).toBe(true);
  });

  it('ENRICHED_CODE_GRAPH includes required enrichment edge types', () => {
    const edgeTypes = new Set((ENRICHED_CODE_GRAPH.edges ?? []).map((e) => e.type));

    for (const required of ['READS_STATE', 'WRITES_STATE', 'OWNED_BY', 'BELONGS_TO_LAYER']) {
      expect(edgeTypes.has(required)).toBe(true);
    }
  });
});
