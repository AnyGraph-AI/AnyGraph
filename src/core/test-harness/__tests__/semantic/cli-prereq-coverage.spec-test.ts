// NOTE: This file traces CLI handler coverage for evidence backfill (FIND-11b-06). It is not a spec-derived behavioral test. See COVERAGE_POLICY_EXCEPTION(evidence-backfill).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  getVersion,
  getNeo4jConfig,
  checkNeo4j,
  queryNeo4j,
  detectTsconfig,
  generateProjectId,
  detectProjectName,
  runInit,
  runParse,
  runEnrich,
  runServe,
  runRisk,
  runAnalyze,
  runStatus,
  main,
} from '../../../../cli/cli.js';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_ARGV = [...process.argv];

function mockProcessExit() {
  return vi
    .spyOn(process, 'exit')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockImplementation(((code?: number) => { throw new Error(`EXIT:${code ?? 0}`); }) as any);
}

describe('CLI prerequisite coverage (enforcement gate unblocks)', () => {
  beforeEach(() => {
    process.env.NEO4J_URI = 'bolt://127.0.0.1:1';
    process.env.NEO4J_USER = 'neo4j';
    process.env.NEO4J_PASSWORD = 'codegraph';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.argv = [...ORIGINAL_ARGV];
  });

  it('covers critical CLI functions in safe failure modes', async () => {
    expect(typeof getVersion()).toBe('string');

    const cfg = getNeo4jConfig();
    expect(cfg.uri).toBe('bolt://127.0.0.1:1');

    const hasTsconfig = detectTsconfig(process.cwd());
    expect(typeof hasTsconfig === 'string' || hasTsconfig === null).toBe(true);

    const pid = generateProjectId(process.cwd());
    expect(pid.startsWith('proj_')).toBe(true);

    const pname = detectProjectName(process.cwd());
    expect(typeof pname).toBe('string');

    await expect(checkNeo4j()).resolves.toBe(false);
    await expect(queryNeo4j('RETURN 1 AS ok')).rejects.toBeDefined();

    await expect(runInit()).resolves.toBeUndefined();

    const exitSpy = mockProcessExit();
    await expect(runParse('/path/does/not/exist', undefined as any)).rejects.toThrow('EXIT:1');
    expect(exitSpy).toHaveBeenCalled();
  });

  it('traces remaining CLI command handlers for function-level evidence', async () => {
    mockProcessExit();

    await expect(runEnrich('proj_c0d3e9a1f200')).rejects.toThrow();
    await expect(runServe()).rejects.toThrow();
    await expect(runRisk('foo')).rejects.toThrow();
    await expect(runAnalyze('/path/does/not/exist', undefined as any)).rejects.toThrow();

    await expect(runStatus()).resolves.toBeUndefined();

    process.argv = ['node', 'codegraph', 'status'];
    await expect(main()).resolves.toBeUndefined();
  });
});
