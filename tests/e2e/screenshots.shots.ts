import { test } from '@playwright/test';
import { seedSampleTrip } from './fixtures';

const OUT = 'docs/screenshots';

test('README screenshots', async ({ page, browser }) => {
  const tripId = await seedSampleTrip(page);
  const shot = async (name: string, path: string, ready: string, prep?: () => Promise<void>) => {
    await page.goto(path);
    await page.waitForSelector(ready);
    if (prep) await prep();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  };

  await shot('trips', '/trips', 'text=Puerto Rico Vacation');
  await shot('overview', `/trips/${tripId}`, '#todo-h');
  await shot('itinerary', `/trips/${tripId}/itinerary?view=timeline`, 'li.item');
  await shot('expenses', `/trips/${tripId}/expenses`, '#list-h');
  await shot('packing', `/trips/${tripId}/packing`, '.pack-item');

  // Explore needs a map service; show it with a small made-up reply so no live service is called
  await page.route(/overpass-api\.de/, (r) => r.fulfill({ json: { elements: [
    { type: 'node', id: 1, lat: 18.4690, lon: -66.1100, tags: { name: 'La Factoría', amenity: 'restaurant', cuisine: 'puerto_rican;seafood', outdoor_seating: 'yes', wikidata: 'Q1' } },
    { type: 'node', id: 2, lat: 18.4701, lon: -66.1243, tags: { name: 'Castillo San Felipe del Morro', historic: 'fort', fee: 'yes', start_date: '1539', wheelchair: 'limited', wikidata: 'Q2' } },
    { type: 'node', id: 3, lat: 18.4663, lon: -66.1167, tags: { name: 'Plaza de Armas', tourism: 'attraction', description: 'The oldest plaza in the city, with a fountain and cafés all around.', wikidata: 'Q3' } },
  ] } }));
  await page.route(/nominatim\.openstreetmap\.org/, (r) => r.fulfill({ json: [{ lat: '18.4655', lon: '-66.1057' }] }));
  await page.goto(`/trips/${tripId}/explore`);
  await page.getByRole('button', { name: 'Find things to do' }).click();
  await page.waitForSelector('.place-desc');
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('#ex-res')?.scrollIntoView());
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/explore.png` });

  // the same overview at night
  const dark = await browser.newContext({ colorScheme: 'dark', viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const dp = await dark.newPage();
  await dp.goto('/trips');
  await dp.waitForSelector('main h1');
  await dp.evaluate(async (json) => { const m = '/src/api/backup.ts'; const b = await import(/* @vite-ignore */ m); await b.importTrips(b.parseBackup(json)); }, JSON.stringify((await import('./fixtures')).sampleTripFile()));
  await dp.goto('/trips');
  await dp.waitForSelector('text=Puerto Rico Vacation');
  await dp.getByRole('link', { name: 'Puerto Rico Vacation' }).first().click();
  await dp.waitForSelector('#todo-h');
  await dp.waitForTimeout(700);
  await dp.screenshot({ path: `${OUT}/overview-dark.png` });
  await dark.close();
});
