/**
 * Micro Fixture: Plan Graph — Commit Path
 *
 * Minimal, versioned plan graph fixtures for fast unit tests.
 *
 * @version 1.0.0
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N3, Micro Fixtures
 */

import type { TestFixture } from '../../ephemeral-graph.js';

/** Fixture version — bump when fixture shape changes */
export const PLAN_GRAPH_FIXTURE_VERSION = '1.0.0';

/**
 * Single milestone with 2 tasks (1 done, 1 planned). Minimal plan.
 */
export const SIMPLE_PLAN: TestFixture = {
  nodes: [
    { labels: ['PlanProject'], properties: { name: 'Test Plan', status: 'active' }, ref: 'plan' },
    { labels: ['Milestone'], properties: { name: 'Milestone T1: Foundation', status: 'planned' }, ref: 'ms_t1' },
    { labels: ['Task'], properties: { name: 'Set up project', status: 'done', hasCodeEvidence: true }, ref: 'task_setup' },
    { labels: ['Task'], properties: { name: 'Write core logic', status: 'planned', hasCodeEvidence: false }, ref: 'task_core' },
  ],
  edges: [
    { fromRef: 'ms_t1', toRef: 'plan', type: 'PART_OF' },
    { fromRef: 'task_setup', toRef: 'ms_t1', type: 'PART_OF' },
    { fromRef: 'task_core', toRef: 'ms_t1', type: 'PART_OF' },
    { fromRef: 'task_core', toRef: 'task_setup', type: 'DEPENDS_ON' },
  ],
};

/**
 * Plan with drift: task has code evidence but is still marked planned.
 */
export const PLAN_WITH_DRIFT: TestFixture = {
  nodes: [
    { labels: ['PlanProject'], properties: { name: 'Drift Plan', status: 'active' }, ref: 'plan' },
    { labels: ['Milestone'], properties: { name: 'Milestone D1: Drifting', status: 'planned' }, ref: 'ms_d1' },
    { labels: ['Task'], properties: { name: 'Implement feature X', status: 'planned', hasCodeEvidence: true }, ref: 'task_drift' },
    { labels: ['Task'], properties: { name: 'Test feature X', status: 'planned', hasCodeEvidence: false }, ref: 'task_test' },
  ],
  edges: [
    { fromRef: 'ms_d1', toRef: 'plan', type: 'PART_OF' },
    { fromRef: 'task_drift', toRef: 'ms_d1', type: 'PART_OF' },
    { fromRef: 'task_test', toRef: 'ms_d1', type: 'PART_OF' },
    { fromRef: 'task_test', toRef: 'task_drift', type: 'DEPENDS_ON' },
  ],
};

/**
 * Multi-milestone plan with blocking dependencies.
 */
export const BLOCKED_CHAIN: TestFixture = {
  nodes: [
    { labels: ['PlanProject'], properties: { name: 'Chain Plan', status: 'active' }, ref: 'plan' },
    { labels: ['Milestone'], properties: { name: 'Milestone C1: First', status: 'planned' }, ref: 'ms_c1' },
    { labels: ['Milestone'], properties: { name: 'Milestone C2: Second', status: 'planned' }, ref: 'ms_c2' },
    { labels: ['Task'], properties: { name: 'Foundation task', status: 'done', hasCodeEvidence: true }, ref: 'task_found' },
    { labels: ['Task'], properties: { name: 'Build on foundation', status: 'planned', hasCodeEvidence: false }, ref: 'task_build' },
    { labels: ['Task'], properties: { name: 'Final integration', status: 'planned', hasCodeEvidence: false }, ref: 'task_final' },
  ],
  edges: [
    { fromRef: 'ms_c1', toRef: 'plan', type: 'PART_OF' },
    { fromRef: 'ms_c2', toRef: 'plan', type: 'PART_OF' },
    { fromRef: 'task_found', toRef: 'ms_c1', type: 'PART_OF' },
    { fromRef: 'task_build', toRef: 'ms_c1', type: 'PART_OF' },
    { fromRef: 'task_final', toRef: 'ms_c2', type: 'PART_OF' },
    { fromRef: 'task_build', toRef: 'task_found', type: 'DEPENDS_ON' },
    { fromRef: 'task_final', toRef: 'task_build', type: 'DEPENDS_ON' },
  ],
};

/**
 * Plan with a Decision node.
 */
export const PLAN_WITH_DECISION: TestFixture = {
  nodes: [
    { labels: ['PlanProject'], properties: { name: 'Decision Plan', status: 'active' }, ref: 'plan' },
    { labels: ['Milestone'], properties: { name: 'Milestone DEC1: Decisions', status: 'planned' }, ref: 'ms_dec' },
    { labels: ['Decision'], properties: { name: 'Decision: Parser strategy', choice: 'ts-morph', rationale: 'Semantic > structural' }, ref: 'dec_parser' },
    { labels: ['Task'], properties: { name: 'Implement parser', status: 'planned', hasCodeEvidence: false }, ref: 'task_impl' },
  ],
  edges: [
    { fromRef: 'ms_dec', toRef: 'plan', type: 'PART_OF' },
    { fromRef: 'dec_parser', toRef: 'ms_dec', type: 'PART_OF' },
    { fromRef: 'task_impl', toRef: 'ms_dec', type: 'PART_OF' },
  ],
};
