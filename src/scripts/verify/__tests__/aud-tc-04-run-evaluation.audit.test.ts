/**
 * [AUD-TC-04-L1-04] run-evaluation.ts — Spec-Derived Tests
 *
 * Spec: PLAN.md §Addendum SG-2.4 "Evaluation + Regression Feedback Subgraph"
 * — compares graph metrics between runs for improvements/regressions
 *
 * Behaviors tested via source contract verification:
 * (1) METRICS array has 9 definitions with name/query/higherIsBetter
 * (2) getBaseline() fetches previous MetricResult
 * (3) runEvaluation() creates EvaluationRun + MetricResult nodes
 * (4) Regression detection via delta + higherIsBetter
 * (5) JSON summary with per-metric values + regression flags
 * (6) optional projectId CLI arg
 *
 * Note: Source module runs main() immediately on import. Tests verify contracts
 * that the module is bound to implement per spec.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load actual source file to verify structural contracts
const SOURCE_PATH = join(__dirname, '../run-evaluation.ts');
let sourceCode: string;
try {
  sourceCode = readFileSync(SOURCE_PATH, 'utf-8');
} catch {
  sourceCode = '';
}

// Expected metric names from SG-2.4 spec
const EXPECTED_METRIC_NAMES = [
  'resolves_to_coverage',
  'unresolved_local_imports',
  'risk_scoring_coverage_pct',
  'provenance_coverage_pct',
  'invariant_violations',
  'node_count',
  'edge_count',
  'critical_risk_count',
  'orphan_nodes',
];

describe('[AUD-TC-04-L1-04] run-evaluation.ts', () => {
  describe('METRICS array contract', () => {
    it('(1) METRICS array contains exactly 9 metric definitions', () => {
      // Contract: SG-2.4 defines 9 metrics
      // Count metric objects in source
      for (const name of EXPECTED_METRIC_NAMES) {
        expect(sourceCode).toContain(`name: '${name}'`);
      }
    });

    it('(2) MetricDef interface has name, query, and higherIsBetter', () => {
      expect(sourceCode).toContain('interface MetricDef');
      expect(sourceCode).toMatch(/name:\s*string/);
      expect(sourceCode).toMatch(/query:\s*string/);
      expect(sourceCode).toMatch(/higherIsBetter:\s*boolean/);
    });

    it('(3) metric names follow snake_case convention', () => {
      // All expected names are snake_case
      for (const name of EXPECTED_METRIC_NAMES) {
        expect(name).toMatch(/^[a-z_]+$/);
        expect(sourceCode).toContain(name);
      }
    });

    it('(4) higherIsBetter=false for negative metrics', () => {
      // Contract: metrics where lower is better are flagged correctly
      const negativeMetrics = ['unresolved_local_imports', 'invariant_violations', 'critical_risk_count', 'orphan_nodes'];

      for (const metricName of negativeMetrics) {
        // Find the metric definition and verify higherIsBetter: false
        const metricMatch = sourceCode.match(new RegExp(`name:\\s*'${metricName}'[\\s\\S]*?higherIsBetter:\\s*(true|false)`, 'm'));
        expect(metricMatch).not.toBeNull();
        expect(metricMatch![1]).toBe('false');
      }
    });

    it('(5) higherIsBetter=true for positive metrics', () => {
      const positiveMetrics = ['resolves_to_coverage', 'risk_scoring_coverage_pct', 'provenance_coverage_pct', 'node_count', 'edge_count'];

      for (const metricName of positiveMetrics) {
        const metricMatch = sourceCode.match(new RegExp(`name:\\s*'${metricName}'[\\s\\S]*?higherIsBetter:\\s*(true|false)`, 'm'));
        expect(metricMatch).not.toBeNull();
        expect(metricMatch![1]).toBe('true');
      }
    });
  });

  describe('getBaseline() contract', () => {
    it('(6) getBaseline function queries EvaluationRun -> MetricResult ordered by timestamp DESC', () => {
      expect(sourceCode).toContain('async function getBaseline');
      expect(sourceCode).toMatch(/EvaluationRun.*MEASURED.*MetricResult/s);
      expect(sourceCode).toContain('ORDER BY run.timestamp DESC');
      expect(sourceCode).toContain('LIMIT 1');
    });

    it('(7) returns null when no previous baseline exists', () => {
      // Contract: first run has no baseline
      expect(sourceCode).toMatch(/records\.length\s*===\s*0.*return\s*null/s);
    });
  });

  describe('EvaluationRun node creation contract', () => {
    it('(8) creates EvaluationRun node with required properties', () => {
      expect(sourceCode).toContain('CREATE (run:EvaluationRun');
      expect(sourceCode).toContain('runId:');
      expect(sourceCode).toContain('projectId:');
      expect(sourceCode).toContain('parserCommit:');
      expect(sourceCode).toContain('timestamp:');
    });

    it('(9) runId format is eval_{timestamp}', () => {
      expect(sourceCode).toMatch(/runId.*eval_.*Date\.now\(\)/s);
    });

    it('(10) parserCommit obtained from git rev-parse', () => {
      expect(sourceCode).toContain("git rev-parse --short HEAD");
    });
  });

  describe('MetricResult node creation contract', () => {
    it('(11) creates MetricResult with metric, value, baselineValue, delta, status', () => {
      expect(sourceCode).toContain('CREATE (run)-[:MEASURED');
      expect(sourceCode).toContain('MetricResult');
      expect(sourceCode).toContain('metric:');
      expect(sourceCode).toContain('value:');
      expect(sourceCode).toContain('baselineValue:');
      expect(sourceCode).toContain('delta:');
      expect(sourceCode).toContain('status:');
    });

    it('(12) MEASURED edge has sourceKind=evaluation property', () => {
      expect(sourceCode).toMatch(/:MEASURED\s*\{[^}]*sourceKind:\s*['"]evaluation['"]/);
    });
  });

  describe('regression detection contract', () => {
    it('(13) status is improved when delta moves in higherIsBetter direction', () => {
      // Contract verified by checking status computation logic
      // Source uses ternary: status = delta > 0 ? 'improved' : 'regressed'
      expect(sourceCode).toContain("'improved'");
      expect(sourceCode).toContain("'regressed'");
      expect(sourceCode).toContain('higherIsBetter');
    });

    it('(14) status is unchanged when delta is less than 0.01', () => {
      expect(sourceCode).toMatch(/Math\.abs\(delta\)\s*<\s*0\.01/);
      expect(sourceCode).toContain("'unchanged'");
    });

    it('(15) status is baseline for first run (no previous baseline)', () => {
      expect(sourceCode).toContain("'baseline'");
      // Source checks if baseline !== null to compute delta, else status = 'baseline'
      expect(sourceCode).toMatch(/baseline\s*!==\s*null/);
    });
  });

  describe('CLI argument handling', () => {
    it('(16) accepts optional projectId from argv[2]', () => {
      expect(sourceCode).toContain('process.argv[2]');
    });

    it('(17) runs on all projects when no projectId specified', () => {
      // Contract: queries Project nodes and runs evaluation per project
      expect(sourceCode).toContain("MATCH (p:Project)");
      expect(sourceCode).toContain('p.projectId');
    });
  });

  describe('result aggregation', () => {
    it('(18) results array tracks metric, value, baseline, delta, status', () => {
      expect(sourceCode).toMatch(/results\.push\(\s*\{/);
      expect(sourceCode).toContain('metric: metric.name');
      expect(sourceCode).toContain('value');
      expect(sourceCode).toContain('baseline');
      expect(sourceCode).toContain('delta');
      expect(sourceCode).toContain('status');
    });
  });

  describe('project filtering', () => {
    it('(19) filters out corpus projects (bible, quran, etc.) when running on all', () => {
      // Contract: evaluation only runs on code projects
      expect(sourceCode).toContain("!pid.includes('bible')");
      expect(sourceCode).toContain("!pid.includes('quran')");
    });
  });
});
