import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

type EulaModalProps = {
  eulaText: string;
  onAccept: () => void;
  /** Explicit "Decline" button only — closing the dialog must not decline. */
  onDecline: () => void;
  /**
   * Esc / overlay / close-button dismissal. Neutral by contract (audit D10):
   * closing the prompt is not a decision, so it leaves the server waiting for
   * an answer instead of posting a decline nobody meant to send.
   */
  onDismiss?: () => void;
  isLoading?: boolean;
};

export default function EulaModal({ eulaText, onAccept, onDecline, onDismiss, isLoading }: EulaModalProps) {
  const { t } = useTranslation('servers');
  const [canAccept, setCanAccept] = useState(false);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) {
      setCanAccept(true);
    }
  };

  const handleContentRef = (el: HTMLDivElement | null) => {
    if (el && el.scrollHeight <= el.clientHeight) {
      setCanAccept(true);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Neutral dismissal: Esc, the overlay and the close button all land
        // here and none of them is a decision (audit D10). Without an onDismiss
        // handler the dialog simply closes; only the Decline button declines.
        if (!next && !isLoading) onDismiss?.();
      }}
    >
      <DialogContent size="lg">
        <DialogHeader
          icon={<AlertTriangle className="h-4 w-4" />}
          iconClassName="border-warning/30 bg-warning/10 text-warning"
        >
          <DialogTitle>{t('eula.title')}</DialogTitle>
          <DialogDescription>
            {t('eula.description')}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div
            className="max-h-72 overflow-y-auto rounded-sm border border-border bg-surface-2 p-4 text-sm leading-relaxed text-muted-foreground"
            onScroll={handleScroll}
            ref={handleContentRef}
          >
            {eulaText || t('eula.textUnavailable')}
          </div>
          {!canAccept && (
            <p className="mt-2 text-micro text-muted-foreground">
              {t('eula.scrollHint')}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8 px-3 text-mini" onClick={onDecline} disabled={isLoading}>
            {t('eula.decline')}
          </Button>
          <Button size="sm" className="h-8 px-3 text-mini" onClick={onAccept} disabled={isLoading || !canAccept}>
            {isLoading ? t('eula.submitting') : t('eula.accept')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
