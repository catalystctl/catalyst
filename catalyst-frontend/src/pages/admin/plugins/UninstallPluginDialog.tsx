import { useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface UninstallPluginDialogProps {
  pluginName: string;
  displayName: string;
  version?: string;
  enabled?: boolean;
  open: boolean;
  busy?: boolean;
  onConfirm: (purgeData: boolean) => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * Confirm plugin uninstall. Removing deletes the plugin code from disk and
 * unloads it from the running panel. Stored data is kept by default so a
 * later reinstall restores config and consent history; purge deletes it.
 */
export function UninstallPluginDialog({
  pluginName,
  displayName,
  version,
  enabled,
  open,
  busy,
  onConfirm,
  onOpenChange,
}: UninstallPluginDialogProps) {
  const [purgeData, setPurgeData] = useState(false);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPurgeData(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="plugin-uninstall-confirm">
        <DialogHeader icon={<Trash2 className="h-4 w-4 text-danger" />}>
          <DialogTitle>Uninstall {displayName}</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{pluginName}</span>
            {version ? ` v${version}` : ''} will be removed from this panel.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {enabled && (
                <Badge variant="outline" className="text-[11px]">
                  Currently enabled — it will be disabled first
                </Badge>
              )}
              <Badge variant="secondary" className="text-[11px]">
                Code on disk will be deleted
              </Badge>
            </div>

            <p className="text-sm leading-relaxed text-muted-foreground">
              Uninstalling removes the plugin code and unloads it from the running panel.
              Its routes, tasks and event handlers stop immediately.
            </p>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-surface-2/20 px-4 py-3">
              <Checkbox
                checked={purgeData}
                onCheckedChange={(v) => setPurgeData(v === true)}
                className="mt-0.5"
                data-testid="plugin-uninstall-purge"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">
                  Also delete stored data
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  Removes config values, key-value storage, collections, and consent history.
                  Keep this off to preserve settings for a later reinstall.
                </span>
              </span>
            </label>

            {purgeData && (
              <p className="flex items-start gap-1.5 text-xs leading-relaxed text-danger">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Stored data cannot be recovered after purging.
              </p>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onConfirm(purgeData)}
            disabled={busy}
            data-testid="plugin-uninstall-confirm-button"
          >
            {busy ? 'Uninstalling…' : 'Uninstall'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
