/**
 * AUD-TC-03-L2-03: query-contract.ts audit tests
 *
 * Verdict: INCOMPLETE
 * No direct tests exist for query-contract.ts. The registry-verifier test imports
 * Q14 and Q15 but only uses them as opaque strings passed to a mock.
 * Consumer tests (dashboard, metrics-report) test their own logic, not the queries.
 *
 * SPEC-GAP: CONTRACT_QUERY_Q11_MILESTONE_BUCKETS is valid Cypher selecting VG/CA/RTG milestones
 * SPEC-GAP: CONTRACT_QUERY_Q11_NEXT_TASKS returns unblocked tasks with dependency awareness
 * SPEC-GAP: CONTRACT_QUERY_Q11_BLOCKED reports explicitBlocked + effectiveBlocked + nullStatusCount
 * SPEC-GAP: CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE reports evidence coverage metrics
 * SPEC-GAP: CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST returns latest snapshot fields
 * SPEC-GAP: CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND returns ordered trend data
 * SPEC-GAP: queries use scoped projectId parameters (no global MATCH without scope)
 * SPEC-GAP: evidence rollups constrained to HAS_CODE_EVIDENCE.projectId
 *
 * Strategy: Static analysis of query strings — verify structure, parameters, scoping.
 * No Neo4j needed; these are string constants we can validate syntactically.
 */

import { describe, it, expect } from 'vitest';
import {
  CONTRACT_QUERY_Q11_MILESTONE_BUCKETS,
  CONTRACT_QUERY_Q11_NEXT_TASKS,
  CONTRACT_QUERY_Q11_BLOCKED,
  CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE,
  CONTRACT_QUERY_Q14_PROJECT_COUNTS,
  CONTRACT_QUERY_Q15_PROJECT_STATUS,
  CONTRACT_QUERY_Q16_PROJECT_DRIFT,
  CONTRACT_QUERY_Q17_CLAIM_STATUS,
  CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST,
  CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND,
} from '../../../utils/query-contract.js';

