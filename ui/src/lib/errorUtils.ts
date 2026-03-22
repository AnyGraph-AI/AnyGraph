/**
 * UI-7: Error classification utilities for dashboard error states.
 * Classifies API/network errors into operator-actionable kinds.
 */

export type ErrorKind = 'neo4j_disconnected' | 'query_timeout' | 'query_failed';

export const ERROR_KINDS = {
  NEO4J_DISCONNECTED: 'neo4j_disconnected' as const,
  QUERY_TIMEOUT: 'query_timeout' as const,
  QUERY_FAILED: 'query_failed' as const,
} satisfies Record<string, ErrorKind>;

/**
 * Classify an unknown error into an operator-actionable ErrorKind.
 *
 * - neo4j_disconnected: network unreachable, ECONNREFUSED, Failed to fetch
 * - query_timeout: AbortError, timeout in message
 * - query_failed: everything else (bad query, syntax error, unexpected response)
 */
export function classifyError(error: unknown): ErrorKind {
  if (!error) return ERROR_KINDS.QUERY_FAILED;

  const name = (error as { name?: string })?.name ?? '';
  const message = String((error as Error)?.message ?? '').toLowerCase();

  if (name === 'AbortError' || message.includes('timeout')) {
    return ERROR_KINDS.QUERY_TIMEOUT;
  }

  if (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('fetch')
  ) {
    return ERROR_KINDS.NEO4J_DISCONNECTED;
  }

  return ERROR_KINDS.QUERY_FAILED;
}

/** Human-readable message for each error kind */
export function errorMessage(kind: ErrorKind): string {
  switch (kind) {
    case 'neo4j_disconnected':
      return 'Neo4j connection lost. Check that Neo4j is running on bolt://localhost:7687.';
    case 'query_timeout':
      return 'Query timed out. Neo4j may be under load.';
    case 'query_failed':
      return 'Query failed. The graph may have unexpected data.';
  }
}
