/**
 * Visits every screen with sample data at phone and desktop sizes and checks:
 *  - nothing makes the page scroll sideways or sticks out of the viewport
 *  - buttons, inputs and links are big enough to tap (phones)
 *  - no console/page errors, no calls to a real Supabase host
 *  - automated accessibility scan (axe, WCAG 2.2 AA): fails on serious/critical issues
 * Screenshots go to tests/e2e/.artifacts/shots/<project>/ so they can be eyeballed.
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { IDS, installMock } from './mock-supabase';

const T = IDS.TRIP;
const SCREENS: [string, string][] = [
  ['trips-list', '/trips'], ['new-trip', '/trips/new'], ['profile', '/profile'],
  ['overview', `/trips/${T}`], ['itinerary-timeline', `/trips/${T}/itinerary`], ['itinerary-month', `/trips/${T}/itinerary?view=month`],
  ['itinerary-week', `/trips/${T}/itinerary?view=week`], ['itinerary-day', `/trips/${T}/itinerary?view=day`],
  ['explore', `/trips/${T}/explore`], ['reservations', `/trips/${T}/reservations`], ['details', `/trips/${T}/details`],
  ['packing', `/trips/${T}/packing`], ['expenses', `/trips/${T}/expenses`], ['budget', `/trips/${T}/budget`],
  ['notes', `/trips/${T}/notes`], ['documents', `/trips/${T}/documents`], ['members', `/trips/${T}/members`],
  ['map', `/trips/${T}/map`], ['search', `/trips/${T}/search`], ['export', `/trips/${T}/export`],
  ['settings', `/trips/${T}/settings`], ['more', `/trips/${T}/more`],
  // dialogs
  ['dialog-add-itinerary', `/trips/${T}/itinerary?new=1`], ['dialog-add-expense', `/trips/${T}/expenses?new=1`],
  ['dialog-add-reservation', `/trips/${T}/reservations?new=1`], ['dialog-add-packing', `/trips/${T}/packing?new=1`],
];

const isPhone = (name: string) => name.startsWith('phone');

async function layoutReport(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad: string[] = [];
    const small: string[] = [];
    const label = (el: Element) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} "${(el.textContent || (el as HTMLInputElement).placeholder || el.getAttribute('aria-label') || '').trim().slice(0, 28)}"`;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.closest('.table-wrap, .tabs, .leaflet-container, .sr-only, .skip')) continue; // .skip is the deliberately off-screen skip link
      if (r.right > vw + 1 || r.left < -1) bad.push(`${label(el)} spans ${Math.round(r.left)}..${Math.round(r.right)} (viewport ${vw})`);
    }
    const interactive = document.querySelectorAll('button, input:not([type=hidden]), select, textarea, summary, a.btn, .tabbar a, .tabs a, .topnav a');
    for (const el of interactive) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.closest('.sr-only')) continue;
      let box = r;
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) box = (el.closest('label, .check, .pack-item') ?? el).getBoundingClientRect();
      if (box.height < 32 || box.width < 32) small.push(`${label(el)} is ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
    return { vw, scrollWidth: document.documentElement.scrollWidth, bad: [...new Set(bad)].slice(0, 6), small: [...new Set(small)].slice(0, 8) };
  });
}

for (const [name, path] of SCREENS) {
  test(`${name}`, async ({ page }, info) => {
    const mock = await installMock(page);
    const consoleErrors: string[] = [];
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      const t = m.text();
      if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|ERR_INTERNET|tile\.openstreetmap/.test(t)) consoleErrors.push(`console: ${t.slice(0, 160)}`);
    });
    await page.route(/tile\.openstreetmap\.org|nominatim\.openstreetmap\.org|overpass-api\.de/, (r) => r.abort());

    await page.goto(path);
    await page.waitForSelector('main h1, main h2', { timeout: 20_000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    if (name === 'map') await page.waitForTimeout(800);

    const issues: string[] = [];
    const lay = await layoutReport(page);
    if (lay.scrollWidth > lay.vw + 1) issues.push(`page scrolls sideways: content ${lay.scrollWidth}px in a ${lay.vw}px viewport`);
    issues.push(...lay.bad.map((b) => `sticks out: ${b}`));
    if (isPhone(info.project.name)) issues.push(...lay.small.map((s) => `tap target too small: ${s}`));
    issues.push(...consoleErrors);
    if (mock.realHostCalls.length) issues.push(`called a REAL Supabase host: ${mock.realHostCalls[0]}`);

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).exclude('.leaflet-container').analyze();
    for (const v of axe.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) {
      issues.push(`a11y [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length}x) e.g. ${v.nodes[0].target.join(' ').slice(0, 80)}`);
    }
    const minor = axe.violations.filter((x) => x.impact === 'moderate' || x.impact === 'minor').map((v) => `${v.id}(${v.nodes.length})`);
    if (minor.length) info.annotations.push({ type: 'a11y-minor', description: minor.join(', ') });

    await page.screenshot({ path: `tests/e2e/.artifacts/shots/${info.project.name}/${name}.png`, fullPage: true });
    expect(issues, `${name} @ ${info.project.name}\n  - ${issues.join('\n  - ')}`).toEqual([]);
  });
}

test('login page (signed out)', async ({ page }, info) => {
  const mock = await installMock(page, { signedIn: false });
  await page.goto('/login');
  await page.waitForSelector('main h1');
  const lay = await layoutReport(page);
  const issues: string[] = [];
  if (lay.scrollWidth > lay.vw + 1) issues.push(`page scrolls sideways (${lay.scrollWidth} > ${lay.vw})`);
  if (isPhone(info.project.name)) issues.push(...lay.small.map((s) => `tap target too small: ${s}`));
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  issues.push(...axe.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').map((v) => `a11y [${v.impact}] ${v.id}: ${v.help}`));
  if (mock.realHostCalls.length) issues.push('called a REAL Supabase host');
  await page.screenshot({ path: `tests/e2e/.artifacts/shots/${info.project.name}/login.png`, fullPage: true });
  expect(issues, issues.join('\n')).toEqual([]);
});

test('phone navigation: bottom tab bar reaches the key screens in one tap', async ({ page }, info) => {
  test.skip(!isPhone(info.project.name), 'phone only');
  await installMock(page);
  await page.goto(`/trips/${T}`);
  await page.waitForSelector('main h1');
  const bar = page.getByRole('navigation', { name: 'Trip sections' }).last();
  await expect(bar).toBeVisible();
  for (const [label, heading] of [['Itinerary', /Day 1/], ['Packing', /packed/], ['Expenses', /Expenses/], ['More', /More/]] as const) {
    await bar.getByRole('link', { name: label }).click();
    await expect(page.locator('main')).toContainText(heading);
  }
});

test('phone: money tables show every amount without sideways scrolling', async ({ page }, info) => {
  test.skip(!isPhone(info.project.name), 'phone only');
  await installMock(page);
  await page.goto(`/trips/${T}/expenses`);
  await page.waitForSelector('#list-h');
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const cut = [...document.querySelectorAll('td.num')].filter((c) => { const b = c.getBoundingClientRect(); return b.width > 0 && b.right > vw - 4; }).map((c) => c.textContent);
    const scrolling = [...document.querySelectorAll('.table-wrap')].filter((w) => w.scrollWidth > w.clientWidth + 1 && (w as HTMLElement).offsetParent).map((w) => w.querySelector('caption')?.textContent);
    return { cut, scrolling };
  });
  expect(r.cut, 'amounts touching/cut by the screen edge').toEqual([]);
  expect(r.scrolling, 'tables that need sideways scrolling on a phone').toEqual([]);
});

test('phone: today, hotel, reservation numbers, packing, expense and balances are reachable with minimal navigation', async ({ page }, info) => {
  test.skip(!isPhone(info.project.name), 'phone only');
  await installMock(page);
  await page.goto(`/trips/${T}`);
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.goto(`/trips/${T}/details`);
  await expect(page.locator('main')).toContainText('HC-5521');
  await expect(page.locator('main')).toContainText('XK92LM');
  await page.goto(`/trips/${T}/expenses`);
  await expect(page.locator('main')).toContainText(/owes/);
  await expect(page.getByRole('button', { name: '+ Add expense' })).toBeVisible();
});
