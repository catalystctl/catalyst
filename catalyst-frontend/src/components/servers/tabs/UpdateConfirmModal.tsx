import { useTranslation } from 'react-i18next';
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
  /** Which kind of item is being updated */
  itemKind: 'mod' | 'plugin';
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
  itemKind,
  items,
  isUpdating,
  warningMessage,
  onCancel,
  onConfirm,
}: UpdateConfirmModalProps) {
  const { t } = useTranslation('server-tabs');
  const itemType =
    itemKind === 'mod' ? t('shared.itemKind.mod') : t('shared.itemKind.plugin');
  const itemTypeLower =
    itemKind === 'mod' ? t('shared.itemKind.modLower') : t('shared.itemKind.pluginLower');
  const itemTypePlural =
    itemKind === 'mod' ? t('shared.itemKind.mods') : t('shared.itemKind.plugins');

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
            {items.length > 1
              ? t('shared.updateConfirm.titlePlural', { itemType: itemTypeLower })
              : t('shared.updateConfirm.titleSingular', { itemType: itemTypeLower })}
          </DialogTitle>
          <DialogDescription>
            {t('shared.updateConfirm.description', {
              count: items.length,
              itemType: items.length !== 1 ? itemTypePlural : itemType,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="mb-4 rounded-sm border border-warning/30 bg-warning-muted px-3 py-2.5">
            <p className="text-mini text-warning">{warningMessage}</p>
          </div>
          <div>
            {items.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between gap-3 border-b border-border/50 py-2 last:border-0"
              >
                <span className="truncate text-data font-medium text-foreground">
                  {item.name}
                </span>
                <span className="shrink-0 font-mono text-micro tabular-nums text-muted-foreground">
                  {item.currentVersion.slice(0, 8)} →{' '}
                  <span className="text-warning">{item.latestVersion}</span>
                </span>
              </div>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isUpdating}>
            {t('common:actions.cancel')}
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
              ? t('shared.updateConfirm.updating')
              : items.length > 1
                ? t('shared.updateConfirm.updateAll')
                : t('shared.updateConfirm.updateOne', { itemType })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
