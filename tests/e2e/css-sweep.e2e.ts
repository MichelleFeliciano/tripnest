/**
 * Broad CSS sweeps that run once (desktop project) and resize the window themselves:
 * every page at many sizes, print layout, Windows high-contrast mode, and larger browser text.
 */
import { test, expect, type Page } from '@playwright/test';
import { seedSampleTrip } from './fixtures';

const PAGES = ['', 'itinerary', 'itinerary?view=month', 'itinerary?view=week', 'explore', 'reservations', 'details', 'packing', 'todo', 'expenses', 'budget', 'notes', 'documents', 'members', 'map', 'search', 'export', 'settings', 'more'];
const SIZES: [number, number][] = [[320, 568], [360, 740], [375, 812], [414, 896], [568, 320], [667, 375], [719, 900], [720, 900], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]];

/** What sticks out of the screen sideways (ignoring table scroll boxes and the map, which scroll inside themselves). */
const overflow = (page: Page) => page.evaluate(() => {
  const w = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth <= w) return null;
  const el = [...document.querySelectorAll('body *')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 1 && !e.closest('.table-wrap, .leaflet-container, .tabs, .sr-only'); });
  return `page is ${document.documentElement.scrollWidth}px wide in ${w}px${el ? `, e.g. <${el.tagName.toLowerCase()} class="${el.className}">` : ''}`;
});

test('every page fits every screen size, and the right navigation shows at each', async ({ page }) => {
  test.setTimeout(280_000);
  const tripId = await seedSampleTrip(page);
  const bad: string[] = [];
  const routes = ['/trips', '/trips/new', '/profile', ...PAGES.map((p) => `/trips/${tripId}/${p}`)];
  for (const route of routes) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(route);
    await page.waitForSelector('main h1, main h2');
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(60);
      const o = await overflow(page);
      if (o) bad.push(`${route.replace(tripId, ':trip')} @${width}x${height}: ${o}`);
      const nav = await page.evaluate(() => ({
        topnav: getComputedStyle(document.querySelector('.topnav')!).display !== 'none',
        profileBtn: getComputedStyle(document.querySelector('.profile-btn')!).display !== 'none',
        tabbar: !!document.querySelector('.tabbar') && getComputedStyle(document.querySelector('.tabbar')!).display !== 'none',
        tabs: !!document.querySelector('.tabs') && getComputedStyle(document.querySelector('.tabs')!).display !== 'none',
      }));
      const phone = width < 720;
      const inTrip = route.includes(tripId);
      const want = { topnav: !phone, profileBtn: phone, tabbar: phone && inTrip, tabs: !phone && inTrip };
      if (JSON.stringify(nav) !== JSON.stringify(want)) bad.push(`${route.replace(tripId, ':trip')} @${width}: navigation ${JSON.stringify(nav)}, wanted ${JSON.stringify(want)}`);
    }
  }
  expect(bad).toEqual([]);
});

test('larger browser text (150% and 200%) still fits a phone without losing anything', async ({ page }) => {
  test.setTimeout(200_000);
  const tripId = await seedSampleTrip(page);
  await page.setViewportSize({ width: 375, height: 812 });
  const bad: string[] = [];
  for (const pct of [150, 200]) {
    for (const route of ['/trips', `/trips/${tripId}`, `/trips/${tripId}/itinerary`, `/trips/${tripId}/expenses`, `/trips/${tripId}/packing`, `/trips/${tripId}/more`, '/profile']) {
      await page.goto(route);
      await page.waitForSelector('main h1');
      await page.addStyleTag({ content: `html { font-size: ${pct}% !important; }` });
      await page.waitForTimeout(80);
      const o = await overflow(page);
      if (o) bad.push(`${route.replace(tripId, ':trip')} @${pct}%: ${o}`);
      // the bottom tab bar must still show all five labels in full
      const clipped = await page.evaluate(() => [...document.querySelectorAll('.tabbar a')].filter((a) => a.scrollWidth > a.clientWidth + 1).map((a) => a.textContent));
      if (clipped.length) bad.push(`${route.replace(tripId, ':trip')} @${pct}%: tab labels cut off: ${clipped.join(', ')}`);
      // fixed-height bars must still contain what is inside them
      const spill = await page.evaluate(() => ['.tabbar', '.topbar'].flatMap((sel) => { const bar = document.querySelector(sel); if (!bar || getComputedStyle(bar).display === 'none') return []; const b = bar.getBoundingClientRect(); return [...bar.querySelectorAll('a, button')].filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && (r.top < b.top - 1 || r.bottom > b.bottom + 1); }).map((c) => `${sel}: ${(c.getAttribute('aria-label') || c.textContent || '').trim().slice(0, 20)}`); }));
      if (spill.length) bad.push(`${route.replace(tripId, ':trip')} @${pct}%: sticks out of its bar: ${spill.join(', ')}`);
    }
  }
  expect(bad).toEqual([]);
});

test('the browser text-size setting is respected (no fixed pixel body text)', async ({ page }) => {
  await page.goto('/trips');
  await page.waitForSelector('main h1');
  const sizes = await page.evaluate(() => {
    const px = (e: Element) => parseFloat(getComputedStyle(e).fontSize);
    const before = px(document.body);
    document.documentElement.style.fontSize = '200%';
    return { before, after: px(document.body) };
  });
  expect(sizes.after).toBeCloseTo(sizes.before * 2, 0);
});

test('print layout hides the app chrome and does not clip wide tables', async ({ page }) => {
  const tripId = await seedSampleTrip(page);
  await page.goto(`/trips/${tripId}/export`);
  await page.waitForSelector('article');
  await page.emulateMedia({ media: 'print' });
  const r = await page.evaluate(() => {
    const shown = (s: string) => [...document.querySelectorAll(s)].some((e) => getComputedStyle(e).display !== 'none');
    const wraps = [...document.querySelectorAll('.table-wrap')].map((w) => getComputedStyle(w).overflowX);
    return { chrome: ['.topbar', '.tabs', '.tabbar', '.toast-region', '.topbar-btn', '.no-print'].filter(shown), wraps, bg: getComputedStyle(document.body).backgroundColor };
  });
  expect(r.chrome).toEqual([]);
  expect(r.wraps.length).toBeGreaterThan(0);
  expect(r.wraps.every((o) => o === 'visible')).toBe(true);
  expect(r.bg).toBe('rgb(255, 255, 255)');
});

test('Windows high-contrast mode keeps progress bars and selected states visible', async ({ page }) => {
  const tripId = await seedSampleTrip(page);
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto(`/trips/${tripId}`);
  await page.waitForSelector('.progress-fill');
  const fill = await page.evaluate(() => getComputedStyle(document.querySelector('.progress-fill')!).backgroundColor);
  expect(fill).not.toBe('rgba(0, 0, 0, 0)');
  await page.goto(`/trips/${tripId}/explore`);
  await page.waitForSelector('.seg button[aria-pressed="true"]');
  const pressed = await page.evaluate(() => { const b = document.querySelector('.seg button[aria-pressed="true"]')!; const s = getComputedStyle(b); return { style: s.outlineStyle, width: s.outlineWidth }; });
  expect(pressed.style).not.toBe('none');
});
