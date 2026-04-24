import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Settings, Server, Loader2 } from 'lucide-react';
import { useUpdateApiKey } from '../../hooks/useApiKeys';
import { type ApiKey } from '../../services/apiKeys';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ModalPortal } from '@/components/ui/modal-portal';
import { reportSystemError } from '../../services/api/systemErrors';

interface EditApiKeyDialogProps {
  apiKey: ApiKey;
  open: boolean;
  onClose: () => void;
}

export function EditApiKeyDialog({ apiKey, open, onClose }: EditApiKeyDialogProps) {
  const updateApiKey = useUpdateApiKey();

  const [name, setName] = useState(apiKey.name || '');
  const [enabled, setEnabled] = useState(apiKey.enabled);
  const [rateLimitMax, setRateLimitMax] = useState(apiKey.rateLimitMax || 100);
  const [rateLimitTimeWindow, setRateLimitTimeWindow] = useState(
    Math.round((apiKey.rateLimitTimeWindow || 60000) / 1000),
  );
  const [error, setError] = useState<string | null>(null);

  const isAgentKey = apiKey.metadata?.purpose === 'agent';

  // Sync form state when apiKey changes
  useEffect(() => {
    if (open) {
      setName(apiKey.name || '');
      setEnabled(apiKey.enabled);
      setRateLimitMax(apiKey.rateLimitMax || 100);
      setRateLimitTimeWindow(Math.round((apiKey.rateLimitTimeWindow || 60000) / 1000));
      setError(null);
    }
  }, [open, apiKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Please enter a name for the API key.');
      return;
    }

    if (rateLimitMax < 1) {
      setError('Rate limit must be at least 1 request.');
      return;
    }

    if (rateLimitTimeWindow < 1) {
      setError('Time window must be at least 1 second.');
      return;
    }

    try {
      await updateApiKey.mutateAsync({
        id: apiKey.id,
        data: {
          name: name.trim(),
          enabled,
          rateLimitMax,
          rateLimitTimeWindow: rateLimitTimeWindow * 1000,
        },
      });
      onClose();
    } catch (err: any) {
      reportSystemError({
        level: 'error',
        component: 'EditApiKeyDialog',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { context: 'update API key' },
      });
      setError(err?.message || 'Failed to update API key.');
    }
  };

  if (!open) return null;

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm py-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="mx-4 w-full max-w-lg rounded-xl border border-border bg-card shadow-xl"
      >
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-900/30">
              <Settings className="h-4 w-4 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground dark:text-white">
                Edit API Key
              </h2>
              <p className="text-xs text-muted-foreground">
                Update settings for &quot;{apiKey.name || 'Unnamed Key'}&quot;.
              </p>
            </div>
          </div>
          {isAgentKey && (
            <div className="mt-2 flex items-center gap-1.5 rounded-md border border-amber-300/40 bg-amber-50 px-3 py-1.5 dark:border-amber-500/20 dark:bg-amber-900/15">
              <Server className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="text-xs text-amber-700 dark:text-amber-400">
                Agent key — editing name and status is safe; rate limits affect agent behavior.
              </span>
            </div>
          )}
        </div>

        <div className="px-6 py-5">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Error display */}
            {error && (
              <div className="rounded-lg border border-rose-300/40 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-900/15 dark:text-rose-400">
                {error}
              </div>
            )}

            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground dark:text-zinc-100">Name *</label>
              <Input
                type="text"
                placeholder="e.g., Billing System Integration"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <p className="text-[11px] text-muted-foreground">A descriptive name to identify this API key.</p>
            </div>

            {/* Enabled toggle */}
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2/50 px-4 py-3 dark:bg-surface-2/30">
              <div>
                <span className="text-sm font-medium text-foreground dark:text-zinc-100">Enabled</span>
                <p className="text-[11px] text-muted-foreground">
                  Disabled keys will be rejected by the API.
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>

            {/* Rate Limit */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground dark:text-zinc-100">Rate Limit</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={10000}
                  value={rateLimitMax}
                  onChange={(e) => setRateLimitMax(Number(e.target.value))}
                  className="w-32"
                />
                <span className="text-sm text-muted-foreground">requests per</span>
                <Input
                  type="number"
                  min={1}
                  max={3600}
                  value={rateLimitTimeWindow}
                  onChange={(e) => setRateLimitTimeWindow(Number(e.target.value))}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">seconds</span>
              </div>
              <p className="text-[11px] text-muted-foreground">Maximum requests allowed in the given time window.</p>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 border-t border-border/50 pt-4">
              <Button variant="outline" size="sm" type="button" onClick={onClose}>Cancel</Button>
              <Button size="sm" type="submit" disabled={updateApiKey.isPending}>
                {updateApiKey.isPending ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
    </ModalPortal>
  );
}
