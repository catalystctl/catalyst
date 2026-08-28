import { useState } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';

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
import type { CapabilitySummary } from '../../../plugins/types';

/** Must match DISCLAIMER_VERSION on the backend (source of truth: server). */
export const PLUGIN_DISCLAIMER_VERSION = '1';

interface SafetyConsentDialogProps {
  pluginName: string;
  displayName: string;
  author?: string;
  version?: string;
  /**
   * Fully-resolved capability summaries from the server (builtin copy merged
   * with plugin-provided descriptions). Falls back to raw permission tokens
   * with the local label mirror if the payload predates them.
   */
  requestedCapabilities?: CapabilitySummary[];
  /** Fallback permission tokens when summaries are unavailable. */
  requestedPermissions?: string[];
  permissionLabels: Record<string, string>;
  open: boolean;
  busy?: boolean;
  onAccept: () => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * Plugin safety disclaimer shown before enabling a plugin that requires
 * consent. The confirm button stays disabled until the admin explicitly
 * acknowledges the risks via checkbox — mirroring the server-side gate.
 */
export function SafetyConsentDialog({
  displayName,
  author,
  version,
  requestedCapabilities,
  requestedPermissions,
  permissionLabels,
  open,
  busy,
  onAccept,
  onOpenChange,
}: SafetyConsentDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset the acknowledgment whenever the dialog is opened for a plugin
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setAcknowledged(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="plugin-safety-consent">
        <DialogHeader icon={<ShieldAlert className="h-4 w-4 text-warning" />}>
          <DialogTitle>Enable {displayName}</DialogTitle>
          <DialogDescription>
            You are about to enable third-party code{author ? ` by ${author}` : ''}
            {version ? ` (v${version})` : ''}.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Plugins run inside the panel backend with the same network and host access as
              Catalyst itself. They are not sandboxed from the panel process. Before enabling,
              make sure you trust this plugin and its author.
            </p>

            <div className="rounded-lg border border-border/60 bg-surface-2/30 p-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/70">
                This plugin will be able to
              </p>
              {requestedCapabilities && requestedCapabilities.length > 0 ? (
                <ul className="space-y-2">
                  {requestedCapabilities.map((cap) => (
                    <li key={cap.token} className="flex items-start gap-2">
                      <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-warning" />
                      <span className="min-w-0 text-sm text-foreground">
                        {cap.label}
                        <span className="block text-xs leading-snug text-muted-foreground">
                          {cap.description}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : requestedPermissions && requestedPermissions.length > 0 ? (
                <ul className="space-y-1.5">
                  {requestedPermissions.map((perm) => (
                    <li key={perm} className="flex items-start gap-2 text-sm text-foreground">
                      <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-warning" />
                      <span>{permissionLabels[perm] ?? perm}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No data permissions declared. It may still run scheduled code and serve API
                  routes under its namespace.
                </p>
              )}
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              A plugin can contact external services, read any server or user data permitted
              above, and keep running until you disable it. Granting fewer permissions after
              enabling limits its data access, but does not unload its code.
            </p>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(v) => setAcknowledged(v === true)}
                className="mt-0.5"
                data-testid="plugin-safety-checkbox"
              />
              <span className="text-sm leading-snug text-foreground">
                I understand the risks of enabling this plugin and I accept responsibility for
                the access it will have to this panel.
              </span>
            </label>

            {!acknowledged && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="h-3 w-3 text-warning" />
                Tick the box above to continue.
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
            onClick={onAccept}
            disabled={!acknowledged || busy}
            data-testid="plugin-safety-accept"
          >
            Accept &amp; Enable
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
