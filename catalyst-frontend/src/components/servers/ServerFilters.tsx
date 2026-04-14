import { useEffect, useState } from 'react';
import type { ServerListParams, ServerStatus } from '../../types/server';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Search, X } from 'lucide-react';

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

  const hasFilters = search || status;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-[240px] flex-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by name or node..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>
      <div className="min-w-[160px]">
        <Select
          value={status ?? '__all__'}
          onValueChange={(v) => setStatus(v === '__all__' ? undefined : (v as ServerStatus))}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setStatus(undefined); }} className="gap-1.5 text-xs">
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      )}
    </div>
  );
}

export default ServerFilters;
