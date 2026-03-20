import { describe, it, expect } from 'vitest';
import {
  FILE_RISK_LABEL_POLICY,
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
});
