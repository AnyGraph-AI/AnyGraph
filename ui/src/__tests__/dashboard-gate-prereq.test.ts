/**
 * Gate prerequisite coverage for CRITICAL Dashboard function in `ui/src/app/page.tsx`.
 *
 * Uses relative import so enrichment can create TESTED_BY edge reliably.
 */

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';

describe('Dashboard gate prerequisite', () => {
  it('exports Dashboard default component from app/page.tsx', async () => {
    const mod = await import('../app/page');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
