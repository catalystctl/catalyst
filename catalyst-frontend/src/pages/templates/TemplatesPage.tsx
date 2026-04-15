import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
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
} from 'lucide-react';
import { useTemplates } from '../../hooks/useTemplates';
import TemplateCreateModal from '../../components/templates/TemplateCreateModal';
import TemplateEditModal from '../../components/templates/TemplateEditModal';
import EmptyState from '../../components/shared/EmptyState';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
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
import { notifyError, notifySuccess } from '../../utils/notify';
import type { Template } from '../../types/template';

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.03, delayChildren: 0.05 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 24 },
  },
};

const rowVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring', stiffness: 400, damping: 30 },
  },
};

// ── Skeleton Loader ──
function TableSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-lg px-4 py-3.5"
        >
          <div className="h-4 w-4 animate-pulse rounded bg-surface-3" />
          <div className="h-11 w-11 animate-pulse rounded-lg bg-surface-3" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-36 animate-pulse rounded bg-surface-3" />
            <div className="h-3 w-52 animate-pulse rounded bg-surface-2" />
          </div>
          <div className="hidden h-5 w-20 animate-pulse rounded-full bg-surface-3 sm:block" />
          <div className="hidden h-5 w-16 animate-pulse rounded-full bg-surface-3 md:block" />
          <div className="flex gap-1">
            <div className="h-7 w-16 animate-pulse rounded-md bg-surface-3" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ──
type Props = {
  hideHeader?: boolean;
};

