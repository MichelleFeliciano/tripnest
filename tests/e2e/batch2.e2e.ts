/** Calendar reminders, password-protected backups, merge updates, Android install prompt, trip countdown and key info card. */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { seedSampleTrip } from './fixtures';

test('the calendar file has reminders only for timed items, and none when switched off', async ({ page }, info) => {
  const tripId = await seedSampleTrip(page);
  await page.goto(`/trips/${tripId}/export`);
  const save = async (name: string) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download calendar (.ics)' }).click()]);
    const file = info.outputPath(name);
    await dl.saveAs(file);
    return readFileSync(file, 'utf8');
  };
  const withAlarms = await save('with.ics');
  const events = withAlarms.match(/BEGIN:VEVENT/g)!.length;
  const alarms = withAlarms.match(/BEGIN:VALARM/g)?.length ?? 0;
  expect(alarms).toBeGreaterThan(0);
  expect(alarms).toBeLessThan(events); // all-day items and the hotel get none
  expect(withAlarms).toContain('TRIGGER:-PT1H');
  const block = (title: string) => withAlarms.split('BEGIN:VEVENT').find((b) => b.includes('SUMMARY:' + title))!;
  expect(block('Flight to San Juan')).toContain('BEGIN:VALARM');
  expect(block('Hotel check-in')).not.toContain('VALARM');
  expect(block('Beach day at Condado')).not.toContain('VALARM'); // all-day

  await page.getByLabel('Reminders').selectOption({ label: '1 day before' });
  expect(await save('day.ics')).toContain('TRIGGER:-P1D');
  await page.getByLabel('Reminders').selectOption({ label: 'No reminders' });
  expect(await save('none.ics')).not.toContain('VALARM');
});

test('the install prompt appears when the browser offers it, installs on tap, and Not now is remembered', async ({ page }) => {
  await page.goto('/trips');
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Install' })).toHaveCount(0); // nothing offered yet
  const offer = () => page.evaluate(() => {
    const w = window as unknown as { __installed?: number };
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    e.prompt = async () => { w.__installed = (w.__installed ?? 0) + 1; };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
    return e.defaultPrevented; // we take over from the browser's own bar
  });
  expect(await offer()).toBe(true);
  await expect(page.getByText('Install TripNest.')).toBeVisible();
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __installed?: number }).__installed)).toBe(1);
  await expect(page.getByText('Install TripNest.')).toHaveCount(0); // an offer can only be used once

  await offer();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByText('Install TripNest.')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  await offer();
  await page.waitForTimeout(300);
  await expect(page.getByText('Install TripNest.')).toHaveCount(0); // stays dismissed
});

test('the trip banner counts down, and Key info can be pinned, edited and cleared', async ({ page }) => {
  const DAY = 86_400_000;
  const iso = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
  await page.goto('/trips/new');
  await page.getByLabel('Trip name *').fill('Soon Trip');
  await page.getByLabel('Start date *').fill(iso(5));
  await page.getByLabel('End date *').fill(iso(7));
  await page.getByLabel('Your name *').fill('Michelle');
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByRole('heading', { name: 'Soon Trip' })).toBeVisible();
  await expect(page.locator('.countdown')).toHaveText('Starts in 5 days');

  const card = page.getByRole('region', { name: 'Key info' });
  await expect(card).toContainText('Pin what you would want');
  await card.getByRole('button', { name: 'Add' }).click();
  await page.getByLabel('What should be easy to find?').fill('Hotel: 100 Calle del Cristo\nMom +1 512 555 0123');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card).toContainText('Hotel: 100 Calle del Cristo');
  await expect(card).toContainText('Mom +1 512 555 0123');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Key info' })).toContainText('Mom +1 512 555 0123'); // kept on the device

  await page.getByRole('region', { name: 'Key info' }).getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('What should be easy to find?').fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Key info' })).toContainText('Pin what you would want');
});

