/** Calendar reminders, password-protected backups, merge updates, Android install prompt, trip countdown and key info card. */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
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
