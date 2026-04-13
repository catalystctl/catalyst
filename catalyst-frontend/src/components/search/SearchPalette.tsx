import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  Search,
  X,
  LayoutDashboard,
  Server,
  Users,
  Shield,
  Network,
  FileText,
  Bell,
  Database,
  Globe,
  Settings,
  Key,
  Plug,
  Palette,
  Plus,
  Command,
  Loader2,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { hasAnyPermission } from '../auth/ProtectedRoute';
import { useServers } from '../../hooks/useServers';
import { cn } from '../../lib/utils';

interface SearchItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  to?: string;
  action?: () => void;
  category: string;
  keywords?: string[];
  permissions?: string[];
}

const navigationItems: Omit<SearchItem, 'category'>[] = [
  { id: 'nav-dashboard', label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard' },
  { id: 'nav-servers', label: 'Servers', icon: Server, to: '/servers' },
  { id: 'nav-profile', label: 'Profile', icon: Users, to: '/profile', description: 'Your account settings' },
];

const adminNavigationItems: Omit<SearchItem, 'category'>[] = [
  { id: 'nav-admin', label: 'Admin Overview', icon: LayoutDashboard, to: '/admin', permissions: ['admin.read', 'admin.write'] },
  { id: 'nav-users', label: 'Users', icon: Users, to: '/admin/users', permissions: ['user.read', 'admin.read'] },
  { id: 'nav-roles', label: 'Roles', icon: Shield, to: '/admin/roles', permissions: ['role.read', 'admin.read'] },
  { id: 'nav-nodes', label: 'Nodes', icon: Network, to: '/admin/nodes', permissions: ['node.read', 'admin.read'] },
  { id: 'nav-admin-servers', label: 'All Servers', icon: Server, to: '/admin/servers', permissions: ['server.read', 'admin.read'] },
  { id: 'nav-templates', label: 'Templates', icon: FileText, to: '/admin/templates', permissions: ['template.read', 'admin.read'] },
  { id: 'nav-alerts', label: 'Alerts', icon: Bell, to: '/admin/alerts', permissions: ['alert.read', 'admin.read'] },
  { id: 'nav-databases', label: 'Databases', icon: Database, to: '/admin/database', permissions: ['admin.read'] },
  { id: 'nav-network', label: 'Network', icon: Globe, to: '/admin/network', permissions: ['admin.read'] },
  { id: 'nav-system', label: 'System', icon: Settings, to: '/admin/system', permissions: ['admin.write'] },
  { id: 'nav-security', label: 'Security', icon: Shield, to: '/admin/security', permissions: ['admin.read'] },
  { id: 'nav-audit-logs', label: 'Audit Logs', icon: FileText, to: '/admin/audit-logs', permissions: ['admin.read'] },
  { id: 'nav-api-keys', label: 'API Keys', icon: Key, to: '/admin/api-keys', permissions: ['apikey.manage', 'admin.read'] },
  { id: 'nav-plugins', label: 'Plugins', icon: Plug, to: '/admin/plugins', permissions: ['admin.read'] },
  { id: 'nav-theme', label: 'Theme Settings', icon: Palette, to: '/admin/theme-settings', permissions: ['admin.write'] },
];

interface SearchPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateServer?: () => void;
}

function SearchPalette({ isOpen, onClose, onCreateServer }: SearchPaletteProps) {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { data: servers, isLoading: serversLoading } = useServers();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prevQueryRef = useRef(query);
  const prevIsOpenRef = useRef(isOpen);

  const userPermissions = user?.permissions || [];

  const visibleAdminNavItems = useMemo(() => {
    return adminNavigationItems.filter((item) => {
      if (!item.permissions) return true;
      return hasAnyPermission(userPermissions, item.permissions);
    });
  }, [userPermissions]);

  const allItems = useMemo((): SearchItem[] => {
    const items: SearchItem[] = [];
    navigationItems.forEach((item) => items.push({ ...item, category: 'Navigation' }));
    visibleAdminNavItems.forEach((item) => items.push({ ...item, category: 'Admin' }));
    if (servers) {
      servers.forEach((server) => {
        items.push({
          id: `server-${server.id}`,
          label: server.name,
          description: server.node?.name || 'Unknown node',
          icon: Server,
          to: `/servers/${server.id}`,
          category: 'Servers',
          keywords: [server.node?.name || ''],
        });
      });
    }
    items.push({
      id: 'action-create-server',
      label: 'Create New Server',
      icon: Plus,
      action: onCreateServer,
      category: 'Actions',
      description: 'Create a new game server',
    });
    return items;
  }, [servers, visibleAdminNavItems, onCreateServer]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems;
    const lowerQuery = query.toLowerCase();
    return allItems.filter((item) => {
      const labelMatch = item.label.toLowerCase().includes(lowerQuery);
      const descMatch = item.description?.toLowerCase().includes(lowerQuery);
      const keywordMatch = item.keywords?.some((k) => k.toLowerCase().includes(lowerQuery));
      return labelMatch || descMatch || keywordMatch;
    });
  }, [allItems, query]);

  const groupedItems = useMemo(() => {
    const groups: Record<string, SearchItem[]> = {};
    filteredItems.forEach((item) => {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    });
    return groups;
  }, [filteredItems]);

  const flatItems = filteredItems;

  // Reset state when palette opens
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      // Use functional updater to avoid synchronous setState in effect body
      setQuery((prev) => {
        setSelectedIndex(0);
        setTimeout(() => { inputRef.current?.focus(); }, 0);
        return '';
      });
    }
    if (query !== prevQueryRef.current) setSelectedIndex(0);
    prevQueryRef.current = query;
    prevIsOpenRef.current = isOpen;
  }, [query, isOpen]);

  useEffect(() => {
    if (listRef.current && flatItems.length > 0) {
      const selectedElement = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      if (selectedElement) selectedElement.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, flatItems.length]);

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
            if (item.to) { navigate(item.to); onClose(); }
            else if (item.action) { item.action(); onClose(); }
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [flatItems, selectedIndex, navigate, onClose],
  );

  const handleItemClick = (item: SearchItem) => {
    if (item.to) { navigate(item.to); onClose(); }
    else if (item.action) { item.action(); onClose(); }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity" onClick={onClose} aria-hidden="true" />
      <div className="relative mx-auto max-w-xl mt-[10vh]">
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-elevated dark:shadow-elevated-dark">
          <div className="flex items-center border-b border-border px-4">
            <Search className="h-5 w-5 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search pages, servers, actions..."
              className="flex-1 border-none bg-transparent px-3 py-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0"
            />
            {serversLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <button
              type="button"
              onClick={onClose}
              className="ml-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2">
            {flatItems.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <Search className="mx-auto mb-2 h-8 w-8 opacity-50" />
                <p>No results found</p>
              </div>
            ) : (
              Object.entries(groupedItems).map(([category, items]) => (
                <div key={category} className="mb-2">
                  <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {category}
                  </div>
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
                          'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                          isSelected
                            ? 'bg-primary/10 text-primary'
                            : 'text-foreground hover:bg-surface-2'
                        )}
                      >
                        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{item.label}</div>
                          {item.description && (
                            <div className="text-xs text-muted-foreground truncate">{item.description}</div>
                          )}
                        </div>
                        {isSelected && (
                          <div className="text-xs text-muted-foreground">
                            <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">Enter</kbd>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">
                  <Command className="inline h-3 w-3" />K
                </kbd>
                <span>to open</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">Esc</kbd>
                <span>to close</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">↑↓</kbd>
              <span>to navigate</span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default SearchPalette;
