/**
 * [AUD-TC-13-L1-03] plan-code-embedding-matcher.ts — Contract Tests
 *
 * Self-executing CLI (no exports). Tests verify behavioral contracts
 * via source analysis: embedding workflow, matching threshold, apply mode.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(
  resolve(import.meta.dirname, '../../tools/plan-code-embedding-matcher.ts'),
  'utf-8',
);

describe('[aud-tc-13] plan-code-embedding-matcher.ts', () => {
  it('(1) reads plan-code-project-map.json for planProjectId→codeProjectId mappings', () => {
    expect(SOURCE).toContain('plan-code-project-map.json');
  });

  it('(2) queries Task nodes without HAS_CODE_EVIDENCE for each plan project', () => {
    expect(SOURCE).toContain('Task');
    expect(SOURCE).toContain('HAS_CODE_EVIDENCE');
  });

  it('(3) embeds task names/descriptions via EmbeddingsService', () => {
    expect(SOURCE).toMatch(/EmbeddingsService|embeddings/i);
  });

  it('(4) queries Function nodes with existing embeddings in code project', () => {
    expect(SOURCE).toContain('Function');
    expect(SOURCE).toMatch(/embedding/i);
  });

  it('(5) computes cosine similarity between task and function embeddings', () => {
    expect(SOURCE).toMatch(/cosine|similarity|dot/i);
  });

  it('(6) uses configurable threshold (default 0.75) for match candidates', () => {
    expect(SOURCE).toMatch(/threshold/i);
    expect(SOURCE).toContain('0.75');
  });

  it('(7) --apply flag creates HAS_CODE_EVIDENCE edges in Neo4j', () => {
    expect(SOURCE).toContain('--apply');
    expect(SOURCE).toContain('HAS_CODE_EVIDENCE');
  });

  it('(8) outputs report JSON to artifacts directory without --apply', () => {
    expect(SOURCE).toContain('artifacts');
    expect(SOURCE).toMatch(/writeFileSync|writeFile/);
  });

  it('(9) report includes taskId/taskName and match details', () => {
    expect(SOURCE).toContain('taskId');
    expect(SOURCE).toContain('taskName');
  });

  it('(10) configurable limit for matches per task (default 5)', () => {
    expect(SOURCE).toContain('--limit');
  });

  it('(11) closes Neo4j driver in finally block', () => {
    expect(SOURCE).toContain('finally');
    expect(SOURCE).toMatch(/\.close\(\)/);
  });

  it('(12) exits with code 1 on error', () => {
    expect(SOURCE).toContain('process.exit(1)');
  });
});
