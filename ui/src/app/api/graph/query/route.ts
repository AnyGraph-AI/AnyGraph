/**
 * UI-1: Generic graph query API route
 *
 * POST /api/graph/query
 * Body: { query: string, params?: Record<string, unknown> }
 *
 * Reads pre-computed properties — no heavy computation at query time.
 * Only allows read queries (no MERGE, CREATE, DELETE, SET).
 */
import { NextResponse } from 'next/server';
import { cachedQuery, isConnected } from '@/lib/neo4j';
import { QUERIES } from '@/lib/queries';

const BLOCKED_KEYWORDS = ['MERGE', 'CREATE', 'DELETE', 'SET', 'REMOVE', 'DETACH', 'DROP'];

function isReadOnly(query: string): boolean {
  const upper = query.toUpperCase();
  return !BLOCKED_KEYWORDS.some((kw) => upper.includes(kw));
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { query, params = {} } = body as {
      query: string;
      params?: Record<string, unknown>;
    };

    if (!query) {
      return NextResponse.json({ error: 'Missing query' }, { status: 400 });
    }

    if (!isReadOnly(query)) {
      return NextResponse.json({ error: 'Write queries not allowed' }, { status: 403 });
    }

    const rows = await cachedQuery(query, params);
    return NextResponse.json({ data: rows, count: rows.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  const connected = await isConnected();
  return NextResponse.json({
    connected,
    availableQueries: Object.keys(QUERIES),
  });
}
