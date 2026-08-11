import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// api-key-service requires API_KEY_SECRET (no insecure fallback). Provide a
// deterministic test default so suites that call createApiKey/hashApiKey work
// both in CI and for local `pnpm test` without a fully filled .env.
if (!process.env.API_KEY_SECRET?.trim()) {
  process.env.API_KEY_SECRET = 'vitest-api-key-secret-do-not-use-in-production';
}
if (!process.env.BETTER_AUTH_SECRET?.trim()) {
  process.env.BETTER_AUTH_SECRET = 'vitest-better-auth-secret-do-not-use-in-production';
}

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 30000,
    isolate: false,
    // Vitest 4 removed poolOptions; keep sequential single-worker runs so
    // DB-backed suites do not stomp on shared fixtures.
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    reporters: ['verbose'],
    setupFiles: [],
  },
});
