import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AdminTabs from '../../components/admin/AdminTabs';
import { useThemeSettings } from '../../hooks/useAdmin';
import { adminApi } from '../../services/api/admin';
import { useThemeStore } from '../../stores/themeStore';

function ThemeSettingsPage() {
  const { data: settings, isLoading } = useThemeSettings();
  const queryClient = useQueryClient();
  const { setThemeSettings: applyThemeSettings } = useThemeStore();

  const [panelName, setPanelName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [faviconUrl, setFaviconUrl] = useState('');
  const [defaultTheme, setDefaultTheme] = useState('dark');
  const [enabledThemes, setEnabledThemes] = useState<string[]>(['light', 'dark']);
  const [primaryColor, setPrimaryColor] = useState('#3b82f6');
  const [secondaryColor, setSecondaryColor] = useState('#8b5cf6');
  const [accentColor, setAccentColor] = useState('#06b6d4');
  const [customCss, setCustomCss] = useState('');

  // Initialize form when settings load
  useEffect(() => {
    if (settings) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPanelName(settings.panelName || 'Catalyst');
      setLogoUrl(settings.logoUrl || '');
      setFaviconUrl(settings.faviconUrl || '');
      setDefaultTheme(settings.defaultTheme || 'dark');
      setEnabledThemes(settings.enabledThemes || ['light', 'dark']);
      setPrimaryColor(settings.primaryColor || '#3b82f6');
      setSecondaryColor(settings.secondaryColor || '#8b5cf6');
      setAccentColor(settings.accentColor || '#06b6d4');
      setCustomCss(settings.customCss || '');
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: (payload: any) => adminApi.updateThemeSettings(payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-theme-settings'] });
      // Apply settings immediately to UI
      applyThemeSettings(
        {
          panelName: data.panelName,
          logoUrl: data.logoUrl,
          faviconUrl: data.faviconUrl,
          defaultTheme: data.defaultTheme,
          enabledThemes: data.enabledThemes,
          primaryColor: data.primaryColor,
          secondaryColor: data.secondaryColor,
          accentColor: data.accentColor,
        },
        data.customCss
      );
      toast.success('Theme settings updated successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to update theme settings');
    },
  });

  const handleSave = () => {
    updateMutation.mutate({
      panelName: panelName.trim() || undefined,
      logoUrl: logoUrl.trim() || null,
      faviconUrl: faviconUrl.trim() || null,
      defaultTheme,
      enabledThemes,
      primaryColor,
      secondaryColor,
      accentColor,
      customCss: customCss.trim() || null,
    });
  };

  const handleReset = () => {
    if (settings) {
      setPanelName(settings.panelName || 'Catalyst');
      setLogoUrl(settings.logoUrl || '');
      setFaviconUrl(settings.faviconUrl || '');
      setDefaultTheme(settings.defaultTheme || 'dark');
      setEnabledThemes(settings.enabledThemes || ['light', 'dark']);
      setPrimaryColor(settings.primaryColor || '#3b82f6');
      setSecondaryColor(settings.secondaryColor || '#8b5cf6');
      setAccentColor(settings.accentColor || '#06b6d4');
      setCustomCss(settings.customCss || '');
    }
  };

  const toggleTheme = (theme: string) => {
    if (enabledThemes.includes(theme)) {
      if (enabledThemes.length > 1) {
        setEnabledThemes(enabledThemes.filter((t) => t !== theme));
      } else {
        toast.error('At least one theme must be enabled');
      }
    } else {
      setEnabledThemes([...enabledThemes, theme]);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <AdminTabs />
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-surface-light dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark">
          <p className="text-slate-500 dark:text-slate-400">Loading theme settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminTabs />

      <div className="space-y-6">
        {/* Branding Section */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-surface-light dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Branding</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Customize your panel's branding and identity.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Panel Name
              </label>
              <input
                type="text"
                value={panelName}
                onChange={(e) => setPanelName(e.target.value)}
                placeholder="Catalyst"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Logo URL
              </label>
              <input
                type="text"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Leave empty to use default logo. Recommended size: 24x24px.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Favicon URL
              </label>
              <input
                type="text"
                value={faviconUrl}
                onChange={(e) => setFaviconUrl(e.target.value)}
                placeholder="https://example.com/favicon.ico"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Leave empty to use default favicon.
              </p>
            </div>
          </div>
        </div>

        {/* Theme Options Section */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-surface-light dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Theme Options
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Configure default theme and enable/disable themes.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Default Theme
              </label>
              <select
                value={defaultTheme}
                onChange={(e) => setDefaultTheme(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Enabled Themes
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={enabledThemes.includes('light')}
                    onChange={() => toggleTheme('light')}
                    className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">Light Theme</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={enabledThemes.includes('dark')}
                    onChange={() => toggleTheme('dark')}
                    className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">Dark Theme</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Color Customization Section */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-surface-light dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Color Scheme
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Customize your panel's color palette.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Primary Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-10 w-16 cursor-pointer rounded border border-slate-200 dark:border-slate-700"
                />
                <input
                  type="text"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Secondary Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="h-10 w-16 cursor-pointer rounded border border-slate-200 dark:border-slate-700"
                />
                <input
                  type="text"
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Accent Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="h-10 w-16 cursor-pointer rounded border border-slate-200 dark:border-slate-700"
                />
                <input
                  type="text"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Custom CSS Section */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-surface-light dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Custom CSS
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Advanced styling customization. CSS will be injected into the page.
            </p>
          </div>

          <div>
            <textarea
              value={customCss}
              onChange={(e) => setCustomCss(e.target.value)}
              placeholder="/* Your custom CSS here */&#10;.my-custom-class {&#10;  color: red;&#10;}"
              rows={12}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder-slate-400 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500"
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Maximum 100KB. Be careful with custom CSS as it can break the UI.
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ThemeSettingsPage;
