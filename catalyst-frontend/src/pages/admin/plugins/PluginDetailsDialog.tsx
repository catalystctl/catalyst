import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import {
  AlertTriangle,
  Boxes,
  Cable,
  CalendarClock,
  Database,
  Globe,
  Loader2,
  MessageSquare,
  Puzzle,
  Settings2,
  Users,
} from 'lucide-react';

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { fetchPluginDetails, updatePluginPermissions } from '../../../plugins/api';
import { toast } from 'sonner';
import { permissionLabel } from './permissionMeta';
import type { PluginDetails } from '../../../plugins/types';

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm text-foreground">{value}</span>
    </div>
  );
}

function CapabilitySection({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/70">
        <Icon className="h-3.5 w-3.5" />
        {title}
        <Badge variant="secondary" className="ml-0.5 text-[10px]">
          {count}
        </Badge>
      </p>
      {children}
    </div>
  );
}

/**
 * Full plugin detail view: identity overview, per-permission grant controls,
 * and the complete capability inventory (routes/tasks/events/WS/RPC).
 */
export function PluginDetailsDialog({
  pluginName,
  open,
  onOpenChange,
}: {
  pluginName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: qk.adminPlugin(pluginName),
    queryFn: () => fetchPluginDetails(pluginName),
    enabled: open,
    staleTime: 30_000,
  });

  const details = data as PluginDetails | undefined;
  const declared = details?.declaredPermissions ?? [];
  const effectiveGranted = details?.grantedPermissions ?? declared;

  // Draft of permission toggles — synced whenever fresh details arrive or the
  // dialog reopens so unsaved edits never leak across plugins.
  const [draftGrants, setDraftGrants] = useState<string[]>(effectiveGranted);
  const [draftKey, setDraftKey] = useState('');
  const syncKey = `${pluginName}:${open ? 'open' : 'closed'}:${declared.join(',')}:${effectiveGranted.join(',')}`;
  useEffect(() => {
    if (syncKey !== draftKey) {
      setDraftKey(syncKey);
      setDraftGrants(effectiveGranted);
    }
  }, [syncKey, draftKey, effectiveGranted]);

  const dirty =
    declared.length > 0 &&
    (draftGrants.length !== effectiveGranted.length ||
      draftGrants.some((g) => !effectiveGranted.includes(g)));

  const saveMutation = useMutation({
    mutationFn: (granted: string[]) => updatePluginPermissions(pluginName, granted),
    onSuccess: () => {
      toast.success('Plugin permissions updated — revocations apply immediately');
      queryClient.invalidateQueries({ queryKey: qk.adminPlugins() });
      queryClient.invalidateQueries({ queryKey: qk.adminPlugin(pluginName) });
    },
    onError: (error: any) => toast.error(error.message || 'Failed to update permissions'),
  });

  const toggle = (perm: string, next: boolean) => {
    setDraftGrants((prev) =>
      next ? (prev.includes(perm) ? prev : [...prev, perm]) : prev.filter((p) => p !== perm),
    );
  };

  const capabilities = details?.capabilities;
  const summaryByToken = useMemo(
    () => new Map((details?.permissionSummaries ?? []).map((s) => [s.token, s])),
    [details?.permissionSummaries],
  );
  const hasAnyCapability =
    !!capabilities &&
    (capabilities.routes.length > 0 ||
      capabilities.tasks.length > 0 ||
      capabilities.wsHandlers.length > 0 ||
      Object.keys(capabilities.events ?? {}).length > 0 ||
      capabilities.exposedApis.length > 0);

  const statusText = useMemo(() => {
    switch (details?.status) {
      case 'enabled':
        return { text: 'Enabled', variant: 'outline' as const };
      case 'error':
        return { text: 'Error', variant: 'destructive' as const };
      case 'disabled':
        return { text: 'Disabled', variant: 'secondary' as const };
      case 'loaded':
        return { text: 'Loaded', variant: 'secondary' as const };
      default:
        return { text: details?.status ?? '—', variant: 'secondary' as const };
    }
  }, [details?.status]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="plugin-details">
        <DialogHeader icon={<Puzzle className="h-4 w-4" />}>
          <DialogTitle>{details?.displayName ?? pluginName}</DialogTitle>
          <DialogDescription>
            {details?.author || 'Unknown author'} · v{details?.version ?? '?'} ·{' '}
            {details?.name}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="permissions">Permissions</TabsTrigger>
                <TabsTrigger value="capabilities">Capabilities</TabsTrigger>
              </TabsList>

              {/* ── Overview ── */}
              <TabsContent value="overview" className="space-y-4 pt-4">
                {details?.legacyAcceptance && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      This plugin was grandfathered from before safety disclaimers existed.
                      Review its permissions below and revoke anything you don't recognize.
                    </AlertDescription>
                  </Alert>
                )}
                {details?.error && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{details.error}</AlertDescription>
                  </Alert>
                )}
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {details?.description || 'No description provided.'}
                </p>
                <div className="divide-y divide-border/40 rounded-lg border border-border/60 bg-surface-2/20 px-4 py-1">
                  <MetaRow label="Status" value={<Badge variant={statusText.variant}>{statusText.text}</Badge>} />
                  <MetaRow label="Version" value={details?.version} />
                  <MetaRow label="Requires Catalyst" value={details?.catalystVersion ?? '—'} />
                  <MetaRow
                    label="Frontend / Backend"
                    value={`${details?.hasFrontend ? 'UI' : 'No UI'} · ${details?.hasBackend ? 'API' : 'No API'}`}
                  />
                  <MetaRow
                    label="Installed"
                    value={details?.loadedAt ? new Date(details.loadedAt).toLocaleString() : '—'}
                  />
                  <MetaRow
                    label="Safety accepted"
                    value={
                      details?.safetyAcceptedAt
                        ? `${new Date(details.safetyAcceptedAt).toLocaleString()}${details.legacyAcceptance ? ' (legacy)' : ''}`
                        : 'Not yet'
                    }
                  />
                </div>
                {(details?.dependencies?.length ?? 0) > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/70">
                      Depends on
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {(details?.dependencies ?? []).map((dep) => (
                        <Badge key={dep as string} variant="outline">
                          {String(dep)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* ── Permissions ── */}
              <TabsContent value="permissions" className="space-y-4 pt-4">
                <Alert>
                  <Settings2 className="h-4 w-4" />
                  <AlertDescription>
                    Revoking a permission stops the plugin's access to that data immediately — no
                    restart needed. Mounted routes, scheduled tasks and event listeners stay until
                    you disable the plugin.
                  </AlertDescription>
                </Alert>

                {declared.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/50 bg-surface-2/20 px-6 py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      This plugin declares no data permissions. It can still run code and serve
                      routes under <code className="font-mono text-xs">/api/plugins/{pluginName}/</code>.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/40 rounded-lg border border-border/60">
                    {declared.map((perm) => {
                      const isGranted = draftGrants.includes(perm);
                      const summary = summaryByToken.get(perm);
                      return (
                        <label
                          key={perm}
                          className="flex cursor-pointer items-start justify-between gap-4 px-4 py-3"
                        >
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-foreground">
                                {summary?.label ?? permissionLabel(perm)}
                              </span>
                              {!isGranted && (
                                <Badge variant="secondary" className="text-[10px]">
                                  Revoked
                                </Badge>
                              )}
                            </span>
                            {summary && (
                              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                                {summary.description}
                              </span>
                            )}
                            <code className="mt-0.5 block font-mono text-[11px] text-muted-foreground/70">
                              {perm}
                            </code>
                          </span>
                          <Switch
                            checked={isGranted}
                            onCheckedChange={(v) => toggle(perm, v === true)}
                            aria-label={`Toggle ${perm}`}
                          />
                        </label>
                      );
                    })}
                  </div>
                )}

                {declared.length > 0 && (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      {draftGrants.length}/{declared.length} permissions granted
                    </p>
                    <Button
                      size="sm"
                      disabled={!dirty || saveMutation.isPending}
                      onClick={() => saveMutation.mutate(draftGrants)}
                      data-testid="plugin-permissions-save"
                    >
                      {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Save permissions
                    </Button>
                  </div>
                )}
              </TabsContent>

              {/* ── Capabilities ── */}
              <TabsContent value="capabilities" className="space-y-5 pt-4">
                {!hasAnyCapability ? (
                  <TabEmpty />
                ) : (
                  <>
                    <CapabilitySection icon={Globe} title="API routes" count={capabilities!.routes.length}>
                      <ul className="space-y-1">
                        {capabilities!.routes.map((r) => (
                          <li key={`${r.method}:${r.url}`} className="flex items-center gap-2">
                            <Badge variant="secondary" className="w-16 justify-center font-mono text-[10px]">
                              {r.method}
                            </Badge>
                            <code className="truncate font-mono text-xs text-foreground">{r.url}</code>
                          </li>
                        ))}
                      </ul>
                    </CapabilitySection>

                    <CapabilitySection icon={CalendarClock} title="Scheduled tasks" count={capabilities!.tasks.length}>
                      <ul className="space-y-1">
                        {capabilities!.tasks.map((t, i) => (
                          <li key={`${t.cron}-${i}`} className="flex items-center gap-2 text-sm text-foreground">
                            <Cable className="h-3 w-3 text-muted-foreground" aria-hidden />
                            <code className="font-mono text-xs">{t.cron}</code>
                          </li>
                        ))}
                      </ul>
                    </CapabilitySection>

                    <CapabilitySection icon={MessageSquare} title="WebSocket handlers" count={capabilities!.wsHandlers.length}>
                      <ul className="flex flex-wrap gap-1.5">
                        {capabilities!.wsHandlers.map((h) => (
                          <li key={h}>
                            <Badge variant="outline" className="font-mono text-[11px]">
                              plugin:{pluginName}:{h}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </CapabilitySection>

                    <CapabilitySection
                      icon={Boxes}
                      title="Declared events"
                      count={Object.keys(capabilities!.events ?? {}).length}
                    >
                      <ul className="space-y-1">
                        {Object.entries(capabilities!.events ?? {}).map(([evt, schema]) => (
                          <li key={evt} className="text-sm">
                            <code className="font-mono text-xs text-foreground">{evt}</code>
                            {'description' in (schema as any) && (schema as any).description && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {(schema as any).description}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </CapabilitySection>

                    <CapabilitySection icon={Users} title="Exposed RPC APIs" count={capabilities!.exposedApis.length}>
                      <ul className="flex flex-wrap gap-1.5">
                        {capabilities!.exposedApis.map((api) => (
                          <li key={api}>
                            <Badge variant="outline" className="font-mono text-[11px]">
                              {api}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </CapabilitySection>
                  </>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TabEmpty() {
  return (
    <div className="rounded-lg border border-dashed border-border/50 bg-surface-2/20 px-6 py-8 text-center">
      <Database className="mx-auto mb-2 h-5 w-5 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">
        No routes, tasks, events or RPC APIs registered by this plugin.
      </p>
    </div>
  );
}
