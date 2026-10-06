import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['test/unit/**/*.test.ts'], environment: 'node' } },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          // One database: run files sequentially; each file resets the schema it uses.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
          env: {
            NODE_ENV: 'test',
            LOG_LEVEL: 'silent',
            DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://isbp:isbp@localhost:5432/isbp_test',
            REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379/1',
            PUBLIC_URL: 'http://localhost:3000',
            RATE_LIMIT_MAX: '10000',
          },
        },
      },
    ],
  },
});
