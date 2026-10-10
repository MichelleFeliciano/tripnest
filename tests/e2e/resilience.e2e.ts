/** Things that only a real browser can prove: crash recovery and opening a stored document. */
import { test, expect } from '@playwright/test';
import { clickAndExpectFileOpened, seedSampleTrip } from './fixtures';

test.beforeEach(({ page: _page }, info) => {
  void _page;
  test.skip(!['phone-375', 'desktop'].includes(info.project.name), 'two sizes are enough');
});

test('a damaged record shows a calm error page instead of a blank screen, and the data is untouched', async ({ page }) => {
  const tripId = await seedSampleTrip(page);
  // Bypass every check and write a broken itinerary item straight into storage.
  await page.evaluate(async (id) => {
    const dbPath = '/src/api/db.ts';
    const { transaction } = await import(/* @vite-ignore */ dbPath);
    await transaction(['itinerary_items'], 'readwrite', (x: any) => x.put('itinerary_items', {
      id: 'bad-1', trip_id: id, local_date: '2027-01-01', title: 'Broken', item_type: 'activity', start_at: 'not a date', start_tz: 'UTC',
      end_at: null, end_tz: null, description: null, location_name: null, address: null, latitude: null, longitude: null, notes: null,
      cost_cents: null, currency: null, confirmation_number: null, website: null, contact: null, sort_order: 0, destination_id: null,
    }));
  }, tripId);

  await page.goto(`/trips/${tripId}/itinerary`);
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Your trips are safe');
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();

  await page.getByRole('link', { name: 'Go to my trips' }).click();
  await expect(page.getByRole('link', { name: 'Puerto Rico Vacation' })).toBeVisible(); // everything else still works
});

test('Open on a stored document opens it in a new tab without a false "blocked" error', async ({ page }) => {
  const tripId = await seedSampleTrip(page);
  await page.goto(`/trips/${tripId}/documents`);
  await expect(page.locator('main')).toContainText('hotel-confirmation.pdf');
  await clickAndExpectFileOpened(page, () => page.getByRole('button', { name: 'Open hotel-confirmation.pdf' }).click());
  await expect(page.getByRole('alert')).toHaveCount(0);
});
