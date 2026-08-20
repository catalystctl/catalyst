import { useEffect, useMemo, useState } from 'react';
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
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import SectionHeader from '../../components/servers/tabs/SectionHeader';
import StatGrid from '../../components/servers/tabs/StatGrid';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
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
import { nestsApi } from '../../services/api/nests';
import { notifyError, notifySuccess } from '../../utils/notify';
import type { Template, Nest } from '../../types/template';

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
 const iconUrl = template.features?.iconUrl;
 const description = template.description?.trim() || 'No description provided.';

 return (
 <div
 className={`group relative flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2/50 ${
 isSelected ? 'bg-primary/5 border-l-2 border-primary' : 'border-l-2 border-transparent'
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
 className="h-4 w-4 flex-shrink-0 rounded border-border bg-card text-primary-600"
 />
 )}

 {/* Icon */}
 <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border/30 bg-surface-2">
 {iconUrl ? (
 <img src={iconUrl} alt="" className="h-full w-full object-cover" />
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
 className="truncate font-semibold text-foreground transition-colors hover:text-primary"
 >
 {template.name}
 </Link>
 <Badge variant="secondary" className="hidden shrink-0 text-[11px] sm:inline-flex">
 {template.author}
 </Badge>
 <Badge variant="outline" className="shrink-0 text-[11px]">
 v{template.version}
 </Badge>
 </div>
 <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
 <span className="line-clamp-1 max-w-md hidden sm:inline">{description}</span>
 <span className="font-mono text-[11px] opacity-60">
 {template.defaultImage || template.image}
 </span>
  <span className="hidden md:inline">
  {(template.variables?.length ?? 0)} variable
  {(template.variables?.length ?? 0) !== 1 ? 's' : ''}
  </span>
 </div>
 </div>

 {/* Resource stats — visible on larger screens */}
 <div className="hidden items-center gap-4 lg:flex">
 <div className="text-right">
 <div className="flex items-center gap-1 text-xs font-medium text-foreground">
 <Cpu className="h-3 w-3 text-muted-foreground" />
 {template.allocatedCpuCores}
 </div>
 <div className="text-[11px] text-muted-foreground">cores</div>
 </div>
 <div className="text-right">
 <div className="flex items-center gap-1 text-xs font-medium text-foreground">
 <HardDrive className="h-3 w-3 text-muted-foreground" />
 {template.allocatedMemoryMb >= 1024
 ? `${(template.allocatedMemoryMb / 1024).toFixed(1)} GB`
 : `${template.allocatedMemoryMb} MB`}
 </div>
 <div className="text-[11px] text-muted-foreground">memory</div>
 </div>
 </div>

 {/* Action buttons */}
 <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
 <Link
 to={`/admin/templates/${template.id}`}
 className="flex items-center gap-1 rounded-md border border-border/30 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
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
 <Link to={`/admin/templates/${template.id}`} className="gap-2 text-xs">
 <ExternalLink className="h-3.5 w-3.5" />
 View
 </Link>
 </DropdownMenuItem>
 <DropdownMenuItem
 onClick={() => setEditingTemplateId(template.id)}
 className="gap-2 text-xs"
 >
 <FileCode className="h-3.5 w-3.5" />
 Edit
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem
 onClick={() => handleBulkDelete([template.id], template.name)}
 disabled={deleteMutation.isPending}
 className="gap-2 text-xs text-destructive"
 >
 <Trash2 className="h-3.5 w-3.5" />
 Delete
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 )}
 </div>
 </div>
 );
}

// ── Nest Section Header ──
function NestSectionHeader({ nest, count }: { nest: Nest | null; count: number }) {
 if (nest) {
 return (
 <div className="sticky top-0 z-10 border-b border-border/30 bg-card px-4 py-2">
 <div className="flex items-center gap-2">
 {nest.icon && <img src={nest.icon} className="h-4 w-4 rounded" alt="" />}
 <h3 className="text-sm font-semibold text-foreground">{nest.name}</h3>
 <Badge variant="secondary" className="text-[10px]">
 {count} template{count !== 1 ? 's' : ''}
 </Badge>
 {nest.description && (
 <span className="hidden text-xs text-muted-foreground sm:inline">
 {nest.description}
 </span>
 )}
 </div>
 </div>
 );
 }

 return (
 <div className="sticky top-0 z-10 border-b border-border/30 bg-card px-4 py-2">
 <div className="flex items-center gap-2">
 <FolderOpen className="h-4 w-4 text-muted-foreground" />
 <h3 className="text-sm font-semibold text-foreground">Ungrouped</h3>
 <Badge variant="secondary" className="text-[10px]">
 {count} template{count !== 1 ? 's' : ''}
 </Badge>
 </div>
 </div>
 );
}

// ── Main Component ──
type Props = {
 hideHeader?: boolean;
};

function TemplatesPage({ hideHeader }: Props) {
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
 notifySuccess(`${templateIds.length} template${templateIds.length === 1 ? '' : 's'} deleted`);
 setSelectedIds([]);
 setDeleteTargets(null);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.templates() });
 },
 onError: (error: any) => {
 const message = error?.response?.data?.error || 'Failed to delete template(s)';
 notifyError(message);
 },
 });

 const handleBulkDelete = (templateIds: string[], label: string) => {
 if (!templateIds.length) return;
 setDeleteTargets({ templateIds, label });
 };

 const showGroupedView = selectedNestId === null && nests.length > 0;

 return (
 <div className="space-y-4">
 {!hideHeader && (
 <>
 <TabHeader
 icon={FileCode}
 title="Templates"
 description="Define server templates with images and start commands."
 actions={
 <div className="flex items-center gap-2">
 {canWrite && (
 <button
 className="rounded-lg border border-border/40 px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
 onClick={() => setNestsModalOpen(true)}
 >
 <FolderOpen className="mr-1.5 inline h-4 w-4" />
 Nests
 </button>
 )}
 {canWrite ? (
 <TemplateCreateModal />
 ) : (
 <span className="text-xs text-muted-foreground">Admin access required</span>
 )}
 </div>
 }
 />

 <ServerTabCard>
 <SectionHeader icon={FileCode} title="Overview" />
 <StatGrid
 columns={3}
 items={[
 { label: 'Templates', value: templates.length },
 { label: 'Authors', value: authors.length },
 { label: 'Nests', value: nests.length },
 ]}
 />
 </ServerTabCard>

 {/* ── Search & Controls Bar ── */}
 <div className="flex flex-wrap items-center gap-2.5">
 <div className="relative min-w-[200px] flex-1 max-w-sm">
 <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
 <Input
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 placeholder="Search templates by name, author, or description…"
 className="pl-9 border-border/40"
 />
 </div>

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
 {[authorFilter, selectedNestId].filter(Boolean).length}
 </span>
 )}
 </Button>

 <Select value={sort} onValueChange={setSort}>
 <SelectTrigger className="w-40 gap-2 text-xs border-border/40">
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

 <span className="text-xs text-muted-foreground">
 {filteredTemplates.length} of {templates.length}
 </span>
 </div>

 {/* ── Nest Selector Tabs ── */}
 {nests.length > 0 && (
 <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
 <button
 className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
 selectedNestId === null
 ? 'bg-primary text-primary-foreground '
 : 'bg-surface-2 text-muted-foreground hover:text-foreground'
 }`}
 onClick={() => setSelectedNestId(null)}
 >
 All
 <span
 className={`text-[10px] ${selectedNestId === null ? 'text-primary-foreground/70' : 'text-muted-foreground/60'}`}
 >
 {templates.length}
 </span>
 </button>
 {nests.map((nest) => {
 const count = nestCounts.counts.get(nest.id) || 0;
 if (count === 0) return null;
 return (
 <button
 key={nest.id}
 className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
 selectedNestId === nest.id
 ? 'bg-primary text-primary-foreground '
 : 'bg-surface-2 text-muted-foreground hover:text-foreground'
 }`}
 onClick={() => setSelectedNestId(nest.id)}
 >
 {nest.icon && <img src={nest.icon} className="h-3.5 w-3.5 rounded" alt="" />}
 {nest.name}
 <span
 className={`text-[10px] ${selectedNestId === nest.id ? 'text-primary-foreground/70' : 'text-muted-foreground/60'}`}
 >
 {count}
 </span>
 </button>
 );
 })}
 {nestCounts.ungroupedCount > 0 && (
 <button
 className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
 selectedNestId === '__ungrouped__'
 ? 'bg-primary text-primary-foreground '
 : 'bg-surface-2 text-muted-foreground hover:text-foreground'
 }`}
 onClick={() => setSelectedNestId('__ungrouped__')}
 >
 <FolderOpen className="h-3.5 w-3.5" />
 Ungrouped
 <span
 className={`text-[10px] ${selectedNestId === '__ungrouped__' ? 'text-primary-foreground/70' : 'text-muted-foreground/60'}`}
 >
 {nestCounts.ungroupedCount}
 </span>
 </button>
 )}
 </div>
 )}

 {/* ── Expandable Filter Panel ── */}
 {showFilters && (
 <div className="rounded-xl border border-border/30 bg-card p-4">
 <div className="flex flex-wrap items-end gap-4">
 <label className="space-y-1.5">
 <span className="text-xs font-medium text-muted-foreground">Author</span>
 <Select
 value={authorFilter || 'all'}
 onValueChange={(value) => {
 setAuthorFilter(value === 'all' ? '' : value);
 }}
 >
 <SelectTrigger className="w-44 border-border/40">
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
 {nests.length > 0 && (
 <label className="space-y-1.5">
 <span className="text-xs font-medium text-muted-foreground">Nest</span>
 <Select
 value={selectedNestId || 'all'}
 onValueChange={(value) => {
 setSelectedNestId(value === 'all' ? null : value);
 }}
 >
 <SelectTrigger className="w-44 border-border/40">
 <SelectValue placeholder="All nests" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">All nests</SelectItem>
 {nests.map((nest) => (
 <SelectItem key={nest.id} value={nest.id}>
 <span className="flex items-center gap-2">
 {nest.icon ? (
 <img
 src={nest.icon}
 alt=""
 className="h-3.5 w-3.5 rounded object-cover"
 />
 ) : (
 <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-surface-2 text-[8px] font-bold uppercase text-muted-foreground">
 {nest.name.slice(0, 2)}
 </span>
 )}
 {nest.name}
 </span>
 </SelectItem>
 ))}
 {nestCounts.ungroupedCount > 0 && (
 <SelectItem value="__ungrouped__">Ungrouped</SelectItem>
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
 className="gap-1.5 text-xs"
 >
 <X className="h-3 w-3" />
 Clear all
 </Button>
 )}
 </div>
 </div>
 )}

 {/* ── Bulk Actions Bar ── */}
 {selectedIds.length > 0 && canWrite && (
 <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
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
 handleBulkDelete(selectedIds, `${selectedIds.length} templates`)
 }
 disabled={deleteMutation.isPending}
 className="gap-1.5 text-xs"
 >
 <Trash2 className="h-3 w-3" />
 Delete
 </Button>
 </div>
 </div>
 )}
 </>
 )}

 {/* ── Template List ── */}
 {showGroupedView ? (
 <div className="space-y-4">
 {isLoading ? (
 <div className="rounded-xl border border-border/30 bg-card p-4">
 <TabLoadingState rows={6} />
 </div>
 ) : groupedByNest.length > 0 ? (
 groupedByNest.map(([nestId, groupTemplates]) => {
 const nest = nestId ? (nestMap.get(nestId) ?? null) : null;
 return (
 <div
 key={nestId ?? '__ungrouped__'}
 className="rounded-xl border border-border/30 bg-card overflow-hidden"
 >
 {canWrite && !hideHeader && (
 <div className="flex items-center gap-3 border-b border-border/30 px-4 py-2">
 <label className="flex items-center gap-2">
 <input
 type="checkbox"
 checked={
 groupTemplates.length > 0 &&
 groupTemplates.every((t) => selectedIds.includes(t.id))
 }
 onChange={() =>
 setSelectedIds((prev) => {
 const groupIds = groupTemplates.map((t) => t.id);
 if (groupIds.every((id) => prev.includes(id))) {
 return prev.filter((id) => !groupIds.includes(id));
 }
 return Array.from(new Set([...prev, ...groupIds]));
 })
 }
 className="h-4 w-4 rounded border-border bg-card text-primary-600"
 />
 <span className="text-xs font-medium text-muted-foreground">
 Select all in section
 </span>
 </label>
 </div>
 )}
 <NestSectionHeader nest={nest} count={groupTemplates.length} />
 <div className="divide-y divide-border/30">
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
 <div className="rounded-xl border border-border/30 bg-card p-6">
 <TabEmptyState
 title={search.trim() || authorFilter ? 'No templates found' : 'No templates'}
 description={
 search.trim() || authorFilter
 ? 'Try adjusting your search or filters.'
 : 'Create a template to bootstrap new game servers quickly.'
 }
 action={
 search.trim() || authorFilter ? (
 <Button variant="outline" size="sm" onClick={clearFilters}>
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
 ) : (
 <div className="rounded-xl border border-border/30 bg-card overflow-hidden">
 {isLoading ? (
 <div className="p-4">
 <TabLoadingState rows={6} />
 </div>
 ) : filteredTemplates.length > 0 ? (
 <>
 {canWrite && !hideHeader && (
 <div className="flex items-center gap-3 border-b border-border/30 px-4 py-2">
 <label className="flex items-center gap-2">
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
 className="h-4 w-4 rounded border-border bg-card text-primary-600"
 />
 <span className="text-xs font-medium text-muted-foreground">Select all</span>
 </label>
 </div>
 )}

 <div className="divide-y divide-border/30">
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
 </>
 ) : (
 <div className="p-6">
 <TabEmptyState
 title={search.trim() || hasActiveFilters ? 'No templates found' : 'No templates'}
 description={
 search.trim() || hasActiveFilters
 ? 'Try adjusting your search or filters.'
 : 'Create a template to bootstrap new game servers quickly.'
 }
 action={
 hasActiveFilters ? (
 <Button variant="outline" size="sm" onClick={clearFilters}>
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
 )}

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
 title="Delete Templates"
 message={
 <div className="space-y-2">
 <p>
 You are about to delete{' '}
 <span className="font-semibold">{deleteTargets?.label}</span>.
 </p>
 <p className="text-xs text-muted-foreground">
 Templates in use by existing servers cannot be deleted. This action cannot be undone.
 </p>
 </div>
 }
 confirmText="Delete"
 cancelText="Cancel"
 onConfirm={() => deleteTargets && deleteMutation.mutate(deleteTargets.templateIds)}
 onCancel={() => setDeleteTargets(null)}
 variant="danger"
 loading={deleteMutation.isPending}
 />
 </div>
 );
}

export default TemplatesPage;
