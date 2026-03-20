import { describe, it, expect } from 'vitest';
import {
  extractBacktickRefs,
  normalizeIdentifier,
  isLikelyFileRef,
  matchExplicitRefs,
  classifyAssetForEvidence,
  type CodeAsset,
} from '../../../../utils/evidence-auto-linker-utils.js';

describe('[TODO-4] evidence auto-linker explicit refs', () => {
  it('extracts unique backtick refs from task text', () => {
    const refs = extractBacktickRefs('Updated `src/a.ts` and `parseThing()` and again `src/a.ts`');
    expect(refs).toEqual(['src/a.ts', 'parseThing()']);
  });

  it('normalizes function identifiers with trailing parens', () => {
    expect(normalizeIdentifier('parseThing()')).toBe('parseThing');
    expect(normalizeIdentifier('ParserClass')).toBe('ParserClass');
  });

  it('detects likely file refs', () => {
    expect(isLikelyFileRef('src/core/parser.ts')).toBe(true);
    expect(isLikelyFileRef('parser.ts')).toBe(true);
    expect(isLikelyFileRef('parseThing')).toBe(false);
  });

  it('matches explicit file and identifier refs against assets', () => {
    const assets: CodeAsset[] = [
      { name: 'plan-parser.ts', filePath: '/repo/src/core/parsers/plan-parser.ts', elementId: 'sf1', kind: 'SourceFile' },
      { name: 'parsePlanProject', filePath: '/repo/src/core/parsers/plan-parser.ts', elementId: 'fn1', kind: 'Function' },
      { name: 'TaskNode', filePath: '/repo/src/core/parsers/types.ts', elementId: 'i1', kind: 'Interface' },
    ];

    const matches = matchExplicitRefs(
      'Updated `src/core/parsers/plan-parser.ts` and `parsePlanProject()` and `TaskNode`.',
      assets,
    );

    const ids = matches.map((m) => m.asset.elementId).sort();
    expect(ids).toEqual(['fn1', 'i1', 'sf1']);
    expect(matches.every((m) => m.matchType === 'explicit_ref')).toBe(true);
  });

  it('classifies label-family evidence types and roles deterministically', () => {
    expect(classifyAssetForEvidence({ name: 'x.ts', filePath: '/x.ts', elementId: '1', kind: 'SourceFile' })).toEqual({
      refType: 'file_path',
      evidenceRole: 'target',
    });
    expect(classifyAssetForEvidence({ name: 'A', filePath: '/x.ts', elementId: '2', kind: 'Class' })).toEqual({
      refType: 'class',
      evidenceRole: 'target',
    });
    expect(classifyAssetForEvidence({ name: 'I', filePath: '/x.ts', elementId: '3', kind: 'Interface' })).toEqual({
      refType: 'interface',
      evidenceRole: 'target',
    });
    expect(classifyAssetForEvidence({ name: 'test.ts', filePath: '/test.ts', elementId: '4', kind: 'TestFile' })).toEqual({
      refType: 'file_path',
      evidenceRole: 'proof',
    });
  });
});
