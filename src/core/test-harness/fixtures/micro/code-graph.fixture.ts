/**
 * Micro Fixture: Code Graph — Commit Path
 *
 * Minimal, versioned code graph fixtures for fast unit tests.
 * Each fixture is deterministic and version-tagged for replay stability.
 *
 * @version 1.0.0
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N3, Micro Fixtures
 */

import type { TestFixture } from '../../ephemeral-graph.js';

/** Fixture version — bump when fixture shape changes */
export const CODE_GRAPH_FIXTURE_VERSION = '1.0.0';

/**
 * Single file, single function. The absolute minimum code graph.
 */
export const SINGLE_FUNCTION: TestFixture = {
  nodes: [
    { labels: ['SourceFile'], properties: { name: 'index.ts', filePath: '/test/index.ts', lineCount: 10 }, ref: 'file_index' },
    { labels: ['Function'], properties: { name: 'main', filePath: '/test/index.ts', riskLevel: 5, riskTier: 'LOW', fanInCount: 0, fanOutCount: 0, lineCount: 10, isExported: true }, ref: 'fn_main' },
  ],
  edges: [
    { fromRef: 'file_index', toRef: 'fn_main', type: 'CONTAINS' },
  ],
};

/**
 * Two files, caller → callee. Tests cross-file CALLS edges.
 */
export const CROSS_FILE_CALL: TestFixture = {
  nodes: [
    { labels: ['SourceFile'], properties: { name: 'caller.ts', filePath: '/test/caller.ts', lineCount: 20 }, ref: 'file_caller' },
    { labels: ['SourceFile'], properties: { name: 'callee.ts', filePath: '/test/callee.ts', lineCount: 15 }, ref: 'file_callee' },
    { labels: ['Function'], properties: { name: 'doWork', filePath: '/test/caller.ts', riskLevel: 25, riskTier: 'MEDIUM', fanInCount: 0, fanOutCount: 1, lineCount: 20, isExported: true }, ref: 'fn_doWork' },
    { labels: ['Function'], properties: { name: 'helper', filePath: '/test/callee.ts', riskLevel: 3, riskTier: 'LOW', fanInCount: 1, fanOutCount: 0, lineCount: 15, isExported: true }, ref: 'fn_helper' },
  ],
  edges: [
    { fromRef: 'file_caller', toRef: 'fn_doWork', type: 'CONTAINS' },
    { fromRef: 'file_callee', toRef: 'fn_helper', type: 'CONTAINS' },
    { fromRef: 'fn_doWork', toRef: 'fn_helper', type: 'CALLS', properties: { crossFile: true, conditional: false, isAsync: false } },
    { fromRef: 'file_caller', toRef: 'file_callee', type: 'IMPORTS' },
  ],
};

/**
 * High-risk function with multiple callers. Tests blast radius.
 */
export const HIGH_RISK_HUB: TestFixture = {
  nodes: [
    { labels: ['SourceFile'], properties: { name: 'hub.ts', filePath: '/test/hub.ts', lineCount: 200 }, ref: 'file_hub' },
    { labels: ['SourceFile'], properties: { name: 'a.ts', filePath: '/test/a.ts', lineCount: 30 }, ref: 'file_a' },
    { labels: ['SourceFile'], properties: { name: 'b.ts', filePath: '/test/b.ts', lineCount: 25 }, ref: 'file_b' },
    { labels: ['SourceFile'], properties: { name: 'c.ts', filePath: '/test/c.ts', lineCount: 20 }, ref: 'file_c' },
    { labels: ['Function'], properties: { name: 'centralHub', filePath: '/test/hub.ts', riskLevel: 550, riskTier: 'CRITICAL', fanInCount: 3, fanOutCount: 0, lineCount: 200, isExported: true }, ref: 'fn_hub' },
    { labels: ['Function'], properties: { name: 'callerA', filePath: '/test/a.ts', riskLevel: 15, riskTier: 'MEDIUM', fanInCount: 0, fanOutCount: 1, lineCount: 30, isExported: true }, ref: 'fn_a' },
    { labels: ['Function'], properties: { name: 'callerB', filePath: '/test/b.ts', riskLevel: 10, riskTier: 'LOW', fanInCount: 0, fanOutCount: 1, lineCount: 25, isExported: true }, ref: 'fn_b' },
    { labels: ['Function'], properties: { name: 'callerC', filePath: '/test/c.ts', riskLevel: 8, riskTier: 'LOW', fanInCount: 0, fanOutCount: 1, lineCount: 20, isExported: true }, ref: 'fn_c' },
  ],
  edges: [
    { fromRef: 'file_hub', toRef: 'fn_hub', type: 'CONTAINS' },
    { fromRef: 'file_a', toRef: 'fn_a', type: 'CONTAINS' },
    { fromRef: 'file_b', toRef: 'fn_b', type: 'CONTAINS' },
    { fromRef: 'file_c', toRef: 'fn_c', type: 'CONTAINS' },
    { fromRef: 'fn_a', toRef: 'fn_hub', type: 'CALLS', properties: { crossFile: true } },
    { fromRef: 'fn_b', toRef: 'fn_hub', type: 'CALLS', properties: { crossFile: true } },
    { fromRef: 'fn_c', toRef: 'fn_hub', type: 'CALLS', properties: { crossFile: true } },
  ],
};

/**
 * Class with methods and state. Tests READS_STATE / WRITES_STATE.
 */
export const STATEFUL_CLASS: TestFixture = {
  nodes: [
    { labels: ['SourceFile'], properties: { name: 'service.ts', filePath: '/test/service.ts', lineCount: 80 }, ref: 'file_svc' },
    { labels: ['Class'], properties: { name: 'UserService', filePath: '/test/service.ts', isExported: true }, ref: 'cls_svc' },
    { labels: ['Method'], properties: { name: 'getUser', filePath: '/test/service.ts', riskLevel: 20, riskTier: 'MEDIUM', fanInCount: 2, fanOutCount: 1, lineCount: 15 }, ref: 'meth_get' },
    { labels: ['Method'], properties: { name: 'setUser', filePath: '/test/service.ts', riskLevel: 30, riskTier: 'MEDIUM', fanInCount: 1, fanOutCount: 1, lineCount: 20 }, ref: 'meth_set' },
    { labels: ['Field'], properties: { name: 'currentUser', filePath: '/test/service.ts' }, ref: 'field_user' },
  ],
  edges: [
    { fromRef: 'file_svc', toRef: 'cls_svc', type: 'CONTAINS' },
    { fromRef: 'cls_svc', toRef: 'meth_get', type: 'HAS_MEMBER' },
    { fromRef: 'cls_svc', toRef: 'meth_set', type: 'HAS_MEMBER' },
    { fromRef: 'meth_get', toRef: 'field_user', type: 'READS_STATE' },
    { fromRef: 'meth_set', toRef: 'field_user', type: 'WRITES_STATE' },
  ],
};
