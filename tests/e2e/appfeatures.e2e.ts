/** Settings, text size and dark mode, app lock, Undo / Redo / History, search across trips, Help and welcome card, offline banner. */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedSampleTrip } from './fixtures';

async function makeTrip(page: Page, name = 'Undo Trip') {
  await page.goto('/trips/new');
  await page.getByLabel('Trip name *').fill(name);
  await page.getByLabel('Start date *').fill('2027-06-12');
  await page.getByLabel('End date *').fill('2027-06-14');
  await page.getByLabel('Your name *').fill('Michelle');
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}
const row = (page: Page, text: string) => page.locator('main li', { hasText: text });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
async function clean(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

test('Settings shows the version, a settings check, and passes the accessibility scan', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByTestId('app-version')).toHaveText(/^\d+\.\d+\.\d+$/);
  await expect(page.getByRole('heading', { name: 'Settings check' })).toBeVisible();
  for (const name of ['Backup', 'App lock', 'Offline', 'Sync', 'Storage', 'Updates']) await expect(page.locator('.checklist')).toContainText(name);
  await expect(page.locator('dt', { hasText: 'Last updated' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What’s new' })).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await clean(page);
});

test('text size and dark mode can be chosen, apply at once and are remembered', async ({ page }) => {
  await page.goto('/settings');
  const size = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  const before = parseFloat(await size());
  await page.getByLabel('Extra large').check();
  expect(parseFloat(await size())).toBeGreaterThan(before * 1.25);
  expect(await noSideScroll(page)).toBe(true);

  await page.getByLabel('Dark', { exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await bg()).toBe('rgb(7, 34, 46)');
  await clean(page);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(parseFloat(await size())).toBeGreaterThan(before * 1.25);

  await page.getByLabel('Light', { exact: true }).check();
  expect(await bg()).toBe('rgb(255, 247, 234)');
  await page.getByLabel('Automatic (follow my device)').check();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  await page.getByLabel('Normal').check();
});

test('app lock: set a PIN, lock, reject a wrong PIN, unlock, and turn it off', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Set up app lock…' }).click();
  await page.getByLabel('New PIN').fill('12');
  await page.getByLabel('Type it again').fill('12');
  await page.getByRole('button', { name: 'Turn on app lock' }).click();
  await expect(page.getByRole('alert')).toContainText('4 to 10 digits');
  await page.getByLabel('New PIN').fill('4821');
  await page.getByLabel('Type it again').fill('4822');
  await page.getByRole('button', { name: 'Turn on app lock' }).click();
  await expect(page.getByRole('alert')).toContainText('don’t match');
  await page.getByLabel('Type it again').fill('4821');
  await page.getByRole('button', { name: 'Turn on app lock' }).click();
  await expect(page.getByText('App lock is on (PIN)')).toBeVisible();

  await page.getByRole('button', { name: 'Lock now' }).click();
  await expect(page.getByRole('heading', { name: 'TripNest is locked' })).toBeVisible();
  await expect(page.locator('.topbar')).toHaveCount(0); // nothing of the app is drawn behind the lock
  expect(await noSideScroll(page)).toBe(true);
  await clean(page);

  await page.getByLabel('Enter your PIN').fill('0000');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toContainText('isn’t right');
  await page.getByLabel('Enter your PIN').fill('4821');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

  // a reload asks again
  await page.reload();
  await expect(page.getByRole('heading', { name: 'TripNest is locked' })).toBeVisible();
  await page.getByLabel('Enter your PIN').fill('4821');
  await page.getByRole('button', { name: 'Unlock' }).click();

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByText('App lock is off.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});

test('forgot the PIN: erasing the device is the only way back in, and it asks first', async ({ page }) => {
  await makeTrip(page, 'Will be erased');
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Set up app lock…' }).click();
  await page.getByLabel('New PIN').fill('7777');
  await page.getByLabel('Type it again').fill('7777');
  await page.getByRole('button', { name: 'Turn on app lock' }).click();
  await expect(page.getByText('App lock is on (PIN)')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Forgot it?' }).click();
  const erase = page.getByRole('button', { name: 'Erase and start over' });
  await expect(erase).toBeDisabled();
  await page.getByLabel('Type ERASE to confirm').fill('ERASE');
  await erase.click();
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  await expect(page.getByText('Will be erased')).toHaveCount(0);
});

test('Undo and Redo reverse edits, History lists them, and a delete stops the chain', async ({ page }) => {
  await makeTrip(page);
  await page.goto(page.url().replace(/\/$/, '') + '/todo');
  const undo = page.getByRole('button', { name: /Undo/ }).first();
  const redo = page.getByRole('button', { name: /Redo/ }).first();
  await page.getByLabel('What needs doing?').fill('Renew passport');
  await page.getByRole('button', { name: 'Add to-do' }).click();
  await expect(row(page, 'Renew passport')).toBeVisible();
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();

  await undo.click();
  await expect(row(page, 'Renew passport')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Undid: Added to-do “Renew passport”');
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(row(page, 'Renew passport')).toBeVisible();

  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(page.locator('.history-list')).toContainText('Added to-do “Renew passport”');
  await clean(page);
  await page.goBack();

  // deleting has its own Undo; History can't go back past it
  await page.getByRole('button', { name: 'Delete to-do Renew passport' }).click();
  await expect(row(page, 'Renew passport')).toHaveCount(0);
  await expect(undo).toBeDisabled();
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Renew passport')).toBeVisible();
});

test('Ctrl+Z undoes outside text fields', async ({ page }) => {
  await makeTrip(page, 'Shortcut Trip');
  await page.goto(page.url().replace(/\/$/, '') + '/todo');
  await page.getByLabel('What needs doing?').fill('Buy adapter');
  await page.getByRole('button', { name: 'Add to-do' }).click();
  await expect(row(page, 'Buy adapter')).toBeVisible();
  await page.locator('h2').first().click();
  await page.keyboard.press('Control+z');
  await expect(row(page, 'Buy adapter')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(row(page, 'Buy adapter')).toBeVisible();
});

test('search finds things in every trip from one place', async ({ page }) => {
  await seedSampleTrip(page);
  await makeTrip(page, 'Second Trip');
  await page.goto('/search');
  await page.getByLabel('Search all your trips').fill('snorkeling');
  await expect(page.locator('main p[role=status]')).toContainText('result');
  await expect(page.locator('main .list')).toContainText('Snorkeling tour');
  await expect(page.locator('main .list')).toContainText('in Puerto Rico Vacation');
  await page.getByLabel('Search all your trips').fill('second trip');
  await expect(page.locator('main .list')).toContainText('Second Trip');
  await clean(page);
});

test('first visit shows a welcome card, and dismissing it is remembered', async ({ page }) => {
  await page.goto('/trips');
  await expect(page.getByRole('heading', { name: /Welcome to TripNest/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add one now' })).toBeVisible();
  await clean(page);
  await page.getByRole('button', { name: 'Hide this' }).click();
  await expect(page.getByRole('heading', { name: /Welcome to TripNest/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Welcome to TripNest/ })).toHaveCount(0);
});

test('Help answers the common questions and passes the accessibility scan', async ({ page }) => {
  await page.goto('/help');
  await expect(page.getByRole('heading', { name: 'Help', exact: true })).toBeVisible();
  await page.getByText('Where is my data?').click();
  await expect(page.locator('details[open]')).toContainText('Only on this device');
  expect(await noSideScroll(page)).toBe(true);
  await clean(page);
});

test('empty screens offer an "Add one now" button that opens the form', async ({ page }) => {
  await makeTrip(page, 'Empty Trip');
  const base = page.url().replace(/\/$/, '');
  await page.goto(`${base}/itinerary`);
  await page.getByRole('button', { name: 'Add one now' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto(`${base}/reservations`);
  await page.getByRole('button', { name: 'Add one now' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto(`${base}/todo`);
  await page.getByRole('button', { name: 'Add one now' }).click();
  await expect(page.getByLabel('What needs doing?')).toBeFocused();
});

test('says so when offline, and when the connection returns', async ({ page, context }) => {
  await page.goto('/trips');
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText('You’re offline.')).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  await context.setOffline(false);
  await expect(page.getByText('You’re offline.')).toHaveCount(0);
});

test('warns when storage is nearly full', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => ({ usage: 90, quota: 100 }), persisted: async () => true, persist: async () => true } });
  });
  await page.goto('/trips');
  await expect(page.getByText('Storage is getting full (90% used).')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back up now' })).toBeVisible();
});

test('shows an alert when a save is refused for lack of space', async ({ page }) => {
  await page.goto('/trips');
  await page.evaluate(() => window.dispatchEvent(new Event('tripnest:storage-full')));
  await expect(page.getByRole('alert')).toContainText('couldn’t save your last change');
});