function TemplatesPage({ hideHeader }: Props) {
  const { data: templates = [], isLoading } = useTemplates();
  const [search, setSearch] = useState('');
  const [authorFilter, setAuthorFilter] = useState('');
  const [sort, setSort] = useState('name-asc');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<{ templateIds: string[]; label: string } | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const canWrite = useMemo(
    () => user?.permissions?.includes('admin.write') || user?.permissions?.includes('*'),
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

  const hasActiveFilters = authorFilter;

  const clearFilters = () => {
    setAuthorFilter('');
  };

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
          return b.allocatedMemoryMb - a.allocatedMemoryMb;
        case 'cpu':
          return b.allocatedCpuCores - a.allocatedCpuCores;
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return sorted;
  }, [templates, search, authorFilter, sort]);

  const filteredIds = useMemo(
    () => filteredTemplates.map((t) => t.id),
    [filteredTemplates],
  );
  const allSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));

  const currentIds = useMemo(() => new Set(templates.map((t) => t.id)), [templates]);
  const validSelectedIds = useMemo(
    () => selectedIds.filter((id) => currentIds.has(id)),
    [selectedIds, currentIds],
  );

  if (validSelectedIds.length !== selectedIds.length) {
    setSelectedIds(validSelectedIds);
  }

  // ── Delete mutation ──
  const deleteMutation = useMutation({
    mutationFn: (templateIds: string[]) => {
      return Promise.all(
        templateIds.map((id) => templatesApi.remove(id)),
      );
    },
    onSuccess: (_data, templateIds) => {
      notifySuccess(
        `${templateIds.length} template${templateIds.length === 1 ? '' : 's'} deleted`,
      );
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setSelectedIds([]);
      setDeleteTargets(null);
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error || 'Failed to delete template(s)';
      notifyError(message);
    },
  });

  const handleBulkDelete = (templateIds: string[], label: string) => {
    if (!templateIds.length) return;
    setDeleteTargets({ templateIds, label });
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-amber-500/8 to-rose-500/8 blur-3xl dark:from-amber-500/15 dark:to-rose-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-violet-500/8 to-cyan-500/8 blur-3xl dark:from-violet-500/15 dark:to-cyan-500/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {!hideHeader && (
          <>
            {/* ── Header ── */}
            <motion.div
              variants={itemVariants}
              className="flex flex-wrap items-end justify-between gap-4"
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-amber-500 to-rose-500 opacity-20 blur-sm" />
                    <FileCode className="relative h-7 w-7 text-amber-600 dark:text-amber-400" />
                  </div>
                  <h1 className="font-display text-3xl font-bold tracking-tight text-foreground dark:text-white">
                    Templates
                  </h1>
                </div>
                <p className="ml-10 text-sm text-muted-foreground">
                  Define server templates with images and start commands.
                </p>
              </div>

              {/* Summary stats */}
              <div className="flex flex-wrap items-center gap-2">
                {isLoading ? (
                  <>
                    <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
                    <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
                  </>
                ) : (
                  <>
                    <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
                      <span className="h-2 w-2 rounded-full bg-zinc-400" />
                      {templates.length} templates
                    </Badge>
                    {authors.length > 0 && (
                      <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
                        <FileCode className="h-2.5 w-2.5" />
                        {authors.length} author{authors.length !== 1 ? 's' : ''}
                      </Badge>
                    )}
                  </>
                )}
                {canWrite ? (
                  <TemplateCreateModal />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Admin access required
                  </span>
                )}
              </div>
            </motion.div>

            {/* ── Search & Controls Bar ── */}
            <motion.div
              variants={itemVariants}
              className="flex flex-wrap items-center gap-2.5"
            >
              {/* Search input */}
              <div className="relative min-w-[200px] flex-1 max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search templates by name, author, or description…"
                  className="pl-9"
                />
              </div>

              {/* Filter toggle */}
              <Button
                variant={hasActiveFilters ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className="gap-2"
              >
                <Filter className="h-3.5 w-3.5" />
                Filters
                {hasActiveFilters && (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">
                    {[authorFilter].filter(Boolean).length}
                  </span>
                )}
              </Button>

              {/* Sort */}
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="w-40 gap-2 text-xs">
                  <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name-asc">Name A→Z</SelectItem>
                  <SelectItem value="name-desc">Name Z→A</SelectItem>
                  <SelectItem value="author">Author</SelectItem>
                  <SelectItem value="version">Version</SelectItem>
                  <SelectItem value="memory">Memory</SelectItem>
                  <SelectItem value="cpu">CPU cores</SelectItem>
                </SelectContent>
              </Select>

              {/* Results count */}
              <span className="text-xs text-muted-foreground">
                {filteredTemplates.length} of {templates.length}
              </span>
            </motion.div>

            {/* ── Expandable Filter Panel ── */}
            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className="rounded-xl border border-border bg-card/80 p-4 backdrop-blur-sm">
                    <div className="flex flex-wrap items-end gap-4">
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">
                          Author
                        </span>
                        <Select
                          value={authorFilter || 'all'}
                          onValueChange={(value) => {
                            setAuthorFilter(value === 'all' ? '' : value);
                          }}
                        >
                          <SelectTrigger className="w-44">
                            <SelectValue placeholder="All authors" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All authors</SelectItem>
                            {authors.map((author) => (
                              <SelectItem key={author.name} value={author.name}>
                                {author.name} ({author.count})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                      {hasActiveFilters && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={clearFilters}
                          className="gap-1.5 text-xs"
                        >
                          <X className="h-3 w-3" />
                          Clear all
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Bulk Actions Bar ── */}
            <AnimatePresence>
              {selectedIds.length > 0 && canWrite && (
                <motion.div
                  initial={{ height: 0, opacity: 0, y: -8 }}
                  animate={{ height: 'auto', opacity: 1, y: 0 }}
                  exit={{ height: 0, opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 dark:bg-primary/10">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-foreground">
                        {selectedIds.length} selected
                      </span>
                      <button
                        onClick={() => setSelectedIds([])}
                        className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() =>
                          handleBulkDelete(
                            selectedIds,
                            `${selectedIds.length} templates`,
                          )
                        }
                        disabled={deleteMutation.isPending}
                        className="gap-1.5 text-xs"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        {/* ── Template List ── */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border border-border bg-card/80 shadow-sm backdrop-blur-sm">
            {isLoading ? (
              <div className="p-4">
                <TableSkeleton />
              </div>
            ) : filteredTemplates.length > 0 ? (
              <>
                {/* Select-all header */}
                {canWrite && !hideHeader && (
                  <div className="flex items-center gap-3 border-b border-border px-4 py-2">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() =>
                          setSelectedIds((prev) => {
                            if (allSelected) {
                              return prev.filter(
                                (id) => !filteredIds.includes(id),
                              );
                            }
                            return Array.from(new Set([...prev, ...filteredIds]));
                          })
                        }
                        className="h-4 w-4 rounded border-border bg-white text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400"
                      />
                      <span className="text-xs font-medium text-muted-foreground">
                        Select all
                      </span>
                    </label>
                  </div>
                )}

                {/* Template rows */}
                <div className="divide-y divide-border/50">
                  {filteredTemplates.map((template: Template) => {
                    const isSelected = selectedIds.includes(template.id);
                    const iconUrl = template.features?.iconUrl;
                    const description =
                      template.description?.trim() ||
                      'No description provided.';

                    return (
                      <motion.div
                        key={template.id}
                        variants={rowVariants}
                        className={`group relative flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2/50 ${
                          isSelected ? 'bg-primary/5' : ''
                        }`}
                      >
                        {/* Checkbox */}
                        {canWrite && !hideHeader && (
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
                            className="h-4 w-4 flex-shrink-0 rounded border-border bg-white text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400"
                          />
                        )}

                        {/* Icon */}
                        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-2">
                          {iconUrl ? (
                            <img
                              src={iconUrl}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs font-bold uppercase text-muted-foreground">
                              {template.name.slice(0, 2)}
                            </div>
                          )}
                        </div>

                        {/* Template info — primary column */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2.5">
                            <Link
                              to={`/admin/templates/${template.id}`}
                              className="truncate font-semibold text-foreground transition-colors hover:text-primary dark:text-zinc-100 dark:hover:text-primary-400"
                            >
                              {template.name}
                            </Link>
                            <Badge
                              variant="secondary"
                              className="hidden shrink-0 text-[11px] sm:inline-flex"
                            >
                              {template.author}
                            </Badge>
                            <Badge
                              variant="outline"
                              className="shrink-0 text-[11px]"
                            >
                              v{template.version}
                            </Badge>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            <span className="line-clamp-1 max-w-md hidden sm:inline">
                              {description}
                            </span>
                            <span className="font-mono text-[11px] opacity-60">
                              {template.defaultImage || template.image}
                            </span>
                            <span className="hidden md:inline">
                              {template.variables.length} variable
                              {template.variables.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>

                        {/* Resource stats — visible on larger screens */}
                        <div className="hidden items-center gap-4 lg:flex">
                          <div className="text-right">
                            <div className="flex items-center gap-1 text-xs font-medium text-foreground dark:text-zinc-100">
                              <Cpu className="h-3 w-3 text-muted-foreground" />
                              {template.allocatedCpuCores}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              cores
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="flex items-center gap-1 text-xs font-medium text-foreground dark:text-zinc-100">
                              <HardDrive className="h-3 w-3 text-muted-foreground" />
                              {template.allocatedMemoryMb >= 1024
                                ? `${(template.allocatedMemoryMb / 1024).toFixed(1)} GB`
                                : `${template.allocatedMemoryMb} MB`}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              memory
                            </div>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                          <Link
                            to={`/admin/templates/${template.id}`}
                            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary dark:hover:text-primary-400"
                          >
                            <ExternalLink className="h-3 w-3" />
                            <span className="hidden sm:inline">View</span>
                          </Link>

                          {canWrite && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                                  title="More"
                                >
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link
                                    to={`/admin/templates/${template.id}`}
                                    className="gap-2 text-xs"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    View
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    setEditingTemplateId(template.id)
                                  }
                                  className="gap-2 text-xs"
                                >
                                  <FileCode className="h-3.5 w-3.5" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() =>
                                    handleBulkDelete(
                                      [template.id],
                                      template.name,
                                    )
                                  }
                                  disabled={deleteMutation.isPending}
                                  className="gap-2 text-xs text-rose-600 dark:text-rose-400"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="p-6">
                <EmptyState
                  title={
                    search.trim() || hasActiveFilters
                      ? 'No templates found'
                      : 'No templates'
                  }
                  description={
                    search.trim() || hasActiveFilters
                      ? 'Try adjusting your search or filters.'
                      : 'Create a template to bootstrap new game servers quickly.'
                  }
                  action={
                    hasActiveFilters ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={clearFilters}
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" />
                        Clear filters
                      </Button>
                    ) : canWrite && !search.trim() ? (
                      <TemplateCreateModal />
                    ) : undefined
                  }
                />
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* ── Edit Template Modal ── */}
      {editingTemplateId && (() => {
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
        title="Delete Templates"
        message={
          <div className="space-y-2">
            <p>
              You are about to delete{' '}
              <span className="font-semibold">{deleteTargets?.label}</span>.
            </p>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              Templates in use by existing servers cannot be deleted. This
              action cannot be undone.
            </p>
          </div>
        }
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={() =>
          deleteTargets && deleteMutation.mutate(deleteTargets.templateIds)
        }
        onCancel={() => setDeleteTargets(null)}
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </motion.div>
  );
}

export default TemplatesPage;
