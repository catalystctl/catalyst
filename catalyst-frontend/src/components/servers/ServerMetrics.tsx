import { useTranslation } from 'react-i18next';

type Metric = {
 label: string;
 value: number;
 color: string;
};

function ServerMetrics({ cpu = 0, memory = 0, isLive = true }: { cpu?: number; memory?: number; isLive?: boolean }) {
 const { t } = useTranslation('servers');
 const metrics: Metric[] = [
 { label: t('metrics.labels.cpu'), value: cpu, color: 'bg-primary' },
 { label: t('metrics.labels.memory'), value: memory, color: 'bg-success' },
 ];

 return (
 <div className="space-y-3 rounded-md border border-border/50 bg-card p-4">
 <div className="flex items-center justify-between">
 <h3 className="type-overline">{t('metrics.resourceUsage')}</h3>
 {isLive ? (
 <span className="rounded-full bg-success-muted px-2 py-0.5 text-[11px] font-medium text-success">
 {t('metrics.live')}
 </span>
 ) : (
 <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
 {t('metrics.offline')}
 </span>
 )}
 </div>
 {metrics.map((metric) => (
 <div key={metric.label} className="space-y-1.5">
 <div className="flex items-center justify-between">
 <span className="type-overline">{metric.label}</span>
 <span className="type-numeric text-xs text-foreground">{metric.value.toFixed(0)}%</span>
 </div>
 <div className="h-2 overflow-hidden rounded-full bg-surface-2">
 <div
 className={`h-full rounded-full ${metric.value >= 90 ? 'bg-danger' : metric.color} transition-all duration-500`}
 style={{ width: `${Math.min(100, Math.max(0, metric.value))}%` }}
 />
 </div>
 </div>
 ))}
 </div>
 );
}

export default ServerMetrics;
