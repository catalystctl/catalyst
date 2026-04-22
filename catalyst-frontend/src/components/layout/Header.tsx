import { Link } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';
import { shallow } from 'zustand/shallow';

function Header() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const toggleSidebar = useThemeStore((s) => s.toggleSidebar);
  const sidebarCollapsed = useThemeStore((s) => s.sidebarCollapsed);
  const themeSettings = useThemeStore((s) => s.themeSettings);

  const displayName = user?.firstName || user?.lastName
    ? [user.firstName, user.lastName].filter(Boolean).join(' ')
    : user?.username || 'User';
  const initials =
    displayName.slice(0, 2).toUpperCase() ||
    user?.email?.slice(0, 2).toUpperCase() ||
    'U';

  const panelName = themeSettings?.panelName || 'Catalyst';
  const logoUrl = themeSettings?.logoUrl || '/logo.png';

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 shadow-surface-light transition-all duration-300 dark:border-zinc-800 dark:bg-surface-1 dark:shadow-surface-dark">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={toggleSidebar}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-600 transition-all duration-300 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-surface-1 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-100"
        >
          {sidebarCollapsed ? 'Expand' : 'Collapse'}
        </button>
        <Link
          to="/dashboard"
          className="flex min-w-0 items-center gap-2 font-display text-lg font-semibold text-zinc-900 transition-all duration-300 dark:text-zinc-100"
        >
          <img src={logoUrl} alt={`${panelName} logo`} className="h-6 w-6" onError={(e) => {
            e.currentTarget.style.display = 'none';
          }} />
          <span className="truncate">{panelName}</span>
        </Link>
      </div>
      <div className="flex items-center gap-3 text-sm text-zinc-600 transition-all duration-300 dark:text-zinc-400">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white text-xs font-semibold text-zinc-700 shadow-sm transition-all duration-300 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-surface-1 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100 overflow-hidden"
            >
              {user?.image
                ? <img src={user.image} alt="" className="h-full w-full object-cover" />
                : initials
              }
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={8} className="w-56">
            <div className="space-y-1">
              <div className="px-2 pb-2 pt-1">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{displayName}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {user?.email ?? 'demo@catalyst.local'}
                </div>
              </div>
              <Link
                to="/profile"
                className="flex items-center rounded-lg px-2 py-1.5 text-sm font-medium text-zinc-700 transition-all duration-300 hover:bg-surface-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-surface-2 dark:hover:text-zinc-100"
              >
                Profile
              </Link>
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm font-medium text-danger transition-all duration-300 hover:bg-danger/10"
              >
                Logout
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  );
}

export default Header;
