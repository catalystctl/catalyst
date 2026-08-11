import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { FolderOpen, Plus, Pencil, Trash2, X } from 'lucide-react';
import { nestsApi, type Nest } from '../../services/api/nests';
import { notifyError, notifySuccess } from '../../utils/notify';
import ConfirmDialog from '../shared/ConfirmDialog';
import { ModalPortal } from '@/components/ui/modal-portal';

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
 const [name, setName] = useState(initial?.name || '');
 const [description, setDescription] = useState(initial?.description || '');
 const [icon, setIcon] = useState(initial?.icon || '');
 const [author, setAuthor] = useState(initial?.author || '');

 const disableSubmit = !name.trim() || isPending;

 return (
 <div className="space-y-3">
 <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">
 Name <span className="text-destructive">*</span>
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={name}
 onChange={(e) => setName(e.target.value)}
 placeholder="Minecraft"
 autoFocus
 />
 </label>
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">Icon URL (optional)</span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={icon}
 onChange={(e) => setIcon(e.target.value)}
 placeholder="https://example.com/icon.png"
 />
 </label>
 </div>
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">Author (optional)</span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 value={author}
 onChange={(e) => setAuthor(e.target.value)}
 placeholder="Catalyst Maintainers"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">Description (optional)</span>
 <textarea
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none hover:border-primary"
 rows={2}
 value={description}
 onChange={(e) => setDescription(e.target.value)}
 placeholder="Brief description of this nest category"
 />
 </label>
 <div className="flex justify-end gap-2 pt-1">
 <button
 className="rounded-full border border-border/40 px-4 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
 onClick={onCancel}
 >
 Cancel
 </button>
 <button
 className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
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
 {isPending ? 'Saving...' : initial ? 'Update' : 'Create'}
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
 notifySuccess('Nest created');
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
 onError: (error: any) => {
 const message = error?.response?.data?.error || 'Failed to create nest';
 notifyError(message);
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
 notifySuccess('Nest updated');
 setEditingNest(null);
 },
 onError: (error: any) => {
 const message = error?.response?.data?.error || 'Failed to update nest';
 notifyError(message);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.nests() });
 queryClient.invalidateQueries({ queryKey: qk.templates() });
 },
 });

 const deleteMutation = useMutation({
 mutationFn: nestsApi.remove,
 onSuccess: () => {
 notifySuccess('Nest deleted');
 setDeleteTarget(null);
 },
 onError: (error: any) => {
 const message = error?.response?.data?.error || 'Failed to delete nest';
 notifyError(message);
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

 if (!open) return null;

 const isFormActive = isCreating || !!editingNest;

 return (
 <>
 <ModalPortal>
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 py-10">
 <div className="flex w-full max-w-2xl max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-border/40 bg-card shadow-sm transition-colors">
 {/* Header */}
 <div className="flex items-center justify-between border-b border-border px-6 py-4">
 <div className="flex items-center gap-3">
 <div className="relative">
 <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-amber-500 to-rose-500 opacity-20 blur-sm" />
 <FolderOpen className="relative h-5 w-5 text-warning" />
 </div>
 <div>
 <h2 className="text-base font-semibold text-foreground">
 Manage Nests
 </h2>
 <p className="text-xs text-muted-foreground">
 Organize templates into categories.
 </p>
 </div>
 </div>
 <button
 className="rounded-full border border-border/40 px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary"
 onClick={() => onOpenChange(false)}
 >
 Close
 </button>
 </div>

 {/* Body */}
 <div className="flex-1 overflow-y-auto px-6 py-4">
 {/* Inline form */}
 {isFormActive && (
 <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
 <div className="mb-3 flex items-center justify-between">
 <span className="text-sm font-semibold text-foreground">
 {editingNest ? 'Edit nest' : 'New nest'}
 </span>
 <button
 className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
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
 <div className="space-y-2">
 {Array.from({ length: 3 }).map((_, i) => (
 <div
 key={i}
 className="flex items-center gap-3 rounded-lg border border-border/40 px-4 py-3"
 >
 <div className="h-8 w-8 animate-pulse rounded-lg bg-surface-3" />
 <div className="flex-1 space-y-1.5">
 <div className="h-4 w-28 animate-pulse rounded bg-surface-3" />
 <div className="h-3 w-48 animate-pulse rounded bg-surface-2" />
 </div>
 </div>
 ))}
 </div>
 ) : nests.length === 0 && !isCreating ? (
 <div className="flex flex-col items-center justify-center py-12 text-center">
 <FolderOpen className="mb-3 h-10 w-10 text-muted-foreground/40" />
 <p className="text-sm font-medium text-muted-foreground">No nests yet</p>
 <p className="mt-1 text-xs text-muted-foreground/70">
 Create a nest to group your templates by category.
 </p>
 </div>
 ) : (
 <div className="space-y-2">
 {nests.map((nest) => (
 <div
 key={nest.id}
 className="group flex items-center gap-3 rounded-xl border border-border/40 px-4 py-3 transition-colors hover:bg-surface-2/50"
 >
 {/* Icon */}
 <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-border/40 bg-surface-2">
 {nest.icon ? (
 <img src={nest.icon} alt="" className="h-full w-full object-cover" />
 ) : (
 <div className="flex h-full w-full items-center justify-center text-xs font-bold uppercase text-muted-foreground">
 {nest.name.slice(0, 2)}
 </div>
 )}
 </div>

 {/* Info */}
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2">
 <span className="font-medium text-foreground">
 {nest.name}
 </span>
 {nest.author && (
 <span className="text-xs text-muted-foreground">by {nest.author}</span>
 )}
 </div>
 {nest.description && (
 <p className="mt-0.5 truncate text-xs text-muted-foreground">
 {nest.description}
 </p>
 )}
 <span className="text-[11px] text-muted-foreground/70">
 {(nest as any).templateCount ?? 0} template
 {((nest as any).templateCount ?? 0) !== 1 ? 's' : ''}
 </span>
 </div>

 {/* Actions */}
 <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 onClick={() => {
 setEditingNest(nest);
 setIsCreating(false);
 }}
 title="Edit"
 >
 <Pencil className="h-3.5 w-3.5" />
 </button>
 <button
 className="rounded-md p-1.5 text-destructive transition-colors hover:bg-destructive/5 hover:text-destructive"
 onClick={() => setDeleteTarget(nest)}
 title="Delete"
 >
 <Trash2 className="h-3.5 w-3.5" />
 </button>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>

 {/* Footer */}
 {!isFormActive && (
 <div className="flex items-center justify-between border-t border-border px-6 py-3">
 <span className="text-xs text-muted-foreground">
 {nests.length} nest{nests.length !== 1 ? 's' : ''}
 </span>
 <button
 className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
 onClick={() => {
 setEditingNest(null);
 setIsCreating(true);
 }}
 >
 <Plus className="h-3.5 w-3.5" />
 Add nest
 </button>
 </div>
 )}
 </div>
 </div>
 </ModalPortal>

 {/* Delete confirmation */}
 <ConfirmDialog
 open={!!deleteTarget}
 title="Delete Nest"
 message={
 <div className="space-y-2">
 <p>
 Delete nest <span className="font-semibold">{deleteTarget?.name}</span>?
 </p>
 <p className="text-xs text-muted-foreground">
 Templates in this nest will become ungrouped. This action cannot be undone.
 </p>
 </div>
 }
 confirmText="Delete"
 cancelText="Cancel"
 onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
 onCancel={() => setDeleteTarget(null)}
 variant="danger"
 loading={deleteMutation.isPending}
 />
 </>
 );
}