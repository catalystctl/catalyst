import { ArrowUpCircle, Loader2 } from 'lucide-react';
import { ModalPortal } from '@/components/ui/modal-portal';

export interface UpdateItem {
  name: string;
  currentVersion: string;
  latestVersion: string;
}

interface UpdateConfirmModalProps {
  /** e.g. "Mod" or "Plugin" */
  itemType: string;
  items: UpdateItem[];
  isUpdating: boolean;
  warningMessage: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirmation dialog shown before bulk-updating mods or plugins.
 * Used by both ModManager and PluginManager tabs.
 */
export default function UpdateConfirmModal({
  itemType,
  items,
  isUpdating,
  warningMessage,
  onCancel,
  onConfirm,
}: UpdateConfirmModalProps) {
  if (items.length === 0) return null;

  const pluralized = items.length !== 1 ? `${itemType}s` : itemType;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="mx-4 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning-muted">
              <ArrowUpCircle className="h-5 w-5 text-warning" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">
                Confirm {itemType} Update{items.length > 1 ? 's' : ''}
              </h3>
              <p className="text-xs text-muted-foreground">
                {items.length} {pluralized} will be updated
              </p>
            </div>
          </div>

          <div className="mb-4 rounded-lg border border-warning/30 bg-warning-muted p-3">
            <p className="text-xs text-warning">{warningMessage}</p>
          </div>

          <div className="mb-4 max-h-60 space-y-2 overflow-y-auto">
            {items.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
              >
                <span className="truncate text-sm font-medium text-foreground">
                  {item.name}
                </span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                  {item.currentVersion.slice(0, 8)} →{' '}
                  <span className="text-warning">{item.latestVersion}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-2"
              onClick={onCancel}
              disabled={isUpdating}
            >
              Cancel
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg bg-warning px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-warning disabled:opacity-50"
              disabled={isUpdating}
              onClick={onConfirm}
            >
              {isUpdating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUpCircle className="h-4 w-4" />
              )}
              {isUpdating
                ? 'Updating…'
                : `Update ${items.length > 1 ? 'All' : itemType}`}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
