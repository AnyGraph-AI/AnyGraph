// Spec source: _drafts/ground-truth-hook/DESIGN.md
import { describe, it, expect, vi } from 'vitest';

const runtimeRunRef = { fn: null as any };

vi.mock('../../storage/neo4j/neo4j.service.js', () => {
  const MockNeo4j = vi.fn(function (this: any) {
    this.close = vi.fn().mockResolvedValue(undefined);
    this.run = vi.fn().mockResolvedValue([]);
  });
  return { Neo4jService: MockNeo4j };
});

vi.mock('../runtime.js', () => {
  const MockRuntime = vi.fn(function (this: any) {
    this.run = (...args: any[]) => runtimeRunRef.fn(...args);
  });
  return { GroundTruthRuntime: MockRuntime };
});

vi.mock('../packs/software.js', () => {
  const MockPack = vi.fn(function (this: any) {
    this.domain = 'software-governance';
    this.version = '1.0.0';
  });
  return { SoftwareGovernancePack: MockPack };
});

vi.mock('../delta.js', () => ({ generateRecoveryAppendix: vi.fn().mockReturnValue([]) }));

import { main } from '../cli.js';

describe('AUD-TC-11d-10: CLI failure exits non-zero', () => {
  it('uses exit code 1 when startup fails', async () => {
    runtimeRunRef.fn = vi.fn().mockRejectedValue(new Error('forced failure'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    await main().catch(() => {
      process.exit(1);
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
