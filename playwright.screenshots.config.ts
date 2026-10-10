import { defineConfig } from '@playwright/test';

/** Regenerates docs/screenshots from the sample trip (fictional data): `npm run docs:screenshots`. Not part of the test suites. */
const PORT = 5188;
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.shots.ts',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'tests/e2e/.artifacts',
  use: { ...(process.env.CI ? {} : { channel: 'msedge' }), baseURL: `http://localhost:${PORT}`, viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  webServer: { command: `npx vite --port ${PORT} --strictPort`, port: PORT, reuseExistingServer: false },
});
