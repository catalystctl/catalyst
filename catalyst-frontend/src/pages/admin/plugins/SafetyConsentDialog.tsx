import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { BracketLabel, StatusLed } from '@/components/deck/primitives';
import type { CapabilitySummary, LicensingDisclosure } from '../../../plugins/types';

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
  /**
   * Declared licensing / phone-home disclosure. Rendered verbatim so an admin
   * sees where the plugin connects before enabling it.
   */
  licensing?: LicensingDisclosure | null;
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
  licensing,
  permissionLabels,
  open,
  busy,
  onAccept,
  onOpenChange,
}: SafetyConsentDialogProps) {
  const { t } = useTranslation('admin-system');
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
          <DialogTitle>{t('pluginsAdmin.consentTitle', { name: displayName })}</DialogTitle>
          <DialogDescription>
            {t('pluginsAdmin.consentIntro')}
            {author ? t('pluginsAdmin.consentByAuthor', { author }) : ''}
            {version ? t('pluginsAdmin.consentVersion', { version }) : ''}.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t('pluginsAdmin.consentBody')}
            </p>

            <div className="deck-panel">
              <div className="border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
                <BracketLabel tone="hazard">{t('pluginsAdmin.consentWillBeAbleTo')}</BracketLabel>
              </div>
              <div className="p-3">
                {requestedCapabilities && requestedCapabilities.length > 0 ? (
                  <ul className="divide-y divide-border/40">
                    {requestedCapabilities.map((cap) => (
                      <li key={cap.token} className="flex items-start gap-2 py-1.5 first:pt-0 last:pb-0">
                        <StatusLed tone="hazard" className="mt-1" />
                        <span className="min-w-0 text-sm text-foreground">
                          {cap.label}
                          <span className="block text-mini leading-snug text-muted-foreground">
                            {cap.description}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : requestedPermissions && requestedPermissions.length > 0 ? (
                  <ul className="divide-y divide-border/40">
                    {requestedPermissions.map((perm) => (
                      <li key={perm} className="flex items-start gap-2 py-1.5 text-sm text-foreground first:pt-0 last:pb-0">
                        <StatusLed tone="hazard" className="mt-1" />
                        <span>{permissionLabels[perm] ?? perm}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t('pluginsAdmin.consentNoPermissions')}
                  </p>
                )}
              </div>
            </div>

            {licensing && (
              <div className="deck-panel" data-testid="plugin-consent-licensing">
                <div className="border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
                  <BracketLabel tone="hazard">
                    {t('pluginsAdmin.consentLicensingTitle')}
                  </BracketLabel>
                </div>
                <div className="p-3">
                  <ul className="divide-y divide-border/40">
                    <li className="flex items-start gap-2 py-1.5 first:pt-0">
                      <StatusLed tone="hazard" className="mt-1" />
                      <span className="min-w-0 text-sm text-foreground">
                        {t('pluginsAdmin.consentLicensingContacts', {
                          hosts: licensing.contactHosts.join(', '),
                        })}
                      </span>
                    </li>
                    {licensing.encrypted && (
                      <li className="flex items-start gap-2 py-1.5">
                        <StatusLed tone="hazard" className="mt-1" />
                        <span className="min-w-0 text-sm text-foreground">
                          {t('pluginsAdmin.consentLicensingEncrypted')}
                        </span>
                      </li>
                    )}
                    <li className="flex items-start gap-2 py-1.5 last:pb-0">
                      <StatusLed tone="hazard" className="mt-1" />
                      <span className="min-w-0 text-sm text-foreground">
                        {t('pluginsAdmin.consentLicensingServer', { server: licensing.licenseServer })}
                      </span>
                    </li>
                  </ul>
                  {licensing.buyUrl && (
                    <a
                      href={licensing.buyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex font-mono text-mini text-primary hover:underline"
                    >
                      {t('pluginsAdmin.consentLicensingBuy')}
                    </a>
                  )}
                </div>
              </div>
            )}

            <p className="text-mini leading-relaxed text-muted-foreground">
              {t('pluginsAdmin.consentRisk')}
            </p>

            <label className="flex cursor-pointer items-start gap-3 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2.5">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(v) => setAcknowledged(v === true)}
                className="mt-0.5"
                data-testid="plugin-safety-checkbox"
              />
              <span className="text-sm leading-snug text-foreground">
                {t('pluginsAdmin.consentAcknowledge')}
              </span>
            </label>

            {!acknowledged && (
              <p className="flex items-center gap-1.5 text-mini text-muted-foreground">
                <AlertTriangle className="h-3 w-3 text-warning" />
                {t('pluginsAdmin.consentTickToContinue')}
              </p>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-mini"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-8 px-3 text-mini"
            onClick={onAccept}
            disabled={!acknowledged || busy}
            data-testid="plugin-safety-accept"
          >
            {t('pluginsAdmin.consentAccept')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
