import { Link, useLocation } from 'react-router-dom';
import { buildGroups, buildMain } from './navSections';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Ticket, Plug } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { useAuthStore } from '../../stores/authStore';
import { hasAnyPermission } from '../auth/ProtectedRoute';
import { usePluginTabs } from '../../plugins/hooks';

/**
 * Sections popover — every destination that does not fit on the 56px rail.
 * Keeps full navigability (and RBAC filtering) after the sidebar became a rail.
 */
export default function NavSectionsMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('layout');
  const user = useAuthStore((s) => s.user);
  const pluginTabs = usePluginTabs('admin');
  const { pathname } = useLocation();
  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`);

  const groups = useMemo(() => {
    const permissions = user?.permissions ?? [];
    const base = buildGroups(t)
      .map((group) => ({
        ...group,
        links: group.links.filter((link) => hasAnyPermission(permissions, link.permissions)),
      }))
      .filter((group) => group.links.length > 0);

    if (pluginTabs.length > 0 && hasAnyPermission(permissions, ['admin.read', 'admin.write'])) {
      base.push({
        id: 'plugins',
        title: t('sections.plugins'),
        links: pluginTabs.map((tab) => ({
          to: `/admin/plugin/${tab.id}`,
          label: tab.label,
          icon: tab.id.includes('ticket') ? Ticket : Plug,
          permissions: tab.requiredPermissions?.length ? tab.requiredPermissions : ['admin.read', 'admin.write'],
        })),
      });
    }
    return base;
  }, [t, user?.permissions, pluginTabs]);

  const main = buildMain(t);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{t('shell.sections')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-5 pb-5">
          <div className="flex flex-wrap gap-1.5">
            {main.map((link) => {
              const active = isActive(link.to);
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={() => onOpenChange(false)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex h-7 items-center gap-1.5 rounded-sm border px-2.5 type-overline transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${active ? 'border-primary/40 bg-surface-2 text-foreground' : 'border-border/60 text-muted-foreground'}`}
                >
                  <link.icon className="h-3.5 w-3.5" />
                  {link.label}
                </Link>
              );
            })}
          </div>

          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <div key={group.id}>
                <span className="deck-label mb-1.5">{group.title}</span>
                <div className="flex flex-col">
                  {group.links.map((link) => {
                    const active = isActive(link.to);
                    return (
                      <Link
                        key={link.to}
                        to={link.to}
                        onClick={() => onOpenChange(false)}
                        aria-current={active ? 'page' : undefined}
                        className={`flex min-h-7 items-center gap-2 rounded-sm px-1.5 py-1.5 text-data transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${active ? 'bg-surface-2 text-foreground' : 'text-muted-foreground'}`}
                      >
                        <link.icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                        <span className="truncate">{link.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
