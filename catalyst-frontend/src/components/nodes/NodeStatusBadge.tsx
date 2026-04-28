function NodeStatusBadge({ isOnline }: { isOnline: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        isOnline
          ? 'bg-success/5 text-success dark:bg-success/50/10 dark:text-success'
          : 'bg-surface-2 text-muted-foreground dark:bg-surface-2 dark:text-muted-foreground'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-success/50' : 'bg-muted-foreground dark:bg-muted-foreground'}`} />
      {isOnline ? 'Online' : 'Offline'}
    </span>
  );
}

export default NodeStatusBadge;
