import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Activity } from 'lucide-react';
import { qk } from '../../../lib/queryKeys';
import { serversApi } from '../../../services/api/servers';
import type { ServerActivityLogResponse } from '../../../types/server';
import ServerTabCard from './ServerTabCard';
import TabHeader from './TabHeader';
import TabEmptyState from './TabEmptyState';
import TabErrorState from './TabErrorState';
import TabLoadingState from './TabLoadingState';

const formatDateTime = (value?: string | null) =>
 value ? new Date(value).toLocaleString() : '—';

const formatActionLabel = (action: string): string =>
 action
 .replace(/^server\./, '')
 .replace(/_/g, ' ')
 .replace(/([A-Z])/g, ' $1')
 .replace(/^./, (s) => s.toUpperCase())
 .trim();

interface Props {
 serverId: string;
}

export default function ServerActivityLogTab({ serverId }: Props) {
 const [page, setPage] = useState(1);
 const limit = 25;

 const { data, isLoading, isError, error } = useQuery<ServerActivityLogResponse>({
 queryKey: qk.serverActivity(serverId, { page, limit }),
 queryFn: () => serversApi.activity(serverId, { page, limit }),
 enabled: Boolean(serverId),
 staleTime: 30_000,
 refetchInterval: 10_000,
 });

 const items = data?.data ?? [];
 const pagination = data?.pagination;

 return (
 <div className="space-y-4">
 <TabHeader
 icon={Activity}
 title="Activity Log"
 description="Recent actions performed on this server."
 />

 <ServerTabCard>
 {isLoading ? (
 <TabLoadingState rows={5} />
 ) : isError ? (
 <TabErrorState
 message={
 error instanceof Error ? error.message : 'Failed to load activity log'
 }
 />
 ) : items.length === 0 ? (
 <TabEmptyState
 title="No activity recorded"
 description="Actions performed on this server will appear here."
 />
 ) : (
 <div className="space-y-1.5">
 {items.map((entry) => (
 <div
 key={entry.id}
 className="group relative flex flex-wrap items-start gap-3 rounded-lg border border-border/30 px-4 py-2.5 transition-all duration-150 hover:border-primary/20 hover:bg-primary/[0.02]"
 >
 {/* Left accent bar on hover */}
 <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary/0 transition-colors duration-150 group-hover:bg-primary/50" />

 <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/8 text-[9px] font-bold text-primary">
 {(entry.user?.username ?? entry.user?.name ?? 'S')[0].toUpperCase()}
 </div>
 <div className="min-w-0 flex-1">
 <div className="flex flex-wrap items-center gap-1.5">
 <span className="text-xs font-semibold text-foreground">
 {entry.user?.username ?? entry.user?.name ?? entry.user?.email ?? 'System'}
 </span>
 <span className="rounded bg-surface-2/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
 {formatActionLabel(entry.action)}
 </span>
 </div>
 {entry.details && Object.keys(entry.details).length > 0 && (
 <div className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground/50">
 {JSON.stringify(entry.details)}
 </div>
 )}
 </div>
 <div className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/50">
 {formatDateTime(entry.timestamp)}
 </div>
 </div>
 ))}
 </div>
 )}

 {pagination && pagination.totalPages > 1 && (
 <div className="mt-4 flex items-center justify-between">
 <span className="text-[10px] tabular-nums text-muted-foreground/50">
 Page {pagination.page} of {pagination.totalPages} · {pagination.total} entries
 </span>
 <div className="flex items-center gap-1">
 <button
 type="button"
 className="rounded-md border border-border/40 p-1 text-muted-foreground transition-colors hover:bg-surface-2/50 disabled:opacity-30"
 onClick={() => setPage((p) => Math.max(1, p - 1))}
 disabled={page <= 1 || isLoading}
 title="Previous"
 >
 <ChevronLeft className="h-3.5 w-3.5" />
 </button>
 <button
 type="button"
 className="rounded-md border border-border/40 p-1 text-muted-foreground transition-colors hover:bg-surface-2/50 disabled:opacity-30"
 onClick={() => setPage((p) => p + 1)}
 disabled={page >= pagination.totalPages || isLoading}
 title="Next"
 >
 <ChevronRight className="h-3.5 w-3.5" />
 </button>
 </div>
 </div>
 )}
 </ServerTabCard>
 </div>
 );
}
