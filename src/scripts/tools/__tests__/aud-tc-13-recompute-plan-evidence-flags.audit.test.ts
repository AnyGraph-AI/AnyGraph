/**
 * [AUD-TC-13-L1-04] recompute-plan-evidence-flags.ts — Contract Tests
 *
 * Self-executing CLI (no exports). Tests verify behavioral contracts
 * via source analysis: Cypher query structure, property assignments,
 * error handling patterns, driver cleanup.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(
  resolve(import.meta.dirname, '../../tools/recompute-plan-evidence-flags.ts'),
  'utf-8',
);

describe('[aud-tc-13] recompute-plan-evidence-flags.ts', () => {
  it('(1) creates Neo4jService instance', () => {
    expect(SOURCE).toContain('new Neo4jService()');
  });

  it('(2) runs Cypher: MATCH (t:Task) OPTIONAL MATCH on HAS_CODE_EVIDENCE', () => {
    expect(SOURCE).toContain('MATCH (t:Task)');
    expect(SOURCE).toContain('OPTIONAL MATCH (t)-[r:HAS_CODE_EVIDENCE]->()');
  });

  it('(3) counts explicit evidence where refType IN [file_path, function]', () => {
    expect(SOURCE).toMatch(/refType\s+IN\s+\[.?file_path.+function/s);
  });

  it('(4) counts semantic evidence where refType = semantic_keyword', () => {
    expect(SOURCE).toContain("refType = 'semantic_keyword'");
  });

  it('(5) SETs 4 properties: hasCodeEvidence, codeEvidenceCount, hasSemanticEvidence, semanticEvidenceCount', () => {
    expect(SOURCE).toContain('t.hasCodeEvidence');
    expect(SOURCE).toContain('t.codeEvidenceCount');
    expect(SOURCE).toContain('t.hasSemanticEvidence');
    expect(SOURCE).toContain('t.semanticEvidenceCount');
  });

  it('(6) outputs JSON with ok=true and tasksUpdated count', () => {
    expect(SOURCE).toContain('ok: true');
    expect(SOURCE).toContain('tasksUpdated');
  });

  it('(7) closes driver in finally block', () => {
    expect(SOURCE).toContain('finally');
    expect(SOURCE).toMatch(/getDriver\(\)\.close\(\)/);
  });

  it('(8) exits with code 1 on error via main().catch', () => {
    expect(SOURCE).toMatch(/main\(\)\.catch/);
    expect(SOURCE).toContain('process.exit(1)');
  });
});
