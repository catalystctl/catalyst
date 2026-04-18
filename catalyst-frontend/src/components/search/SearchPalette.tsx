import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Command,
  Loader2,
  Activity,
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
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { hasAnyPermission } from '../auth/ProtectedRoute';
import { useServers } from '../../hooks/useServers';
import { useNodes } from '../../hooks/useNodes';
import { useTemplates } from '../../hooks/useTemplates';
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

const CATEGORY_META: Record<SearchCategory, { label: string; icon: LucideIcon; color: string }> = {
  Navigation:    { label: 'Pages',           icon: LayoutDashboard, color: 'text-blue-400' },
  Admin:         { label: 'Admin',           icon: Shield,          color: 'text-violet-400' },
  Settings:      { label: 'Settings & Config', icon: Settings,      color: 'text-amber-400' },
  Servers:       { label: 'Servers',         icon: Server,          color: 'text-emerald-400' },
  Nodes:         { label: 'Nodes',           icon: MonitorDot,      color: 'text-cyan-400' },
  Templates:     { label: 'Templates',       icon: FileText,        color: 'text-orange-400' },
  Profile:       { label: 'Account',         icon: Users,           color: 'text-pink-400' },
  Actions:       { label: 'Quick Actions',   icon: Zap,             color: 'text-teal-400' },
  'Server Tabs': { label: 'Server Tabs',     icon: Terminal,        color: 'text-indigo-400' },
};

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

