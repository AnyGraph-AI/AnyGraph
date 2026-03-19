'use client';

export interface ErrorStateProps {
  readonly message?: string;
  readonly onRetry?: () => void;
}

/** Error state with retry button for failed queries */
export function ErrorState({
  message = 'Failed to load data',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <span className="text-3xl mb-3">⚠️</span>
      <h3 className="text-sm font-medium text-red-400">{message}</h3>
      <p className="text-xs text-zinc-600 mt-1">
        Check Neo4j connection or try again
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}
