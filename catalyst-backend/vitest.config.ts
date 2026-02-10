import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 30000,
    isolate: false,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    reporters: ['verbose'],
    setupFiles: [],
  },
});
