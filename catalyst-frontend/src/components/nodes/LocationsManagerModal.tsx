import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { MapPin, Plus, Pencil, Trash2, X } from 'lucide-react';
import { locationsApi, type Location } from '../../services/api/locations';
import { notifyError, notifySuccess } from '../../utils/notify';
import ConfirmDialog from '../shared/ConfirmDialog';
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
 * custom event that re-opens that modal after a location is created.
 */
const RETURN_EVENT_MAP: Record<string, string> = {
 'node-create': 'catalyst:return-to-node-create',
 'node-update': 'catalyst:return-to-node-update',
};

// ── Location Form ──
function LocationForm({
 initial,
 onSave,
 onCancel,
 isPending,
}: {
 initial?: Location | null;
 onSave: (payload: { name: string; description?: string }) => void;
 onCancel: () => void;
 isPending: boolean;
}) {
 const { t } = useTranslation('nodes');
 const [name, setName] = useState(initial?.name || '');
 const [description, setDescription] = useState(initial?.description || '');

 const disableSubmit = !name.trim() || isPending;

 return (
 <div className="space-y-3">
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">
 {t('locations.name')} <span className="text-destructive">*</span>
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={name}
 onChange={(e) => setName(e.target.value)}
 placeholder="US-East"
 autoFocus
 />
 </label>
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">{t('locations.descriptionOptional')}</span>
 <textarea
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 rows={2}
 value={description}
 onChange={(e) => setDescription(e.target.value)}
 placeholder={t('locations.descriptionPlaceholder')}
 />
 </label>
 <div className="flex justify-end gap-2 pt-1">
 <button
 className="rounded-full border border-border/40 px-4 py-1.5 text-xs font-semibold text-muted-foreground transition-all hover:border-primary/50 hover:text-foreground"
 onClick={onCancel}
 >
 {t('common:actions.cancel')}
 </button>
 <button
 className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-60"
 onClick={() =>
 onSave({
 name: name.trim(),
 description: description.trim() || undefined,
 })
 }
 disabled={disableSubmit}
 >
 {isPending ? t('locations.saving') : initial ? t('locations.update') : t('common:actions.create')}
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

export default function LocationsManagerModal({ open, onOpenChange }: Props) {
  const { t } = useTranslation('nodes');
 const [editingLocation, setEditingLocation] = useState<Location | null>(null);
 const [isCreating, setIsCreating] = useState(false);
 const [deleteTarget, setDeleteTarget] = useState<Location | null>(null);
 const returnToRef = useRef<string | null>(null);

 const { data: locations = [], isLoading } = useQuery({
 queryKey: qk.locations(),
 queryFn: locationsApi.list,
 staleTime: 60_000,
 });

 // Listen for the `returnTo` field in the open-locations-modal event
 useEffect(() => {
 const handler = (e: Event) => {
 const detail = (e as CustomEvent).detail;
 returnToRef.current = detail?.returnTo ?? null;
 };
 window.addEventListener('catalyst:open-locations-modal', handler);
 return () => window.removeEventListener('catalyst:open-locations-modal', handler);
 }, []);

 const createMutation = useMutation({
 mutationFn: locationsApi.create,
 onSuccess: (created) => {
 notifySuccess(t('locations.created'));
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
   notifyError(error, 'nodes:locations.createError');
 },
 onSettled: () => {
 Promise.all([
 queryClient.invalidateQueries({ queryKey: qk.locations() }),
 queryClient.invalidateQueries({ queryKey: qk.nodes() }),
 queryClient.invalidateQueries({ queryKey: qk.adminNodes() }),
 ]);
 },
 });

 const updateMutation = useMutation({
 mutationFn: ({ id, ...payload }: { id: string } & Parameters<typeof locationsApi.update>[1]) =>
 locationsApi.update(id, payload),
 onSuccess: () => {
 notifySuccess(t('locations.updated'));
 setEditingLocation(null);
 },
 onError: (error: unknown) => {
   notifyError(error, 'nodes:locations.updateError');
 },
 onSettled: () => {
 Promise.all([
 queryClient.invalidateQueries({ queryKey: qk.locations() }),
 queryClient.invalidateQueries({ queryKey: qk.nodes() }),
 queryClient.invalidateQueries({ queryKey: qk.adminNodes() }),
 ]);
 },
 });

 const deleteMutation = useMutation({
 mutationFn: locationsApi.remove,
 onSuccess: () => {
 notifySuccess(t('locations.deleted'));
 setDeleteTarget(null);
 },
 onError: (error: unknown) => {
   notifyError(error, 'nodes:locations.deleteError');
 },
 onSettled: () => {
 Promise.all([
 queryClient.invalidateQueries({ queryKey: qk.locations() }),
 queryClient.invalidateQueries({ queryKey: qk.nodes() }),
 queryClient.invalidateQueries({ queryKey: qk.adminNodes() }),
 ]);
 },
 });

 const handleCreate = (payload: Parameters<typeof locationsApi.create>[0]) => {
 createMutation.mutate(payload);
 };

 const handleUpdate = (payload: Parameters<typeof locationsApi.update>[1]) => {
 if (!editingLocation) return;
 updateMutation.mutate({ id: editingLocation.id, ...payload });
 };


 const isFormActive = isCreating || !!editingLocation;

 return (
 <>
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent size="xl">
 <DialogHeader icon={<MapPin className="h-4 w-4" />} iconClassName="border-success/20 bg-success/10 text-success">
 <DialogTitle>{t('locations.title')}</DialogTitle>
 <DialogDescription>{t('locations.description')}</DialogDescription>
 </DialogHeader>
 <DialogBody>
 {/* Inline form */}
 {isFormActive && (
 <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
 <div className="mb-3 flex items-center justify-between">
 <span className="text-sm font-semibold text-foreground">
 {editingLocation ? t('locations.edit') : t('locations.new')}
 </span>
 <button
 className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
 onClick={() => {
 setIsCreating(false);
 setEditingLocation(null);
 }}
 >
 <X className="h-4 w-4" />
 </button>
 </div>
 <LocationForm
 key={editingLocation?.id || '__new__'}
 initial={editingLocation}
 onSave={editingLocation ? handleUpdate : handleCreate}
 onCancel={() => {
 setIsCreating(false);
 setEditingLocation(null);
 }}
 isPending={createMutation.isPending || updateMutation.isPending}
 />
 </div>
 )}

 {/* Location list */}
 {isLoading ? (
 <div className="space-y-2">
 {Array.from({ length: 3 }).map((_, i) => (
 <div
 key={i}
 className="flex items-center gap-3 rounded-lg border border-border/30 px-4 py-3"
 >
 <div className="h-8 w-8 animate-pulse rounded-lg bg-surface-3" />
 <div className="flex-1 space-y-1.5">
 <div className="h-4 w-28 animate-pulse rounded bg-surface-3" />
 <div className="h-3 w-48 animate-pulse rounded bg-surface-2" />
 </div>
 </div>
 ))}
 </div>
 ) : locations.length === 0 && !isCreating ? (
 <div className="flex flex-col items-center justify-center py-12 text-center">
 <MapPin className="mb-3 h-10 w-10 text-muted-foreground/40" />
 <p className="text-sm font-medium text-muted-foreground">{t('locations.empty')}</p>
 <p className="mt-1 text-xs text-muted-foreground/70">
 {t('locations.emptyHint')}
 </p>
 </div>
 ) : (
 <div className="space-y-2">
 {locations.map((location) => (
 <div
 key={location.id}
 className="group flex items-center gap-3 rounded-xl border border-border/30 px-4 py-3 transition-colors hover:bg-surface-2/30"
 >
 {/* Icon */}
 <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/10">
 <MapPin className="h-4 w-4 text-success" />
 </div>

 {/* Info */}
 <div className="min-w-0 flex-1">
 <span className="font-medium text-foreground">
 {location.name}
 </span>
 {location.description && (
 <p className="mt-0.5 truncate text-xs text-muted-foreground">
 {location.description}
 </p>
 )}
 <span className="text-[11px] text-muted-foreground/70">
 {t('locations.nodeCount', { count: location.nodeCount ?? 0 })}
 </span>
 </div>

 {/* Actions */}
 <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 onClick={() => {
 setEditingLocation(location);
 setIsCreating(false);
 }}
 title={t('common:actions.edit')}
 >
 <Pencil className="h-3.5 w-3.5" />
 </button>
 <button
 className="rounded-md p-1.5 text-destructive transition-colors hover:bg-destructive/5 hover:text-destructive"
 onClick={() => setDeleteTarget(location)}
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
 <span className="text-xs text-muted-foreground">
 {t('locations.count', { count: locations.length })}
 </span>
 <Button
 size="sm"
 onClick={() => {
 setEditingLocation(null);
 setIsCreating(true);
 }}
 >
 <Plus className="h-3.5 w-3.5" />
 {t('locations.add')}
 </Button>
 </DialogFooter>
 )}
 </DialogContent>
 </Dialog>

 {/* Delete confirmation */}
 <ConfirmDialog
 open={!!deleteTarget}
 title={t('locations.deleteTitle')}
 message={
 <div className="space-y-2">
 <p>{t('locations.deleteConfirm', { name: deleteTarget?.name })}</p>
 <p className="text-xs text-muted-foreground">
   {t('locations.deleteWarning')}
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
