/**
 * Real user journeys through the real UI, with real on-device storage (no fakes).
 * Because everything is local, these cover the whole product: create, edit, calculate, reload, back up, restore.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { seedSampleTrip } from './fixtures';

async function createTrip(page: Page, name = 'Lake Weekend') {
  await page.goto('/trips/new');
  await page.getByLabel('Trip name *').fill(name);
  await page.getByLabel('Start date *').fill('2027-06-12');
  await page.getByLabel('End date *').fill('2027-06-14');
  await page.getByLabel('Your name *').fill('Michelle');
  await page.getByLabel('Who else is going?').fill('Jon, Mom');
  await page.getByLabel('Primary destination').fill('Austin');
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test('create a trip, add to the itinerary, and it is still there after a reload', async ({ page }) => {
  await createTrip(page);
  await expect(page.locator('main')).toContainText('June 12–14, 2027');
  await expect(page.locator('main')).toContainText('3 days · 2 nights');
  await expect(page.locator('main')).toContainText('Michelle, Jon, Mom');

  await page.getByRole('link', { name: '+ Itinerary item' }).first().click();
  await page.getByLabel('Title *').fill('Boat rental');
  await page.getByLabel('Start time', { exact: true }).fill('10:30');
  await page.getByRole('button', { name: 'Add to itinerary' }).click();
  await expect(page.locator('main')).toContainText('Boat rental');
  await expect(page.locator('main')).toContainText('10:30 AM');

  await page.reload();
  await expect(page.locator('main')).toContainText('Boat rental');
});

test('deleting an expense offers Undo, and the expense comes back unchanged', async ({ page }) => {
  await createTrip(page);
  await page.getByRole('link', { name: '+ Expense' }).first().click();
  await page.getByLabel('Description *').fill('Cabin');
  await page.getByLabel('Amount *').fill('90.01');
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.locator('main')).toContainText('$90.01');

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete Cabin' }).click();
  await expect(page.locator('main')).not.toContainText('$90.01');
  await expect(page.getByRole('status').filter({ hasText: 'Deleted Expense' })).toContainText('Cabin ($90.01)');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('main')).toContainText('$90.01');
  await expect(page.getByRole('status').filter({ hasText: 'Restored' })).toBeVisible();
});

test('a deleted trip and a deleted document can be restored from Profile, files included', async ({ page, context }) => {
  const tripId = await seedSampleTrip(page); // has a stored PDF
  // delete the document, then undo
  await page.goto(`/trips/${tripId}/documents`);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete hotel-confirmation.pdf' }).click();
  await expect(page.locator('main')).not.toContainText('hotel-confirmation.pdf');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('main')).toContainText('hotel-confirmation.pdf');
  const [popup] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Open hotel-confirmation.pdf' }).click()]);
  await expect.poll(() => popup.url(), { timeout: 10_000 }).toMatch(/^blob:/); // the file itself came back

  // delete the whole trip, then restore it from Profile
  await page.goto(`/trips/${tripId}/settings`);
  page.once('dialog', (d) => void d.accept('Puerto Rico Vacation'));
  await page.getByRole('button', { name: 'Delete trip…' }).click();
  await expect(page.locator('main')).toContainText('No trips yet');
  await page.goto('/profile');
  await expect(page.locator('#rd-h').locator('..')).toContainText('Trip: Puerto Rico Vacation');
  await page.getByRole('button', { name: 'Restore Trip Puerto Rico Vacation' }).click();
  await expect(page.getByRole('button', { name: 'Restore Trip Puerto Rico Vacation' })).toHaveCount(0);
  await page.goto('/trips');
  await page.getByRole('link', { name: 'Puerto Rico Vacation' }).click();
  await page.getByRole('link', { name: 'Expenses' }).last().click();
  await expect(page.locator('main')).toContainText('$320.01'); // expenses came back with the trip
});

test('moving an itinerary item to another day keeps its times and does not trip over a stale end date', async ({ page }) => {
  await createTrip(page);
  await page.getByRole('link', { name: '+ Itinerary item' }).first().click();
  await page.getByLabel('Title *').fill('Museum');
  await page.getByLabel('Start time', { exact: true }).fill('10:00');
  await page.getByLabel('End time', { exact: true }).fill('11:30');
  await page.getByRole('button', { name: 'Add to itinerary' }).click();
  const day1 = page.locator('section[aria-labelledby="day-2027-06-12"]');
  await expect(day1).toContainText('Museum');

  await page.getByRole('button', { name: 'Edit Museum' }).click();
  await page.getByLabel('Date *', { exact: true }).fill('2027-06-13');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('section[aria-labelledby="day-2027-06-13"]')).toContainText('Museum');
  await expect(page.locator('section[aria-labelledby="day-2027-06-13"]')).toContainText('10:00 AM');
  await expect(day1).not.toContainText('Museum');
});

test('an item left outside a shortened trip can still be edited and saved', async ({ page }) => {
  await createTrip(page); // Jun 12-14
  await page.getByRole('link', { name: '+ Itinerary item' }).first().click();
  await page.getByLabel('Title *').fill('Farewell lunch');
  await page.getByLabel('Date *', { exact: true }).fill('2027-06-14');
  await page.getByRole('button', { name: 'Add to itinerary' }).click();
  await expect(page.locator('main')).toContainText('Farewell lunch');

  const base = page.url().replace(/\/itinerary.*$/, '');
  await page.goto(base + '/settings');
  await page.getByLabel('End date', { exact: true }).fill('2027-06-13');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto(base + '/itinerary');
  await expect(page.locator('main')).toContainText('Farewell lunch'); // still shown, under its own day
  await page.getByRole('button', { name: 'Edit Farewell lunch' }).click();
  await page.getByLabel('Description').fill('Edited after the trip was shortened');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('main')).toContainText('Edited after the trip was shortened');
});

test('invalid input is refused with a clear message and nothing is saved', async ({ page }) => {
  await page.goto('/trips/new');
  await page.getByLabel('Trip name *').fill('Backwards');
  await page.getByLabel('Start date *').fill('2027-06-14');
  await page.getByLabel('End date *').fill('2027-06-12'); // the start-date handler keeps these ordered, so force the end back
  await page.getByLabel('Your name *').fill('Michelle');
  await page.locator('form').first().evaluate((f) => { (f as HTMLFormElement).noValidate = true; });
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByRole('alert')).toContainText(/before the start/i);
  await page.goto('/trips');
  await expect(page.locator('main')).toContainText('No trips yet');
});

test('a custom-split expense produces the right balances, and a partial payment survives a reload', async ({ page }) => {
  await createTrip(page);
  await page.getByRole('link', { name: '+ Expense' }).first().click();
  await page.getByLabel('Description *').fill('Cabin');
  await page.getByLabel('Amount *').fill('90.00');
  await page.getByRole('button', { name: 'Custom amounts' }).click();
  await page.getByLabel('Michelle amount').fill('50');
  await page.getByLabel('Jon amount').fill('30');
  await page.getByLabel('Mom amount').fill('10');
  await expect(page.getByText('Splits total $90.00, exactly the amount.')).toBeVisible();
  await page.getByRole('button', { name: 'Save expense' }).click();

  const who = page.locator('#bal-h').locator('..');
  await expect(who).toContainText('Jon owes Michelle $30.00');
  await expect(who).toContainText('Mom owes Michelle $10.00');

  // a split that does not add up cannot be saved
  await page.getByRole('button', { name: '+ Add expense' }).click();
  await page.getByLabel('Description *').fill('Bad');
  await page.getByLabel('Amount *').fill('90.00');
  await page.getByRole('button', { name: 'Custom amounts' }).click();
  await page.getByLabel('Michelle amount').fill('50');
  await page.getByLabel('Jon amount').fill('30');
  await expect(page.getByRole('button', { name: 'Save expense' })).toBeDisabled();
  await page.getByRole('button', { name: 'Close dialog' }).click();

  // partial payment from Jon
  await page.getByRole('button', { name: 'Mark as paid' }).first().click();
  await page.getByLabel('Amount paid').fill('10');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(who).toContainText('Jon owes Michelle $20.00');

  await page.reload();
  await expect(page.locator('#bal-h').locator('..')).toContainText('Jon owes Michelle $20.00');
  await expect(page.locator('#hist-h').locator('..')).toContainText('$10.00');

  // undo the payment: the debt goes back up
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: /Delete payment of \$10\.00/ }).click();
  await expect(page.locator('#bal-h').locator('..')).toContainText('Jon owes Michelle $30.00');
});

test('equal split of $100 among 3 is 33.33 / 33.33 / 33.34', async ({ page }) => {
  await createTrip(page);
  await page.getByRole('link', { name: '+ Expense' }).first().click();
  await page.getByLabel('Description *').fill('Groceries');
  await page.getByLabel('Amount *').fill('100');
  const split = page.locator('fieldset').filter({ hasText: 'Split' });
  await expect(split).toContainText('$33.33');
  await expect(split).toContainText('$33.34');
  await expect(split).toContainText('Splits total $100.00, exactly the amount.');
});

test('personal packing lists are per traveler, and packed items persist', async ({ page }) => {
  await createTrip(page);
  await page.goto(page.url().replace(/\/?$/, '') + '/packing');
  await page.getByRole('button', { name: 'Templates' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Beach Vacation' }).getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('main')).toContainText('0 / 21 packed');
  await page.getByRole('checkbox', { name: /Sunscreen/ }).check();
  await expect(page.locator('main')).toContainText('1 / 21 packed (5%)');
  await page.reload();
  await expect(page.locator('main')).toContainText('1 / 21 packed (5%)');

  await page.getByRole('button', { name: 'Personal' }).click();
  await expect(page.locator('main')).toContainText('0 / 0 packed');
  await page.getByLabel('Whose list').selectOption({ label: 'Jon' });
  await page.getByRole('button', { name: 'Templates' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Weekend Trip' }).getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('main')).not.toContainText('0 / 0 packed');
  await page.getByLabel('Whose list').selectOption({ label: 'Michelle (you)' });
  await expect(page.locator('main')).toContainText('0 / 0 packed'); // Jon's list is separate from mine
});

test('back up, erase everything, restore: the trip comes back exactly', async ({ page }, info) => {
  await createTrip(page, 'Backup Trip');
  await page.getByRole('link', { name: '+ Expense' }).first().click();
  await page.getByLabel('Description *').fill('Taxi');
  await page.getByLabel('Amount *').fill('45.50');
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.locator('main')).toContainText('$45.50');

  await page.goto('/profile');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download a backup' }).click()]);
  const file = info.outputPath('backup.json');
  await download.saveAs(file);
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  expect(parsed.app).toBe('tripnest');
  expect(parsed.tables.expenses[0].amount_cents).toBe(4550);

  await page.getByRole('button', { name: 'Erase all data on this device…' }).click();
  await page.getByLabel('Type ERASE to confirm').fill('ERASE');
  await page.getByRole('button', { name: 'Erase everything' }).click();
  await page.goto('/trips');
  await expect(page.locator('main')).toContainText('No trips yet');

  await page.goto('/profile');
  await page.locator('input[type=file]').first().setInputFiles(file);
  await page.getByRole('button', { name: 'Replace everything' }).click();
  await page.goto('/trips');
  await page.getByRole('link', { name: 'Backup Trip' }).click();
  await page.getByRole('link', { name: 'Expenses' }).last().click();
  await expect(page.locator('main')).toContainText('$45.50');
});

test('save one trip to a file, delete it, import the file: the trip returns as a copy', async ({ page }, info) => {
  await createTrip(page, 'Share Me');
  await page.getByRole('link', { name: '+ Expense' }).first().click();
  await page.getByLabel('Description *').fill('Taxi');
  await page.getByLabel('Amount *').fill('20');
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.locator('main')).toContainText('$20.00');

  const tripUrl = page.url().replace(/\/expenses.*$/, '');
  await page.goto(tripUrl + '/export');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save trip to a file' }).click()]);
  const file = info.outputPath('share-me.json');
  await download.saveAs(file);
  expect(download.suggestedFilename()).toMatch(/^tripnest-share-me-\d{4}-\d{2}-\d{2}\.json$/);

  await page.goto(tripUrl + '/settings');
  page.once('dialog', (d) => void d.accept('Share Me'));
  await page.getByRole('button', { name: 'Delete trip…' }).click();
  await expect(page.locator('main')).toContainText('No trips yet');

  await page.locator('input[type=file]').first().setInputFiles(file);
  await expect(page.getByRole('alert').or(page.getByRole('status'))).toContainText(/Added 1 trip/);
  await page.getByRole('link', { name: 'Share Me' }).click();
  await page.getByRole('link', { name: 'Expenses' }).last().click();
  await expect(page.locator('main')).toContainText('$20.00');
});

test('a damaged backup file is refused and changes nothing', async ({ page }, info) => {
  await createTrip(page, 'Keep Me');
  const bad = info.outputPath('bad.json');
  (await import('node:fs')).writeFileSync(bad, '{"app":"tripnest","format":1,"tables":{"trips":[{"id":"x","name":"Evil","start_date":"2027-01-05","end_date":"2027-01-01"}]}}');
  await page.goto('/profile');
  await page.locator('input[type=file]').first().setInputFiles(bad);
  await expect(page.getByRole('alert')).toContainText(/invalid/i);
  await page.goto('/trips');
  await expect(page.getByRole('link', { name: 'Keep Me' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Evil' })).toHaveCount(0);
});

test('deleting a trip removes it for good', async ({ page }) => {
  await createTrip(page, 'Temporary');
  await page.goto(page.url().replace(/\/?$/, '') + '/settings');
  page.once('dialog', (d) => void d.accept('Temporary'));
  await page.getByRole('button', { name: 'Delete trip…' }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await expect(page.locator('main')).toContainText('No trips yet');
});

test('to-do list: add from an idea, tick it off, search finds it, and the trip can be copied as a template', async ({ page }) => {
  await createTrip(page, 'Template Source');
  const base = page.url().replace(/\/$/, '');
  await page.goto(base + '/todo');
  await page.getByLabel('What needs doing?').fill('Renew passport');
  await page.getByLabel('Due (optional)').fill('2020-01-01');
  await page.getByRole('button', { name: 'Add to-do' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Renew passport' })).toContainText('Overdue');
  await page.getByRole('button', { name: '+ Book flights' }).click();
  await expect(page.getByRole('button', { name: '+ Book flights' })).toHaveCount(0); // added, so no longer an idea
  await page.getByRole('checkbox', { name: /Book flights/ }).click();
  await expect(page.getByRole('checkbox', { name: /Book flights/ })).toBeChecked();
  await expect(page.locator('main')).toContainText('1 / 2');

  // survives a reload; shows on the overview and in search
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Book flights/ })).toBeChecked();
  await page.goto(base);
  await expect(page.locator('main')).toContainText('1 still to do · 1 overdue');
  await page.goto(base + '/search');
  await page.getByLabel(/Search itinerary/).fill('passport');
  await expect(page.locator('main')).toContainText('Renew passport');

  // copy it as a template for next year
  await page.goto(base + '/settings');
  await page.getByRole('button', { name: 'Copy this trip…' }).click();
  await page.getByLabel('New trip name').fill('Template Next Year');
  await page.getByLabel('New start date').fill('2028-06-12');
  await page.getByRole('button', { name: 'Create the copy' }).click();
  await expect(page.getByRole('heading', { name: 'Template Next Year' })).toBeVisible();
  await expect(page.locator('main')).toContainText('June 12–14, 2028');
  await page.goto(page.url().replace(/\/$/, '') + '/todo');
  await expect(page.getByRole('checkbox', { name: /Book flights/ })).not.toBeChecked(); // everything starts undone
  await expect(page.getByRole('checkbox', { name: /Renew passport/ })).toBeVisible();
});
