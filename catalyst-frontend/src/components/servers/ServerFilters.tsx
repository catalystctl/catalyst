import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ServerListParams, ServerStatus } from '../../types/server';
import { serverStatusLabel } from '../../utils/constants';
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
  'running', 'stopped', 'installing', 'starting', 'stopping', 'crashed', 'transferring', 'cloning', 'suspended',
];

type Props = {
  onChange: (filters: ServerListParams) => void;
};

function ServerFilters({ onChange }: Props) {
  const { t } = useTranslation('servers');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ServerStatus | undefined>();

  useEffect(() => {
    const debounce = setTimeout(() => onChange({ search, status }), 200);
    return () => clearTimeout(debounce);
  }, [search, status, onChange]);

  const hasFilters = search || status;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[14rem] flex-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder={t('filters.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 rounded-sm pl-7 text-mini"
        />
      </div>
      <div className="min-w-[10rem]">
        <Select
          value={status ?? '__all__'}
          onValueChange={(v) => setStatus(v === '__all__' ? undefined : (v as ServerStatus))}
        >
          <SelectTrigger className="h-7 w-full rounded-sm text-mini">
            <SelectValue placeholder={t('filters.allStatuses')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t('filters.allStatuses')}</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {serverStatusLabel(t, s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setSearch(''); setStatus(undefined); }}
          className="h-7 gap-1.5 rounded-sm px-2.5 text-mini"
        >
          <X className="h-3.5 w-3.5" />
          {t('filters.clear')}
        </Button>
      )}
    </div>
  );
}

export default ServerFilters;
