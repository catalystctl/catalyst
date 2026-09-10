import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
 Search,
 X,
 LayoutDashboard,
 Server,
 Users,
 Shield,
 ShieldCheck,
 Network,
 FileText,
 Bell,
 Database as DbIcon,
 Settings,
 Key,
 Plug,
 Palette,
 Plus,
 Loader2,

 Terminal,
 FolderOpen,
 FolderSync,
 HardDrive,
 Clock,
 BarChart3,
 Wrench,
 Mail,
 Lock,
 Zap,
 Globe,
 Layers,
 Layout,
 SwatchBook,
 Wand2,
 Fingerprint,
 Smartphone,
 History,
 ArrowRightLeft,
 Sun,
 Moon,
 MonitorDot,
 Package,
 AlertTriangle,
 type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { hasAnyPermission } from '../auth/ProtectedRoute';
import { useServers } from '../../hooks/useServers';
import { useNodes } from '../../hooks/useNodes';
import { useTemplates } from '../../hooks/useTemplates';
import { useAvailableDatabaseHosts } from '../../hooks/useServerDatabases';
import { canShowServerDatabasesTab } from '../../utils/serverTabs';
import { cn } from '../../lib/utils';

// ══════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════

interface SearchItem {
 id: string;
 label: string;
 description: string;
 icon: LucideIcon;
 to: string;
 category: SearchCategory;
 keywords: string[];
 permissions?: string[];
 badge?: string;
 path?: string;
}

type SearchCategory =
 | 'Navigation'
 | 'Admin'
 | 'Settings'
 | 'Servers'
 | 'Nodes'
 | 'Templates'
 | 'Profile'
 | 'Actions'
 | 'Server Tabs';

const buildCategoryMeta = (t: TFunction): Record<SearchCategory, { label: string; icon: LucideIcon; color: string }> => ({
 Navigation: { label: t('layout:search.categories.pages'), icon: LayoutDashboard, color: 'text-muted-foreground' },
 Admin: { label: t('layout:search.categories.admin'), icon: Shield, color: 'text-muted-foreground' },
 Settings: { label: t('layout:search.categories.settings'), icon: Settings, color: 'text-muted-foreground' },
 Servers: { label: t('layout:search.categories.servers'), icon: Server, color: 'text-muted-foreground' },
 Nodes: { label: t('layout:search.categories.nodes'), icon: MonitorDot, color: 'text-muted-foreground' },
 Templates: { label: t('layout:search.categories.templates'), icon: FileText, color: 'text-muted-foreground' },
 Profile: { label: t('layout:search.categories.account'), icon: Users, color: 'text-muted-foreground' },
 Actions: { label: t('layout:search.categories.actions'), icon: Zap, color: 'text-muted-foreground' },
 'Server Tabs': { label: t('layout:search.categories.serverTabs'), icon: Terminal, color: 'text-muted-foreground' },
});

const CATEGORY_ORDER: SearchCategory[] = [
 'Navigation',
 'Admin',
 'Settings',
 'Servers',
 'Server Tabs',
 'Nodes',
 'Templates',
 'Profile',
 'Actions',
];

// ══════════════════════════════════════════════════════════════
// Static Item Registry
// Every page, settings section, and feature the panel supports.
// Keywords enable discovery — "SSO", "palette", "allocation", etc.
// ══════════════════════════════════════════════════════════════

interface StaticItemDef {
 id: string;
 label: string;
 description: string;
 icon: LucideIcon;
 to: string;
 category: SearchCategory;
 keywords: string[];
 permissions?: string[];
 badge?: string;
 path?: string;
}

