import { defineConfig } from '@playwright/test';

/**
 * UI tests run the real app in Microsoft Edge (no browser download) against a FAKE local Supabase
 * (tests/e2e/mock-supabase.ts). They never touch your real project: env vars set here override .env,
 * and any request to a real *.supabase.co host fails the test.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  workers: 4,
  reporter: [['list']],
  outputDir: 'tests/e2e/.artifacts',
  use: { channel: 'msedge', baseURL: 'http://localhost:5199', colorScheme: 'light' },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    port: 5199,
    reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_ANON_KEY: 'e2e-fake-anon-key', VITE_AI_ENABLED: 'false' },
  },
  projects: [
    { name: 'phone-375', use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'phone-320', use: { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
});
