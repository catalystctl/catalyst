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
  onDecline: () => void;
  isLoading?: boolean;
};

export default function EulaModal({ eulaText, onAccept, onDecline, isLoading }: EulaModalProps) {
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
        if (!next && !isLoading) onDecline();
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
            className="max-h-72 overflow-y-auto rounded-lg border border-border bg-surface-2 p-4 text-sm leading-relaxed text-muted-foreground"
            onScroll={handleScroll}
            ref={handleContentRef}
          >
            {eulaText || t('eula.textUnavailable')}
          </div>
          {!canAccept && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('eula.scrollHint')}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onDecline} disabled={isLoading}>
            {t('eula.decline')}
          </Button>
          <Button onClick={onAccept} disabled={isLoading || !canAccept}>
            {isLoading ? t('eula.submitting') : t('eula.accept')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