test('a password-protected backup hides the trip, refuses a wrong password, and restores with the right one', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.goto('/trips/new');
  await page.getByLabel('Trip name *').fill('Hush Hush Trip');
  await page.getByLabel('Start date *').fill('2027-06-12');
  await page.getByLabel('End date *').fill('2027-06-14');
  await page.getByLabel('Your name *').fill('Michelle');
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByRole('heading', { name: 'Hush Hush Trip' })).toBeVisible();

  await page.goto('/profile');
  const download = page.getByRole('button', { name: 'Download a backup' });
  await page.getByLabel('Protect with a password').check();
  await expect(download).toBeDisabled(); // no password yet
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByLabel('Type it again').fill('short');
  await expect(download).toBeDisabled(); // too short
  await page.getByLabel('Password', { exact: true }).fill('correct horse');
  await page.getByLabel('Type it again').fill('correct hors');
  await expect(page.getByText('The two passwords do not match.')).toBeVisible();
  await expect(download).toBeDisabled();
  await page.getByLabel('Type it again').fill('correct horse');
  await expect(download).toBeEnabled();

  const [dl] = await Promise.all([page.waitForEvent('download'), download.click()]);
  const file = info.outputPath('locked.json');
  await dl.saveAs(file);
  const raw = readFileSync(file, 'utf8');
  expect(raw).not.toContain('Hush Hush Trip');
  expect(JSON.parse(raw)).toMatchObject({ app: 'tripnest', encrypted: true });
  await expect(page.getByText('locked with your password')).toBeVisible();

  // erase everything, then restore from the locked file
  await page.getByRole('button', { name: 'Erase all data on this device…' }).click();
  await page.getByLabel('Type ERASE to confirm').fill('ERASE');
  await page.getByRole('button', { name: 'Erase everything' }).click();
  await expect(page.getByText('Everything on this device was erased.')).toBeVisible();

  await page.locator('input[type=file]').first().setInputFiles(file);
  const box = page.getByRole('dialog', { name: 'This file is password protected' });
  await box.getByLabel('Password').fill('wrong password');
  await box.getByRole('button', { name: 'Open' }).click();
  await expect(box.getByText('That password did not open the file')).toBeVisible();
  await box.getByLabel('Password').fill('correct horse');
  await box.getByRole('button', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Replace everything' }).click();
  await expect(page.getByText('Backup restored.')).toBeVisible();
  await page.goto('/trips');
  await expect(page.getByRole('link', { name: 'Hush Hush Trip' })).toBeVisible();

  // cancelling the password box imports nothing
  await page.locator('input[type=file]').first().setInputFiles(file);
  const box2 = page.getByRole('dialog', { name: 'This file is password protected' });
  await box2.getByRole('button', { name: 'Cancel' }).click();
  await expect(box2).toBeHidden();
  await expect(page.getByRole('link', { name: 'Hush Hush Trip' })).toHaveCount(1);
});

