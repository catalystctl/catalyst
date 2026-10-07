import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { PermissionGroup } from './permissionGroups';
import { groupTitle } from './labels';

/** A one-click permission bundle offered above the groups. */
export interface PermissionPresetOption {
  id: string;
  label: string;
  permissions: string[];
}

/**
 * "What members can do" — every permission the panel exposes, grouped by the
 * layer it is stored in.
 *
 * Resource groups are the values the backend accepts inside an access
 * boundary; panel-wide groups are always global. The heading above each
 * section states that, so a chip's reach is never ambiguous.
 */
export function RolePermissionGroups({
  resourceGroups,
  globalGroups,
  selected,
  onTogglePermission,
  onSetGroup,
  onApplyPreset,
  presets,
  available,
  disabled,
  scopeActive,
}: {
  resourceGroups: PermissionGroup[];
  globalGroups: PermissionGroup[];
  selected: ReadonlySet<string>;
  onTogglePermission: (value: string) => void;
  onSetGroup: (values: string[], select: boolean) => void;
  onApplyPreset: (permissions: string[]) => void;
  presets: PermissionPresetOption[];
  available: ReadonlySet<string>;
  disabled?: boolean;
  /** True when a node/server boundary is set, so resource chips are scoped. */
  scopeActive: boolean;
}) {
  const { t } = useTranslation('admin-access');
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();

  // Filtering is per group so a group whose chips all filtered out disappears
  // entirely rather than leaving an empty card behind.
  const visible = useMemo(() => {
    const match = (group: PermissionGroup): PermissionGroup => ({
      ...group,
      permissions: group.permissions.filter(
        (p) =>
          !needle ||
          p.label.toLowerCase().includes(needle) ||
          p.value.toLowerCase().includes(needle),
      ),
    });
    return {
      resource: resourceGroups.map(match).filter((g) => g.permissions.length > 0),
      global: globalGroups.map(match).filter((g) => g.permissions.length > 0),
    };
  }, [resourceGroups, globalGroups, needle]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-micro text-muted-foreground">
            {t('roles.creator.selectedCount', { count: selected.size })}
          </span>
          <label className="relative flex w-full items-center sm:w-52">
            <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              disabled={disabled}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('roles.creator.searchPermissions')}
              className="h-7 pl-7 text-micro"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              onClick={() =>
                // '*' is not a chip, so it is absent from `available`; keep it
                // and let the dialog route it to the super-admin switch.
                onApplyPreset(preset.permissions.filter((p) => p === '*' || available.has(p)))
              }
              className="rounded-sm border border-border bg-card px-2 py-1 text-micro text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            disabled={disabled || selected.size === 0}
            onClick={() => onApplyPreset([])}
            className="rounded-sm border border-border bg-card px-2 py-1 text-micro text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('roles.creator.presets.clear')}
          </button>
        </div>
      </div>

      <PermissionSection
        testId="resource"
        title={t('roles.creator.resourceSection')}
        hint={
          scopeActive
            ? t('roles.creator.resourceSectionScoped')
            : t('roles.creator.resourceSectionGlobal')
        }
        groups={visible.resource}
        selected={selected}
        onTogglePermission={onTogglePermission}
        onSetGroup={onSetGroup}
        disabled={disabled}
      />

      <PermissionSection
        testId="global"
        title={t('roles.creator.globalSection')}
        hint={t('roles.creator.globalSectionHint')}
        groups={visible.global}
        selected={selected}
        onTogglePermission={onTogglePermission}
        onSetGroup={onSetGroup}
        disabled={disabled}
      />

      {visible.resource.length === 0 && visible.global.length === 0 && (
        <div className="rounded-sm border border-border bg-card px-3 py-6 text-center text-micro text-muted-foreground">
          {t('roles.creator.noPermissionsMatch')}
        </div>
      )}
    </div>
  );
}

function PermissionSection({
  testId,
  title,
  hint,
  groups,
  selected,
  onTogglePermission,
  onSetGroup,
  disabled,
}: {
  testId: string;
  title: string;
  hint: string;
  groups: PermissionGroup[];
  selected: ReadonlySet<string>;
  onTogglePermission: (value: string) => void;
  onSetGroup: (values: string[], select: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('admin-access');
  if (groups.length === 0) return null;

  return (
    <div className="space-y-2" data-testid={`permission-section-${testId}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="type-overline text-foreground">{title}</span>
        <span className="text-micro text-muted-foreground">{hint}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {groups.map((group) => {
          const values = group.permissions.map((p) => p.value);
          const onCount = values.filter((v) => selected.has(v)).length;
          const allOn = onCount === values.length && values.length > 0;

          return (
            <div key={group.id} className="overflow-hidden rounded-sm border border-border bg-card">
              <div className="flex items-center justify-between gap-2 border-b border-border/70 px-2.5 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-mini font-semibold text-foreground">
                    {groupTitle(t, group.id)}
                  </span>
                  <span className="shrink-0 tabular-nums text-micro text-muted-foreground">
                    {t('roles.creator.groupCount', { on: onCount, total: values.length })}
                  </span>
                </div>
                <Switch
                  checked={allOn}
                  disabled={disabled}
                  onCheckedChange={() => onSetGroup(values, !allOn)}
                  aria-label={t('roles.creator.toggleGroup', { group: groupTitle(t, group.id) })}
                  className="h-4 w-7 shrink-0 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3"
                />
              </div>
              <div className="flex flex-wrap gap-1 p-2">
                {group.permissions.map((permission) => {
                  const on = selected.has(permission.value);
                  return (
                    <button
                      key={permission.value}
                      type="button"
                      disabled={disabled}
                      aria-pressed={on}
                      title={permission.value}
                      onClick={() => onTogglePermission(permission.value)}
                      className={cn(
                        'rounded-sm border px-2 py-1 text-micro transition-colors',
                        on
                          ? 'border-primary/45 bg-primary/10 text-foreground'
                          : 'border-border bg-surface-1/40 text-muted-foreground hover:border-primary/25 hover:text-foreground',
                        disabled && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      {permission.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
