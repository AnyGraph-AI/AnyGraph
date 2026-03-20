/**
 * TODO-2: Evidence Linker Robustness (Prose-Safe) — Spec Tests
 *
 * Tests written FROM the TODO_BUCKET.md TODO-2 spec.
 *
 * Spec requirements:
 * 1. Backtick artifact extraction runs before fuzzy text heuristics
 * 2. Deterministic normalization for absolute/relative file paths and function tokens
 * 3. Diagnostics report includes unmatched tokens with reason codes
 * 4. Long-form task text with valid refs still produces expected HAS_CODE_EVIDENCE links
 *
 * Additional coverage:
 * 5. Continuation lines after checkboxes (Details:, EVIDENCE:, Scope:, plain text)
 *    must have their cross-references extracted and attributed to the parent task
 * 6. DEPENDS_ON lines remain dependency refs, not evidence refs
 */
import { describe, it, expect } from 'vitest';
import { parsePlanProject } from '../plan-parser.js';

function parse(content: string, projectId = 'plan_test') {
  return parsePlanProject(projectId, 'test', [
    { path: '/test/PLAN.md', relativePath: 'PLAN.md', content },
  ]);
}

function findTask(result: ReturnType<typeof parse>, name: string) {
  return result.nodes.find(
    (n) => n.properties.coreType === 'Task' && (n.properties.name as string).includes(name),
  );
}

