/**
 * Stress Fixtures — Nightly/Release Path
 *
 * Large-scale fixtures for performance and scalability testing.
 * Generated programmatically to hit specific node/edge counts.
 *
 * @version 1.0.0
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N3, Stress Fixtures
 */

import type { TestFixture } from '../../ephemeral-graph.js';

export const STRESS_FIXTURE_VERSION = '1.0.0';

/**
 * Generate a stress test fixture with N files and M functions per file.
 * Creates a dense call graph for performance testing.
 */
export function generateStressFixture(opts: {
  fileCount?: number;
  functionsPerFile?: number;
  callDensity?: number;  // 0-1, probability of a cross-function call
} = {}): TestFixture {
  const {
    fileCount = 50,
    functionsPerFile = 10,
    callDensity = 0.1,
  } = opts;

  const nodes: TestFixture['nodes'] = [];
  const edges: TestFixture['edges'] = [];
  const fnRefs: string[] = [];

  // Create files and functions
  for (let f = 0; f < fileCount; f++) {
    const fileName = `file_${f}.ts`;
    const fileRef = `sf_${f}`;
    nodes.push({
      labels: ['SourceFile'],
      properties: { name: fileName, filePath: `/stress/${fileName}`, lineCount: functionsPerFile * 20 },
      ref: fileRef,
    });

    for (let fn = 0; fn < functionsPerFile; fn++) {
      const fnName = `fn_${f}_${fn}`;
      const fnRef = `fn_${f}_${fn}`;
      fnRefs.push(fnRef);
      nodes.push({
        labels: ['Function'],
        properties: {
          name: fnName,
          filePath: `/stress/${fileName}`,
          riskLevel: Math.floor(Math.random() * 500),
          riskTier: 'MEDIUM',
          fanInCount: 0,
          fanOutCount: 0,
          lineCount: 20,
          isExported: fn === 0,
        },
        ref: fnRef,
      });
      edges.push({ fromRef: fileRef, toRef: fnRef, type: 'CONTAINS' });
    }
  }

  // Create calls based on density
  // Use deterministic pattern (not random) for reproducibility
  for (let i = 0; i < fnRefs.length; i++) {
    for (let j = i + 1; j < fnRefs.length && j < i + Math.ceil(fnRefs.length * callDensity); j++) {
      if ((i * 7 + j * 13) % Math.ceil(1 / callDensity) === 0) {
        edges.push({
          fromRef: fnRefs[i],
          toRef: fnRefs[j],
          type: 'CALLS',
          properties: { crossFile: true },
        });
      }
    }
  }

  return { nodes, edges };
}
