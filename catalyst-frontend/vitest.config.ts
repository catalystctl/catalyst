import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
    // Playwright specs live under e2e/ and must not be collected by Vitest.
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/*.e2e.*'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'src/__tests__/**/*.{ts,tsx}'],
  },
});
