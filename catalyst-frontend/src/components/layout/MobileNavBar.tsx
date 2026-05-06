import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { hasAnyAdminPermission } from '../auth/ProtectedRoute';
import { LayoutDashboard, Server, Shield, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileNavBarProps {
  onOpenSidebar: () => void;
}

const primaryItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/servers', label: 'Servers', icon: Server },
];

export default function MobileNavBar({ onOpenSidebar }: MobileNavBarProps) {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const userPermissions = user?.permissions || [];
  const isAdmin = hasAnyAdminPermission(userPermissions);

  const navItems = isAdmin
    ? [...primaryItems, { to: '/admin', label: 'Admin', icon: Shield }]
    : primaryItems;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-surface-0/95 backdrop-blur-md lg:hidden">
      <div className="flex h-14 items-center justify-around px-2">
        {navItems.map(({ to, label, icon: Icon }) => {
          const isActive =
            location.pathname === to ||
            (to !== '/admin' && location.pathname.startsWith(`${to}/`));
          return (
            <NavLink
              key={to}
              to={to}
              className={cn(
                'flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-xl transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-transparent',
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <span>{label}</span>
            </NavLink>
          );
        })}

        <button
          type="button"
          onClick={onOpenSidebar}
          className="flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl">
            <Menu className="h-5 w-5" />
          </div>
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