const STATIC_ITEMS: StaticItemDef[] = [
  // ── User Navigation ──────────────────────────────────────
  {
    id: 'nav-dashboard',
    label: 'Dashboard',
    description: 'Overview of your servers and activity',
    icon: LayoutDashboard,
    to: '/dashboard',
    category: 'Navigation',
    keywords: ['home', 'overview', 'main'],
    path: '/dashboard',
  },
  {
    id: 'nav-servers',
    label: 'Servers',
    description: 'View and manage your game servers',
    icon: Server,
    to: '/servers',
    category: 'Navigation',
    keywords: ['game', 'minecraft', 'server list'],
    path: '/servers',
  },
  {
    id: 'nav-profile',
    label: 'Profile',
    description: 'Account settings and security',
    icon: Users,
    to: '/profile',
    category: 'Navigation',
    keywords: ['account', 'settings', 'user'],
    path: '/profile',
  },

  // ── Admin Pages ──────────────────────────────────────────
  {
    id: 'admin-overview',
    label: 'Admin Overview',
    description: 'Platform-wide dashboard and statistics',
    icon: LayoutDashboard,
    to: '/admin',
    category: 'Admin',
    keywords: ['admin', 'dashboard', 'overview', 'stats', 'platform'],
    permissions: ['admin.read', 'admin.write'],
    badge: 'Admin',
    path: '/admin',
  },
  {
    id: 'admin-users',
    label: 'Users',
    description: 'Manage user accounts and access',
    icon: Users,
    to: '/admin/users',
    category: 'Admin',
    keywords: ['user', 'account', 'people', 'member'],
    permissions: ['user.read', 'admin.read'],
    badge: 'Admin',
    path: '/admin/users',
  },
  {
    id: 'admin-roles',
    label: 'Roles & Permissions',
    description: 'Configure roles and permission groups',
    icon: Shield,
    to: '/admin/roles',
    category: 'Admin',
    keywords: ['role', 'permission', 'rbac', 'access', 'group', 'policy'],
    permissions: ['role.read', 'admin.read'],
    badge: 'Admin',
    path: '/admin/roles',
  },
  {
    id: 'admin-nodes',
    label: 'Nodes',
    description: 'Manage compute nodes and resources',
    icon: Network,
    to: '/admin/nodes',
    category: 'Admin',
    keywords: ['node', 'machine', 'host', 'compute', 'infrastructure'],
    permissions: ['node.read', 'admin.read'],
    badge: 'Admin',
    path: '/admin/nodes',
  },
  {
    id: 'admin-servers',
    label: 'All Servers',
    description: 'View every server on the platform',
    icon: Server,
    to: '/admin/servers',
    category: 'Admin',
    keywords: ['all servers', 'server list', 'manage servers'],
    permissions: ['admin.read'],
    badge: 'Admin',
    path: '/admin/servers',
  },
  {
    id: 'admin-templates',
    label: 'Templates',
    description: 'Server templates and nest configurations',
    icon: FileText,
    to: '/admin/templates',
    category: 'Admin',
    keywords: ['template', 'egg', 'nest', 'server template', 'setup'],
    permissions: ['template.read', 'admin.read'],
    badge: 'Admin',
    path: '/admin/templates',
  },
  {
    id: 'admin-alerts',
    label: 'Alerts',
    description: 'Configure alert rules and view triggered alerts',
    icon: Bell,
    to: '/admin/alerts',
    category: 'Admin',
    keywords: ['alert', 'notification', 'rule', 'cpu', 'memory', 'disk', 'threshold', 'monitoring'],
    permissions: ['alert.read', 'admin.read'],
    badge: 'Admin',
    path: '/admin/alerts',
  },
  {
    id: 'admin-databases',
    label: 'Database Hosts',
    description: 'MySQL and PostgreSQL host management',
    icon: DbIcon,
    to: '/admin/database',
    category: 'Admin',
    keywords: ['database', 'mysql', 'postgres', 'postgresql', 'db host', 'sql'],
    permissions: ['admin.read'],
    badge: 'Admin',
    path: '/admin/database',
  },
  {
    id: 'admin-activity',
    label: 'Activity Log',
    description: 'Real-time platform event stream',
    icon: Activity,
    to: '/admin/network',
    category: 'Admin',
    keywords: ['activity', 'events', 'stream', 'log', 'audit'],
    permissions: ['admin.read'],
    badge: 'Admin',
    path: '/admin/network',
  },
  {
    id: 'admin-system',
    label: 'System',
    description: 'Health, SMTP, and mod manager configuration',
    icon: Settings,
    to: '/admin/system',
    category: 'Admin',
    keywords: ['system', 'health', 'status', 'uptime', 'configuration'],
    permissions: ['admin.write'],
    badge: 'Admin',
    path: '/admin/system',
  },
  {
    id: 'admin-security',
    label: 'Security',
    description: 'Rate limits, lockout policy, and file tunnel settings',
    icon: Shield,
    to: '/admin/security',
    category: 'Admin',
    keywords: ['security', 'rate limit', 'lockout', 'brute force', 'throttle', 'firewall'],
    permissions: ['admin.read'],
    badge: 'Admin',
    path: '/admin/security',
  },
  {
    id: 'admin-audit-logs',
    label: 'Audit Logs',
    description: 'Detailed audit trail of all actions',
    icon: History,
    to: '/admin/audit-logs',
    category: 'Admin',
    keywords: ['audit', 'log', 'history', 'trail', 'compliance'],
    permissions: ['admin.read'],
    badge: 'Admin',
    path: '/admin/audit-logs',
  },
  {
    id: 'admin-api-keys',
    label: 'API Keys',
    description: 'Manage platform API keys and tokens',
    icon: Key,
    to: '/admin/api-keys',
    category: 'Admin',
    keywords: ['api key', 'token', 'api', 'authentication', 'key management'],
    permissions: ['apikey.manage', 'admin.read'],
    badge: 'Admin',
    path: '/admin/api-keys',
  },
  {
    id: 'admin-plugins',
    label: 'Plugins',
    description: 'Install and manage panel extensions',
    icon: Plug,
    to: '/admin/plugins',
    category: 'Admin',
    keywords: ['plugin', 'extension', 'addon', 'module', 'integration'],
    permissions: ['admin.read'],
    badge: 'Admin',
    path: '/admin/plugins',
  },
  {
    id: 'admin-migration',
    label: 'Migration',
    description: 'Import servers from Pterodactyl',
    icon: ArrowRightLeft,
    to: '/admin/migration',
    category: 'Admin',
    keywords: ['migration', 'pterodactyl', 'import', 'transfer', 'migrate'],
    permissions: ['admin.read'],
    badge: 'Admin',
    path: '/admin/migration',
  },

  // ── Theme Settings Deep Links ───────────────────────────
  {
    id: 'settings-theme-overview',
    label: 'Theme Settings',
    description: 'Branding, colors, palette, and appearance',
    icon: Palette,
    to: '/admin/theme-settings',
    category: 'Settings',
    keywords: ['theme', 'appearance', 'branding', 'look', 'style'],
    permissions: ['admin.write'],
    path: '/admin/theme-settings',
  },
  {
    id: 'settings-branding',
    label: 'Branding & Identity',
    description: 'Panel name, logo, and favicon',
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
    label: 'Color Palette Generator',
    description: 'Auto-generate a full theme from one seed color',
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
    label: 'Brand Colors',
    description: 'Primary, secondary, and accent color configuration',
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
    label: 'Semantic Colors',
    description: 'Success, warning, danger, and info feedback colors',
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
    label: 'Dark Mode Surfaces',
    description: 'Background, card, border, and elevation for dark theme',
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
    label: 'Light Mode Surfaces',
    description: 'Background, card, border, and elevation for light theme',
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
    label: 'Theme Mode',
    description: 'Default theme and available modes (light/dark)',
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
    label: 'Layout & Border Radius',
    description: 'Adjust border radius and spacing globally',
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
    label: 'Custom CSS',
    description: 'Inject custom CSS into every page',
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
    label: 'SSO / OAuth Providers',
    description: 'Configure WHMCS and Paymenter OIDC login',
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
    label: 'Rate Limits',
    description: 'Auth, file, console, and agent request limits',
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
    label: 'Lockout Policy',
    description: 'Failed login attempt lockout rules',
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
    label: 'Auth Lockouts',
    description: 'View and manage locked accounts',
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
    label: 'File Tunnel Settings',
    description: 'File transfer rate limits and upload sizes',
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
    label: 'Audit Retention',
    description: 'How long audit logs are kept',
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
    label: 'SMTP / Email',
    description: 'Outbound email configuration for alerts and invites',
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
    label: 'Mod Manager API Keys',
    description: 'CurseForge and Modrinth API keys for mod downloads',
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
    label: 'Platform Health',
    description: 'System status, node health, and database status',
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
    label: 'Node Allocations & IP Pools',
    description: 'Manage IP addresses, ports, and CIDR pools per node',
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
    label: 'Two-Factor Authentication',
    description: 'Enable TOTP authenticator app for your account',
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
    label: 'Passkeys / WebAuthn',
    description: 'Passwordless login with biometrics or security keys',
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
    label: 'SSO Linked Accounts',
    description: 'View and manage OAuth-linked login providers',
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
    label: 'Active Sessions',
    description: 'View and revoke active login sessions',
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
    label: 'Personal API Keys',
    description: 'Manage your personal API tokens',
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
    label: 'Personal Audit Log',
    description: 'Your recent activity and actions',
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

const SERVER_TABS: {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
}[] = [
  { key: 'console',        label: 'Console',         description: 'Live server terminal output',         icon: Terminal,   keywords: ['terminal', 'command', 'output', 'logs', 'stdin', 'stdout'] },
  { key: 'files',          label: 'File Manager',    description: 'Browse and edit server files',         icon: FolderOpen, keywords: ['file', 'files', 'browse', 'edit', 'upload', 'download', 'directory'] },
  { key: 'sftp',           label: 'SFTP Access',     description: 'SFTP connection details and credentials', icon: FolderSync, keywords: ['sftp', 'ftp', 'file transfer', 'sftp credentials', 'sftp info'] },
  { key: 'backups',        label: 'Backups',         description: 'Server backup management and restore', icon: HardDrive, keywords: ['backup', 'restore', 'snapshot', 'archive'] },
  { key: 'tasks',          label: 'Scheduled Tasks', description: 'Cron-like automation for server operations', icon: Clock, keywords: ['task', 'schedule', 'cron', 'automate', 'recurring', 'backup schedule'] },
  { key: 'databases',      label: 'Databases',       description: 'Server database management',           icon: DbIcon,     keywords: ['database', 'mysql', 'postgres', 'db'] },
  { key: 'metrics',        label: 'Metrics',         description: 'CPU, memory, disk, and network graphs', icon: BarChart3,  keywords: ['metrics', 'cpu', 'memory', 'ram', 'disk', 'network', 'usage', 'performance', 'graphs', 'charts'] },
  { key: 'alerts',         label: 'Alerts',          description: 'Server-specific alert rules and history', icon: Bell,      keywords: ['alert', 'notification', 'threshold', 'cpu alert', 'memory alert'] },
  { key: 'modManager',     label: 'Mod Manager',     description: 'Browse and install mods from CurseForge/Modrinth', icon: Package, keywords: ['mod', 'mods', 'curseforge', 'modrinth', 'plugin', 'modpack'] },
  { key: 'pluginManager',  label: 'Plugin Manager',  description: 'Install and manage server plugins',    icon: Plug,       keywords: ['plugin', 'plugins', 'extension', 'bukkit', 'spigot', 'paper'] },
  { key: 'configuration',  label: 'Configuration',   description: 'Server startup flags and JVM settings', icon: Wrench,     keywords: ['config', 'configuration', 'startup', 'jvm', 'flags', 'arguments', 'java options'] },
  { key: 'users',          label: 'Subusers',        description: 'Manage server access and permissions', icon: Users,      keywords: ['subuser', 'user', 'permission', 'access', 'share server', 'collaborator'] },
  { key: 'settings',       label: 'Server Settings', description: 'Rename, reinstall, and server preferences', icon: Settings, keywords: ['settings', 'rename', 'reinstall', 'preferences', 'server settings'] },
  { key: 'admin',          label: 'Server Admin',    description: 'Owner transfer, suspension, and admin actions', icon: Shield, keywords: ['admin', 'owner', 'transfer', 'suspend', 'unsuspend', 'delete', 'reinstall'] },
];

// ── Quick Actions ─────────────────────────────────────────

const QUICK_ACTIONS: Omit<SearchItem, 'category'>[] = [
  {
    id: 'action-create-server',
    label: 'Create New Server',
    description: 'Deploy a new game server from a template',
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
  const { user } = useAuthStore();
  const { data: servers, isLoading: serversLoading } = useServers();
  const { data: nodes, isLoading: nodesLoading } = useNodes();
  const { data: templates, isLoading: templatesLoading } = useTemplates();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeCategory, setActiveCategory] = useState<SearchCategory | 'All'>('All');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prevIsOpenRef = useRef(isOpen);

  const userPermissions = user?.permissions || [];

  // ── Static items (permission-filtered) ──

  const staticItems = useMemo((): SearchItem[] => {
    return STATIC_ITEMS.filter((item) => {
      if (item.permissions) return hasAnyPermission(userPermissions, item.permissions);
      return true;
    });
  }, [userPermissions]);

  // ── Dynamic items (servers, nodes, templates, server tabs, actions) ──

  const dynamicItems = useMemo((): SearchItem[] => {
    const items: SearchItem[] = [];

    // Servers + their tabs
    if (servers) {
      for (const server of servers as any[]) {
        items.push({
          id: `server-${server.id}`,
          label: server.name,
          description: server.node?.name || 'Unknown node',
          icon: Server,
          to: `/servers/${server.id}`,
          category: 'Servers',
          keywords: [server.node?.name || '', server.status || '', 'game server'],
          path: `/servers/${server.id}`,
        });

        for (const tab of SERVER_TABS) {
          items.push({
            id: `server-${server.id}-tab-${tab.key}`,
            label: `${server.name} — ${tab.label}`,
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
    if (nodes) {
      for (const node of nodes as any[]) {
        items.push({
          id: `node-${node.id}`,
          label: node.name,
          description: `${node.fqdn || node.host || ''} · ${node.allocationsCount ?? 0} allocations`,
          icon: MonitorDot,
          to: `/admin/nodes/${node.id}`,
          category: 'Nodes',
          keywords: [node.fqdn || '', node.host || '', 'node', 'machine'],
          badge: 'Admin',
          path: `/admin/nodes/${node.id}`,
        });
        items.push({
          id: `node-${node.id}-allocations`,
          label: `${node.name} — Allocations`,
          description: 'IP pools, ports, and CIDR management',
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
    if (templates) {
      for (const tmpl of templates as any[]) {
        items.push({
          id: `template-${tmpl.id}`,
          label: tmpl.name,
          description: tmpl.description || tmpl.nest || 'Server template',
          icon: FileText,
          to: `/admin/templates/${tmpl.id}`,
          category: 'Templates',
          keywords: [tmpl.nest || '', 'template', 'egg', 'server template'],
          badge: 'Admin',
          path: `/admin/templates/${tmpl.id}`,
        });
      }
    }

    // Quick actions
    for (const action of QUICK_ACTIONS) {
      items.push({ ...action, category: 'Actions' as SearchCategory });
    }

    return items;
  }, [servers, nodes, templates]);

  // ── Combined ──

  const combinedItems = useMemo(
    () => [...staticItems, ...dynamicItems],
    [staticItems, dynamicItems],
  );

  // ── Available categories ──

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
        className="fixed inset-0 z-[100] overflow-y-auto p-4"
      >
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-md"
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
          <div className="overflow-hidden rounded-2xl border border-border bg-surface-0/95 shadow-2xl backdrop-blur-xl">
            {/* ── Search Input ── */}
            <div className="flex items-center border-b border-border px-4">
              <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search pages, settings, servers, nodes…"
                className="flex-1 border-none bg-transparent px-3 py-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0"
              />
              {isLoading && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              <button
                type="button"
                onClick={onClose}
                className="ml-2 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ── Category Pills (visible when no query) ── */}
            {!query.trim() && availableCategories.length > 1 && (
              <div className="sticky top-0 z-10 flex gap-1.5 overflow-x-auto border-b border-border bg-surface-0/80 px-4 py-2 backdrop-blur-xl scrollbar-none">
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
                  All
                </button>
                {availableCategories.map((cat) => {
                  const meta = CATEGORY_META[cat];
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
                  <p className="text-sm font-medium text-muted-foreground">No results found</p>
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    Try different keywords or clear the filter
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {groupedItems.map(({ category, items }) => {
                    const meta = CATEGORY_META[category];
                    const CatIcon = meta.icon;

                    return (
                      <div key={category}>
                        {/* Group header */}
                        <div className="sticky top-0 z-10 flex items-center gap-2 bg-surface-0/80 px-4 py-1.5 backdrop-blur-xl">
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
                    <Command className="inline h-2.5 w-2.5" />K
                  </kbd>
                  open
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">↑↓</kbd>
                  navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">↵</kbd>
                  select
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">esc</kbd>
                  close
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground/40">
                {flatItems.length} result{flatItems.length !== 1 ? 's' : ''}
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
