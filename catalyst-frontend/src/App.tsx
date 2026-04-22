import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import SetupPage from './pages/setup/SetupPage';
import { useSetupStatus } from './hooks/useSetupStatus';
import { motion, AnimatePresence } from 'framer-motion';
import AppLayout from './components/layout/AppLayout';
import ProtectedRoute, { hasAnyAdminPermission } from './components/auth/ProtectedRoute';
import { ToastProvider } from './components/providers/ToastProvider';
import { useAuthInit } from './hooks/useAuthInit';
import ErrorBoundary from './components/shared/ErrorBoundary';
import { useThemeStore } from './stores/themeStore';
import { themeApi } from './services/api/theme';
import { adminApi } from './services/api/admin';
import { useAuthStore } from './stores/authStore';
import { shallow } from 'zustand/shallow';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import TwoFactorPage from './pages/auth/TwoFactorPage';
import InvitesPage from './pages/InvitesPage';
import NotFoundPage from './pages/NotFoundPage';
import { PluginProvider } from './plugins/PluginProvider';
import PluginRoutePage from './pages/PluginRoutePage';
import { ApiKeysPage } from './pages/ApiKeysPage';

// Lazy-loaded pages for code splitting — reduces initial bundle size
// Auth pages stay eager so the login screen renders instantly
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage'));
const ServersPage = lazy(() => import('./pages/servers/ServersPage'));
const ServerDetailsPage = lazy(() => import('./pages/servers/ServerDetailsPage'));
const NodeDetailsPage = lazy(() => import('./pages/nodes/NodeDetailsPage'));
const TemplatesPage = lazy(() => import('./pages/templates/TemplatesPage'));
const TemplateDetailsPage = lazy(() => import('./pages/templates/TemplateDetailsPage'));
const AdminNodesPage = lazy(() => import('./pages/admin/NodesPage'));
const AdminServersPage = lazy(() => import('./pages/admin/ServersPage'));
const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage'));
const ActivityPage = lazy(() => import('./pages/admin/NetworkPage'));
const DatabasePage = lazy(() => import('./pages/admin/DatabasePage'));
const AdminAlertsPage = lazy(() => import('./pages/admin/AlertsPage'));
const UsersPage = lazy(() => import('./pages/admin/UsersPage'));
const RolesPage = lazy(() => import('./pages/admin/RolesPage'));
const SystemPage = lazy(() => import('./pages/admin/SystemPage'));
const AuditLogsPage = lazy(() => import('./pages/admin/AuditLogsPage'));
const SecurityPage = lazy(() => import('./pages/admin/SecurityPage'));
const ThemeSettingsPage = lazy(() => import('./pages/admin/ThemeSettingsPage'));
const PluginsPage = lazy(() => import('./pages/admin/PluginsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));

const PluginTabPage = lazy(() => import('./pages/PluginTabPage'));
const NodeAllocationsPage = lazy(() => import('./pages/admin/NodeAllocationsPage'));
const MigrationPage = lazy(() => import('./pages/admin/MigrationPage'));

/** Minimal page-level loading skeleton */
function PageFallback() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

/** Smooth page transition wrapper */
function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="h-full"
    >
      {children}
    </motion.div>
  );
}

