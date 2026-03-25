/**
 * AUD-TC-11c-L1-07: pack-interface.ts — Structural Conformance Tests
 *
 * Spec source: plans/codegraph/GROUND_TRUTH_HOOK.md §GTH-1 "Implement GroundTruthPack interface"
 *              _drafts/ground-truth-hook/DESIGN.md §"Architecture: Generic Runtime + Domain Packs"
 *
 * Pure interface file — tests verify structural conformance via TypeScript's type
 * system. A mock implementation that satisfies the interface at compile time proves
 * the contract. Also verifies SoftwareGovernancePack implements GroundTruthPack.
 */
import { describe, it, expect } from 'vitest';

import type { GroundTruthPack } from '../../../core/ground-truth/pack-interface.js';
import type {
  Observation,
  IntegrityFinding,
  TransitiveImpactClaim,
  CandidateEdge,
} from '../../../core/ground-truth/types.js';
import { SoftwareGovernancePack } from '../../../core/ground-truth/packs/software.js';

// ─── Compile-time conformance: mock that satisfies GroundTruthPack ──────────

const mockPack: GroundTruthPack = {
  domain: 'test-domain',
  version: '1.0.0',

  // Panel 1A
  queryPlanStatus: async (_projectId: string): Promise<Observation[]> => [],
  queryGovernanceHealth: async (_projectId: string): Promise<Observation[]> => [],
  queryEvidenceCoverage: async (_projectId: string): Promise<Observation[]> => [],
  queryRelevantClaims: async (_taskId: string, _filesTouched: string[], _projectId?: string): Promise<Observation[]> => [],

  // Panel 1B
  queryIntegritySurfaces: async (_projectId: string): Promise<IntegrityFinding[]> => [],

  // Panel 3
  queryTransitiveImpact: async (_filesTouched: string[], _projectId?: string): Promise<TransitiveImpactClaim[]> => [],
  queryCandidateModifies: async (_taskId: string, _projectId?: string): Promise<CandidateEdge[]> => [],

  // GTH-9
  queryClaimChainForTask: async (_taskId: string, _projectId?: string): Promise<Observation[]> => [],
  queryContradictionsForMilestone: async (_milestone: string, _projectId?: string): Promise<Observation[]> => [],
  queryOpenHypothesesForMilestone: async (_milestone: string, _projectId?: string): Promise<Observation[]> => [],

  // Optional close
  close: async (): Promise<void> => {},
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AUD-TC-11c | pack-interface.ts (GroundTruthPack interface)', () => {

  // ── Behavior 1: GroundTruthPack exports with readonly domain and version ──

  describe('Behavior 1: GroundTruthPack has required readonly domain and version fields', () => {
    it('mock pack has domain as string', () => {
      expect(typeof mockPack.domain).toBe('string');
      expect(mockPack.domain).toBe('test-domain');
    });

    it('mock pack has version as string', () => {
      expect(typeof mockPack.version).toBe('string');
      expect(mockPack.version).toBe('1.0.0');
    });

    it('SoftwareGovernancePack has domain and version', () => {
      // SoftwareGovernancePack constructor may need Neo4j — test the class shape
      expect(SoftwareGovernancePack.prototype).toHaveProperty('queryPlanStatus');
      // Verify domain/version on an instance (constructor is lenient)
      const pack = new SoftwareGovernancePack(null as any);
      expect(pack.domain).toBe('software-governance');
      expect(typeof pack.version).toBe('string');
    });
  });

  // ── Behavior 2: Panel 1A methods ──────────────────────────────────────

  describe('Behavior 2: Panel 1A methods — queryPlanStatus, queryGovernanceHealth, queryEvidenceCoverage, queryRelevantClaims', () => {
    it('queryPlanStatus accepts projectId and returns Promise<Observation[]>', async () => {
      const result = await mockPack.queryPlanStatus('proj_1');
      expect(Array.isArray(result)).toBe(true);
    });

    it('queryGovernanceHealth accepts projectId and returns Promise<Observation[]>', async () => {
      const result = await mockPack.queryGovernanceHealth('proj_1');
      expect(Array.isArray(result)).toBe(true);
    });

    it('queryEvidenceCoverage accepts projectId and returns Promise<Observation[]>', async () => {
      const result = await mockPack.queryEvidenceCoverage('proj_1');
      expect(Array.isArray(result)).toBe(true);
    });

    it('queryRelevantClaims accepts taskId, filesTouched, optional projectId and returns Promise<Observation[]>', async () => {
      const result = await mockPack.queryRelevantClaims('task_1', ['/src/a.ts'], 'proj_1');
      expect(Array.isArray(result)).toBe(true);

      // Also works without optional projectId
      const result2 = await mockPack.queryRelevantClaims('task_1', ['/src/a.ts']);
      expect(Array.isArray(result2)).toBe(true);
    });
  });

  // ── Behavior 3: Panel 1B method ───────────────────────────────────────

  describe('Behavior 3: Panel 1B method — queryIntegritySurfaces', () => {
    it('queryIntegritySurfaces accepts projectId and returns Promise<IntegrityFinding[]>', async () => {
      const result = await mockPack.queryIntegritySurfaces('proj_1');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ── Behavior 4: Panel 3 methods ───────────────────────────────────────

  describe('Behavior 4: Panel 3 methods — queryTransitiveImpact, queryCandidateModifies', () => {
    it('queryTransitiveImpact accepts filesTouched array and optional projectId', async () => {
      const result = await mockPack.queryTransitiveImpact(['/src/a.ts', '/src/b.ts'], 'proj_1');
      expect(Array.isArray(result)).toBe(true);

      const result2 = await mockPack.queryTransitiveImpact(['/src/a.ts']);
      expect(Array.isArray(result2)).toBe(true);
    });

    it('queryCandidateModifies accepts taskId and optional projectId', async () => {
      const result = await mockPack.queryCandidateModifies('task_1', 'proj_1');
      expect(Array.isArray(result)).toBe(true);

      const result2 = await mockPack.queryCandidateModifies('task_1');
      expect(Array.isArray(result2)).toBe(true);
    });
  });

  // ── Behavior 5: GTH-9 claim chain methods ─────────────────────────────

  describe('Behavior 5: GTH-9 methods — queryClaimChainForTask, queryContradictionsForMilestone, queryOpenHypothesesForMilestone', () => {
    it('queryClaimChainForTask accepts taskId and optional projectId', async () => {
      const result = await mockPack.queryClaimChainForTask('task_1', 'proj_1');
      expect(Array.isArray(result)).toBe(true);
    });

    it('queryContradictionsForMilestone accepts milestone and optional projectId', async () => {
      const result = await mockPack.queryContradictionsForMilestone('M1', 'proj_1');
      expect(Array.isArray(result)).toBe(true);
    });

    it('queryOpenHypothesesForMilestone accepts milestone and optional projectId', async () => {
      const result = await mockPack.queryOpenHypothesesForMilestone('M1');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ── Behavior 6: optional close() method ───────────────────────────────

  describe('Behavior 6: optional close() method for cleanup', () => {
    it('close() is callable when present', async () => {
      await expect(mockPack.close!()).resolves.toBeUndefined();
    });

    it('pack without close() still satisfies interface', () => {
      const packNoClose: GroundTruthPack = {
        domain: 'no-close',
        version: '0.1.0',
        queryPlanStatus: async () => [],
        queryGovernanceHealth: async () => [],
        queryEvidenceCoverage: async () => [],
        queryRelevantClaims: async () => [],
        queryIntegritySurfaces: async () => [],
        queryTransitiveImpact: async () => [],
        queryCandidateModifies: async () => [],
        queryClaimChainForTask: async () => [],
        queryContradictionsForMilestone: async () => [],
        queryOpenHypothesesForMilestone: async () => [],
        // No close() — it's optional
      };

      // If this compiles and we reach here, the interface allows omitting close()
      expect(packNoClose.close).toBeUndefined();
      expect(packNoClose.domain).toBe('no-close');
    });
  });

  // ── Behavior 7: all query methods return Promise ──────────────────────

  describe('Behavior 7: all query methods return Promise (async interface)', () => {
    const queryMethods = [
      'queryPlanStatus',
      'queryGovernanceHealth',
      'queryEvidenceCoverage',
      'queryRelevantClaims',
      'queryIntegritySurfaces',
      'queryTransitiveImpact',
      'queryCandidateModifies',
      'queryClaimChainForTask',
      'queryContradictionsForMilestone',
      'queryOpenHypothesesForMilestone',
    ] as const;

    it('every query method exists on the mock pack', () => {
      for (const method of queryMethods) {
        expect(typeof mockPack[method]).toBe('function');
      }
    });

    it('every query method returns a thenable (Promise)', () => {
      for (const method of queryMethods) {
        // Call with enough args to satisfy all signatures
        const result = (mockPack[method] as Function)('arg1', ['arg2'], 'arg3');
        expect(result).toHaveProperty('then');
        expect(typeof result.then).toBe('function');
      }
    });
  });

  // ── SoftwareGovernancePack conformance ─────────────────────────────────

  describe('SoftwareGovernancePack implements GroundTruthPack', () => {
    it('has all required query methods from the interface', () => {
      const proto = SoftwareGovernancePack.prototype;
      const requiredMethods = [
        'queryPlanStatus',
        'queryGovernanceHealth',
        'queryEvidenceCoverage',
        'queryRelevantClaims',
        'queryIntegritySurfaces',
        'queryTransitiveImpact',
        'queryCandidateModifies',
        'queryClaimChainForTask',
        'queryContradictionsForMilestone',
        'queryOpenHypothesesForMilestone',
      ];

      for (const method of requiredMethods) {
        expect(typeof (proto as any)[method]).toBe('function');
      }
    });

    it('has domain set to software-governance', () => {
      const pack = new SoftwareGovernancePack(null as any);
      expect(pack.domain).toBe('software-governance');
    });

    it('has a close method', () => {
      expect(typeof SoftwareGovernancePack.prototype.close).toBe('function');
    });

    // Compile-time check: this line would fail at build time if
    // SoftwareGovernancePack didn't implement GroundTruthPack
    it('is assignable to GroundTruthPack (compile-time check)', () => {
      // The fact that this function body compiles is the assertion.
      // We wrap in a runtime-reachable function so the compiler doesn't tree-shake.
      function checkAssignable(): GroundTruthPack {
        return new SoftwareGovernancePack(null as any);
      }
      const pack = checkAssignable();
      expect(pack.domain).toBe('software-governance');
    });
  });
});
