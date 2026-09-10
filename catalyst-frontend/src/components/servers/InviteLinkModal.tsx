import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Copy, MailWarning, RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

type InviteLinkModalProps = {
  email: string;
  url: string;
  /** True when the link was regenerated (vs freshly created). */
  regenerated?: boolean;
  onClose: () => void;
  onRegenerate: () => void;
  regeneratePending?: boolean;
};

/**
 * Shown when an invite link should be shared manually — SMTP not configured,
 * email delivery failed, or the link was regenerated. Copy the link and send
 * it to the invitee through any channel.
 */
export default function InviteLinkModal({
  email,
  url,
  regenerated,
  onClose,
  onRegenerate,
  regeneratePending,
}: InviteLinkModalProps) {
  const { t } = useTranslation('servers');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the readonly input lets the user copy manually.
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="lg">
        <DialogHeader
          icon={<MailWarning className="h-4 w-4" />}
          iconClassName="border-warning/30 bg-warning/10 text-warning"
        >
          <DialogTitle>{regenerated ? t('inviteLink.regeneratedTitle') : t('inviteLink.title')}</DialogTitle>
          <DialogDescription>
            {regenerated
              ? t('inviteLink.regeneratedDescription')
              : t('inviteLink.description')}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="mb-3 text-xs text-muted-foreground">
            <Trans
              ns="servers"
              i18nKey="inviteLink.inviteFor"
              values={{ email }}
              components={{ strong: <span className="font-semibold text-foreground" /> }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              className="shrink-0 gap-1.5"
              onClick={copy}
              title={t('inviteLink.copyLink')}
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-success" /> {t('common:actions.copied')}
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" /> {t('common:actions.copy')}
                </>
              )}
            </Button>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            {t('inviteLink.warning')}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={onRegenerate}
            disabled={regeneratePending}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${regeneratePending ? 'animate-spin' : ''}`} />
            {t('inviteLink.regenerate')}
          </Button>
          <Button onClick={onClose}>{t('inviteLink.done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