function App() {
  useAuthInit();
  const theme = useThemeStore((s) => s.theme);
  const setThemeSettings = useThemeStore((s) => s.setThemeSettings);
  const applyTheme = useThemeStore((s) => s.applyTheme);
  const injectCustomCss = useThemeStore((s) => s.injectCustomCss);
  const { user, isAuthenticated, isReady } = useAuthStore(
    (s) => ({ user: s.user, isAuthenticated: s.isAuthenticated, isReady: s.isReady }),
    shallow,
  );
  const { setupRequired, isLoading: isSetupLoading } = useSetupStatus();

  // Load public theme settings on mount
  useEffect(() => {
    const loadThemeSettings = async () => {
      try {
        const settings = await themeApi.getPublicSettings();
        setThemeSettings(settings);
      } catch (error) {
        console.error('Failed to load theme settings:', error);
        // Continue with defaults
      }
    };
    loadThemeSettings();
  }, [setThemeSettings]);

  // Load custom CSS for admin users
  useEffect(() => {
    const loadCustomCss = async () => {
      if (!isAuthenticated || !user) return;

      const hasAdminAccess =
        user?.permissions?.includes('*') ||
        user?.permissions?.includes('admin.write') ||
        user?.permissions?.includes('admin.read') ||
        hasAnyAdminPermission(user?.permissions);

      if (hasAdminAccess) {
        try {
          const fullSettings = await adminApi.getThemeSettings();
          if (fullSettings.customCss) {
            injectCustomCss(fullSettings.customCss);
          }
        } catch (error) {
          console.error('Failed to load custom CSS:', error);
        }
      }
    };
    loadCustomCss();
  }, [isAuthenticated, user, injectCustomCss]);

  // Apply theme whenever it changes
  useEffect(() => {
    applyTheme();
  }, [theme, applyTheme]);

  // Full-screen loading while auth initializes or setup status is checked
  if (!isReady || isSetupLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Redirect unauthenticated users to /setup when OOBE is required
  if (setupRequired && !isAuthenticated) {
    return (
      <ErrorBoundary>
        <ToastProvider />
        <PluginProvider>
          <AnimatePresence initial={false}>
            <Routes>
              <Route path="/setup" element={<SetupPage />} />
              <Route path="*" element={<Navigate to="/setup" replace />} />
            </Routes>
          </AnimatePresence>
        </PluginProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ToastProvider />
      <PluginProvider>
        <AnimatePresence initial={false}>
          <Routes>
            {/* OOBE setup wizard — accessible even when setup is done (page redirects if not needed) */}
            <Route path="/setup" element={<SetupPage />} />

            {/* Auth pages — rendered immediately for fast login */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/two-factor" element={<TwoFactorPage />} />
            <Route path="/invites/:token" element={<InvitesPage />} />

            {/* Protected app shell — auth pages are NOT wrapped here */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />

              <Route
                path="dashboard"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <PageTransition>
                      <DashboardPage />
                    </PageTransition>
                  </Suspense>
                }
              />
              <Route
                path="profile"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <PageTransition>
                      <ProfilePage />
                    </PageTransition>
                  </Suspense>
                }
              />
              <Route
                path="servers"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <PageTransition>
                      <ServersPage />
                    </PageTransition>
                  </Suspense>
                }
              />
              <Route
                path="servers/:serverId/:tab?"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <PageTransition>
                      <ServerDetailsPage />
                    </PageTransition>
                  </Suspense>
                }
              />
              <Route
                path="admin/nodes/:nodeId"
                element={
                  <ProtectedRoute requireAdmin>
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <NodeDetailsPage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/nodes/:nodeId/allocations"
                element={
                  <ProtectedRoute requireAdmin>
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <NodeAllocationsPage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/templates/:templateId"
                element={
                  <ProtectedRoute
                    requirePermissions={[
                      'template.read',
                      'template.create',
                      'template.update',
                      'template.delete',
                      'admin.read',
                      'admin.write',
                    ]}
                  >
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <TemplateDetailsPage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin"
                element={
                  <ProtectedRoute requirePermissions={['admin.read', 'admin.write']}>
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <AdminDashboardPage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/users"
                element={
                  <ProtectedRoute
                    requirePermissions={[
                      'user.read',
                      'user.create',
                      'user.update',
                      'user.delete',
                      'user.set_roles',
                      'admin.read',
                      'admin.write',
                    ]}
                  >
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <UsersPage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/roles"
                element={
                  <ProtectedRoute
                    requirePermissions={[
                      'role.read',
                      'role.create',
                      'role.update',
                      'role.delete',
                      'admin.read',
                      'admin.write',
                    ]}
                  >
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <RolesPage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/servers"
                element={
                  <ProtectedRoute
                    requirePermissions={['admin.read', 'admin.write']}
                    redirectTo="/servers"
                  >
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <AdminServersPage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/nodes"
                element={
                  <ProtectedRoute
                    requirePermissions={[
                      'node.read',
                      'node.create',
                      'node.update',
                      'node.delete',
                      'admin.read',
                      'admin.write',
                    ]}
                  >
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <AdminNodesPage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/templates"
                element={
                  <ProtectedRoute
                    requirePermissions={[
                      'template.read',
                      'template.create',
                      'template.update',
                      'template.delete',
                      'admin.read',
                      'admin.write',
                    ]}
                  >
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <div className="space-y-6">
                          <TemplatesPage />
                        </div>
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/database"
                element={
                  <ProtectedRoute requirePermissions={['admin.read', 'admin.write']}>
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <DatabasePage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/network"
                element={
                  <ProtectedRoute requirePermissions={['admin.read', 'admin.write']}>
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <ActivityPage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/system"
                element={
                  <ProtectedRoute requireAdminWrite>
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <SystemPage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/security"
                element={
                  <ProtectedRoute requirePermissions={['admin.read', 'admin.write']}>
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <SecurityPage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/theme-settings"
                element={
                  <ProtectedRoute requireAdminWrite>
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <ThemeSettingsPage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/alerts"
                element={
                  <ProtectedRoute
                    requirePermissions={[
                      'alert.read',
                      'alert.create',
                      'alert.update',
                      'alert.delete',
                      'admin.read',
                      'admin.write',
                    ]}
                  >
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <AdminAlertsPage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/audit-logs"
                element={
                  <ProtectedRoute requirePermissions={['admin.read', 'admin.write']}>
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <AuditLogsPage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/api-keys"
                element={
                  <ProtectedRoute
                    requirePermissions={['apikey.manage', 'admin.read', 'admin.write']}
                  >
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <ApiKeysPage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/migration"
                element={
                  <ProtectedRoute requirePermissions={['admin.read', 'admin.write']}>
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <MigrationPage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/plugins"
                element={
                  <ProtectedRoute requirePermissions={['admin.read', 'admin.write']}>
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <PluginsPage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="admin/plugin/:pluginTabId"
                element={
                  <ProtectedRoute requirePermissions={['admin.read', 'admin.write']}>
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <PluginTabPage location="admin" />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />
            </Route>

              {/* Plugin dynamic routes — /${pluginName} for each plugin's UserPage */}
              {/* Must come AFTER all static routes to avoid conflicts. */}
              <Route
                path="tickets"
                element={<Navigate to="/ticketing-plugin" replace />}
              />
              <Route
                path={":pluginRouteName"}
                element={
                  <ProtectedRoute>
                    <Suspense fallback={<PageFallback />}>
                      <PageTransition>
                        <PluginRoutePage />
                      </PageTransition>
                    </Suspense>
                  </ProtectedRoute>
                }
              />

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </AnimatePresence>
      </PluginProvider>
    </ErrorBoundary>
  );
}

export default App;