describe('AUD-TC-03-L2-03: query-contract spec-gap coverage', () => {
  // ── Behavior 1: Q11_MILESTONE_BUCKETS selects VG-*/CA-*/RTG-* milestones ──
  describe('CONTRACT_QUERY_Q11_MILESTONE_BUCKETS', () => {
    it('is a non-empty string', () => {
      expect(typeof CONTRACT_QUERY_Q11_MILESTONE_BUCKETS).toBe('string');
      expect(CONTRACT_QUERY_Q11_MILESTONE_BUCKETS.length).toBeGreaterThan(0);
    });

    it('filters for VG-*, CA-*, RTG-* milestone codes', () => {
      expect(CONTRACT_QUERY_Q11_MILESTONE_BUCKETS).toContain("STARTS WITH 'VG-'");
      expect(CONTRACT_QUERY_Q11_MILESTONE_BUCKETS).toContain("STARTS WITH 'CA-'");
      expect(CONTRACT_QUERY_Q11_MILESTONE_BUCKETS).toContain("STARTS WITH 'RTG-'");
    });

    it('uses scoped projectId parameter', () => {
      expect(CONTRACT_QUERY_Q11_MILESTONE_BUCKETS).toContain('$projectId');
    });

    it('returns bucket, total, done, planned, blocked, inProgress columns', () => {
      expect(CONTRACT_QUERY_Q11_MILESTONE_BUCKETS).toContain('AS bucket');
      expect(CONTRACT_QUERY_Q11_MILESTONE_BUCKETS).toContain('AS total');
      expect(CONTRACT_QUERY_Q11_MILESTONE_BUCKETS).toContain('AS done');
      expect(CONTRACT_QUERY_Q11_MILESTONE_BUCKETS).toContain('AS planned');
      expect(CONTRACT_QUERY_Q11_MILESTONE_BUCKETS).toContain('AS blocked');
      expect(CONTRACT_QUERY_Q11_MILESTONE_BUCKETS).toContain('AS inProgress');
    });
  });

  // ── Behavior 2: Q11_NEXT_TASKS returns unblocked tasks ──
  describe('CONTRACT_QUERY_Q11_NEXT_TASKS', () => {
    it('uses scoped projectId parameter', () => {
      expect(CONTRACT_QUERY_Q11_NEXT_TASKS).toContain('$projectId');
    });

    it('filters out done tasks', () => {
      expect(CONTRACT_QUERY_Q11_NEXT_TASKS).toContain("'done'");
    });

    it('computes open dependency count', () => {
      expect(CONTRACT_QUERY_Q11_NEXT_TASKS).toContain('openDeps');
      expect(CONTRACT_QUERY_Q11_NEXT_TASKS).toContain('DEPENDS_ON');
    });

    it('orders by openDeps ascending (unblocked first)', () => {
      expect(CONTRACT_QUERY_Q11_NEXT_TASKS).toContain('ORDER BY openDeps ASC');
    });

    it('limits to 10 results', () => {
      expect(CONTRACT_QUERY_Q11_NEXT_TASKS).toContain('LIMIT 10');
    });
  });

  // ── Behavior 3: Q11_BLOCKED reports three blocked metrics ──
  describe('CONTRACT_QUERY_Q11_BLOCKED', () => {
    it('uses scoped projectId parameter', () => {
      expect(CONTRACT_QUERY_Q11_BLOCKED).toContain('$projectId');
    });

    it('returns explicitBlocked, effectiveBlocked, nullStatusCount', () => {
      expect(CONTRACT_QUERY_Q11_BLOCKED).toContain('AS explicitBlocked');
      expect(CONTRACT_QUERY_Q11_BLOCKED).toContain('AS effectiveBlocked');
      expect(CONTRACT_QUERY_Q11_BLOCKED).toContain('AS nullStatusCount');
    });
  });

  // ── Behavior 4: Q11_RUNTIME_EVIDENCE reports coverage ──
  describe('CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE', () => {
    it('uses scoped runtimeProjectId parameter', () => {
      expect(CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE).toContain('$runtimeProjectId');
    });

    it('returns totalTasks, withEvidence, doneWithoutEvidence, counts', () => {
      expect(CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE).toContain('AS totalTasks');
      expect(CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE).toContain('AS withEvidence');
      expect(CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE).toContain('AS doneWithoutEvidence');
      expect(CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE).toContain('AS evidenceEdgeCount');
      expect(CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE).toContain('AS evidenceArtifactCount');
    });

    // SPEC-GAP: evidence rollups constrained to HAS_CODE_EVIDENCE.projectId
    it('constrains evidence rollups to projectId scope', () => {
      expect(CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE).toContain('r.projectId');
    });
  });

  // ── Behavior 5: Q18_GOVERNANCE_METRIC_LATEST returns latest snapshot ──
  describe('CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST', () => {
    it('uses scoped projectId parameter', () => {
      expect(CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST).toContain('$projectId');
    });

    it('returns key governance metric fields', () => {
      const requiredFields = [
        'verificationRuns', 'gateFailures', 'interceptionRate',
        'preventedRuns', 'invariantViolations', 'falseCompletionEvents',
      ];
      for (const field of requiredFields) {
        expect(CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST).toContain(field);
      }
    });

    it('orders by timestamp DESC and limits to 1 (latest)', () => {
      expect(CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST).toContain('ORDER BY m.timestamp DESC');
      expect(CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST).toContain('LIMIT 1');
    });
  });

  // ── Behavior 6: Q18_GOVERNANCE_METRIC_TREND returns ordered data ──
  describe('CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND', () => {
    it('uses scoped projectId parameter', () => {
      expect(CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND).toContain('$projectId');
    });

    it('orders by timestamp ASC (chronological trend)', () => {
      expect(CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND).toContain('ORDER BY m.timestamp ASC');
    });

    it('returns trend-relevant metric fields', () => {
      expect(CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND).toContain('AS timestamp');
      expect(CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND).toContain('AS interceptionRate');
      expect(CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND).toContain('AS gateFailures');
    });
  });

  // ── Behavior 7: All queries use scoped projectId (no unscoped global MATCH) ──
  describe('project scoping invariant', () => {
    const scopedQueries = [
      { name: 'Q11_MILESTONE_BUCKETS', query: CONTRACT_QUERY_Q11_MILESTONE_BUCKETS, param: '$projectId' },
      { name: 'Q11_NEXT_TASKS', query: CONTRACT_QUERY_Q11_NEXT_TASKS, param: '$projectId' },
      { name: 'Q11_BLOCKED', query: CONTRACT_QUERY_Q11_BLOCKED, param: '$projectId' },
      { name: 'Q11_RUNTIME_EVIDENCE', query: CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE, param: '$runtimeProjectId' },
      { name: 'Q18_LATEST', query: CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST, param: '$projectId' },
      { name: 'Q18_TREND', query: CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND, param: '$projectId' },
    ];

    for (const { name, query, param } of scopedQueries) {
      it(`${name} uses scoped ${param} parameter`, () => {
        expect(query).toContain(param);
      });
    }
  });

  // ── All exports are non-empty strings ──
  describe('all exports are valid query strings', () => {
    const allQueries = {
      CONTRACT_QUERY_Q11_MILESTONE_BUCKETS,
      CONTRACT_QUERY_Q11_NEXT_TASKS,
      CONTRACT_QUERY_Q11_BLOCKED,
      CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE,
      CONTRACT_QUERY_Q14_PROJECT_COUNTS,
      CONTRACT_QUERY_Q15_PROJECT_STATUS,
      CONTRACT_QUERY_Q16_PROJECT_DRIFT,
      CONTRACT_QUERY_Q17_CLAIM_STATUS,
      CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST,
      CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND,
    };

    for (const [name, query] of Object.entries(allQueries)) {
      it(`${name} is a non-empty string containing MATCH/RETURN`, () => {
        expect(typeof query).toBe('string');
        expect(query.length).toBeGreaterThan(10);
        expect(query).toContain('MATCH');
        expect(query).toContain('RETURN');
      });
    }
  });
});
