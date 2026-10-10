/** Layout rules that CSS review turned up, each pinned by a test. */
import { test, expect } from '@playwright/test';
import { sampleTripFile, seedSampleTrip } from './fixtures';

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

test('phone top bar: a Profile button everywhere, and a Back button that goes somewhere sensible', async ({ page }, info) => {
  const phone = info.project.name.startsWith('phone');
  const tripId = await seedSampleTrip(page);
  const back = page.getByRole('button', { name: 'Back', exact: true });
  const profile = page.getByRole('link', { name: 'Profile and backups' });

  await page.goto('/trips');
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible();
  await expect(back).toHaveCount(0); // nothing above the trips list
  if (!phone) {
    await expect(profile).toBeHidden(); // desktop keeps its text links
    await expect(back).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Profile' })).toBeVisible();
    return;
  }
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
  await expect(profile).toBeVisible();

  // Trips -> Profile -> Back returns to Trips
  await profile.click();
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/trips$/);

  // Trips -> New trip -> Back
  await page.getByRole('link', { name: '+ New trip' }).click();
  await expect(page).toHaveURL(/\/trips\/new$/);
  await back.click();
  await expect(page).toHaveURL(/\/trips$/);

  // Trip -> section -> Back is the browser's own back (one step), then Back again leaves the trip
  await page.getByRole('link', { name: /Puerto Rico/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}$`));
  await page.goto(`/trips/${tripId}/expenses`, { waitUntil: 'domcontentloaded' });
  await expect(back).toBeVisible();
  // a page opened directly has no earlier page in this tab: Back goes up one level instead of leaving the app
  await page.goto('about:blank');
  await page.goto(`/trips/${tripId}/expenses`);
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(new RegExp(`/trips/${tripId}$`));
  await back.click();
  await expect(page).toHaveURL(/\/trips$/);

  // buttons are big enough to tap, and the bar does not overflow at the narrowest width
  await page.goto('/profile');
  const sizes = await page.evaluate(() => [...document.querySelectorAll('.topbar-btn')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  for (const [w, h] of sizes) { expect(w).toBeGreaterThanOrEqual(44); expect(h).toBeGreaterThanOrEqual(44); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a focused text box keeps its rounded corners', async ({ page }) => {
  await page.goto('/trips/new');
  const box = page.getByLabel('Trip name *');
  const before = await box.evaluate((e) => getComputedStyle(e).borderRadius);
  await box.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  expect(await box.evaluate((e) => getComputedStyle(e).borderRadius)).toBe(before);
});

test('focus rings are not clipped inside segmented buttons, the calendar or tables', async ({ page }) => {
  const tripId = await seedSampleTrip(page);
  await page.goto(`/trips/${tripId}/itinerary?view=month`);
  await page.locator('.cal button:not(:disabled)').first().focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const calOffset = await page.evaluate(() => parseFloat(getComputedStyle(document.activeElement!).outlineOffset));
  expect(calOffset, 'calendar buttons sit in a scrolling box: their ring must be drawn inside').toBeLessThan(0);
  await page.goto(`/trips/${tripId}/explore`);
  await page.locator('.seg button').first().focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const segOffset = await page.evaluate(() => parseFloat(getComputedStyle(document.activeElement!).outlineOffset));
  expect(segOffset, 'segmented buttons clip their overflow: the ring must be drawn inside').toBeLessThan(0);
});

test('keyboard focus is never hidden behind the sticky bars', async ({ page }, info) => {
  test.setTimeout(150_000);
  const tripId = await seedSampleTrip(page);
  const problems: string[] = [];
  for (const path of ['itinerary', 'expenses', 'packing', '']) {
    await page.goto(`/trips/${tripId}/${path}`);
    await page.waitForSelector('main h1');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < 70; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) return null;
        const x = Math.min(Math.max(b.left + b.width / 2, 1), window.innerWidth - 2);
        const y = Math.min(Math.max(b.top + Math.min(b.height / 2, 8), 1), window.innerHeight - 2);
        const hit = document.elementFromPoint(x, y);
        const covered = !!hit && !el.contains(hit) && !hit.contains(el);
        const bar = hit?.closest('.topbar, .tabbar, .day-head, .toast-region');
        return { covered, by: bar ? (bar as HTMLElement).className : null, label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40) };
      });
      if (r?.covered && r.by) problems.push(`/${path} "${r.label}" is under .${r.by.split(' ')[0]}`);
    }
  }
  expect([...new Set(problems)], `on ${info.project.name}`).toEqual([]);
});

test('very long unbroken words never push the page sideways', async ({ page }, info) => {
  test.setTimeout(150_000);
  const long = 'Supercalifragilistic'.repeat(5) + 'https://example.com/' + 'a'.repeat(80);
  const file = sampleTripFile();
  const t = file.tables;
  t.trips[0].name = long.slice(0, 110);
  t.trips[0].description = long;
  t.destinations.forEach((d: Record<string, unknown>) => { d.name = long.slice(0, 120); d.notes = long; });
  t.itinerary_items.forEach((i: Record<string, unknown>) => { i.title = long; i.description = long; i.notes = long; i.location_name = long; i.address = long; });
  t.reservations.forEach((r: Record<string, unknown>) => { r.title = long; r.provider = long; r.notes = long; r.address = long; });
  t.notes.forEach((n: Record<string, unknown>) => { n.body = long; });
  t.packing_items.forEach((p: Record<string, unknown>) => { p.name = long; });
  t.expenses.forEach((e: Record<string, unknown>) => { e.description = long; e.notes = long; });
  t.travelers.forEach((v: Record<string, unknown>, n: number) => { v.name = `${n}${long}`.slice(0, 80); });
  await page.goto('/trips');
  await page.waitForSelector('main h1');
  const ids = await page.evaluate(async (json) => {
    const module = '/src/api/backup.ts';
    const b = await import(/* @vite-ignore */ module);
    return b.importTrips(b.parseBackup(json)) as Promise<string[]>;
  }, JSON.stringify(file));
  const tripId = ids[0];
  const wide: string[] = [];
  for (const path of ['', 'itinerary', 'reservations', 'details', 'packing', 'expenses', 'budget', 'notes', 'documents', 'members', 'todo', 'search', 'export', 'settings']) {
    await page.goto(`/trips/${tripId}/${path}`);
    await page.waitForSelector('main h1');
    const over = await page.evaluate(() => {
      const el = document.documentElement;
      if (el.scrollWidth <= window.innerWidth) return null;
      const culprit = [...document.querySelectorAll('main *')].find((e) => { const r = e.getBoundingClientRect(); return r.right > window.innerWidth + 1 && !e.closest('.table-wrap'); });
      return `${el.scrollWidth}px > ${window.innerWidth}px, e.g. <${culprit?.tagName.toLowerCase()} class="${culprit?.className}">`;
    });
    if (over) wide.push(`/${path}: ${over}`);
  }
  await page.goto('/trips');
  const trips = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  if (!trips) wide.push('/trips: wider than the screen');
  expect(wide, `on ${info.project.name}`).toEqual([]);
});
