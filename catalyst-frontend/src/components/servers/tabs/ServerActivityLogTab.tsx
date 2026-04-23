import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Activity, User, Clock, AlertCircle } from 'lucide-react';
import { qk } from '../../../lib/queryKeys';
import { serversApi } from '../../../services/api/servers';
import type { ServerActivityLogResponse } from '../../../types/server';
import ServerTabCard from './ServerTabCard';

const formatDateTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : '—';

const formatActionLabel = (action: string): string => {
  // Convert snake_case or camelCase to readable text
  return action
    .replace(/^server\./, '')
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
};

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
  });

  const items = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <ServerTabCard>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-foreground">Activity log</div>
          <div className="text-xs text-muted-foreground">
            Recent actions performed on this server.
          </div>
        </div>
        <Activity className="h-4 w-4 text-muted-foreground" />
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-lg bg-surface-2"
              />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-lg border border-danger/30 bg-danger-muted px-4 py-3 text-xs text-danger">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              <span>
                {error instanceof Error ? error.message : 'Failed to load activity log'}
              </span>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface-2 px-6 py-8 text-center text-sm text-muted-foreground/50">
            No activity recorded for this server yet.
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-start gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3 transition-all duration-300 hover:border-primary/20"
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-500/10">
                  <User className="h-3.5 w-3.5 text-primary-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      {entry.user?.username ?? entry.user?.name ?? entry.user?.email ?? 'System'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatActionLabel(entry.action)}
                    </span>
                  </div>
                  {entry.details && Object.keys(entry.details).length > 0 && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {JSON.stringify(entry.details)}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {formatDateTime(entry.timestamp)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages} (
            {pagination.total} total)
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-md border border-border p-1 text-muted-foreground transition-colors hover:bg-surface-2 disabled:opacity-40"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
              title="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="rounded-md border border-border p-1 text-muted-foreground transition-colors hover:bg-surface-2 disabled:opacity-40"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= pagination.totalPages || isLoading}
              title="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </ServerTabCard>
  );
}
