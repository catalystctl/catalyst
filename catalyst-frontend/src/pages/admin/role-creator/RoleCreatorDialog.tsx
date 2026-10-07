import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Shield, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/ui/dialog';
import { BracketLabel } from '@/components/deck/primitives';
import { useQuery } from '@/csync';
import { rolesApi } from '@/services/api/roles';
import { serversApi } from '@/services/api/servers';
import { useNodes } from '@/hooks/useNodes';
import { useServerPermissionOptions } from '@/lib/serverPermissions';
import type { Role, RoleScope } from '@/types/admin';
import { cn } from '@/lib/utils';

import { NodeAssignmentsSelector } from '@/components/admin/NodeAssignmentsSelector';
import type { NodeAssignmentWithExpiration } from '@/components/admin/NodeAssignmentsSelector';
import { RoleScopePicker, type AccessBoundary } from './RoleScopePicker';
import { RolePermissionGroups, type PermissionPresetOption } from './RolePermissionGroups';
import {
  PRESET_FILLS,
  buildPermissionGroups,
  groupPermissionValues,
  mergeSelection,
  partitionGroups,
  splitSelection,
} from './permissionGroups';
import { FALLBACK_PERMISSION_CATEGORIES } from './permissionCatalogFallback';
import { formatPermission, presetLabel } from './permissionLabels';
import { FALLBACK_SERVER_PERMISSIONS } from '@/lib/serverPermissions';
import { fillLabel } from './labels';

export interface RoleCreatorPayload {
  name: string;
  description?: string;
  permissions: string[];
  scope?: RoleScope;
}

/** Sentinel that marks "every node, now and later" in the scope payload. */
const ALL_NODES = '*';

/** Boundary → the scope mode the backend stores. */
function toScopeMode(boundary: AccessBoundary): 'none' | 'nodes' | 'servers' {
  if (boundary === 'panel') return 'none';
  if (boundary === 'servers') return 'servers';
  return 'nodes';
}

/**
 * The role editor.
 *
 * One screen, three decisions: what the role is called, where it applies, and
 * what members can do. The permission list is the panel's real catalog, split
 * into the two layers the backend actually stores — resource permissions that
 * live inside the access boundary, and panel-wide permissions that do not.
 */
