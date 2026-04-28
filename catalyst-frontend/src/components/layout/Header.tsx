import { Link } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';

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
    <header className="sticky top-0 z-50 flex items-center justify-between border-b border-border bg-card px-4 py-3 shadow-surface-light transition-all duration-300 dark:border-border dark:bg-surface-1 dark:shadow-surface-dark">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={toggleSidebar}
          className="rounded-lg border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground transition-all duration-300 hover:border-border hover:text-foreground dark:border-border dark:bg-surface-1 dark:text-muted-foreground dark:hover:border-border dark:hover:text-foreground"
        >
          {sidebarCollapsed ? 'Expand' : 'Collapse'}
        </button>
        <Link
          to="/dashboard"
          className="flex min-w-0 items-center gap-2 font-display text-lg font-semibold text-foreground transition-all duration-300 dark:text-foreground"
        >
          <img src={logoUrl} alt={`${panelName} logo`} className="h-6 w-6" onError={(e) => {
            e.currentTarget.style.display = 'none';
          }} />
          <span className="truncate">{panelName}</span>
        </Link>
      </div>
      <div className="flex items-center gap-3 text-sm text-muted-foreground transition-all duration-300 dark:text-muted-foreground">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-xs font-semibold text-muted-foreground shadow-sm transition-all duration-300 hover:border-border hover:text-foreground dark:border-border dark:bg-surface-1 dark:text-foreground dark:hover:border-border dark:hover:text-foreground overflow-hidden"
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
                <div className="text-sm font-medium text-foreground dark:text-foreground">{displayName}</div>
                <div className="text-xs text-muted-foreground dark:text-muted-foreground">
                  {user?.email ?? 'demo@catalyst.local'}
                </div>
              </div>
              <Link
                to="/profile"
                className="flex items-center rounded-lg px-2 py-1.5 text-sm font-medium text-muted-foreground transition-all duration-300 hover:bg-surface-2 hover:text-foreground dark:text-foreground dark:hover:bg-surface-2 dark:hover:text-foreground"
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
