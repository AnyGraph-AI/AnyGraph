/**
 * Plan Parser — stableId Behavioral Contract Tests
 *
 * Tests the behavioral contracts for the stableId function through
 * the parsePlanProject observable output (node IDs).
 *
 * stableId is NOT exported — we test the observable contract:
 * same inputs → same node IDs.
 *
 * AUD-TC-PP-1: Behavioral contracts for stableId
 */
import { describe, it, expect } from 'vitest';
import { parsePlanProject, PlanNode } from '../plan-parser.js';

interface PlanFile {
  path: string;
  relativePath: string;
  content: string;
}

function parse(content: string, projectId = 'plan_test', fileName = 'PLAN.md') {
  return parsePlanProject(projectId, 'test', [
    { path: `/test/${fileName}`, relativePath: fileName, content },
  ]);
}

function parseMultiFile(files: PlanFile[], projectId = 'plan_test') {
  return parsePlanProject(projectId, 'test', files);
}

function getTaskNodes(result: ReturnType<typeof parse>): PlanNode[] {
  return result.nodes.filter((n) => n.properties.coreType === 'Task');
}

function getMilestoneNodes(result: ReturnType<typeof parse>): PlanNode[] {
  return result.nodes.filter((n) => n.properties.coreType === 'Milestone');
}

function getProjectNode(result: ReturnType<typeof parse>): PlanNode | undefined {
  return result.nodes.find((n) => n.properties.coreType === 'PlanProject');
}

