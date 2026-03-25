// Spec source: plans/codegraph/ADAPTER_ROADMAP.md §Milestone 7 "Parser Self-Modeling (Meta-Graph)"
// Spec source: plans/codegraph/MULTI_LANGUAGE_ASSESSMENT.md §Sprint 1 "Define IR v1 JSON schema and parser contract"
// AUD-TC-11a-L1-06: meta/index.ts (2 lines) — barrel re-export file
import { describe, it, expect } from 'vitest';

describe('meta/index.ts barrel re-exports', () => {
  it('re-exports parser-contract-schema symbols', async () => {
    const barrel = await import('../../parsers/meta/index.js');
    expect(barrel.ParserStageTypeSchema).toBeDefined();
    expect(barrel.ParserContractNodeSchema).toBeDefined();
    expect(barrel.ParserContractEdgeSchema).toBeDefined();
    expect(barrel.ParserContractGraphSchema).toBeDefined();
  });

  it('re-exports parser-contract-emitter symbols', async () => {
    const barrel = await import('../../parsers/meta/index.js');
    expect(barrel.emitPlanParserContracts).toBeDefined();
    expect(typeof barrel.emitPlanParserContracts).toBe('function');
  });
});
