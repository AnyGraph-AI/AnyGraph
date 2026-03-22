/**
 * UI-7 — Error states: Neo4j disconnected, query failed, timeout
 * Tests run in node environment — verifies module structure + source patterns.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const HOOKS_DIR = path.resolve(import.meta.dirname, '..', 'hooks');
const LIB_DIR = path.resolve(import.meta.dirname, '..', 'lib');

describe('[UI-7] error state utilities', () => {
  it('exports classifyError from errorUtils', async () => {
    const mod = await import('@/lib/errorUtils');
    expect(typeof mod.classifyError).toBe('function');
  });

  it('classifyError returns neo4j_disconnected for network errors', async () => {
    const { classifyError } = await import('@/lib/errorUtils');
    const networkErr = new TypeError('Failed to fetch');
    expect(classifyError(networkErr)).toBe('neo4j_disconnected');
  });

  it('classifyError returns neo4j_disconnected for ECONNREFUSED', async () => {
    const { classifyError } = await import('@/lib/errorUtils');
    const connErr = new Error('connect ECONNREFUSED 127.0.0.1:7687');
    expect(classifyError(connErr)).toBe('neo4j_disconnected');
  });

  it('classifyError returns query_timeout for timeout errors', async () => {
    const { classifyError } = await import('@/lib/errorUtils');
    const timeoutErr = new Error('Request timeout after 5000ms');
    expect(classifyError(timeoutErr)).toBe('query_timeout');
  });

  it('classifyError returns query_timeout for AbortError', async () => {
    const { classifyError } = await import('@/lib/errorUtils');
    const abortErr = new DOMException('The operation was aborted', 'AbortError');
    expect(classifyError(abortErr)).toBe('query_timeout');
  });

  it('classifyError returns query_failed for generic errors', async () => {
    const { classifyError } = await import('@/lib/errorUtils');
    expect(classifyError(new Error('Syntax error in query'))).toBe('query_failed');
    expect(classifyError(null)).toBe('query_failed');
    expect(classifyError(undefined)).toBe('query_failed');
  });

  it('exports ErrorKind type constants', async () => {
    const mod = await import('@/lib/errorUtils');
    expect(mod.ERROR_KINDS).toBeDefined();
    expect(mod.ERROR_KINDS.NEO4J_DISCONNECTED).toBe('neo4j_disconnected');
    expect(mod.ERROR_KINDS.QUERY_TIMEOUT).toBe('query_timeout');
    expect(mod.ERROR_KINDS.QUERY_FAILED).toBe('query_failed');
  });
});

describe('[UI-7] errorMessage()', () => {
  it('returns a non-empty string for neo4j_disconnected', async () => {
    const { errorMessage } = await import('@/lib/errorUtils');
    const msg = errorMessage('neo4j_disconnected');
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).toContain('Neo4j');
  });

  it('returns a non-empty string for query_timeout', async () => {
    const { errorMessage } = await import('@/lib/errorUtils');
    const msg = errorMessage('query_timeout');
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).toContain('timed out');
  });

  it('returns a non-empty string for query_failed', async () => {
    const { errorMessage } = await import('@/lib/errorUtils');
    const msg = errorMessage('query_failed');
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).toContain('failed');
  });

  it('each ErrorKind returns a distinct message', async () => {
    const { errorMessage } = await import('@/lib/errorUtils');
    const messages = [
      errorMessage('neo4j_disconnected'),
      errorMessage('query_timeout'),
      errorMessage('query_failed'),
    ];
    const unique = new Set(messages);
    expect(unique.size).toBe(3);
  });
});

describe('[UI-7] useDashboardData error surface', () => {
  it('useDashboardData can be imported', async () => {
    const mod = await import('@/hooks/useDashboardData');
    expect(typeof mod.useDashboardData).toBe('function');
  });

  it('useDashboardData source exposes isError and refetchAll', async () => {
    const source = await readFile(path.join(HOOKS_DIR, 'useDashboardData.ts'), 'utf8');
    expect(source).toContain('isError');
    expect(source).toContain('refetchAll');
  });

  it('useDashboardData source has per-query error capture', async () => {
    const source = await readFile(path.join(HOOKS_DIR, 'useDashboardData.ts'), 'utf8');
    // Each useQuery should capture isError and expose per-query errors
    expect(source).toContain('isError');
    expect(source).toContain('.error');
  });

  it('useDashboardData source imports classifyError', async () => {
    const source = await readFile(path.join(HOOKS_DIR, 'useDashboardData.ts'), 'utf8');
    expect(source).toContain('classifyError');
  });

  it('useDashboardData source exposes errorKind', async () => {
    const source = await readFile(path.join(HOOKS_DIR, 'useDashboardData.ts'), 'utf8');
    expect(source).toContain('errorKind');
  });
});

describe('[UI-7] ErrorState component wiring', () => {
  it('ErrorState component is importable with expected props', async () => {
    const mod = await import('@/components/ui/error-state');
    expect(typeof mod.ErrorState).toBe('function');
  });

  it('ErrorState source has onRetry prop and retry button', async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, '..', 'components', 'ui', 'error-state.tsx'),
      'utf8',
    );
    expect(source).toContain('onRetry');
    expect(source).toContain('Retry');
  });
});
