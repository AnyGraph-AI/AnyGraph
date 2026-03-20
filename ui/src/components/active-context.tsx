'use client';

type ActiveTask = {
  taskId: string;
  taskName: string;
  milestoneName: string;
  filePaths: string[];
  fileNames: string[];
  blockerNames: string[];
  blockerCount: number;
};

type GateFile = {
  filePath: string;
  fileName: string;
  criticalCount: number;
};

export interface ActiveContextPanelProps {
  readonly inProgressTasks: ActiveTask[];
  readonly blockedTasks: ActiveTask[];
  readonly gateBlocked: GateFile[];
  readonly gateRequireApproval: GateFile[];
  readonly onNavigateToExplorer?: (payload: { focus: string; focusType: 'file'; filePath?: string }) => void;
}

function shortPath(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length <= 3) return filePath;
  return parts.slice(-3).join('/');
}

function firstFile(task: ActiveTask): { filePath?: string; label: string } {
  const filePath = task.filePaths.find(Boolean);
  const fileName = task.fileNames.find(Boolean);
  return {
    filePath,
    label: filePath ? shortPath(filePath) : (fileName || 'no linked file yet'),
  };
}

export function ActiveContextPanel({
  inProgressTasks,
  blockedTasks,
  gateBlocked,
  gateRequireApproval,
  onNavigateToExplorer,
}: ActiveContextPanelProps) {
  const totalHotItems = blockedTasks.length + gateBlocked.length;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5" aria-label="Active Context">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-[-0.01em] text-zinc-100">Active Context</h2>
          <p className="mt-1 font-mono text-[10px] text-zinc-500">What blocks the operator right now</p>
        </div>
        <div className="font-mono text-[10px] text-zinc-500">
          in-progress {inProgressTasks.length} · blocked {blockedTasks.length} · gate {gateBlocked.length + gateRequireApproval.length}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-3">
          <h3 className="text-xs font-semibold text-orange-300">Blocked Tasks</h3>
          <ul className="mt-2 space-y-2 text-xs">
            {blockedTasks.length === 0 ? (
              <li className="text-zinc-500">No blocked tasks.</li>
            ) : (
              blockedTasks.slice(0, 5).map((task) => {
                const file = firstFile(task);
                return (
                  <li key={task.taskId || task.taskName} className="text-zinc-200">
                    <div className="font-medium">{task.taskName}</div>
                    <div className="text-zinc-500">{task.blockerCount} blockers</div>
                    <button
                      className="mt-1 font-mono text-[10px] text-[#7ec8e3] hover:text-[#9fd8ef]"
                      onClick={() => file.filePath && onNavigateToExplorer?.({ focus: file.filePath, focusType: 'file', filePath: file.filePath })}
                      disabled={!file.filePath}
                    >
                      {file.filePath ? `Open ${file.label}` : file.label}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <h3 className="text-xs font-semibold text-emerald-300">In Progress</h3>
          <ul className="mt-2 space-y-2 text-xs">
            {inProgressTasks.length === 0 ? (
              <li className="text-zinc-500">No in-progress tasks.</li>
            ) : (
              inProgressTasks.slice(0, 5).map((task) => {
                const file = firstFile(task);
                return (
                  <li key={task.taskId || task.taskName} className="text-zinc-200">
                    <div className="font-medium">{task.taskName}</div>
                    <div className="text-zinc-500">{task.milestoneName || 'No milestone'}</div>
                    <button
                      className="mt-1 font-mono text-[10px] text-[#7ec8e3] hover:text-[#9fd8ef]"
                      onClick={() => file.filePath && onNavigateToExplorer?.({ focus: file.filePath, focusType: 'file', filePath: file.filePath })}
                      disabled={!file.filePath}
                    >
                      {file.filePath ? `Open ${file.label}` : file.label}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
          <h3 className="text-xs font-semibold text-red-300">Gate Pressure</h3>
          <ul className="mt-2 space-y-2 text-xs">
            {gateBlocked.length + gateRequireApproval.length === 0 ? (
              <li className="text-zinc-500">No gate-sensitive files.</li>
            ) : (
              [...gateBlocked.slice(0, 3), ...gateRequireApproval.slice(0, 3)].map((row) => {
                const label = row.filePath ? shortPath(row.filePath) : row.fileName;
                const isBlocked = gateBlocked.some((x) => x.filePath === row.filePath && x.fileName === row.fileName);
                return (
                  <li key={`${row.filePath}:${row.fileName}`} className="text-zinc-200">
                    <div className="font-medium">{isBlocked ? 'BLOCK' : 'REQUIRE_APPROVAL'} · {row.criticalCount} CRITICAL</div>
                    <button
                      className="mt-1 font-mono text-[10px] text-[#7ec8e3] hover:text-[#9fd8ef]"
                      onClick={() => row.filePath && onNavigateToExplorer?.({ focus: row.filePath, focusType: 'file', filePath: row.filePath })}
                      disabled={!row.filePath}
                    >
                      {label || 'unknown file'}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </div>

      <p className="mt-3 font-mono text-[10px] text-zinc-600">Hot items: {totalHotItems}</p>
    </section>
  );
}
