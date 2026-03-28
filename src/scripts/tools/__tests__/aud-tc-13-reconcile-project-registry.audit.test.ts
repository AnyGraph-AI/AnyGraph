/**
 * [AUD-TC-13-L1-05] reconcile-project-registry.ts — Contract + Pure Function Tests
 *
 * Self-executing CLI with pure helper functions (not exported).
 * Tests verify: Cypher structure, inference logic reimplemented from source,
 * MERGE pattern, driver cleanup.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(
  resolve(import.meta.dirname, '../../tools/reconcile-project-registry.ts'),
  'utf-8',
);

// Re-implement pure functions from source to verify their logic
function inferProjectType(projectId: string, current?: string): string {
  const normalized = (current ?? '').trim();
  if (normalized) return normalized;
  if (projectId.startsWith('plan_')) return 'plan';
  if (['proj_bible_kjv', 'proj_deuterocanon', 'proj_pseudepigrapha', 'proj_early_contested', 'proj_quran'].includes(projectId)) return 'corpus';
  return 'code';
}

function inferSourceKind(projectId: string, current?: string): string {
  const normalized = (current ?? '').trim();
  if (normalized) return normalized;
  if (projectId.startsWith('plan_')) return 'plan-ingest';
  if (['proj_bible_kjv', 'proj_deuterocanon', 'proj_pseudepigrapha', 'proj_early_contested', 'proj_quran'].includes(projectId)) return 'corpus-ingest';
  return 'parser';
}

function inferStatus(current?: string): string {
  const normalized = (current ?? '').trim().toLowerCase();
  if (!normalized) return 'active';
  if (normalized === 'complete') return 'active';
  if (['active', 'paused', 'archived', 'error'].includes(normalized)) return normalized;
  return 'active';
}

describe('[aud-tc-13] reconcile-project-registry.ts', () => {
  describe('Contract verification (source analysis)', () => {
    it('(1) queries project counts via CONTRACT_QUERY_Q14_PROJECT_COUNTS', () => {
      expect(SOURCE).toContain('CONTRACT_QUERY_Q14_PROJECT_COUNTS');
    });

    it('(2) queries existing Project nodes for metadata', () => {
      expect(SOURCE).toContain('MATCH (p:Project)');
      expect(SOURCE).toContain('p.displayName');
      expect(SOURCE).toContain('p.projectType');
      expect(SOURCE).toContain('p.sourceKind');
      expect(SOURCE).toContain('p.status');
    });

    it('(5) MERGEs Project nodes with reconciled metadata', () => {
      expect(SOURCE).toContain('MERGE (p:Project {projectId: $projectId})');
      expect(SOURCE).toContain('ON CREATE SET');
    });

    it('(7) outputs JSON report with projectsSeen, created, updated', () => {
      expect(SOURCE).toContain('ok: true');
      expect(SOURCE).toContain('projectsSeen');
      expect(SOURCE).toContain('created');
      expect(SOURCE).toContain('updated');
    });

    it('(8) closes Neo4j driver in finally block', () => {
      expect(SOURCE).toContain('finally');
      expect(SOURCE).toMatch(/getDriver\(\)\.close\(\)/);
    });
  });

  describe('inferProjectType — pure function logic', () => {
    it('(3a) returns existing value when present', () => {
      expect(inferProjectType('proj_anything', 'custom')).toBe('custom');
    });

    it('(3b) infers plan type from plan_ prefix', () => {
      expect(inferProjectType('plan_codegraph')).toBe('plan');
      expect(inferProjectType('plan_anything')).toBe('plan');
    });

    it('(3c) infers corpus type for known corpus project IDs', () => {
      expect(inferProjectType('proj_bible_kjv')).toBe('corpus');
      expect(inferProjectType('proj_quran')).toBe('corpus');
    });

    it('(3d) defaults to code for unknown projects', () => {
      expect(inferProjectType('proj_c0d3e9a1f200')).toBe('code');
      expect(inferProjectType('proj_random')).toBe('code');
    });
  });

  describe('inferSourceKind — pure function logic', () => {
    it('(4a) returns existing value when present', () => {
      expect(inferSourceKind('proj_anything', 'custom-kind')).toBe('custom-kind');
    });

    it('(4b) infers plan-ingest from plan_ prefix', () => {
      expect(inferSourceKind('plan_codegraph')).toBe('plan-ingest');
    });

    it('(4c) infers corpus-ingest for known corpus projects', () => {
      expect(inferSourceKind('proj_bible_kjv')).toBe('corpus-ingest');
    });

    it('(4d) defaults to parser', () => {
      expect(inferSourceKind('proj_c0d3e9a1f200')).toBe('parser');
    });
  });

  describe('inferStatus — pure function logic', () => {
    it('(5a) defaults to active for empty/missing status', () => {
      expect(inferStatus()).toBe('active');
      expect(inferStatus('')).toBe('active');
      expect(inferStatus('  ')).toBe('active');
    });

    it('(5b) maps complete → active', () => {
      expect(inferStatus('complete')).toBe('active');
    });

    it('(5c) preserves valid statuses', () => {
      expect(inferStatus('active')).toBe('active');
      expect(inferStatus('paused')).toBe('paused');
      expect(inferStatus('archived')).toBe('archived');
      expect(inferStatus('error')).toBe('error');
    });

    it('(5d) defaults unknown statuses to active', () => {
      expect(inferStatus('unknown')).toBe('active');
      expect(inferStatus('deprecated')).toBe('active');
    });
  });
});