const buildStaticItems = (t: TFunction): StaticItemDef[] => [
 // ── User Navigation ──────────────────────────────────────
 {
 id: 'nav-dashboard',
 label: t('layout:nav.dashboard'),
 description: t('layout:search.items.navDashboard.description'),
 icon: LayoutDashboard,
 to: '/dashboard',
 category: 'Navigation',
 keywords: ['home', 'overview', 'main'],
 path: '/dashboard',
 },
 {
 id: 'nav-servers',
 label: t('layout:nav.servers'),
 description: t('layout:search.items.navServers.description'),
 icon: Server,
 to: '/servers',
 category: 'Navigation',
 keywords: ['game', 'minecraft', 'server list'],
 path: '/servers',
 },
 {
 id: 'nav-profile',
 label: t('layout:nav.profile'),
 description: t('layout:search.items.navProfile.description'),
 icon: Users,
 to: '/profile',
 category: 'Navigation',
 keywords: ['account', 'settings', 'user'],
 path: '/profile',
 },

 // ── Admin Pages ──────────────────────────────────────────
 {
 id: 'admin-overview',
 label: t('layout:search.items.adminOverview.label'),
 description: t('layout:search.items.adminOverview.description'),
 icon: LayoutDashboard,
 to: '/admin',
 category: 'Admin',
 keywords: ['admin', 'dashboard', 'overview', 'stats', 'platform'],
 permissions: ['admin.read', 'admin.write'],
 badge: t('layout:nav.admin'),
 path: '/admin',
 },
 {
 id: 'admin-users',
 label: t('layout:nav.users'),
 description: t('layout:search.items.adminUsers.description'),
 icon: Users,
 to: '/admin/users',
 category: 'Admin',
 keywords: ['user', 'account', 'people', 'member'],
 permissions: ['user.read', 'admin.read'],
 badge: t('layout:nav.admin'),
 path: '/admin/users',
 },
 {
 id: 'admin-roles',
 label: t('layout:search.items.adminRoles.label'),
 description: t('layout:search.items.adminRoles.description'),
 icon: Shield,
 to: '/admin/roles',
 category: 'Admin',
 keywords: ['role', 'permission', 'rbac', 'access', 'group', 'policy'],
 permissions: ['role.read', 'admin.read'],
 badge: t('layout:nav.admin'),
 path: '/admin/roles',
 },
 {
 id: 'admin-nodes',
 label: t('layout:nav.nodes'),
 description: t('layout:search.items.adminNodes.description'),
 icon: Network,
 to: '/admin/nodes',
 category: 'Admin',
 keywords: ['node', 'machine', 'host', 'compute', 'infrastructure'],
 permissions: ['node.read', 'admin.read'],
 badge: t('layout:nav.admin'),
 path: '/admin/nodes',
 },
 {
 id: 'admin-servers',
 label: t('layout:nav.allServers'),
 description: t('layout:search.items.adminServers.description'),
 icon: Server,
 to: '/admin/servers',
 category: 'Admin',
 keywords: ['all servers', 'server list', 'manage servers'],
 permissions: ['admin.read'],
 badge: t('layout:nav.admin'),
 path: '/admin/servers',
 },
 {
 id: 'admin-templates',
 label: t('layout:nav.templates'),
 description: t('layout:search.items.adminTemplates.description'),
 icon: FileText,
 to: '/admin/templates',
 category: 'Admin',
 keywords: ['template', 'egg', 'nest', 'server template', 'setup'],
 permissions: ['template.read', 'admin.read'],
 badge: t('layout:nav.admin'),
 path: '/admin/templates',
 },
 {
 id: 'admin-alerts',
 label: t('layout:nav.alerts'),
 description: t('layout:search.items.adminAlerts.description'),
 icon: Bell,
 to: '/admin/alerts',
 category: 'Admin',
 keywords: ['alert', 'notification', 'rule', 'cpu', 'memory', 'disk', 'threshold', 'monitoring'],
 permissions: ['alert.read', 'admin.read'],
 badge: t('layout:nav.admin'),
 path: '/admin/alerts',
 },
 {
 id: 'admin-databases',
 label: t('layout:search.items.adminDatabases.label'),
 description: t('layout:search.items.adminDatabases.description'),
 icon: DbIcon,
 to: '/admin/database',
 category: 'Admin',
 keywords: ['database', 'mysql', 'postgres', 'postgresql', 'db host', 'sql'],
 permissions: ['admin.read'],
 badge: t('layout:nav.admin'),
 path: '/admin/database',
 },
 {
 id: 'admin-system',
 label: t('layout:nav.system'),
 description: t('layout:search.items.adminSystem.description'),
 icon: Settings,
 to: '/admin/system',
 category: 'Admin',
 keywords: ['system', 'health', 'status', 'uptime', 'configuration'],
 permissions: ['admin.write'],
 badge: t('layout:nav.admin'),
 path: '/admin/system',
 },
 {
 id: 'admin-security',
 label: t('layout:nav.security'),
 description: t('layout:search.items.adminSecurity.description'),
 icon: Shield,
 to: '/admin/security',
 category: 'Admin',
 keywords: ['security', 'rate limit', 'lockout', 'brute force', 'throttle', 'firewall'],
 permissions: ['admin.read'],
 badge: t('layout:nav.admin'),
 path: '/admin/security',
 },
 {
 id: 'admin-audit-logs',
 label: t('layout:nav.auditLogs'),
 description: t('layout:search.items.adminAuditLogs.description'),
 icon: History,
 to: '/admin/audit-logs',
 category: 'Admin',
 keywords: ['audit', 'log', 'history', 'trail', 'compliance'],
 permissions: ['admin.read'],
 badge: t('layout:nav.admin'),
 path: '/admin/audit-logs',
 },
 {
 id: 'admin-system-errors',
 label: t('layout:nav.systemErrors'),
 description: t('layout:search.items.adminSystemErrors.description'),
 icon: AlertTriangle,
 to: '/admin/system-errors',
 category: 'Admin',
 keywords: ['system errors', 'error log', 'exceptions', 'stack trace', 'crash', 'failures', 'sentry'],
 permissions: ['admin.read'],
 badge: t('layout:nav.admin'),
 path: '/admin/system-errors',
 },
 {
 id: 'admin-api-keys',
 label: t('layout:nav.apiKeys'),
 description: t('layout:search.items.adminApiKeys.description'),
 icon: Key,
 to: '/admin/api-keys',
 category: 'Admin',
 keywords: ['api key', 'token', 'api', 'authentication', 'key management'],
 permissions: ['apikey.manage', 'admin.read'],
 badge: t('layout:nav.admin'),
 path: '/admin/api-keys',
 },
 {
 id: 'admin-plugins',
 label: t('layout:nav.plugins'),
 description: t('layout:search.items.adminPlugins.description'),
 icon: Plug,
 to: '/admin/plugins',
 category: 'Admin',
 keywords: ['plugin', 'extension', 'addon', 'module', 'integration'],
 permissions: ['admin.read'],
 badge: t('layout:nav.admin'),
 path: '/admin/plugins',
 },
 {
 id: 'admin-migration',
 label: t('layout:nav.migration'),
 description: t('layout:search.items.adminMigration.description'),
 icon: ArrowRightLeft,
 to: '/admin/migration',
 category: 'Admin',
 keywords: ['migration', 'pterodactyl', 'import', 'transfer', 'migrate'],
 permissions: ['admin.read'],
 badge: t('layout:nav.admin'),
 path: '/admin/migration',
 },

 // ── Theme Settings Deep Links ───────────────────────────
 {
 id: 'settings-theme-overview',
 label: t('layout:search.items.settingsThemeOverview.label'),
 description: t('layout:search.items.settingsThemeOverview.description'),
 icon: Palette,
 to: '/admin/theme-settings',
 category: 'Settings',
 keywords: ['theme', 'appearance', 'branding', 'look', 'style'],
 permissions: ['admin.write'],
 path: '/admin/theme-settings',
 },
 {
 id: 'settings-branding',
 label: t('layout:search.items.settingsBranding.label'),
 description: t('layout:search.items.settingsBranding.description'),
 icon: Layers,
 to: '/admin/theme-settings',
 category: 'Settings',
 keywords: [
 'branding', 'logo', 'panel name', 'favicon', 'identity', 'brand',
 'custom logo', 'site name', 'title',
 ],
 permissions: ['admin.write'],
 path: '/admin/theme-settings',
 },
 {
 id: 'settings-palette-generator',
 label: t('layout:search.items.settingsPaletteGenerator.label'),
 description: t('layout:search.items.settingsPaletteGenerator.description'),
 icon: Wand2,
 to: '/admin/theme-settings',
 category: 'Settings',
 keywords: [
 'palette', 'color palette', 'palette generator', 'theme palette',
 'color scheme', 'generate colors', 'seed color', 'harmony',
 'auto theme', 'color picker',
 ],
 permissions: ['admin.write'],
 path: '/admin/theme-settings',
 },
 {
 id: 'settings-brand-colors',
 label: t('layout:search.items.settingsBrandColors.label'),
 description: t('layout:search.items.settingsBrandColors.description'),
 icon: SwatchBook,
 to: '/admin/theme-settings',
 category: 'Settings',
 keywords: [
 'primary color', 'secondary color', 'accent color', 'brand color',
 'main color', 'button color', 'link color',
 ],
 permissions: ['admin.write'],
 path: '/admin/theme-settings',
 },
 {
 id: 'settings-semantic-colors',
 label: t('layout:search.items.settingsSemanticColors.label'),
 description: t('layout:search.items.settingsSemanticColors.description'),
 icon: Palette,
 to: '/admin/theme-settings',
 category: 'Settings',
 keywords: [
 'success color', 'warning color', 'danger color', 'info color',
 'error color', 'status color', 'feedback color',
 ],
 permissions: ['admin.write'],
 path: '/admin/theme-settings',
 },
 {
 id: 'settings-dark-surfaces',
 label: t('layout:search.items.settingsDarkSurfaces.label'),
 description: t('layout:search.items.settingsDarkSurfaces.description'),
 icon: Moon,
 to: '/admin/theme-settings',
 category: 'Settings',
 keywords: [
 'dark mode', 'dark theme', 'dark surfaces', 'dark background',
 'dark card', 'dark border', 'night mode', 'dark colors',
 ],
 permissions: ['admin.write'],
 path: '/admin/theme-settings',
 },
 {
 id: 'settings-light-surfaces',
 label: t('layout:search.items.settingsLightSurfaces.label'),
 description: t('layout:search.items.settingsLightSurfaces.description'),
 icon: Sun,
 to: '/admin/theme-settings',
 category: 'Settings',
 keywords: [
 'light mode', 'light theme', 'light surfaces', 'light background',
 'light card', 'light border', 'day mode', 'light colors',
 ],
 permissions: ['admin.write'],
 path: '/admin/theme-settings',
 },
 {
 id: 'settings-theme-mode',
 label: t('layout:search.items.settingsThemeMode.label'),
 description: t('layout:search.items.settingsThemeMode.description'),
 icon: Layers,
 to: '/admin/theme-settings',
 category: 'Settings',
 keywords: [
 'theme mode', 'default theme', 'light', 'dark', 'system theme',
 'toggle theme', 'theme switch',
 ],
 permissions: ['admin.write'],
 path: '/admin/theme-settings',
 },
 {
 id: 'settings-layout',
 label: t('layout:search.items.settingsLayout.label'),
 description: t('layout:search.items.settingsLayout.description'),
 icon: Layout,
 to: '/admin/theme-settings',
 category: 'Settings',
 keywords: [
 'layout', 'border radius', 'roundness', 'spacing', 'corners',
 'rounded', 'pill', 'sharp',
 ],
 permissions: ['admin.write'],
 path: '/admin/theme-settings',
 },
 {
 id: 'settings-custom-css',
 label: t('layout:search.items.settingsCustomCss.label'),
 description: t('layout:search.items.settingsCustomCss.description'),
 icon: Globe,
 to: '/admin/theme-settings',
 category: 'Settings',
 keywords: [
 'custom css', 'css', 'custom styling', 'stylesheet', 'injection',
 'custom style', 'override', 'advanced styling',
 ],
 permissions: ['admin.write'],
 path: '/admin/theme-settings',
 },
 {
 id: 'settings-sso',
 label: t('layout:search.items.settingsSso.label'),
 description: t('layout:search.items.settingsSso.description'),
 icon: ShieldCheck,
 to: '/admin/theme-settings',
 category: 'Settings',
 keywords: [
 'sso', 'oauth', 'oidc', 'single sign-on', 'whmcs', 'paymenter',
 'external login', 'third-party login', 'identity provider', 'idp',
 'federated login', 'social login',
 ],
 permissions: ['admin.write'],
 path: '/admin/theme-settings',
 },

 // ── Security Settings Deep Links ────────────────────────
 {
 id: 'settings-rate-limits',
 label: t('layout:search.items.settingsRateLimits.label'),
 description: t('layout:search.items.settingsRateLimits.description'),
 icon: Zap,
 to: '/admin/security',
 category: 'Settings',
 keywords: [
 'rate limit', 'throttle', 'requests per minute', 'rpm',
 'request limit', 'api limit', 'abuse prevention',
 'auth rate', 'file rate', 'console rate', 'agent rate',
 ],
 permissions: ['admin.read'],
 path: '/admin/security',
 },
 {
 id: 'settings-lockout-policy',
 label: t('layout:search.items.settingsLockoutPolicy.label'),
 description: t('layout:search.items.settingsLockoutPolicy.description'),
 icon: Lock,
 to: '/admin/security',
 category: 'Settings',
 keywords: [
 'lockout', 'failed login', 'brute force', 'account lock',
 'login attempts', 'max attempts', 'lockout duration', 'lockout window',
 ],
 permissions: ['admin.read'],
 path: '/admin/security',
 },
 {
 id: 'settings-auth-lockouts',
 label: t('layout:search.items.settingsAuthLockouts.label'),
 description: t('layout:search.items.settingsAuthLockouts.description'),
 icon: Lock,
 to: '/admin/security',
 category: 'Settings',
 keywords: [
 'lockout', 'locked account', 'locked out', 'unlock', 'locked email',
 'failed attempts', 'blocked',
 ],
 permissions: ['admin.read'],
 path: '/admin/security',
 },
 {
 id: 'settings-file-tunnel',
 label: t('layout:search.items.settingsFileTunnel.label'),
 description: t('layout:search.items.settingsFileTunnel.description'),
 icon: FolderSync,
 to: '/admin/security',
 category: 'Settings',
 keywords: [
 'file tunnel', 'file transfer', 'upload limit', 'download limit',
 'file rate limit', 'concurrent files', 'tunnel settings',
 ],
 permissions: ['admin.read'],
 path: '/admin/security',
 },
 {
 id: 'settings-audit-retention',
 label: t('layout:search.items.settingsAuditRetention.label'),
 description: t('layout:search.items.settingsAuditRetention.description'),
 icon: History,
 to: '/admin/security',
 category: 'Settings',
 keywords: [
 'audit retention', 'log retention', 'retention period', 'data retention',
 'log cleanup', 'log expiry',
 ],
 permissions: ['admin.read'],
 path: '/admin/security',
 },

 // ── System Settings Deep Links ──────────────────────────
 {
 id: 'settings-smtp',
 label: t('layout:search.items.settingsSmtp.label'),
 description: t('layout:search.items.settingsSmtp.description'),
 icon: Mail,
 to: '/admin/system',
 category: 'Settings',
 keywords: [
 'smtp', 'email', 'mail', 'notification email', 'outbound email',
 'mail server', 'email server', 'from address', 'reply-to',
 'starttls', 'ssl', 'email pool',
 ],
 permissions: ['admin.write'],
 path: '/admin/system',
 },
 {
 id: 'settings-mod-manager',
 label: t('layout:search.items.settingsModManager.label'),
 description: t('layout:search.items.settingsModManager.description'),
 icon: Key,
 to: '/admin/system',
 category: 'Settings',
 keywords: [
 'curseforge', 'modrinth', 'mod manager', 'mod api key',
 'mod download', 'mod platform', 'mod integration',
 ],
 permissions: ['admin.write'],
 path: '/admin/system',
 },
 {
 id: 'settings-health',
 label: t('layout:search.items.settingsHealth.label'),
 description: t('layout:search.items.settingsHealth.description'),
 icon: MonitorDot,
 to: '/admin/system',
 category: 'Settings',
 keywords: [
 'health', 'status', 'uptime', 'database status', 'node status',
 'system health', 'platform status', 'monitoring', 'heartbeat',
 ],
 permissions: ['admin.write'],
 path: '/admin/system',
 },

 // ── Node Settings Deep Links ────────────────────────────
 {
 id: 'settings-node-allocations',
 label: t('layout:search.items.settingsNodeAllocations.label'),
 description: t('layout:search.items.settingsNodeAllocations.description'),
 icon: Network,
 to: '/admin/nodes',
 category: 'Settings',
 keywords: [
 'allocation', 'ip pool', 'port allocation', 'cidr', 'ip address',
 'port range', 'network allocation', 'node allocation',
 'ipam', 'subnet', 'gateway',
 ],
 permissions: ['node.read', 'admin.read'],
 path: '/admin/nodes',
 },

 // ── Profile / Account Features ──────────────────────────
 {
 id: 'profile-2fa',
 label: t('layout:search.items.profile2fa.label'),
 description: t('layout:search.items.profile2fa.description'),
 icon: Smartphone,
 to: '/profile',
 category: 'Profile',
 keywords: [
 '2fa', 'two-factor', 'totp', 'authenticator', 'otp',
 'google authenticator', 'authy', 'security code',
 ],
 path: '/profile',
 },
 {
 id: 'profile-passkeys',
 label: t('layout:search.items.profilePasskeys.label'),
 description: t('layout:search.items.profilePasskeys.description'),
 icon: Fingerprint,
 to: '/profile',
 category: 'Profile',
 keywords: [
 'passkey', 'webauthn', 'biometric', 'fingerprint', 'face id',
 'security key', 'yubikey', 'passwordless', 'hardware key',
 ],
 path: '/profile',
 },
 {
 id: 'profile-sso',
 label: t('layout:search.items.profileSso.label'),
 description: t('layout:search.items.profileSso.description'),
 icon: Globe,
 to: '/profile',
 category: 'Profile',
 keywords: [
 'sso', 'oauth', 'linked account', 'external login', 'connected account',
 'whmcs login', 'paymenter login',
 ],
 path: '/profile',
 },
 {
 id: 'profile-sessions',
 label: t('layout:search.items.profileSessions.label'),
 description: t('layout:search.items.profileSessions.description'),
 icon: MonitorDot,
 to: '/profile',
 category: 'Profile',
 keywords: [
 'session', 'active session', 'devices', 'login session',
 'revoke session', 'sign out everywhere', 'logged in devices',
 ],
 path: '/profile',
 },
 {
 id: 'profile-api-keys',
 label: t('layout:search.items.profileApiKeys.label'),
 description: t('layout:search.items.profileApiKeys.description'),
 icon: Key,
 to: '/profile',
 category: 'Profile',
 keywords: [
 'api key', 'personal api key', 'token', 'api token',
 'personal token', 'developer key',
 ],
 path: '/profile',
 },
 {
 id: 'profile-audit-log',
 label: t('layout:search.items.profileAuditLog.label'),
 description: t('layout:search.items.profileAuditLog.description'),
 icon: History,
 to: '/profile',
 category: 'Profile',
 keywords: [
 'audit log', 'activity log', 'my activity', 'my history',
 'personal log', 'recent actions',
 ],
 path: '/profile',
 },
];

