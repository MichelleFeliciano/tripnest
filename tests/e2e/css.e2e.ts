/** Layout rules that CSS review turned up, each pinned by a test. */
import { test, expect } from '@playwright/test';
import { seedSampleTrip } from './fixtures';

test('map controls never paint over the sticky top bar or the bottom tab bar', async ({ page }, info) => {
  const tripId = await seedSampleTrip(page);
  await page.goto(`/trips/${tripId}/map`);
  await expect(page.locator('.leaflet-control-zoom')).toBeVisible();
  const phone = info.project.name.startsWith('phone');

  // scroll so the top of the map slides under the top bar
  const topHit = await page.evaluate(() => {
    const map = document.querySelector('.map') as HTMLElement;
    window.scrollTo(0, map.getBoundingClientRect().top + window.scrollY - 20);
    const zoom = document.querySelector('.leaflet-control-zoom')!.getBoundingClientRect();
    const bar = document.querySelector('.topbar')!.getBoundingClientRect();
    const x = zoom.left + zoom.width / 2;
    const y = Math.min(bar.bottom - 6, zoom.top + 6); // a point inside both the bar and the control's column
    const hit = document.elementFromPoint(x, y);
    return { overlap: y >= bar.top && y <= bar.bottom, insideBar: !!hit?.closest('.topbar') };
  });
  expect(topHit.overlap).toBe(true);
  expect(topHit.insideBar, 'the top bar must stay above the map').toBe(true);

  if (phone) {
    const bottomHit = await page.evaluate(() => {
      const map = document.querySelector('.map') as HTMLElement;
      window.scrollTo(0, map.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 30);
      const bar = document.querySelector('.tabbar')!.getBoundingClientRect();
      const hit = document.elementFromPoint(window.innerWidth - 20, bar.top + 8);
      return !!hit?.closest('.tabbar');
    });
    expect(bottomHit, 'the tab bar must stay above the map').toBe(true);
  }
});

test('Explore shows a short description under each place, and adds it to the itinerary', async ({ page }) => {
  const tripId = await seedSampleTrip(page);
  await page.route(/overpass-api\.de/, (r) => r.fulfill({
    json: {
      elements: [
        { type: 'node', id: 1, lat: 18.4655, lon: -66.1057, tags: { name: 'La Factoría', amenity: 'restaurant', cuisine: 'puerto_rican;seafood', outdoor_seating: 'yes', website: 'https://example.com', wikidata: 'Q1' } },
        { type: 'node', id: 2, lat: 18.466, lon: -66.106, tags: { name: 'Plaza de Armas', tourism: 'attraction', description: 'The oldest plaza in the city, a quiet place to sit under the trees and watch the pigeons, with a fountain in the middle and cafés all around. Often hosts craft fairs and small concerts on weekends.', wikidata: 'Q2' } },
        { type: 'node', id: 3, lat: 18.467, lon: -66.107, tags: { name: 'Unmarked Lookout', tourism: 'viewpoint' } },
      ],
    },
  }));
  await page.goto(`/trips/${tripId}/explore`);
  await page.getByRole('button', { name: 'Find things to do' }).click();
  const list = page.locator('ul.list.card');
  await expect(list).toContainText('La Factoría');
  await expect(list).toContainText('Puerto Rican and seafood restaurant. Has outdoor seating.');
  await expect(list).toContainText('The oldest plaza in the city');
  await expect(list.getByText(/Often hosts craft fairs/)).toHaveCount(0); // long text is clipped at a word
  await expect(list.locator('li', { hasText: 'Unmarked Lookout' }).locator('.place-desc')).toHaveCount(0); // nothing to say, so nothing shown
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // adding a place carries its description into the itinerary item
  await page.getByRole('button', { name: 'Add La Factoría to itinerary' }).click();
  await expect(page.getByRole('button', { name: 'Add La Factoría to itinerary' })).toContainText('Added');
  await page.goto(`/trips/${tripId}/itinerary`);
  await expect(page.locator('main')).toContainText('Puerto Rican and seafood restaurant. Has outdoor seating.');
});
