import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { FolderOpen, Plus, Pencil, Trash2, X } from 'lucide-react';
import { nestsApi, type Nest } from '../../services/api/nests';
import { notifyError, notifySuccess } from '../../utils/notify';
import ConfirmDialog from '../shared/ConfirmDialog';
import { BracketLabel } from '../deck/primitives';
import { Button } from '@/components/ui/button';
import {
 Dialog,
 DialogBody,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from '@/components/ui/dialog';

/**
 * Maps a `returnTo` identifier (sent by the opening modal) to the
 * custom event that re-opens that modal after a nest is created.
 */
const RETURN_EVENT_MAP: Record<string, string> = {
 'template-create': 'catalyst:return-to-template-create',
 'template-edit': 'catalyst:return-to-template-edit',
};

// ── Nest Form ──
function NestForm({
 initial,
 onSave,
 onCancel,
 isPending,
}: {
 initial?: Nest | null;
 onSave: (payload: { name: string; description?: string; icon?: string; author?: string }) => void;
 onCancel: () => void;
 isPending: boolean;
}) {
 const { t } = useTranslation('templates');
 const [name, setName] = useState(initial?.name || '');
 const [description, setDescription] = useState(initial?.description || '');
 const [icon, setIcon] = useState(initial?.icon || '');
 const [author, setAuthor] = useState(initial?.author || '');

 const disableSubmit = !name.trim() || isPending;

 return (
 <div className="space-y-3">
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">
   {t('form.name')} <span className="text-danger">*</span>
 </span>
 <input
 className="w-full rounded-sm border border-border/60 bg-background/40 px-2.5 py-1.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={name}
 onChange={(e) => setName(e.target.value)}
 placeholder="Minecraft"
 autoFocus
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('nests.iconUrl')}</span>
 <input
 className="w-full rounded-sm border border-border/60 bg-background/40 px-2.5 py-1.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={icon}
 onChange={(e) => setIcon(e.target.value)}
 placeholder="https://example.com/icon.png"
 />
 </label>
 </div>
 <label className="block space-y-1">
 <span className="type-overline">{t('nests.authorOptional')}</span>
 <input
 className="w-full rounded-sm border border-border/60 bg-background/40 px-2.5 py-1.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 value={author}
 onChange={(e) => setAuthor(e.target.value)}
 placeholder="Catalyst Maintainers"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('nests.descriptionOptional')}</span>
 <textarea
 className="w-full rounded-sm border border-border/60 bg-background/40 px-2.5 py-1.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 rows={2}
 value={description}
 onChange={(e) => setDescription(e.target.value)}
 placeholder={t('nests.descriptionPlaceholder')}
 />
 </label>
 <div className="flex justify-end gap-2 pt-1">
 <button
 className="h-8 rounded-sm border border-border/60 px-3 text-mini font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
 onClick={onCancel}
 >
 {t('common:actions.cancel')}
 </button>
 <button
 className="h-8 rounded-sm bg-primary px-3 text-mini font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
 onClick={() =>
 onSave({
 name: name.trim(),
 description: description.trim() || undefined,
 icon: icon.trim() || undefined,
 author: author.trim() || undefined,
 })
 }
 disabled={disableSubmit}
 >
 {isPending ? t('nests.saving') : initial ? t('nests.update') : t('common:actions.create')}
 </button>
 </div>
 </div>
 );
}

// ── Main Modal ──
type Props = {
 open: boolean;
 onOpenChange: (open: boolean) => void;
};

