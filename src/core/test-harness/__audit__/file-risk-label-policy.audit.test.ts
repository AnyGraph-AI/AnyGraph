/**
 * AUD-TC-07-L2-02: file-risk-label-policy.ts — Behavioral Audit Tests (SHALLOW → strengthened)
 *
 * Verdict: SHALLOW — existing tests miss: (7) isGovernanceCriticalConfig/isExampleAssetPath
 *          convenience wrappers, tsconfig pattern, and explicit all-label enumeration.
 * Action: Strengthen in __audit__/ with missing behavioral coverage.
 *
 * Spec source: plans/codegraph/PLAN.md §Node Types (labels) + TODO-4 policy notes
 */
import { describe, it, expect } from 'vitest';
import {
  FILE_RISK_LABEL_POLICY,
  CONFIG_RISK_PATTERN_POLICY,
  classifyConfigRisk,
  includedLabels,
  policyMap,
  isGovernanceCriticalConfig,
  isExampleAssetPath,
} from '../../../core/config/file-risk-label-policy.js';

describe('AUD-TC-07-L2 | file-risk-label-policy.ts (strengthened)', () => {

  // ─── Behavior 1: FILE_RISK_LABEL_POLICY includes all observed Neo4j labels ─

  describe('Behavior 1: FILE_RISK_LABEL_POLICY includes all known label families', () => {
    const expectedLabels = [
      'Function', 'Method', 'FunctionDeclaration',
      'Class', 'Field', 'Variable', 'Interface', 'TypeAlias',
      'Import', 'TypeScript', 'Enum', 'Embedded', 'SourceFile',
    ];

    it.each(expectedLabels)('has entry for label "%s"', (label) => {
      const map = policyMap();
      expect(map.has(label)).toBe(true);
    });

    it('has no duplicate labels', () => {
      const labels = FILE_RISK_LABEL_POLICY.map(e => e.label);
      expect(new Set(labels).size).toBe(labels.length);
    });
  });

  // ─── Behavior 2: includedLabels() returns exactly Function/Method/FunctionDeclaration ──

  describe('Behavior 2: includedLabels() returns exactly Function/Method/FunctionDeclaration', () => {
    it('returns Function', () => {
      expect(includedLabels()).toContain('Function');
    });

    it('returns Method', () => {
      expect(includedLabels()).toContain('Method');
    });

    it('returns FunctionDeclaration', () => {
      expect(includedLabels()).toContain('FunctionDeclaration');
    });

    it('returns exactly 3 included labels', () => {
      expect(includedLabels()).toHaveLength(3);
    });
  });

  // ─── Behavior 3: policyMap returns correct mode/reason per label ──────────

  describe('Behavior 3: policyMap() returns correct mode and non-empty reason', () => {
    it('Function has mode included', () => {
      expect(policyMap().get('Function')?.mode).toBe('included');
    });

    it('Method has mode included', () => {
      expect(policyMap().get('Method')?.mode).toBe('included');
    });

    it('FunctionDeclaration has mode included', () => {
      expect(policyMap().get('FunctionDeclaration')?.mode).toBe('included');
    });

    it('Class has mode excluded', () => {
      expect(policyMap().get('Class')?.mode).toBe('excluded');
    });

    it('Interface has mode excluded', () => {
      expect(policyMap().get('Interface')?.mode).toBe('excluded');
    });

    it('SourceFile has mode excluded', () => {
      expect(policyMap().get('SourceFile')?.mode).toBe('excluded');
    });

    it('every entry has a non-empty reason', () => {
      for (const entry of FILE_RISK_LABEL_POLICY) {
        expect(entry.reason.trim().length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Behavior 4: every label has explicit mode (no implicit omission) ────

  describe('Behavior 4: every label has an explicit mode (no implicit omission)', () => {
    it('all modes are either "included" or "excluded"', () => {
      const validModes = new Set(['included', 'excluded']);
      for (const entry of FILE_RISK_LABEL_POLICY) {
        expect(validModes.has(entry.mode)).toBe(true);
      }
    });

    it('FILE_RISK_LABEL_POLICY is non-empty', () => {
      expect(FILE_RISK_LABEL_POLICY.length).toBeGreaterThan(0);
    });
  });

  // ─── Behavior 5: CONFIG_RISK_PATTERN_POLICY classifies governance configs ─

  describe('Behavior 5: CONFIG_RISK_PATTERN_POLICY classifies vitest.config/eslint.config/tsconfig', () => {
    it('vitest.config.ts → GOVERNANCE_CRITICAL_CONFIG', () => {
      expect(classifyConfigRisk('vitest.config.ts')).toBe('GOVERNANCE_CRITICAL_CONFIG');
    });

    it('vitest.config.mts → GOVERNANCE_CRITICAL_CONFIG', () => {
      expect(classifyConfigRisk('vitest.config.mts')).toBe('GOVERNANCE_CRITICAL_CONFIG');
    });

    it('vitest.config.js → GOVERNANCE_CRITICAL_CONFIG', () => {
      expect(classifyConfigRisk('vitest.config.js')).toBe('GOVERNANCE_CRITICAL_CONFIG');
    });

    it('eslint.config.ts → GOVERNANCE_CRITICAL_CONFIG', () => {
      expect(classifyConfigRisk('eslint.config.ts')).toBe('GOVERNANCE_CRITICAL_CONFIG');
    });

    it('eslint.config.mjs → GOVERNANCE_CRITICAL_CONFIG', () => {
      expect(classifyConfigRisk('eslint.config.mjs')).toBe('GOVERNANCE_CRITICAL_CONFIG');
    });

    it('tsconfig.json → GOVERNANCE_CRITICAL_CONFIG', () => {
      expect(classifyConfigRisk('tsconfig.json')).toBe('GOVERNANCE_CRITICAL_CONFIG');
    });

    it('tsconfig.build.json → GOVERNANCE_CRITICAL_CONFIG', () => {
      expect(classifyConfigRisk('tsconfig.build.json')).toBe('GOVERNANCE_CRITICAL_CONFIG');
    });

    it('/repo/project/vitest.config.ts → GOVERNANCE_CRITICAL_CONFIG (path prefix)', () => {
      expect(classifyConfigRisk('/repo/project/vitest.config.ts')).toBe('GOVERNANCE_CRITICAL_CONFIG');
    });
  });

  // ─── Behavior 6: classifyConfigRisk returns NONE for unmatched paths ──────

  describe('Behavior 6: classifyConfigRisk returns NONE for unmatched paths', () => {
    it('src/core/parser.ts → NONE', () => {
      expect(classifyConfigRisk('src/core/parser.ts')).toBe('NONE');
    });

    it('package.json → NONE', () => {
      expect(classifyConfigRisk('package.json')).toBe('NONE');
    });

    it('null → NONE', () => {
      expect(classifyConfigRisk(null)).toBe('NONE');
    });

    it('undefined → NONE', () => {
      expect(classifyConfigRisk(undefined)).toBe('NONE');
    });

    it('empty string → NONE', () => {
      expect(classifyConfigRisk('')).toBe('NONE');
    });

    it('my-tsconfig-like-name.ts → NONE (not actually tsconfig)', () => {
      // Should not match tsconfig pattern
      expect(classifyConfigRisk('my-tsconfig-like-name.ts')).toBe('NONE');
    });
  });

  // ─── Behavior 7: convenience wrapper functions ────────────────────────────

  describe('Behavior 7: isGovernanceCriticalConfig and isExampleAssetPath convenience wrappers', () => {
    it('isGovernanceCriticalConfig("vitest.config.ts") → true', () => {
      expect(isGovernanceCriticalConfig('vitest.config.ts')).toBe(true);
    });

    it('isGovernanceCriticalConfig("tsconfig.json") → true', () => {
      expect(isGovernanceCriticalConfig('tsconfig.json')).toBe(true);
    });

    it('isGovernanceCriticalConfig("eslint.config.mjs") → true', () => {
      expect(isGovernanceCriticalConfig('eslint.config.mjs')).toBe(true);
    });

    it('isGovernanceCriticalConfig("src/parser.ts") → false', () => {
      expect(isGovernanceCriticalConfig('src/parser.ts')).toBe(false);
    });

    it('isGovernanceCriticalConfig(null) → false', () => {
      expect(isGovernanceCriticalConfig(null)).toBe(false);
    });

    it('isExampleAssetPath("examples/demo/basic.ts") → true', () => {
      expect(isExampleAssetPath('examples/demo/basic.ts')).toBe(true);
    });

    it('isExampleAssetPath("/repo/examples/foo.ts") → true', () => {
      expect(isExampleAssetPath('/repo/examples/foo.ts')).toBe(true);
    });

    it('isExampleAssetPath("src/core/parser.ts") → false', () => {
      expect(isExampleAssetPath('src/core/parser.ts')).toBe(false);
    });

    it('isExampleAssetPath(null) → false', () => {
      expect(isExampleAssetPath(null)).toBe(false);
    });

    it('isGovernanceCriticalConfig and isExampleAssetPath are mutually exclusive', () => {
      const testPaths = [
        'vitest.config.ts', 'tsconfig.json', 'eslint.config.mjs',
        'examples/demo.ts', 'src/parser.ts', 'README.md',
      ];
      for (const p of testPaths) {
        const critical = isGovernanceCriticalConfig(p);
        const example = isExampleAssetPath(p);
        // Cannot be both
        expect(critical && example).toBe(false);
      }
    });
  });
});
