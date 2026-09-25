import type { TFunction } from 'i18next';
import {
  LayoutDashboard,
  Server,
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

/**
 * Navigation source of truth: the labelled sidebar, the 56px rail's overflow
 * popover and the command palette all render these same entries, so a
 * destination cannot exist in one density and not another. Kept in a plain
 * module (not the component file) so Fast Refresh stays happy.
 */
export interface NavLinkItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permissions?: string[];
}

export interface NavGroup {
  id: string;
  title: string;
  links: NavLinkItem[];
}

export function buildMain(t: TFunction): NavLinkItem[] {
  return [
    { to: '/dashboard', label: t('layout:nav.dashboard'), icon: LayoutDashboard },
    { to: '/servers', label: t('layout:nav.servers'), icon: Server },
  ];
}

export function buildGroups(t: TFunction): NavGroup[] {
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
