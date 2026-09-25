import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  LayoutDashboard,
  Server,
  Ticket,
  BarChart3,
  Network,
  FileText,
  Users,
  Shield,
  Key,
  Database,
  Settings,
  Lock,
  ArrowRightLeft,
  Bell,
  Activity,
  Bug,
  Plug,
  Palette,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { useAuthStore } from '../../stores/authStore';
import { hasAnyPermission } from '../auth/ProtectedRoute';
import { usePluginTabs } from '../../plugins/hooks';

interface NavLinkItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permissions?: string[];
}

interface NavGroup {
  id: string;
  title: string;
  links: NavLinkItem[];
}

function buildMain(t: TFunction): NavLinkItem[] {
  return [
    { to: '/dashboard', label: t('layout:nav.dashboard'), icon: LayoutDashboard },
    { to: '/servers', label: t('layout:nav.servers'), icon: Server },
  ];
}

function buildGroups(t: TFunction): NavGroup[] {
  return [
    {
      id: 'administration',
      title: t('layout:sections.administration'),
      links: [{ to: '/admin', label: t('layout:nav.overview'), icon: BarChart3, permissions: ['admin.read', 'admin.write'] }],
    },
    {
      id: 'infrastructure',
      title: t('layout:sections.infrastructure'),
      links: [
        { to: '/admin/nodes', label: t('layout:nav.nodes'), icon: Network, permissions: ['node.read', 'node.create', 'node.update', 'node.delete', 'admin.read', 'admin.write'] },
        { to: '/admin/servers', label: t('layout:nav.allServers'), icon: Server, permissions: ['admin.read', 'admin.write'] },
        { to: '/admin/templates', label: t('layout:nav.templates'), icon: FileText, permissions: ['template.read', 'template.create', 'template.update', 'template.delete', 'admin.read', 'admin.write'] },
      ],
    },
    {
      id: 'access-control',
      title: t('layout:sections.accessControl'),
      links: [
        { to: '/admin/users', label: t('layout:nav.users'), icon: Users, permissions: ['user.read', 'user.create', 'user.update', 'user.delete', 'user.set_roles', 'admin.read', 'admin.write'] },
        { to: '/admin/roles', label: t('layout:nav.roles'), icon: Shield, permissions: ['role.read', 'role.create', 'role.update', 'role.delete', 'admin.read', 'admin.write'] },
        { to: '/admin/api-keys', label: t('layout:nav.apiKeys'), icon: Key, permissions: ['apikey.manage', 'admin.read', 'admin.write'] },
      ],
    },
    {
      id: 'configuration',
      title: t('layout:sections.configuration'),
      links: [
        { to: '/admin/database', label: t('layout:nav.databases'), icon: Database, permissions: ['admin.read', 'admin.write'] },
        { to: '/admin/system', label: t('layout:nav.system'), icon: Settings, permissions: ['admin.write'] },
        { to: '/admin/security', label: t('layout:nav.security'), icon: Lock, permissions: ['admin.read', 'admin.write'] },
        { to: '/admin/migration', label: t('layout:nav.migration'), icon: ArrowRightLeft, permissions: ['admin.read', 'admin.write'] },
      ],
    },
    {
      id: 'monitoring',
      title: t('layout:sections.monitoring'),
      links: [
        { to: '/admin/alerts', label: t('layout:nav.alerts'), icon: Bell, permissions: ['alert.read', 'alert.create', 'alert.update', 'alert.delete', 'admin.read', 'admin.write'] },
        { to: '/admin/audit-logs', label: t('layout:nav.auditLogs'), icon: Activity, permissions: ['admin.read', 'admin.write'] },
        { to: '/admin/system-errors', label: t('layout:nav.systemErrors'), icon: Bug, permissions: ['admin.read', 'admin.write'] },
      ],
    },
    {
      id: 'extensions',
      title: t('layout:sections.extensions'),
      links: [
        { to: '/admin/plugins', label: t('layout:nav.plugins'), icon: Plug, permissions: ['admin.read', 'admin.write'] },
        { to: '/admin/theme-settings', label: t('layout:nav.theme'), icon: Palette, permissions: ['admin.write'] },
      ],
    },
  ];
}

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
            {main.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => onOpenChange(false)}
                className="flex items-center gap-1.5 rounded-sm border border-border/60 px-2.5 py-1.5 font-display text-micro uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <link.icon className="h-3.5 w-3.5" />
                {link.label}
              </Link>
            ))}
          </div>

          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <div key={group.id}>
                <span className="deck-label mb-1.5">{group.title}</span>
                <div className="flex flex-col">
                  {group.links.map((link) => (
                    <Link
                      key={link.to}
                      to={link.to}
                      onClick={() => onOpenChange(false)}
                      className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-data text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
                    >
                      <link.icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                      <span className="truncate">{link.label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
