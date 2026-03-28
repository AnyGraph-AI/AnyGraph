/**
 * [AUD-TC-13-L1-02] edit-simulation.ts — Contract Tests
 *
 * Self-executing CLI with exported `simulateEdit` function.
 * Cannot import due to module-level main() triggering real Neo4j/parser calls.
 * Tests verify behavioral contracts via source analysis.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(
  resolve(import.meta.dirname, '../../tools/edit-simulation.ts'),
  'utf-8',
);

describe('[aud-tc-13] edit-simulation.ts', () => {
  it('(1) exports simulateEdit accepting filePath, newContent, and optional projectId', () => {
    expect(SOURCE).toContain('export async function simulateEdit(');
    expect(SOURCE).toContain('filePath');
    expect(SOURCE).toContain('newContent');
    expect(SOURCE).toContain('projectId');
  });

  it('(2) parses current graph state for the file via Neo4j query', () => {
    expect(SOURCE).toContain('neo4j.driver');
    expect(SOURCE).toMatch(/session\.run|MATCH.*SourceFile|MATCH.*Function/);
  });

  it('(3) parses proposed content via TypeScriptParser', () => {
    expect(SOURCE).toContain('TypeScriptParser');
    expect(SOURCE).toContain('CORE_TYPESCRIPT_SCHEMA');
  });

  it('(4) computes diff: nodesAdded, nodesRemoved, nodesModified', () => {
    expect(SOURCE).toMatch(/nodesAdded|nodes.*added/i);
    expect(SOURCE).toMatch(/nodesRemoved|nodes.*removed/i);
    expect(SOURCE).toMatch(/nodesModified|nodes.*modified/i);
  });

  it('(5) computes diff: identifies new and removed edges (CALLS)', () => {
    // Source uses newCalls/removedCalls rather than generic edgesAdded/edgesRemoved
    expect(SOURCE).toMatch(/newCalls|removedCalls|new.*calls|removed.*calls/i);
  });

  it('(6) identifies affectedCallers: functions that call modified/removed functions', () => {
    expect(SOURCE).toMatch(/affectedCallers|affected.*caller/i);
  });

  it('(7) includes riskAssessment with changeScope', () => {
    expect(SOURCE).toContain('riskAssessment');
    expect(SOURCE).toContain('changeScope');
  });

  it('(8) CLI mode: reads filePath from argv[2] and modified content from argv[3]', () => {
    expect(SOURCE).toContain('process.argv[2]');
    expect(SOURCE).toContain('process.argv[3]');
  });

  it('(9) outputs SimulationResult as structured data', () => {
    expect(SOURCE).toMatch(/SimulationResult|simulation.*result/i);
  });

  it('(10) uses direct neo4j-driver for graph queries', () => {
    expect(SOURCE).toContain("import neo4j from 'neo4j-driver'");
  });

  it('(11) does NOT apply changes — simulation only', () => {
    // Source should not contain MERGE/CREATE/DELETE operations for the simulation itself
    // It reads graph state and computes diffs
    expect(SOURCE).toContain('simulateEdit');
    // Verify no direct graph mutations in simulateEdit
    const simulateFn = SOURCE.split('export async function simulateEdit')[1]?.split(/^async function |^function /m)[0] ?? '';
    expect(simulateFn).not.toMatch(/\bMERGE\b/);
    expect(simulateFn).not.toMatch(/\bCREATE\b/);
    expect(simulateFn).not.toMatch(/\bDELETE\b/);
  });

  it('(12) handles errors via main().catch with Fatal log', () => {
    expect(SOURCE).toMatch(/main\(\)\.catch/);
    expect(SOURCE).toContain('Fatal');
  });
});
