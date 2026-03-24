// Fork: Drew/Jason origin
// AUD-TC B6 (Health Witness) — retry.ts audit tests
// SPEC-GAP: No formal spec exists; behaviors derived from task description and code signatures

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, DEFAULT_RETRY_OPTIONS } from '../../utils/retry';

describe('retry audit tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Behavior 1: withRetry returns result on first success
  it('returns result on first success (no retry)', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });

  // Behavior 2: withRetry retries on retryable errors up to maxRetries
  it('retries on retryable errors up to maxRetries', async () => {
    const retryableError = Object.assign(new Error('timeout'), { status: 429 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(retryableError)
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValue('success');

    const promise = withRetry(fn, { maxRetries: 3 });

    // Flush all pending timers repeatedly to let retries proceed
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(60000);
    }

    const result = await promise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  // Behavior 3: withRetry throws immediately on non-retryable errors
  it('throws immediately on non-retryable errors', async () => {
    const nonRetryable = new Error('fatal');
    const fn = vi.fn().mockRejectedValue(nonRetryable);

    await expect(withRetry(fn)).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledOnce();
  });

  // Behavior 4: withRetry throws after exhausting maxRetries
  it('throws after exhausting maxRetries', async () => {
    const retryableError = Object.assign(new Error('timeout'), { status: 429 });
    const fn = vi.fn().mockRejectedValue(retryableError);

    // Attach .catch immediately to prevent unhandled rejection
    let caughtError: Error | undefined;
    const promise = withRetry(fn, { maxRetries: 2 }).catch((e) => {
      caughtError = e;
    });

    // Advance enough for all retries to complete
    await vi.runAllTimersAsync();
    await promise;

    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toBe('timeout');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  // Behavior 5: Exponential backoff — delay doubles per attempt
  it('exponential backoff: delay doubles per attempt', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // zero jitter

    const retryableError = Object.assign(new Error('timeout'), { status: 429 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(retryableError)
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValue('ok');

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000 });

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(60000);
    }

    await promise;

    // Extract delays used in setTimeout calls (filter out vitest internals)
    const delayCalls = setTimeoutSpy.mock.calls
      .filter((call) => typeof call[1] === 'number' && call[1] >= 1000)
      .map((call) => call[1] as number);

    expect(delayCalls.length).toBeGreaterThanOrEqual(2);
    // First delay: baseDelayMs * 2^0 = 1000
    expect(delayCalls[0]).toBe(1000);
    // Second delay: baseDelayMs * 2^1 = 2000
    expect(delayCalls[1]).toBe(2000);
  });

  // Behavior 6: Delay is capped at maxDelayMs
  it('delay is capped at maxDelayMs', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const retryableError = Object.assign(new Error('timeout'), { status: 429 });
    const fn = vi.fn().mockRejectedValue(retryableError);

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    let caughtError: Error | undefined;
    const promise = withRetry(fn, {
      maxRetries: 5,
      baseDelayMs: 10000,
      maxDelayMs: 15000,
    }).catch((e) => {
      caughtError = e;
    });

    await vi.runAllTimersAsync();
    await promise;

    expect(caughtError).toBeDefined();

    const delayCalls = setTimeoutSpy.mock.calls
      .filter((call) => typeof call[1] === 'number' && call[1] >= 1000)
      .map((call) => call[1] as number);

    // All delays should be <= maxDelayMs
    for (const delay of delayCalls) {
      expect(delay).toBeLessThanOrEqual(15000);
    }
  });

  // Behavior 7: Jitter is added
  it('jitter is added (delay includes random component)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // 500ms jitter

    const retryableError = Object.assign(new Error('timeout'), { status: 429 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValue('ok');

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 30000 });

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(60000);
    }

    await promise;

    const delayCalls = setTimeoutSpy.mock.calls
      .filter((call) => typeof call[1] === 'number' && call[1] >= 1000)
      .map((call) => call[1] as number);

    // baseDelayMs * 2^0 + 0.5 * 1000 = 1000 + 500 = 1500
    expect(delayCalls[0]).toBe(1500);
  });

  // Behavior 8: DEFAULT_RETRY_OPTIONS.shouldRetry returns true for expected errors
  describe('DEFAULT_RETRY_OPTIONS.shouldRetry', () => {
    const shouldRetry = DEFAULT_RETRY_OPTIONS.shouldRetry!;

    it('returns true for status=429', () => {
      expect(shouldRetry({ status: 429, message: '' })).toBe(true);
    });

    it('returns true for code=ETIMEDOUT', () => {
      expect(shouldRetry({ code: 'ETIMEDOUT', message: '' })).toBe(true);
    });

    it('returns true for timeout message', () => {
      expect(shouldRetry({ message: 'request timeout exceeded' })).toBe(true);
    });

    it('returns true for ECONNRESET message', () => {
      expect(shouldRetry({ message: 'socket hang up ECONNRESET' })).toBe(true);
    });

    // Behavior 9: returns false for other errors
    it('returns false for other errors', () => {
      expect(shouldRetry({ status: 400, message: 'bad request' })).toBe(false);
      expect(shouldRetry({ message: 'not found' })).toBe(false);
      expect(shouldRetry(new Error('generic error'))).toBe(false);
    });
  });

  // Behavior 10: Custom shouldRetry function is respected
  it('custom shouldRetry function is respected', async () => {
    const customError = new Error('custom retryable');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(customError)
      .mockResolvedValue('recovered');

    const promise = withRetry(fn, {
      maxRetries: 2,
      shouldRetry: (err) => err.message === 'custom retryable',
    });

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(60000);
    }

    const result = await promise;
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
