import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '.'), 'VITE_');

  const plugins: Plugin[] = [
    react(),
    // Resolve npm packages imported by catalyst-plugins files using the
    // frontend's node_modules (where Bun creates symlinks).
    {
      name: 'plugin-module-resolver',
      enforce: 'pre',
      async resolveId(source, importer, options) {
        if (!importer?.includes('catalyst-plugins')) return null;
        if (source.startsWith('.') || source.startsWith('/')) return null;
        const resolved = await this.resolve(
          source,
          path.resolve(__dirname, 'src/main.tsx'),
          options,
        );
        return resolved;
      },
    } as Plugin,
  ];

  if (mode === 'analyze') {
    const { visualizer } = await import('rollup-plugin-visualizer');
    plugins.push(
      visualizer({
        open: true,
        gzipSize: true,
        brotliSize: true,
        filename: 'dist/stats.html',
      }) as Plugin,
    );
  }

  return {
    plugins,
    resolve: {
      alias: [
        { find: '@', replacement: path.resolve(__dirname, './src') },
        { find: '@plugins', replacement: path.resolve(__dirname, '../catalyst-plugins') },
        { find: /^react$/, replacement: path.resolve(__dirname, './node_modules/react/index.js') },
        { find: /^react-dom$/, replacement: path.resolve(__dirname, './node_modules/react-dom/index.js') },
        { find: /^react\/jsx-runtime$/, replacement: path.resolve(__dirname, './node_modules/react/jsx-runtime.js') },
        { find: /^react\/jsx-dev-runtime$/, replacement: path.resolve(__dirname, './node_modules/react/jsx-dev-runtime.js') },
      ],
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      allowedHosts: env.VITE_PASSKEY_RP_ID ? [env.VITE_PASSKEY_RP_ID] : undefined,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
          cookieDomainRewrite: '',
        },
        '/ws': {
          target: 'ws://127.0.0.1:3000',
          ws: true,
          changeOrigin: true,
        },
      },
    },
    build: {
      // Generate source maps for easier debugging in production
      sourcemap: false,
      // Chunk size warnings for large dependencies
      chunkSizeWarningLimit: 1000,
      // Manual chunks for better caching — vendors change less frequently
      manualChunks: {
        'vendor-react': ['react', 'react-dom', 'react-router-dom'],
        'vendor-query': ['@tanstack/react-query'],
        'vendor-radix': [
          '@radix-ui/react-dialog',
          '@radix-ui/react-dropdown-menu',
          '@radix-ui/react-select',
          '@radix-ui/react-tabs',
          '@radix-ui/react-toast',
          '@radix-ui/react-tooltip',
          '@radix-ui/react-popover',
          '@radix-ui/react-switch',
          '@radix-ui/react-checkbox',
          '@radix-ui/react-alert-dialog',
          '@radix-ui/react-separator',
          '@radix-ui/react-toggle',
          '@radix-ui/react-toggle-group',
          '@radix-ui/react-label',
          '@radix-ui/react-scroll-area',
          '@radix-ui/react-avatar',
        ],
        'vendor-motion': ['framer-motion'],
        'vendor-charts': ['recharts'],
        'vendor-form': ['react-hook-form', 'zod', '@hookform/resolvers'],
        'vendor-cmdk': ['cmdk'],
        'vendor-date': ['date-fns'],
        'vendor-sonner': ['sonner'],
        'vendor-utils': [
          'clsx',
          'tailwind-merge',
          'class-variance-authority',
        ],
      },
      rollupOptions: {
        output: {
          // Asset file names with hashes for cache busting
          assetFileNames: 'assets/[name]-[hash][extname]',
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js',
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      include: ['src/**/__tests__/**/*.{test,spec}.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
      },
    },
  };
});
