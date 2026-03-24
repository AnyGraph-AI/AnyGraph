// Fork: Drew/Jason origin
// AUD-TC B6 (Health Witness) — progress-reporter.ts audit tests
// SPEC-GAP: No formal spec exists; behaviors derived from task description and code signatures

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProgressReporter, ProgressUpdate, ProgressCallback } from '../../utils/progress-reporter';

describe('ProgressReporter audit tests', () => {
  let reporter: ProgressReporter;

  beforeEach(() => {
    reporter = new ProgressReporter();
    vi.restoreAllMocks();
  });

  // Behavior 1: report is a no-op when no callback is set
  it('report is a no-op when no callback is set (no throw)', async () => {
    // No callback set — should not throw
    await expect(
      reporter.report({
        phase: 'discovery',
        current: 1,
        total: 10,
        message: 'test',
      }),
    ).resolves.toBeUndefined();
  });

  // Behavior 2: setCallback stores callback and resets startTime
  it('setCallback stores callback and resets startTime', async () => {
    const cb: ProgressCallback = vi.fn().mockResolvedValue(undefined);
    reporter.setCallback(cb);

    await reporter.report({
      phase: 'discovery',
      current: 1,
      total: 1,
      message: 'test',
    });

    expect(cb).toHaveBeenCalledOnce();
  });

  // Behavior 3: report enriches update with elapsedMs detail
  it('report enriches update with elapsedMs detail', async () => {
    let captured: ProgressUpdate | undefined;
    const cb: ProgressCallback = vi.fn().mockImplementation(async (update: ProgressUpdate) => {
      captured = update;
    });
    reporter.setCallback(cb);

    await reporter.report({
      phase: 'discovery',
      current: 1,
      total: 1,
      message: 'test',
    });

    expect(captured).toBeDefined();
    expect(captured!.details).toBeDefined();
    expect(typeof captured!.details!.elapsedMs).toBe('number');
    expect(captured!.details!.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  // Behavior 4: report catches callback errors without interrupting main operation
  it('report catches callback errors without interrupting', async () => {
    const cb: ProgressCallback = vi.fn().mockRejectedValue(new Error('callback boom'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    reporter.setCallback(cb);

    await expect(
      reporter.report({
        phase: 'discovery',
        current: 1,
        total: 1,
        message: 'test',
      }),
    ).resolves.toBeUndefined();
  });

  // Behavior 5: reportDiscovery sends phase='discovery' with correct message format
  it('reportDiscovery sends phase=discovery with correct message', async () => {
    let captured: ProgressUpdate | undefined;
    const cb: ProgressCallback = vi.fn().mockImplementation(async (u: ProgressUpdate) => {
      captured = u;
    });
    reporter.setCallback(cb);

    await reporter.reportDiscovery(42);

    expect(captured).toBeDefined();
    expect(captured!.phase).toBe('discovery');
    expect(captured!.current).toBe(42);
    expect(captured!.total).toBe(42);
    expect(captured!.message).toContain('42');
  });

  // Behavior 6: reportParsing sends phase='parsing' with details
  it('reportParsing sends phase=parsing with filesProcessed/currentFile/chunk details', async () => {
    let captured: ProgressUpdate | undefined;
    const cb: ProgressCallback = vi.fn().mockImplementation(async (u: ProgressUpdate) => {
      captured = u;
    });
    reporter.setCallback(cb);

    await reporter.reportParsing(5, 20, 'foo.ts', 2, 4);

    expect(captured).toBeDefined();
    expect(captured!.phase).toBe('parsing');
    expect(captured!.current).toBe(5);
    expect(captured!.total).toBe(20);
    expect(captured!.details!.filesProcessed).toBe(5);
    expect(captured!.details!.currentFile).toBe('foo.ts');
    expect(captured!.details!.chunkIndex).toBe(2);
    expect(captured!.details!.totalChunks).toBe(4);
  });

  // Behavior 7: reportImporting sends phase='importing' with nodesCreated/edgesCreated
  it('reportImporting sends phase=importing with node/edge counts', async () => {
    let captured: ProgressUpdate | undefined;
    const cb: ProgressCallback = vi.fn().mockImplementation(async (u: ProgressUpdate) => {
      captured = u;
    });
    reporter.setCallback(cb);

    await reporter.reportImporting(100, 50, 200);

    expect(captured).toBeDefined();
    expect(captured!.phase).toBe('importing');
    expect(captured!.details!.nodesCreated).toBe(100);
    expect(captured!.details!.edgesCreated).toBe(50);
    expect(captured!.current).toBe(150); // nodes + edges
  });

  // Behavior 8: reportResolving sends phase='resolving' with current/total
  it('reportResolving sends phase=resolving with current/total counts', async () => {
    let captured: ProgressUpdate | undefined;
    const cb: ProgressCallback = vi.fn().mockImplementation(async (u: ProgressUpdate) => {
      captured = u;
    });
    reporter.setCallback(cb);

    await reporter.reportResolving(30, 100);

    expect(captured).toBeDefined();
    expect(captured!.phase).toBe('resolving');
    expect(captured!.current).toBe(30);
    expect(captured!.total).toBe(100);
  });

  // Behavior 9: reportComplete sends phase='complete' with final counts
  it('reportComplete sends phase=complete with final counts', async () => {
    let captured: ProgressUpdate | undefined;
    const cb: ProgressCallback = vi.fn().mockImplementation(async (u: ProgressUpdate) => {
      captured = u;
    });
    reporter.setCallback(cb);

    await reporter.reportComplete(500, 300);

    expect(captured).toBeDefined();
    expect(captured!.phase).toBe('complete');
    expect(captured!.details!.nodesCreated).toBe(500);
    expect(captured!.details!.edgesCreated).toBe(300);
  });

  // Behavior 10: reset updates startTime to current time
  it('reset updates startTime so elapsedMs resets', async () => {
    const captures: ProgressUpdate[] = [];
    const cb: ProgressCallback = vi.fn().mockImplementation(async (u: ProgressUpdate) => {
      captures.push(u);
    });
    reporter.setCallback(cb);

    // First report
    await reporter.report({ phase: 'discovery', current: 1, total: 1, message: 'a' });

    // Reset and immediately report again — elapsedMs should be very small
    reporter.reset();
    await reporter.report({ phase: 'discovery', current: 1, total: 1, message: 'b' });

    expect(captures.length).toBe(2);
    expect(typeof captures[0].details!.elapsedMs).toBe('number');
    expect(typeof captures[1].details!.elapsedMs).toBe('number');
    // After reset, elapsed should be close to 0 (within 50ms tolerance)
    expect(captures[1].details!.elapsedMs!).toBeLessThan(50);
  });
});
