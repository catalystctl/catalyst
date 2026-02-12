import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import ProtectedRoute, { hasAnyAdminPermission } from './components/auth/ProtectedRoute';
import { ToastProvider } from './components/providers/ToastProvider';
import { useAuthInit } from './hooks/useAuthInit';
import ErrorBoundary from './components/shared/ErrorBoundary';
import { useThemeStore } from './stores/themeStore';
import { themeApi } from './services/api/theme';
import { adminApi } from './services/api/admin';
import { useAuthStore } from './stores/authStore';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import TwoFactorPage from './pages/auth/TwoFactorPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import ServersPage from './pages/servers/ServersPage';
import ServerDetailsPage from './pages/servers/ServerDetailsPage';
import NodeDetailsPage from './pages/nodes/NodeDetailsPage';
import TemplatesPage from './pages/templates/TemplatesPage';
import TemplateDetailsPage from './pages/templates/TemplateDetailsPage';
import AdminTemplatesPage from './pages/admin/TemplatesPage';
import AdminNodesPage from './pages/admin/NodesPage';
import AdminServersPage from './pages/admin/ServersPage';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import NetworkPage from './pages/admin/NetworkPage';
import DatabasePage from './pages/admin/DatabasePage';
import AdminAlertsPage from './pages/admin/AlertsPage';
import UsersPage from './pages/admin/UsersPage';
import RolesPage from './pages/admin/RolesPage';
import SystemPage from './pages/admin/SystemPage';
import AuditLogsPage from './pages/admin/AuditLogsPage';
import SecurityPage from './pages/admin/SecurityPage';
import ThemeSettingsPage from './pages/admin/ThemeSettingsPage';
import PluginsPage from './pages/admin/PluginsPage';
import InvitesPage from './pages/InvitesPage';
import ProfilePage from './pages/ProfilePage';
import NotFoundPage from './pages/NotFoundPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import PluginTabPage from './pages/PluginTabPage';
import { PluginProvider } from './plugins/PluginProvider';
import NodeAllocationsPage from './pages/admin/NodeAllocationsPage';

function App() {
  useAuthInit();
  const { theme, setThemeSettings, applyTheme, injectCustomCss } = useThemeStore();
  const { user, isAuthenticated } = useAuthStore();

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

  return (
    <ErrorBoundary>
      <ToastProvider />
      <PluginProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/two-factor" element={<TwoFactorPage />} />
        <Route path="/invites/:token" element={<InvitesPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="servers" element={<ServersPage />} />
          <Route path="servers/:serverId/:tab?" element={<ServerDetailsPage />} />
            <Route
              path="admin/nodes/:nodeId"
              element={
                <ProtectedRoute requireAdmin>
                  <NodeDetailsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/nodes/:nodeId/allocations"
              element={
                <ProtectedRoute requireAdmin>
                  <NodeAllocationsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/templates/:templateId"
              element={
                <ProtectedRoute requirePermissions={['template.read', 'template.create', 'template.update', 'template.delete', 'admin.read', 'admin.write']}>
                  <TemplateDetailsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin"
              element={
                <ProtectedRoute requirePermissions={['admin.read', 'admin.write']}>
                  <AdminDashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/users"
              element={
                <ProtectedRoute requirePermissions={['user.read', 'user.create', 'user.update', 'user.delete', 'user.set_roles', 'admin.read', 'admin.write']}>
                  <UsersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/roles"
              element={
                <ProtectedRoute requirePermissions={['role.read', 'role.create', 'role.update', 'role.delete', 'admin.read', 'admin.write']}>
                  <RolesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/servers"
              element={
                <ProtectedRoute requirePermissions={['server.read', 'server.create', 'server.delete', 'admin.read', 'admin.write']}>
                  <AdminServersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/nodes"
              element={
                <ProtectedRoute requirePermissions={['node.read', 'node.create', 'node.update', 'node.delete', 'admin.read', 'admin.write']}>
                  <AdminNodesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/templates"
              element={
                <ProtectedRoute requirePermissions={['template.read', 'template.create', 'template.update', 'template.delete', 'admin.read', 'admin.write']}>
                  <AdminTemplatesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/database"
              element={
                <ProtectedRoute requirePermissions={['admin.read', 'admin.write']}>
                  <DatabasePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/network"
              element={
                <ProtectedRoute requirePermissions={['admin.read', 'admin.write']}>
                  <NetworkPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/system"
              element={
                <ProtectedRoute requireAdminWrite>
                  <SystemPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/security"
              element={
                <ProtectedRoute requirePermissions={['admin.read', 'admin.write']}>
                  <SecurityPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/theme-settings"
              element={
                <ProtectedRoute requireAdminWrite>
                  <ThemeSettingsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/alerts"
              element={
                <ProtectedRoute requirePermissions={['alert.read', 'alert.create', 'alert.update', 'alert.delete', 'admin.read', 'admin.write']}>
                  <AdminAlertsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/audit-logs"
              element={
                <ProtectedRoute requirePermissions={['admin.read', 'admin.write']}>
                  <AuditLogsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/api-keys"
              element={
                <ProtectedRoute requirePermissions={['apikey.manage', 'admin.read', 'admin.write']}>
                  <ApiKeysPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/plugins"
              element={
                <ProtectedRoute requirePermissions={['admin.read', 'admin.write']}>
                  <PluginsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/plugin/:pluginTabId"
              element={
                <ProtectedRoute requirePermissions={['admin.read', 'admin.write']}>
                  <PluginTabPage location="admin" />
                </ProtectedRoute>
              }
            />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </PluginProvider>
    </ErrorBoundary>
  );
}

export default App;