export default function NestsManagerModal({ open, onOpenChange }: Props) {
  const { t } = useTranslation('templates');
 const [editingNest, setEditingNest] = useState<Nest | null>(null);
 const [isCreating, setIsCreating] = useState(false);
 const [deleteTarget, setDeleteTarget] = useState<Nest | null>(null);
 const returnToRef = useRef<string | null>(null);

 const { data: nests = [], isLoading } = useQuery({
 queryKey: qk.nests(),
 queryFn: nestsApi.list,
 staleTime: 60_000,
 });

 // Listen for the `returnTo` field in the open-nests-modal event
 useEffect(() => {
 const handler = (e: Event) => {
 const detail = (e as CustomEvent).detail;
 returnToRef.current = detail?.returnTo ?? null;
 };
 window.addEventListener('catalyst:open-nests-modal', handler);
 return () => window.removeEventListener('catalyst:open-nests-modal', handler);
 }, []);

 const createMutation = useMutation({
 mutationFn: nestsApi.create,
 onSuccess: (created) => {
 notifySuccess(t('nests.created'));
 setIsCreating(false);
 // If opened from another modal, send the user back after creation
 if (returnToRef.current) {
 const returnEvent = RETURN_EVENT_MAP[returnToRef.current];
 returnToRef.current = null;
 onOpenChange(false);
 if (returnEvent) {
 const createdId = created?.id ?? null;
 requestAnimationFrame(() => {
 window.dispatchEvent(new CustomEvent(returnEvent, { detail: { createdId } }));
 });
 }
 }
 },
 onError: (error: unknown) => {
   notifyError(error, 'templates:nests.createError');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.nests() });
 queryClient.invalidateQueries({ queryKey: qk.templates() });
 },
 });

 const updateMutation = useMutation({
 mutationFn: ({ id, ...payload }: { id: string } & Parameters<typeof nestsApi.update>[1]) =>
 nestsApi.update(id, payload),
 onSuccess: () => {
 notifySuccess(t('nests.updated'));
 setEditingNest(null);
 },
 onError: (error: unknown) => {
   notifyError(error, 'templates:nests.updateError');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.nests() });
 queryClient.invalidateQueries({ queryKey: qk.templates() });
 },
 });

 const deleteMutation = useMutation({
 mutationFn: nestsApi.remove,
 onSuccess: () => {
 notifySuccess(t('nests.deleted'));
 setDeleteTarget(null);
 },
 onError: (error: unknown) => {
   notifyError(error, 'templates:nests.deleteError');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.nests() });
 queryClient.invalidateQueries({ queryKey: qk.templates() });
 },
 });

 const handleCreate = (payload: Parameters<typeof nestsApi.create>[0]) => {
 createMutation.mutate(payload);
 };

 const handleUpdate = (payload: Parameters<typeof nestsApi.update>[1]) => {
 if (!editingNest) return;
 updateMutation.mutate({ id: editingNest.id, ...payload });
 };


 const isFormActive = isCreating || !!editingNest;

 return (
 <>
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent size="xl">
 <DialogHeader icon={<FolderOpen className="h-4 w-4" />} iconClassName="border-warning/20 bg-warning/10 text-warning">
 <DialogTitle>{t('nests.title')}</DialogTitle>
 <DialogDescription>{t('nests.description')}</DialogDescription>
 </DialogHeader>
 <DialogBody>
 {/* Inline form */}
 {isFormActive && (
 <div className="mb-3 rounded-sm border border-border/50 bg-surface-1/40 p-3">
 <div className="mb-2 flex items-center justify-between">
 <BracketLabel tone="muted">
 {editingNest ? t('nests.edit') : t('nests.new')}
 </BracketLabel>
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 onClick={() => {
 setIsCreating(false);
 setEditingNest(null);
 }}
 >
 <X className="h-4 w-4" />
 </button>
 </div>
 <NestForm
 key={editingNest?.id || '__new__'}
 initial={editingNest}
 onSave={editingNest ? handleUpdate : handleCreate}
 onCancel={() => {
 setIsCreating(false);
 setEditingNest(null);
 }}
 isPending={createMutation.isPending || updateMutation.isPending}
 />
 </div>
 )}

 {/* Nest list */}
 {isLoading ? (
 <div className="divide-y divide-border/50">
 {Array.from({ length: 3 }).map((_, i) => (
 <div
 key={i}
 className="flex items-center gap-3 py-2.5"
 >
 <div className="h-5 w-5 animate-pulse rounded-sm bg-surface-3" />
 <div className="flex-1 space-y-1.5">
 <div className="h-3.5 w-28 animate-pulse rounded-sm bg-surface-3" />
 <div className="h-3 w-48 animate-pulse rounded-sm bg-surface-3" />
 </div>
 </div>
 ))}
 </div>
 ) : nests.length === 0 && !isCreating ? (
 <div className="flex flex-col items-center justify-center py-12 text-center">
 <FolderOpen className="mb-2 h-4 w-4 text-muted-foreground" />
 <p className="type-meta">{t('nests.empty')}</p>
 <p className="type-overline mt-1">
 {t('nests.emptyHint')}
 </p>
 </div>
 ) : (
 <div className="divide-y divide-border/50">
 {nests.map((nest) => (
 <div
 key={nest.id}
 className="group flex items-center gap-3 py-2"
 >
 {/* Icon */}
 <div className="h-5 w-5 shrink-0 overflow-hidden rounded-sm border border-border/50">
 {nest.icon ? (
 <img src={nest.icon} alt="" className="h-full w-full object-cover" />
 ) : (
 <div className="flex h-full w-full items-center justify-center font-display text-micro font-semibold text-muted-foreground">
 {nest.name.slice(0, 2).toUpperCase()}
 </div>
 )}
 </div>

 {/* Info */}
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2">
 <span className="font-display text-data font-semibold tracking-tight text-foreground">
 {nest.name}
 </span>
 {nest.author && (
 <span className="type-meta">{t('nests.byAuthor', { author: nest.author })}</span>
 )}
 </div>
 {nest.description && (
 <p className="type-meta mt-0.5 truncate">
 {nest.description}
 </p>
 )}
 <span className="font-mono text-micro tabular-nums text-muted-foreground">
 {t('nests.templateCount', { count: (nest as any).templateCount ?? 0 })}
 </span>
 </div>

 {/* Actions */}
 <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 onClick={() => {
 setEditingNest(nest);
 setIsCreating(false);
 }}
 title={t('common:actions.edit')}
 >
 <Pencil className="h-3.5 w-3.5" />
 </button>
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm text-danger transition-colors hover:bg-danger/5 hover:text-danger"
 onClick={() => setDeleteTarget(nest)}
 title={t('common:actions.delete')}
 >
 <Trash2 className="h-3.5 w-3.5" />
 </button>
 </div>
 </div>
 ))}
 </div>
 )}
 </DialogBody>
 {!isFormActive && (
 <DialogFooter className="sm:justify-between">
 <span className="text-micro text-muted-foreground">
 {t('nests.count', { count: nests.length })}
 </span>
 <Button
 size="sm"
 className="h-8 px-3 text-mini"
 onClick={() => {
 setEditingNest(null);
 setIsCreating(true);
 }}
 >
 <Plus className="h-3.5 w-3.5" />
 {t('nests.add')}
 </Button>
 </DialogFooter>
 )}
 </DialogContent>
 </Dialog>

 {/* Delete confirmation */}
 <ConfirmDialog
 open={!!deleteTarget}
 title={t('nests.deleteTitle')}
 message={
 <div className="space-y-2">
 <p>{t('nests.deleteConfirm', { name: deleteTarget?.name })}</p>
 <p className="type-meta">
   {t('nests.deleteWarning')}
 </p>
 </div>
 }
 confirmText={t('common:actions.delete')}
 cancelText={t('common:actions.cancel')}
 onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
 onCancel={() => setDeleteTarget(null)}
 variant="danger"
 loading={deleteMutation.isPending}
 />
 </>
 );
}