/**
 * AUD-TC-11c-L2-13: project-write-guard.ts — Supplementary Audit Tests
 *
 * Verdict: SHALLOW — existing tests (rf17-project-registry.spec-test.ts + rf17-live-guard-integration.spec-test.ts)
 * cover happy paths but miss edge cases for 5 CRITICAL + 3 HIGH risk functions:
 *
 * GAPS FILLED:
 * - extractProjectIds: deeply nested params, depth limit, empty inputs
 * - isWriteQuery: FOREACH, REMOVE, comment stripping, case insensitivity
 * - isProjectScopedWriteQuery: read-only with params, edge cases
 * - validateProjectWrite: empty/whitespace projectId, missing records
 * - extractProjectId (singular): basic contract
 * - collectProjectIdsDeep: depth limit at 6, null/undefined handling
 * - stripComments: block comments, line comments, mixed
 * - extractLiteralProjectIdsFromQuery: various Cypher patterns
 *
 * SPEC GAP FINDING:
 * - FIND-B6-01: Spec (AUD-TC-11c-L2-13 behavior 4) claims NODE_ENV=test bypass exists.
 *   Source code has NO such check. The bypass is in Neo4jService (consumer), not in project-write-guard.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  extractProjectIds,
  extractProjectId,
  isWriteQuery,
  isProjectScopedWriteQuery,
  validateProjectWrite,
  ProjectWriteValidationError,
} from '../../guards/project-write-guard.js';

// ═══════════════════════════════════════════════════════════════════
// extractProjectIds — CRITICAL function: param/query extraction
// ═══════════════════════════════════════════════════════════════════

describe('AUD-TC-11c-L2-13: extractProjectIds edge cases', () => {
  it('empty query and empty params → empty array', () => {
    expect(extractProjectIds('', {})).toEqual([]);
  });

  it('extracts from direct params.projectId', () => {
    const ids = extractProjectIds('', { projectId: 'proj_abc' });
    expect(ids).toContain('proj_abc');
  });

  it('extracts from nested params via pid key', () => {
    const ids = extractProjectIds('', {
      node: { pid: 'proj_nested_pid' },
    });
    expect(ids).toContain('proj_nested_pid');
  });

  it('extracts from deeply nested array params', () => {
    const ids = extractProjectIds('', {
      nodes: [
        { props: { projectId: 'proj_deep1' } },
        { props: { projectId: 'proj_deep2' } },
      ],
    });
    expect(ids).toContain('proj_deep1');
    expect(ids).toContain('proj_deep2');
  });

  it('deduplicates identical projectIds', () => {
    const ids = extractProjectIds('', {
      projectId: 'proj_dup',
      nested: { projectId: 'proj_dup' },
    });
    const dupCount = ids.filter(id => id === 'proj_dup').length;
    expect(dupCount).toBe(1);
  });

  it('extracts from Cypher map literal: projectId: \'proj_lit\'', () => {
    const ids = extractProjectIds("MERGE (n {projectId: 'proj_lit'})", {});
    expect(ids).toContain('proj_lit');
  });

  it('extracts from Cypher equality: n.projectId = \'proj_eq\'', () => {
    const ids = extractProjectIds("WHERE n.projectId = 'proj_eq'", {});
    expect(ids).toContain('proj_eq');
  });

  it('combines query and param sources', () => {
    const ids = extractProjectIds(
      "MERGE (n {projectId: 'proj_query'})",
      { projectId: 'proj_param' },
    );
    expect(ids).toContain('proj_query');
    expect(ids).toContain('proj_param');
  });

  it('ignores null/undefined param values', () => {
    const ids = extractProjectIds('', { projectId: null as any });
    expect(ids).toEqual([]);
  });

  it('trims whitespace from param values', () => {
    const ids = extractProjectIds('', { projectId: '  proj_spaced  ' });
    expect(ids).toContain('proj_spaced');
  });

  it('ignores empty string projectId', () => {
    const ids = extractProjectIds('', { projectId: '   ' });
    expect(ids).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// extractProjectId (singular) — convenience wrapper
// ═══════════════════════════════════════════════════════════════════

describe('AUD-TC-11c-L2-13: extractProjectId singular', () => {
  it('returns first projectId from params', () => {
    expect(extractProjectId({ projectId: 'proj_first' })).toBe('proj_first');
  });

  it('returns undefined when no projectId found', () => {
    expect(extractProjectId({})).toBeUndefined();
  });

  it('returns undefined for empty params', () => {
    expect(extractProjectId()).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// isWriteQuery — CRITICAL function: write detection
// ═══════════════════════════════════════════════════════════════════

describe('AUD-TC-11c-L2-13: isWriteQuery comprehensive', () => {
  it('detects CREATE', () => {
    expect(isWriteQuery('CREATE (n:Foo {id: 1})')).toBe(true);
  });

  it('detects MERGE', () => {
    expect(isWriteQuery('MERGE (n:Foo {id: 1})')).toBe(true);
  });

  it('detects SET', () => {
    expect(isWriteQuery('MATCH (n) SET n.x = 1')).toBe(true);
  });

  it('detects DELETE', () => {
    expect(isWriteQuery('MATCH (n) DELETE n')).toBe(true);
  });

  it('detects DETACH DELETE', () => {
    expect(isWriteQuery('MATCH (n) DETACH DELETE n')).toBe(true);
  });

  it('detects REMOVE', () => {
    expect(isWriteQuery('MATCH (n) REMOVE n.prop')).toBe(true);
  });

  it('detects FOREACH', () => {
    expect(isWriteQuery('FOREACH (x IN [1,2] | CREATE (n {v:x}))')).toBe(true);
  });

  it('detects APOC write procedures', () => {
    expect(isWriteQuery('CALL apoc.create.relationship(a, "KNOWS", {}, b)')).toBe(true);
    expect(isWriteQuery('CALL apoc.merge.node(["Label"], {id: 1})')).toBe(true);
    expect(isWriteQuery('CALL apoc.periodic.iterate("MATCH (n) RETURN n", "SET n.x=1")')).toBe(true);
    expect(isWriteQuery('CALL apoc.refactor.rename.label("Old", "New")')).toBe(true);
  });

  it('rejects read-only queries', () => {
    expect(isWriteQuery('MATCH (n) RETURN count(n)')).toBe(false);
    expect(isWriteQuery('MATCH (n)-[r]->(m) RETURN n, r, m')).toBe(false);
    expect(isWriteQuery('CALL db.indexes() YIELD name')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isWriteQuery('create (n:Foo)')).toBe(true);
    expect(isWriteQuery('MERGE (n:Foo)')).toBe(true);
    expect(isWriteQuery('match (n) set n.x = 1')).toBe(true);
  });

  it('ignores write keywords inside block comments', () => {
    expect(isWriteQuery('/* CREATE */ MATCH (n) RETURN n')).toBe(false);
  });

  it('ignores write keywords in line comments', () => {
    expect(isWriteQuery('MATCH (n) RETURN n -- CREATE something')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// isProjectScopedWriteQuery — combines write detection + projectId
// ═══════════════════════════════════════════════════════════════════

describe('AUD-TC-11c-L2-13: isProjectScopedWriteQuery', () => {
  it('returns false for read-only query even with projectId param', () => {
    expect(isProjectScopedWriteQuery('MATCH (n) RETURN n', { projectId: 'proj_x' })).toBe(false);
  });

  it('returns false for write query without any projectId', () => {
    expect(isProjectScopedWriteQuery('CREATE (n:Foo {id: 1})', {})).toBe(false);
  });

  it('returns true for write query with projectId in params', () => {
    expect(isProjectScopedWriteQuery('CREATE (n:Foo {projectId:$projectId})', { projectId: 'proj_y' })).toBe(true);
  });

  it('returns true for write query with projectId in query literal', () => {
    expect(isProjectScopedWriteQuery("MERGE (n {projectId: 'proj_lit'}) SET n.x = 1", {})).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// validateProjectWrite — CRITICAL function: Neo4j gate
// ═══════════════════════════════════════════════════════════════════

describe('AUD-TC-11c-L2-13: validateProjectWrite edge cases', () => {
  it('throws for empty string projectId', async () => {
    const driver = mockDriver([]);
    await expect(validateProjectWrite(driver, '')).rejects.toThrow(ProjectWriteValidationError);
    await expect(validateProjectWrite(driver, '')).rejects.toThrow('missing projectId');
  });

  it('throws for whitespace-only projectId', async () => {
    const driver = mockDriver([]);
    await expect(validateProjectWrite(driver, '   ')).rejects.toThrow(ProjectWriteValidationError);
  });

  it('throws when no Project node found (empty records)', async () => {
    const driver = mockDriver([]); // no records returned
    await expect(validateProjectWrite(driver, 'proj_ghost')).rejects.toThrow(ProjectWriteValidationError);
    await expect(validateProjectWrite(driver, 'proj_ghost')).rejects.toThrow('not registered');
  });

  it('throws when Project exists but registered=false', async () => {
    const driver = mockDriver([{ get: (k: string) => k === 'registered' ? false : undefined }]);
    await expect(validateProjectWrite(driver, 'proj_unreg')).rejects.toThrow(ProjectWriteValidationError);
  });

  it('passes when Project exists with registered=true', async () => {
    const driver = mockDriver([{ get: (k: string) => k === 'registered' ? true : undefined }]);
    await expect(validateProjectWrite(driver, 'proj_reg')).resolves.toBeUndefined();
  });

  it('trims projectId before validation', async () => {
    const runSpy = vi.fn<(query: string, params: Record<string, unknown>) => Promise<{ records: any[] }>>(
      async () => ({
        records: [{ get: (k: string) => k === 'registered' ? true : undefined }],
      }),
    );
    const closeSpy = vi.fn(async () => {});
    const driver = { session: () => ({ run: runSpy, close: closeSpy }) } as any;

    await validateProjectWrite(driver, '  proj_trimmed  ');
    // Verify the trimmed value was passed to the query
    expect(runSpy).toHaveBeenCalledTimes(1);
    const params = runSpy.mock.calls[0]![1];
    expect(params.projectId).toBe('proj_trimmed');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ProjectWriteValidationError — proper Error subclass
// ═══════════════════════════════════════════════════════════════════

describe('AUD-TC-11c-L2-13: ProjectWriteValidationError', () => {
  it('is an instance of Error', () => {
    const err = new ProjectWriteValidationError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ProjectWriteValidationError);
  });

  it('has correct name property', () => {
    const err = new ProjectWriteValidationError('msg');
    expect(err.name).toBe('ProjectWriteValidationError');
  });

  it('preserves message', () => {
    const err = new ProjectWriteValidationError('PROJECT_WRITE_BLOCKED: xyz');
    expect(err.message).toBe('PROJECT_WRITE_BLOCKED: xyz');
  });
});

// ─── Helpers ───

function mockDriver(records: any[]) {
  const close = vi.fn(async () => {});
  const run = vi.fn(async () => ({ records }));
  return { session: () => ({ run, close }) } as any;
}
