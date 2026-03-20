import { describe, it, expect } from 'vitest';
import {
  FILE_RISK_LABEL_POLICY,
  CONFIG_RISK_PATTERN_POLICY,
  classifyConfigRisk,
  includedLabels,
  policyMap,
} from '../../../config/file-risk-label-policy.js';

describe('[TODO-4] file risk label coverage policy', () => {
  it('has unique labels and non-empty reasons', () => {
    const labels = FILE_RISK_LABEL_POLICY.map((e) => e.label);
    const uniq = new Set(labels);
    expect(uniq.size).toBe(labels.length);
    expect(FILE_RISK_LABEL_POLICY.every((e) => e.reason.trim().length >= 8)).toBe(true);
  });

  it('includes function-family labels for canonical derivation', () => {
    const included = includedLabels();
    expect(included).toContain('Function');
    expect(included).toContain('Method');
    expect(included).toContain('FunctionDeclaration');
  });

  it('accounts for non-function labels explicitly as excluded', () => {
    const p = policyMap();
    expect(p.get('Class')?.mode).toBe('excluded');
    expect(p.get('Field')?.mode).toBe('excluded');
    expect(p.get('Variable')?.mode).toBe('excluded');
    expect(p.get('Interface')?.mode).toBe('excluded');
    expect(p.get('TypeAlias')?.mode).toBe('excluded');
    expect(p.get('Import')?.mode).toBe('excluded');
    expect(p.get('TypeScript')?.mode).toBe('excluded');
    expect(p.get('Enum')?.mode).toBe('excluded');
    expect(p.get('Embedded')?.mode).toBe('excluded');
  });

  it('defines config-risk flag family patterns with explicit reasons', () => {
    expect(CONFIG_RISK_PATTERN_POLICY.length).toBeGreaterThan(0);
    expect(CONFIG_RISK_PATTERN_POLICY.every((e) => e.reason.trim().length >= 8)).toBe(true);
    expect(CONFIG_RISK_PATTERN_POLICY.some((e) => e.className === 'GOVERNANCE_CRITICAL_CONFIG')).toBe(true);
    expect(CONFIG_RISK_PATTERN_POLICY.some((e) => e.className === 'EXAMPLE_ASSET')).toBe(true);
  });

  it('classifies governance-critical config and example assets deterministically', () => {
    expect(classifyConfigRisk('/repo/codegraph/vitest.config.ts')).toBe('GOVERNANCE_CRITICAL_CONFIG');
    expect(classifyConfigRisk('/repo/codegraph/eslint.config.js')).toBe('GOVERNANCE_CRITICAL_CONFIG');
    expect(classifyConfigRisk('/repo/codegraph/examples/demo/basic.ts')).toBe('EXAMPLE_ASSET');
    expect(classifyConfigRisk('/repo/codegraph/src/core/parser.ts')).toBe('NONE');
  });
});
