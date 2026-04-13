function NodeStatusBadge({ isOnline }: { isOnline: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        isOnline
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
          : 'bg-surface-2 text-muted-foreground dark:bg-surface-2 dark:text-muted-foreground'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-surface-20'}`} />
      {isOnline ? 'Online' : 'Offline'}
    </span>
  );
}

export default NodeStatusBadge;