test('two phones keep one trip in step by passing files: first import, an update with a preview, and a separate copy', async ({ browser, baseURL }, info) => {
  test.setTimeout(150_000);
  const phone = async () => { const ctx = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 } }); return { ctx, page: await ctx.newPage() }; };
  const a = await phone();
  const b = await phone();
  try {
    // Michelle's phone: a trip with an expense
    await a.page.goto('/trips/new');
    await a.page.getByLabel('Trip name *').fill('Shared Trip');
    await a.page.getByLabel('Start date *').fill('2027-06-12');
    await a.page.getByLabel('End date *').fill('2027-06-14');
    await a.page.getByLabel('Your name *').fill('Michelle');
    await a.page.getByLabel('Who else is going?').fill('Mom');
    await a.page.getByRole('button', { name: 'Create trip' }).click();
    await expect(a.page.getByRole('heading', { name: 'Shared Trip' })).toBeVisible();
    const tripUrl = a.page.url().replace(/\/$/, '');
    const save = async (p: typeof a, name: string) => {
      await p.page.goto(`${tripUrl}/export`);
      const [dl] = await Promise.all([p.page.waitForEvent('download'), p.page.getByRole('button', { name: 'Save trip to a file' }).click()]);
      const file = info.outputPath(name);
      await dl.saveAs(file);
      return file;
    };
    const fromA = await save(a, 'from-a.json');

    // Mom's phone imports it: new to her, so no questions asked
    await b.page.goto('/trips');
    await b.page.locator('input[type=file]').first().setInputFiles(fromA);
    await expect(b.page.getByText(/Added 1 trip from the file/)).toBeVisible();
    await expect(b.page.getByRole('link', { name: 'Shared Trip' })).toBeVisible();

    // Mom adds an itinerary item and sends the trip back
    await b.page.getByRole('link', { name: 'Shared Trip' }).click();
    await expect(b.page).toHaveURL(new RegExp(`${tripUrl.split('/').pop()}$`));
    await b.page.goto(`${tripUrl}/itinerary?new=1`);
    await b.page.getByLabel('Title *').fill("Mom's museum visit");
    await b.page.getByLabel('Date *', { exact: true }).fill('2027-06-13');
    await b.page.getByRole('button', { name: 'Add to itinerary' }).click();
    await expect(b.page.locator('main')).toContainText("Mom's museum visit");
    const fromB = await save(b, 'from-b.json');

    // Michelle imports it: she is offered an update, with a preview
    await a.page.goto('/trips');
    await a.page.locator('input[type=file]').first().setInputFiles(fromB);
    const dialog = a.page.getByRole('dialog', { name: 'You already have this trip' });
    await expect(dialog).toContainText('Shared Trip');
    await expect(dialog).toContainText('1 new');
    await dialog.getByRole('button', { name: 'Update my copy' }).click();
    await expect(a.page.getByText(/Updated “Shared Trip” \(1 added\)/)).toBeVisible();
    await expect(a.page.getByRole('link', { name: 'Shared Trip' })).toHaveCount(1); // still one trip, not two
    await a.page.goto(`${tripUrl}/itinerary`);
    await expect(a.page.locator('main')).toContainText("Mom's museum visit");

    // importing the same file again says there is nothing new
    await a.page.goto('/trips');
    await a.page.locator('input[type=file]').first().setInputFiles(fromB);
    const again = a.page.getByRole('dialog', { name: 'You already have this trip' });
    await expect(again).toContainText('already up to date');
    // ...and the person can still choose to keep both
    await again.getByLabel('Add it as a separate copy').check();
    await again.getByRole('button', { name: 'Add a copy' }).click();
    await expect(a.page.getByText(/Added 1 trip from the file/)).toBeVisible();
    await expect(a.page.getByRole('link', { name: /Shared Trip/ })).toHaveCount(2);

    // the dialog can be cancelled without changing anything
    await a.page.locator('input[type=file]').first().setInputFiles(fromB);
    await a.page.getByRole('dialog', { name: 'You already have this trip' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(a.page.getByRole('link', { name: /Shared Trip/ })).toHaveCount(2);
  } finally {
    await a.ctx.close();
    await b.ctx.close();
  }
});

test('the new dialogs and cards pass the accessibility scan, fit the screen, and trap nothing', async ({ page }) => {
  test.setTimeout(120_000);
  const tripId = await seedSampleTrip(page);
  const scan = async (what: string) => {
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${what}: ${v.id}: ${v.help}`)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${what} sideways scroll`).toBe(true);
  };

  await page.goto(`/trips/${tripId}`);
  await page.waitForSelector('#ki-h');
  await scan('overview with key info and countdown');
  await page.getByRole('region', { name: 'Key info' }).getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('dialog', { name: 'Key info' })).toBeVisible();
  await scan('key info dialog');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Key info' })).toBeHidden();

  await page.goto('/profile');
  await page.getByLabel('Protect with a password').check();
  await page.getByLabel('Password', { exact: true }).fill('correct horse');
  await scan('profile with password options');

  // importing a file for a trip that is already here
  await page.goto('/trips');
  const sample = (await import('./fixtures')).sampleTripFile();
  const pick = (name: string) => page.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sample)) });
  await pick('trip.json'); // new to this device: added, keeping its identity
  await expect(page.getByText(/Added 1 trip from the file/)).toBeVisible();
  await pick('again.json'); // now it is the same trip
  await expect(page.getByRole('dialog', { name: 'You already have this trip' })).toBeVisible();
  await scan('import dialog');
  await page.keyboard.press('Escape');

  // opening a protected file
  const locked = await page.evaluate(async (json) => { const m = '/src/api/crypto.ts'; const c = await import(/* @vite-ignore */ m); return c.encryptBackup(json, 'correct horse', 1000) as Promise<string>; }, JSON.stringify(sample));
  await page.locator('input[type=file]').first().setInputFiles({ name: 'locked.json', mimeType: 'application/json', buffer: Buffer.from(locked) });
  await expect(page.getByRole('dialog', { name: 'This file is password protected' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'This file is password protected' }).getByLabel('Password')).toBeFocused(); // typing can start straight away
  await scan('password dialog');
});
