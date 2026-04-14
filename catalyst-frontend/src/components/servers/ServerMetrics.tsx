type Metric = {
  label: string;
  value: number;
  color: string;
};

function ServerMetrics({ cpu = 0, memory = 0 }: { cpu?: number; memory?: number }) {
  const metrics: Metric[] = [
    { label: 'CPU', value: cpu, color: 'bg-primary' },
    { label: 'Memory', value: memory, color: 'bg-success' },
  ];

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Resource usage</h3>
        <span className="rounded-full bg-success-muted px-2 py-0.5 text-[11px] font-medium text-success">
          Live
        </span>
      </div>
      {metrics.map((metric) => (
        <div key={metric.label} className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{metric.label}</span>
            <span className="font-semibold text-foreground">{metric.value.toFixed(0)}%</span>
          </div>
          <div className="h-2 rounded-full bg-surface-2">
            <div
              className={`h-2 rounded-full ${metric.color} transition-all duration-500`}
              style={{ width: `${Math.min(100, Math.max(0, metric.value))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default ServerMetrics;
