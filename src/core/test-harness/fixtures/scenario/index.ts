/**
 * Scenario Fixtures — Pre-Merge Governed Path
 *
 * Larger, multi-concern fixtures for integration tests.
 * These test cross-cutting concerns (code + plan, drift detection, etc.).
 *
 * @version 1.0.0
 */

import type { TestFixture } from '../../ephemeral-graph.js';

export const SCENARIO_FIXTURE_VERSION = '1.0.0';

/**
 * Combined code + plan graph. Tests cross-domain evidence linking.
 * A plan task references a code file via HAS_CODE_EVIDENCE.
 */
export const CODE_PLAN_CROSS_DOMAIN: TestFixture = {
  nodes: [
    // Code graph
    { labels: ['SourceFile'], properties: { name: 'parser.ts', filePath: '/src/parser.ts', lineCount: 200 }, ref: 'sf_parser' },
    { labels: ['Function'], properties: { name: 'parseFile', filePath: '/src/parser.ts', riskLevel: 80, riskTier: 'MEDIUM', fanInCount: 5, fanOutCount: 3, lineCount: 60, isExported: true }, ref: 'fn_parse' },
    { labels: ['Function'], properties: { name: 'tokenize', filePath: '/src/parser.ts', riskLevel: 15, riskTier: 'MEDIUM', fanInCount: 1, fanOutCount: 0, lineCount: 40, isExported: false }, ref: 'fn_token' },
    // Plan graph
    { labels: ['PlanProject'], properties: { name: 'Cross Domain Plan', status: 'active' }, ref: 'plan' },
    { labels: ['Milestone'], properties: { name: 'Milestone XD1: Parser', status: 'planned' }, ref: 'ms_parser' },
    { labels: ['Task'], properties: { name: 'Implement file parser', status: 'done', hasCodeEvidence: true }, ref: 'task_parser' },
    { labels: ['Task'], properties: { name: 'Add tokenizer', status: 'planned', hasCodeEvidence: true }, ref: 'task_token' },
  ],
  edges: [
    { fromRef: 'sf_parser', toRef: 'fn_parse', type: 'CONTAINS' },
    { fromRef: 'sf_parser', toRef: 'fn_token', type: 'CONTAINS' },
    { fromRef: 'fn_parse', toRef: 'fn_token', type: 'CALLS' },
    { fromRef: 'ms_parser', toRef: 'plan', type: 'PART_OF' },
    { fromRef: 'task_parser', toRef: 'ms_parser', type: 'PART_OF' },
    { fromRef: 'task_token', toRef: 'ms_parser', type: 'PART_OF' },
    { fromRef: 'task_parser', toRef: 'sf_parser', type: 'HAS_CODE_EVIDENCE' },
    { fromRef: 'task_token', toRef: 'fn_token', type: 'HAS_CODE_EVIDENCE' },
    { fromRef: 'task_token', toRef: 'task_parser', type: 'DEPENDS_ON' },
  ],
};

/**
 * Full enrichment pipeline scenario: file with risk, state, ownership, architecture.
 */
export const ENRICHED_CODE_GRAPH: TestFixture = {
  nodes: [
    { labels: ['SourceFile'], properties: { name: 'service.ts', filePath: '/src/service.ts', lineCount: 150, architectureLayer: 'Domain', primaryAuthor: 'jonathan', ownershipPct: 85, authorEntropy: 2 }, ref: 'sf_svc' },
    { labels: ['Function'], properties: { name: 'processRequest', filePath: '/src/service.ts', riskLevel: 250, riskTier: 'HIGH', fanInCount: 8, fanOutCount: 4, lineCount: 80, isExported: true, gitChangeFrequency: 0.7 }, ref: 'fn_proc' },
    { labels: ['Function'], properties: { name: 'validateInput', filePath: '/src/service.ts', riskLevel: 45, riskTier: 'MEDIUM', fanInCount: 1, fanOutCount: 0, lineCount: 30, isExported: false, gitChangeFrequency: 0.2 }, ref: 'fn_val' },
    { labels: ['Field'], properties: { name: 'requestQueue', filePath: '/src/service.ts' }, ref: 'field_queue' },
    { labels: ['Author'], properties: { name: 'jonathan' }, ref: 'author' },
    { labels: ['ArchitectureLayer'], properties: { name: 'Domain' }, ref: 'layer' },
  ],
  edges: [
    { fromRef: 'sf_svc', toRef: 'fn_proc', type: 'CONTAINS' },
    { fromRef: 'sf_svc', toRef: 'fn_val', type: 'CONTAINS' },
    { fromRef: 'fn_proc', toRef: 'fn_val', type: 'CALLS' },
    { fromRef: 'fn_proc', toRef: 'field_queue', type: 'READS_STATE' },
    { fromRef: 'fn_proc', toRef: 'field_queue', type: 'WRITES_STATE' },
    { fromRef: 'sf_svc', toRef: 'author', type: 'OWNED_BY' },
    { fromRef: 'sf_svc', toRef: 'layer', type: 'BELONGS_TO_LAYER' },
  ],
};
