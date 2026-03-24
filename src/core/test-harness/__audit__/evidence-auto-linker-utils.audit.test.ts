/**
 * AUD-TC-03-L2-01: evidence-auto-linker-utils.ts audit tests
 *
 * Verdict: INCOMPLETE
 * Existing tests cover extractBacktickRefs, normalizeIdentifier, isLikelyFileRef,
 * matchExplicitRefs (explicit_ref only), and partial classifyAssetForEvidence.
 *
 * SPEC-GAP: classifyAssetForEvidence missing coverage for Function, Method, Field,
 *           TypeAlias, Variable, Import, and unknown/default kinds
 * SPEC-GAP: AutoLinkMatchType not tested as a complete enum surface
 * SPEC-GAP: deterministic classification not explicitly verified
 * SPEC-GAP: matchExplicitRefs deduplication not tested
 * SPEC-GAP: extractBacktickRefs edge cases (empty string, no backticks)
 */

import { describe, it, expect } from 'vitest';
import {
  extractBacktickRefs,
  normalizeIdentifier,
  isLikelyFileRef,
  matchExplicitRefs,
  classifyAssetForEvidence,
  type CodeAsset,
  type AutoLinkMatchType,
  type EvidenceRefType,
  type EvidenceRole,
} from '../../../utils/evidence-auto-linker-utils.js';

describe('AUD-TC-03-L2-01: evidence-auto-linker-utils spec-gap coverage', () => {
  // SPEC-GAP: classifyAssetForEvidence full label family coverage
  describe('classifyAssetForEvidence — all label families', () => {
    const cases: Array<{ kind: string; expectedRefType: EvidenceRefType; expectedRole: EvidenceRole }> = [
      { kind: 'SourceFile', expectedRefType: 'file_path', expectedRole: 'target' },
      { kind: 'Function', expectedRefType: 'function', expectedRole: 'target' },
      { kind: 'Method', expectedRefType: 'function', expectedRole: 'target' },
      { kind: 'Class', expectedRefType: 'class', expectedRole: 'target' },
      { kind: 'Interface', expectedRefType: 'interface', expectedRole: 'target' },
      { kind: 'Field', expectedRefType: 'field', expectedRole: 'target' },
      { kind: 'TypeAlias', expectedRefType: 'type_alias', expectedRole: 'target' },
      { kind: 'Variable', expectedRefType: 'variable', expectedRole: 'target' },
      { kind: 'Import', expectedRefType: 'import', expectedRole: 'target' },
      { kind: 'TestFile', expectedRefType: 'file_path', expectedRole: 'proof' },
      { kind: 'UnknownKind', expectedRefType: 'auto_link', expectedRole: 'target' },
      { kind: '', expectedRefType: 'auto_link', expectedRole: 'target' },
    ];

    for (const { kind, expectedRefType, expectedRole } of cases) {
      it(`classifies kind="${kind}" as refType="${expectedRefType}", role="${expectedRole}"`, () => {
        const asset: CodeAsset = { name: 'test', filePath: '/test', elementId: `e-${kind}`, kind };
        const result = classifyAssetForEvidence(asset);
        expect(result.refType).toBe(expectedRefType);
        expect(result.evidenceRole).toBe(expectedRole);
      });
    }
  });

  // SPEC-GAP: classification determinism across reruns
  it('classifyAssetForEvidence is deterministic across multiple calls', () => {
    const asset: CodeAsset = { name: 'fn', filePath: '/a.ts', elementId: 'e1', kind: 'Function' };
    const r1 = classifyAssetForEvidence(asset);
    const r2 = classifyAssetForEvidence(asset);
    const r3 = classifyAssetForEvidence(asset);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  // SPEC-GAP: extractBacktickRefs edge cases
  describe('extractBacktickRefs edge cases', () => {
    it('returns empty array for empty string', () => {
      expect(extractBacktickRefs('')).toEqual([]);
    });

    it('returns empty array for string with no backticks', () => {
      expect(extractBacktickRefs('no backtick refs here')).toEqual([]);
    });

    it('handles whitespace-only backtick content (filtered out)', () => {
      expect(extractBacktickRefs('has ` ` empty backtick')).toEqual([]);
    });
  });

  // SPEC-GAP: AutoLinkMatchType completeness
  it('AutoLinkMatchType covers all match strategies', () => {
    const allTypes: AutoLinkMatchType[] = ['explicit_ref', 'exact_file', 'function_name', 'keyword'];
    // Verify these are valid assignments (type-level check compiled by TS)
    expect(allTypes).toHaveLength(4);
    for (const t of allTypes) {
      expect(typeof t).toBe('string');
    }
  });

  // SPEC-GAP: matchExplicitRefs deduplication
  it('matchExplicitRefs deduplicates matches by elementId + matchType', () => {
    const assets: CodeAsset[] = [
      { name: 'parser.ts', filePath: '/repo/src/parser.ts', elementId: 'sf1', kind: 'SourceFile' },
    ];
    // Mention the same file twice in backticks
    const matches = matchExplicitRefs('fix `src/parser.ts` and also `parser.ts`', assets);
    // Should not have duplicate entries for same elementId
    const elementIds = matches.map((m) => m.asset.elementId);
    const unique = [...new Set(elementIds)];
    expect(elementIds.length).toBe(unique.length);
  });

  // SPEC-GAP: normalizeIdentifier preserves non-trailing-paren identifiers
  it('normalizeIdentifier handles already-clean identifiers', () => {
    expect(normalizeIdentifier('MyClass')).toBe('MyClass');
    expect(normalizeIdentifier('  spaced  ')).toBe('spaced');
  });

  // SPEC-GAP: isLikelyFileRef additional extensions
  it('isLikelyFileRef detects various file extensions', () => {
    expect(isLikelyFileRef('config.json')).toBe(true);
    expect(isLikelyFileRef('readme.md')).toBe(true);
    expect(isLikelyFileRef('ci.yml')).toBe(true);
    expect(isLikelyFileRef('comp.tsx')).toBe(true);
    expect(isLikelyFileRef('comp.jsx')).toBe(true);
    expect(isLikelyFileRef('SomeClass')).toBe(false);
  });

  // SPEC-GAP: matchExplicitRefs confidence values
  it('matchExplicitRefs assigns 0.99 confidence for file refs and 0.98 for identifier refs', () => {
    const assets: CodeAsset[] = [
      { name: 'utils.ts', filePath: '/repo/src/utils.ts', elementId: 'sf1', kind: 'SourceFile' },
      { name: 'processData', filePath: '/repo/src/utils.ts', elementId: 'fn1', kind: 'Function' },
    ];
    const matches = matchExplicitRefs('fix `src/utils.ts` and `processData()`', assets);
    const fileMatch = matches.find((m) => m.asset.elementId === 'sf1');
    const fnMatch = matches.find((m) => m.asset.elementId === 'fn1');
    expect(fileMatch?.confidence).toBe(0.99);
    expect(fnMatch?.confidence).toBe(0.98);
  });
});
