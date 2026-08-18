import { useState } from 'react';
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
          <DialogTitle>Minecraft EULA</DialogTitle>
          <DialogDescription>
            Agree to the Minecraft End User License Agreement before the server can start.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div
            className="max-h-72 overflow-y-auto rounded-lg border border-border bg-surface-2 p-4 text-sm leading-relaxed text-muted-foreground"
            onScroll={handleScroll}
            ref={handleContentRef}
          >
            {eulaText || 'EULA text could not be loaded from the server files.'}
          </div>
          {!canAccept && (
            <p className="mt-2 text-xs text-muted-foreground">
              Scroll to the bottom to enable the accept button.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onDecline} disabled={isLoading}>
            Decline
          </Button>
          <Button onClick={onAccept} disabled={isLoading || !canAccept}>
            {isLoading ? 'Submitting...' : 'I Agree'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
