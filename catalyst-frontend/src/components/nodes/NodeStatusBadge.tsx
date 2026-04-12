function NodeStatusBadge({ isOnline }: { isOnline: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
        isOnline
          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500'
          : 'border-border bg-surface-1 text-muted-foreground'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
      {isOnline ? 'Online' : 'Offline'}
    </span>
  );
}

export default NodeStatusBadge;
