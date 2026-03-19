export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  readonly icon?: string;
}

/** Empty state placeholder for panels with no data */
export function EmptyState({ title, description, icon = '📭' }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <span className="text-3xl mb-3">{icon}</span>
      <h3 className="text-sm font-medium text-zinc-400">{title}</h3>
      {description && (
        <p className="text-xs text-zinc-600 mt-1 max-w-xs">{description}</p>
      )}
    </div>
  );
}
