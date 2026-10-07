/**
 * Realistic sample trip for the UI checks, built as a TripNest trip file and loaded through the app's
 * own importer (so the importer is exercised too). Dates are relative to "now" so the Today / Next-up
 * panels have something to show.
 */
import type { Page } from '@playwright/test';
import { zonedToUtc } from '../../src/lib/time';

const ME = 'ffffffff-0000-4000-8000-000000000001';
const JON = 'ffffffff-0000-4000-8000-000000000002';
const MOM = 'ffffffff-0000-4000-8000-000000000003';
const TRIP = 'eeeeeeee-0000-4000-8000-000000000001';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const now = new Date();
const dayOffset = (n: number) => iso(new Date(now.getTime() + n * 86_400_000));
const START = dayOffset(-1);
const END = dayOffset(6);
const D = (n: number) => dayOffset(n - 2); // trip day n (1-based; day 1 = START)
const at = (day: number, time: string, tz: string) => zonedToUtc(D(day), time, tz).toISOString();
const stamp = new Date().toISOString();
let seq = 0;
const id = () => `dddddddd-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const PR = 'America/Puerto_Rico';

const item = (day: number, title: string, type: string, o: Record<string, unknown> = {}) => ({
  id: id(), trip_id: TRIP, destination_id: null, local_date: D(day), start_at: null, start_tz: null, end_at: null, end_tz: null, title, description: null,
  item_type: type, location_name: null, address: null, latitude: null, longitude: null, notes: null, cost_cents: null, currency: null,
  confirmation_number: null, website: null, contact: null, sort_order: 0, ...o,
});
const items = [
  item(1, 'Flight to San Juan', 'flight', { start_at: at(1, '08:00', 'America/Chicago'), start_tz: 'America/Chicago', end_at: at(1, '13:30', PR), end_tz: PR, confirmation_number: 'XK92LM', location_name: 'Austin-Bergstrom (AUS)', description: 'Seat 14A, terminal B, gate 7. Arrive two hours early.' }),
  item(1, 'Hotel check-in', 'hotel', { start_at: at(1, '15:00', PR), start_tz: PR, location_name: 'Hotel El Convento, Old San Juan', address: '100 Calle del Cristo, San Juan', confirmation_number: 'HC-5521', website: 'https://example.com/hotel', latitude: 18.4663, longitude: -66.1167 }),
  item(1, 'Dinner at La Factoria', 'restaurant', { start_at: at(1, '19:30', PR), start_tz: PR, end_at: at(1, '21:00', PR), end_tz: PR, location_name: 'La Factoria', cost_cents: 14500, currency: 'USD', latitude: 18.4655, longitude: -66.1057 }),
  item(2, 'Beach day at Condado', 'activity', { latitude: 18.4573, longitude: -66.0759, location_name: 'Condado Beach' }),
  item(2, 'Museo de Arte de Puerto Rico', 'activity', { start_at: at(2, '10:00', PR), start_tz: PR, end_at: at(2, '12:00', PR), end_tz: PR }),
  item(2, 'Lunch at the market', 'restaurant', { start_at: at(2, '11:30', PR), start_tz: PR, end_at: at(2, '13:00', PR), end_tz: PR }), // overlaps the museum
  item(3, 'Drive to Ponce', 'transportation', { start_at: at(3, '09:00', PR), start_tz: PR, end_at: at(3, '11:00', PR), end_tz: PR }),
  item(3, 'Free time on the plaza', 'free_time', { start_at: at(3, '14:00', PR), start_tz: PR }),
  item(5, 'Snorkeling tour with a very long name that should wrap nicely on a narrow phone screen', 'activity', { start_at: at(5, '09:00', PR), start_tz: PR, contact: '+1 787 555 0100', website: 'https://example.com/tour' }),
];

const reservations = [
  { id: id(), trip_id: TRIP, itinerary_item_id: items[0].id, kind: 'flight', title: 'AUS to SJU', provider: 'Southwest', confirmation_number: 'XK92LM', starts_at: at(1, '08:00', 'America/Chicago'), starts_tz: 'America/Chicago', ends_at: at(1, '13:30', PR), ends_tz: PR, website: null, phone: '+1 800 555 0111', address: null, details: { airline: 'Southwest', flight_number: 'WN 1234', seat: '14A', terminal: 'B', gate: '7' }, notes: null },
  { id: id(), trip_id: TRIP, itinerary_item_id: null, kind: 'hotel', title: 'Hotel El Convento', provider: null, confirmation_number: 'HC-5521', starts_at: at(1, '15:00', PR), starts_tz: PR, ends_at: at(8, '11:00', PR), ends_tz: PR, website: 'https://example.com/hotel', phone: '+1 787 555 0199', address: '100 Calle del Cristo, San Juan', details: { room: 'Courtyard king', check_in_instructions: 'Ask at the front desk for the rooftop key.' }, notes: 'Late check-in approved.' },
  { id: id(), trip_id: TRIP, itinerary_item_id: null, kind: 'other', title: 'Emergency contact: Mom', provider: null, confirmation_number: null, starts_at: null, starts_tz: null, ends_at: null, ends_tz: null, website: null, phone: '+1 512 555 0123', address: null, details: {}, notes: null },
];

const catShared = id(), catClothes = id(), catMine = id();
const packing_categories = [
  { id: catShared, trip_id: TRIP, name: 'Beach Gear', is_shared: true, owner_id: null, sort_order: 0 },
  { id: catClothes, trip_id: TRIP, name: 'Clothing', is_shared: true, owner_id: null, sort_order: 1 },
  { id: catMine, trip_id: TRIP, name: 'My toiletries', is_shared: false, owner_id: ME, sort_order: 0 },
];
const pk = (cat: string, name: string, packed: boolean, shared = true, extra: Record<string, unknown> = {}) => ({ id: id(), trip_id: TRIP, category_id: cat, name, quantity: 1, packed, assigned_to: null, notes: null, is_shared: shared, owner_id: shared ? null : ME, created_at: stamp, ...extra });
const packing_items = [
  pk(catShared, 'Sunscreen', true), pk(catShared, 'Beach towels', false, true, { quantity: 4, assigned_to: JON }), pk(catShared, 'Cooler', false),
  pk(catClothes, 'Swimsuits', true, true, { quantity: 2 }), pk(catClothes, 'Sandals', false),
  pk(catMine, 'Toothbrush', false, false), pk(catMine, 'Medications', true, false),
];

const expense = (desc: string, paid: string, cents: number, cur: string, cat: string, a: number, b: number) => ({
  id: id(), trip_id: TRIP, paid_by: paid, description: desc, amount_cents: cents, currency: cur, expense_date: D(1), category: cat, notes: null,
  itinerary_item_id: null, split_method: 'equal', created_at: stamp,
  expense_splits: [{ user_id: ME, amount_cents: a, share_value: null }, { user_id: JON, amount_cents: b, share_value: null }],
});
const expenses = [
  expense('Welcome dinner', ME, 14500, 'USD', 'Food', 7250, 7250),
  expense('Rental car for the whole week including insurance', JON, 32001, 'USD', 'Transportation', 16000, 16001),
  expense('Gelato in the old town', JON, 1800, 'EUR', 'Food', 900, 900),
];

const DOC = id();
export const SAMPLE_TRIP_NAME = 'Puerto Rico Vacation';

export function sampleTripFile() {
  return {
    app: 'tripnest', format: 1, exportedAt: stamp,
    tables: {
      trips: [{ id: TRIP, name: SAMPLE_TRIP_NAME, description: 'A week of beaches, food and history.', start_date: START, end_date: END, cover_image_url: null, primary_destination: 'San Juan', status: 'in_progress', notes: 'Bring cash for tips.', default_currency: 'USD', budget_near_pct: 80, created_at: stamp }],
      travelers: [
        { id: ME, trip_id: TRIP, name: 'Michelle', is_me: true, sort_order: 0 },
        { id: JON, trip_id: TRIP, name: 'Jon', is_me: false, sort_order: 1 },
        { id: MOM, trip_id: TRIP, name: 'Mom', is_me: false, sort_order: 2 },
      ],
      destinations: [
        { id: id(), trip_id: TRIP, name: 'San Juan', country: 'Puerto Rico', region: null, latitude: 18.4655, longitude: -66.1057, notes: 'Old town for the first days', arrival_date: D(1), departure_date: D(3), sort_order: 0 },
        { id: id(), trip_id: TRIP, name: 'Ponce', country: 'Puerto Rico', region: null, latitude: null, longitude: null, notes: null, arrival_date: D(3), departure_date: D(8), sort_order: 1 },
      ],
      itinerary_items: items,
      reservations,
      packing_categories,
      packing_items,
      expenses,
      settlements: [{ id: id(), trip_id: TRIP, from_user: JON, to_user: ME, amount_cents: 2000, currency: 'USD', settled_on: D(2), note: 'Venmo', created_at: stamp }],
      budgets: [
        { id: id(), trip_id: TRIP, category: null, amount_cents: 200000, currency: 'USD' },
        { id: id(), trip_id: TRIP, category: 'Food', amount_cents: 15000, currency: 'USD' },
        { id: id(), trip_id: TRIP, category: 'Transportation', amount_cents: 30000, currency: 'USD' },
      ],
      notes: [
        { id: id(), trip_id: TRIP, scope: 'trip', target_id: null, body: 'Book the snorkeling tour at least a day ahead.', created_at: stamp },
        { id: id(), trip_id: TRIP, scope: 'itinerary', target_id: items[0].id, body: 'Ask for a window seat.', created_at: stamp },
      ],
      documents: [{ id: DOC, trip_id: TRIP, itinerary_item_id: null, reservation_id: null, file_name: 'hotel-confirmation.pdf', mime_type: 'application/pdf', size_bytes: 83_000, created_at: stamp }],
    },
    files: { [DOC]: { type: 'application/pdf', data: Buffer.from('%PDF-1.1\n%%EOF\n').toString('base64') } },
  };
}

/** Loads the sample trip into the page's on-device storage and returns the new trip id. Blocks real network calls to map services. */
export async function seedSampleTrip(page: Page): Promise<string> {
  await page.route(/tile\.openstreetmap\.org|nominatim\.openstreetmap\.org|overpass-api\.de/, (r) => r.abort());
  await page.goto('/trips');
  await page.waitForSelector('main h1');
  const ids = await page.evaluate(async (json) => {
    const module = '/src/api/backup.ts'; // served by the dev server; a variable keeps TypeScript from resolving it
    const b = await import(/* @vite-ignore */ module);
    return b.importTrips(b.parseBackup(json)) as Promise<string[]>;
  }, JSON.stringify(sampleTripFile()));
  return ids[0];
}
