import { defineConfig } from '@playwright/test';

/**
 * UI tests run the real app. On this PC that is the installed Microsoft Edge (no browser download); on GitHub
 * Actions (CI=true) it is the Chromium that `npx playwright install chromium` provides. Trip data lives in the browser's own
 * IndexedDB, so there is nothing to fake: every test starts with a clean browser profile and its own data.
 *  - phone/desktop projects: the dev server (fast), every screen + real user journeys
 *  - offline project: the PRODUCTION build with its service worker, then the network is cut
 */
const DEV = 5187;
const PROD = 5186;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  workers: CI ? 2 : 4,
  retries: CI ? 1 : 0, // one retry in CI to ride out a slow runner; a test that needs it is reported as flaky
  reporter: CI ? [['list'], ['github']] : [['list']],
  outputDir: 'tests/e2e/.artifacts',
  use: { ...(CI ? {} : { channel: 'msedge' }), colorScheme: 'light', trace: CI ? 'retain-on-failure' : 'off' },
  webServer: [
    { command: `npx vite --port ${DEV} --strictPort`, port: DEV, reuseExistingServer: false },
    { command: `npx vite build && npx vite preview --port ${PROD} --strictPort`, port: PROD, reuseExistingServer: false, timeout: 180_000 },
  ],
  projects: [
    { name: 'phone-375', testIgnore: ['**/offline.e2e.ts', '**/css-sweep.e2e.ts'], use: { baseURL: `http://localhost:${DEV}`, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'phone-320', testIgnore: ['**/offline.e2e.ts', '**/flows.e2e.ts', '**/css-sweep.e2e.ts'], use: { baseURL: `http://localhost:${DEV}`, viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'phone-dark', testIgnore: ['**/offline.e2e.ts', '**/flows.e2e.ts', '**/css-sweep.e2e.ts'], use: { baseURL: `http://localhost:${DEV}`, colorScheme: 'dark', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'desktop', testIgnore: '**/offline.e2e.ts', use: { baseURL: `http://localhost:${DEV}`, viewport: { width: 1280, height: 800 } } },
    { name: 'offline-pwa', testMatch: '**/offline.e2e.ts', use: { baseURL: `http://localhost:${PROD}`, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, serviceWorkers: 'allow' } },
  ],
});
