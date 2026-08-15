import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ModalPortal } from '@/components/ui/modal-portal';
import { AlertTriangle } from 'lucide-react';

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
 <ModalPortal>
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 backdrop-blur-sm">
 <div className="w-full max-w-xl rounded-lg border border-border bg-card shadow-elevated">
 {/* Header */}
        <div className="flex items-start gap-2.5 border-b border-border/70 px-3 py-2.5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-warning/30 bg-warning/10 text-warning">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">Minecraft EULA</h2>
            <p className="type-meta mt-0.5">
              Agree to the Minecraft End User License Agreement before the server can start.
            </p>
          </div>
        </div>

 {/* EULA text */}
 <div className="px-6 py-4">
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
 </div>

 {/* Actions */}
 <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
 <Button variant="outline" onClick={onDecline} disabled={isLoading}>
 Decline
 </Button>
 <Button onClick={onAccept} disabled={isLoading || !canAccept}>
 {isLoading ? 'Submitting...' : 'I Agree'}
 </Button>
 </div>
 </div>
 </div>
 </ModalPortal>
 );
}
