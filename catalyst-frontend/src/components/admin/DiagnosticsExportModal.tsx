import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Download, LifeBuoy, Loader2, Search } from 'lucide-react';
import { adminApi } from '../../services/api/admin';
import { getLocalizedErrorMessage } from '../../i18n/api-errors';
import { useNodes } from '../../hooks/useNodes';
import { useServers } from '../../hooks/useServers';
import type { Server } from '../../types/server';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { BracketLabel } from '../../components/deck/primitives';

// ── Scope helpers ──
// `all` means "server-side default" — the API expands it to every entity, so a
// large fleet never bloats the query string. `none` sends the literal `none`.
type ScopeMode = 'all' | 'none' | 'custom';

const scopeParam = (mode: ScopeMode, ids: string[]): string => {
  if (mode === 'all') return 'all';
  if (mode === 'custom' && ids.length > 0) return ids.join(',');
  return 'none';
};

const TIME_RANGES = [
  { value: '1h', hours: 1 },
  { value: '6h', hours: 6 },
  { value: '24h', hours: 24 },
  { value: '7d', hours: 24 * 7 },
  { value: '30d', hours: 24 * 30 },
  { value: 'custom', hours: null },
] as const;

type TimeRangeValue = (typeof TIME_RANGES)[number]['value'];

/** Display label for a diagnostics time range. */
function timeRangeLabel(t: TFunction<'admin-system'>, value: TimeRangeValue): string {
  switch (value) {
    case '1h': return t('diagnostics.range1h');
    case '6h': return t('diagnostics.range6h');
    case '24h': return t('diagnostics.range24h');
    case '7d': return t('diagnostics.range7d');
    case '30d': return t('diagnostics.range30d');
    case 'custom': return t('diagnostics.rangeCustom');
    default: return value;
  }
}

const SECTION_KEYS = ['panel', 'errors', 'nodes', 'servers', 'env'] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

/** Display label for one bundle section. */
function sectionLabel(t: TFunction<'admin-system'>, key: SectionKey): string {
  switch (key) {
    case 'panel': return t('diagnostics.sections.panel');
    case 'errors': return t('diagnostics.sections.errors');
    case 'nodes': return t('diagnostics.sections.nodes');
    case 'servers': return t('diagnostics.sections.servers');
    case 'env': return t('diagnostics.sections.env');
    default: return key;
  }
}

const defaultCustomRange = () => {
  const now = new Date();
  const from = new Date(now);
  from.setHours(now.getHours() - 24);
  return {
    from: from.toISOString().slice(0, 16),
    to: now.toISOString().slice(0, 16),
  };
};

// ── Scope picker ──
/**
 * Scrollable checkbox list with a tri-state "select all" toggle. Unchecked
 * means `none`; an untouched picker keeps `mode === 'all'`, which sends the
 * literal `all` rather than every id.
 */
function ScopePicker({
  items,
  mode,
  selected,
  onModeChange,
  onToggle,
  disabled,
  allLabel,
  emptyLabel,
  search,
}: {
  items: { id: string; name: string; secondary?: string }[];
  mode: ScopeMode;
  selected: string[];
  onModeChange: (mode: ScopeMode) => void;
  onToggle: (id: string) => void;
  disabled: boolean;
  allLabel: string;
  emptyLabel: string;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    ariaLabel: string;
  };
}) {
  const { t } = useTranslation('admin-system');
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allChecked = mode === 'all';

  return (
    <div className="overflow-hidden rounded-sm border border-border/40 bg-surface-2/30">
      <label className="flex items-center gap-2 border-b border-border/40 px-2.5 py-1.5 text-mini">
        <input
          type="checkbox"
          checked={allChecked}
          ref={(el) => {
            if (el) el.indeterminate = mode === 'custom';
          }}
          disabled={disabled}
          onChange={() => onModeChange(allChecked ? 'none' : 'all')}
          className="h-4 w-4 rounded-sm border-border/60 bg-card text-primary focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
        />
        <span className="font-medium text-foreground">{allLabel}</span>
      </label>

      {search && (
        <div className="relative border-b border-border/40">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder}
            aria-label={search.ariaLabel}
            disabled={disabled}
            className="h-8 rounded-none border-0 bg-transparent pl-7 text-mini focus-visible:ring-0"
          />
        </div>
      )}

      <div className="max-h-40 divide-y divide-border/30 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-2.5 py-3 text-center text-mini text-muted-foreground">{emptyLabel}</p>
        ) : (
          items.map((item) => {
            const checked = mode === 'all' || (mode === 'custom' && selectedSet.has(item.id));
            return (
              <label
                key={item.id}
                className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-mini transition-colors hover:bg-surface-1/40"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onToggle(item.id)}
                  className="h-4 w-4 shrink-0 rounded-sm border-border/60 bg-card text-primary focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                />
                <span className="truncate font-medium text-foreground" title={item.name}>
                  {item.name}
                </span>
                {item.secondary && (
                  <span className="ml-auto shrink-0 font-mono text-micro text-muted-foreground">
                    {item.secondary}
                  </span>
                )}
              </label>
            );
          })
        )}
      </div>
      {mode === 'none' || (mode === 'custom' && selected.length === 0) ? (
        <p className="border-t border-border/40 px-2.5 py-1.5 text-micro text-warning">
          {t('diagnostics.noneSelected')}
        </p>
      ) : null}
    </div>
  );
}

