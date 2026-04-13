import { useEffect, useState } from 'react';
import type { ServerListParams, ServerStatus } from '../../types/server';

const statuses: ServerStatus[] = [
  'running', 'stopped', 'installing', 'starting', 'stopping', 'crashed', 'transferring', 'suspended',
];

type Props = {
  onChange: (filters: ServerListParams) => void;
};

function ServerFilters({ onChange }: Props) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ServerStatus | undefined>();

  useEffect(() => {
    const debounce = setTimeout(() => onChange({ search, status }), 200);
    return () => clearTimeout(debounce);
  }, [search, status, onChange]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[240px]">
        <div className="relative">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            placeholder="Search by name or node..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-background py-2 pl-10 pr-4 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>
      <div className="min-w-[160px]">
        <select
          value={status ?? ''}
          onChange={(e) => setStatus(e.target.value ? (e.target.value as ServerStatus) : undefined)}
          className="h-9 w-full rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>
      {(search || status) && (
        <button
          onClick={() => { setSearch(''); setStatus(undefined); }}
          className="h-9 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-danger/30 hover:bg-danger/10 hover:text-danger"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

export default ServerFilters;
