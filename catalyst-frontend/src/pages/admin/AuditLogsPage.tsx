import { useState } from 'react';
import EmptyState from '../../components/shared/EmptyState';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useAuditLogs } from '../../hooks/useAdmin';
import { adminApi } from '../../services/api/admin';

const pageSize = 50;
const buildDefaultRange = () => {
  const now = new Date();
  const initialFrom = new Date(now);
  initialFrom.setHours(now.getHours() - 24);
  return {
    from: initialFrom.toISOString().slice(0, 16),
    to: now.toISOString().slice(0, 16),
  };
};

function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [resource, setResource] = useState('');
  const [userId, setUserId] = useState('');
  const [defaultRange] = useState(buildDefaultRange);
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [range, setRange] = useState('24h');

  const { data, isLoading } = useAuditLogs({
    page,
    limit: pageSize,
    action: action || undefined,
    resource: resource || undefined,
    userId: userId || undefined,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
  });

  const logs = data?.logs ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-white p-6 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:shadow-surface-dark dark:hover:border-primary/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-foreground dark:text-white">Audit Logs</h1>
            <p className="text-sm text-muted-foreground dark:text-muted-foreground">
              Track admin and user actions across the platform.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground dark:text-muted-foreground">
            <span className="rounded-full border border-border bg-surface-2 px-3 py-1 dark:border-border dark:bg-zinc-950/60">
              {logs.length} events
            </span>
            <span className="rounded-full border border-border bg-surface-2 px-3 py-1 dark:border-border dark:bg-zinc-950/60">
              Page {pagination?.page ?? page}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-white px-6 py-5 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:hover:border-primary/30">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground dark:text-white">Filters</h2>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              Narrow down the timeline by action, resource, user, or time range.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="rounded-lg border border-border bg-transparent px-3 py-2 text-xs font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
              onClick={() => {
                setAction('');
                setResource('');
                setUserId('');
                setFrom('');
                setTo('');
                setRange('24h');
                setPage(1);
              }}
            >
              Clear filters
            </Button>
            <Button
              className="rounded-lg border border-border bg-transparent px-3 py-2 text-xs font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
              onClick={async () => {
                const payload = await adminApi.exportAuditLogs({
                  action: action || undefined,
                  resource: resource || undefined,
                  userId: userId || undefined,
                  from: from ? new Date(from).toISOString() : undefined,
                  to: to ? new Date(to).toISOString() : undefined,
                  format: 'csv',
                });
                const blob = new Blob([payload], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `audit-logs-${Date.now()}.csv`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
              }}
            >
              Export CSV
            </Button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <label className="text-xs text-muted-foreground dark:text-zinc-300">
            Action contains
            <Input
              value={action}
              onChange={(event) => setAction(event.target.value)}
              placeholder="server.create"
              className="mt-1"
            />
          </label>
          <label className="text-xs text-muted-foreground dark:text-zinc-300">
            Resource
            <Input
              value={resource}
              onChange={(event) => setResource(event.target.value)}
              placeholder="server"
              className="mt-1"
            />
          </label>
          <label className="text-xs text-muted-foreground dark:text-zinc-300">
            User ID
            <Input
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="cuid"
              className="mt-1"
            />
          </label>
          <label className="text-xs text-muted-foreground dark:text-zinc-300">
            From
            <Input
              type="datetime-local"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setRange('');
                setPage(1);
              }}
              className="mt-1"
            />
          </label>
          <label className="text-xs text-muted-foreground dark:text-zinc-300">
            To
            <Input
              type="datetime-local"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setRange('');
                setPage(1);
              }}
              className="mt-1"
            />
          </label>
          <label className="text-xs text-muted-foreground dark:text-zinc-300">
            Quick range
            <Select
              value={range || 'custom'}
              onValueChange={(next) => {
                const value = next === 'custom' ? '' : next;
                setRange(value);
                if (!value) return;
                const now = new Date();
                const nextFrom = new Date(now);
                if (value === '1h') nextFrom.setHours(now.getHours() - 1);
                if (value === '6h') nextFrom.setHours(now.getHours() - 6);
                if (value === '24h') nextFrom.setHours(now.getHours() - 24);
                if (value === '7d') nextFrom.setDate(now.getDate() - 7);
                setFrom(nextFrom.toISOString().slice(0, 16));
                setTo(now.toISOString().slice(0, 16));
                setPage(1);
              }}
            >
              <SelectTrigger className="mt-1 w-full">
                <SelectValue placeholder="Custom" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Custom</SelectItem>
                <SelectItem value="1h">Last 1h</SelectItem>
                <SelectItem value="6h">Last 6h</SelectItem>
                <SelectItem value="24h">Last 24h</SelectItem>
                <SelectItem value="7d">Last 7d</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-white px-4 py-6 text-muted-foreground shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-300 dark:hover:border-primary/30">
          Loading audit logs...
        </div>
      ) : logs.length ? (
        <div className="rounded-2xl border border-border bg-white shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:hover:border-primary/30">
          <div className="grid grid-cols-12 gap-3 border-b border-border px-5 py-3 text-xs uppercase text-muted-foreground dark:border-border dark:text-muted-foreground">
            <div className="col-span-3">User</div>
            <div className="col-span-3">Action</div>
            <div className="col-span-2">Resource</div>
            <div className="col-span-2">IP</div>
            <div className="col-span-2 text-right">Timestamp</div>
          </div>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {logs.map((log) => (
              <div
                key={log.id}
                className="grid grid-cols-12 gap-3 px-5 py-4 text-sm text-muted-foreground dark:text-zinc-300"
              >
                <div className="col-span-3">
                  <div className="font-semibold text-foreground dark:text-zinc-100">
                    {log.user?.username ?? 'Unknown'}
                  </div>
                  <div className="text-xs text-muted-foreground dark:text-muted-foreground dark:text-muted-foreground">
                    {log.user?.email ?? log.userId ?? 'n/a'}
                  </div>
                </div>
                <div className="col-span-3 text-foreground dark:text-zinc-100">{log.action}</div>
                <div className="col-span-2 text-muted-foreground dark:text-zinc-300">{log.resource}</div>
                <div className="col-span-2 text-xs text-muted-foreground dark:text-muted-foreground dark:text-muted-foreground">
                  {log.ipAddress ?? 'n/a'}
                </div>
                <div className="col-span-2 text-right text-xs text-muted-foreground dark:text-muted-foreground dark:text-muted-foreground">
                  {new Date(log.timestamp).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
          {pagination ? (
            <div className="flex items-center justify-between border-t border-border px-5 py-4 text-xs text-muted-foreground dark:border-border dark:text-muted-foreground">
              <span>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground disabled:opacity-50 dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </button>
                <button
                  className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground disabled:opacity-50 dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
                  onClick={() =>
                    setPage((prev) => (pagination.page < pagination.totalPages ? prev + 1 : prev))
                  }
                  disabled={pagination.page >= pagination.totalPages}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState
          title="No audit logs"
          description="Audit events will appear once user actions are recorded."
        />
      )}
    </div>
  );
}

export default AuditLogsPage;
