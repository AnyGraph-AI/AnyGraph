/**
 * Fetch helper for Neo4j graph queries via the API route.
 * Extracted from page.tsx for testability.
 */
export async function fetchQuery(
  query: string,
  params: Record<string, unknown> = {},
): Promise<{ data: Record<string, unknown>[] }> {
  const res = await fetch('/api/graph/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, params }),
  });
  if (!res.ok) throw new Error(`Query failed: ${res.statusText}`);
  return res.json();
}