export function RoleCreatorDialog({
  open,
  onOpenChange,
  role,
  presets = [],
  onSubmit,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Role being edited, or null/undefined to create a new one. */
  role?: Role | null;
  /** Backend permission presets (`GET /api/roles/presets`). */
  presets?: Array<{ key: string; label?: string; permissions: string[] }>;
  onSubmit: (payload: RoleCreatorPayload) => void;
  isPending?: boolean;
}) {
  const { t } = useTranslation('admin-access');
  const isEdit = Boolean(role);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [boundary, setBoundary] = useState<AccessBoundary>('panel');
  const [nodeIds, setNodeIds] = useState<string[]>([]);
  const [serverIds, setServerIds] = useState<string[]>([]);
  const [scopeSearch, setScopeSearch] = useState('');
  const [superAdmin, setSuperAdmin] = useState(false);
  // Node reachability (NodeAssignment rows). The selector owns its own API
  // calls, so this is a mirror of what it has already persisted.
  const [nodeAssignments, setNodeAssignments] = useState<NodeAssignmentWithExpiration[]>([]);
  // Which target the form has already been prefilled for. RolesPage passes the
  // list row first and the fetched detail second, so keying the prefill on the
  // role object identity would wipe whatever the user had typed in between.
  const hydratedFor = useRef<string | null>(null);
  // Which target the scope has been applied for. The roles list payload omits
  // `scope` — it only exists on the role detail (GET /api/roles/:id), so it can
  // arrive after the dialog opened and must be merged in without discarding
  // the edits made in the meantime.
  const scopeHydratedFor = useRef<string | null>(null);

  // ── Real catalog data ────────────────────────────────────────────────
  const { data: catalog } = useQuery({
    queryKey: ['role-permissions-catalog'],
    queryFn: rolesApi.getPermissionCatalog,
    staleTime: 10 * 60 * 1000,
    retry: 1,
    enabled: open,
  });
  // Fall back to the canonical list while the query settles, so the layer
  // split never renders a scopable permission as panel-wide.
  const { data: scopedValues = FALLBACK_SERVER_PERMISSIONS } = useServerPermissionOptions();
  const { data: nodes = [] } = useNodes();
  const { data: servers = [] } = useQuery({
    queryKey: ['admin-servers-for-scope'],
    queryFn: () => serversApi.list({ limit: 500 }),
    staleTime: 60 * 1000,
    enabled: open,
  });

  const categories = catalog?.length ? catalog : FALLBACK_PERMISSION_CATEGORIES;

  const groups = useMemo(
    () =>
      buildPermissionGroups(categories, scopedValues, (value, backendLabel) =>
        formatPermission(t, value, backendLabel),
      ),
    [categories, scopedValues, t],
  );
  const { resource: resourceGroups, global: globalGroups } = useMemo(
    () => partitionGroups(groups),
    [groups],
  );
  const resourceValues = useMemo(
    () => new Set(groupPermissionValues(resourceGroups)),
    [resourceGroups],
  );
  const allValues = useMemo(() => new Set(groupPermissionValues(groups)), [groups]);

  const scopeMode = toScopeMode(boundary);

  // ── Prefill ─────────────────────────────────────────────────────────
  // Runs once per target: a re-render with a new `role` object for the SAME
  // role (the detail arriving, or a list refetch) must not discard edits.
  useEffect(() => {
    if (!open) {
      hydratedFor.current = null;
      return;
    }
    const target = role?.id ?? null;
    if (hydratedFor.current === target) return;
    hydratedFor.current = target;

    setName(role?.name ?? '');
    setDescription(role?.description ?? '');
    const stored = role?.permissions ?? [];
    setSuperAdmin(stored.includes('*'));
    setSelected(mergeSelection(stored.filter((p) => p !== '*'), role?.scope?.permissions ?? []));
    const mode = role?.scope?.mode ?? 'none';
    if (mode === 'servers') {
      setBoundary('servers');
      setServerIds(role?.scope?.serverIds ?? []);
      setNodeIds([]);
    } else if (mode === 'nodes') {
      const ids = role?.scope?.nodeIds ?? [];
      setBoundary(ids.includes(ALL_NODES) ? 'all' : 'nodes');
      setNodeIds(ids.filter((id) => id !== ALL_NODES));
      setServerIds([]);
    } else {
      setBoundary('panel');
      setNodeIds([]);
      setServerIds([]);
    }
    setScopeSearch('');
    setNodeAssignments([]);
  }, [open, role]);

  // ── Late scope arrival ───────────────────────────────────────────────
  // The detail payload carries the stored scope; the list row does not. When
  // `role.scope` first appears for this target, restore only the scope-derived
  // fields so the boundary and scoped grants are correct without discarding
  // any name/description/permission edits made while the detail was loading.
  // Editing the scope before the detail arrives is overwritten — acceptable,
  // since the stored scope is the source of truth for an existing role.
  useEffect(() => {
    if (!open || !role?.id) {
      scopeHydratedFor.current = null;
      return;
    }
    if (scopeHydratedFor.current === role.id) return;
    if (role.scope === undefined) return; // still the list row — nothing to apply
    scopeHydratedFor.current = role.id;

    const scope = role.scope;
    const mode = scope.mode ?? 'none';
    if (mode === 'servers') {
      setBoundary('servers');
      setServerIds(scope.serverIds ?? []);
      setNodeIds([]);
    } else if (mode === 'nodes') {
      const ids = scope.nodeIds ?? [];
      setBoundary(ids.includes(ALL_NODES) ? 'all' : 'nodes');
      setNodeIds(ids.filter((id) => id !== ALL_NODES));
      setServerIds([]);
    } else {
      setBoundary('panel');
      setNodeIds([]);
      setServerIds([]);
    }
    // The scoped permissions live in the same chip selection as the global
    // ones, so they are merged in rather than replacing the user's selection.
    const scopedPermissions = scope.permissions ?? [];
    setSelected((prev) => new Set([...prev, ...scopedPermissions]));
  }, [open, role]);

  // ── Derived split & validity ────────────────────────────────────────
  const { global: globalSelected, scoped: scopedSelected } = useMemo(
    () => splitSelection(selected, resourceValues, scopeMode),
    [selected, resourceValues, scopeMode],
  );

  const scopeTargetValid =
    boundary === 'panel' ||
    boundary === 'all' ||
    (boundary === 'nodes' && nodeIds.length > 0) ||
    (boundary === 'servers' && serverIds.length > 0);

  const canSubmit =
    name.trim().length > 0 &&
    (superAdmin || selected.size > 0) &&
    scopeTargetValid &&
    (scopeMode === 'none' || scopedSelected.length > 0) &&
    !isPending;

  const togglePermission = (value: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
    setSuperAdmin(false);
  };

  const setGroup = (values: string[], select: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const value of values) {
        if (select) next.add(value);
        else next.delete(value);
      }
      return next;
    });
    setSuperAdmin(false);
  };

  /**
   * Apply a preset. The backend `administrator` preset is `['*']`, which has no
   * chip of its own — it is the super-admin switch — so it is routed there
   * instead of being filtered away into an empty selection.
   */
  const applyPreset = (permissions: string[]) => {
    const wildcard = permissions.includes('*');
    setSuperAdmin(wildcard);
    setSelected(new Set(permissions.filter((p) => p !== '*')));
  };

  /**
   * Super admin and an explicit selection are mutually exclusive. Turning the
   * switch off drops the wildcard so the role can actually be demoted; the
   * remaining concrete permissions (if any) are kept.
   */
  const toggleSuperAdmin = () => {
    setSuperAdmin((prev) => !prev);
    setSelected((prev) => {
      if (!prev.has('*')) return prev;
      const next = new Set(prev);
      next.delete('*');
      return next;
    });
  };

  const handleSubmit = () => {
    const permissions = superAdmin ? ['*'] : globalSelected;
    const scope: RoleScope | undefined = superAdmin
      ? { mode: 'none', permissions: [] }
      : scopeMode === 'none'
        ? { mode: 'none', permissions: [] }
        : {
            mode: scopeMode,
            ...(scopeMode === 'nodes'
              ? { nodeIds: boundary === 'all' ? [ALL_NODES] : nodeIds }
              : { serverIds }),
            permissions: scopedSelected,
          };
    onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      permissions,
      scope,
    });
  };

  const nodeOptions = useMemo(
    () =>
      (nodes as Array<{ id: string; name: string; hostname?: string }>).map((n) => ({
        id: n.id,
        name: n.name,
        hostname: n.hostname,
      })),
    [nodes],
  );

  const serverOptions = useMemo(
    () =>
      (servers as Array<{ id: string; name: string; primaryPort?: number; node?: { name?: string }; nodeName?: string }>).map(
        (s) => ({
          id: s.id,
          name: s.name,
          nodeName: s.node?.name ?? s.nodeName,
          primaryPort: s.primaryPort ?? null,
        }),
      ),
    [servers],
  );

  const boundaryBadge = {
    panel: t('roles.creator.boundary.panelTitle'),
    all: t('roles.creator.boundary.allTitle'),
    nodes: t('roles.creator.boundary.nodesTitle'),
    servers: t('roles.creator.boundary.serversTitle'),
  }[boundary];

  const boundarySummary = useMemo(() => {
    if (boundary === 'panel') return t('roles.creator.summary.boundaryPanel');
    if (boundary === 'all') return t('roles.creator.summary.boundaryAll');
    if (boundary === 'nodes') {
      if (nodeIds.length === 0) return t('roles.creator.summary.boundaryNone');
      const names = nodeOptions
        .filter((n) => nodeIds.includes(n.id))
        .map((n) => n.name)
        .slice(0, 3);
      return t('roles.creator.summary.boundaryNodes', {
        names: names.join(', '),
        count: nodeIds.length,
      });
    }
    if (serverIds.length === 0) return t('roles.creator.summary.boundaryNone');
    const names = serverOptions
      .filter((s) => serverIds.includes(s.id))
      .map((s) => s.name)
      .slice(0, 3);
    return t('roles.creator.summary.boundaryServers', {
      names: names.join(', '),
      count: serverIds.length,
    });
  }, [boundary, nodeIds, serverIds, nodeOptions, serverOptions, t]);

  const footerSummary = useMemo(() => {
    if (superAdmin) return t('roles.creator.summary.footerSuperAdmin');
    const parts: string[] = [boundaryBadge];
    parts.push(t('roles.creator.summary.footerCounts', { count: selected.size }));
    if (scopeMode !== 'none') {
      parts.push(t('roles.creator.summary.footerScoped', { count: scopedSelected.length }));
    }
    if (globalSelected.length > 0) {
      parts.push(t('roles.creator.summary.footerGlobal', { count: globalSelected.length }));
    }
    return parts.join(' · ');
  }, [superAdmin, boundaryBadge, selected.size, scopeMode, scopedSelected.length, globalSelected.length, t]);

  const scopedNames = useMemo(
    () => summarise(resourceGroups, selected),
    [resourceGroups, selected],
  );
  const globalNames = useMemo(
    () => summarise(globalGroups, selected),
    [globalGroups, selected],
  );

  // Prefer the backend presets; the local fills keep the toolbar useful when
  // the endpoint is unreachable.
  const presetOptions: PermissionPresetOption[] = useMemo(() => {
    if (presets.length > 0) {
      return presets.map((preset) => ({
        id: preset.key,
        label: presetLabel(t, preset.key, preset.label),
        permissions: preset.permissions ?? [],
      }));
    }
    return PRESET_FILLS.map((fill) => ({
      id: fill.id,
      label: fillLabel(t, fill.id),
      permissions: fill.permissions,
    }));
  }, [presets, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="full" className="sm:h-[min(90dvh,54rem)]">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('roles.editTitle') : t('roles.createTitle')}
          </DialogTitle>
          <DialogDescription>{t('roles.creator.subtitle')}</DialogDescription>
        </DialogHeader>

        <DialogBody className="min-h-0 p-0">
          <div className="grid min-h-0 grid-cols-1 lg:h-full lg:grid-cols-[minmax(0,1fr)_20rem]">
            {/* ── Editor ── */}
            <div className="min-w-0 space-y-3 overflow-y-auto p-4 lg:pr-5">
              {/* 1 — Role details */}
              <Section index={1} title={t('roles.roleDetails')} eyebrow={t('roles.creator.eyebrowIdentity')}>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1.35fr]">
                  <label className="block space-y-1.5">
                    <span className="text-micro font-medium text-muted-foreground">
                      {t('roles.nameLabel')} <span className="text-destructive">*</span>
                    </span>
                    <Input
                      value={name}
                      disabled={isPending}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t('roles.namePlaceholder')}
                      className="h-8 text-mini"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-micro font-medium text-muted-foreground">
                      {t('roles.descriptionLabel')}{' '}
                      <span className="text-muted-foreground/60">
                        ({t('roles.creator.optional')})
                      </span>
                    </span>
                    <Textarea
                      value={description}
                      disabled={isPending}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t('roles.descriptionPlaceholder')}
                      rows={2}
                      className="min-h-8 resize-none text-mini"
                    />
                  </label>
                </div>
              </Section>

              {/* 2 — Where this role applies */}
              <Section
                index={2}
                title={t('roles.creator.boundaryHeading')}
                eyebrow={t('roles.creator.eyebrowBoundary')}
              >
                <RoleScopePicker
                  boundary={boundary}
                  onBoundaryChange={setBoundary}
                  nodes={nodeOptions}
                  servers={serverOptions}
                  selectedNodeIds={nodeIds}
                  onToggleNode={(id) =>
                    setNodeIds((prev) =>
                      prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id],
                    )
                  }
                  selectedServerIds={serverIds}
                  onToggleServer={(id) =>
                    setServerIds((prev) =>
                      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
                    )
                  }
                  search={scopeSearch}
                  onSearchChange={setScopeSearch}
                  disabled={isPending}
                />

                {/* Node reachability — which nodes the role's members may see at
                    all. Separate from the boundary above, which only decides
                    where the resource permissions are granted. */}
                <div className="mt-3 border-t border-border/60 pt-3">
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-mini font-semibold text-foreground">
                      {t('roles.creator.nodeAccessHeading')}
                    </span>
                    <span className="text-micro text-muted-foreground">
                      {t('roles.creator.nodeAccessHint')}
                    </span>
                  </div>
                  {isEdit ? (
                    <NodeAssignmentsSelector
                      roleId={role?.id}
                      selectedNodes={nodeAssignments}
                      onSelectionChange={setNodeAssignments}
                      disabled={isPending}
                    />
                  ) : (
                    <p className="rounded-sm border border-border bg-surface-1/40 px-2.5 py-2 text-micro text-muted-foreground">
                      {t('roles.creator.nodeAccessCreateHint')}
                    </p>
                  )}
                </div>
              </Section>

              {/* 3 — What members can do */}
              <Section
                index={3}
                title={t('roles.creator.capabilitiesHeading')}
                eyebrow={t('roles.creator.eyebrowCapabilities')}
              >
                <div className="mb-3 flex items-start gap-2.5 rounded-sm border border-primary/25 bg-primary/5 px-2.5 py-2">
                  <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <p className="text-micro leading-relaxed text-muted-foreground">
                    {t('roles.creator.twoLayersNote')}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={isPending}
                  aria-pressed={superAdmin}
                  onClick={toggleSuperAdmin}
                  className={cn(
                    'mb-3 flex w-full items-center gap-3 rounded-sm border p-3 text-left transition-colors',
                    superAdmin
                      ? 'border-warning/40 bg-warning/5'
                      : 'border-border bg-card hover:border-warning/25',
                    isPending && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-warning/10">
                    <KeyRound className="h-4 w-4 text-warning" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-mini font-semibold text-warning">
                      {t('roles.wildcard')}
                    </span>
                    <span className="block text-micro text-muted-foreground">
                      {t('roles.wildcardDescription')}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                      superAdmin ? 'bg-warning' : 'bg-surface-3',
                    )}
                  >
                    <span
                      className={cn(
                        'h-4 w-4 rounded-full bg-card transition-transform',
                        superAdmin ? 'translate-x-4' : 'translate-x-0.5',
                      )}
                    />
                  </span>
                </button>

                {superAdmin ? (
                  <div className="rounded-sm border border-warning/30 bg-warning/5 px-3 py-2 text-micro text-muted-foreground">
                    {t('roles.creator.superAdminNote')}
                  </div>
                ) : (
                  <RolePermissionGroups
                    resourceGroups={resourceGroups}
                    globalGroups={globalGroups}
                    selected={selected}
                    onTogglePermission={togglePermission}
                    onSetGroup={setGroup}
                    onApplyPreset={applyPreset}
                    presets={presetOptions}
                    available={allValues}
                    disabled={isPending}
                    scopeActive={scopeMode !== 'none'}
                  />
                )}
              </Section>
            </div>

            {/* ── Effective access ── */}
            <aside className="min-w-0 space-y-3 overflow-y-auto border-t border-border/70 bg-surface-1/40 p-4 lg:border-l lg:border-t-0">
              <BracketLabel tone="muted">{t('roles.creator.effectiveAccess')}</BracketLabel>

              <div className="overflow-hidden rounded-sm border border-border bg-card">
                <div className="border-b border-border/70 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    {superAdmin ? (
                      <KeyRound className="h-3.5 w-3.5 shrink-0 text-warning" />
                    ) : (
                      <Shield className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                    <span className="truncate text-data font-semibold text-foreground">
                      {name.trim() || t('roles.creator.untitled')}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-micro text-muted-foreground">
                    {description.trim() || t('roles.creator.noDescription')}
                  </p>
                </div>

                <div className="border-b border-border/70 px-3 py-2.5">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="type-overline text-muted-foreground">
                      {t('roles.creator.appliesTo')}
                    </span>
                    <Badge variant="outline" className="text-micro text-primary">
                      {boundaryBadge}
                    </Badge>
                  </div>
                  <p className="text-micro leading-relaxed text-foreground">{boundarySummary}</p>
                </div>

                <div className="border-b border-border/70 px-3 py-2.5">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="type-overline text-muted-foreground">
                      {t('roles.creator.resourceSection')}
                    </span>
                    <Badge variant="secondary" className="text-micro">
                      {scopeMode === 'none'
                        ? t('roles.creator.badgeGlobal')
                        : t('roles.creator.badgeScoped')}
                    </Badge>
                  </div>
                  <SummaryList
                    names={scopedNames}
                    empty={t('roles.creator.noneSelected')}
                    moreLabel={(count) => t('roles.creator.moreCount', { count })}
                  />
                </div>

                <div className="px-3 py-2.5">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="type-overline text-muted-foreground">
                      {t('roles.creator.globalSection')}
                    </span>
                    <Badge variant="secondary" className="text-micro">
                      {t('roles.creator.badgePanelWide')}
                    </Badge>
                  </div>
                  <SummaryList
                    names={globalNames}
                    empty={t('roles.creator.noneSelected')}
                    moreLabel={(count) => t('roles.creator.moreCount', { count })}
                  />
                </div>
              </div>

              <p className="rounded-sm border border-warning/25 bg-warning/5 px-2.5 py-2 text-micro leading-relaxed text-muted-foreground">
                {scopeMode === 'none'
                  ? t('roles.creator.riskNoBoundary')
                  : t('roles.creator.riskBoundary')}
              </p>
            </aside>
          </div>
        </DialogBody>

        <DialogFooter className="sm:justify-between">
          <span className="text-micro text-muted-foreground">{footerSummary}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
              {isPending
                ? t('saving')
                : isEdit
                  ? t('roles.saveChanges')
                  : t('roles.createTitle')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Numbered, titled section — the editor's spine. */
function Section({
  index,
  title,
  eyebrow,
  children,
}: {
  index: number;
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-sm border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-border text-micro font-semibold text-muted-foreground">
            {index}
          </span>
          <span className="truncate text-mini font-semibold text-foreground">{title}</span>
        </div>
        <span className="shrink-0 text-micro uppercase tracking-wider text-muted-foreground/70">
          {eyebrow}
        </span>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

/** First few selected labels plus a "+N more" line, so the aside stays short. */
function summarise(groups: { permissions: { value: string; label: string }[] }[], selected: Set<string>) {
  return groups.flatMap((g) => g.permissions.filter((p) => selected.has(p.value)).map((p) => p.label));
}

function SummaryList({
  names,
  empty,
  moreLabel,
  limit = 5,
}: {
  names: string[];
  empty: string;
  moreLabel: (count: number) => string;
  limit?: number;
}) {
  if (names.length === 0) {
    return <p className="text-micro italic text-muted-foreground/70">{empty}</p>;
  }
  return (
    <ul className="space-y-1">
      {names.slice(0, limit).map((label) => (
        <li key={label} className="flex items-start gap-1.5 text-micro leading-snug text-muted-foreground">
          <span aria-hidden className="mt-1 h-1 w-1 shrink-0 rounded-full bg-primary" />
          <span className="min-w-0">{label}</span>
        </li>
      ))}
      {names.length > limit && (
        <li className="pl-2.5 text-micro text-muted-foreground/70">
          {moreLabel(names.length - limit)}
        </li>
      )}
    </ul>
  );
}