// ── Server Tab Definitions ────────────────────────────────

const buildServerTabs = (t: TFunction): { key: string; label: string; description: string; icon: LucideIcon; keywords: string[] }[] => [
 { key: 'console', label: t('layout:search.serverTabs.console.label'), description: t('layout:search.serverTabs.console.description'), icon: Terminal, keywords: ['terminal', 'command', 'output', 'logs', 'stdin', 'stdout'] },
 { key: 'files', label: t('layout:search.serverTabs.files.label'), description: t('layout:search.serverTabs.files.description'), icon: FolderOpen, keywords: ['file', 'files', 'browse', 'edit', 'upload', 'download', 'directory'] },
 { key: 'sftp', label: t('layout:search.serverTabs.sftp.label'), description: t('layout:search.serverTabs.sftp.description'), icon: FolderSync, keywords: ['sftp', 'ftp', 'file transfer', 'sftp credentials', 'sftp info'] },
 { key: 'backups', label: t('layout:search.serverTabs.backups.label'), description: t('layout:search.serverTabs.backups.description'), icon: HardDrive, keywords: ['backup', 'restore', 'snapshot', 'archive'] },
 { key: 'tasks', label: t('layout:search.serverTabs.tasks.label'), description: t('layout:search.serverTabs.tasks.description'), icon: Clock, keywords: ['task', 'schedule', 'cron', 'automate', 'recurring', 'backup schedule'] },
 { key: 'databases', label: t('layout:search.serverTabs.databases.label'), description: t('layout:search.serverTabs.databases.description'), icon: DbIcon, keywords: ['database', 'mysql', 'postgres', 'db'] },
 { key: 'metrics', label: t('layout:search.serverTabs.metrics.label'), description: t('layout:search.serverTabs.metrics.description'), icon: BarChart3, keywords: ['metrics', 'cpu', 'memory', 'ram', 'disk', 'network', 'usage', 'performance', 'graphs', 'charts'] },
 { key: 'alerts', label: t('layout:search.serverTabs.alerts.label'), description: t('layout:search.serverTabs.alerts.description'), icon: Bell, keywords: ['alert', 'notification', 'threshold', 'cpu alert', 'memory alert'] },
 { key: 'modManager', label: t('layout:search.serverTabs.modManager.label'), description: t('layout:search.serverTabs.modManager.description'), icon: Package, keywords: ['mod', 'mods', 'curseforge', 'modrinth', 'plugin', 'modpack'] },
 { key: 'pluginManager', label: t('layout:search.serverTabs.pluginManager.label'), description: t('layout:search.serverTabs.pluginManager.description'), icon: Plug, keywords: ['plugin', 'plugins', 'extension', 'bukkit', 'spigot', 'paper'] },
 { key: 'configuration', label: t('layout:search.serverTabs.configuration.label'), description: t('layout:search.serverTabs.configuration.description'), icon: Wrench, keywords: ['config', 'configuration', 'startup', 'jvm', 'flags', 'arguments', 'java options'] },
 { key: 'users', label: t('layout:search.serverTabs.users.label'), description: t('layout:search.serverTabs.users.description'), icon: Users, keywords: ['subuser', 'user', 'permission', 'access', 'share server', 'collaborator'] },
 { key: 'settings', label: t('layout:search.serverTabs.settings.label'), description: t('layout:search.serverTabs.settings.description'), icon: Settings, keywords: ['settings', 'rename', 'reinstall', 'preferences', 'server settings'] },
 { key: 'admin', label: t('layout:search.serverTabs.admin.label'), description: t('layout:search.serverTabs.admin.description'), icon: Shield, keywords: ['admin', 'owner', 'transfer', 'suspend', 'unsuspend', 'delete', 'reinstall'] },
];

