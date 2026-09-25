import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import {
  FileCode,
  Search,
  Filter,
  ArrowUpDown,
  Trash2,
  MoreHorizontal,
  ExternalLink,
  Cpu,
  HardDrive,
  X,
  FolderOpen,
} from 'lucide-react';
import { useTemplates } from '../../hooks/useTemplates';
import TemplateCreateModal from '../../components/templates/TemplateCreateModal';
import TemplateEditModal from '../../components/templates/TemplateEditModal';
import NestsManagerModal from '../../components/templates/NestsManagerModal';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import EmptyState from '../../components/shared/EmptyState';
import { BracketLabel, Segmented } from '../../components/deck/primitives';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { useAuthStore } from '../../stores/authStore';
import { templatesApi } from '../../services/api/templates';
import { nestsApi } from '../../services/api/nests';
import { notifyError, notifySuccess } from '../../utils/notify';
import { cn } from '@/lib/utils';
import type { Template, Nest } from '../../types/template';

/**
 * One grid template shared by the select-all strip and every row.
 *   base : checkbox · identity · actions
 *   lg   : checkbox · identity · cpu · memory · actions
 */
const TEMPLATE_GRID =
  'grid grid-cols-[1.5rem_minmax(0,1fr)_4.5rem] items-center gap-x-3 gap-y-1 ' +
  'lg:grid-cols-[1.5rem_minmax(0,1fr)_5rem_5.5rem_5.5rem]';

