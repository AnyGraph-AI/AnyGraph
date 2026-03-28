/**
 * Plan Parser — Behavioral Contract Tests for parseFile
 *
 * AUD-TC-PP-2: Tests behavioral contracts for parseFile internals
 * as observed through parsePlanProject() output.
 *
 * SCAR-010: Assertions test behavioral contracts (inputs → observable outputs),
 * not implementation details (mock counts, call order, source code shape).
 *
 * parseFile is NOT exported — all tests go through parsePlanProject.
 */
import { describe, it, expect } from 'vitest';
import { parsePlanProject } from '../plan-parser.js';

// Helper to invoke parsePlanProject with a single file
function parse(content: string, projectId = 'plan_test_pp2') {
  return parsePlanProject(projectId, 'test_project', [
    { path: '/test/PLAN.md', relativePath: 'PLAN.md', content },
  ]);
}

describe('AUD-TC-PP-2: parseFile behavioral contracts', () => {
  describe('Milestone parsing', () => {
    it('produces a Milestone node from ## M1 — Title heading with correct name, number, and status', () => {
      const result = parse(`
## Milestone M1 — Foundation

- [ ] Some task
`);
      const milestone = result.nodes.find(
        (n) => n.properties.coreType === 'Milestone' && n.properties.code === 'M1',
      );

      expect(milestone).toBeDefined();
      expect(milestone?.properties.name).toContain('Milestone M1');
      expect(milestone?.properties.name).toContain('Foundation');
      // M1 is not purely numeric, so number should be null
      expect(milestone?.properties.number).toBeNull();
      expect(milestone?.properties.status).toBe('planned');
      expect(milestone?.labels).toContain('Milestone');
    });

    it('produces Milestone with numeric number field when code is numeric', () => {
      const result = parse(`
## Milestone 3 — Third Phase ✅

- [x] Done task
`);
      const milestone = result.nodes.find(
        (n) => n.properties.coreType === 'Milestone' && n.properties.code === '3',
      );

      expect(milestone).toBeDefined();
      expect(milestone?.properties.number).toBe(3);
      expect(milestone?.properties.status).toBe('done');
    });

    it('detects in_progress status from 🔜 emoji', () => {
      const result = parse(`
## Milestone RF-2 — In Progress 🔜

- [ ] Pending task
`);
      const milestone = result.nodes.find(
        (n) => n.properties.coreType === 'Milestone' && n.properties.code === 'RF-2',
      );

      expect(milestone?.properties.status).toBe('in_progress');
    });
  });

  describe('Task status from checkboxes', () => {
    it('produces a Task node with status=done from - [x] checkbox', () => {
      const result = parse(`
## Tasks
- [x] Completed task here
`);
      const task = result.nodes.find(
        (n) =>
          n.properties.coreType === 'Task' &&
          (n.properties.name as string).includes('Completed task'),
      );

      expect(task).toBeDefined();
      expect(task?.properties.status).toBe('done');
      expect(task?.labels).toContain('Task');
    });

    it('produces a Task node with status=planned from - [ ] checkbox', () => {
      const result = parse(`
## Tasks
- [ ] Future task here
`);
      const task = result.nodes.find(
        (n) =>
          n.properties.coreType === 'Task' &&
          (n.properties.name as string).includes('Future task'),
      );

      expect(task).toBeDefined();
      expect(task?.properties.status).toBe('planned');
    });
  });

  describe('Sprint parsing', () => {
    it('produces a Sprint node from ### Sprint N — Name heading', () => {
      const result = parse(`
### Sprint 1 — Initial Setup

- [ ] Task in sprint
`);
      const sprint = result.nodes.find(
        (n) => n.properties.coreType === 'Sprint',
      );

      expect(sprint).toBeDefined();
      expect(sprint?.properties.name).toContain('Sprint 1');
      expect(sprint?.properties.name).toContain('Initial Setup');
      expect(sprint?.properties.number).toBe(1);
      expect(sprint?.labels).toContain('Sprint');
    });

    it('creates PART_OF edge from Sprint to PlanProject', () => {
      const result = parse(`
### Sprint 2 — Development

- [ ] Task
`);
      const sprint = result.nodes.find((n) => n.properties.coreType === 'Sprint');
      const project = result.nodes.find((n) => n.properties.coreType === 'PlanProject');

      expect(sprint).toBeDefined();
      expect(project).toBeDefined();

      const partOfEdge = result.edges.find(
        (e) => e.source === sprint?.id && e.target === project?.id && e.type === 'PART_OF',
      );
      expect(partOfEdge).toBeDefined();
    });
  });

  describe('File path cross-references in unresolvedRefs', () => {
    it('adds unresolvedRef with refType=file_path for backtick file path in task', () => {
      const result = parse(`
## Tasks
- [x] Created \`src/foo/bar.ts\` module
`);
      const fileRef = result.unresolvedRefs.find(
        (r) => r.refType === 'file_path' && r.refValue.includes('bar.ts'),
      );

      expect(fileRef).toBeDefined();
      expect(fileRef?.refValue).toBe('src/foo/bar.ts');
    });

    it('adds unresolvedRef for file path without backticks when extension matches', () => {
      const result = parse(`
## Tasks
- [x] Updated utils/helper.ts
`);
      const fileRef = result.unresolvedRefs.find(
        (r) => r.refType === 'file_path' && r.refValue.includes('helper.ts'),
      );

      expect(fileRef).toBeDefined();
    });

    it('captures multiple file path refs from single task', () => {
      const result = parse(`
## Tasks
- [x] Refactored \`src/a.ts\` and \`src/b.ts\`
`);
      const fileRefs = result.unresolvedRefs.filter((r) => r.refType === 'file_path');

      expect(fileRefs.length).toBeGreaterThanOrEqual(2);
      expect(fileRefs.some((r) => r.refValue.includes('a.ts'))).toBe(true);
      expect(fileRefs.some((r) => r.refValue.includes('b.ts'))).toBe(true);
    });
  });

  describe('Function cross-references in unresolvedRefs', () => {
    it('adds unresolvedRef with refType=function for backtick function call', () => {
      const result = parse(`
## Tasks
- [x] Implemented \`myFunction()\` method
`);
      const funcRef = result.unresolvedRefs.find(
        (r) => r.refType === 'function' && r.refValue === 'myFunction',
      );

      expect(funcRef).toBeDefined();
    });

    it('adds unresolvedRef for camelCase identifier in backticks', () => {
      const result = parse(`
## Tasks
- [x] Called \`computeMaxDepth\` helper
`);
      const funcRef = result.unresolvedRefs.find(
        (r) => r.refType === 'function' && r.refValue === 'computeMaxDepth',
      );

      expect(funcRef).toBeDefined();
    });

    it('handles dotted function names like obj.method()', () => {
      const result = parse(`
## Tasks
- [x] Used \`parser.parseFile()\` method
`);
      const funcRef = result.unresolvedRefs.find(
        (r) => r.refType === 'function' && r.refValue.includes('parseFile'),
      );

      expect(funcRef).toBeDefined();
    });
  });

  describe('DEPENDS_ON directive', () => {
    it('adds unresolvedRef with refType=depends_on bound to preceding task', () => {
      const result = parse(`
## Tasks
- [x] First task
- [x] Second task
  DEPENDS_ON: First task
`);
      const secondTask = result.nodes.find(
        (n) => n.properties.coreType === 'Task' && (n.properties.name as string).includes('Second'),
      );

      const depRef = result.unresolvedRefs.find(
        (r) => r.refType === 'depends_on' && r.refValue === 'First task',
      );

      expect(depRef).toBeDefined();
      expect(depRef?.taskId).toBe(secondTask?.id);
      expect(depRef?.taskName).toContain('Second');
    });

    it('correctly parses DEPENDS_ON with colon and spaces', () => {
      const result = parse(`
## Tasks
- [ ] Task A
- [ ] Task B
  DEPENDS_ON: Task A
`);
      const depRef = result.unresolvedRefs.find(
        (r) => r.refType === 'depends_on' && r.refValue === 'Task A',
      );

      expect(depRef).toBeDefined();
    });

    it('binds DEPENDS_ON to section when no preceding task', () => {
      const result = parse(`
## Milestone M1 — Setup

DEPENDS_ON: External milestone
`);
      // When no task precedes, binds to section/milestone
      const depRef = result.unresolvedRefs.find(
        (r) => r.refType === 'depends_on' && r.refValue === 'External milestone',
      );

      expect(depRef).toBeDefined();
      // Should be bound to the milestone, not a task
      expect(depRef?.taskName).not.toContain('Task');
    });
  });

  describe('Empty content handling', () => {
    it('produces zero nodes, zero edges, zero unresolvedRefs for empty string', () => {
      const result = parse('');

      // Only the PlanProject node should exist (always created)
      const nonProjectNodes = result.nodes.filter(
        (n) => n.properties.coreType !== 'PlanProject',
      );
      expect(nonProjectNodes).toHaveLength(0);

      // Only PART_OF edges to project should exist (none for empty content)
      const contentEdges = result.edges.filter(
        (e) => !e.target.includes('PlanProject'),
      );
      expect(contentEdges).toHaveLength(0);

      expect(result.unresolvedRefs).toHaveLength(0);
    });

    it('produces zero content nodes for whitespace-only content', () => {
      const result = parse('   \n\n  \t  \n  ');

      const nonProjectNodes = result.nodes.filter(
        (n) => n.properties.coreType !== 'PlanProject',
      );
      expect(nonProjectNodes).toHaveLength(0);
      expect(result.unresolvedRefs).toHaveLength(0);
    });

    it('produces zero stats for empty content except file count', () => {
      const result = parse('');

      expect(result.stats.tasks).toBe(0);
      expect(result.stats.milestones).toBe(0);
      expect(result.stats.sprints).toBe(0);
      expect(result.stats.decisions).toBe(0);
      expect(result.stats.crossRefs).toBe(0);
      expect(result.stats.files).toBe(1); // One file was provided
    });
  });

  describe('Edge cases', () => {
    it('handles milestone without title after code', () => {
      const result = parse(`
## Milestone RF-1

- [x] Task
`);
      const milestone = result.nodes.find(
        (n) => n.properties.coreType === 'Milestone' && n.properties.code === 'RF-1',
      );

      expect(milestone).toBeDefined();
      expect(milestone?.properties.name).toBe('Milestone RF-1');
    });

    it('tracks stats correctly across multiple milestones and sprints', () => {
      const result = parse(`
## Milestone M1 — First

- [x] Task 1
- [ ] Task 2

### Sprint 1 — Dev

- [x] Task 3

## Milestone M2 — Second

- [ ] Task 4
`);
      expect(result.stats.milestones).toBe(2);
      expect(result.stats.sprints).toBe(1);
      expect(result.stats.tasks).toBe(4);
    });
  });
});