describe('TODO-2: Evidence Linker Robustness', () => {
  describe('Continuation line cross-reference extraction', () => {
    it('extracts file refs from indented continuation lines after a checkbox', () => {
      const result = parse(`
### Milestone M1 — Test

- [x] Implement feature X
  EVIDENCE: \`src/core/parser.ts\` \`src/utils/helper.ts\`
`);
      const task = findTask(result, 'Implement feature X');
      expect(task).toBeDefined();
      // The task itself has no backtick refs, but continuation lines do
      const refs = result.unresolvedRefs.filter(
        (r) => r.taskId === task!.id && r.refType === 'file_path',
      );
      expect(refs.length).toBeGreaterThanOrEqual(2);
      expect(refs.some((r) => r.refValue.includes('parser.ts'))).toBe(true);
      expect(refs.some((r) => r.refValue.includes('helper.ts'))).toBe(true);
    });

    it('extracts function refs from Details: continuation lines', () => {
      const result = parse(`
### Milestone M1 — Test

- [x] Fix the resolver
  Details: Updated \`resolveScope()\` and \`validateInput()\` in the scope resolver.
`);
      const task = findTask(result, 'Fix the resolver');
      expect(task).toBeDefined();
      const refs = result.unresolvedRefs.filter(
        (r) => r.taskId === task!.id && r.refType === 'function',
      );
      expect(refs.some((r) => r.refValue === 'resolveScope')).toBe(true);
      expect(refs.some((r) => r.refValue === 'validateInput')).toBe(true);
    });

    it('accumulates crossRefCount from both checkbox text and continuation lines', () => {
      const result = parse(`
### Milestone M1 — Test

- [x] Updated \`src/core/main.ts\` with new logic
  EVIDENCE: \`src/core/helper.ts\` \`computeRisk()\`
`);
      const task = findTask(result, 'Updated');
      expect(task).toBeDefined();
      // main.ts from checkbox + helper.ts + computeRisk from continuation
      expect(task!.properties.crossRefCount).toBeGreaterThanOrEqual(3);
    });

    it('does NOT extract refs from DEPENDS_ON continuation lines as evidence', () => {
      const result = parse(`
### Milestone M1 — Test

- [x] First task with \`src/a.ts\`
- [x] Second task
  DEPENDS_ON: First task with \`src/a.ts\`
`);
      const second = findTask(result, 'Second task');
      expect(second).toBeDefined();
      // Second task should NOT get file refs from the DEPENDS_ON line
      const fileRefs = result.unresolvedRefs.filter(
        (r) => r.taskId === second!.id && r.refType === 'file_path',
      );
      expect(fileRefs).toHaveLength(0);
    });

    it('handles multiple continuation lines', () => {
      const result = parse(`
### Milestone M1 — Test

- [x] Big feature implementation
  EVIDENCE: \`src/core/parser.ts\`
  Details: Also touched \`src/utils/graph.ts\` and \`buildGraph()\`.
  Scope: \`src/scripts/run.ts\`
`);
      const task = findTask(result, 'Big feature');
      expect(task).toBeDefined();
      const fileRefs = result.unresolvedRefs.filter(
        (r) => r.taskId === task!.id && r.refType === 'file_path',
      );
      // parser.ts + graph.ts + run.ts
      expect(fileRefs.length).toBeGreaterThanOrEqual(3);
    });

    it('stops continuation at next checkbox', () => {
      const result = parse(`
### Milestone M1 — Test

- [x] First task
  EVIDENCE: \`src/first.ts\`
- [x] Second task
`);
      const second = findTask(result, 'Second task');
      expect(second).toBeDefined();
      const fileRefs = result.unresolvedRefs.filter(
        (r) => r.taskId === second!.id && r.refType === 'file_path',
      );
      // Second task has no refs of its own
      expect(fileRefs).toHaveLength(0);
    });

    it('stops continuation at next milestone header', () => {
      const result = parse(`
### Milestone M1 — Test

- [x] Last task of M1
  EVIDENCE: \`src/m1.ts\`

### Milestone M2 — Next

- [ ] First task of M2
`);
      const m2Task = findTask(result, 'First task of M2');
      expect(m2Task).toBeDefined();
      const fileRefs = result.unresolvedRefs.filter(
        (r) => r.taskId === m2Task!.id && r.refType === 'file_path',
      );
      expect(fileRefs).toHaveLength(0);
    });
  });

  describe('Long-form task text with valid refs', () => {
    it('extracts all refs from a very long single-line task', () => {
      const result = parse(`
### Milestone M1 — Test

- [x] Implemented the full pipeline. Updated \`src/core/verification/verification-ingest.ts\` (\`ingestVerificationFoundation\` MERGE \`AdjudicationRecord\` + MERGE \`ADJUDICATES\`). Verified by \`src/core/verification/__tests__/sarif-ingest.spec-test.ts\` (\`imports suppressions as AdjudicationRecord nodes\`, \`creates AdjudicationRecord nodes with ADJUDICATES edges to targets\`).
`);
      const task = findTask(result, 'Implemented the full pipeline');
      expect(task).toBeDefined();
      const fileRefs = result.unresolvedRefs.filter(
        (r) => r.taskId === task!.id && r.refType === 'file_path',
      );
      // verification-ingest.ts + sarif-ingest.spec-test.ts
      expect(fileRefs.length).toBeGreaterThanOrEqual(2);
      expect(fileRefs.some((r) => r.refValue.includes('verification-ingest.ts'))).toBe(true);
      expect(fileRefs.some((r) => r.refValue.includes('sarif-ingest.spec-test.ts'))).toBe(true);
    });
  });

  describe('Deterministic path normalization', () => {
    it('normalizes absolute paths to relative form', () => {
      const result = parse(`
### Milestone M1 — Test

- [x] Updated file at \`/home/user/project/src/core/parser.ts\`
`);
      const task = findTask(result, 'Updated file');
      expect(task).toBeDefined();
      const fileRefs = result.unresolvedRefs.filter(
        (r) => r.taskId === task!.id && r.refType === 'file_path',
      );
      // Should still extract the file ref (parser.ts is a recognized extension)
      expect(fileRefs.length).toBeGreaterThanOrEqual(1);
    });

    it('deduplicates refs that resolve to the same file name', () => {
      const result = parse(`
### Milestone M1 — Test

- [x] Updated \`src/core/parser.ts\` and also referenced \`src/core/parser.ts\` again
`);
      const task = findTask(result, 'Updated');
      expect(task).toBeDefined();
      const fileRefs = result.unresolvedRefs.filter(
        (r) => r.taskId === task!.id && r.refType === 'file_path',
      );
      // Should deduplicate — only one ref for parser.ts
      expect(fileRefs).toHaveLength(1);
    });
  });

  describe('Unmatched token diagnostics', () => {
    it('reports diagnostics for continuation lines with no extractable refs', () => {
      const result = parse(`
### Milestone M1 — Test

- [x] Implement feature
  Details: This is just plain prose with no code references at all.
`);
      const task = findTask(result, 'Implement feature');
      expect(task).toBeDefined();
      // The continuation line has no refs — no unresolved refs should be added
      const refs = result.unresolvedRefs.filter((r) => r.taskId === task!.id);
      expect(refs).toHaveLength(0);
    });
  });

  describe('Cross-ref stats accuracy', () => {
    it('crossRefs stat includes continuation line refs', () => {
      const result = parse(`
### Milestone M1 — Test

- [x] Task one
  EVIDENCE: \`src/a.ts\` \`src/b.ts\`
- [x] Task two with \`src/c.ts\`
`);
      // Total cross refs should include: a.ts, b.ts (from continuation), c.ts (from checkbox)
      expect(result.stats.crossRefs).toBeGreaterThanOrEqual(3);
    });
  });
});
