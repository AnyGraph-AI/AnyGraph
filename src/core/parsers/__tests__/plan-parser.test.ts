/**
 * Plan Parser — Unit Tests
 *
 * Tests for plan-parser.ts parsing logic.
 * Covers: tasks, milestones, decisions, dependencies,
 * NO_CODE_EVIDENCE_OK, NO_DEPENDS_OK, cross-references.
 */
import { describe, it, expect } from 'vitest';
import { parsePlanProject } from '../plan-parser.js';

function parse(content: string, projectId = 'plan_test') {
  return parsePlanProject(projectId, 'test', [
    { absolutePath: '/test/PLAN.md', relativePath: 'PLAN.md', content },
  ]);
}

function findTask(result: ReturnType<typeof parse>, name: string) {
  return result.nodes.find(
    (n) => n.properties.coreType === 'Task' && (n.properties.name as string).includes(name),
  );
}

function findDecision(result: ReturnType<typeof parse>, name: string) {
  return result.nodes.find(
    (n) => n.properties.coreType === 'Decision' && (n.properties.name as string).includes(name),
  );
}

describe('Plan Parser', () => {
  describe('Tasks', () => {
    it('parses done and planned checkboxes', () => {
      const result = parse(`
## Tasks
- [x] Done task
- [ ] Planned task
`);
      const done = findTask(result, 'Done task');
      const planned = findTask(result, 'Planned task');
      expect(done?.properties.status).toBe('done');
      expect(planned?.properties.status).toBe('planned');
    });

    it('detects sub-tasks by indentation', () => {
      const result = parse(`
## Tasks
- [x] Parent task
  - [x] Sub task
`);
      const sub = findTask(result, 'Sub task');
      expect(sub?.properties.isSubTask).toBe(true);
    });

    it('extracts cross-references from backtick file paths', () => {
      const result = parse(`
## Tasks
- [x] Created \`src/core/parser.ts\` and \`utils.ts\`
`);
      const task = findTask(result, 'Created');
      expect(task?.properties.crossRefCount).toBeGreaterThanOrEqual(1);
    });

    it('extracts cross-references from backtick function names', () => {
      const result = parse(`
## Tasks
- [x] Implemented \`parseFile()\` function
`);
      const task = findTask(result, 'Implemented');
      const refs = (task?.properties.crossRefs as string) ?? '';
      expect(refs).toContain('function:parseFile');
    });
  });

  describe('Milestones', () => {
    it('parses milestone with done emoji', () => {
      const result = parse(`
### Milestone RF-1 — Foundation ✅
- [x] Task under milestone
`);
      const milestone = result.nodes.find(
        (n) => n.properties.coreType === 'Milestone' && (n.properties.code as string) === 'RF-1',
      );
      expect(milestone?.properties.status).toBe('done');
    });

    it('parses milestone with in-progress emoji', () => {
      const result = parse(`
### Milestone RF-2 — In Progress 🔜
- [ ] Task under milestone
`);
      const milestone = result.nodes.find(
        (n) => n.properties.coreType === 'Milestone' && (n.properties.code as string) === 'RF-2',
      );
      expect(milestone?.properties.status).toBe('in_progress');
    });

    it('parses milestone with no emoji as planned', () => {
      const result = parse(`
### Milestone RF-3 — Future
- [ ] Task under milestone
`);
      const milestone = result.nodes.find(
        (n) => n.properties.coreType === 'Milestone' && (n.properties.code as string) === 'RF-3',
      );
      expect(milestone?.properties.status).toBe('planned');
    });

    it('captures spec text between milestone header and first task', () => {
      const result = parse(`
### Milestone RF-1 — Foundation ✅

This milestone establishes the core schema.
It is the base for everything.

- [x] Define schema
`);
      const milestone = result.nodes.find(
        (n) => n.properties.coreType === 'Milestone' && (n.properties.code as string) === 'RF-1',
      );
      expect((milestone?.properties.specText as string) ?? '').toContain('core schema');
    });
  });

  describe('Decisions', () => {
    it('parses 3-column decision table', () => {
      const result = parse(`
## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Parser tier | ts-morph | Semantic parsing |
`);
      const decision = findDecision(result, 'Parser tier');
      expect(decision).toBeDefined();
      expect(decision?.properties.choice).toBe('ts-morph');
      expect(decision?.properties.rationale).toBe('Semantic parsing');
    });

    it('parses 2-column decision table (rationale optional)', () => {
      const result = parse(`
## Architecture Decisions

| Decision | Choice |
|----------|--------|
| CLI naming | Three commands, three jobs |
`);
      const decision = findDecision(result, 'CLI naming');
      expect(decision).toBeDefined();
      expect(decision?.properties.choice).toBe('Three commands, three jobs');
      expect(decision?.properties.rationale).toBe('');
    });

    it('ignores decisions outside decision-titled sections', () => {
      const result = parse(`
## Random Section

| Something | Other |
|-----------|-------|
| Not a decision | Not a choice |
`);
      const decisions = result.nodes.filter((n) => n.properties.coreType === 'Decision');
      expect(decisions).toHaveLength(0);
    });
  });

  describe('Dependencies', () => {
    it('parses DEPENDS_ON directive', () => {
      const result = parse(`
## Tasks
- [x] First task
- [x] Second task
  DEPENDS_ON: First task
`);
      expect(result.unresolvedRefs.some((r) => r.refType === 'depends_on' && r.refValue === 'First task')).toBe(true);
    });

    it('parses DEPENDS_ON with colon', () => {
      const result = parse(`
## Tasks
- [ ] Task A
  DEPENDS_ON: Task B
`);
      expect(result.unresolvedRefs.some((r) => r.refValue === 'Task B')).toBe(true);
    });
  });

  describe('NO_CODE_EVIDENCE_OK', () => {
    it('parses inline NO_CODE_EVIDENCE_OK from checkbox text', () => {
      const result = parse(`
## Tasks
- [x] Manual verification step. NO_CODE_EVIDENCE_OK(manual-check)
`);
      const task = findTask(result, 'Manual verification');
      expect(task?.properties.noCodeEvidenceOK).toBe('manual-check');
    });

    it('does not set noCodeEvidenceOK when directive is absent', () => {
      const result = parse(`
## Tasks
- [x] Normal task with \`code.ts\`
`);
      const task = findTask(result, 'Normal task');
      expect(task?.properties.noCodeEvidenceOK).toBeUndefined();
    });

    it('parses NO_CODE_EVIDENCE_OK with multi-word reason', () => {
      const result = parse(`
## Tasks
- [x] Config change only. NO_CODE_EVIDENCE_OK(environment-config-no-code-artifact)
`);
      const task = findTask(result, 'Config change');
      expect(task?.properties.noCodeEvidenceOK).toBe('environment-config-no-code-artifact');
    });
  });

  describe('Stats', () => {
    it('counts tasks, milestones, and decisions correctly', () => {
      const result = parse(`
### Milestone M1 — First ✅

- [x] Task 1
- [x] Task 2
- [ ] Task 3

## Architecture Decisions

| Decision | Choice |
|----------|--------|
| Approach | Graph-first |
`);
      expect(result.stats.tasks).toBe(3);
      expect(result.stats.milestones).toBe(1);
      expect(result.stats.decisions).toBe(1);
    });
  });
});
