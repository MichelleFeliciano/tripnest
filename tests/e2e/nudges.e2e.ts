/** Share sheet, the "back up your trips" reminder, and the iPhone Home Screen tip. */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const DAY = 86_400_000;

async function makeTrip(page: Page, name = 'Reminder Trip') {
  await page.goto('/trips/new');
  await page.getByLabel('Trip name *').fill(name);
  await page.getByLabel('Start date *').fill('2027-06-12');
  await page.getByLabel('End date *').fill('2027-06-14');
  await page.getByLabel('Your name *').fill('Michelle');
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

/** A share sheet that records what it was given (real phones show a sheet; headless browsers have none). */
const stubShare = (page: Page, behaviour: 'ok' | 'cancel' = 'ok') => page.addInitScript((b) => {
  const w = window as unknown as { __shared: { name: string; text: Promise<string> }[] };
  w.__shared = [];
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: async (d: ShareData) => {
      if (b === 'cancel') throw new DOMException('closed', 'AbortError');
      for (const f of d.files ?? []) w.__shared.push({ name: f.name, text: f.text() });
    },
  });
}, behaviour);
const shared = (page: Page) => page.evaluate(async () => {
  const w = window as unknown as { __shared: { name: string; text: Promise<string> }[] };
  return Promise.all(w.__shared.map(async (s) => ({ name: s.name, text: await s.text })));
});

test('Share trip opens the share sheet with a valid trip file', async ({ page }) => {
  await stubShare(page);
  await makeTrip(page, 'Shared Trip');
  await page.goto(page.url().replace(/\/$/, '') + '/export');
  await page.getByRole('button', { name: 'Share trip…' }).click();
  await expect.poll(async () => (await shared(page)).length).toBe(1);
  const [file] = await shared(page);
  expect(file.name).toMatch(/^tripnest-shared-trip-.*\.json$/);
  const parsed = JSON.parse(file.text);
  expect(parsed.app).toBe('tripnest');
  expect(parsed.tables.trips[0].name).toBe('Shared Trip');
});

test('closing the share sheet is not an error and downloads nothing', async ({ page }) => {
  await stubShare(page, 'cancel');
  await makeTrip(page);
  await page.goto(page.url().replace(/\/$/, '') + '/export');
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByRole('button', { name: 'Share trip…' }).click();
  await page.waitForTimeout(500);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(downloads).toBe(0);
});

test('without a share sheet there is no Share button, and saving still works', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); });
  await makeTrip(page);
  await page.goto(page.url().replace(/\/$/, '') + '/export');
  await expect(page.getByRole('button', { name: 'Share trip…' })).toHaveCount(0);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save trip to a file' }).click();
  expect((await dl).suggestedFilename()).toMatch(/\.json$/);
});

test('backup reminder: quiet at first, appears after a week, goes away after backing up, returns after a month', async ({ page }) => {
  await stubShare(page);
  await makeTrip(page);
  await page.goto('/trips');
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  await expect(page.getByText('You have not backed up your trips yet.')).toHaveCount(0);

  await page.clock.setFixedTime(Date.now() + 10 * DAY);
  await page.goto('/trips');
  await expect(page.getByText('You have not backed up your trips yet.')).toBeVisible();

  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect.poll(async () => (await shared(page)).length).toBe(1);
  expect((await shared(page))[0].name).toMatch(/^tripnest-backup-.*\.json$/);
  await expect(page.getByText('You have not backed up your trips yet.')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back up now' })).toHaveCount(0);

  await page.clock.setFixedTime(Date.now() + 45 * DAY);
  await page.goto('/trips');
  await expect(page.getByText('It has been a while since your last backup.')).toBeVisible();
  await page.getByRole('button', { name: 'Remind me in a week' }).click();
  await expect(page.getByRole('button', { name: 'Back up now' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back up now' })).toHaveCount(0);
});

test.describe('iPhone Safari', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1' });
  test('shows the Add to Home Screen tip once, until dismissed', async ({ page }) => {
    await page.goto('/trips');
    await expect(page.getByText('Add to Home Screen')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByText('Add to Home Screen')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
    await expect(page.getByText('Add to Home Screen')).toHaveCount(0);
  });
});

test('no Home Screen tip on a normal browser', async ({ page }) => {
  await page.goto('/trips');
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  await expect(page.getByText('Add to Home Screen')).toHaveCount(0);
});

test('the reminder and the Home Screen tip pass the accessibility scan, with no sideways scrolling', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1', configurable: true }); });
  await makeTrip(page);
  await page.clock.setFixedTime(Date.now() + 10 * DAY);
  await page.goto('/trips');
  await expect(page.getByRole('button', { name: 'Back up now' })).toBeVisible();
  await expect(page.getByText('Add to Home Screen')).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
