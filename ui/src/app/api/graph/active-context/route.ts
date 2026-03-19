import { NextResponse } from 'next/server';
import { cachedQuery } from '@/lib/neo4j';
import { QUERIES } from '@/lib/queries';

const DEFAULT_PROJECT_ID = 'proj_c0d3e9a1f200';
const DEFAULT_PLAN_PREFIX = 'plan_codegraph';

type ActiveContextRow = {
  kind: 'in_progress_task' | 'blocked_task' | 'gate_file';
  taskId: string;
  taskName: string;
  milestoneName: string;
  filePath: string;
  fileName: string;
  blockerNames: string[];
  blockerCount: number;
  gateStatus: 'BLOCK' | 'REQUIRE_APPROVAL' | '';
  criticalCount: number;
  tested: boolean;
};

type TaskView = {
  taskId: string;
  taskName: string;
  milestoneName: string;
  filePaths: string[];
  fileNames: string[];
  blockerNames: string[];
  blockerCount: number;
};

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter((v) => v && v.trim().length > 0)));
}

function toTaskMap(rows: ActiveContextRow[]): TaskView[] {
  const map = new Map<string, TaskView>();

  for (const row of rows) {
    const key = row.taskId || row.taskName;
    if (!key) continue;
    const current = map.get(key) ?? {
      taskId: row.taskId,
      taskName: row.taskName,
      milestoneName: row.milestoneName,
      filePaths: [],
      fileNames: [],
      blockerNames: [],
      blockerCount: row.blockerCount ?? 0,
    };

    current.filePaths = uniq([...current.filePaths, row.filePath]);
    current.fileNames = uniq([...current.fileNames, row.fileName]);
    current.blockerNames = uniq([...current.blockerNames, ...(row.blockerNames ?? [])]);
    current.blockerCount = Math.max(current.blockerCount, row.blockerCount ?? 0, current.blockerNames.length);

    map.set(key, current);
  }

  return Array.from(map.values());
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId') ?? DEFAULT_PROJECT_ID;
    const planProjectPrefix = url.searchParams.get('planProjectPrefix') ?? DEFAULT_PLAN_PREFIX;
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 25)));

    const rows = await cachedQuery<ActiveContextRow>(QUERIES.activeContext, {
      projectId,
      planProjectPrefix,
      limit,
    });

    const inProgressRows = rows.filter((r) => r.kind === 'in_progress_task');
    const blockedRows = rows.filter((r) => r.kind === 'blocked_task');
    const gateRows = rows.filter((r) => r.kind === 'gate_file');

    const inProgressTasks = toTaskMap(inProgressRows);
    const blockedTasks = toTaskMap(blockedRows).sort((a, b) => b.blockerCount - a.blockerCount);

    const gateBlocked = gateRows
      .filter((r) => r.gateStatus === 'BLOCK')
      .map((r) => ({
        filePath: r.filePath,
        fileName: r.fileName,
        criticalCount: r.criticalCount,
      }));

    const gateRequireApproval = gateRows
      .filter((r) => r.gateStatus === 'REQUIRE_APPROVAL')
      .map((r) => ({
        filePath: r.filePath,
        fileName: r.fileName,
        criticalCount: r.criticalCount,
      }));

    return NextResponse.json({
      data: {
        inProgressTasks,
        blockedTasks,
        gateBlocked,
        gateRequireApproval,
        summary: {
          inProgressTaskCount: inProgressTasks.length,
          blockedTaskCount: blockedTasks.length,
          blockedFileCount: gateBlocked.length,
          requireApprovalFileCount: gateRequireApproval.length,
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Active context API failed', message: String(error) },
      { status: 500 },
    );
  }
}
