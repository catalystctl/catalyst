import apiClient from './client';

export interface ThemeColors {
  // Semantic colors
  successColor?: string;
  warningColor?: string;
  dangerColor?: string;
  infoColor?: string;

  // Dark mode surfaces
  darkBackground?: string;
  darkForeground?: string;
  darkCard?: string;
  darkSurface1?: string;
  darkSurface2?: string;
  darkSurface3?: string;
  darkBorder?: string;
  darkMuted?: string;

  // Light mode surfaces
  lightBackground?: string;
  lightForeground?: string;
  lightCard?: string;
  lightSurface1?: string;
  lightSurface2?: string;
  lightSurface3?: string;
  lightBorder?: string;
  lightMuted?: string;

  // Layout
  borderRadius?: string;
}

export interface PublicThemeSettings {
  panelName: string;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  defaultTheme: string;
  enabledThemes: string[];
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  authProviders?: {
    whmcs: boolean;
    paymenter: boolean;
  };
  themeColors?: ThemeColors | null;
  customCss?: string | null;
}

export interface ThemeSettings extends PublicThemeSettings {
  customCss?: string | null;
  metadata?: any;
}

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export const themeApi = {
  getPublicSettings: async () => {
    const data = await apiClient.get<ApiResponse<PublicThemeSettings>>(
      '/api/theme-settings/public'
    );
    return data.data!;
  },
};
