import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, Server, Loader2 } from 'lucide-react';
import { useUpdateApiKey } from '../../hooks/useApiKeys';
import { type ApiKey } from '../../services/apiKeys';
import { describeError } from '../../utils/errors';
import { getLocalizedErrorMessage } from '../../i18n/api-errors';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { BracketLabel } from '@/components/deck/primitives';
import { FormSection } from '@/components/ui/form-section';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { reportSystemError } from '../../services/api/systemErrors';
import { formatDateTime } from '@/i18n/format';

interface EditApiKeyDialogProps {
  apiKey: ApiKey;
  open: boolean;
  onClose: () => void;
}

export function EditApiKeyDialog({ apiKey, open, onClose }: EditApiKeyDialogProps) {
  const { t } = useTranslation('profile');
  const updateApiKey = useUpdateApiKey();

  const [name, setName] = useState(apiKey.name || '');
  const [enabled, setEnabled] = useState(apiKey.enabled);
  const [rateLimitMax, setRateLimitMax] = useState(apiKey.rateLimitMax || 100);
  const [rateLimitTimeWindow, setRateLimitTimeWindow] = useState(
    Math.round((apiKey.rateLimitTimeWindow || 60000) / 1000),
  );
  const [error, setError] = useState<string | null>(null);

  const isAgentKey = apiKey.metadata?.purpose === 'agent';

  // Reset form state during render when the dialog is re-opened or the
  // selected API key changes. This is the React 19 idiomatic replacement
  // for the setState-in-useEffect anti-pattern flagged by react-hooks.
  const [prevSyncKey, setPrevSyncKey] = useState({ open, apiKey });
  if (open !== prevSyncKey.open || apiKey !== prevSyncKey.apiKey) {
    setPrevSyncKey({ open, apiKey });
    if (open) {
      setName(apiKey.name || '');
      setEnabled(apiKey.enabled);
      setRateLimitMax(apiKey.rateLimitMax || 100);
      setRateLimitTimeWindow(Math.round((apiKey.rateLimitTimeWindow || 60000) / 1000));
      setError(null);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError(t('apiKeys.editDialog.nameRequired'));
      return;
    }

    if (rateLimitMax < 1) {
      setError(t('apiKeys.editDialog.rateLimitRequired'));
      return;
    }

    if (rateLimitTimeWindow < 1) {
      setError(t('apiKeys.editDialog.timeWindowRequired'));
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
        message: describeError(err),
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { context: 'update API key' },
      });
      setError(getLocalizedErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="full" className="sm:h-[min(90dvh,54rem)]">
        <DialogHeader icon={<Settings className="h-4 w-4" />}>
          <DialogTitle>{t('apiKeys.editDialog.title')}</DialogTitle>
          <DialogDescription>{t('apiKeys.editDialog.description', { name: apiKey.name || t('unnamedKey') })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="min-h-0 p-0">
            <div className="grid min-h-0 grid-cols-1 lg:h-full lg:grid-cols-[minmax(0,1fr)_18rem]">
              {/* ── Editor ── */}
              <div className="min-w-0 space-y-3 overflow-y-auto p-4 lg:pr-5">
                {isAgentKey && (
                  <div className="flex items-center gap-1.5 rounded-sm border border-warning/30 bg-warning/5 px-2.5 py-1.5 dark:border-warning/20 dark:bg-warning/15">
                    <Server className="h-3.5 w-3.5 shrink-0 text-warning dark:text-warning" />
                    <span className="text-mini text-warning dark:text-warning">
                      {t('apiKeys.editDialog.agentNotice')}
                    </span>
                  </div>
                )}

                {error && (
                  <div className="rounded-sm border border-danger/40 bg-danger/5 px-2.5 py-2 text-mini text-danger dark:border-danger/20 dark:bg-danger/15 dark:text-danger">
                    {error}
                  </div>
                )}

                {/* 1 — Identity */}
                <FormSection index={1} title={t('apiKeys.form.name')}>
                  <div className="space-y-1.5">
                    <label className="type-overline">{t('apiKeys.form.name')}</label>
                    <Input
                      type="text"
                      className="h-8 rounded-sm border-border/60 bg-background/40 px-2.5 text-mini"
                      placeholder={t('apiKeys.form.namePlaceholder')}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                    <p className="type-meta">{t('apiKeys.form.nameHint')}</p>
                  </div>
                </FormSection>

                {/* 2 — Status */}
                <FormSection index={2} title={t('common:actions.enabled')}>
                  <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 px-3 py-2">
                    <div>
                      <span className="text-mini font-semibold text-foreground dark:text-foreground">{t('common:actions.enabled')}</span>
                      <p className="type-meta">
                        {t('apiKeys.editDialog.disabledHint')}
                      </p>
                    </div>
                    <Switch
                      checked={enabled}
                      onCheckedChange={setEnabled}
                    />
                  </div>
                </FormSection>

                {/* 3 — Rate limit */}
                <FormSection index={3} title={t('apiKeys.form.rateLimit')}>
                  <div className="space-y-1.5">
                    <label className="type-overline">{t('apiKeys.form.rateLimit')}</label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        max={10000}
                        value={rateLimitMax}
                        onChange={(e) => setRateLimitMax(Number(e.target.value))}
                        className="h-8 w-32 rounded-sm border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums"
                      />
                      <span className="text-mini text-muted-foreground">{t('apiKeys.editDialog.requestsPer')}</span>
                      <Input
                        type="number"
                        min={1}
                        max={3600}
                        value={rateLimitTimeWindow}
                        onChange={(e) => setRateLimitTimeWindow(Number(e.target.value))}
                        className="h-8 w-24 rounded-sm border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums"
                      />
                      <span className="text-mini text-muted-foreground">{t('apiKeys.editDialog.seconds')}</span>
                    </div>
                    <p className="type-meta">{t('apiKeys.editDialog.rateLimitHint')}</p>
                  </div>
                </FormSection>

                {/* 4 — Permissions (read-only) */}
                <FormSection index={4} title={t('apiKeys.form.permissions')}>
                  <div className="rounded-sm border border-border/50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="type-overline">{t('apiKeys.form.permissions')}</span>
                      <span className="type-overline">{t('apiKeys.editDialog.readOnly')}</span>
                    </div>
                    <p className="type-meta mt-1">
                      {t('apiKeys.editDialog.permissionsFixed')}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {apiKey.allPermissions ? (
                        <span className="rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-micro tabular-nums text-foreground">{t('allPermissions')}</span>
                      ) : apiKey.permissions?.length ? (
                        apiKey.permissions.map((p) => (
                          <span key={p} className="rounded-sm border border-border/50 px-1.5 py-0.5 font-mono text-micro tabular-nums text-muted-foreground">{p}</span>
                        ))
                      ) : (
                        <span className="type-meta">{t('apiKeys.editDialog.noPermissions')}</span>
                      )}
                    </div>
                    {apiKey.expiresAt && (
                      <p className="type-meta mt-2">{t('apiKeys.editDialog.expires', { date: formatDateTime(apiKey.expiresAt) })}</p>
                    )}
                  </div>
                </FormSection>
              </div>

              {/* ── Live summary ── */}
              <aside className="min-w-0 space-y-3 overflow-y-auto border-t border-border/70 bg-surface-1/40 p-4 lg:border-l lg:border-t-0">
                <BracketLabel tone="muted">{t('apiKeys.overview')}</BracketLabel>

                <div className="overflow-hidden rounded-sm border border-border bg-card">
                  <div className="border-b border-border/70 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Settings className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="truncate text-data font-semibold text-foreground">
                        {apiKey.name || t('unnamedKey')}
                      </span>
                    </div>
                  </div>

                  <SummaryRow label={t('common:actions.enabled')}>
                    <Badge variant="outline" className={enabled ? 'text-micro text-success' : 'text-micro text-muted-foreground'}>
                      {enabled ? t('apiKeys.active') : t('apiKeys.filters.disabled')}
                    </Badge>
                  </SummaryRow>

                  <SummaryRow label={t('apiKeys.form.rateLimit')}>
                    {t('apiKeys.row.rateLimit', { max: rateLimitMax, window: rateLimitTimeWindow })}
                  </SummaryRow>

                  <SummaryRow label={t('apiKeys.form.permissions')}>
                    {apiKey.allPermissions
                      ? t('allPermissions')
                      : apiKey.permissions?.length
                        ? t('apiKeysCard.permissionCount', { count: apiKey.permissions.length })
                        : t('apiKeys.editDialog.noPermissions')}
                  </SummaryRow>

                  <SummaryRow label={t('apiKeys.form.expiration')}>
                    {apiKey.expiresAt ? formatDateTime(apiKey.expiresAt) : t('apiKeys.expiration.never')}
                  </SummaryRow>
                </div>
              </aside>
            </div>
          </DialogBody>
          <DialogFooter className="sm:justify-between">
            <Button variant="outline" size="sm" type="button" className="h-8 px-3 text-mini" onClick={onClose}>{t('common:actions.cancel')}</Button>
            <Button size="sm" type="submit" className="h-8 px-3 text-mini" disabled={updateApiKey.isPending}>
              {updateApiKey.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  {t('apiKeys.editDialog.saving')}
                </>
              ) : (
                t('apiKeys.editDialog.save')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One label/value line in the aside summary card. */
function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border/70 px-3 py-2.5 last:border-b-0">
      <span className="type-overline text-muted-foreground">{label}</span>
      <p className="mt-1 text-micro leading-relaxed text-foreground">{children}</p>
    </div>
  );
}
