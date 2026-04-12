import { Link } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';

function Header() {
  const { user, logout } = useAuthStore();
  const { toggleSidebar, sidebarCollapsed, themeSettings } = useThemeStore();

  const initials =
    user?.username?.slice(0, 2).toUpperCase() ||
    user?.email?.slice(0, 2).toUpperCase() ||
    'U';

  const panelName = themeSettings?.panelName || 'Catalyst';
  const logoUrl = themeSettings?.logoUrl || '/logo.png';

  return (
    <header className="sticky top-0 z-50 flex h-12 items-center justify-between border-b border-border bg-surface-0/90 backdrop-blur-md px-4">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={toggleSidebar}
          className="rounded-md border border-border bg-surface-1 px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
        >
          {sidebarCollapsed ? 'Expand' : 'Collapse'}
        </button>
        <Link
          to="/dashboard"
          className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground"
        >
          <img src={logoUrl} alt={`${panelName} logo`} className="h-5 w-5" onError={(e) => {
            e.currentTarget.style.display = 'none';
          }} />
          <span className="truncate">{panelName}</span>
        </Link>
      </div>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface-1 text-xs font-semibold text-foreground transition-colors hover:border-primary/30"
            >
              {initials}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={8} className="w-52">
            <div className="space-y-1">
              <div className="px-2 pb-2 pt-1 text-xs text-muted-foreground">
                {user?.email ?? 'demo@catalyst.local'}
              </div>
              <Link
                to="/profile"
                className="flex items-center rounded-md px-2 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
              >
                Profile
              </Link>
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
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
