import { NextResponse } from 'next/server';
import { cachedQuery } from '@/lib/neo4j';

const DEFAULT_PROJECT_ID = 'proj_c0d3e9a1f200';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId') ?? DEFAULT_PROJECT_ID;

    const rows = await cachedQuery<{
      id: string;
      filePath: string;
      name: string;
      adjustedPain: number;
    }>(
      `MATCH (sf:SourceFile {projectId: $projectId})
       WITH sf
       ORDER BY coalesce(sf.adjustedPain, 0) DESC, sf.name ASC
       LIMIT 1
       RETURN sf.id AS id,
              coalesce(sf.filePath, '') AS filePath,
              coalesce(sf.name, sf.id) AS name,
              coalesce(sf.adjustedPain, 0) AS adjustedPain`,
      { projectId },
    );

    const top = rows[0] ?? null;
    if (!top) {
      return NextResponse.json({ data: null, reason: 'no_source_files' });
    }

    return NextResponse.json({
      data: {
        focus: top.filePath || top.name,
        focusType: 'file',
        filePath: top.filePath,
        sourceNodeId: top.id,
        adjustedPain: top.adjustedPain,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Explorer default API failed', message: String(error) },
      { status: 500 },
    );
  }
}
