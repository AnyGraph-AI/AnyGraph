/**
 * RF-17: Graph Write Gate (Project Registry Enforcement) — Spec Tests
 *
 * Spec requirements from VERIFICATION_GRAPH_ROADMAP.md:
 * 1) validateProjectWrite(projectId) blocks writes for unregistered projectIds
 * 2) Neo4jService write-path guard triggers for CREATE/MERGE with projectId param
 * 3) CLI register-project marks Project.registered=true for approved projects
 */

import { describe, it, expect, vi } from 'vitest';

import {
  validateProjectWrite,
  isProjectScopedWriteQuery,
  extractProjectIds,
  isWriteQuery,
  ProjectWriteValidationError,
} from '../../../../core/guards/project-write-guard.js';
import { runRegisterProject } from '../../../../cli/cli.js';

describe('RF-17: project write validation guard', () => {
  it('SPEC: validateProjectWrite throws for unregistered projectId', async () => {
    const close = vi.fn(async () => {});
    const run = vi.fn(async () => ({
      records: [{ get: (k: string) => (k === 'registered' ? false : undefined) }],
    }));

    const driver = {
      session: () => ({ run, close }),
    } as any;

    await expect(validateProjectWrite(driver, 'proj_unregistered')).rejects.toBeInstanceOf(ProjectWriteValidationError);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('SPEC: validateProjectWrite allows registered projectId', async () => {
    const close = vi.fn(async () => {});
    const run = vi.fn(async () => ({
      records: [{ get: (k: string) => (k === 'registered' ? true : undefined) }],
    }));

    const driver = {
      session: () => ({ run, close }),
    } as any;

    await expect(validateProjectWrite(driver, 'proj_c0d3e9a1f200')).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('SPEC: write guard recognizes broader write verbs and nested project ids', () => {
    expect(isWriteQuery('MATCH (n) RETURN count(n)')).toBe(false);
    expect(isWriteQuery('MATCH (n) SET n.foo = 1')).toBe(true);
    expect(isWriteQuery('MATCH (n) DETACH DELETE n')).toBe(true);
    expect(isWriteQuery('CALL apoc.create.relationship(a, "X", {}, b)')).toBe(true);

    expect(isProjectScopedWriteQuery('MATCH (n) RETURN count(n)', { projectId: 'p1' })).toBe(false);
    expect(isProjectScopedWriteQuery('CREATE (n:CodeNode {id:$id, projectId:$projectId})', { projectId: 'p1' })).toBe(true);
    expect(isProjectScopedWriteQuery('MATCH (n {projectId:$projectId}) SET n.x = 1', { projectId: 'p1' })).toBe(true);
    expect(isProjectScopedWriteQuery('MATCH (n {projectId:$projectId}) DETACH DELETE n', { projectId: 'p1' })).toBe(true);
    expect(isProjectScopedWriteQuery('UNWIND $nodes AS node MERGE (n {id: node.id}) SET n += node.props', {
      nodes: [{ id: 'a', props: { projectId: 'p_nested' } }],
    })).toBe(true);
    expect(isProjectScopedWriteQuery("MERGE (p:Project {projectId: 'proj_literal'}) SET p.name = 'x'", {})).toBe(true);
    expect(isProjectScopedWriteQuery('MERGE (n:CodeNode {id:$id})', {})).toBe(false);
  });

  it('SPEC: extractProjectIds resolves direct, nested, and literal query projectIds', () => {
    const ids = extractProjectIds(
      "MATCH (n {projectId: 'proj_literal'}) SET n.x = 1",
      {
        projectId: 'proj_root',
        edges: [{ props: { pid: 'proj_nested' } }],
      },
    );

    expect(ids).toContain('proj_root');
    expect(ids).toContain('proj_nested');
    expect(ids).toContain('proj_literal');
  });
});

describe('RF-17: register-project CLI', () => {
  it('SPEC: register-project writes Project.registered=true', async () => {
    const querySpy = vi.fn(async () => [{ projectId: 'proj_new', name: 'new', registered: true } as any]);

    await runRegisterProject('proj_new', 'new', querySpy as any);

    expect(querySpy).toHaveBeenCalled();
    const [cypher, params] = (querySpy.mock.calls[0] ?? []) as unknown as [string, Record<string, any>];
    expect(cypher).toContain('MERGE (p:Project');
    expect(cypher).toContain('registered = true');
    expect(params.projectId).toBe('proj_new');
    expect(params.name).toBe('new');
  });
});