// ── Diagnostics export modal ──
function DiagnosticsExportModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('admin-system');
  const { data: nodes = [], isLoading: nodesLoading } = useNodes();
  const { data: servers = [], isLoading: serversLoading } = useServers();

  const [range, setRange] = useState<TimeRangeValue>('24h');
  const [customRange] = useState(defaultCustomRange);
  const [from, setFrom] = useState(customRange.from);
  const [to, setTo] = useState(customRange.to);

  const [nodeMode, setNodeMode] = useState<ScopeMode>('all');
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [serverMode, setServerMode] = useState<ScopeMode>('all');
  const [selectedServers, setSelectedServers] = useState<string[]>([]);
  const [serverSearch, setServerSearch] = useState('');

  const [redaction, setRedaction] = useState<'standard' | 'strict'>('standard');
  const [sections, setSections] = useState<Record<SectionKey, boolean>>({
    panel: true,
    errors: true,
    nodes: true,
    servers: true,
    env: true,
  });

  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleInScope = (
    id: string,
    mode: ScopeMode,
    selected: string[],
    allIds: string[],
    setMode: (mode: ScopeMode) => void,
    setSelected: (ids: string[]) => void,
  ) => {
    if (mode === 'all') {
      setMode('custom');
      setSelected(allIds.filter((next) => next !== id));
      return;
    }
    if (mode === 'none') {
      setMode('custom');
      setSelected([id]);
      return;
    }
    setSelected(selected.includes(id) ? selected.filter((next) => next !== id) : [...selected, id]);
  };

  const nodeItems = useMemo(
    () => nodes.map((node) => ({ id: node.id, name: node.name })),
    [nodes],
  );

  const serverItems = useMemo(
    () =>
      (servers as (Server & { uuid?: string })[]).map((server) => ({
        id: server.id,
        name: server.name,
        uuid: server.uuid,
      })),
    [servers],
  );

  const filteredServerItems = useMemo(() => {
    const query = serverSearch.trim().toLowerCase();
    if (!query) return serverItems;
    return serverItems.filter(
      (server) =>
        server.name.toLowerCase().includes(query) ||
        server.id.toLowerCase().includes(query) ||
        (server.uuid ?? '').toLowerCase().includes(query),
    );
  }, [serverItems, serverSearch]);

  const selectedSectionKeys = SECTION_KEYS.filter((key) => sections[key]);
  const canDownload = selectedSectionKeys.length > 0 && !isDownloading;

  const handleDownload = async () => {
    if (!canDownload) return;
    setIsDownloading(true);
    setError(null);
    try {
      const selectedRange = TIME_RANGES.find((option) => option.value === range);
      const params: NonNullable<Parameters<typeof adminApi.exportDiagnostics>[0]> = {
        nodes: scopeParam(nodeMode, selectedNodes),
        servers: scopeParam(serverMode, selectedServers),
        redaction,
        sections: selectedSectionKeys.join(','),
      };
      if (range === 'custom') {
        if (from) params.from = new Date(from).toISOString();
        if (to) params.to = new Date(to).toISOString();
      } else {
        params.hours = selectedRange?.hours ?? 24;
      }

      const payload = await adminApi.exportDiagnostics(params);
      const blob = new Blob([payload], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `catalyst-diagnostics-${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      setError(getLocalizedErrorMessage(err));
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !isDownloading) onClose(); }}>
      <DialogContent size="lg">
        <DialogHeader icon={<LifeBuoy className="h-4 w-4" />}>
          <DialogTitle>{t('diagnostics.title')}</DialogTitle>
          <DialogDescription>{t('diagnostics.description')}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5">
          {/* Time range */}
          <div className="space-y-2">
            <span className="type-overline">{t('diagnostics.timeRange')}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {TIME_RANGES.map((option) => (
                <Button
                  key={option.value}
                  variant={range === option.value ? 'default' : 'outline'}
                  size="sm"
                  disabled={isDownloading}
                  onClick={() => setRange(option.value)}
                >
                  {timeRangeLabel(t, option.value)}
                </Button>
              ))}
            </div>
            {range === 'custom' && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <label className="flex flex-col gap-1">
                  <span className="type-overline">{t('diagnostics.from')}</span>
                  <Input
                    type="datetime-local"
                    value={from}
                    disabled={isDownloading}
                    onChange={(e) => setFrom(e.target.value)}
                    className="h-8 rounded-sm border-border/60 text-mini"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="type-overline">{t('diagnostics.to')}</span>
                  <Input
                    type="datetime-local"
                    value={to}
                    disabled={isDownloading}
                    onChange={(e) => setTo(e.target.value)}
                    className="h-8 rounded-sm border-border/60 text-mini"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Nodes */}
          <div className="space-y-2">
            <BracketLabel tone="muted">{t('diagnostics.nodesTitle')}</BracketLabel>
            {nodesLoading ? (
              <p className="text-mini text-muted-foreground">{t('diagnostics.loading')}</p>
            ) : (
              <ScopePicker
                items={nodeItems}
                mode={nodeMode}
                selected={selectedNodes}
                onModeChange={setNodeMode}
                onToggle={(id) =>
                  toggleInScope(
                    id,
                    nodeMode,
                    selectedNodes,
                    nodeItems.map((node) => node.id),
                    setNodeMode,
                    setSelectedNodes,
                  )
                }
                disabled={isDownloading}
                allLabel={t('diagnostics.selectAll')}
                emptyLabel={t('diagnostics.noNodes')}
              />
            )}
          </div>

          {/* Servers */}
          <div className="space-y-2">
            <BracketLabel tone="muted">{t('diagnostics.serversTitle')}</BracketLabel>
            {serversLoading ? (
              <p className="text-mini text-muted-foreground">{t('diagnostics.loading')}</p>
            ) : (
              <ScopePicker
                items={filteredServerItems}
                mode={serverMode}
                selected={selectedServers}
                onModeChange={setServerMode}
                onToggle={(id) =>
                  toggleInScope(
                    id,
                    serverMode,
                    selectedServers,
                    serverItems.map((server) => server.id),
                    setServerMode,
                    setSelectedServers,
                  )
                }
                disabled={isDownloading}
                allLabel={t('diagnostics.selectAll')}
                emptyLabel={serverSearch ? t('diagnostics.noMatches') : t('diagnostics.noServers')}
                search={{
                  value: serverSearch,
                  onChange: setServerSearch,
                  placeholder: t('diagnostics.searchPlaceholder'),
                  ariaLabel: t('diagnostics.searchAria'),
                }}
              />
            )}
          </div>

          {/* Redaction */}
          <div className="space-y-2">
            <span className="type-overline">{t('diagnostics.redaction')}</span>
            <Select
              value={redaction}
              disabled={isDownloading}
              onValueChange={(next) => setRedaction(next as 'standard' | 'strict')}
            >
              <SelectTrigger className="w-full border-border/40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">{t('diagnostics.redactionStandard')}</SelectItem>
                <SelectItem value="strict">{t('diagnostics.redactionStrict')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-micro text-muted-foreground">{t('diagnostics.redactionHelper')}</p>
          </div>

          {/* Sections */}
          <div className="space-y-2">
            <span className="type-overline">{t('diagnostics.sectionsTitle')}</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SECTION_KEYS.map((key) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2 rounded-sm border border-border/40 bg-surface-2/30 px-2.5 py-1.5 text-mini transition-colors hover:bg-surface-1/40"
                >
                  <input
                    type="checkbox"
                    checked={sections[key]}
                    disabled={isDownloading}
                    onChange={() => setSections((prev) => ({ ...prev, [key]: !prev[key] }))}
                    className="h-4 w-4 rounded-sm border-border/60 bg-card text-primary focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                  />
                  <span className="text-foreground">{sectionLabel(t, key)}</span>
                </label>
              ))}
            </div>
            {selectedSectionKeys.length === 0 && (
              <p className="text-mini text-destructive">{t('diagnostics.noSections')}</p>
            )}
          </div>

          {/* Warning */}
          <div className="rounded-sm border border-warning/40 bg-warning/5 px-3 py-2 text-mini text-warning">
            {t('diagnostics.warning')}
          </div>

          {error && <p className="text-mini text-destructive">{error}</p>}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isDownloading}>
            {t('common:actions.cancel')}
          </Button>
          <Button size="sm" onClick={handleDownload} disabled={!canDownload} className="gap-1.5">
            {isDownloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {isDownloading ? t('diagnostics.downloading') : t('diagnostics.download')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DiagnosticsExportModal;
