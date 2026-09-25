import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
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

/** Deck field chrome — 4px radius, 32px control height, mini type ramp. */
const fieldClass =
  'h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40';
/** Labelled block on the dialog surface — never a nested rounded card. */
const blockClass = 'rounded-sm border border-border/50 bg-surface-1/40 p-3';

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
        <DialogBody className="space-y-3">
          <div className={`${blockClass} space-y-3`}>
            <div className="type-meta">
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
                className={cn(fieldClass, 'font-mono')}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1.5 px-3 text-mini"
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
          </div>
          <p className="type-meta">
            {t('inviteLink.warning')}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-3 text-mini"
            onClick={onRegenerate}
            disabled={regeneratePending}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${regeneratePending ? 'animate-spin' : ''}`} />
            {t('inviteLink.regenerate')}
          </Button>
          <Button size="sm" className="h-8 px-3 text-mini" onClick={onClose}>{t('inviteLink.done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
