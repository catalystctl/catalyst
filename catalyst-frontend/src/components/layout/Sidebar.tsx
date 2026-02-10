import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { hasAnyAdminPermission } from '../auth/ProtectedRoute';

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/servers', label: 'Servers' },
  { to: '/admin', label: 'Admin', adminOnly: true },
];

function Sidebar() {
  const { sidebarCollapsed, theme, setTheme } = useUIStore();
  const { user } = useAuthStore();
  const isAdmin =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.write') ||
    user?.permissions?.includes('admin.read') ||
    hasAnyAdminPermission(user?.permissions);
  return (
    <aside
      className={`sticky top-[73px] flex h-[calc(100vh-73px)] flex-col border-r border-slate-200 bg-white px-2 py-6 text-sm shadow-surface-light transition-all duration-300 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark ${
        sidebarCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      <nav className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {links
          .filter((link) => (link.adminOnly ? isAdmin : true))
          .map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `flex items-center rounded-md px-3 py-2 font-medium transition-all duration-300 ${
                  isActive
                    ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/20'
                    : 'text-slate-600 hover:border-primary-500 hover:bg-slate-50 dark:text-slate-300 dark:hover:border-primary-500/30 dark:hover:bg-slate-800'
                } ${sidebarCollapsed ? 'justify-center' : ''}`
              }
            >
              <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 dark:text-slate-500">
                {sidebarCollapsed ? link.label[0] : ''}
              </span>
              <span className={`${sidebarCollapsed ? 'sr-only' : 'ml-2'}`}>{link.label}</span>
            </NavLink>
          ))}
      </nav>
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className={`w-full rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30 ${
            sidebarCollapsed ? 'px-2' : ''
          }`}
        >
          {sidebarCollapsed ? (theme === 'dark' ? '☀︎' : '☾') : `Theme: ${theme}`}
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
