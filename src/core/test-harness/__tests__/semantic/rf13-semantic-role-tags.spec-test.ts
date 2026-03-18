/**
 * RF-13 — Semantic Role Tagging + God File Identification
 *
 * Spec checks:
 * 1) Convention/path mapping assigns expected semanticRole values.
 * 2) Interface fallback assigns role when path mapping does not match.
 * 3) Default role remains explicit and non-null.
 */
import { describe, it, expect } from 'vitest';

import {
  assignSemanticRole,
  inferRoleFromPath,
  inferRoleFromInterface,
  normalizePath,
} from '../../../../scripts/enrichment/create-semantic-role-tags.js';

describe('RF-13 semantic role tagging', () => {
  const roleMap = {
    version: 'test.v1',
    defaultRole: 'unclassified',
    rules: [
      { pattern: '**/src/core/parsers/**', role: 'parser' },
      { pattern: '**/src/scripts/enrichment/**', role: 'enrichment' },
      { pattern: '**/src/mcp/tools/**', role: 'mcp-tool' },
      { pattern: '**/src/scripts/entry/**', role: 'entry-script' },
    ],
  } as const;

  it('normalizes windows paths', () => {
    expect(normalizePath('C:\\repo\\src\\core\\parsers\\x.ts')).toContain('/src/core/parsers/x.ts');
  });

  it('assigns convention roles from path map', () => {
    expect(inferRoleFromPath('/repo/src/core/parsers/typescript-parser.ts', roleMap as any)).toBe('parser');
    expect(inferRoleFromPath('/repo/src/scripts/enrichment/create-state-field-nodes.ts', roleMap as any)).toBe('enrichment');
    expect(inferRoleFromPath('/repo/src/mcp/tools/ground-truth.tool.ts', roleMap as any)).toBe('mcp-tool');
  });

  it('assigns interface role when path map does not match', () => {
    const role = inferRoleFromInterface('/repo/custom/unknown.ts', 'export class EvidenceAdapter {}');
    expect(role).toBe('adapter');
  });

  it('returns default role when no path or interface signals match', () => {
    const assigned = assignSemanticRole('/repo/misc/file.ts', 'const x = 1;', roleMap as any);
    expect(assigned.role).toBe('unclassified');
    expect(assigned.source).toBe('default');
  });
});
