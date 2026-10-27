/**
 * Runs against the PRODUCTION build (service worker included), then cuts the network.
 * Proves the app opens, shows saved trips and accepts changes with no connection at all.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test('after one visit the app works fully offline', async ({ page, context }) => {
  await page.goto('/trips/new');
  await page.waitForSelector('main h1');
  // wait for the service worker to take control and finish caching
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(async () => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBe(true);
  await expect.poll(async () => page.evaluate(async () => (await caches.keys()).length), { timeout: 20_000 }).toBeGreaterThan(0);

  await page.getByLabel('Trip name *').fill('Offline Trip');
  await page.getByLabel('Start date *').fill('2027-06-12');
  await page.getByLabel('End date *').fill('2027-06-13');
  await page.getByLabel('Your name *').fill('Michelle');
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByRole('heading', { name: 'Offline Trip' })).toBeVisible();
  const tripUrl = page.url();

  await context.setOffline(true);

  // a full reload and a deep link, with no network
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Offline Trip' })).toBeVisible();
  await page.goto(tripUrl.replace(/\/?$/, '') + '/expenses');
  await expect(page.getByRole('heading', { name: 'Expenses', exact: true })).toBeVisible();

  // and it still saves
  await page.getByRole('button', { name: '+ Add expense' }).click();
  await page.getByLabel('Description *').fill('Coffee');
  await page.getByLabel('Amount *').fill('4.50');
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.locator('main')).toContainText('$4.50');

  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('main')).toContainText('$4.50'); // survived the reload
});

test('the app is installable: manifest and icons are reachable and valid', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  const res = await request.get(new URL(href!, page.url()).toString());
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m).toMatchObject({ name: 'TripNest', display: 'standalone' });
  for (const icon of m.icons) {
    const r = await request.get(new URL(icon.src, new URL(href!, page.url())).toString());
    expect(r.ok(), icon.src).toBe(true);
    expect(r.headers()['content-type']).toContain('image/png');
  }
});

test('Settings shows a version that matches the saved copy, and an update is offered, then installed, on request', async ({ page }) => {
  await page.goto('/settings');
  await expect.poll(async () => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 }).toBe(true);
  await page.reload();
  const version = await page.getByTestId('app-version').innerText();
  await expect(page.getByTestId('cache-name')).toHaveText(new RegExp(`^tripnest-v${version.replace(/\./g, '\.')}-[0-9a-f]+$`));
  await expect(page.getByText('A new version of TripNest is ready.')).toHaveCount(0);

  // pretend the server now has a newer service worker: same files, a different cache name (the preview server reads dist/ on every request)
  const swPath = join(process.cwd(), 'dist', 'sw.js');
  const original = readFileSync(swPath, 'utf8');
  writeFileSync(swPath, original.replace(/const CACHE = '([^']+)'/, "const CACHE = '$1-next'"));
  try {
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await expect(page.getByText('A new version of TripNest is ready.')).toBeVisible({ timeout: 20_000 });
  // nothing changed under our feet yet
  expect(await page.evaluate(async () => (await caches.keys()).some((k) => k.endsWith('-next')))).toBe(true);
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL.length)).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Update now' }).first().click();
  await expect(page.getByText('A new version of TripNest is ready.')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('cache-name')).toHaveText(/-next$/, { timeout: 20_000 });
  } finally {
    writeFileSync(swPath, original);
  }
});
