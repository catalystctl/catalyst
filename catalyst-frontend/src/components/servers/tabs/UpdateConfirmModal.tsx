import { ArrowUpCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

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
  const pluralized = items.length !== 1 ? `${itemType}s` : itemType;

  return (
    <Dialog
      open={items.length > 0}
      onOpenChange={(next) => {
        if (!next && !isUpdating) onCancel();
      }}
    >
      <DialogContent size="md">
        <DialogHeader
          icon={<ArrowUpCircle className="h-4 w-4" />}
          iconClassName="border-warning/30 bg-warning/10 text-warning"
        >
          <DialogTitle>
            Confirm {itemType.toLowerCase()} {items.length > 1 ? 'updates' : 'update'}
          </DialogTitle>
          <DialogDescription>
            {items.length} {pluralized} will be updated
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="mb-4 rounded-lg border border-warning/30 bg-warning-muted p-3">
            <p className="text-xs text-warning">{warningMessage}</p>
          </div>
          <div className="space-y-2">
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
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isUpdating}>
            Cancel
          </Button>
          <Button
            className="bg-warning text-foreground hover:bg-warning/90"
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
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