describe('stableId Behavioral Contracts', () => {
  describe('Determinism — same inputs produce same IDs', () => {
    it('parses same markdown content twice with same projectId → identical node IDs', () => {
      const content = `
## Tasks
- [x] First task
- [ ] Second task
`;
      const result1 = parse(content, 'plan_determinism');
      const result2 = parse(content, 'plan_determinism');

      // Get all node IDs from both results
      const ids1 = result1.nodes.map((n) => n.id).sort();
      const ids2 = result2.nodes.map((n) => n.id).sort();

      expect(ids1).toEqual(ids2);
      expect(ids1.length).toBeGreaterThan(0);
    });

    it('parses with milestone and tasks → IDs are consistent across runs', () => {
      const content = `
### Milestone M1 — Foundation ✅
- [x] Setup schema
- [x] Implement parser
`;
      const result1 = parse(content, 'plan_milestone_det');
      const result2 = parse(content, 'plan_milestone_det');

      const tasks1 = getTaskNodes(result1).map((t) => t.id).sort();
      const tasks2 = getTaskNodes(result2).map((t) => t.id).sort();
      const milestones1 = getMilestoneNodes(result1).map((m) => m.id);
      const milestones2 = getMilestoneNodes(result2).map((m) => m.id);

      expect(tasks1).toEqual(tasks2);
      expect(milestones1).toEqual(milestones2);
    });

    it('project node ID is deterministic', () => {
      const content = `## Simple Plan\n- [x] Task`;
      const result1 = parse(content, 'plan_project_det');
      const result2 = parse(content, 'plan_project_det');

      const project1 = getProjectNode(result1);
      const project2 = getProjectNode(result2);

      expect(project1?.id).toBe(project2?.id);
    });
  });

  describe('ProjectId Isolation — different projectIds produce different IDs', () => {
    it('same content with different projectId → different task IDs', () => {
      const content = `
## Tasks
- [x] Same task name
`;
      const resultA = parse(content, 'plan_project_a');
      const resultB = parse(content, 'plan_project_b');

      const tasksA = getTaskNodes(resultA);
      const tasksB = getTaskNodes(resultB);

      expect(tasksA.length).toBe(1);
      expect(tasksB.length).toBe(1);
      expect(tasksA[0].id).not.toBe(tasksB[0].id);
    });

    it('same content with different projectId → different project node IDs', () => {
      const content = `## Plan\n- [x] Task`;
      const resultA = parse(content, 'plan_alpha');
      const resultB = parse(content, 'plan_beta');

      const projectA = getProjectNode(resultA);
      const projectB = getProjectNode(resultB);

      expect(projectA?.id).not.toBe(projectB?.id);
    });

    it('same content with different projectId → different milestone IDs', () => {
      const content = `
### Milestone M1 — Foundation
- [x] Task
`;
      const resultA = parse(content, 'plan_ms_a');
      const resultB = parse(content, 'plan_ms_b');

      const milestonesA = getMilestoneNodes(resultA);
      const milestonesB = getMilestoneNodes(resultB);

      expect(milestonesA.length).toBe(1);
      expect(milestonesB.length).toBe(1);
      expect(milestonesA[0].id).not.toBe(milestonesB[0].id);
    });
  });

  describe('Ordinal Isolation — different ordinals produce different IDs', () => {
    it('two tasks in same section with different ordinals → different IDs', () => {
      const content = `
## Tasks
- [x] First task
- [x] Second task
- [x] Third task
`;
      const result = parse(content, 'plan_ordinal');
      const tasks = getTaskNodes(result);

      expect(tasks.length).toBe(3);

      // All task IDs must be unique
      const taskIds = tasks.map((t) => t.id);
      const uniqueIds = new Set(taskIds);
      expect(uniqueIds.size).toBe(taskIds.length);
    });

    it('many tasks in same section → all have unique IDs', () => {
      const tasks = Array.from({ length: 10 }, (_, i) => `- [x] Task ${i + 1}`).join('\n');
      const content = `## Large Section\n${tasks}`;
      
      const result = parse(content, 'plan_many_ordinals');
      const taskNodes = getTaskNodes(result);

      expect(taskNodes.length).toBe(10);

      const taskIds = taskNodes.map((t) => t.id);
      const uniqueIds = new Set(taskIds);
      expect(uniqueIds.size).toBe(10);
    });
  });

  describe('SectionKey Isolation — different sections produce different IDs', () => {
    it('task in section A vs same task name in section B → different IDs', () => {
      const content = `
## Section Alpha
- [x] Same task name

## Section Beta
- [x] Same task name
`;
      const result = parse(content, 'plan_section_iso');
      const tasks = getTaskNodes(result);

      // Should have 2 tasks with the same name
      expect(tasks.length).toBe(2);
      expect(tasks[0].properties.name).toBe(tasks[1].properties.name);

      // But different IDs due to different sections
      expect(tasks[0].id).not.toBe(tasks[1].id);
    });

    it('tasks under different milestones → different IDs even with same name', () => {
      const content = `
### Milestone M1 — First
- [x] Setup config

### Milestone M2 — Second
- [x] Setup config
`;
      const result = parse(content, 'plan_ms_section');
      const tasks = getTaskNodes(result);

      expect(tasks.length).toBe(2);
      
      // Same task name
      expect(tasks[0].properties.name).toBe('Setup config');
      expect(tasks[1].properties.name).toBe('Setup config');

      // Different IDs
      expect(tasks[0].id).not.toBe(tasks[1].id);
    });

    it('tasks in different files → different IDs even with same name and ordinal', () => {
      const files: PlanFile[] = [
        {
          path: '/test/file1.md',
          relativePath: 'file1.md',
          content: `## Tasks\n- [x] Common task`,
        },
        {
          path: '/test/file2.md',
          relativePath: 'file2.md',
          content: `## Tasks\n- [x] Common task`,
        },
      ];

      const result = parseMultiFile(files, 'plan_multi_file');
      const tasks = getTaskNodes(result);

      expect(tasks.length).toBe(2);
      expect(tasks[0].properties.name).toBe('Common task');
      expect(tasks[1].properties.name).toBe('Common task');
      expect(tasks[0].id).not.toBe(tasks[1].id);
    });
  });

  describe('ID Format — all IDs are non-empty strings', () => {
    it('all generated node IDs are non-empty strings', () => {
      const content = `
### Milestone M1 — Foundation ✅

- [x] Task 1
- [ ] Task 2

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Approach | Graph  | Scalable  |
`;
      const result = parse(content, 'plan_nonempty');

      for (const node of result.nodes) {
        expect(typeof node.id).toBe('string');
        expect(node.id.length).toBeGreaterThan(0);
        expect(node.id.trim()).not.toBe('');
      }
    });

    it('edge IDs are also non-empty strings', () => {
      const content = `
### Milestone M1 — Test
- [x] Task
`;
      const result = parse(content, 'plan_edge_ids');

      // Should have at least PART_OF edges
      expect(result.edges.length).toBeGreaterThan(0);

      for (const edge of result.edges) {
        expect(typeof edge.id).toBe('string');
        expect(edge.id.length).toBeGreaterThan(0);
      }
    });

    it('project node ID is non-empty even with minimal content', () => {
      const result = parse('', 'plan_empty_content');
      const project = getProjectNode(result);

      expect(project).toBeDefined();
      expect(typeof project!.id).toBe('string');
      expect(project!.id.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases — stableId behavior under stress', () => {
    it('handles special characters in section names', () => {
      const content = `
## Section: Alpha (v1.0) — "Test"
- [x] Task A

## Section: Beta (v2.0) — "Other"
- [x] Task B
`;
      const result = parse(content, 'plan_special_chars');
      const tasks = getTaskNodes(result);

      expect(tasks.length).toBe(2);
      expect(tasks[0].id).not.toBe(tasks[1].id);
    });

    it('handles unicode in task names', () => {
      const content = `
## Tasks
- [x] 日本語タスク
- [x] Задача по-русски
- [x] Tâche française
`;
      const result = parse(content, 'plan_unicode');
      const tasks = getTaskNodes(result);

      expect(tasks.length).toBe(3);
      const taskIds = tasks.map((t) => t.id);
      const uniqueIds = new Set(taskIds);
      expect(uniqueIds.size).toBe(3);
    });

    it('IDs are stable when file path changes but content is same', () => {
      // Note: stableId includes file path, so different paths = different IDs
      // This test verifies that behavior is consistent
      const content = `## Tasks\n- [x] My task`;
      
      const resultA = parse(content, 'plan_path_test', 'fileA.md');
      const resultB = parse(content, 'plan_path_test', 'fileB.md');

      const taskA = getTaskNodes(resultA)[0];
      const taskB = getTaskNodes(resultB)[0];

      // Different file paths → different IDs
      expect(taskA.id).not.toBe(taskB.id);
    });
  });
});
