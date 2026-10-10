/** Weather card: off until opted in, finds the place, shows forecast / typical days, sends only coordinates. */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

async function makeTrip(page: Page, start: string, end: string, name = 'Weather Trip') {
  await page.goto('/trips/new');
  await page.getByLabel('Trip name *').fill(name);
  await page.getByLabel('Start date *').fill(start);
  await page.getByLabel('End date *').fill(end);
  await page.getByLabel('Your name *').fill('Michelle');
  await page.getByLabel('Primary destination').fill('San Juan');
  await page.getByRole('button', { name: 'Create trip' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

/** Mock both services; record every Open-Meteo URL so we can check what was sent. */
async function mockServices(page: Page) {
  const sent: string[] = [];
  await page.route(/nominatim\.openstreetmap\.org/, (r) => r.fulfill({ json: [{ lat: '18.4655', lon: '-66.1057' }] }));
  await page.route(/open-meteo\.com/, (r) => {
    const u = new URL(r.request().url());
    sent.push(r.request().url());
    const start = u.searchParams.get('start_date')!;
    const end = u.searchParams.get('end_date')!;
    const time: string[] = [];
    for (let t = Date.parse(start); t <= Date.parse(end); t += DAY) time.push(new Date(t).toISOString().slice(0, 10));
    const forecast = u.hostname === 'api.open-meteo.com';
    void r.fulfill({
      json: {
        daily: {
          time, weather_code: time.map(() => 61), temperature_2m_max: time.map(() => 30), temperature_2m_min: time.map(() => 8),
          precipitation_sum: time.map(() => 6), ...(forecast ? { precipitation_probability_max: time.map(() => 70) } : {}),
        },
      },
    });
  });
  return sent;
}

test('weather stays off until turned on, then finds the place and shows the forecast', async ({ page }) => {
  const sent = await mockServices(page);
  await makeTrip(page, iso(3), iso(5));
  const card = page.getByRole('region', { name: 'Weather' });
  await expect(card.getByRole('button', { name: 'Show the weather' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(sent).toEqual([]); // nothing leaves the device before opting in

  await card.getByRole('button', { name: 'Show the weather' }).click();
  await card.getByRole('button', { name: 'Find San Juan on the map' }).click();
  await expect(card.getByText('Forecast').first()).toBeVisible();
  await expect(card.getByText('Rain', { exact: false }).first()).toBeVisible();
  await expect(card.getByText('70% rain').first()).toBeVisible();
  await expect(card.getByRole('listitem').filter({ hasText: 'Forecast' })).toHaveCount(3);

  // temperatures: 30°C / 8°C, shown in °F or °C on request
  await card.getByRole('button', { name: '°C' }).click();
  await expect(card.getByText('30° / 8°').first()).toBeVisible();
  await card.getByRole('button', { name: '°F' }).click();
  await expect(card.getByText('86° / 46°').first()).toBeVisible();

  // practical packing ideas
  await expect(card.getByText('Rain on 3 of 3 days: pack a rain jacket or umbrella.')).toBeVisible();
  await expect(card.getByText('Cool mornings or evenings: bring a warm layer.')).toBeVisible();

  // only coordinates and dates went out: no trip name, traveler name or destination name
  expect(sent.length).toBeGreaterThan(0);
  for (const url of sent) {
    expect(url).toContain('latitude=18.4655');
    expect(decodeURIComponent(url)).not.toMatch(/Weather Trip|Michelle|San Juan/);
  }

  // the choice sticks across a reload and can be turned off again
  await page.reload();
  await expect(page.getByRole('region', { name: 'Weather' }).getByText('Forecast').first()).toBeVisible();
  await page.getByRole('region', { name: 'Weather' }).getByRole('button', { name: 'Turn off weather' }).click();
  await expect(page.getByRole('region', { name: 'Weather' }).getByRole('button', { name: 'Show the weather' })).toBeVisible();
});

test('a trip far in the future shows last year as a typical guide, clearly labelled', async ({ page }) => {
  await mockServices(page);
  await makeTrip(page, iso(120), iso(122), 'Far Trip');
  const card = page.getByRole('region', { name: 'Weather' });
  await card.getByRole('button', { name: 'Show the weather' }).click();
  await card.getByRole('button', { name: 'Find San Juan on the map' }).click();
  await expect(card.getByText('Typical').first()).toBeVisible();
  await expect(card.getByText(/same date last year: a rough guide, not a forecast/)).toBeVisible();
  await expect(card.getByText('Forecast', { exact: true })).toHaveCount(0);
});

test('a failing weather service shows a friendly message and the rest of the page still works', async ({ page }) => {
  await page.route(/nominatim\.openstreetmap\.org/, (r) => r.fulfill({ json: [{ lat: '18.4655', lon: '-66.1057' }] }));
  await page.route(/open-meteo\.com/, (r) => r.fulfill({ status: 500, body: 'nope' }));
  await makeTrip(page, iso(3), iso(4), 'Broken Weather');
  const card = page.getByRole('region', { name: 'Weather' });
  await card.getByRole('button', { name: 'Show the weather' }).click();
  await card.getByRole('button', { name: 'Find San Juan on the map' }).click();
  await expect(card.getByText('Weather is unavailable right now')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Destinations' })).toBeVisible();
});

test('the weather card passes the accessibility scan with no sideways scrolling', async ({ page }) => {
  await mockServices(page);
  await makeTrip(page, iso(3), iso(8), 'A11y Weather');
  const card = page.getByRole('region', { name: 'Weather' });
  await card.getByRole('button', { name: 'Show the weather' }).click();
  await card.getByRole('button', { name: 'Find San Juan on the map' }).click();
  await expect(card.getByText('Forecast').first()).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