// ── Template Row ──
function TemplateRow({
  template,
  isSelected,
  canWrite,
  hideHeader,
  setSelectedIds,
  setEditingTemplateId,
  handleBulkDelete,
  deleteMutation,
}: {
  template: Template;
  isSelected: boolean;
  canWrite: boolean;
  hideHeader?: boolean;
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  setEditingTemplateId: (id: string) => void;
  handleBulkDelete: (ids: string[], label: string) => void;
  deleteMutation: { isPending: boolean };
}) {
  const { t } = useTranslation('templates');
  const iconUrl = template.features?.iconUrl;
  const description = template.description?.trim() || t('card.noDescription');
  const memory =
    template.allocatedMemoryMb >= 1024
      ? `${(template.allocatedMemoryMb / 1024).toFixed(1)} GB`
      : `${template.allocatedMemoryMb} MB`;

  return (
    <div
      role="row"
      className={cn(
        TEMPLATE_GRID,
        'py-1.5 pl-3 pr-3 transition-colors',
        isSelected ? 'bg-primary/10' : 'hover:bg-surface-1/40',
      )}
    >
      {/* checkbox column — the spacer keeps the grid aligned when hidden */}
      {canWrite && !hideHeader ? (
        <label className="-m-2 flex cursor-pointer items-center justify-center p-2">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() =>
              setSelectedIds((prev) =>
                prev.includes(template.id)
                  ? prev.filter((id) => id !== template.id)
                  : [...prev, template.id],
              )
            }
            className="h-3.5 w-3.5 rounded-sm border-border/60 bg-background/40 text-primary"
          />
        </label>
      ) : (
        <span aria-hidden />
      )}

      {/* identity — primary column */}
      <div className="flex min-w-0 items-center gap-2">
        {iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            className="h-5 w-5 shrink-0 rounded-sm border border-border/50 object-cover"
          />
        ) : (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-border/50 font-display text-micro font-semibold text-muted-foreground">
            {template.name.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="flex min-w-0 items-baseline gap-2">
            <Link
              to={`/admin/templates/${template.id}`}
              title={template.name}
              className="-my-1.5 truncate py-1.5 font-display text-data font-semibold tracking-tight text-foreground hover:text-primary"
            >
              {template.name}
            </Link>
            <Segmented muted className="hidden shrink-0 sm:inline">v{template.version}</Segmented>
          </span>
          <span className="flex min-w-0 items-center gap-2 text-micro text-muted-foreground">
            <span className="truncate" title={template.author}>{template.author}</span>
            <span aria-hidden>·</span>
            <span className="truncate font-mono tabular-nums opacity-70" title={template.defaultImage || template.image}>
              {template.defaultImage || template.image}
            </span>
            <span className="hidden truncate md:inline" title={description}>{description}</span>
            <span className="hidden shrink-0 lg:inline">
              {t('page.variablesCount', { count: template.variables?.length ?? 0 })}
            </span>
          </span>
        </div>
      </div>

      {/* cpu */}
      <span className="hidden flex-col items-end leading-tight lg:flex">
        <Segmented className="flex items-center gap-1">
          <Cpu className="h-3 w-3 text-muted-foreground/60" />
          {template.allocatedCpuCores}
        </Segmented>
        <span className="type-overline">{t('page.cores')}</span>
      </span>

      {/* memory */}
      <span className="hidden flex-col items-end leading-tight lg:flex">
        <Segmented className="flex items-center gap-1">
          <HardDrive className="h-3 w-3 text-muted-foreground/60" />
          {memory}
        </Segmented>
        <span className="type-overline">{t('page.memory')}</span>
      </span>

      {/* actions */}
      <span className="flex shrink-0 items-center justify-end gap-1">
        <Link
          to={`/admin/templates/${template.id}`}
          title={t('actions.view')}
          aria-label={t('actions.view')}
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>

        {canWrite && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                title={t('common:actions.more')}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/admin/templates/${template.id}`} className="gap-2 text-mini">
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t('actions.view')}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setEditingTemplateId(template.id)}
                className="gap-2 text-mini"
              >
                <FileCode className="h-3.5 w-3.5" />
                {t('common:actions.edit')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleBulkDelete([template.id], template.name)}
                disabled={deleteMutation.isPending}
                className="gap-2 text-mini text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('common:actions.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </span>
    </div>
  );
}

// ── Nest Section Header ──
function NestSectionHeader({
  nest,
  count,
  trailing,
}: {
  nest: Nest | null;
  count: number;
  trailing?: React.ReactNode;
}) {
  const { t } = useTranslation('templates');
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
      <BracketLabel tone="muted">{nest ? nest.name : t('page.ungrouped')}</BracketLabel>
      <Segmented muted className="text-micro">
        {t('page.templateCount', { count })}
      </Segmented>
      {nest?.description && (
        <span className="type-meta hidden truncate sm:inline">
          {nest.description}
        </span>
      )}
      {trailing}
    </div>
  );
}

/** Nest filter tab — the deck's active marker is the magenta underline. */
function NestTab({
  active,
  onClick,
  label,
  count,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: React.ReactNode;
  count: number;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex h-7 shrink-0 items-center gap-1.5 px-2.5 text-mini transition-colors',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {active && <span className="absolute inset-x-1 bottom-0 h-[2px] bg-primary" aria-hidden />}
      {icon}
      <span>{label}</span>
      <Segmented muted className="text-micro">{count}</Segmented>
    </button>
  );
}

function LegendCount({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <Segmented muted className="text-micro">{value}</Segmented>
      <span className="type-overline">{label}</span>
    </span>
  );
}

// ── Main Component ──
type Props = {
  hideHeader?: boolean;
};

function TemplatesPage({ hideHeader }: Props) {
  const { t } = useTranslation('templates');
  const { data: templates = [], isLoading } = useTemplates();
  const { data: nests = [] } = useQuery({
    queryKey: qk.nests(),
    queryFn: nestsApi.list,
    staleTime: 5 * 60 * 1000,
  });

  const [search, setSearch] = useState('');
  const [authorFilter, setAuthorFilter] = useState('');
  const [sort, setSort] = useState('name-asc');
  const [selectedNestId, setSelectedNestId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<{
    templateIds: string[];
    label: string;
  } | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [nestsModalOpen, setNestsModalOpen] = useState(false);

  useEffect(() => {
    const handler = () => setNestsModalOpen(true);
    window.addEventListener('catalyst:open-nests-modal', handler);
    return () => window.removeEventListener('catalyst:open-nests-modal', handler);
  }, []);

  const user = useAuthStore((s) => s.user);

  const canWrite = useMemo(
    () => Boolean(user?.permissions?.includes('admin.write') || user?.permissions?.includes('*')),
    [user?.permissions],
  );

  // ── Derived data ──
  const authors = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of templates) {
      map.set(t.author, (map.get(t.author) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [templates]);

  const hasActiveFilters = authorFilter || selectedNestId !== null;

  const clearFilters = () => {
    setAuthorFilter('');
    setSelectedNestId(null);
  };

  const nestMap = useMemo(() => {
    const map = new Map<string, Nest>();
    for (const n of nests) {
      map.set(n.id, n);
    }
    return map;
  }, [nests]);

  const filteredTemplates = useMemo(() => {
    let filtered = templates;
    if (search.trim()) {
      const query = search.trim().toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.author.toLowerCase().includes(query) ||
          t.description?.toLowerCase().includes(query),
      );
    }
    if (authorFilter) {
      filtered = filtered.filter((t) => t.author === authorFilter);
    }
    if (selectedNestId === '__ungrouped__') {
      filtered = filtered.filter((t) => !t.nestId);
    } else if (selectedNestId !== null) {
      filtered = filtered.filter((t) => t.nestId === selectedNestId);
    }
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'author':
          return a.author.localeCompare(b.author);
        case 'version':
          return b.version.localeCompare(a.version);
        case 'memory':
          return (b.allocatedMemoryMb ?? 0) - (a.allocatedMemoryMb ?? 0);
        case 'cpu':
          return (b.allocatedCpuCores ?? 0) - (a.allocatedCpuCores ?? 0);
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return sorted;
  }, [templates, search, authorFilter, sort, selectedNestId]);

  const groupedByNest = useMemo(() => {
    const groups = new Map<string | null, Template[]>();
    for (const t of filteredTemplates) {
      const key = t.nestId || null;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    const entries = Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === null) return 1;
      if (b[0] === null) return -1;
      const nestA = nestMap.get(a[0]!);
      const nestB = nestMap.get(b[0]!);
      return (nestA?.name || '').localeCompare(nestB?.name || '');
    });
    return entries;
  }, [filteredTemplates, nestMap]);

  const filteredIds = useMemo(() => filteredTemplates.map((t) => t.id), [filteredTemplates]);
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));

  const currentIds = useMemo(() => new Set(templates.map((t) => t.id)), [templates]);
  const validSelectedIds = useMemo(
    () => selectedIds.filter((id) => currentIds.has(id)),
    [selectedIds, currentIds],
  );

  if (validSelectedIds.length !== selectedIds.length) {
    setSelectedIds(validSelectedIds);
  }

  const nestCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let ungroupedCount = 0;
    for (const t of templates) {
      if (t.nestId) {
        counts.set(t.nestId, (counts.get(t.nestId) || 0) + 1);
      } else {
        ungroupedCount++;
      }
    }
    return { counts, ungroupedCount };
  }, [templates]);

  // ── Delete mutation ──
  const deleteMutation = useMutation({
    mutationFn: (templateIds: string[]) => {
      return Promise.all(templateIds.map((id) => templatesApi.remove(id)));
    },
    onSuccess: (_data, templateIds) => {
      notifySuccess(t('page.deleted', { count: templateIds.length }));
      setSelectedIds([]);
      setDeleteTargets(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.templates() });
    },
    onError: (error: unknown) => {
      notifyError(error, 'templates:page.deleteError');
    },
  });

  const handleBulkDelete = (templateIds: string[], label: string) => {
    if (!templateIds.length) return;
    setDeleteTargets({ templateIds, label });
  };

  const showGroupedView = selectedNestId === null && nests.length > 0;

  const emptyState = (
    <div className="py-2">
      <EmptyState
        title={
          search.trim() || hasActiveFilters ? t('page.noTemplatesFound') : t('list.emptyTitle')
        }
        description={
          search.trim() || hasActiveFilters ? t('page.adjustSearch') : t('list.emptyDescription')
        }
        action={
          hasActiveFilters ? (
            <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-mini" onClick={clearFilters}>
              <X className="h-3 w-3" />
              {t('page.clearFilters')}
            </Button>
          ) : canWrite && !search.trim() ? (
            <TemplateCreateModal />
          ) : undefined
        }
      />
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {!hideHeader && (
        <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1">
            <BracketLabel>{t('page.overview')}</BracketLabel>
            <h1 className="font-display text-lg font-semibold leading-none tracking-tight text-foreground">
              {t('page.title')}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canWrite && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-3 text-mini"
                onClick={() => setNestsModalOpen(true)}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t('page.nests')}
              </Button>
            )}
            {canWrite ? (
              <TemplateCreateModal />
            ) : (
              <span className="type-meta">{t('page.adminRequired')}</span>
            )}
          </div>
        </header>
      )}

      {/* ── The deck: controls, tabs, rows and legend in one frame ── */}
      <div className="deck-panel flex min-h-0 flex-col overflow-hidden">
        {/* Control strip */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
          <label className="relative flex min-w-[12rem] flex-1 items-center">
            <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('page.searchPlaceholder')}
              className="h-7 w-full rounded-sm border border-border/60 bg-background/40 pl-7 pr-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
            />
          </label>

          <Button
            variant={hasActiveFilters ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="h-7 gap-1.5 px-2.5 text-mini"
          >
            <Filter className="h-3 w-3" />
            {t('page.filters')}
            {hasActiveFilters && (
              <span className="font-mono text-micro tabular-nums">
                {[authorFilter, selectedNestId].filter(Boolean).length}
              </span>
            )}
          </Button>

          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-7 w-40 gap-1.5 rounded-sm border-border/60 bg-background/40 px-2 text-mini">
              <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">{t('page.sortNameAsc')}</SelectItem>
              <SelectItem value="name-desc">{t('page.sortNameDesc')}</SelectItem>
              <SelectItem value="author">{t('page.sortAuthor')}</SelectItem>
              <SelectItem value="version">{t('page.sortVersion')}</SelectItem>
              <SelectItem value="memory">{t('page.sortMemory')}</SelectItem>
              <SelectItem value="cpu">{t('page.sortCpu')}</SelectItem>
            </SelectContent>
          </Select>

          <span className="font-mono text-micro tabular-nums text-muted-foreground">
            {t('page.count', { filtered: filteredTemplates.length, total: templates.length })}
          </span>
        </div>

        {/* Expandable filter panel */}
        {showFilters && (
          <div className="flex flex-wrap items-end gap-4 border-b border-border/50 bg-surface-1/40 px-3 py-2">
            <label className="space-y-1">
              <span className="type-overline">{t('page.authorLabel')}</span>
              <Select
                value={authorFilter || 'all'}
                onValueChange={(value) => {
                  setAuthorFilter(value === 'all' ? '' : value);
                }}
              >
                <SelectTrigger className="h-7 w-44 rounded-sm border-border/60 bg-background/40 px-2 text-mini">
                  <SelectValue placeholder={t('page.allAuthors')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('page.allAuthors')}</SelectItem>
                  {authors.map((author) => (
                    <SelectItem key={author.name} value={author.name}>
                      {author.name} ({author.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {nests.length > 0 && (
              <label className="space-y-1">
                <span className="type-overline">{t('page.nestLabel')}</span>
                <Select
                  value={selectedNestId || 'all'}
                  onValueChange={(value) => {
                    setSelectedNestId(value === 'all' ? null : value);
                  }}
                >
                  <SelectTrigger className="h-7 w-44 rounded-sm border-border/60 bg-background/40 px-2 text-mini">
                    <SelectValue placeholder={t('page.allNests')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('page.allNests')}</SelectItem>
                    {nests.map((nest) => (
                      <SelectItem key={nest.id} value={nest.id}>
                        <span className="flex items-center gap-2">
                          {nest.icon ? (
                            <img
                              src={nest.icon}
                              alt=""
                              className="h-3.5 w-3.5 rounded-sm object-cover"
                            />
                          ) : (
                            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-surface-2 font-display text-micro font-semibold text-muted-foreground">
                              {nest.name.slice(0, 2)}
                            </span>
                          )}
                          {nest.name}
                        </span>
                      </SelectItem>
                    ))}
                    {nestCounts.ungroupedCount > 0 && (
                      <SelectItem value="__ungrouped__">{t('page.ungrouped')}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </label>
            )}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-7 gap-1.5 px-2.5 text-mini"
              >
                <X className="h-3 w-3" />
                {t('page.clearAll')}
              </Button>
            )}
          </div>
        )}

        {/* Nest selector tabs */}
        {nests.length > 0 && (
          <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border/50 px-1 scrollbar-thin [mask-image:linear-gradient(to_right,black_calc(100%_-_2rem),transparent)] [-webkit-mask-image:linear-gradient(to_right,black_calc(100%_-_2rem),transparent)]">
            <NestTab
              active={selectedNestId === null}
              onClick={() => setSelectedNestId(null)}
              label={t('page.all')}
              count={templates.length}
            />
            {nests.map((nest) => {
              const count = nestCounts.counts.get(nest.id) || 0;
              if (count === 0) return null;
              return (
                <NestTab
                  key={nest.id}
                  active={selectedNestId === nest.id}
                  onClick={() => setSelectedNestId(nest.id)}
                  label={nest.name}
                  count={count}
                  icon={
                    nest.icon ? (
                      <img src={nest.icon} className="h-3.5 w-3.5 rounded-sm" alt="" />
                    ) : undefined
                  }
                />
              );
            })}
            {nestCounts.ungroupedCount > 0 && (
              <NestTab
                active={selectedNestId === '__ungrouped__'}
                onClick={() => setSelectedNestId('__ungrouped__')}
                label={t('page.ungrouped')}
                count={nestCounts.ungroupedCount}
                icon={<FolderOpen className="h-3 w-3" />}
              />
            )}
          </div>
        )}

        {/* Bulk actions strip */}
        {selectedIds.length > 0 && canWrite && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-primary/5 px-3 py-1.5">
            <div className="flex items-center gap-3">
              <span className="text-mini font-medium text-foreground">
                {t('page.selected', { total: selectedIds.length })}
              </span>
              <button
                onClick={() => setSelectedIds([])}
                className="flex h-7 items-center rounded-sm px-2.5 text-mini text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                {t('page.clear')}
              </button>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() =>
                handleBulkDelete(selectedIds, t('page.bulkLabel', { count: selectedIds.length }))
              }
              disabled={deleteMutation.isPending}
              className="h-7 gap-1.5 px-2.5 text-mini"
            >
              <Trash2 className="h-3 w-3" />
              {t('common:actions.delete')}
            </Button>
          </div>
        )}

        {/* Rows */}
        <div className="max-h-[calc(100dvh-24rem)] min-w-0 overflow-y-auto bg-background/25">
          {/* One column header shared by the grouped and flat views */}
          {!isLoading && canWrite && !hideHeader && (
            <div
              className={cn(
                TEMPLATE_GRID,
                'sticky top-0 z-10 border-b border-border/50 bg-surface-1 py-1.5 pl-3 pr-3 text-muted-foreground/70',
              )}
            >
              <label className="-m-2 flex cursor-pointer items-center justify-center p-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() =>
                    setSelectedIds((prev) => {
                      if (allSelected) {
                        return prev.filter((id) => !filteredIds.includes(id));
                      }
                      return Array.from(new Set([...prev, ...filteredIds]));
                    })
                  }
                  aria-label={t('page.selectAll')}
                  className="h-3.5 w-3.5 rounded-sm border-border/60 bg-background/40 text-primary"
                />
              </label>
              <span className="type-overline">{t('page.selectAll')}</span>
              <span className="type-overline hidden justify-end lg:inline-flex">{t('page.sortCpu')}</span>
              <span className="type-overline hidden justify-end lg:inline-flex">{t('page.sortMemory')}</span>
              <span className="type-overline justify-self-end">{t('actions.view')}</span>
            </div>
          )}
          {isLoading ? (
            <div className="p-3">
              <TabLoadingState rows={6} />
            </div>
          ) : showGroupedView ? (
            groupedByNest.length > 0 ? (
              groupedByNest.map(([nestId, groupTemplates]) => {
                const nest = nestId ? (nestMap.get(nestId) ?? null) : null;
                const groupSelected =
                  groupTemplates.length > 0 &&
                  groupTemplates.every((t) => selectedIds.includes(t.id));
                return (
                  <div key={nestId ?? '__ungrouped__'} className="border-b border-border/50 last:border-b-0">
                    <NestSectionHeader
                      nest={nest}
                      count={groupTemplates.length}
                      trailing={
                        canWrite && !hideHeader ? (
                          <label className="ml-auto -my-2 flex cursor-pointer items-center gap-2 py-2 text-micro text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={groupSelected}
                              onChange={() =>
                                setSelectedIds((prev) => {
                                  const groupIds = groupTemplates.map((t) => t.id);
                                  if (groupIds.every((id) => prev.includes(id))) {
                                    return prev.filter((id) => !groupIds.includes(id));
                                  }
                                  return Array.from(new Set([...prev, ...groupIds]));
                                })
                              }
                              className="h-3.5 w-3.5 rounded-sm border-border/60 bg-background/40 text-primary"
                            />
                            <span className="type-overline">
                              {t('page.selectAllInSection')}
                            </span>
                          </label>
                        ) : undefined
                      }
                    />
                    <div className="divide-y divide-border/40">
                      {groupTemplates.map((template) => (
                        <TemplateRow
                          key={template.id}
                          template={template}
                          isSelected={selectedIds.includes(template.id)}
                          canWrite={canWrite}
                          hideHeader={hideHeader}
                          setSelectedIds={setSelectedIds}
                          setEditingTemplateId={setEditingTemplateId}
                          handleBulkDelete={handleBulkDelete}
                          deleteMutation={deleteMutation}
                        />
                      ))}
                    </div>
                  </div>
                );
              })
            ) : (
              emptyState
            )
          ) : filteredTemplates.length > 0 ? (
            <div className="divide-y divide-border/40">
              {filteredTemplates.map((template) => (
                <TemplateRow
                  key={template.id}
                  template={template}
                  isSelected={selectedIds.includes(template.id)}
                  canWrite={canWrite}
                  hideHeader={hideHeader}
                  setSelectedIds={setSelectedIds}
                  setEditingTemplateId={setEditingTemplateId}
                  handleBulkDelete={handleBulkDelete}
                  deleteMutation={deleteMutation}
                />
              ))}
            </div>
          ) : (
            emptyState
          )}
        </div>

        {/* Footer strip — fleet legend */}
        {!hideHeader && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border/50 bg-surface-1/40 px-3 py-1.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <LegendCount label={t('page.templates')} value={templates.length} />
              <LegendCount label={t('page.authors')} value={authors.length} />
              <LegendCount label={t('page.nestsStat')} value={nests.length} />
            </div>
            <span className="font-mono text-micro text-muted-foreground/60">
              {t('page.count', { filtered: filteredTemplates.length, total: templates.length })}
            </span>
          </div>
        )}
      </div>

      {/* ── Nests Manager Modal ── */}
      <NestsManagerModal open={nestsModalOpen} onOpenChange={setNestsModalOpen} />

      {/* ── Edit Template Modal ── */}
      {editingTemplateId &&
        (() => {
          const template = templates.find((t) => t.id === editingTemplateId);
          if (!template) return null;
          return (
            <TemplateEditModal
              template={template}
              open
              onOpenChange={(open) => {
                if (!open) setEditingTemplateId(null);
              }}
            />
          );
        })()}

      {/* ── Delete Confirmation Dialog ── */}
      <ConfirmDialog
        open={!!deleteTargets}
        title={t('page.deleteTitle')}
        message={
          <div className="space-y-3">
            <p>{t('page.deleteConfirm', { label: deleteTargets?.label })}</p>
            <p className="type-meta">
              {t('page.deleteWarning')}
            </p>
          </div>
        }
        confirmText={t('common:actions.delete')}
        cancelText={t('common:actions.cancel')}
        onConfirm={() => deleteTargets && deleteMutation.mutate(deleteTargets.templateIds)}
        onCancel={() => setDeleteTargets(null)}
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

export default TemplatesPage;
