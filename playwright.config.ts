import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60000, // 60s per test
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  globalSetup: './tests/global-setup.ts',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // CI already `pnpm build`s. `next start` keeps one Postgres pool.
    // `next dev` re-evaluates `src/core/db.ts` per compile and exhausts
    // max_connections (too many clients) late in the e2e suite.
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120000, // Give Next.js 2 minutes to start
    env: {
      ...process.env,
      ANYKPI_API_KEY: process.env.ANYKPI_API_KEY || 'anykpi-e2e-admin',
      ANYKPI_SECRET: process.env.ANYKPI_SECRET || 'anykpi-e2e-secret',
      // Dedicated Playwright freshness coverage uses a short interval in
      // unit tests. Keep the shared e2e server from pulling env fallbacks.
      SYNC_INTERVAL_MINUTES: process.env.SYNC_INTERVAL_MINUTES || '0',
    },
  },
});
