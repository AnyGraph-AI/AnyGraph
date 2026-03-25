// NOTE: This file covers 4 modules (printOutput, governance-metrics-snapshot, create-state-field-nodes, temporal-coupling) as a characterization test. No single TDD_ROADMAP milestone governs this scope. See FIND-11b-07.
/**
 * Historical override debt backfill — characterization/spec tests
 *
 * Targets CRITICAL untested files from commits c65084c + 037d4a7.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Project } from 'ts-morph';

import { printOutput } from '../../../ground-truth/cli.js';
import {
  toNum as gmToNum,
  toBool,
  toStr,
  round,
  stableJson,
  sha256,
} from '../../../../utils/governance-metrics-snapshot.js';
import {
  toNum as sfToNum,
  fieldId,
  extractMutableFields,
  extractStateAccess,
} from '../../../../scripts/enrichment/create-state-field-nodes.js';

vi.mock('child_process', () => ({
  execSync: vi.fn(() => Buffer.from([
    'COMMIT:11111111:2026-03-10T10:00:00Z',
    'src/a.ts',
    'src/b.ts',
    'COMMIT:22222222:2026-03-11T10:00:00Z',
    'src/a.ts',
    'src/b.ts',
    'COMMIT:33333333:2026-03-12T10:00:00Z',
    'src/a.ts',
    'src/c.ts',
  ].join('\n'))),
}));

import { mineCoChanges } from '../../../../scripts/enrichment/temporal-coupling.js';

describe('override debt backfill coverage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('printOutput renders a minimal ground-truth payload without throwing', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const output = {
      panel1: {
        planStatus: [],
        governanceHealth: [],
        evidenceCoverage: [],
        temporalConfidence: [],
        contradictions: [],
        openHypotheses: [],
        integrity: {
          summary: { passed: 1, totalChecks: 1, criticalFailures: 0 },
          core: [],
          domain: [],
        },
      },
      panel2: {
        agentId: 'watson',
        status: 'ok',
        briefing: null,
        sessionBookmark: null,
      },
      panel3: { deltas: [] },
      meta: {
        projectId: 'proj_c0d3e9a1f200',
        depth: 'light',
        durationMs: 1,
        runAt: '2026-03-17T00:00:00.000Z',
      },
    } as any;

    expect(() => printOutput(output, false)).not.toThrow();
    expect(log).toHaveBeenCalled();
  });

  it('governance metric helpers normalize values deterministically', () => {
    expect(gmToNum({ toNumber: () => 7 })).toBe(7);
    expect(toBool('TRUE')).toBe(true);
    expect(toStr(null)).toBe('');
    expect(round(1.23456, 3)).toBe(1.235);
    expect(stableJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(sha256('abc')).toHaveLength(64);
  });

  it('state-field helpers extract mutable fields and access patterns', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile('src/sample.ts', `
      class Counter {
        private count = 0;
        readonly id = 'x';
        bump() { this.count = this.count + 1; }
        read() { return this.count; }
      }
      let mutableTop = 1;
      const immutableTop = 2;
    `);

    const fields = extractMutableFields(project);
    expect(fields.some((f) => f.name === 'count' && f.className === 'Counter')).toBe(true);
    expect(fields.some((f) => f.name === 'mutableTop' && f.className === null)).toBe(true);
    expect(fields.some((f) => f.name === 'id')).toBe(false);

    const accesses = extractStateAccess(project, fields, 'proj_c0d3e9a1f200');
    expect(accesses.some((a) => a.accessorName === 'bump' && a.isWrite)).toBe(true);
    expect(accesses.some((a) => a.accessorName === 'read' && !a.isWrite)).toBe(true);

    expect(sfToNum({ toNumber: () => 5 })).toBe(5);
    expect(fieldId('p', sf.getFilePath(), 'Counter', 'count')).toMatch(/^p:Field:/);
  });

  it('temporal coupling miner returns co-change pairs with threshold >=2', () => {
    const pairs = mineCoChanges('/tmp/fake-repo');
    expect(pairs.length).toBe(1);
    expect(pairs[0].file1).toBe('src/a.ts');
    expect(pairs[0].file2).toBe('src/b.ts');
    expect(pairs[0].coChangeCount).toBe(2);
  });
});