// ── Quick Actions ─────────────────────────────────────────

const buildQuickActions = (t: TFunction): Omit<SearchItem, 'category'>[] => [
 {
 id: 'action-create-server',
 label: t('layout:search.quickActions.createServer.label'),
 description: t('layout:search.quickActions.createServer.description'),
 icon: Plus,
 to: '/servers?action=create',
 keywords: ['create', 'new', 'deploy', 'provision', 'add server'],
 },
];

// ══════════════════════════════════════════════════════════════
// Component
// ══════════════════════════════════════════════════════════════

interface SearchPaletteProps {
 isOpen: boolean;
 onClose: () => void;
 onCreateServer?: () => void;
}

function SearchPalette({ isOpen, onClose, onCreateServer }: SearchPaletteProps) {
 const navigate = useNavigate();
 const { t } = useTranslation('layout');
 const user = useAuthStore((s) => s.user);
 const { data: servers, isLoading: serversLoading } = useServers();
 const { data: nodes, isLoading: nodesLoading } = useNodes();
 const { data: templates, isLoading: templatesLoading } = useTemplates();
 const { data: databaseHosts = [] } = useAvailableDatabaseHosts();

 const [query, setQuery] = useState('');
 const [selectedIndex, setSelectedIndex] = useState(0);
 const [activeCategory, setActiveCategory] = useState<SearchCategory | 'All'>('All');
 const inputRef = useRef<HTMLInputElement>(null);
 const listRef = useRef<HTMLDivElement>(null);
 const prevIsOpenRef = useRef(isOpen);

 // ── Static items (permission-filtered) ──

 const staticItems = useMemo((): SearchItem[] => {
 const userPermissions = user?.permissions || [];
 return buildStaticItems(t).filter((item) => {
 if (item.permissions) return hasAnyPermission(userPermissions, item.permissions);
 return true;
 });
 }, [t, user]);

 // ── Dynamic items (servers, nodes, templates, server tabs, actions) ──

 const dynamicItems = useMemo((): SearchItem[] => {
 const items: SearchItem[] = [];

 // Servers + their tabs
 if (Array.isArray(servers)) {
 for (const server of servers) {
 items.push({
 id: `server-${server.id}`,
 label: server.name,
 description: server.node?.name || t('search.unknownNode'),
 icon: Server,
 to: `/servers/${server.id}`,
 category: 'Servers',
 keywords: [server.node?.name || '', server.status || '', 'game server'],
 path: `/servers/${server.id}`,
 });

 for (const tab of buildServerTabs(t)) {
 if (
 tab.key === 'databases' &&
 !canShowServerDatabasesTab({
 hasDatabaseRead:
 server.effectivePermissions?.includes('database.read') ||
 user?.permissions?.includes('*') ||
 user?.permissions?.includes('admin.write') ||
 false,
 databaseAllocation: server.databaseAllocation,
 hostCount: databaseHosts.length,
 })
 ) {
 continue;
 }
 items.push({
 id: `server-${server.id}-tab-${tab.key}`,
 label: t('search.serverTabTitle', { server: server.name, tab: tab.label }),
 description: tab.description,
 icon: tab.icon,
 to: `/servers/${server.id}/${tab.key}`,
 category: 'Server Tabs',
 keywords: [
 `${tab.label.toLowerCase()} ${server.name.toLowerCase()}`,
 `${server.name.toLowerCase()} ${tab.label.toLowerCase()}`,
 ...tab.keywords.map((k) => `${k} ${server.name.toLowerCase()}`),
 ],
 path: `/servers/${server.id}/${tab.key}`,
 });
 }
 }
 }

 // Nodes + allocation pages
 if (Array.isArray(nodes)) {
 for (const node of nodes) {
 items.push({
 id: `node-${node.id}`,
 label: node.name,
 description: t('search.hostWithServers', { host: node.hostname || node.publicAddress || '', servers: node._count?.servers ?? 0 }),
 icon: MonitorDot,
 to: `/admin/nodes/${node.id}`,
 category: 'Nodes',
 keywords: [node.hostname || '', node.publicAddress || '', 'node', 'machine'],
 badge: 'Admin',
 path: `/admin/nodes/${node.id}`,
 });
 items.push({
 id: `node-${node.id}-allocations`,
 label: t('search.nodeAllocations', { name: node.name }),
 description: t('search.nodeAllocationsDescription'),
 icon: Network,
 to: `/admin/nodes/${node.id}/allocations`,
 category: 'Nodes',
 keywords: [
 `${node.name.toLowerCase()} allocation`,
 `${node.name.toLowerCase()} ip pool`,
 `${node.name.toLowerCase()} ports`,
 'allocation', 'ip pool', 'cidr', 'port',
 ],
 badge: 'Admin',
 path: `/admin/nodes/${node.id}/allocations`,
 });
 }
 }

 // Templates
 if (Array.isArray(templates)) {
 for (const tmpl of templates) {
 items.push({
 id: `template-${tmpl.id}`,
 label: tmpl.name,
 description: tmpl.description || tmpl.nest?.name || t('search.serverTemplate'),
 icon: FileText,
 to: `/admin/templates/${tmpl.id}`,
 category: 'Templates',
 keywords: [tmpl.nest?.name || '', 'template', 'egg', 'server template'],
 badge: 'Admin',
 path: `/admin/templates/${tmpl.id}`,
 });
 }
 }

 // Quick actions
 for (const action of buildQuickActions(t)) {
 items.push({ ...action, category: 'Actions' as SearchCategory });
 }

 return items;
 }, [servers, nodes, templates, databaseHosts.length, user?.permissions, t]);

 // ── Combined ──

 const combinedItems = useMemo(
 () => [...staticItems, ...dynamicItems],
 [staticItems, dynamicItems],
 );

 // ── Available categories ──

 const categoryMeta = useMemo(() => buildCategoryMeta(t), [t]);
 const availableCategories = useMemo(() => {
 const cats = new Set<SearchCategory>();
 combinedItems.forEach((item) => cats.add(item.category));
 return CATEGORY_ORDER.filter((c) => cats.has(c));
 }, [combinedItems]);

 // ── Filtered by query + category ──

 const filteredItems = useMemo(() => {
 let items = combinedItems;

 if (activeCategory !== 'All') {
 items = items.filter((item) => item.category === activeCategory);
 }

 if (!query.trim()) return items;

 const terms = query.toLowerCase().split(/\s+/);

 return items.filter((item) => {
 const haystack = [
 item.label,
 item.description,
 item.path || '',
 item.badge || '',
 ...item.keywords,
 ]
 .join(' ')
 .toLowerCase();

 return terms.every((term) => haystack.includes(term));
 });
 }, [combinedItems, query, activeCategory]);

 // ── Grouped results ──

 const groupedItems = useMemo(() => {
 const groups = new Map<SearchCategory, SearchItem[]>();
 filteredItems.forEach((item) => {
 const list = groups.get(item.category) || [];
 list.push(item);
 groups.set(item.category, list);
 });

 return CATEGORY_ORDER.filter((c) => groups.has(c)).map((category) => ({
 category,
 items: groups.get(category)!,
 }));
 }, [filteredItems]);

 const flatItems = filteredItems;

 // ── Reset on open ──

 useEffect(() => {
 if (isOpen && !prevIsOpenRef.current) {
 setQuery('');
 setSelectedIndex(0);
 setActiveCategory('All');
 setTimeout(() => inputRef.current?.focus(), 0);
 }
 prevIsOpenRef.current = isOpen;
 }, [isOpen]);

 useEffect(() => {
 if (!isOpen) return;
 const handleWindowKeyDown = (event: KeyboardEvent) => {
 if (event.key === 'Escape') { event.preventDefault(); onClose(); }
 if (event.key === 'Tab') {
 const root = inputRef.current?.closest('[role="dialog"]');
 const focusable = root?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
 if (!focusable?.length) return;
 const first = focusable[0]; const last = focusable[focusable.length - 1];
 if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
 else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
 }
 };
 window.addEventListener('keydown', handleWindowKeyDown);
 return () => window.removeEventListener('keydown', handleWindowKeyDown);
 }, [isOpen, onClose]);

 // Reset selection when query/category changes
 useEffect(() => {
 setSelectedIndex(0);
 }, [query, activeCategory]);

 // Scroll selected item into view
 useEffect(() => {
 if (listRef.current && flatItems.length > 0) {
 const el = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
 if (el) el.scrollIntoView({ block: 'nearest' });
 }
 }, [selectedIndex, flatItems.length]);

 // ── Handlers ──

 const handleKeyDown = useCallback(
 (e: React.KeyboardEvent) => {
 switch (e.key) {
 case 'ArrowDown':
 e.preventDefault();
 setSelectedIndex((prev) => (prev + 1) % flatItems.length);
 break;
 case 'ArrowUp':
 e.preventDefault();
 setSelectedIndex((prev) => (prev - 1 + flatItems.length) % flatItems.length);
 break;
 case 'Enter':
 e.preventDefault();
 if (flatItems[selectedIndex]) {
 const item = flatItems[selectedIndex];
 if (item.id === 'action-create-server' && onCreateServer) {
 onCreateServer();
 } else {
 navigate(item.to);
 }
 onClose();
 }
 break;
 case 'Escape':
 e.preventDefault();
 onClose();
 break;
 case 'Backspace':
 if (!query && activeCategory !== 'All') {
 e.preventDefault();
 setActiveCategory('All');
 }
 break;
 }
 },
 [flatItems, selectedIndex, navigate, onClose, onCreateServer, query, activeCategory],
 );

 const handleItemClick = (item: SearchItem) => {
 if (item.id === 'action-create-server' && onCreateServer) {
 onCreateServer();
 } else {
 navigate(item.to);
 }
 onClose();
 };

 const handleCategoryClick = (cat: SearchCategory | 'All') => {
 setActiveCategory(cat);
 setSelectedIndex(0);
 };

 const isLoading = serversLoading || nodesLoading || templatesLoading;

 // ── Render ──

 if (!isOpen) return null;

 return createPortal(
 <AnimatePresence>
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 transition={{ duration: 0.15 }}
 className="fixed inset-0 z-[100] overflow-y-auto p-4" role="dialog" aria-modal="true" aria-label={t('common:actions.search')}
 >
 {/* Backdrop */}
 <div
 className="fixed inset-0 bg-background/60"
 onClick={onClose}
 aria-hidden="true"
 />

 {/* Modal */}
 <motion.div
 initial={{ opacity: 0, scale: 0.97, y: -10 }}
 animate={{ opacity: 1, scale: 1, y: 0 }}
 exit={{ opacity: 0, scale: 0.97, y: -10 }}
 transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
 className="relative mx-auto max-w-2xl mt-[8vh]"
 >
 <div className="overflow-hidden rounded-xl border border-border bg-card shadow-elevated">
 {/* ── Search Input ── */}
 <div className="flex items-center border-b border-border px-4">
 <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
 <input
 ref={inputRef}
 type="text"
 value={query}
 onChange={(e) => setQuery(e.target.value)}
 onKeyDown={handleKeyDown}
 placeholder={t('search.placeholder')}
 className="flex-1 border-none bg-transparent px-3 py-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0"
 />
 {isLoading && (
 <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
 )}
 <button
 type="button"
 onClick={onClose}
 aria-label={t('search.close')}
 className="ml-2 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 >
 <X className="h-4 w-4" />
 </button>
 </div>

 {/* ── Category Pills (visible when no query) ── */}
 {!query.trim() && availableCategories.length > 1 && (
 <div className="sticky top-0 z-10 flex gap-1.5 overflow-x-auto border-b border-border bg-card px-4 py-2 scrollbar-none">
 <button
 type="button"
 onClick={() => handleCategoryClick('All')}
 className={cn(
 'shrink-0 rounded-full px-3 py-1 text-[11px] font-medium transition-all',
 activeCategory === 'All'
 ? 'bg-primary text-primary-foreground shadow-sm'
 : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
 )}
 >
 {t('search.all')}
 </button>
 {availableCategories.map((cat) => {
 const meta = categoryMeta[cat];
 const CatIcon = meta.icon;
 return (
 <button
 key={cat}
 type="button"
 onClick={() => handleCategoryClick(cat)}
 className={cn(
 'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-all',
 activeCategory === cat
 ? 'bg-primary text-primary-foreground shadow-sm'
 : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
 )}
 >
 <CatIcon className="h-3 w-3" />
 {meta.label}
 </button>
 );
 })}
 </div>
 )}

 {/* ── Results List ── */}
 <div ref={listRef} className="max-h-[55vh] overflow-y-auto py-2">
 {flatItems.length === 0 ? (
 <div className="py-12 text-center">
 <Search className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
 <p className="text-sm font-medium text-muted-foreground">{t('search.noResults')}</p>
 <p className="mt-1 text-xs text-muted-foreground/60">
 {t('search.noResultsHint')}
 </p>
 </div>
 ) : (
 <div className="space-y-1">
 {groupedItems.map(({ category, items }) => {
 const meta = categoryMeta[category];
 const CatIcon = meta.icon;

 return (
 <div key={category}>
 {/* Group header */}
 <div className="sticky top-0 z-10 flex items-center gap-2 bg-card px-4 py-1.5">
 <CatIcon className={cn('h-3 w-3', meta.color)} />
 <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
 {meta.label}
 </span>
 <span className="text-[10px] text-muted-foreground/40">
 {items.length}
 </span>
 </div>

 {/* Items */}
 {items.map((item) => {
 const globalIndex = flatItems.indexOf(item);
 const isSelected = globalIndex === selectedIndex;
 const Icon = item.icon;

 return (
 <button
 key={item.id}
 type="button"
 data-index={globalIndex}
 onClick={() => handleItemClick(item)}
 className={cn(
 'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-all duration-100',
 isSelected
 ? 'bg-primary/10 text-primary'
 : 'text-foreground hover:bg-surface-2',
 )}
 >
 <div
 className={cn(
 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
 isSelected ? 'bg-primary/15' : 'bg-surface-2',
 )}
 >
 <Icon
 className={cn(
 'h-4 w-4 transition-colors',
 isSelected ? 'text-primary' : 'text-muted-foreground',
 )}
 />
 </div>

 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2">
 <span className="truncate text-sm font-medium">
 {item.label}
 </span>
 {item.badge && (
 <span className="shrink-0 rounded-full bg-surface-3 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
 {item.badge}
 </span>
 )}
 </div>
 <p className="truncate text-xs text-muted-foreground">
 {item.description}
 </p>
 </div>

 {isSelected && (
 <kbd className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
 ↵
 </kbd>
 )}
 </button>
 );
 })}
 </div>
 );
 })}
 </div>
 )}
 </div>

 {/* ── Footer ── */}
 <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
 <div className="flex items-center gap-3 text-[11px] text-muted-foreground/60">
 <span className="flex items-center gap-1">
 <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">
 {typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘K' : 'Ctrl+K'}
 </kbd>
 {t('search.hints.open')}
 </span>
 <span className="flex items-center gap-1">
 <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">↑↓</kbd>
 {t('search.hints.navigate')}
 </span>
 <span className="flex items-center gap-1">
 <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">↵</kbd>
 {t('search.hints.select')}
 </span>
 <span className="flex items-center gap-1">
 <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">esc</kbd>
 {t('search.hints.close')}
 </span>
 </div>
 <div className="text-[11px] text-muted-foreground/40">
 {t('search.resultCount', { count: flatItems.length })}
 </div>
 </div>
 </div>
 </motion.div>
 </motion.div>
 </AnimatePresence>,
 document.body,
 );
}

export default SearchPalette;
