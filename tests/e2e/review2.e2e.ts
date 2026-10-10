/** Screen-level fixes from the second code review. */
import { test, expect, type Page } from '@playwright/test';
import { seedSampleTrip } from './fixtures';

const localIso = (offsetDays: number) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function makeTrip(page: Page, name: string, start: string, end: string) {
  await page.goto('/trips/new');
  await page.getByLabel('Trip name *').fill(name);
  await page.getByLabel('Start date *').fill(start);
  await page.getByLabel('End date *').fill(end);
  await page.getByLabel('Your name *').fill('Michelle');
  await page.getByLabel('Who else is going?').fill('Mom');
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  return page.url().replace(/\/$/, '');
}

test('reopening Edit shows the item as it is now, not an old unsaved copy', async ({ page }) => {
  const tripId = await seedSampleTrip(page);
  await page.goto(`/trips/${tripId}/itinerary?view=timeline`);
  const row = page.locator('li.item', { hasText: 'Hotel check-in' });
  await row.getByRole('button', { name: /^Edit Hotel check-in/ }).click();
  await expect(page.getByLabel('Title *')).toHaveValue('Hotel check-in');
  await page.keyboard.press('Escape'); // close without pressing Cancel, so nothing is cleaned up

  // the item changes somewhere else (another tab, or a merge from a travel companion)
  await page.evaluate(async (id) => {
    const m = '/src/api/api.ts';
    const api = await import(/* @vite-ignore */ m);
    const item = (await api.loadTrip(id)).items.find((i: { title: string }) => i.title === 'Hotel check-in');
    await api.rows.update('itinerary_items', item.id, { title: 'Hotel check-in (changed elsewhere)' });
  }, tripId);
  await page.reload();
  await page.locator('li.item', { hasText: 'changed elsewhere' }).getByRole('button', { name: /^Edit/ }).click();
  await expect(page.getByLabel('Title *')).toHaveValue('Hotel check-in (changed elsewhere)'); // used to show the old title, and saving would undo the change

  // but something the person has typed and not saved is still kept
  await page.getByLabel('Notes', { exact: true }).fill('typed but not saved');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.locator('li.item', { hasText: 'changed elsewhere' }).getByRole('button', { name: /^Edit/ }).click();
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('typed but not saved');
});

test('keyboard focus stays on the Move button after an item moves', async ({ page }) => {
  await makeTrip(page, 'Focus Trip', localIso(30), localIso(32));
  const base = page.url().replace(/\/$/, '');
  for (const title of ['Zebra walk', 'Apple picking', 'Museum']) {
    await page.goto(`${base}/itinerary?new=1`);
    await page.getByLabel('Title *').fill(title);
    await page.getByLabel('Date *', { exact: true }).fill(localIso(31));
    await page.getByRole('button', { name: 'Add to itinerary' }).click();
    await expect(page.locator('main')).toContainText(title);
  }
  const label = 'Move Zebra walk earlier';
  const button = page.getByRole('button', { name: label });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.locator('li.item strong').first().innerText()).toContain('Apple picking'); // it moved up one place
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe(label); // and focus did not fall back to the page
  await page.keyboard.press('Enter'); // so a keyboard user can keep going
  await expect.poll(() => page.locator('li.item strong').first().innerText()).toContain('Zebra walk');
});

test('an item left outside the trip dates is labelled as such, not "Day 0"', async ({ page }) => {
  const base = await makeTrip(page, 'Outside Trip', localIso(10), localIso(12));
  await page.goto(`${base}/itinerary?new=1`);
  await page.getByLabel('Title *').fill('Stray');
  await page.getByLabel('Date *', { exact: true }).fill(localIso(11));
  await page.getByRole('button', { name: 'Add to itinerary' }).click();
  await expect(page.locator('main')).toContainText('Stray');
  // shorten the trip so the item falls outside it
  await page.goto(`${base}/settings`);
  await page.getByLabel('End date').fill(localIso(10));
  await page.getByLabel('Start date').fill(localIso(10));
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.goto(`${base}/itinerary?view=timeline`);
  await expect(page.getByRole('heading', { name: /Outside the trip dates/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Day -?\d+ ·/ }).filter({ hasText: 'Stray' })).toHaveCount(0);
});

test('"Today" and the countdown move on by themselves when the app is left open past midnight', async ({ page }) => {
  await page.clock.install({ time: new Date() });
  const base = await makeTrip(page, 'Overnight Trip', localIso(1), localIso(3));
  await page.goto(base);
  await expect(page.locator('.countdown')).toHaveText('Starts tomorrow');
  await page.clock.fastForward('24:00:00'); // a day passes while the app stays open
  await expect(page.locator('.countdown')).toHaveText('Day 1 of 3'); // no reload needed
  await page.clock.fastForward('48:00:00'); // three days in: the trip's last day
  await expect(page.locator('.countdown')).toHaveText('Last day (day 3 of 3)');
  await page.clock.fastForward('24:00:00'); // the day after the last day: it ended yesterday
  await expect(page.locator('.countdown')).toHaveText('Ended yesterday');
});

test('clearing a budget can be undone', async ({ page }) => {
  const base = await makeTrip(page, 'Budget Trip', localIso(5), localIso(7));
  await page.goto(`${base}/budget`);
  await page.getByRole('button', { name: 'Set budget' }).click();
  await page.getByLabel('Total budget').fill('1000');
  await page.getByLabel('Food budget').fill('300');
  await page.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.locator('main')).toContainText('Total trip budget');
  await page.getByRole('button', { name: 'Edit budget' }).click();
  await page.getByLabel('Food budget').fill('');
  await page.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByRole('heading', { name: 'Food', exact: true })).toHaveCount(0);
  await expect(page.getByText(/Deleted Budget/)).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('heading', { name: 'Food', exact: true })).toBeVisible();
});

test('removing a traveler can be undone', async ({ page }) => {
  const base = await makeTrip(page, 'People Trip', localIso(5), localIso(7));
  await page.goto(`${base}/members`);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Remove Mom' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Mom' })).toHaveCount(0);
  await expect(page.getByText(/Deleted Traveler/)).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Mom' })).toHaveCount(1);
});
